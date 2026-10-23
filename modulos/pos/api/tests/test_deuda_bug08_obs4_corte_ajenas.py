"""DEUDA-BUG08 (Observación 4) — ¿Quién cuadra la caja? El corte explica el cobro ajeno.

Contexto: con BUG-08 una caja (terminal con turno abierto) puede cobrar cuentas
de OTRAS terminales. Contablemente es correcto (RN-53: el dinero se cuenta donde
entró), pero el corte mostraba un `total_ventas` que mezclaba ventas propias y
ajenas sin explicarlo: la cajera no podía conciliar.

Solución: el resumen del turno (contrato 12) expone `ventas_propias`,
`ventas_ajenas` y `num_transacciones_ajenas`, repartiendo el MISMO `total_ventas`
según la terminal de ORIGEN del ticket (`ticket.terminal_id`).

Invariante que se blinda aquí:
    ventas_propias + ventas_ajenas == total_ventas   (siempre)

Los criterios de esta puerta:

  ✓ test_1_corte_separa_propias_de_ajenas            (el caso central)
  ✓ test_2_sin_ajenas_el_desglose_es_cero            (retrocompatibilidad)
  ✓ test_3_invariante_propias_mas_ajenas_es_total    (la suma cuadra)
  ✓ test_4_contrato_12_declara_los_campos_nuevos     (frontera A-02)

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
from models import CashSession, Product, TerminalSession, Ticket, TicketItem

# Dos terminales: la que COBRA (caja) y la de ORIGEN de la cuenta ajena.
TERMINAL_CAJA = "TEST-OBS4-CAJA"
TERMINAL_ORIGEN = "TEST-OBS4-ORIGEN"

_TERMINALES = (TERMINAL_CAJA, TERMINAL_ORIGEN)


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
        await db.execute(delete(Product).where(Product.sku.like("TEST-OBS4-%")))
        await db.commit()


async def _sembrar_producto(ent: _Entorno, precio: str = "50.00") -> uuid.UUID:
    """Crea un producto de prueba. Devuelve su id."""
    async with ent.Session() as db:
        p = Product(
            sku=f"TEST-OBS4-{uuid.uuid4().hex[:8]}",
            name="Producto OBS-4",
            price=Decimal(precio),
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
            employee_name="Cajera OBS-4",
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


async def _cobrar(
    cliente: httpx.AsyncClient,
    ticket: dict,
    cash_session_id: uuid.UUID,
    total: str,
) -> None:
    """Cobra el ticket declarando el turno de la terminal que cobra (BUG-08)."""
    res = await cliente.post(
        f"/pos/tickets/{ticket['id']}/pay",
        json={
            "version": ticket["version"],
            "cash_session_id": str(cash_session_id),
            "cobrador_nombre": "Cajera OBS-4",
            "payment_details": {
                "metodo": "EFECTIVO",
                "monto": total,
                "recibido": total,
                "cambio": "0",
            },
        },
    )
    assert res.status_code == 200, res.text


async def _resumen(cliente: httpx.AsyncClient, cash_session_id: uuid.UUID) -> dict:
    """Lee el resumen del turno (contrato 12)."""
    res = await cliente.get(f"/cash/session-summary/{cash_session_id}")
    assert res.status_code == 200, res.text
    return res.json()


# ---------------------------------------------------------------------------
# Criterio 1 — El corte separa las ventas propias de las ajenas
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_1_corte_separa_propias_de_ajenas(entorno):
    """La caja cobra 1 cuenta propia + 1 cuenta de otra terminal.

    El corte debe mostrar `ventas_propias` = la propia y `ventas_ajenas` = la
    ajena, sin cambiar `total_ventas` (que sigue siendo la suma de ambas).
    """
    await _limpiar(entorno)
    try:
        producto = await _sembrar_producto(entorno, precio="50.00")
        # La caja tiene turno; la terminal de origen solo sesión (sin turno).
        await _abrir_sesion_terminal(entorno, TERMINAL_CAJA)
        await _abrir_sesion_terminal(entorno, TERMINAL_ORIGEN)
        turno_caja = await _abrir_turno_caja(entorno, TERMINAL_CAJA)

        async with _cliente() as cliente:
            # Cuenta PROPIA: creada en la terminal de la caja.
            propia = await _crear_ticket(cliente, TERMINAL_CAJA, producto)
            await _cobrar(cliente, propia, turno_caja, "50.00")

            # Cuenta AJENA: creada en la otra terminal, cobrada por la caja.
            ajena = await _crear_ticket(cliente, TERMINAL_ORIGEN, producto)
            await _cobrar(cliente, ajena, turno_caja, "50.00")

            resumen = await _resumen(cliente, turno_caja)

        assert Decimal(resumen["ventas_propias"]) == Decimal("50.00"), resumen
        assert Decimal(resumen["ventas_ajenas"]) == Decimal("50.00"), resumen
        assert resumen["num_transacciones_ajenas"] == 1, resumen
        assert Decimal(resumen["total_ventas"]) == Decimal("100.00"), resumen
    finally:
        await _limpiar(entorno)


# ---------------------------------------------------------------------------
# Criterio 2 — Sin cuentas ajenas el desglose es cero (retrocompatibilidad)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_2_sin_ajenas_el_desglose_es_cero(entorno):
    """Un turno que solo cobra cuentas propias: `ventas_ajenas` = 0."""
    await _limpiar(entorno)
    try:
        producto = await _sembrar_producto(entorno, precio="30.00")
        await _abrir_sesion_terminal(entorno, TERMINAL_CAJA)
        turno_caja = await _abrir_turno_caja(entorno, TERMINAL_CAJA)

        async with _cliente() as cliente:
            propia = await _crear_ticket(cliente, TERMINAL_CAJA, producto)
            await _cobrar(cliente, propia, turno_caja, "30.00")
            resumen = await _resumen(cliente, turno_caja)

        assert Decimal(resumen["ventas_propias"]) == Decimal("30.00"), resumen
        assert Decimal(resumen["ventas_ajenas"]) == Decimal("0.00"), resumen
        assert resumen["num_transacciones_ajenas"] == 0, resumen
    finally:
        await _limpiar(entorno)


# ---------------------------------------------------------------------------
# Criterio 3 — La invariante: propias + ajenas == total_ventas
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_3_invariante_propias_mas_ajenas_es_total(entorno):
    """Con 2 propias y 1 ajena, la suma del desglose cuadra con `total_ventas`."""
    await _limpiar(entorno)
    try:
        producto = await _sembrar_producto(entorno, precio="40.00")
        await _abrir_sesion_terminal(entorno, TERMINAL_CAJA)
        await _abrir_sesion_terminal(entorno, TERMINAL_ORIGEN)
        turno_caja = await _abrir_turno_caja(entorno, TERMINAL_CAJA)

        async with _cliente() as cliente:
            for _ in range(2):
                t = await _crear_ticket(cliente, TERMINAL_CAJA, producto)
                await _cobrar(cliente, t, turno_caja, "40.00")
            ajena = await _crear_ticket(cliente, TERMINAL_ORIGEN, producto)
            await _cobrar(cliente, ajena, turno_caja, "40.00")

            resumen = await _resumen(cliente, turno_caja)

        propias = Decimal(resumen["ventas_propias"])
        ajenas = Decimal(resumen["ventas_ajenas"])
        total = Decimal(resumen["total_ventas"])
        assert propias == Decimal("80.00"), resumen
        assert ajenas == Decimal("40.00"), resumen
        assert propias + ajenas == total, resumen
        assert total == Decimal("120.00"), resumen
    finally:
        await _limpiar(entorno)


# ---------------------------------------------------------------------------
# Criterio 4 — El contrato 12 declara los campos nuevos (frontera A-02)
# ---------------------------------------------------------------------------

def test_4_contrato_12_declara_los_campos_nuevos():
    """`ResumenTurnoSalida` expone el desglose por origen (DEUDA-BUG08, Obs. 4)."""
    from schemas import ResumenTurnoSalida

    campos = set(ResumenTurnoSalida.model_fields.keys())
    assert "ventas_propias" in campos
    assert "ventas_ajenas" in campos
    assert "num_transacciones_ajenas" in campos
