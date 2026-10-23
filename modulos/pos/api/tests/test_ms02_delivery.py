"""Tests del modulo de reparto -- MS-02.

Cubre los contratos 31, 32 y 33:
  31 . GET  /delivery
  32 . POST /delivery/assign
  33 . PATCH /delivery/{assignment_id}

Patron identico a test_ms01_kitchen_queue.py:
  - Fixture `entorno` crea engine aislado y sobreescribe get_db.
  - Helpers de siembra crean Order con delivery_type='DOMICILIO'.
  - Limpieza FK-segura en cada test.

Reglas de negocio:
  RN-MS02-01  Un pedido solo puede tener una asignacion activa.
  RN-MS02-02  Solo pedidos DOMICILIO pueden asignarse.
  RN-MS02-03  Estados terminales: ENTREGADO y NO_ENTREGADO.
  RN-MS02-04  Timestamps se sellan automaticamente en cada transicion.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.database import DATABASE_URL, get_db
from main import app
from models import Ticket, TerminalSession
from models.delivery import DeliveryAssignment
from models.orders import Order

TERMINAL_MS02 = "TEST-MS02-A"


# ---------------------------------------------------------------------------
# Infraestructura de aislamiento
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
        # Limpieza garantizada al salir del fixture (aunque el test falle).
        await _limpiar_directo(ent)
        app.dependency_overrides.pop(get_db, None)
        await ent.cerrar()


async def _limpiar_directo(ent: _Entorno) -> None:
    """Borra todos los datos de TEST-MS02 en orden FK-seguro.
    Se llama al inicio de cada test y al finalizar el fixture.
    """
    async with ent.Session() as db:
        await db.execute(
            delete(DeliveryAssignment).where(
                DeliveryAssignment.order_id.in_(
                    select(Order.id).where(
                        Order.ticket_id.in_(
                            select(Ticket.id).where(Ticket.terminal_id == TERMINAL_MS02)
                        )
                    )
                )
            )
        )
        await db.execute(
            delete(Order).where(
                Order.ticket_id.in_(
                    select(Ticket.id).where(Ticket.terminal_id == TERMINAL_MS02)
                )
            )
        )
        await db.execute(delete(Ticket).where(Ticket.terminal_id == TERMINAL_MS02))
        await db.execute(
            delete(TerminalSession).where(TerminalSession.terminal_id == TERMINAL_MS02)
        )
        await db.commit()


# ---------------------------------------------------------------------------
# Siembra y limpieza
# ---------------------------------------------------------------------------

async def _limpiar(ent: _Entorno) -> None:
    """Borra todos los datos de prueba en orden FK-seguro."""
    async with ent.Session() as db:
        # delivery_assignments -> orders -> tickets -> terminal_sessions
        await db.execute(
            delete(DeliveryAssignment).where(
                DeliveryAssignment.order_id.in_(
                    select(Order.id).where(
                        Order.ticket_id.in_(
                            select(Ticket.id).where(Ticket.terminal_id == TERMINAL_MS02)
                        )
                    )
                )
            )
        )
        await db.execute(
            delete(Order).where(
                Order.ticket_id.in_(
                    select(Ticket.id).where(Ticket.terminal_id == TERMINAL_MS02)
                )
            )
        )
        await db.execute(delete(Ticket).where(Ticket.terminal_id == TERMINAL_MS02))
        await db.execute(
            delete(TerminalSession).where(TerminalSession.terminal_id == TERMINAL_MS02)
        )
        await db.commit()


async def _sembrar_pedido_domicilio(ent: _Entorno) -> uuid.UUID:
    """Crea un ticket + order con delivery_type=DOMICILIO. Devuelve order.id."""
    async with ent.Session() as db:
        sesion = TerminalSession(terminal_id=TERMINAL_MS02, is_active=True)
        db.add(sesion)
        await db.flush()

        ticket = Ticket(
            terminal_id=TERMINAL_MS02,
            account_num="D9901",
            channel="REPARTO",
            status="OPEN",
        )
        db.add(ticket)
        await db.flush()

        order = Order(
            ticket_id=ticket.id,
            delivery_type="DOMICILIO",
            customer_name="Juan Repartido",
            customer_phone="555-0001",
            delivery_address="Calle Falsa 123",
        )
        db.add(order)
        await db.commit()
        await db.refresh(order)
        return order.id


async def _sembrar_pedido_pickup(ent: _Entorno) -> uuid.UUID:
    """Crea un ticket + order con delivery_type=PICKUP. Devuelve order.id."""
    async with ent.Session() as db:
        sesion = TerminalSession(terminal_id=TERMINAL_MS02, is_active=True)
        db.add(sesion)
        await db.flush()

        ticket = Ticket(
            terminal_id=TERMINAL_MS02,
            account_num="D9902",
            channel="PANADERIA",
            status="OPEN",
        )
        db.add(ticket)
        await db.flush()

        order = Order(
            ticket_id=ticket.id,
            delivery_type="PICKUP",
            customer_name="Maria Recoge",
        )
        db.add(order)
        await db.commit()
        await db.refresh(order)
        return order.id


# ---------------------------------------------------------------------------
# Tests -- Contrato 31: GET /delivery
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ms02_listar_reparto_vacio(entorno: _Entorno) -> None:
    """ms02.c31.f1 -- GET /delivery devuelve lista vacia."""
    await _limpiar_directo(entorno)
    async with httpx.AsyncClient(app=app, base_url="http://test") as c:
        resp = await c.get("/delivery")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["asignaciones"] == []


@pytest.mark.asyncio
async def test_ms02_listar_reparto_estado_invalido(entorno: _Entorno) -> None:
    """ms02.c31.f2 -- GET /delivery?estado=INVALIDO devuelve 422."""
    async with httpx.AsyncClient(app=app, base_url="http://test") as c:
        resp = await c.get("/delivery?estado=INVALIDO")
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Tests -- Contrato 32: POST /delivery/assign
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ms02_asignar_repartidor_ok(entorno: _Entorno) -> None:
    """ms02.c32.f1 -- POST /delivery/assign crea asignacion ASIGNADO."""
    await _limpiar_directo(entorno)
    order_id = await _sembrar_pedido_domicilio(entorno)

    async with httpx.AsyncClient(app=app, base_url="http://test") as c:
        resp = await c.post("/delivery/assign", json={
            "order_id": str(order_id),
            "repartidor_nombre": "Carlos Mensajero",
            "repartidor_telefono": "555-9999",
        })
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["estado"] == "ASIGNADO"
    assert data["repartidor_nombre"] == "Carlos Mensajero"
    assert data["order_id"] == str(order_id)
    assert data["asignado_at"] is not None


@pytest.mark.asyncio
async def test_ms02_asignar_pedido_no_domicilio(entorno: _Entorno) -> None:
    """ms02.c32.f2 -- RN-MS02-02: pedido PICKUP no puede asignarse (422)."""
    await _limpiar_directo(entorno)
    order_id = await _sembrar_pedido_pickup(entorno)

    async with httpx.AsyncClient(app=app, base_url="http://test") as c:
        resp = await c.post("/delivery/assign", json={
            "order_id": str(order_id),
            "repartidor_nombre": "Luis Error",
        })
    assert resp.status_code == 422
    assert "DOMICILIO" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_ms02_asignar_pedido_inexistente(entorno: _Entorno) -> None:
    """ms02.c32.f3 -- Pedido inexistente devuelve 404."""
    async with httpx.AsyncClient(app=app, base_url="http://test") as c:
        resp = await c.post("/delivery/assign", json={
            "order_id": str(uuid.uuid4()),
            "repartidor_nombre": "Nadie",
        })
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_ms02_asignar_duplicado_activo_409(entorno: _Entorno) -> None:
    """ms02.c32.f4 -- RN-MS02-01: segunda asignacion activa devuelve 409."""
    await _limpiar_directo(entorno)
    order_id = await _sembrar_pedido_domicilio(entorno)

    async with httpx.AsyncClient(app=app, base_url="http://test") as c:
        r1 = await c.post("/delivery/assign", json={
            "order_id": str(order_id),
            "repartidor_nombre": "Primero",
        })
        assert r1.status_code == 201

        r2 = await c.post("/delivery/assign", json={
            "order_id": str(order_id),
            "repartidor_nombre": "Segundo",
        })
    assert r2.status_code == 409
    assert "activa" in r2.json()["detail"]


# ---------------------------------------------------------------------------
# Tests -- Contrato 33: PATCH /delivery/{assignment_id}
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ms02_avanzar_asignado_a_en_camino(entorno: _Entorno) -> None:
    """ms02.c33.f1 -- ASIGNADO -> EN_CAMINO sella en_camino_at."""
    await _limpiar_directo(entorno)
    order_id = await _sembrar_pedido_domicilio(entorno)

    async with httpx.AsyncClient(app=app, base_url="http://test") as c:
        r_asignar = await c.post("/delivery/assign", json={
            "order_id": str(order_id),
            "repartidor_nombre": "Pedro Rapido",
        })
        assert r_asignar.status_code == 201
        assignment_id = r_asignar.json()["id"]

        resp = await c.patch(f"/delivery/{assignment_id}", json={"estado": "EN_CAMINO"})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["estado"] == "EN_CAMINO"
    assert data["en_camino_at"] is not None
    assert data["entregado_at"] is None


@pytest.mark.asyncio
async def test_ms02_avanzar_en_camino_a_entregado(entorno: _Entorno) -> None:
    """ms02.c33.f2 -- EN_CAMINO -> ENTREGADO sella entregado_at."""
    await _limpiar_directo(entorno)
    order_id = await _sembrar_pedido_domicilio(entorno)

    async with httpx.AsyncClient(app=app, base_url="http://test") as c:
        r = await c.post("/delivery/assign", json={
            "order_id": str(order_id), "repartidor_nombre": "Ana Veloz",
        })
        aid = r.json()["id"]
        await c.patch(f"/delivery/{aid}", json={"estado": "EN_CAMINO"})
        resp = await c.patch(f"/delivery/{aid}", json={"estado": "ENTREGADO"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["estado"] == "ENTREGADO"
    assert data["entregado_at"] is not None


@pytest.mark.asyncio
async def test_ms02_avanzar_en_camino_a_no_entregado(entorno: _Entorno) -> None:
    """ms02.c33.f3 -- EN_CAMINO -> NO_ENTREGADO (fallo de entrega)."""
    await _limpiar_directo(entorno)
    order_id = await _sembrar_pedido_domicilio(entorno)

    async with httpx.AsyncClient(app=app, base_url="http://test") as c:
        r = await c.post("/delivery/assign", json={
            "order_id": str(order_id), "repartidor_nombre": "Roberto Falla",
        })
        aid = r.json()["id"]
        await c.patch(f"/delivery/{aid}", json={"estado": "EN_CAMINO"})
        resp = await c.patch(
            f"/delivery/{aid}",
            json={"estado": "NO_ENTREGADO", "notas": "Cliente no contesta"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["estado"] == "NO_ENTREGADO"
    assert data["entregado_at"] is not None
    assert "Cliente no contesta" in data["notas"]


@pytest.mark.asyncio
async def test_ms02_estado_terminal_no_avanza(entorno: _Entorno) -> None:
    """ms02.c33.f4 -- RN-MS02-03: ENTREGADO es terminal (422)."""
    await _limpiar_directo(entorno)
    order_id = await _sembrar_pedido_domicilio(entorno)

    async with httpx.AsyncClient(app=app, base_url="http://test") as c:
        r = await c.post("/delivery/assign", json={
            "order_id": str(order_id), "repartidor_nombre": "Final",
        })
        aid = r.json()["id"]
        await c.patch(f"/delivery/{aid}", json={"estado": "EN_CAMINO"})
        await c.patch(f"/delivery/{aid}", json={"estado": "ENTREGADO"})
        resp = await c.patch(f"/delivery/{aid}", json={"estado": "EN_CAMINO"})
    assert resp.status_code == 422
    assert "terminal" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_ms02_transicion_invalida(entorno: _Entorno) -> None:
    """ms02.c33.f5 -- Saltar ASIGNADO -> ENTREGADO es invalido (422)."""
    await _limpiar_directo(entorno)
    order_id = await _sembrar_pedido_domicilio(entorno)

    async with httpx.AsyncClient(app=app, base_url="http://test") as c:
        r = await c.post("/delivery/assign", json={
            "order_id": str(order_id), "repartidor_nombre": "Saltar",
        })
        aid = r.json()["id"]
        resp = await c.patch(f"/delivery/{aid}", json={"estado": "ENTREGADO"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_ms02_patch_inexistente_404(entorno: _Entorno) -> None:
    """ms02.c33.f6 -- PATCH a asignacion inexistente devuelve 404."""
    async with httpx.AsyncClient(app=app, base_url="http://test") as c:
        resp = await c.patch(f"/delivery/{uuid.uuid4()}", json={"estado": "EN_CAMINO"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_ms02_get_delivery_filtra_por_estado(entorno: _Entorno) -> None:
    """ms02.c31.f3 -- GET /delivery?estado=ENTREGADO filtra correctamente."""
    await _limpiar_directo(entorno)
    order_id = await _sembrar_pedido_domicilio(entorno)

    async with httpx.AsyncClient(app=app, base_url="http://test") as c:
        r = await c.post("/delivery/assign", json={
            "order_id": str(order_id), "repartidor_nombre": "Filtrado",
        })
        aid = r.json()["id"]
        await c.patch(f"/delivery/{aid}", json={"estado": "EN_CAMINO"})
        await c.patch(f"/delivery/{aid}", json={"estado": "ENTREGADO"})

        # No debe aparecer en lista activos (default).
        resp_activos = await c.get("/delivery")
        ids_activos = [a["id"] for a in resp_activos.json()["asignaciones"]]
        assert aid not in ids_activos

        # Si debe aparecer en lista ENTREGADO.
        resp_entregados = await c.get("/delivery?estado=ENTREGADO")
        ids_entregados = [a["id"] for a in resp_entregados.json()["asignaciones"]]
        assert aid in ids_entregados
