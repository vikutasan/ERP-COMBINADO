"""Tests de sincronización central y multi-sucursal -- MS-03.

Cubre los contratos y reglas de sincronización:
  1. POST /sync/push -- Recepción asíncrona de lotes (ventas, caja).
  2. Idempotencia pura -- Reenviar el mismo lote no duplica ni genera error.
  3. Detección de conflicto -- Discrepancia en payload se registra en sync_conflicts (nunca silencioso).
  4. GET  /sync/pull -- Catálogo maestro para sucursales.
  5. GET  /sync/conflicts y POST /sync/conflicts/{id}/resolve -- Auditoría y resolución de conflictos.
  6. GET  /sync/dashboard/sales -- KPIs y ventas consolidadas por sucursal.
  7. Coexistencia multi-sucursal -- Dos sucursales con mismo folio no colisionan gracias a (branch_id, uuid).
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
from models.sync import Branch, CentralConsolidatedRecord, SyncConflict, SyncOutbox

BRANCH_A = "TEST-SUC-A"
BRANCH_B = "TEST-SUC-B"


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
        await _limpiar_test_data(ent)
        yield ent
    finally:
        await _limpiar_test_data(ent)
        app.dependency_overrides.pop(get_db, None)
        await ent.cerrar()


async def _limpiar_test_data(ent: _Entorno) -> None:
    test_branches = [BRANCH_A, BRANCH_B]
    async with ent.Session() as db:
        await db.execute(
            delete(SyncConflict).where(SyncConflict.branch_id.in_(test_branches))
        )
        await db.execute(
            delete(CentralConsolidatedRecord).where(
                CentralConsolidatedRecord.branch_id.in_(test_branches)
            )
        )
        await db.execute(
            delete(SyncOutbox).where(SyncOutbox.branch_id.in_(test_branches))
        )
        await db.execute(
            delete(Branch).where(Branch.code.in_(test_branches))
        )
        await db.commit()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ms03_push_ventas_exitoso(entorno):
    """POST /sync/push consolida tickets y registra la sucursal."""
    ticket_uuid = str(uuid.uuid4())
    payload = {
        "branch_id": BRANCH_A,
        "domain": "ventas",
        "schema_version": "1.0",
        "erp_version": "1.0.0",
        "records": [
            {
                "uuid": ticket_uuid,
                "folio": "V-001",
                "total": 125.50,
                "payment_method": "EFECTIVO",
                "items": [{"sku": "HEL-001", "quantity": 2, "price": 50.0}],
            }
        ],
    }

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/sync/push", json=payload)

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["status"] == "ok"
    assert data["received"] == 1
    assert data["conflicts"] == 0

    # Verificar en BD
    async with entorno.Session() as db:
        res = await db.execute(
            select(CentralConsolidatedRecord).where(
                CentralConsolidatedRecord.branch_id == BRANCH_A,
                CentralConsolidatedRecord.record_uuid == ticket_uuid,
            )
        )
        rec = res.scalar_one_or_none()
        assert rec is not None
        assert rec.payload["total"] == 125.50

        # Branch registrada
        res_b = await db.execute(select(Branch).where(Branch.code == BRANCH_A))
        b = res_b.scalar_one_or_none()
        assert b is not None
        assert b.last_sync_at is not None


@pytest.mark.asyncio
async def test_ms03_push_idempotente(entorno):
    """Reenviar exactamente el mismo payload no duplica registros ni falla."""
    ticket_uuid = str(uuid.uuid4())
    payload = {
        "branch_id": BRANCH_A,
        "domain": "ventas",
        "schema_version": "1.0",
        "erp_version": "1.0.0",
        "records": [
            {
                "uuid": ticket_uuid,
                "folio": "V-002",
                "total": 85.0,
            }
        ],
    }

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Primer envío
        r1 = await client.post("/sync/push", json=payload)
        assert r1.status_code == 200
        assert r1.json()["received"] == 1

        # Segundo envío idéntico (reintento de red)
        r2 = await client.post("/sync/push", json=payload)
        assert r2.status_code == 200
        data2 = r2.json()
        assert data2["received"] == 0
        assert data2["conflicts"] == 0


@pytest.mark.asyncio
async def test_ms03_push_detecta_conflicto_payload_mismatch(entorno):
    """Si el mismo record_uuid se envía con payload distinto, se registra en sync_conflicts."""
    ticket_uuid = str(uuid.uuid4())
    payload_original = {
        "branch_id": BRANCH_A,
        "domain": "ventas",
        "schema_version": "1.0",
        "erp_version": "1.0.0",
        "records": [{"uuid": ticket_uuid, "folio": "V-003", "total": 100.0}],
    }
    payload_alterado = {
        "branch_id": BRANCH_A,
        "domain": "ventas",
        "schema_version": "1.0",
        "erp_version": "1.0.0",
        "records": [{"uuid": ticket_uuid, "folio": "V-003", "total": 200.0}],  # discrepancia!
    }

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r1 = await client.post("/sync/push", json=payload_original)
        assert r1.status_code == 200

        r2 = await client.post("/sync/push", json=payload_alterado)
        assert r2.status_code == 200
        data2 = r2.json()
        assert data2["conflicts"] == 1

    # Verificar que el conflicto quedó auditado en BD
    async with entorno.Session() as db:
        res = await db.execute(
            select(SyncConflict).where(
                SyncConflict.branch_id == BRANCH_A,
                SyncConflict.record_uuid == ticket_uuid,
            )
        )
        conf = res.scalar_one_or_none()
        assert conf is not None
        assert conf.conflict_reason == "PAYLOAD_MISMATCH"
        assert conf.resolved is False
        assert conf.payload_local["total"] == 100.0
        assert conf.payload_remote["total"] == 200.0


@pytest.mark.asyncio
async def test_ms03_pull_catalogo(entorno):
    """GET /sync/pull retorna catálogo maestro con esquema versionado."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/sync/pull?domain=catalog")

    assert resp.status_code == 200
    data = resp.json()
    assert data["schema_version"] == "1.0"
    assert "products" in data
    assert "categories" in data
    assert "synced_at" in data


@pytest.mark.asyncio
async def test_ms03_listar_y_resolver_conflictos(entorno):
    """Listar conflictos abiertos y resolver uno con notas de auditoría."""
    conflict_uuid = str(uuid.uuid4())
    async with entorno.Session() as db:
        c = SyncConflict(
            branch_id=BRANCH_A,
            domain="ventas",
            record_uuid=conflict_uuid,
            conflict_reason="TEST_CONFLICT",
            payload_local={"monto": 10},
            payload_remote={"monto": 20},
            resolved=False,
        )
        db.add(c)
        await db.commit()
        await db.refresh(c)
        cid = str(c.id)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Listar
        r_list = await client.get(f"/sync/conflicts?branch_id={BRANCH_A}&resolved=false")
        assert r_list.status_code == 200
        confs = r_list.json()
        assert any(x["id"] == cid for x in confs)

        # Resolver
        r_res = await client.post(
            f"/sync/conflicts/{cid}/resolve",
            json={"resolution_notes": "Aprobado ajuste tras arqueo físico de caja."},
        )
        assert r_res.status_code == 200
        data_res = r_res.json()
        assert data_res["resolved"] is True
        assert "arqueo físico" in data_res["resolution_notes"]


@pytest.mark.asyncio
async def test_ms03_multiples_sucursales_mismo_folio_sin_colision(entorno):
    """Dos sucursales pueden emitir el mismo folio sin colisionar."""
    uuid_a = str(uuid.uuid4())
    uuid_b = str(uuid.uuid4())

    payload_a = {
        "branch_id": BRANCH_A,
        "domain": "ventas",
        "schema_version": "1.0",
        "erp_version": "1.0.0",
        "records": [{"uuid": uuid_a, "folio": "FOLIO-001", "total": 50.0}],
    }
    payload_b = {
        "branch_id": BRANCH_B,
        "domain": "ventas",
        "schema_version": "1.0",
        "erp_version": "1.0.0",
        "records": [{"uuid": uuid_b, "folio": "FOLIO-001", "total": 75.0}],
    }

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r_a = await client.post("/sync/push", json=payload_a)
        r_b = await client.post("/sync/push", json=payload_b)

    assert r_a.status_code == 200 and r_a.json()["received"] == 1
    assert r_b.status_code == 200 and r_b.json()["received"] == 1

    # Verificar que coexisten ambas
    async with entorno.Session() as db:
        res = await db.execute(
            select(CentralConsolidatedRecord).where(
                CentralConsolidatedRecord.branch_id.in_([BRANCH_A, BRANCH_B])
            )
        )
        records = res.scalars().all()
        assert len(records) == 2


@pytest.mark.asyncio
async def test_ms03_dashboard_ventas_consolidadas(entorno):
    """Dashboard consolida ventas y calcula métricas por sucursal y globales."""
    payload_a = {
        "branch_id": BRANCH_A,
        "domain": "ventas",
        "schema_version": "1.0",
        "erp_version": "1.0.0",
        "records": [
            {"uuid": str(uuid.uuid4()), "folio": "A-1", "total": 100.0},
            {"uuid": str(uuid.uuid4()), "folio": "A-2", "total": 200.0},
        ],
    }
    payload_b = {
        "branch_id": BRANCH_B,
        "domain": "ventas",
        "schema_version": "1.0",
        "erp_version": "1.0.0",
        "records": [
            {"uuid": str(uuid.uuid4()), "folio": "B-1", "total": 300.0},
        ],
    }

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post("/sync/push", json=payload_a)
        await client.post("/sync/push", json=payload_b)

        r_dash = await client.get("/sync/dashboard/sales")

    assert r_dash.status_code == 200
    dash = r_dash.json()
    assert dash["gran_total_ventas"] >= 600.0
    assert dash["gran_total_tickets"] >= 3

    suc_a = next(s for s in dash["sucursales"] if s["branch_id"] == BRANCH_A)
    assert suc_a["total_ventas"] == 300.0
    assert suc_a["total_tickets"] == 2
    assert suc_a["ticket_promedio"] == 150.0

    suc_b = next(s for s in dash["sucursales"] if s["branch_id"] == BRANCH_B)
    assert suc_b["total_ventas"] == 300.0
    assert suc_b["total_tickets"] == 1
    assert suc_b["ticket_promedio"] == 300.0
