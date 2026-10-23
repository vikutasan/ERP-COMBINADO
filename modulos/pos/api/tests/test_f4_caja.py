"""Puerta de FASE 4.0 — Prerrequisito del arqueo: ligar el ticket a su caja.

El Defecto 3 de la autocrítica del plan de Fase 4: `Ticket.cash_session_id`
existía en el modelo pero NUNCA se poblaba al cobrar. Sin este vínculo el
corte de caja saldría en cero: el ticket existiría, pero no pertenecería a
ninguna caja y el arqueo no lo contaría.

Esta puerta verifica DOS cosas (Plan de Abordaje Fase 4 §4.0.3):

  ✓ test_liga_ticket_a_sesion_de_caja   (positivo)
      Un ticket cobrado con un turno de caja abierto queda ligado a ese
      turno: `Ticket.cash_session_id` == id de la sesión de caja.

  ✓ test_cobro_sin_turno_de_caja_falla  (negativo)
      Un cobro SIN turno de caja abierto falla con un motivo claro
      (400, "No hay turno de caja abierto..."), no con un 500 ni un ticket
      huérfano.

La evidencia es la RESPUESTA HTTP real contra la app FastAPI montada sobre
PostgreSQL, más una lectura directa de la BD para confirmar el vínculo.

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al
loop de ese test) y sobreescribe la dependencia `get_db` de FastAPI, igual
que la puerta de FASE 3.2.
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

TERMINAL_ID = "TEST-F40"


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
    """Borra los datos de prueba (tickets, ítems, caja, sesión y producto).

    El orden importa: primero los tickets (que referencian la caja y la
    sesión), luego la caja y la sesión, y al final el producto.
    """
    async with ent.Session() as db:
        await db.execute(
            delete(TicketItem).where(
                TicketItem.ticket_id.in_(select(Ticket.id).where(Ticket.terminal_id == TERMINAL_ID))
            )
        )
        await db.execute(delete(Ticket).where(Ticket.terminal_id == TERMINAL_ID))
        await db.execute(
            delete(CashSession).where(CashSession.terminal_id == TERMINAL_ID)
        )
        await db.execute(
            delete(TerminalSession).where(TerminalSession.terminal_id == TERMINAL_ID)
        )
        await db.execute(delete(Product).where(Product.sku.like("TEST-F40-%")))
        await db.commit()


async def _sembrar_producto(ent: _Entorno) -> uuid.UUID:
    """Crea una sesión de terminal activa y un producto. Devuelve el id."""
    async with ent.Session() as db:
        sesion = TerminalSession(terminal_id=TERMINAL_ID, is_active=True)
        producto = Product(
            sku=f"TEST-F40-{uuid.uuid4().hex[:8]}",
            name="Producto F4.0",
            price=Decimal("10.00"),
            cost=Decimal("5.00"),
            active=True,
        )
        db.add_all([sesion, producto])
        await db.commit()
        return producto.id


async def _abrir_caja(ent: _Entorno) -> uuid.UUID:
    """Abre un turno de caja OPEN para la terminal. Devuelve el id de la caja."""
    async with ent.Session() as db:
        caja = CashSession(
            terminal_id=TERMINAL_ID,
            employee_id=uuid.uuid4(),
            employee_name="Cajero F4.0",
            opening_float=Decimal("100.00"),
            status="OPEN",
        )
        db.add(caja)
        await db.commit()
        return caja.id


def _cliente() -> httpx.AsyncClient:
    """Cliente HTTP async contra la app ASGI (sin red real)."""
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def _crear_ticket(cliente: httpx.AsyncClient, product_id: uuid.UUID) -> dict:
    """Crea un ticket OPEN con una línea vía el contrato 3."""
    res = await cliente.post(
        "/pos/tickets",
        json={
            "terminal_id": TERMINAL_ID,
            "channel": "PANADERIA",
            "items": [{"product_id": str(product_id), "quantity": 1}],
        },
    )
    assert res.status_code == 201, res.text
    return res.json()


# ---------------------------------------------------------------------------
# Criterio positivo — el ticket cobrado queda ligado a su caja
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_liga_ticket_a_sesion_de_caja(entorno):
    """Un ticket cobrado con caja abierta queda ligado a esa caja (F4.0)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        product_id = await _sembrar_producto(ent)
        caja_id = await _abrir_caja(ent)

        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, product_id)

            res = await cliente.post(
                f"/pos/tickets/{ticket['id']}/pay",
                json={
                    "payment_details": {"metodo": "EFECTIVO", "recibido": "10.00"},
                    "version": ticket["version"],
                },
            )
            assert res.status_code == 200, res.text
            assert res.json()["status"] == "PAID"

        # Evidencia dura: el vínculo está en la BD, no solo en la respuesta.
        async with ent.Session() as db:
            cobrado = (
                await db.execute(select(Ticket).where(Ticket.id == uuid.UUID(ticket["id"])))
            ).scalars().first()
            assert cobrado is not None
            assert cobrado.status == "PAID"
            assert cobrado.cash_session_id == caja_id, (
                "El ticket cobrado NO quedó ligado a su turno de caja: "
                f"cash_session_id={cobrado.cash_session_id}, caja={caja_id}"
            )
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio negativo — sin turno de caja abierto el cobro falla con motivo
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cobro_sin_turno_de_caja_falla(entorno):
    """Sin turno de caja abierto el cobro falla con un motivo claro (F4.0)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        product_id = await _sembrar_producto(ent)
        # A propósito NO se abre caja.

        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, product_id)

            res = await cliente.post(
                f"/pos/tickets/{ticket['id']}/pay",
                json={
                    "payment_details": {"metodo": "EFECTIVO", "recibido": "10.00"},
                    "version": ticket["version"],
                },
            )

            # El cobro se rechaza con 400 y un motivo legible, no con un 500.
            assert res.status_code == 400, res.text
            assert "turno de caja" in res.text.lower(), res.text

        # El ticket NO quedó cobrado ni huérfano: sigue OPEN y sin caja.
        async with ent.Session() as db:
            sin_cobrar = (
                await db.execute(select(Ticket).where(Ticket.id == uuid.UUID(ticket["id"])))
            ).scalars().first()
            assert sin_cobrar is not None
            assert sin_cobrar.status == "OPEN"
            assert sin_cobrar.cash_session_id is None
    finally:
        await _limpiar(ent)
