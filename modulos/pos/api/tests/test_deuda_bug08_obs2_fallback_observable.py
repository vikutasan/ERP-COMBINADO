"""DEUDA-BUG08 (Observación 2) — El fallback silencioso deja de ser silencioso.

Contexto:
    En BUG-08 el cobro acepta un `cash_session_id` declarado por el cliente. Si
    el cliente NO lo declara, el backend cae al turno de la terminal del ticket
    (retrocompatibilidad). Ese fallback es legítimo, pero SILENCIOSO: si el
    frontend olvida enviar el turno, el cobro "funciona" y el dinero se cuenta
    en la caja equivocada sin que nadie se entere.

La corrección (dos partes):
    1. OBSERVABILIDAD — cuando se usa el fallback, se escribe SIEMPRE un asiento
       en `pos_audit_log` (RN-75) que lo deja constancia, con el turno elegido y
       la terminal de origen del ticket.
    2. MODO ESTRICTO — si `POS_ESTRICTO_TURNO_CAJA` está activo, el fallback
       deja de tolerarse: el cobro responde 400 para que un frontend que olvida
       el turno falle ruidosamente en vez de cobrar en la caja equivocada.

Los criterios de esta puerta:

  ✓ test_1_fallback_escribe_asiento_de_auditoria   (RN-75: el fallback se audita)
  ✓ test_2_cobro_con_turno_declarado_no_audita_fallback
  ✓ test_3_flag_estricto_rechaza_el_fallback_con_400
  ✓ test_4_flag_estricto_no_afecta_el_cobro_con_turno_declarado
  ✓ test_5_flag_apagado_por_defecto_permite_el_fallback

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

from core.database import DATABASE_URL, get_db
from main import app
from models import CashSession, PosAuditLog, Product, TerminalSession, Ticket, TicketItem

# Dos terminales: la de ORIGEN del ticket y la que COBRA (la caja).
TERMINAL_ORIGEN = "TEST-OBS2-ORIGEN"
TERMINAL_CAJA = "TEST-OBS2-CAJA"

_TERMINALES = (TERMINAL_ORIGEN, TERMINAL_CAJA)


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


@pytest.fixture(autouse=True)
def aislar_flag_estricto(monkeypatch):
    """Garantiza que el flag arranca APAGADO en cada test (default seguro)."""
    monkeypatch.delenv("POS_ESTRICTO_TURNO_CAJA", raising=False)
    yield


# ---------------------------------------------------------------------------
# Utilidades de siembra y limpieza (usan el engine del test)
# ---------------------------------------------------------------------------

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
        await db.execute(
            delete(PosAuditLog).where(PosAuditLog.terminal_id.in_(_TERMINALES))
        )
        await db.execute(delete(Product).where(Product.sku.like("TEST-OBS2-%")))
        await db.commit()


async def _sembrar_producto(ent: _Entorno) -> uuid.UUID:
    """Crea un producto de prueba. Devuelve su id."""
    async with ent.Session() as db:
        p = Product(
            sku=f"TEST-OBS2-{uuid.uuid4().hex[:8]}",
            name="Producto OBS-2",
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


async def _abrir_turno_caja(ent: _Entorno, terminal_id: str) -> uuid.UUID:
    """Crea un turno de caja OPEN para la terminal. Devuelve su id."""
    async with ent.Session() as db:
        turno = CashSession(
            terminal_id=terminal_id,
            employee_id=uuid.uuid4(),
            employee_name="Cajera OBS-2",
            opening_float=Decimal("100.00"),
            status="OPEN",
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


async def _asientos_fallback(ent: _Entorno) -> list[PosAuditLog]:
    """Devuelve los asientos de auditoría del fallback (DEUDA-BUG08-OBS2)."""
    async with ent.Session() as db:
        filas = (
            await db.execute(
                select(PosAuditLog)
                .where(PosAuditLog.terminal_id.in_(_TERMINALES))
                .order_by(PosAuditLog.timestamp.asc())
            )
        ).scalars().all()
        return [
            f for f in filas if (f.extras or {}).get("observacion") == "DEUDA-BUG08-OBS2"
        ]


# ---------------------------------------------------------------------------
# Criterio 1 — El fallback escribe un asiento de auditoría (RN-75)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_1_fallback_escribe_asiento_de_auditoria(entorno):
    """Sin `cash_session_id`, el cobro cae al turno del ticket y lo AUDITA."""
    await _limpiar(entorno)
    try:
        producto = await _sembrar_producto(entorno)
        # La terminal de ORIGEN tiene sesión + turno (es la que cobra por fallback).
        await _abrir_sesion_terminal(entorno, TERMINAL_ORIGEN)
        turno_origen = await _abrir_turno_caja(entorno, TERMINAL_ORIGEN)

        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, TERMINAL_ORIGEN, producto)
            res = await cliente.post(
                f"/pos/tickets/{ticket['id']}/pay",
                json={
                    "version": ticket["version"],
                    "payment_details": {"pagos": [_pago_efectivo("50.00")]},
                    "cobrador_nombre": "Cajera OBS-2",
                },
            )
            assert res.status_code == 200, res.text

        asientos = await _asientos_fallback(entorno)
        assert len(asientos) == 1, "el fallback debe dejar EXACTAMENTE un asiento"
        asiento = asientos[0]
        assert asiento.endpoint == "POST /pos/tickets/{id}/pay"
        assert asiento.codigo == 200
        assert asiento.terminal_id == TERMINAL_ORIGEN
        assert asiento.payload["ticket_id"] == ticket["id"]
        assert asiento.payload["terminal_origen"] == TERMINAL_ORIGEN
        assert asiento.payload["cash_session_id"] == str(turno_origen)
        assert asiento.extras["motivo"] == "fallback_turno_de_la_terminal_del_ticket"
    finally:
        await _limpiar(entorno)


# ---------------------------------------------------------------------------
# Criterio 2 — El cobro con turno declarado NO audita un fallback
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_2_cobro_con_turno_declarado_no_audita_fallback(entorno):
    """Con `cash_session_id` declarado no hay fallback, luego no hay asiento."""
    await _limpiar(entorno)
    try:
        producto = await _sembrar_producto(entorno)
        await _abrir_sesion_terminal(entorno, TERMINAL_ORIGEN)
        await _abrir_sesion_terminal(entorno, TERMINAL_CAJA)
        await _abrir_turno_caja(entorno, TERMINAL_ORIGEN)
        turno_caja = await _abrir_turno_caja(entorno, TERMINAL_CAJA)

        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, TERMINAL_ORIGEN, producto)
            res = await cliente.post(
                f"/pos/tickets/{ticket['id']}/pay",
                json={
                    "version": ticket["version"],
                    "payment_details": {"pagos": [_pago_efectivo("50.00")]},
                    "cobrador_nombre": "Cajera OBS-2",
                    "cash_session_id": str(turno_caja),
                },
            )
            assert res.status_code == 200, res.text

        assert await _asientos_fallback(entorno) == []
    finally:
        await _limpiar(entorno)


# ---------------------------------------------------------------------------
# Criterio 3 — El modo estricto rechaza el fallback con 400
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_3_flag_estricto_rechaza_el_fallback_con_400(entorno, monkeypatch):
    """Con `POS_ESTRICTO_TURNO_CAJA` activo, el fallback es 400 (no cobra)."""
    monkeypatch.setenv("POS_ESTRICTO_TURNO_CAJA", "1")
    await _limpiar(entorno)
    try:
        producto = await _sembrar_producto(entorno)
        await _abrir_sesion_terminal(entorno, TERMINAL_ORIGEN)
        await _abrir_turno_caja(entorno, TERMINAL_ORIGEN)

        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, TERMINAL_ORIGEN, producto)
            res = await cliente.post(
                f"/pos/tickets/{ticket['id']}/pay",
                json={
                    "version": ticket["version"],
                    "payment_details": {"pagos": [_pago_efectivo("50.00")]},
                    "cobrador_nombre": "Cajera OBS-2",
                },
            )
            assert res.status_code == 400, res.text
            assert "POS_ESTRICTO_TURNO_CAJA" in res.text

        # El ticket NO se cobró (sigue OPEN) y no hay asiento de fallback.
        async with entorno.Session() as db:
            t = (
                await db.execute(select(Ticket).where(Ticket.id == uuid.UUID(ticket["id"])))
            ).scalars().first()
            assert t.status == "OPEN"
        assert await _asientos_fallback(entorno) == []
    finally:
        await _limpiar(entorno)


# ---------------------------------------------------------------------------
# Criterio 4 — El modo estricto NO afecta el cobro con turno declarado
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_4_flag_estricto_no_afecta_el_cobro_con_turno_declarado(
    entorno, monkeypatch
):
    """Con el flag activo, declarar el turno sigue cobrando con 200."""
    monkeypatch.setenv("POS_ESTRICTO_TURNO_CAJA", "true")
    await _limpiar(entorno)
    try:
        producto = await _sembrar_producto(entorno)
        await _abrir_sesion_terminal(entorno, TERMINAL_ORIGEN)
        await _abrir_sesion_terminal(entorno, TERMINAL_CAJA)
        await _abrir_turno_caja(entorno, TERMINAL_ORIGEN)
        turno_caja = await _abrir_turno_caja(entorno, TERMINAL_CAJA)

        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, TERMINAL_ORIGEN, producto)
            res = await cliente.post(
                f"/pos/tickets/{ticket['id']}/pay",
                json={
                    "version": ticket["version"],
                    "payment_details": {"pagos": [_pago_efectivo("50.00")]},
                    "cobrador_nombre": "Cajera OBS-2",
                    "cash_session_id": str(turno_caja),
                },
            )
            assert res.status_code == 200, res.text

        assert await _asientos_fallback(entorno) == []
    finally:
        await _limpiar(entorno)


# ---------------------------------------------------------------------------
# Criterio 5 — El flag está APAGADO por defecto (retrocompatibilidad)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_5_flag_apagado_por_defecto_permite_el_fallback(entorno):
    """Sin el flag, el fallback sigue permitido (retrocompatibilidad)."""
    await _limpiar(entorno)
    try:
        producto = await _sembrar_producto(entorno)
        await _abrir_sesion_terminal(entorno, TERMINAL_ORIGEN)
        await _abrir_turno_caja(entorno, TERMINAL_ORIGEN)

        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, TERMINAL_ORIGEN, producto)
            res = await cliente.post(
                f"/pos/tickets/{ticket['id']}/pay",
                json={
                    "version": ticket["version"],
                    "payment_details": {"pagos": [_pago_efectivo("50.00")]},
                    "cobrador_nombre": "Cajera OBS-2",
                },
            )
            assert res.status_code == 200, res.text

        assert len(await _asientos_fallback(entorno)) == 1
    finally:
        await _limpiar(entorno)
