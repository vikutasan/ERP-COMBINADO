"""Puerta de la corrección — FICHA_FIX_TURNO_CAJA_USUARIO_ID (7 Oct 2026).

EL BUG (reportado por el dueño): "quise abrir turno de caja o habilitar caja y
no pude". El POS no podía abrir el turno.

LA CAUSA (dos defectos en serie):

  Defecto A (frontend) — `RetailVisionPOS.jsx` pasaba
  `usuarioId={sesion?.employee_id || null}`, pero `SesionActiva` (contrato 9) y
  la tabla `terminal_sessions` NUNCA tienen `employee_id`. El valor era SIEMPRE
  `null`.

  Defecto B (contrato) — `AbrirTurnoEntrada.usuario_id` se declaraba `UUID`
  (obligatorio). El ERP autentica al cajero con un id NUMÉRICO
  (`currentUser.id = 1`), así que Pydantic v2 rechazaba la petición con 422
  (`uuid_type`). Es la MISMA clase de bug que F7.7c.

LA CORRECCIÓN:

  - El frontend deriva la identidad del operador de `currentUser.id` (el usuario
    autenticado por el ERP), no de la sesión de terminal.
  - El contrato 10 acepta `UUID | String | Int` y normaliza el id a un UUID
    DETERMINISTA (uuid5) en la frontera. El mismo id del ERP produce SIEMPRE el
    mismo UUID (identidad estable entre turnos, cortes y reportes).

Esta puerta verifica la RESPUESTA HTTP real y la fila persistida, no la
intención. Aislamiento de event loop: engine propio por test, igual que las
puertas de FASE 3.2, 4.0, 4.1 y 10.5.
"""

from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.database import DATABASE_URL, get_db
from main import app
from models import CashMovement, CashSession, TerminalSession
from schemas import ESPACIO_IDS_ERP, AbrirTurnoEntrada

TERMINAL_ID = "TEST-FIXTURNO"


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


async def _limpiar(ent: _Entorno) -> None:
    """Borra los datos de prueba (movimientos, caja, sesión de terminal)."""
    async with ent.Session() as db:
        await db.execute(
            delete(CashMovement).where(
                CashMovement.cash_session_id.in_(
                    select(CashSession.id).where(CashSession.terminal_id == TERMINAL_ID)
                )
            )
        )
        await db.execute(delete(CashSession).where(CashSession.terminal_id == TERMINAL_ID))
        await db.execute(
            delete(TerminalSession).where(TerminalSession.terminal_id == TERMINAL_ID)
        )
        await db.commit()


def _cliente() -> httpx.AsyncClient:
    """Cliente HTTP async contra la app ASGI (sin red real)."""
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


# ---------------------------------------------------------------------------
# Defecto B — El contrato acepta el id NUMÉRICO del ERP (no solo UUID)
# ---------------------------------------------------------------------------

def test_el_esquema_acepta_un_id_numerico_del_erp():
    """`usuario_id: 1` (id numérico del ERP) NO debe lanzar 422.

    Antes, `usuario_id: UUID` hacía que Pydantic v2 rechazara el entero con
    `uuid_type`. Ahora el validador lo normaliza a un UUID determinista.
    """
    entrada = AbrirTurnoEntrada(
        terminal_id=TERMINAL_ID,
        usuario_id=1,
        monto_inicial="100.00",
    )
    assert isinstance(entrada.usuario_id, uuid.UUID)


def test_el_id_numerico_mapea_a_un_uuid_determinista():
    """El MISMO id del ERP produce SIEMPRE el MISMO UUID (identidad estable)."""
    esperado = uuid.uuid5(ESPACIO_IDS_ERP, "1")
    a = AbrirTurnoEntrada(terminal_id=TERMINAL_ID, usuario_id=1, monto_inicial="0")
    b = AbrirTurnoEntrada(terminal_id=TERMINAL_ID, usuario_id="1", monto_inicial="0")
    assert a.usuario_id == esperado
    assert b.usuario_id == esperado
    assert a.usuario_id == b.usuario_id


def test_un_uuid_real_pasa_intacto():
    """Un consumidor que ya envía un UUID real NO se ve afectado."""
    real = uuid.uuid4()
    entrada = AbrirTurnoEntrada(
        terminal_id=TERMINAL_ID, usuario_id=real, monto_inicial="0"
    )
    assert entrada.usuario_id == real

    como_texto = AbrirTurnoEntrada(
        terminal_id=TERMINAL_ID, usuario_id=str(real), monto_inicial="0"
    )
    assert como_texto.usuario_id == real


# ---------------------------------------------------------------------------
# El bug de punta a punta — abrir el turno con el id numérico del ERP
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_abrir_turno_con_id_numerico_del_erp(entorno):
    """POST /cash/open-session con `usuario_id: 1` responde 201 y persiste.

    Es el escenario EXACTO del bug: el ERP manda el id numérico del cajero.
    """
    await _limpiar(entorno)
    try:
        async with _cliente() as cliente:
            res = await cliente.post(
                "/cash/open-session",
                json={
                    "terminal_id": TERMINAL_ID,
                    "usuario_id": 1,
                    "monto_inicial": "100.00",
                    "usuario_nombre": "Victor",
                },
            )
        assert res.status_code == 201, res.text
        caja_id = res.json()["cash_session_id"]

        async with entorno.Session() as db:
            fila = (
                await db.execute(
                    select(CashSession).where(CashSession.id == uuid.UUID(caja_id))
                )
            ).scalar_one()
            # El id numérico se persistió como el UUID determinista esperado.
            assert fila.employee_id == uuid.uuid5(ESPACIO_IDS_ERP, "1")
            assert fila.employee_name == "Victor"
            assert fila.status == "OPEN"
    finally:
        await _limpiar(entorno)


@pytest.mark.asyncio
async def test_el_id_numerico_es_estable_entre_turnos(entorno):
    """Dos turnos abiertos con el mismo id del ERP comparten `employee_id`.

    Garantiza la trazabilidad: el corte y el reporte diario agrupan por cajero
    con un identificador estable, aunque el ERP solo dé un número.
    """
    await _limpiar(entorno)
    try:
        async with _cliente() as cliente:
            primero = await cliente.post(
                "/cash/open-session",
                json={"terminal_id": TERMINAL_ID, "usuario_id": 7, "monto_inicial": "50.00"},
            )
            assert primero.status_code == 201, primero.text
            # Cierra el primero para poder abrir el segundo (RN-49).
            cierre = await cliente.post(
                "/cash/close-session",
                json={
                    "cash_session_id": primero.json()["cash_session_id"],
                    "montos_fisicos": "50.00",
                    "credito": "0.00",
                    "debito": "0.00",
                },
            )
            assert cierre.status_code == 200, cierre.text
            segundo = await cliente.post(
                "/cash/open-session",
                json={"terminal_id": TERMINAL_ID, "usuario_id": 7, "monto_inicial": "50.00"},
            )
            assert segundo.status_code == 201, segundo.text

        async with entorno.Session() as db:
            filas = (
                await db.execute(
                    select(CashSession).where(CashSession.terminal_id == TERMINAL_ID)
                )
            ).scalars().all()
            assert len(filas) == 2
            assert filas[0].employee_id == filas[1].employee_id
            assert filas[0].employee_id == uuid.uuid5(ESPACIO_IDS_ERP, "7")
    finally:
        await _limpiar(entorno)
