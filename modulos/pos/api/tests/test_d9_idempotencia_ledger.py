"""Puerta del CIERRE DE LA DEUDA D-9 — la idempotencia del contrato 18.

La deuda D-9 era: la idempotencia del contrato 18 (`POST /pos/tickets/{id}/items`)
vivía en un ledger PRESTADO dentro de `payment_details["_item_ids"]`. Ese ledger
se BORRABA al cobrar, porque `_normalizar_pagos` reconstruye `payment_details`
desde cero. Consecuencia: un reintento de red DESPUÉS del cobro no encontraba la
intención y volvía a escribir la línea en silencio (duplicaba la cantidad).

El cierre mueve la idempotencia a una TABLA propia, `ticket_item_intents`, con
restricción única `(ticket_id, item_id)` garantizada por el MOTOR. Esta puerta
verifica las dos propiedades que hacen que el cierre sea real:

  1. test_idempotencia_sobrevive_al_cobro  — LA BOMBA DE TIEMPO. Un reintento del
     MISMO `item_id` DESPUÉS de cobrar sigue siendo NO-OP. Con el ledger prestado
     esto FALLABA (el ledger se había borrado al cobrar).
  2. test_ledger_unico_y_fusion_rn17       — El ledger recuerda el CONJUNTO de
     intenciones, no una por línea. Dos intenciones distintas del MISMO producto
     (RN-17 las fusiona en UNA línea) quedan ambas registradas, así que el
     reintento de la SEGUNDA tampoco duplica.

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al loop
de ese test) y sobreescribe la dependencia `get_db` de FastAPI, igual que
`test_f3_atomico.py`.
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
    Product,
    TerminalSession,
    Ticket,
    TicketItem,
    TicketItemIntent,
)

TERMINAL_ID = "TEST-D9"


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
    """Borra los datos de prueba (intenciones, ítems, tickets, caja, etc.).

    El orden importa: las intenciones y los ítems referencian al ticket. La FK
    de `ticket_item_intents` es ON DELETE CASCADE, así que borrar el ticket
    bastaría; se borran explícitamente para no depender de eso en la limpieza.
    """
    async with ent.Session() as db:
        ids_tickets = select(Ticket.id).where(Ticket.terminal_id == TERMINAL_ID)
        await db.execute(
            delete(TicketItemIntent).where(TicketItemIntent.ticket_id.in_(ids_tickets))
        )
        await db.execute(
            delete(TicketItem).where(TicketItem.ticket_id.in_(ids_tickets))
        )
        await db.execute(delete(Ticket).where(Ticket.terminal_id == TERMINAL_ID))
        await db.execute(
            delete(CashSession).where(CashSession.terminal_id == TERMINAL_ID)
        )
        await db.execute(
            delete(TerminalSession).where(TerminalSession.terminal_id == TERMINAL_ID)
        )
        await db.execute(delete(Product).where(Product.sku.like("TEST-D9-%")))
        await db.commit()


async def _sembrar(ent: _Entorno) -> tuple[uuid.UUID, uuid.UUID]:
    """Crea una sesión de terminal activa, un turno de caja OPEN y 2 productos.

    Devuelve los ids de los dos productos. El turno de caja es necesario para
    poder COBRAR (RN-49): sin él, el contrato 5 responde 400.
    """
    async with ent.Session() as db:
        sesion = TerminalSession(terminal_id=TERMINAL_ID, is_active=True)
        caja = CashSession(
            terminal_id=TERMINAL_ID,
            employee_id=uuid.uuid4(),
            employee_name="Cajero D-9",
            opening_float=Decimal("0.00"),
            status="OPEN",
        )
        p1 = Product(
            sku=f"TEST-D9-{uuid.uuid4().hex[:8]}",
            name="Producto D-9 A",
            price=Decimal("10.00"),
            cost=Decimal("5.00"),
            active=True,
        )
        p2 = Product(
            sku=f"TEST-D9-{uuid.uuid4().hex[:8]}",
            name="Producto D-9 B",
            price=Decimal("20.00"),
            cost=Decimal("8.00"),
            active=True,
        )
        db.add_all([sesion, caja, p1, p2])
        await db.commit()
        return p1.id, p2.id


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


async def _cobrar(cliente: httpx.AsyncClient, ticket_id: str, version: int, total: str) -> dict:
    """Cobra el ticket con un pago en efectivo que cuadra el total (RN-94)."""
    res = await cliente.post(
        f"/pos/tickets/{ticket_id}/pay",
        json={
            "version": version,
            "payment_details": {
                "pagos": [{"metodo": "EFECTIVO", "monto": total, "recibido": total}]
            },
        },
    )
    assert res.status_code == 200, res.text
    return res.json()


# ---------------------------------------------------------------------------
# Criterio 1 — LA BOMBA DE TIEMPO: la idempotencia sobrevive al cobro
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_idempotencia_sobrevive_al_cobro(entorno):
    """Un reintento del MISMO `item_id` DESPUÉS de cobrar sigue siendo NO-OP.

    Este es el test que fallaba con el ledger prestado: al cobrar,
    `_normalizar_pagos` reconstruía `payment_details` y borraba
    `_item_ids`, así que el reintento posterior no encontraba la intención y
    volvía a escribir. Con la tabla `ticket_item_intents` la intención vive
    fuera del dominio de los pagos y sobrevive al cobro.
    """
    await _limpiar(entorno)
    p1, _ = await _sembrar(entorno)
    try:
        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, p1)
            ticket_id = ticket["id"]

            # 1. Añadir una línea con un `item_id` conocido.
            r1 = await cliente.post(
                f"/pos/tickets/{ticket_id}/items",
                json={
                    "item_id": "linea-bomba",
                    "product_id": str(p1),
                    "quantity": 1,
                    "version": ticket["version"],
                },
            )
            assert r1.status_code == 200, r1.text
            estado1 = r1.json()

            # 2. COBRAR el ticket (esto es lo que borraba el ledger prestado).
            cobrado = await _cobrar(
                cliente, ticket_id, estado1["version"], str(estado1["total"])
            )
            assert cobrado["status"] == "PAID"

            # 3. Reintentar la MISMA intención DESPUÉS del cobro. El ticket ya
            #    está PAID, así que la idempotencia debe responder ANTES de la
            #    regla RN-23 (no se modifica un PAID): el reintento es un NO-OP
            #    que devuelve el estado, no un 400/409.
            r3 = await cliente.post(
                f"/pos/tickets/{ticket_id}/items",
                json={
                    "item_id": "linea-bomba",
                    "product_id": str(p1),
                    "quantity": 1,
                    "version": cobrado["version"],
                },
            )
            assert r3.status_code == 200, r3.text
            estado3 = r3.json()

            # El número de líneas NO creció y el total NO cambió: no se duplicó.
            assert len(estado3["lineas"]) == len(estado1["lineas"]), (
                "El reintento post-cobro duplicó la línea (la bomba de tiempo D-9)"
            )
            assert Decimal(str(estado3["total"])) == Decimal(str(estado1["total"]))

            # Y en la base de datos sigue habiendo UNA sola línea.
            async with entorno.Session() as db:
                lineas = (
                    await db.execute(
                        select(TicketItem).where(
                            TicketItem.ticket_id == uuid.UUID(ticket_id)
                        )
                    )
                ).scalars().all()
                assert len(lineas) == 1, "La línea se duplicó en la base de datos"
    finally:
        await _limpiar(entorno)


# ---------------------------------------------------------------------------
# Criterio 2 — El ledger es ÚNICO por (ticket, item_id) y recuerda el CONJUNTO
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ledger_unico_y_fusion_rn17(entorno):
    """Dos intenciones del MISMO producto (RN-17 las fusiona) quedan AMBAS en el
    ledger, así que el reintento de la SEGUNDA tampoco duplica.

    Con una columna por línea esto era imposible: la fusión RN-17 produce UNA
    sola línea, y la columna solo podía recordar UNA de las dos intenciones. El
    reintento de la otra volvía a fusionar (duplicaba la cantidad). El ledger
    recuerda el CONJUNTO.
    """
    await _limpiar(entorno)
    p1, _ = await _sembrar(entorno)
    try:
        async with _cliente() as cliente:
            ticket = await _crear_ticket(cliente, p1)
            ticket_id = ticket["id"]

            # 1. Primera intención del producto p1.
            r1 = await cliente.post(
                f"/pos/tickets/{ticket_id}/items",
                json={
                    "item_id": "intencion-1",
                    "product_id": str(p1),
                    "quantity": 1,
                    "version": ticket["version"],
                },
            )
            assert r1.status_code == 200, r1.text
            estado1 = r1.json()

            # 2. SEGUNDA intención del MISMO producto: RN-17 la FUSIONA en la
            #    misma línea, pero es una intención DISTINTA. El ticket nació con
            #    1 unidad de p1 (contrato 3), así que tras las dos intenciones la
            #    línea tiene 3 unidades.
            r2 = await cliente.post(
                f"/pos/tickets/{ticket_id}/items",
                json={
                    "item_id": "intencion-2",
                    "product_id": str(p1),
                    "quantity": 1,
                    "version": estado1["version"],
                },
            )
            assert r2.status_code == 200, r2.text
            estado2 = r2.json()

            # La fusión dejó UNA sola línea con cantidad 3 (1 base + 2 intenciones).
            assert len(estado2["lineas"]) == 1, "RN-17 debió fusionar en una línea"
            assert estado2["lineas"][0]["quantity"] == 3

            # 3. Reintentar la SEGUNDA intención: NO-OP (no vuelve a fusionar).
            r3 = await cliente.post(
                f"/pos/tickets/{ticket_id}/items",
                json={
                    "item_id": "intencion-2",
                    "product_id": str(p1),
                    "quantity": 1,
                    "version": estado2["version"],
                },
            )
            assert r3.status_code == 200, r3.text
            estado3 = r3.json()
            assert estado3["lineas"][0]["quantity"] == 3, (
                "El reintento de la 2ª intención volvió a fusionar (duplicó)"
            )

            # 4. El ledger recuerda el CONJUNTO: además de la intención derivada
            #    de la línea base (el `product_id`, sembrada por `crear_ticket`),
            #    están las DOS intenciones explícitas. La clave es que la fusión
            #    RN-17 NO perdió ninguna: ambas sobreviven en el ledger.
            async with entorno.Session() as db:
                intents = (
                    await db.execute(
                        select(TicketItemIntent.item_id).where(
                            TicketItemIntent.ticket_id == uuid.UUID(ticket_id)
                        )
                    )
                ).scalars().all()
                assert "intencion-1" in intents, (
                    f"El ledger perdió la 1ª intención: {intents}"
                )
                assert "intencion-2" in intents, (
                    f"El ledger perdió la 2ª intención (la que fusionó): {intents}"
                )
                # La intención derivada de la línea base también está registrada.
                assert str(p1) in intents, (
                    f"El ledger no sembró la intención de la línea base: {intents}"
                )
                # Y no hay duplicados: la restricción única (ticket_id, item_id)
                # lo garantiza a nivel de motor.
                assert len(intents) == len(set(intents)), (
                    f"El ledger tiene intenciones duplicadas: {intents}"
                )
    finally:
        await _limpiar(entorno)
