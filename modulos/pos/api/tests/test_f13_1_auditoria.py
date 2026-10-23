"""Puerta de FASE 13.1 — Contrato 5 (`pos.eventos_auditables`).

Verifica los criterios de la puerta (Plan de Abordaje F13 §4, sub-fase 13.1):

  ✓ test_contrato_5_declarado_implementado   (el contrato 5 ya no es "Cicatriz")
  ✓ test_endpoint_devuelve_resumen           (GET /pos/auditable-events responde)
  ✓ test_endpoint_filtra_por_rango           (RN-77: solo el rango pedido)
  ✓ test_endpoint_rango_invalido_400         (desde > hasta → 400)
  ✓ test_endpoint_no_expone_tabla_tickets    (O-23: proyección, no la tabla)
  ✓ test_endpoint_ordena_por_timestamp       (los eventos llegan en orden)

La evidencia es la RESPUESTA HTTP real contra PostgreSQL, no la intención. Se
insertan asientos en `pos_audit_log`, se consulta el endpoint por rango, y se
limpia al terminar.

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al
loop de ese test), igual que `test_f13_auditoria.py`, para evitar el error
"Future attached to a different loop".
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.database import DATABASE_URL, get_db
from main import app
from models import PosAuditLog

TERMINAL_ID = "TEST-F13-1"


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
    """Engine por test + override de `get_db` + limpieza de los asientos.

    La limpieza se hace ANTES y DESPUÉS del test. El "antes" es lo que hace
    determinista al test: `pos_audit_log` es una tabla compartida y otros
    tests (p. ej. los de cobro) dejan asientos con el mismo `terminal_id`.
    Sin el "antes", el rango consultado arrastra esos asientos ajenos y el
    conteo deja de ser 3 (falso rojo por contaminación, no por regresión).
    """
    ent = _Entorno()

    async def _get_db_override():
        async with ent.Session() as db:
            yield db

    async def _limpiar_asientos() -> None:
        async with ent.Session() as db:
            await db.execute(
                delete(PosAuditLog).where(PosAuditLog.terminal_id == TERMINAL_ID)
            )
            await db.commit()

    app.dependency_overrides[get_db] = _get_db_override
    try:
        await _limpiar_asientos()
        yield ent
    finally:
        app.dependency_overrides.pop(get_db, None)
        await _limpiar_asientos()
        await ent.cerrar()


def _cliente() -> httpx.AsyncClient:
    """Cliente HTTP en proceso (sin red), contra la app ASGI."""
    transporte = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transporte, base_url="http://test")


async def _sembrar(ent: _Entorno, base: datetime) -> list[uuid.UUID]:
    """Inserta 3 asientos de prueba en `pos_audit_log`.

    Devuelve los `ticket_id` sembrados (NO los ids internos de la fila). El
    endpoint `/pos/auditable-events` filtra SOLO por rango de tiempo, así que
    la tabla compartida puede contener asientos ajenos dentro del mismo rango
    (otros tests, cobros reales). Para que la aserción sea determinista, los
    tests se acotan a los `ticket_id` que ellos mismos sembraron.
    """
    ticket_ids: list[uuid.UUID] = []
    async with ent.Session() as db:
        for i in range(3):
            ticket_id = uuid.uuid4()
            fila = PosAuditLog(
                endpoint=f"POST /pos/tickets/{i}",
                payload={"ticket_id": str(ticket_id), "folio": f"V{i:04d}"},
                codigo=201,
                terminal_id=TERMINAL_ID,
                usuario_id="u-test",
                extras={"origen": "test_f13_1"},
                timestamp=base + timedelta(minutes=i),
            )
            db.add(fila)
            await db.flush()
            ticket_ids.append(ticket_id)
        await db.commit()
    return ticket_ids


def _solo_los_sembrados(
    eventos: list[dict], ticket_ids: list[uuid.UUID]
) -> list[dict]:
    """Filtra la respuesta a los eventos de los `ticket_id` sembrados.

    Aísla la aserción de la contaminación de la tabla compartida: el endpoint
    devuelve TODO lo que caiga en el rango, pero el test solo responde por lo
    que él mismo sembró.
    """
    sembrados = {str(t) for t in ticket_ids}
    return [e for e in eventos if e.get("ticket_id") in sembrados]


# ---------------------------------------------------------------------------
# Criterio 1 — el contrato 5 ya no es "Cicatriz"
# ---------------------------------------------------------------------------

def test_contrato_5_declarado_implementado():
    """El contrato 5 existe y su `estado_hoy` es "Implementado" (F13.1)."""
    from contracts import CONTRATOS

    contrato = next(c for c in CONTRATOS if c.numero == 5)
    assert contrato.nombre == "pos.eventos_auditables"
    assert contrato.operacion == "GET /pos/auditable-events"
    assert contrato.estado_hoy == "Implementado"


# ---------------------------------------------------------------------------
# Criterio 2 — el endpoint responde un RESUMEN (O-23)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_endpoint_devuelve_resumen(entorno):
    """GET /pos/auditable-events devuelve los eventos del rango pedido."""
    base = datetime.now(timezone.utc) - timedelta(hours=1)
    ticket_ids = await _sembrar(entorno, base)

    desde = (base - timedelta(minutes=1)).isoformat()
    hasta = (base + timedelta(minutes=10)).isoformat()

    async with _cliente() as cliente:
        res = await cliente.get(
            "/pos/auditable-events", params={"desde": desde, "hasta": hasta}
        )

    assert res.status_code == 200
    cuerpo = res.json()
    assert "eventos" in cuerpo
    # La tabla es compartida: se acota a los asientos sembrados por el test.
    propios = _solo_los_sembrados(cuerpo["eventos"], ticket_ids)
    assert len(propios) == 3
    primero = propios[0]
    assert set(primero.keys()) == {
        "tipo",
        "ticket_id",
        "usuario_id",
        "timestamp",
        "detalle",
    }


@pytest.mark.asyncio
async def test_endpoint_filtra_por_rango(entorno):
    """RN-77: solo se devuelven los eventos dentro del rango pedido."""
    base = datetime.now(timezone.utc) - timedelta(hours=1)
    ticket_ids = await _sembrar(entorno, base)

    # Rango que solo cubre el PRIMER asiento (base + 0 min).
    desde = (base - timedelta(seconds=30)).isoformat()
    hasta = (base + timedelta(seconds=30)).isoformat()

    async with _cliente() as cliente:
        res = await cliente.get(
            "/pos/auditable-events", params={"desde": desde, "hasta": hasta}
        )

    assert res.status_code == 200
    # De los sembrados, solo el primero cae dentro del rango estrecho.
    propios = _solo_los_sembrados(res.json()["eventos"], ticket_ids)
    assert len(propios) == 1


@pytest.mark.asyncio
async def test_endpoint_rango_invalido_400(entorno):
    """Un rango inválido (desde > hasta) responde 400 (contrato 5)."""
    base = datetime.now(timezone.utc)
    desde = base.isoformat()
    hasta = (base - timedelta(hours=1)).isoformat()

    async with _cliente() as cliente:
        res = await cliente.get(
            "/pos/auditable-events", params={"desde": desde, "hasta": hasta}
        )

    assert res.status_code == 400


@pytest.mark.asyncio
async def test_endpoint_no_expone_tabla_tickets(entorno):
    """O-23: la salida es una PROYECCIÓN; no expone `id` ni `payload` crudo."""
    base = datetime.now(timezone.utc) - timedelta(hours=1)
    ticket_ids = await _sembrar(entorno, base)

    desde = (base - timedelta(minutes=1)).isoformat()
    hasta = (base + timedelta(minutes=10)).isoformat()

    async with _cliente() as cliente:
        res = await cliente.get(
            "/pos/auditable-events", params={"desde": desde, "hasta": hasta}
        )

    propios = _solo_los_sembrados(res.json()["eventos"], ticket_ids)
    assert len(propios) == 3
    evento = propios[0]
    # La clave interna `id` NO se expone (la frontera A-02 / O-23 se respeta).
    assert "id" not in evento
    # El `payload` crudo NO se expone como campo de primer nivel.
    assert "payload" not in evento


@pytest.mark.asyncio
async def test_endpoint_ordena_por_timestamp(entorno):
    """Los eventos llegan ordenados por `timestamp` ascendente."""
    base = datetime.now(timezone.utc) - timedelta(hours=1)
    ticket_ids = await _sembrar(entorno, base)

    desde = (base - timedelta(minutes=1)).isoformat()
    hasta = (base + timedelta(minutes=10)).isoformat()

    async with _cliente() as cliente:
        res = await cliente.get(
            "/pos/auditable-events", params={"desde": desde, "hasta": hasta}
        )

    propios = _solo_los_sembrados(res.json()["eventos"], ticket_ids)
    assert len(propios) == 3
    timestamps = [e["timestamp"] for e in propios]
    assert timestamps == sorted(timestamps)
