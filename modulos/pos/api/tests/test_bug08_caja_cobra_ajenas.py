"""BUG-08 — Una caja (terminal con turno abierto) cobra cuentas de OTRAS terminales.

Síntoma reportado por el usuario (CAJA):
    "quise cobrar una cuenta y salió ⚠️ No se pudo completar
     No hay turno de caja abierto para esta terminal"

Causa raíz: `cobrar_ticket` derivaba el turno de caja de la terminal de ORIGEN
del ticket (`ticket.terminal_id`), no de la terminal que COBRA. En el viejo POS
el frontend manda `cash_session_id` (el turno de la terminal que cobra) y el
backend NUNCA sobreescribe el `terminal_id` del ticket.

Principio de vocabulario: "Toda terminal es una caja en potencia". Una terminal
con turno abierto puede cobrar cuentas de OTRAS terminales; el dinero se cuenta
en la caja que lo recibió (RN-53).

Estándar E-13: el backend es la autoridad. El `cash_session_id` declarado por el
cliente se VALIDA (existe + OPEN + su terminal tiene sesión activa); nunca se
confía a ciegas.

Los 7 criterios de la puerta BUG-08:

  ✓ test_1_cobra_cuenta_ajena_con_turno_propio        (el bug reportado)
  ✓ test_2_terminal_id_del_ticket_es_inmutable        (RN-12)
  ✓ test_3_retrocompat_sin_cash_session_id            (fallback al turno del ticket)
  ✓ test_4_turno_inexistente_da_400                   (E-13: existe)
  ✓ test_5_turno_cerrado_da_400                       (RN-55)
  ✓ test_6_turno_sin_sesion_de_terminal_da_400        (RN-24)
  ✓ test_7_regresion_cobro_normal_sigue_funcionando   (no rompe el flujo normal)
  ✓ test_contrato_33_pos_cobrar_ticket_declarado      (frontera A-02)

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al
loop de ese test) y sobreescribe la dependencia `get_db` de FastAPI.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from contracts import CONTRATOS
from core.database import DATABASE_URL, get_db
from main import app
from models import CashSession, Product, TerminalSession, Ticket, TicketItem

# Dos terminales: la de ORIGEN del ticket y la que COBRA (la caja).
TERMINAL_ORIGEN = "TEST-B08-ORIGEN"
TERMINAL_CAJA = "TEST-B08-CAJA"
TERMINAL_SIN_SESION = "TEST-B08-SIN-SESION"


# ---------------------------------------------------------------------------
# Aislamiento por test: engine propio ligado al loop del test
# ---------------------------------------------------------------------------

class _Entorno:
    """Engine + fábrica de sesiones ligados al loop del test en curso."""

    def __init__(self) -> None:
        self.engine = create_async_engine(DATABASE_URL, pool_pre_ping=True, future=True)
        self.Session = async_sessionmaker(
            bind=self.engine, class_=AsyncSession, expire_on_commit=False
        )

    async def cerrar(self) -> None:
        await self.engine.dispose()


@pytest.fixture
async def entorno():
    """Engine por test + override de `get_db` para que la app use ese engine."""
    ent = _Entorno()

    async def _get_db_override() -> AsyncSession:
        async with ent.Session() as session:
            yield session

    app.dependency_overrides[get_db] = _get_db_override
    try:
        yield ent
    finally:
        app.dependency_overrides.pop(get_db, None)
        await ent.cerrar()


# ---------------------------------------------------------------------------
# Utilidades de siembra y limpieza (usan el engine del test)
# ---------------------------------------------------------------------------

_TERMINALES = (TERMINAL_ORIGEN, TERMINAL_CAJA, TERMINAL_SIN_SESION)


async def _limpiar(ent: _Entorno) -> None:
    """Borra los datos de prueba (tickets, ítems, sesiones, turnos y producto)."""
    async with ent.Session() as db:
        await db.execute(
            delete(TicketItem).where(
                TicketItem.ticket_id.in_(
                    select(Ticket.id).where(Ticket.terminal_id.in_(_TERMINALES))
                )
            )
        )
        await db.execute(delete(Ticket).where(Ticket.terminal_id.in_(_TERMINALES)))
        await db.execute(
            delete(CashSession).where(CashSession.terminal_id.in_(_TERMINALES))
        )
        await db.execute(
            delete(TerminalSession).where(TerminalSession.terminal_id.in_(_TERMINALES))
        )
        await db.execute(delete(Product).where(Product.sku.like("TEST-B08-%")))
        await db.commit()


async def _sembrar_producto(ent: _Entorno) -> uuid.UUID:
    """Crea un producto de prueba. Devuelve su id."""
    async with ent.Session() as db:
        p = Product(
            sku=f"TEST-B08-{uuid.uuid4().hex[:8]}",
            name="Producto BUG-08",
            price=Decimal("50.00"),
            cost=Decimal("20.00"),
            active=True,
        )
        db.add(p)
        await db.commit()
        return p.id


async def _abrir_sesion_terminal(ent: _Entorno, terminal_id: str) -> None:
    """Crea una sesión de terminal activa (RN-24)."""
    async with ent.Session() as db:
        db.add(TerminalSession(terminal_id=terminal_id, is_active=True))
        await db.commit()


async def _abrir_turno_caja(
    ent: _Entorno, terminal_id: str, status: str = "OPEN"
) -> uuid.UUID:
    """Crea un turno de caja para la terminal. Devuelve su id."""
    async with ent.Session() as db:
        turno = CashSession(
            terminal_id=terminal_id,
            employee_id=uuid.uuid4(),
            employee_name="Cajera BUG-08",
            opening_float=Decimal("100.00"),
            status=status,
        )
        db.add(turno)
        await db.commit()
        return turno.id


def _cliente() -> httpx.AsyncClient:
    """Cliente HTTP async contra la app ASGI (sin red real)."""
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def _crear_ticket(
    cliente: httpx.AsyncClient, terminal_id: str, product_id: uuid.UUID
) -> dict:
    """Crea un ticket OPEN con una línea vía el contrato 29."""
    res = await cliente.post(
        "/pos/tickets",
        json={
            "terminal_id": terminal_id,
            "channel": "PANADERIA",
            "items": [{"product_id": str(product_id), "quantity": 1}],
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


def _pago_efectivo(total: str) -> dict:
    """Un pago único en efectivo que cubre el total exacto."""
    return {"metodo": "EFECTIVO", "monto": total, "recibido": total, "cambio": "0"}


# ---------------------------------------------------------------------------
# Criterio 1 — El bug reportado: una caja cobra una cuenta ajena
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_1_cobra_cuenta_ajena_con_turno_propio(entorno):
    """La CAJA (turno propio) cobra una cuenta de OTRA terminal sin turno.

    Antes del fix: el backend buscaba el turno de la terminal de ORIGEN del
    ticket (que no tiene turno) → 400 "No hay turno de caja abierto". Ahora: la
    CAJA declara su turno y el cobro procede; el dinero se cuenta en la caja
    que lo recibió (RN-53).
    """
    await _limpiar(entorno)
    try:
        producto = await _sembrar_producto(entorno)
        # La terminal de ORIGEN tiene sesión de terminal pero NO turno de caja.
        await _abrir_sesion_terminal(entorno, TERMINAL_ORIGEN)
        # La CAJA tiene sesión de terminal Y turno de caja abierto.
        await _abrir_sesion_terminal(entorno, TERMINAL_CAJA)
        turno_caja = await _abrir_turno_caja(entorno, TERMINAL_CAJA)

        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, TERMINAL_ORIGEN, producto)
            res = await cliente.post(
                f"/pos/tickets/{ticket['id']}/pay",
                json={
                    "payment_details": _pago_efectivo(str(ticket["total"])),
                    "version": ticket["version"],
                    "cobrador_nombre": "Cajera BUG-08",
                    "cash_session_id": str(turno_caja),
                },
            )
            assert res.status_code == 200, res.text
            assert res.json()["status"] == "PAID"

        # El dinero quedó contado en la caja que lo recibió (RN-53).
        async with entorno.Session() as db:
            cobrado = (
                await db.execute(select(Ticket).where(Ticket.id == uuid.UUID(ticket["id"])))
            ).scalars().first()
            assert cobrado is not None
            assert cobrado.cash_session_id == turno_caja
    finally:
        await _limpiar(entorno)


# ---------------------------------------------------------------------------
# Criterio 2 — El terminal_id del ticket NUNCA se sobreescribe (RN-12)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_2_terminal_id_del_ticket_es_inmutable(entorno):
    """Cobrar desde otra terminal NO cambia el `terminal_id` del ticket (RN-12).

    El origen del ticket es trazabilidad inmutable. El turno solo decide en qué
    caja se cuenta el dinero; jamás reescribe el origen.
    """
    await _limpiar(entorno)
    try:
        producto = await _sembrar_producto(entorno)
        await _abrir_sesion_terminal(entorno, TERMINAL_ORIGEN)
        await _abrir_sesion_terminal(entorno, TERMINAL_CAJA)
        turno_caja = await _abrir_turno_caja(entorno, TERMINAL_CAJA)

        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, TERMINAL_ORIGEN, producto)
            res = await cliente.post(
                f"/pos/tickets/{ticket['id']}/pay",
                json={
                    "payment_details": _pago_efectivo(str(ticket["total"])),
                    "version": ticket["version"],
                    "cash_session_id": str(turno_caja),
                },
            )
            assert res.status_code == 200, res.text

        async with entorno.Session() as db:
            cobrado = (
                await db.execute(select(Ticket).where(Ticket.id == uuid.UUID(ticket["id"])))
            ).scalars().first()
            assert cobrado is not None
            # El origen sigue siendo la terminal de ORIGEN, no la CAJA.
            assert cobrado.terminal_id == TERMINAL_ORIGEN
    finally:
        await _limpiar(entorno)


# ---------------------------------------------------------------------------
# Criterio 3 — Retrocompatibilidad: sin `cash_session_id` cae al turno del ticket
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_3_retrocompat_sin_cash_session_id(entorno):
    """Sin `cash_session_id`, el backend usa el turno de la terminal del ticket.

    Un cliente viejo/obsoleto que no declara su turno sigue funcionando: el
    comportamiento retrocompatible es el turno de la terminal de origen.
    """
    await _limpiar(entorno)
    try:
        producto = await _sembrar_producto(entorno)
        await _abrir_sesion_terminal(entorno, TERMINAL_ORIGEN)
        turno_origen = await _abrir_turno_caja(entorno, TERMINAL_ORIGEN)

        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, TERMINAL_ORIGEN, producto)
            res = await cliente.post(
                f"/pos/tickets/{ticket['id']}/pay",
                json={
                    "payment_details": _pago_efectivo(str(ticket["total"])),
                    "version": ticket["version"],
                },
            )
            assert res.status_code == 200, res.text
            assert res.json()["status"] == "PAID"

        async with entorno.Session() as db:
            cobrado = (
                await db.execute(select(Ticket).where(Ticket.id == uuid.UUID(ticket["id"])))
            ).scalars().first()
            assert cobrado is not None
            assert cobrado.cash_session_id == turno_origen
    finally:
        await _limpiar(entorno)


# ---------------------------------------------------------------------------
# Criterio 4 — Un turno declarado inexistente da 400 (E-13: existe)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_4_turno_inexistente_da_400(entorno):
    """Un `cash_session_id` que no existe se rechaza con 400 (E-13).

    El backend NO confía en el cliente: valida que el turno exista.
    """
    await _limpiar(entorno)
    try:
        producto = await _sembrar_producto(entorno)
        await _abrir_sesion_terminal(entorno, TERMINAL_ORIGEN)
        await _abrir_sesion_terminal(entorno, TERMINAL_CAJA)

        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, TERMINAL_ORIGEN, producto)
            res = await cliente.post(
                f"/pos/tickets/{ticket['id']}/pay",
                json={
                    "payment_details": _pago_efectivo(str(ticket["total"])),
                    "version": ticket["version"],
                    "cash_session_id": str(uuid.uuid4()),  # inexistente
                },
            )
            assert res.status_code == 400, res.text
            assert "no existe" in res.text.lower()
    finally:
        await _limpiar(entorno)


# ---------------------------------------------------------------------------
# Criterio 5 — Un turno declarado cerrado da 400 (RN-55)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_5_turno_cerrado_da_400(entorno):
    """Un `cash_session_id` con status != OPEN se rechaza con 400 (RN-55).

    Una sesión cerrada es inmutable: no se puede cobrar contra ella.
    """
    await _limpiar(entorno)
    try:
        producto = await _sembrar_producto(entorno)
        await _abrir_sesion_terminal(entorno, TERMINAL_ORIGEN)
        await _abrir_sesion_terminal(entorno, TERMINAL_CAJA)
        turno_cerrado = await _abrir_turno_caja(entorno, TERMINAL_CAJA, status="CLOSED")

        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, TERMINAL_ORIGEN, producto)
            res = await cliente.post(
                f"/pos/tickets/{ticket['id']}/pay",
                json={
                    "payment_details": _pago_efectivo(str(ticket["total"])),
                    "version": ticket["version"],
                    "cash_session_id": str(turno_cerrado),
                },
            )
            assert res.status_code == 400, res.text
            assert "cerrado" in res.text.lower()
    finally:
        await _limpiar(entorno)


# ---------------------------------------------------------------------------
# Criterio 6 — Un turno cuya terminal no tiene sesión activa da 400 (RN-24)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_6_turno_sin_sesion_de_terminal_da_400(entorno):
    """Un turno cuya terminal no tiene sesión de terminal activa da 400 (RN-24).

    El turno existe y está OPEN, pero su terminal no tiene sesión activa: sin
    sesión de terminal no se puede operar (RN-24).
    """
    await _limpiar(entorno)
    try:
        producto = await _sembrar_producto(entorno)
        await _abrir_sesion_terminal(entorno, TERMINAL_ORIGEN)
        # La terminal SIN SESIÓN tiene turno de caja abierto pero NO sesión de
        # terminal activa.
        turno_sin_sesion = await _abrir_turno_caja(entorno, TERMINAL_SIN_SESION)

        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, TERMINAL_ORIGEN, producto)
            res = await cliente.post(
                f"/pos/tickets/{ticket['id']}/pay",
                json={
                    "payment_details": _pago_efectivo(str(ticket["total"])),
                    "version": ticket["version"],
                    "cash_session_id": str(turno_sin_sesion),
                },
            )
            assert res.status_code == 400, res.text
            assert "RN-24" in res.text
    finally:
        await _limpiar(entorno)


# ---------------------------------------------------------------------------
# Criterio 7 — Regresión: el cobro normal sigue funcionando
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_7_regresion_cobro_normal_sigue_funcionando(entorno):
    """El cobro normal (misma terminal, turno propio) sigue funcionando.

    Declarar el turno de la MISMA terminal que el ticket no rompe nada: el
    cobro procede y el dinero se cuenta en esa caja.
    """
    await _limpiar(entorno)
    try:
        producto = await _sembrar_producto(entorno)
        await _abrir_sesion_terminal(entorno, TERMINAL_ORIGEN)
        turno = await _abrir_turno_caja(entorno, TERMINAL_ORIGEN)

        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, TERMINAL_ORIGEN, producto)
            res = await cliente.post(
                f"/pos/tickets/{ticket['id']}/pay",
                json={
                    "payment_details": _pago_efectivo(str(ticket["total"])),
                    "version": ticket["version"],
                    "cash_session_id": str(turno),
                },
            )
            assert res.status_code == 200, res.text
            assert res.json()["status"] == "PAID"

        async with entorno.Session() as db:
            cobrado = (
                await db.execute(select(Ticket).where(Ticket.id == uuid.UUID(ticket["id"])))
            ).scalars().first()
            assert cobrado is not None
            assert cobrado.cash_session_id == turno
            assert cobrado.terminal_id == TERMINAL_ORIGEN
    finally:
        await _limpiar(entorno)


# ---------------------------------------------------------------------------
# Criterio 8 — Frontera A-02: el contrato 33 del cobro está declarado
# ---------------------------------------------------------------------------

def test_contrato_33_pos_cobrar_ticket_declarado():
    """El endpoint de cobro existe CON contrato declarado (regla A-02).

    El contrato 33 (`pos.cobrar_ticket`) declara `cash_session_id` como campo
    opcional de entrada (BUG-08).
    """
    por_numero = {c.numero: c for c in CONTRATOS}
    assert 33 in por_numero, "Falta el contrato #33 (pos.cobrar_ticket)"
    contrato = por_numero[33]
    assert contrato.nombre == "pos.cobrar_ticket"
    assert contrato.operacion == "POST /pos/tickets/{ticket_id}/pay"
    assert contrato.tabla_expuesta is None
    assert "cash_session_id" in contrato.entrada, (
        "El contrato del cobro debe declarar `cash_session_id` (BUG-08)"
    )
