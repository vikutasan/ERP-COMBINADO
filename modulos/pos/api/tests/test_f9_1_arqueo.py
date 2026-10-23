"""Puerta de FASE 9.1.1 — El arqueo lee N pagos (corrección crítica).

Verifica que `_ventas_en_efectivo` (RN-53) sume SOLO el efectivo de cada
abono, no el total del ticket. Antes de F9.1.1 un ticket pagado $40 en
efectivo + $60 con tarjeta metía los $100 al esperado de la caja física
(inflando la caja en $60). La evidencia es la RESPUESTA HTTP real del
contrato 12 (`/cash/session-summary/{id}`), no la intención.

  ✓ test_mixto_solo_sube_el_efectivo        (el corazón de la corrección)
  ✓ test_varios_tickets_mixtos              (acumulación de N abonos)
  ✓ test_retrocompatibilidad_cobro_viejo    (forma {metodo, monto} sin pagos[])
  ✓ test_cien_por_ciento_tarjeta_no_sube    (100% no-efectivo no toca la caja)

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al
loop de ese test) y sobreescribe la dependencia `get_db` de FastAPI, igual
que las puertas de FASE 4.1 y 9.1.0.
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
from models import CashMovement, CashSession, Product, TerminalSession, Ticket, TicketItem

TERMINAL_ID = "TEST-F91"


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
    """Borra los datos de prueba (tickets, ítems, movimientos, caja, sesión)."""
    async with ent.Session() as db:
        await db.execute(
            delete(TicketItem).where(
                TicketItem.ticket_id.in_(select(Ticket.id).where(Ticket.terminal_id == TERMINAL_ID))
            )
        )
        await db.execute(delete(Ticket).where(Ticket.terminal_id == TERMINAL_ID))
        await db.execute(
            delete(CashMovement).where(
                CashMovement.cash_session_id.in_(
                    select(CashSession.id).where(CashSession.terminal_id == TERMINAL_ID)
                )
            )
        )
        await db.execute(delete(CashSession).where(CashSession.terminal_id == TERMINAL_ID))
        await db.execute(delete(TerminalSession).where(TerminalSession.terminal_id == TERMINAL_ID))
        await db.execute(delete(Product).where(Product.sku.like("TEST-F91-%")))
        await db.commit()


def _cliente() -> httpx.AsyncClient:
    """Cliente HTTP async contra la app ASGI (sin red real)."""
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def _abrir_turno(cliente: httpx.AsyncClient, fondo: str = "100.00") -> dict:
    """Abre un turno de caja vía el contrato 10. Devuelve la respuesta."""
    res = await cliente.post(
        "/cash/open-session",
        json={
            "terminal_id": TERMINAL_ID,
            "usuario_id": str(uuid.uuid4()),
            "monto_inicial": fondo,
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


async def _sembrar_ticket(
    ent: _Entorno,
    caja_id: str,
    total: str,
    payment_details: dict,
) -> None:
    """Siembra un ticket COBRADO ligado al turno (como lo deja el cobro real)."""
    async with ent.Session() as db:
        db.add(
            Ticket(
                id=uuid.uuid4(),
                account_num=f"V{uuid.uuid4().hex[:8]}",
                total=Decimal(total),
                payment_details=payment_details,
                status="PAID",
                terminal_id=TERMINAL_ID,
                cash_session_id=uuid.UUID(caja_id),
            )
        )
        await db.commit()


async def _esperado(cliente: httpx.AsyncClient, caja_id: str) -> Decimal:
    """Lee el esperado del turno por el contrato 12 (RN-53)."""
    res = await cliente.get(f"/cash/session-summary/{caja_id}")
    assert res.status_code == 200, res.text
    return Decimal(res.json()["esperado"])


# ---------------------------------------------------------------------------
# Criterio 1 — El corazón de la corrección: un pago mixto solo sube el efectivo
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_mixto_solo_sube_el_efectivo(entorno):
    """Un ticket $40 efectivo + $60 tarjeta sube el esperado SOLO $40 (RN-53)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            abierto = await _abrir_turno(cliente, fondo="100.00")
            caja_id = abierto["cash_session_id"]

            await _sembrar_ticket(
                ent,
                caja_id,
                total="100.00",
                payment_details={
                    "pagos": [
                        {"metodo": "EFECTIVO", "monto": "40.00", "recibido": "50.00", "cambio": "10.00"},
                        {"metodo": "TARJETA", "monto": "60.00", "tipo": "DEBITO"},
                    ],
                    "cajero": "Ana",
                },
            )

            # 100 (fondo) + 40 (solo el efectivo) = 140.00 — NO 200.00.
            assert await _esperado(cliente, caja_id) == Decimal("140.00")
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 2 — Varios tickets mixtos: se acumulan los abonos en efectivo
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_varios_tickets_mixtos(entorno):
    """Tres tickets mixtos acumulan SOLO sus abonos en efectivo (RN-53)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            abierto = await _abrir_turno(cliente, fondo="100.00")
            caja_id = abierto["cash_session_id"]

            # Ticket A: $30 efectivo + $70 tarjeta.
            await _sembrar_ticket(
                ent,
                caja_id,
                total="100.00",
                payment_details={
                    "pagos": [
                        {"metodo": "EFECTIVO", "monto": "30.00"},
                        {"metodo": "TARJETA", "monto": "70.00", "tipo": "CREDITO"},
                    ]
                },
            )
            # Ticket B: $50 efectivo + $50 transferencia.
            await _sembrar_ticket(
                ent,
                caja_id,
                total="100.00",
                payment_details={
                    "pagos": [
                        {"metodo": "EFECTIVO", "monto": "50.00"},
                        {"metodo": "TRANSFERENCIA", "monto": "50.00"},
                    ]
                },
            )
            # Ticket C: 100% efectivo.
            await _sembrar_ticket(
                ent,
                caja_id,
                total="25.00",
                payment_details={"pagos": [{"metodo": "EFECTIVO", "monto": "25.00"}]},
            )

            # 100 + (30 + 50 + 25) = 205.00.
            assert await _esperado(cliente, caja_id) == Decimal("205.00")
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 3 — Retrocompatibilidad con el cobro viejo ({metodo, monto})
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_retrocompatibilidad_cobro_viejo(entorno):
    """Un ticket viejo sin `pagos[]` sigue sumando su monto si es EFECTIVO."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            abierto = await _abrir_turno(cliente, fondo="100.00")
            caja_id = abierto["cash_session_id"]

            # Forma vieja: un solo método, sin `pagos[]`.
            await _sembrar_ticket(
                ent,
                caja_id,
                total="80.00",
                payment_details={"metodo": "EFECTIVO", "monto": "80.00", "recibido": "100.00"},
            )
            # Forma vieja con tarjeta: NO debe subir el efectivo.
            await _sembrar_ticket(
                ent,
                caja_id,
                total="60.00",
                payment_details={"metodo": "TARJETA", "monto": "60.00"},
            )

            # 100 + 80 = 180.00 (la tarjeta no entra).
            assert await _esperado(cliente, caja_id) == Decimal("180.00")
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 4 — 100% no-efectivo no toca la caja física
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cien_por_ciento_tarjeta_no_sube(entorno):
    """Un ticket pagado 100% con tarjeta deja el esperado en el fondo (RN-53)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            abierto = await _abrir_turno(cliente, fondo="100.00")
            caja_id = abierto["cash_session_id"]

            await _sembrar_ticket(
                ent,
                caja_id,
                total="150.00",
                payment_details={
                    "pagos": [{"metodo": "TARJETA", "monto": "150.00", "tipo": "DEBITO"}]
                },
            )

            # El esperado queda igual al fondo: 100.00.
            assert await _esperado(cliente, caja_id) == Decimal("100.00")
    finally:
        await _limpiar(ent)
