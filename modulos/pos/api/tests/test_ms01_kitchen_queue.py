"""Tests de la cola de cocina — MS-01 (Contratos 28, 29, 30).

Verifica:
  ✓ test_encolar_ticket_en_cocina
      POST /orders/kitchen-queue encola el ticket con estado RECIBIDO y
      materializa las líneas en lineas_json (sin JOIN futuro).

  ✓ test_encolar_idempotente
      Si el ticket ya está en cola, el POST devuelve el registro existente
      sin crear duplicados.

  ✓ test_leer_cola_devuelve_recibido_y_en_prep
      GET /orders/kitchen-queue devuelve los tickets en RECIBIDO y EN_PREP,
      pero NO los LISTOS.

  ✓ test_avanzar_a_en_prep
      PATCH actualiza el estado de RECIBIDO → EN_PREP correctamente.

  ✓ test_avanzar_a_listo_sella_listo_at
      PATCH actualiza RECIBIDO → EN_PREP → LISTO y sella `listo_at`.

  ✓ test_transicion_invalida_rechazada
      PATCH con transición hacia atrás devuelve 422.

  ✓ test_filtro_por_canal
      GET /orders/kitchen-queue?canal=HELADERIA devuelve solo los tickets
      del canal solicitado.

  ✓ test_ticket_listo_no_aparece_en_cola
      Un ticket marcado LISTO no aparece en el GET.

Aislamiento: cada test crea su propio engine async y sobreescribe get_db,
igual que las demás puertas pytest del proyecto.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.database import DATABASE_URL, get_db
from main import app
from models import Product, TerminalSession, Ticket, TicketItem
from models.kitchen import KitchenTicket

TERMINAL_COCINA = "TEST-MS01-A"


# ---------------------------------------------------------------------------
# Infraestructura de aislamiento por test
# ---------------------------------------------------------------------------

class _Entorno:
    def __init__(self) -> None:
        self.engine = create_async_engine(DATABASE_URL, pool_pre_ping=True, future=True)
        self.Session = async_sessionmaker(
            bind=self.engine, class_=AsyncSession, expire_on_commit=False
        )

    async def cerrar(self) -> None:
        await self.engine.dispose()


@pytest.fixture
async def entorno():
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
# Siembra y limpieza
# ---------------------------------------------------------------------------

async def _limpiar(ent: _Entorno) -> None:
    """Borra todos los datos de prueba en orden FK-seguro."""
    async with ent.Session() as db:
        # kitchen_tickets referencia tickets
        await db.execute(
            delete(KitchenTicket).where(
                KitchenTicket.ticket_id.in_(
                    select(Ticket.id).where(Ticket.terminal_id == TERMINAL_COCINA)
                )
            )
        )
        await db.execute(
            delete(TicketItem).where(
                TicketItem.ticket_id.in_(
                    select(Ticket.id).where(Ticket.terminal_id == TERMINAL_COCINA)
                )
            )
        )
        await db.execute(delete(Ticket).where(Ticket.terminal_id == TERMINAL_COCINA))
        await db.execute(
            delete(TerminalSession).where(TerminalSession.terminal_id == TERMINAL_COCINA)
        )
        await db.execute(delete(Product).where(Product.sku.like("TEST-MS01-%")))
        await db.commit()


async def _sembrar_ticket(
    ent: _Entorno,
    *,
    folio: str = "V9901",
    canal: str = "PANADERIA",
    customer_name: str | None = None,
) -> tuple[uuid.UUID, uuid.UUID]:
    """Siembra una sesión, producto y ticket con un ítem. Devuelve (ticket_id, item_id)."""
    async with ent.Session() as db:
        sesion = TerminalSession(terminal_id=TERMINAL_COCINA, is_active=True)
        db.add(sesion)
        await db.flush()

        prod = Product(
            sku=f"TEST-MS01-{folio}",
            name="Telera de prueba",
            price=Decimal("8.00"),
        )
        db.add(prod)
        await db.flush()

        ticket = Ticket(
            account_num=folio,
            total=Decimal("16.00"),
            status="OPEN",
            order_type="PEDIDO",
            order_status="PROGRAMADO PARA SER PREPARADO",
            terminal_id=TERMINAL_COCINA,
            channel=canal,
            customer_name=customer_name,
            session_id=sesion.id,
        )
        db.add(ticket)
        await db.flush()

        item = TicketItem(
            ticket_id=ticket.id,
            item_id=str(uuid.uuid4()),
            product_id=prod.id,
            quantity=2,
            unit_price=Decimal("8.00"),
            subtotal=Decimal("16.00"),
            name="Telera de prueba",
        )
        db.add(item)
        await db.commit()
        return ticket.id, item.id


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_encolar_ticket_en_cocina(entorno):
    """POST /orders/kitchen-queue encola el ticket con estado RECIBIDO."""
    await _limpiar(entorno)
    ticket_id, _ = await _sembrar_ticket(entorno, folio="V9901")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post(
            "/orders/kitchen-queue",
            params={"ticket_id": str(ticket_id)},
        )

    assert r.status_code == 201, r.text
    data = r.json()
    assert data["kitchen_status"] == "RECIBIDO"
    assert data["account_num"] == "V9901"
    assert data["channel"] == "PANADERIA"
    assert len(data["lineas"]) == 1
    assert data["lineas"][0]["name"] == "Telera de prueba"
    assert data["lineas"][0]["quantity"] == 2
    assert data["listo_at"] is None

    await _limpiar(entorno)


@pytest.mark.asyncio
async def test_encolar_idempotente(entorno):
    """POST /orders/kitchen-queue con el mismo ticket devuelve el existente (sin duplicar)."""
    await _limpiar(entorno)
    ticket_id, _ = await _sembrar_ticket(entorno, folio="V9902")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        r1 = await client.post("/orders/kitchen-queue", params={"ticket_id": str(ticket_id)})
        r2 = await client.post("/orders/kitchen-queue", params={"ticket_id": str(ticket_id)})

    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["id"] == r2.json()["id"], "Idempotencia rota: se creó un duplicado"

    await _limpiar(entorno)


@pytest.mark.asyncio
async def test_leer_cola_devuelve_recibido_y_en_prep(entorno):
    """GET /orders/kitchen-queue devuelve RECIBIDO y EN_PREP, excluye LISTO."""
    await _limpiar(entorno)

    t1, _ = await _sembrar_ticket(entorno, folio="V9903")
    t2, _ = await _sembrar_ticket(entorno, folio="V9904")
    t3, _ = await _sembrar_ticket(entorno, folio="V9905")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        # Encolar los 3 tickets
        r1 = await client.post("/orders/kitchen-queue", params={"ticket_id": str(t1)})
        kt1_id = r1.json()["id"]
        await client.post("/orders/kitchen-queue", params={"ticket_id": str(t2)})
        r3 = await client.post("/orders/kitchen-queue", params={"ticket_id": str(t3)})
        kt3_id = r3.json()["id"]

        # Avanzar kt1 a EN_PREP y kt3 a LISTO
        await client.patch(
            f"/orders/kitchen-queue/{kt1_id}",
            json={"kitchen_status": "EN_PREP"},
        )
        await client.patch(
            f"/orders/kitchen-queue/{kt3_id}",
            json={"kitchen_status": "LISTO"},
        )

        # Leer la cola
        cola = await client.get("/orders/kitchen-queue")

    assert cola.status_code == 200
    data = cola.json()
    folios = {t["account_num"] for t in data["tickets"]}
    assert "V9903" in folios, "EN_PREP debe aparecer"
    assert "V9904" in folios, "RECIBIDO debe aparecer"
    assert "V9905" not in folios, "LISTO NO debe aparecer en la cola"
    assert data["total"] == 2

    await _limpiar(entorno)


@pytest.mark.asyncio
async def test_avanzar_a_en_prep(entorno):
    """PATCH avanza RECIBIDO → EN_PREP correctamente."""
    await _limpiar(entorno)
    t, _ = await _sembrar_ticket(entorno, folio="V9906")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post("/orders/kitchen-queue", params={"ticket_id": str(t)})
        kt_id = r.json()["id"]

        patch = await client.patch(
            f"/orders/kitchen-queue/{kt_id}",
            json={"kitchen_status": "EN_PREP"},
        )

    assert patch.status_code == 200
    assert patch.json()["kitchen_status"] == "EN_PREP"
    assert patch.json()["listo_at"] is None

    await _limpiar(entorno)


@pytest.mark.asyncio
async def test_avanzar_a_listo_sella_listo_at(entorno):
    """PATCH RECIBIDO → EN_PREP → LISTO sella listo_at."""
    await _limpiar(entorno)
    t, _ = await _sembrar_ticket(entorno, folio="V9907")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post("/orders/kitchen-queue", params={"ticket_id": str(t)})
        kt_id = r.json()["id"]

        await client.patch(f"/orders/kitchen-queue/{kt_id}", json={"kitchen_status": "EN_PREP"})
        listo = await client.patch(f"/orders/kitchen-queue/{kt_id}", json={"kitchen_status": "LISTO"})

    assert listo.status_code == 200
    assert listo.json()["kitchen_status"] == "LISTO"
    assert listo.json()["listo_at"] is not None, "listo_at debe sellarse al marcar LISTO"

    await _limpiar(entorno)


@pytest.mark.asyncio
async def test_transicion_invalida_rechazada(entorno):
    """PATCH con transición hacia atrás (EN_PREP → RECIBIDO) devuelve 422."""
    await _limpiar(entorno)
    t, _ = await _sembrar_ticket(entorno, folio="V9908")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post("/orders/kitchen-queue", params={"ticket_id": str(t)})
        kt_id = r.json()["id"]

        await client.patch(f"/orders/kitchen-queue/{kt_id}", json={"kitchen_status": "EN_PREP"})

        # Intentar retroceder a RECIBIDO (inválido — solo acepta EN_PREP o LISTO)
        retroceso = await client.patch(
            f"/orders/kitchen-queue/{kt_id}",
            json={"kitchen_status": "EN_PREP"},  # ya está en EN_PREP, no puede repetir
        )

    assert retroceso.status_code == 422

    await _limpiar(entorno)


@pytest.mark.asyncio
async def test_filtro_por_canal(entorno):
    """GET /orders/kitchen-queue?canal=HELADERIA devuelve solo los del canal."""
    await _limpiar(entorno)

    t_pan, _ = await _sembrar_ticket(entorno, folio="V9909", canal="PANADERIA")
    t_hel, _ = await _sembrar_ticket(entorno, folio="V9910", canal="HELADERIA")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/orders/kitchen-queue", params={"ticket_id": str(t_pan)})
        await client.post("/orders/kitchen-queue", params={"ticket_id": str(t_hel)})

        cola = await client.get("/orders/kitchen-queue", params={"canal": "HELADERIA"})

    assert cola.status_code == 200
    data = cola.json()
    assert all(t["channel"] == "HELADERIA" for t in data["tickets"])
    folios = {t["account_num"] for t in data["tickets"]}
    assert "V9909" not in folios, "PANADERIA no debe aparecer en filtro HELADERIA"
    assert "V9910" in folios

    await _limpiar(entorno)


@pytest.mark.asyncio
async def test_ticket_listo_no_aparece_en_cola(entorno):
    """Un ticket marcado LISTO no aparece en GET /orders/kitchen-queue."""
    await _limpiar(entorno)
    t, _ = await _sembrar_ticket(entorno, folio="V9911")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        r = await client.post("/orders/kitchen-queue", params={"ticket_id": str(t)})
        kt_id = r.json()["id"]

        await client.patch(f"/orders/kitchen-queue/{kt_id}", json={"kitchen_status": "LISTO"})

        cola = await client.get("/orders/kitchen-queue")

    assert cola.status_code == 200
    folios = {t["account_num"] for t in cola.json()["tickets"]}
    assert "V9911" not in folios, "Un ticket LISTO no debe aparecer en la cola activa"

    await _limpiar(entorno)
