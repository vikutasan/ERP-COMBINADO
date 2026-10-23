"""Puerta de FASE 12.21 — `TicketSalida` proyecta el bloque `order_*`.

CONTEXTO — por qué existe esta puerta
─────────────────────────────────────
La impresión automática al cobrar (paridad con el viejo POS §6.8) decide si el
ticket es un PEDIDO leyendo `pagado.data.order_type` — el cuerpo de la respuesta
del contrato 5 (`POST /pos/tickets/{id}/pay`). Pero `TicketSalida` NO exponía los
campos `order_*`: el frontend recibía `order_type === undefined` y NUNCA disparaba
la doble copia (CLIENTE + COMERCIO). El bug era invisible porque el cobro sí
funcionaba; solo faltaba la impresión.

La F12.21 añade los 8 campos `order_*` a `TicketSalida` y a `_ticket_a_salida`.
Esta puerta blinda esa proyección: sin ella, la impresión automática de un pedido
volvería a caer silenciosamente a la copia única.

Criterios:
  1. Un ticket VENTA_DIRECTA expone `order_type='VENTA_DIRECTA'` (default).
  2. Tras programar como PEDIDO (contrato 31), el cobro (contrato 5) devuelve el
     bloque `order_*` completo: tipo, entrega, cliente, teléfono, compromiso,
     empaque, dirección y notas.
  3. Un campo NO capturado viaja como `None` (no se inventa).

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al loop
de ese test) y sobreescribe la dependencia `get_db` de FastAPI.
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
from models import (
    CashSession,
    Order,
    Product,
    SystemSetting,
    TerminalSession,
    Ticket,
    TicketItem,
)

TERMINAL_ID = "TEST-F1221"

CLAVE_POLITICA_PAGO = "order_payment_policy"
POLITICA_SIN_PAGO = "SIN_PAGO"


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
# Utilidades de siembra y limpieza
# ---------------------------------------------------------------------------

async def _limpiar(ent: _Entorno) -> None:
    """Borra los datos de prueba (pedidos, tickets, ítems, caja, sesión, etc.)."""
    async with ent.Session() as db:
        ids = select(Ticket.id).where(Ticket.terminal_id == TERMINAL_ID)
        await db.execute(delete(Order).where(Order.ticket_id.in_(ids)))
        await db.execute(delete(TicketItem).where(TicketItem.ticket_id.in_(ids)))
        await db.execute(delete(Ticket).where(Ticket.terminal_id == TERMINAL_ID))
        await db.execute(
            delete(CashSession).where(CashSession.terminal_id == TERMINAL_ID)
        )
        await db.execute(
            delete(TerminalSession).where(TerminalSession.terminal_id == TERMINAL_ID)
        )
        await db.execute(delete(Product).where(Product.sku.like("TEST-F1221-%")))
        await db.execute(
            delete(SystemSetting).where(SystemSetting.key == CLAVE_POLITICA_PAGO)
        )
        await db.commit()


async def _sembrar(ent: _Entorno) -> uuid.UUID:
    """Crea una sesión de terminal activa y un producto. Devuelve su id."""
    async with ent.Session() as db:
        sesion = TerminalSession(terminal_id=TERMINAL_ID, is_active=True)
        producto = Product(
            sku=f"TEST-F1221-{uuid.uuid4().hex[:8]}",
            name="Producto F12.21",
            price=Decimal("15.00"),
            cost=Decimal("6.00"),
            active=True,
        )
        db.add_all([sesion, producto])
        await db.commit()
        return producto.id


async def _sembrar_caja(ent: _Entorno) -> None:
    """Abre un turno de caja (CashSession OPEN) para poder cobrar (RN-49)."""
    async with ent.Session() as db:
        caja = CashSession(
            terminal_id=TERMINAL_ID,
            employee_id=uuid.uuid4(),
            employee_name="Cajero F12.21",
            opening_float=Decimal("0.00"),
            status="OPEN",
        )
        db.add(caja)
        await db.commit()


async def _sembrar_politica_sin_pago(ent: _Entorno) -> None:
    """Declara `order_payment_policy=SIN_PAGO` (DT-06).

    Con la política por defecto (`PAGO_COMPLETO`, DT-07) el pedido solo se
    proyecta al COBRAR. Para programar un ticket OPEN y luego cobrarlo, se
    declara `SIN_PAGO`: así el pedido se proyecta al programar y el cobro lo
    re-proyecta sin sorpresas.
    """
    async with ent.Session() as db:
        db.add(SystemSetting(key=CLAVE_POLITICA_PAGO, value=POLITICA_SIN_PAGO))
        await db.commit()


def _cliente() -> httpx.AsyncClient:
    """Cliente HTTP async contra la app ASGI (sin red real)."""
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def _crear_ticket_con_linea(
    cliente: httpx.AsyncClient, product_id: uuid.UUID
) -> dict:
    """Reproduce el flujo REAL: crea vacío (contrato 29) y añade 1 línea (18)."""
    creado = await cliente.post(
        "/pos/tickets",
        json={"terminal_id": TERMINAL_ID, "channel": "PANADERIA", "items": []},
    )
    assert creado.status_code == 201, creado.text
    ticket_id = creado.json()["id"]

    con_linea = await cliente.post(
        f"/pos/tickets/{ticket_id}/items",
        json={
            "product_id": str(product_id),
            "quantity": 2,
            "item_id": str(uuid.uuid4()),
            "version": 0,
        },
    )
    assert con_linea.status_code in (200, 201), con_linea.text
    cuerpo = con_linea.json()
    cuerpo["id"] = ticket_id
    return cuerpo


# ---------------------------------------------------------------------------
# Criterio 1 — Un ticket normal expone el default VENTA_DIRECTA
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ticket_salida_expone_order_type_default(entorno):
    """Un ticket recién creado persiste `order_type='VENTA_DIRECTA'` (default).

    El contrato 18 (`TicketAtomicoSalida`) y el 3 (`TicketLigeroSalida`) NO
    exponen `order_type` (son proyecciones ligeras, O-23). El default se
    verifica contra la TABLA, que es donde el cobro (contrato 5) lo lee.
    """
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        product_id = await _sembrar(ent)
        async with _cliente() as cliente:
            ticket = await _crear_ticket_con_linea(cliente, product_id)

        async with ent.Session() as db:
            fila = await db.get(Ticket, uuid.UUID(ticket["id"]))
        assert fila is not None, "El ticket no se persistió"
        assert fila.order_type == "VENTA_DIRECTA", fila.order_type
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 2 — El cobro de un PEDIDO devuelve el bloque order_* completo
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cobro_de_pedido_expone_el_bloque_order(entorno):
    """Tras programar como PEDIDO, el cobro (contrato 5) trae los 8 campos.

    Es la precondición de la impresión automática: el frontend decide la doble
    copia leyendo `order_type` del cuerpo del cobro.
    """
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        product_id = await _sembrar(ent)
        await _sembrar_caja(ent)
        await _sembrar_politica_sin_pago(ent)

        async with _cliente() as cliente:
            ticket = await _crear_ticket_con_linea(cliente, product_id)
            ticket_id = ticket["id"]

            # Programar como PEDIDO (contrato 31).
            programado = await cliente.patch(
                f"/pos/tickets/{ticket_id}/order",
                json={
                    "version": ticket["version"],
                    "order_type": "PEDIDO",
                    "order_status": "PROGRAMADO PARA SER PREPARADO",
                    "delivery_type": "DOMICILIO",
                    "customer_name": "Cliente F12.21",
                    "customer_phone": "5551234567",
                    "committed_at": "2026-10-08T15:30:00",
                    "packaging_type": "CAJA",
                    "delivery_address": "Av. Reforma 123, Col. Centro",
                    "order_notes": "Sin nueces",
                },
            )
            assert programado.status_code == 200, programado.text
            version_programada = programado.json()["version"]

            # Cobrar (contrato 5). El cuerpo del cobro es lo que lee el POS.
            cobrado = await cliente.post(
                f"/pos/tickets/{ticket_id}/pay",
                json={
                    "version": version_programada,
                    "payment_details": {
                        "pagos": [{"metodo": "EFECTIVO", "monto": "30.00"}],
                    },
                },
            )

        assert cobrado.status_code == 200, cobrado.text
        cuerpo = cobrado.json()

        # El bloque order_* viaja COMPLETO en la respuesta del cobro.
        assert cuerpo["order_type"] == "PEDIDO", cuerpo
        assert cuerpo["delivery_type"] == "DOMICILIO", cuerpo
        assert cuerpo["customer_name"] == "Cliente F12.21", cuerpo
        assert cuerpo["customer_phone"] == "5551234567", cuerpo
        assert cuerpo["packaging_type"] == "CAJA", cuerpo
        assert cuerpo["delivery_address"] == "Av. Reforma 123, Col. Centro", cuerpo
        assert cuerpo["order_notes"] == "Sin nueces", cuerpo
        assert cuerpo["committed_at"] is not None, cuerpo
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 3 — Un campo NO capturado viaja como None (no se inventa)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cobro_de_pedido_campos_no_capturados_son_none(entorno):
    """Un PEDIDO sin dirección ni notas las expone como `None`, no como ''."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        product_id = await _sembrar(ent)
        await _sembrar_caja(ent)
        await _sembrar_politica_sin_pago(ent)

        async with _cliente() as cliente:
            ticket = await _crear_ticket_con_linea(cliente, product_id)
            ticket_id = ticket["id"]

            programado = await cliente.patch(
                f"/pos/tickets/{ticket_id}/order",
                json={
                    "version": ticket["version"],
                    "order_type": "PEDIDO",
                    "order_status": "PROGRAMADO PARA SER PREPARADO",
                    "delivery_type": "RECOGER",
                    "customer_name": "Cliente F12.21",
                    "customer_phone": "5551234567",
                    "committed_at": "2026-10-08T15:30:00",
                },
            )
            assert programado.status_code == 200, programado.text

            cobrado = await cliente.post(
                f"/pos/tickets/{ticket_id}/pay",
                json={
                    "version": programado.json()["version"],
                    "payment_details": {
                        "pagos": [{"metodo": "EFECTIVO", "monto": "30.00"}],
                    },
                },
            )

        assert cobrado.status_code == 200, cobrado.text
        cuerpo = cobrado.json()
        assert cuerpo["order_type"] == "PEDIDO", cuerpo
        # No capturados → None (el frontend los omite del ticket impreso).
        assert cuerpo["delivery_address"] is None, cuerpo
        assert cuerpo["order_notes"] is None, cuerpo
        assert cuerpo["packaging_type"] is None, cuerpo
    finally:
        await _limpiar(ent)
