"""Puerta de FASE 10.6.3 — Hora y concepto del movimiento (contrato 12).

Paridad de operación del Gestor de Caja: el viejo POS mostraba, por cada
movimiento, su CONCEPTO y su HORA. El nuevo POS solo mostraba tipo y monto, así
que el cajero no podía saber qué se movió ni cuándo. El resumen del turno
(contrato 12) ahora expone `motivo` y `creado_en` por movimiento.

La evidencia es la RESPUESTA HTTP real, no la intención.

  ✓ test_movimiento_expone_motivo_y_hora   (motivo + creado_en en el resumen)
  ✓ test_hora_del_movimiento_es_utc        (RN-78: la hora viaja en UTC)

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al
loop de ese test) y sobreescribe la dependencia `get_db` de FastAPI, igual que
las puertas de FASE 3.2, 4.0, 4.1 y 10.6.2.
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
from models import CashMovement, CashSession, Product, TerminalSession, Ticket, TicketItem

TERMINAL_ID = "TEST-F1063"


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
        await db.execute(delete(Product).where(Product.sku.like("TEST-F1063-%")))
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


async def _registrar_movimiento(
    cliente: httpx.AsyncClient, caja_id: str, tipo: str, monto: str, motivo: str
) -> str:
    """Registra un movimiento vía el contrato 11. Devuelve su movement_id."""
    res = await cliente.post(
        "/cash/movements",
        json={
            "cash_session_id": caja_id,
            "tipo": tipo,
            "monto": monto,
            "motivo": motivo,
        },
    )
    assert res.status_code == 201, res.text
    return res.json()["movement_id"]


# ---------------------------------------------------------------------------
# Criterio 1 — El resumen expone motivo y hora por movimiento
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_movimiento_expone_motivo_y_hora(entorno):
    """Cada movimiento del resumen trae su `motivo` y su `creado_en`."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            abierto = await _abrir_turno(cliente, fondo="100.00")
            caja_id = abierto["cash_session_id"]

            await _registrar_movimiento(cliente, caja_id, "ENTRADA", "200.00", "Refuerzo de cambio")
            await _registrar_movimiento(cliente, caja_id, "SALIDA", "30.00", "Compra de hielo")

            res = await cliente.get(f"/cash/session-summary/{caja_id}")
            assert res.status_code == 200, res.text
            movimientos = res.json()["movimientos"]
            assert len(movimientos) == 2, movimientos

            # El concepto viaja en `motivo` (no el tipo crudo).
            motivos = {m["motivo"] for m in movimientos}
            assert motivos == {"Refuerzo de cambio", "Compra de hielo"}, motivos

            # La hora viaja en `creado_en` y es un instante ISO parseable.
            for m in movimientos:
                assert m.get("creado_en"), m
                datetime.fromisoformat(m["creado_en"].replace("Z", "+00:00"))
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 2 — La hora del movimiento viaja en UTC (RN-78)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_hora_del_movimiento_es_utc(entorno):
    """`creado_en` es un instante UTC cercano al momento de la prueba (RN-78)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            abierto = await _abrir_turno(cliente, fondo="100.00")
            caja_id = abierto["cash_session_id"]

            await _registrar_movimiento(cliente, caja_id, "ENTRADA", "50.00", "Propina")

            res = await cliente.get(f"/cash/session-summary/{caja_id}")
            assert res.status_code == 200, res.text
            creado_en = res.json()["movimientos"][0]["creado_en"]

            instante = datetime.fromisoformat(creado_en.replace("Z", "+00:00"))
            assert instante.tzinfo is not None, creado_en

            # El instante debe ser UTC y estar a menos de 5 minutos de "ahora".
            ahora = datetime.now(timezone.utc)
            delta = abs((ahora - instante.astimezone(timezone.utc)).total_seconds())
            assert delta < 300, (creado_en, delta)
    finally:
        await _limpiar(ent)
