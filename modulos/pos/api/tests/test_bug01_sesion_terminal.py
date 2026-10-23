"""Puerta de BUG-01 — La sesión de terminal se abre al seleccionar la terminal.

CONTEXTO — por qué existe esta puerta
─────────────────────────────────────
El viejo POS abre la `TerminalSession` al seleccionar la terminal
(`POST /pos/sessions`). El nuevo POS tomaba el candado pero NUNCA creaba la
sesión, así que cualquier terminal distinta de la que ya tenía una sesión
fallaba con RN-24 al primer ticket ("La sesión de la terminal no está activa").

La corrección (Opción A, paridad con el viejo POS) añade un endpoint
IDEMPOTENTE `POST /pos/sessions` que crea la sesión si no existe o devuelve la
existente. El frontend lo llama desde `useTerminals.selectTerminal` tras el
lock.

Criterios verificados:
  ✓ test_abrir_sesion_crea_si_no_existe        (201 + fila nueva activa)
  ✓ test_abrir_sesion_es_idempotente           (2ª llamada devuelve la MISMA fila)
  ✓ test_abrir_sesion_no_reabre_cerrada        (una cerrada no se reutiliza)
  ✓ test_tras_abrir_sesion_el_ticket_ya_no_da_rn24 (el flujo de BUG-01 completo)
  ✓ test_abrir_sesion_terminal_vacio_400       (terminal_id vacío es 400)

La evidencia es la RESPUESTA HTTP real contra la app FastAPI montada sobre
PostgreSQL, no la intención.

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al
loop de ese test) y sobreescribe la dependencia `get_db` de FastAPI.
"""

from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.database import DATABASE_URL, get_db
from main import app
from models import TerminalSession, Ticket, TicketItem

TERMINAL_ID = "TEST-BUG01"


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
# Utilidades de limpieza y consulta (usan el engine del test)
# ---------------------------------------------------------------------------

async def _limpiar(ent: _Entorno) -> None:
    """Borra los datos de prueba (tickets, ítems y sesiones de la terminal)."""
    async with ent.Session() as db:
        await db.execute(
            delete(TicketItem).where(
                TicketItem.ticket_id.in_(select(Ticket.id).where(Ticket.terminal_id == TERMINAL_ID))
            )
        )
        await db.execute(delete(Ticket).where(Ticket.terminal_id == TERMINAL_ID))
        await db.execute(
            delete(TerminalSession).where(TerminalSession.terminal_id == TERMINAL_ID)
        )
        await db.commit()


async def _sesiones(ent: _Entorno) -> list[TerminalSession]:
    """Lee todas las sesiones de la terminal de prueba."""
    async with ent.Session() as db:
        filas = (
            await db.execute(
                select(TerminalSession).where(TerminalSession.terminal_id == TERMINAL_ID)
            )
        ).scalars().all()
        return list(filas)


def _cliente() -> httpx.AsyncClient:
    """Cliente HTTP async contra la app ASGI (sin red real)."""
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def _abrir_sesion(cliente: httpx.AsyncClient, terminal_id: str = TERMINAL_ID) -> httpx.Response:
    """Llama al endpoint idempotente de apertura de sesión."""
    return await cliente.post("/pos/sessions", json={"terminal_id": terminal_id})


# ---------------------------------------------------------------------------
# Criterio 1 — Crea la sesión si no existe
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_abrir_sesion_crea_si_no_existe(entorno):
    """Sin sesión previa, `POST /pos/sessions` responde 201 y crea una activa."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            res = await _abrir_sesion(cliente)

        assert res.status_code == 201, res.text
        cuerpo = res.json()
        assert cuerpo["terminal_id"] == TERMINAL_ID, cuerpo
        assert cuerpo["is_active"] is True, cuerpo
        assert cuerpo["id"], cuerpo

        filas = await _sesiones(ent)
        assert len(filas) == 1, filas
        assert filas[0].is_active is True
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 2 — Es idempotente (no duplica la sesión activa)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_abrir_sesion_es_idempotente(entorno):
    """Dos llamadas seguidas devuelven la MISMA fila (RN-01: una activa)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            primera = await _abrir_sesion(cliente)
            segunda = await _abrir_sesion(cliente)

        assert primera.status_code == 201, primera.text
        assert segunda.status_code == 201, segunda.text
        assert primera.json()["id"] == segunda.json()["id"], (
            "El endpoint NO es idempotente: creó dos sesiones distintas"
        )

        filas = await _sesiones(ent)
        assert len(filas) == 1, f"Se esperaba 1 sesión, hay {len(filas)}"
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 3 — No reabre una sesión cerrada (crea una nueva)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_abrir_sesion_no_reabre_cerrada(entorno):
    """Una sesión cerrada NO se reutiliza: se crea una fila nueva (histórico)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        # Sembramos una sesión CERRADA (is_active=False).
        async with ent.Session() as db:
            db.add(TerminalSession(terminal_id=TERMINAL_ID, is_active=False))
            await db.commit()

        async with _cliente() as cliente:
            res = await _abrir_sesion(cliente)

        assert res.status_code == 201, res.text
        assert res.json()["is_active"] is True, res.json()

        filas = await _sesiones(ent)
        assert len(filas) == 2, f"Se esperaban 2 filas (cerrada + nueva), hay {len(filas)}"
        activas = [f for f in filas if f.is_active]
        assert len(activas) == 1, "Debe haber exactamente UNA sesión activa"
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 4 — El flujo de BUG-01: tras abrir, el ticket ya no da RN-24
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tras_abrir_sesion_el_ticket_ya_no_da_rn24(entorno):
    """Reproduce BUG-01: sin sesión el ticket da 400; tras abrirla, 201."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            # 1) Sin sesión: crear un ticket falla con RN-24 (400).
            sin_sesion = await cliente.post(
                "/pos/tickets",
                json={"terminal_id": TERMINAL_ID, "channel": "PANADERIA", "items": []},
            )
            assert sin_sesion.status_code == 400, sin_sesion.text
            assert "RN-24" in sin_sesion.text or "sesión" in sin_sesion.text.lower(), sin_sesion.text

            # 2) Abrimos la sesión (lo que hace el frontend al seleccionar).
            abrir = await _abrir_sesion(cliente)
            assert abrir.status_code == 201, abrir.text

            # 3) Ahora el mismo ticket SÍ se crea (201).
            con_sesion = await cliente.post(
                "/pos/tickets",
                json={"terminal_id": TERMINAL_ID, "channel": "PANADERIA", "items": []},
            )
            assert con_sesion.status_code == 201, con_sesion.text
            assert con_sesion.json()["status"] == "OPEN", con_sesion.json()
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 5 — Un terminal_id vacío es 400 (no crea basura)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_abrir_sesion_terminal_vacio_400(entorno):
    """Un `terminal_id` en blanco responde 400 y NO crea ninguna sesión."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            res = await _abrir_sesion(cliente, terminal_id="   ")

        assert res.status_code == 400, res.text
        filas = await _sesiones(ent)
        assert filas == [], f"No debía crearse ninguna sesión, hay {len(filas)}"
    finally:
        await _limpiar(ent)
