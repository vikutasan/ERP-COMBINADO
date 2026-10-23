"""Puerta de FASE 13.0 — Log de auditoría (`pos_audit_log`).

Verifica los criterios de la puerta (Plan de Abordaje F13 §4, sub-fase 13.0):

  ✓ test_tabla_pos_audit_log_existe            (el hueco real: había reglas sin tabla)
  ✓ test_migracion_encadenada_a_0003           (la cadena de Alembic no se rompe)
  ✓ test_rn75_la_escritura_se_persiste         (RN-75 contra PostgreSQL real)
  ✓ test_rn76_el_registro_tiene_contenido      (RN-76: endpoint, payload, código, extras)
  ✓ test_rn77_consulta_por_terminal_y_rango    (RN-77: filtro por terminal + rango)
  ✓ test_rn78_el_timestamp_es_utc              (RN-78: tzinfo obligatorio)
  ✓ test_guardian_registra_en_la_transaccion   (el guardián escribe el asiento)
  ✓ test_guardian_hace_rollback_si_falla       (no se audita una escritura que no ocurrió)
  ✓ test_guardian_exige_terminal               (RN-77: sin terminal no hay asiento)

La evidencia es la PERSISTENCIA real contra PostgreSQL, no la intención. Se
insertan asientos en `pos_audit_log`, se consultan por terminal y rango, y se
limpia al terminar.

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al
loop de ese test), igual que `test_f3_atomico.py`, para evitar el error
"Future attached to a different loop".
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, inspect, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.database import DATABASE_URL
from guards import AsientoAuditoria, LogDeAuditoria, SinTerminalEnAuditoria
from models import PosAuditLog
from rules import ReglaViolada
from rules import registry as R

TERMINAL_ID = "TEST-F13"


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
    """Engine por test, con limpieza de los asientos de prueba al terminar."""
    ent = _Entorno()
    try:
        yield ent
    finally:
        async with ent.Session() as db:
            await db.execute(
                delete(PosAuditLog).where(PosAuditLog.terminal_id == TERMINAL_ID)
            )
            await db.commit()
        await ent.cerrar()


# ---------------------------------------------------------------------------
# Criterio 1 — la tabla existe (el hueco real de la Fase 13)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tabla_pos_audit_log_existe(entorno):
    """`pos_audit_log` existe en PostgreSQL con sus 8 columnas (F13.0)."""
    async with entorno.engine.connect() as conn:
        columnas = await conn.run_sync(
            lambda sync_conn: {
                c["name"] for c in inspect(sync_conn).get_columns("pos_audit_log")
            }
        )
    assert columnas == {
        "id",
        "endpoint",
        "payload",
        "codigo",
        "terminal_id",
        "usuario_id",
        "extras",
        "timestamp",
    }


@pytest.mark.asyncio
async def test_migracion_encadenada_a_0003(entorno):
    """La migración 0004 cuelga de 0003 (la cadena de Alembic no se rompe)."""
    from migrations.versions import (
        __name__ as _paquete,  # noqa: F401  (asegura que el paquete es importable)
    )

    import importlib

    m0004 = importlib.import_module("migrations.versions.0004_pos_audit_log")
    assert m0004.revision == "0004_pos_audit_log"
    assert m0004.down_revision == "0003_ticket_traceability"


# ---------------------------------------------------------------------------
# Criterio 2 — RN-75/76/77 contra PostgreSQL real
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_rn75_la_escritura_se_persiste(entorno):
    """RN-75: cada escritura POS se registra y queda persistida."""
    async with entorno.Session() as db:
        db.add(
            PosAuditLog(
                endpoint="POST /pos/tickets",
                payload={"total": "10.00"},
                codigo=201,
                terminal_id=TERMINAL_ID,
                usuario_id="u-1",
                extras={"ticket_id": str(uuid.uuid4())},
            )
        )
        await db.commit()

        filas = (
            await db.execute(
                select(PosAuditLog).where(PosAuditLog.terminal_id == TERMINAL_ID)
            )
        ).scalars().all()

    assert len(filas) == 1
    assert filas[0].endpoint == "POST /pos/tickets"
    assert filas[0].codigo == 201


@pytest.mark.asyncio
async def test_rn76_el_registro_tiene_contenido(entorno):
    """RN-76: el registro incluye endpoint, payload, código y extras."""
    contenido = R.rn76_contenido_del_registro(
        "POST /pos/tickets", {"a": 1}, 201, {"terminal": TERMINAL_ID}
    )
    assert contenido["endpoint"] == "POST /pos/tickets"
    assert contenido["payload"] == {"a": 1}
    assert contenido["codigo"] == 201
    assert contenido["extras"]["terminal"] == TERMINAL_ID

    # Y el contenido se persiste tal cual en la tabla.
    async with entorno.Session() as db:
        db.add(
            PosAuditLog(
                endpoint=contenido["endpoint"],
                payload=contenido["payload"],
                codigo=contenido["codigo"],
                terminal_id=TERMINAL_ID,
                extras=contenido["extras"],
            )
        )
        await db.commit()
        fila = (
            await db.execute(
                select(PosAuditLog).where(PosAuditLog.terminal_id == TERMINAL_ID)
            )
        ).scalars().one()

    assert fila.payload == {"a": 1}
    assert fila.extras["terminal"] == TERMINAL_ID


@pytest.mark.asyncio
async def test_rn77_consulta_por_terminal_y_rango(entorno):
    """RN-77: la auditoría se consulta por terminal y rango de fechas."""
    t0 = datetime(2026, 10, 6, 10, 0, tzinfo=timezone.utc)
    async with entorno.Session() as db:
        db.add_all(
            [
                PosAuditLog(
                    endpoint="POST /pos/tickets",
                    payload={},
                    codigo=201,
                    terminal_id=TERMINAL_ID,
                    timestamp=t0,
                ),
                PosAuditLog(
                    endpoint="POST /pos/tickets",
                    payload={},
                    codigo=201,
                    terminal_id="OTRA-TERMINAL",
                    timestamp=t0,
                ),
                PosAuditLog(
                    endpoint="POST /pos/tickets",
                    payload={},
                    codigo=201,
                    terminal_id=TERMINAL_ID,
                    timestamp=t0 + timedelta(days=5),
                ),
            ]
        )
        await db.commit()

        desde = t0 - timedelta(hours=1)
        hasta = t0 + timedelta(hours=1)
        filas = (
            await db.execute(
                select(PosAuditLog).where(
                    PosAuditLog.terminal_id == TERMINAL_ID,
                    PosAuditLog.timestamp >= desde,
                    PosAuditLog.timestamp <= hasta,
                )
            )
        ).scalars().all()

    # Solo el asiento de TEST-F13 dentro del rango (ni el de otra terminal,
    # ni el que cae 5 días después).
    assert len(filas) == 1
    assert filas[0].terminal_id == TERMINAL_ID


def test_rn78_el_timestamp_es_utc():
    """RN-78: un timestamp naive se rechaza; uno con tzinfo se normaliza a UTC."""
    with pytest.raises(ReglaViolada):
        R.rn78_timestamps_en_utc(datetime(2026, 10, 6, 10, 0))

    con_tz = datetime(2026, 10, 6, 10, 0, tzinfo=timezone.utc)
    assert R.rn78_timestamps_en_utc(con_tz) == con_tz


# ---------------------------------------------------------------------------
# Criterio 3 — el guardián (misma transacción, rollback, terminal obligatoria)
# ---------------------------------------------------------------------------

def test_guardian_registra_en_la_transaccion():
    """El guardián encola el asiento y lo confirma al cerrar sin excepción."""
    with LogDeAuditoria() as log:
        asiento = log.registrar(
            "POST /pos/tickets", {"total": "10.00"}, 201, TERMINAL_ID, usuario_id="u-1"
        )
        assert isinstance(asiento, AsientoAuditoria)
        assert asiento.terminal_id == TERMINAL_ID
        assert asiento.timestamp.tzinfo is not None

    assert log.confirmado is True
    assert len(log.asientos) == 1


def test_guardian_hace_rollback_si_falla():
    """Si la escritura falla, el asiento NO se persiste (no se audita lo que no ocurrió)."""
    log = LogDeAuditoria()
    with pytest.raises(RuntimeError):
        with log:
            log.registrar("POST /pos/tickets", {}, 201, TERMINAL_ID)
            raise RuntimeError("la escritura falló")

    assert log.confirmado is False
    assert log.asientos == []


def test_guardian_exige_terminal():
    """RN-77: sin terminal no hay asiento consultable."""
    with LogDeAuditoria() as log:
        with pytest.raises(SinTerminalEnAuditoria):
            log.registrar("POST /pos/tickets", {}, 201, "")

    assert log.asientos == []
