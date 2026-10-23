"""Puerta de FASE 12.20 — Actualización de pedido (contrato 31).

Verifica los criterios de la puerta:

  ✓ test_contrato_31_declarado                    (frontera A-02)
  ✓ test_actualizar_pedido_persiste_order_type    (PATCH persiste PEDIDO)
  ✓ test_actualizar_pedido_reproyecta_el_pedido   (contrato 15 en la misma tx)
  ✓ test_actualizar_pedido_semantica_patch        (ausente no se toca)
  ✓ test_actualizar_pedido_version_conflict       (RN-25 → 409)
  ✓ test_actualizar_pedido_ticket_paid            (RN-23 → 400)
  ✓ test_actualizar_pedido_ticket_inexistente     (404)

CONTEXTO — por qué existe esta puerta
─────────────────────────────────────
El flujo REAL del POS es "productos primero, pedido después": el cajero agrega
productos (el ticket nace como VENTA_DIRECTA por el contrato 29) y LUEGO abre el
modal 📌 para programarlo como PEDIDO. Antes de este contrato, `guardarPedido`
(RetailVisionPOS.jsx) solo guardaba el bloque en memoria y, como el ticket ya
existía, NUNCA lo persistía: el `order_type` se quedaba en VENTA_DIRECTA y el
post-it del pizarrón no se distinguía de una cuenta normal.

El endpoint `PATCH /pos/tickets/{id}/order` existía SIN contrato declarado
(violación de la regla A-02). La F12.20 lo declara (contrato 31) y lo prueba.

La evidencia es la RESPUESTA HTTP real contra la app FastAPI montada sobre
PostgreSQL, no la intención. Se siembra un producto y una sesión de terminal,
se ejercita el flujo completo (crear vacío → añadir línea → programar pedido) y
se limpia al terminar.

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al
loop de ese test) y sobreescribe la dependencia `get_db` de FastAPI. Así se
evita el error "Future attached to a different loop" que aparece cuando un
engine module-level se reutiliza entre loops distintos.

Regla A-02: ningún endpoint existe sin contrato. El primer test lo afirma.
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
from models import (
    CashSession,
    Order,
    Product,
    SystemSetting,
    TerminalSession,
    Ticket,
    TicketItem,
)

# El contrato que la F12.20 declara (cierra el hueco A-02 del endpoint).
CONTRATO_ACTUALIZAR_PEDIDO = 31
NOMBRE_CONTRATO = "pos.actualizar_pedido"

TERMINAL_ID = "TEST-F1220"

# La clave transversal que decide SI se proyecta el pedido al crear (DT-06).
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
# Utilidades de siembra y limpieza (usan el engine del test)
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
        await db.execute(delete(Product).where(Product.sku.like("TEST-F1220-%")))
        await db.execute(
            delete(SystemSetting).where(SystemSetting.key == CLAVE_POLITICA_PAGO)
        )
        await db.commit()


async def _sembrar(ent: _Entorno) -> uuid.UUID:
    """Crea una sesión de terminal activa y un producto. Devuelve su id."""
    async with ent.Session() as db:
        sesion = TerminalSession(terminal_id=TERMINAL_ID, is_active=True)
        producto = Product(
            sku=f"TEST-F1220-{uuid.uuid4().hex[:8]}",
            name="Producto F12.20",
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
            employee_name="Cajero F12.20",
            opening_float=Decimal("0.00"),
            status="OPEN",
        )
        db.add(caja)
        await db.commit()


async def _sembrar_politica_sin_pago(ent: _Entorno) -> None:
    """Declara `order_payment_policy=SIN_PAGO` (DT-06).

    Con la política por defecto (`PAGO_COMPLETO`, DT-07) el pedido solo se
    proyecta al COBRAR. Para probar la re-proyección al PROGRAMAR un ticket
    OPEN, se declara `SIN_PAGO`: así el pedido se proyecta al crear/actualizar.
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
    """Reproduce el flujo REAL: crea vacío (contrato 29) y añade 1 línea (18).

    Devuelve el cuerpo del ticket tras añadir la línea (con su `version`).
    """
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
    # El contrato 18 devuelve TicketAtomicoSalida; el id del ticket viaja aparte.
    cuerpo["id"] = ticket_id
    return cuerpo


async def _leer_order_type(ent: _Entorno, ticket_id: str) -> str | None:
    """Lee el `order_type` persistido directamente de la tabla `tickets`."""
    async with ent.Session() as db:
        fila = await db.get(Ticket, uuid.UUID(ticket_id))
        return None if fila is None else fila.order_type


async def _leer_pedido(ent: _Entorno, ticket_id: str) -> Order | None:
    """Lee la fila proyectada en `orders` para el ticket (contrato 15)."""
    async with ent.Session() as db:
        res = await db.execute(
            select(Order).where(Order.ticket_id == uuid.UUID(ticket_id))
        )
        return res.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Criterio 1 — Frontera A-02: el contrato 31 está declarado
# ---------------------------------------------------------------------------

def test_contrato_31_declarado():
    """El endpoint `PATCH /pos/tickets/{id}/order` ya NO existe sin contrato."""
    por_numero = {c.numero: c for c in CONTRATOS}
    assert CONTRATO_ACTUALIZAR_PEDIDO in por_numero, (
        f"Falta el contrato #{CONTRATO_ACTUALIZAR_PEDIDO} ({NOMBRE_CONTRATO})"
    )
    contrato = por_numero[CONTRATO_ACTUALIZAR_PEDIDO]
    assert contrato.nombre == NOMBRE_CONTRATO, (
        f"El contrato #{CONTRATO_ACTUALIZAR_PEDIDO} se llama '{contrato.nombre}', "
        f"no '{NOMBRE_CONTRATO}'"
    )
    # Un contrato es una OPERACIÓN, no una tabla (O-23).
    assert contrato.tabla_expuesta is None
    assert contrato.operacion == "PATCH /pos/tickets/{id}/order", (
        f"El contrato declara '{contrato.operacion}', "
        "no 'PATCH /pos/tickets/{id}/order'"
    )
    # La garantía de la semántica PATCH debe estar declarada explícitamente.
    garantias = " ".join(contrato.garantias)
    assert "PATCH" in garantias, (
        "El contrato no declara la semántica PATCH (solo campos presentes)"
    )


# ---------------------------------------------------------------------------
# Criterio 2 — El PATCH persiste el order_type (el bug que cierra la F12.20)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_actualizar_pedido_persiste_order_type(entorno):
    """Programar un ticket ya creado persiste `order_type=PEDIDO` en la tabla."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        product_id = await _sembrar(ent)
        async with _cliente() as cliente:
            ticket = await _crear_ticket_con_linea(cliente, product_id)
            ticket_id = ticket["id"]

            # Antes del PATCH el ticket es VENTA_DIRECTA (nace así, contrato 29).
            assert await _leer_order_type(ent, ticket_id) == "VENTA_DIRECTA"

            res = await cliente.patch(
                f"/pos/tickets/{ticket_id}/order",
                json={
                    "version": ticket["version"],
                    "order_type": "PEDIDO",
                    "order_status": "PROGRAMADO PARA SER PREPARADO",
                    "delivery_type": "RECOGER",
                    "customer_name": "Cliente F12.20",
                    "committed_at": "2026-10-08T15:30:00",
                },
            )

        assert res.status_code == 200, res.text
        cuerpo = res.json()
        # El version se incrementa (RN-27): toda escritura sube el version.
        assert cuerpo["version"] == ticket["version"] + 1, cuerpo
        # La proyección de salida NO expone order_type (O-23), así que se
        # verifica contra la tabla: el bug era que NUNCA se persistía.
        assert await _leer_order_type(ent, ticket_id) == "PEDIDO", (
            "El PATCH no persistió order_type=PEDIDO; el post-it del pizarrón "
            "seguiría sin distinguirse de una cuenta normal."
        )
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 3 — El PATCH re-proyecta el pedido (contrato 15) en la misma tx
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_actualizar_pedido_reproyecta_el_pedido(entorno):
    """Tras programar como PEDIDO, nace la fila en `orders` (contrato 15).

    Se declara `order_payment_policy=SIN_PAGO` (DT-06) para que la proyección
    ocurra al PROGRAMAR un ticket OPEN. Con la política por defecto
    (`PAGO_COMPLETO`, DT-07) el pedido solo se proyecta al cobrar, así que un
    ticket OPEN programado no crearía fila en `orders` — comportamiento
    correcto, pero no lo que esta prueba quiere aislar.
    """
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        product_id = await _sembrar(ent)
        await _sembrar_politica_sin_pago(ent)
        async with _cliente() as cliente:
            ticket = await _crear_ticket_con_linea(cliente, product_id)
            ticket_id = ticket["id"]

            # Sin programar, no hay pedido proyectado (es VENTA_DIRECTA).
            assert await _leer_pedido(ent, ticket_id) is None

            res = await cliente.patch(
                f"/pos/tickets/{ticket_id}/order",
                json={
                    "version": ticket["version"],
                    "order_type": "PEDIDO",
                    "order_status": "PROGRAMADO PARA SER PREPARADO",
                    "delivery_type": "RECOGER",
                    "customer_name": "Cliente F12.20",
                    "committed_at": "2026-10-08T15:30:00",
                },
            )

        assert res.status_code == 200, res.text
        pedido = await _leer_pedido(ent, ticket_id)
        assert pedido is not None, (
            "El PATCH no re-proyectó el pedido (contrato 15); la tabla `orders` "
            "quedó vacía para un ticket ya programado como PEDIDO."
        )
        assert str(pedido.ticket_id) == ticket_id, pedido
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 4 — Semántica PATCH: un campo ausente NO se toca
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_actualizar_pedido_semantica_patch(entorno):
    """Un campo AUSENTE en la entrada no se toca; solo se aplican los presentes."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        product_id = await _sembrar(ent)
        async with _cliente() as cliente:
            ticket = await _crear_ticket_con_linea(cliente, product_id)
            ticket_id = ticket["id"]

            # 1er PATCH: programa con nombre de cliente.
            primero = await cliente.patch(
                f"/pos/tickets/{ticket_id}/order",
                json={
                    "version": ticket["version"],
                    "order_type": "PEDIDO",
                    "order_status": "PROGRAMADO PARA SER PREPARADO",
                    "customer_name": "Cliente Original",
                },
            )
            assert primero.status_code == 200, primero.text
            version_2 = primero.json()["version"]

            # 2º PATCH: solo cambia el estado; NO envía customer_name.
            segundo = await cliente.patch(
                f"/pos/tickets/{ticket_id}/order",
                json={
                    "version": version_2,
                    "order_status": "EN PREPARACIÓN",
                },
            )

        assert segundo.status_code == 200, segundo.text
        # El customer_name ausente NO se tocó (semántica PATCH).
        async with ent.Session() as db:
            fila = await db.get(Ticket, uuid.UUID(ticket_id))
            assert fila is not None
            assert fila.customer_name == "Cliente Original", (
                "Un campo AUSENTE en la entrada fue sobrescrito; la semántica "
                "PATCH exige no tocar lo que no viene."
            )
            assert fila.order_status == "EN PREPARACIÓN", fila.order_status
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 5 — Concurrencia optimista (RN-25): version desfasado → 409
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_actualizar_pedido_version_conflict(entorno):
    """Un `version` desfasado responde 409 (RN-25) y NO modifica el ticket."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        product_id = await _sembrar(ent)
        async with _cliente() as cliente:
            ticket = await _crear_ticket_con_linea(cliente, product_id)
            ticket_id = ticket["id"]

            res = await cliente.patch(
                f"/pos/tickets/{ticket_id}/order",
                json={
                    "version": ticket["version"] + 99,  # desfasado a propósito
                    "order_type": "PEDIDO",
                },
            )

        assert res.status_code == 409, res.text
        # El ticket NO se modificó: sigue VENTA_DIRECTA.
        assert await _leer_order_type(ent, ticket_id) == "VENTA_DIRECTA"
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 6 — Un ticket PAID no se modifica (RN-23) → 400
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_actualizar_pedido_ticket_paid(entorno):
    """Programar un ticket ya cobrado responde 400 (RN-23)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        product_id = await _sembrar(ent)
        # El cobro exige un turno de caja abierto (RN-49).
        await _sembrar_caja(ent)
        async with _cliente() as cliente:
            ticket = await _crear_ticket_con_linea(cliente, product_id)
            ticket_id = ticket["id"]

            # Cobrar el ticket (contrato 5) para llevarlo a PAID.
            cobro = await cliente.post(
                f"/pos/tickets/{ticket_id}/pay",
                json={
                    "version": ticket["version"],
                    "payment_details": {
                        "pagos": [
                            {"metodo": "EFECTIVO", "monto": float(ticket["total"])}
                        ]
                    },
                },
            )
            assert cobro.status_code == 200, cobro.text
            assert cobro.json()["status"] == "PAID", cobro.text
            version_pagado = cobro.json()["version"]

            res = await cliente.patch(
                f"/pos/tickets/{ticket_id}/order",
                json={"version": version_pagado, "order_type": "PEDIDO"},
            )

        assert res.status_code == 400, res.text
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 7 — Un ticket inexistente responde 404
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_actualizar_pedido_ticket_inexistente(entorno):
    """Programar un ticket que no existe responde 404."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        await _sembrar(ent)
        async with _cliente() as cliente:
            res = await cliente.patch(
                f"/pos/tickets/{uuid.uuid4()}/order",
                json={"version": 0, "order_type": "PEDIDO"},
            )

        assert res.status_code == 404, res.text
    finally:
        await _limpiar(ent)
