"""Puerta de FASE 10.6.2 — Eliminar movimiento de caja (contrato 29).

Paridad de operación del Gestor de Caja: el viejo POS permitía borrar un
movimiento mal capturado mientras el turno seguía abierto. El nuevo POS lo
recupera con el contrato 29 (`caja.eliminar_movimiento`).

La evidencia es la RESPUESTA HTTP real y el EFECTO observable en el resumen
del turno, no la intención.

  ✓ test_contrato_29_declarado                (frontera A-02)
  ✓ test_eliminar_movimiento_abierto          (RN-52 → 200 y sale del resumen)
  ✓ test_eliminar_movimiento_inexistente_404  (movement_id desconocido)
  ✓ test_eliminar_movimiento_caja_cerrada_400 (RN-52 → 400)

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al
loop de ese test) y sobreescribe la dependencia `get_db` de FastAPI, igual que
las puertas de FASE 3.2, 4.0 y 4.1.
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
from models import CashMovement, CashSession, Product, TerminalSession, Ticket, TicketItem

TERMINAL_ID = "TEST-F1062"


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
        await db.execute(delete(Product).where(Product.sku.like("TEST-F1062-%")))
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
# Criterio 1 — Frontera A-02: el contrato 29 está declarado
# ---------------------------------------------------------------------------

def test_contrato_29_declarado():
    """El contrato 29 `caja.eliminar_movimiento` existe y lo provee Caja."""
    nombres = [c.nombre for c in CONTRATOS]
    assert "caja.eliminar_movimiento" in nombres, nombres
    contrato = next(c for c in CONTRATOS if c.nombre == "caja.eliminar_movimiento")
    assert contrato.proveedor == "Caja", contrato.proveedor
    assert contrato.consumidor == "POS", contrato.consumidor


# ---------------------------------------------------------------------------
# Criterio 2 — Eliminar un movimiento con la caja ABIERTA (RN-52)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_eliminar_movimiento_abierto(entorno):
    """Con la caja abierta, borrar un movimiento es 200 y sale del resumen."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            abierto = await _abrir_turno(cliente, fondo="100.00")
            caja_id = abierto["cash_session_id"]

            entrada_id = await _registrar_movimiento(
                cliente, caja_id, "ENTRADA", "200.00", "Refuerzo"
            )
            await _registrar_movimiento(cliente, caja_id, "SALIDA", "30.00", "Hielo")

            # Antes de borrar: 100 + 200 − 30 = 270.00 y 2 movimientos.
            res = await cliente.get(f"/cash/session-summary/{caja_id}")
            assert res.status_code == 200, res.text
            antes = res.json()
            assert Decimal(antes["esperado"]) == Decimal("270.00"), antes
            assert len(antes["movimientos"]) == 2

            # RN-52: con la caja abierta, el borrado procede.
            res = await cliente.delete(f"/cash/movements/{entrada_id}")
            assert res.status_code == 200, res.text
            assert res.json()["eliminado"] is True

            # Después de borrar: 100 − 30 = 70.00 y 1 movimiento.
            res = await cliente.get(f"/cash/session-summary/{caja_id}")
            assert res.status_code == 200, res.text
            despues = res.json()
            assert Decimal(despues["esperado"]) == Decimal("70.00"), despues
            assert len(despues["movimientos"]) == 1
            assert despues["movimientos"][0]["tipo"] == "SALIDA"
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 3 — Un movimiento inexistente es 404
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_eliminar_movimiento_inexistente_404(entorno):
    """Borrar un movement_id que no existe responde 404."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            await _abrir_turno(cliente)
            res = await cliente.delete(f"/cash/movements/{uuid.uuid4()}")
            assert res.status_code == 404, res.text
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 4 — Con la caja CERRADA no se puede borrar (RN-52)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_eliminar_movimiento_caja_cerrada_400(entorno):
    """RN-52: con la caja cerrada, borrar un movimiento es 400."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            abierto = await _abrir_turno(cliente, fondo="100.00")
            caja_id = abierto["cash_session_id"]

            movimiento_id = await _registrar_movimiento(
                cliente, caja_id, "ENTRADA", "50.00", "Refuerzo"
            )

            # Cerrar el turno (contrato 13).
            res = await cliente.post(
                "/cash/close-session",
                json={
                    "cash_session_id": caja_id,
                    "montos_fisicos": "150.00",
                    "credito": "0.00",
                    "debito": "0.00",
                },
            )
            assert res.status_code == 200, res.text

            # RN-52: la caja ya está cerrada → 400.
            res = await cliente.delete(f"/cash/movements/{movimiento_id}")
            assert res.status_code == 400, res.text
    finally:
        await _limpiar(ent)
