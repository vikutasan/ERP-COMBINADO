"""Puerta de FASE 7.7 — Router de terminales (el hueco de la Fase 1).

La Fase 1 (Selector de Terminales) se construyó SOLO en el frontend: existían
el modelo `TerminalLock`, las reglas RN-03..RN-07 y el hook `useTerminals`,
pero nunca se escribió la puerta HTTP. El selector recibía 404 en cada llamada
y ninguna terminal abría. Esta puerta blinda el router que cierra ese hueco.

Cubre DOS contratos que conviven:

  Fase 1 — `terminalService.js` (el selector / landing):
    GET  /pos/terminals/status
    POST /pos/terminals/lock      (body: terminal_id, user_id)
    POST /pos/terminals/unlock    (body: terminal_id, user_id)
    GET  /pos/terminals/config
    POST /pos/terminals/config    (body: terminals)

  Fase 3.4 — `client.js` (heartbeat OMEGA, dentro del POS):
    POST /pos/terminals/{id}/lock       (body: usuario_id)
    POST /pos/terminals/{id}/unlock     (body: usuario_id)
    POST /pos/terminals/{id}/heartbeat  (body: usuario_id)

Reglas verificadas: RN-03 (exclusivo), RN-04 (TTL), RN-05 (solo el dueño),
RN-06 (admin fuerza), RN-07 (heartbeat renueva).
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
from models import CashMovement, CashSession, Order, TerminalLock, Ticket, TicketItem

# ---------------------------------------------------------------------------
# Entorno de prueba (mismo patrón que las puertas F4/F5).
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


@pytest.fixture(autouse=True)
def aislar_config_terminales():
    """Aísla `terminal_config.json` entre tests (autouse).

    La config de terminales se persiste en un ARCHIVO real junto al API, no en
    la BD. Los tests que la escriben (`POST /config`) contaminaban a los demás:
    un test dejaba 2 terminales en el archivo y los siguientes fallaban con
    `KeyError` al buscar `TERM-03`, etc. Este fixture guarda el archivo
    antes de cada test y lo RESTAURA al terminar, sin importar el orden de
    ejecución. Si el archivo no existía, lo elimina al final.
    """
    from routers.terminals import _RUTA_CONFIG

    existia = _RUTA_CONFIG.exists()
    respaldo = _RUTA_CONFIG.read_text(encoding="utf-8") if existia else None
    try:
        yield
    finally:
        if existia and respaldo is not None:
            _RUTA_CONFIG.write_text(respaldo, encoding="utf-8")
        elif _RUTA_CONFIG.exists():
            _RUTA_CONFIG.unlink()


async def _limpiar(ent: _Entorno) -> None:
    """Borra los datos de prueba (deja las tablas limpias).

    FICHA_FIX_PIZARRON_422 (7 Oct 2026) — el orden importa: `tickets` referencia
    `cash_sessions` (FK `fk_tickets_cash_session_id_cash_sessions`). Si se borra
    la sesión de caja ANTES que los tickets que la referencian, PostgreSQL lanza
    `ForeignKeyViolationError` y TODA la puerta falla. Por eso se borran primero
    los `ticket_items`, luego los `tickets`, y al final las sesiones de caja.

    FICHA_F12_21 (8 Oct 2026) — se añade `orders` AL PRINCIPIO. Un ticket que fue
    programado como PEDIDO queda proyectado en `orders` (contrato 15) con FK
    `fk_orders_ticket_id_tickets`. Si otra puerta (p. ej. F12.20) dejó una fila
    en `orders`, el `DELETE FROM tickets` de esta limpieza viola la FK y las 28
    pruebas de terminales fallan en cascada. Borrar `orders` antes que `tickets`
    hace la limpieza robusta ante datos residuales de cualquier otra puerta.

    FICHA_BUG17 (14 Oct 2026) — se añade `cash_movements` ANTES de `cash_sessions`.
    Un movimiento de caja (entrada/salida) referencia su turno con FK
    `fk_cash_movements_cash_session_id_cash_sessions`. Si otra puerta de caja
    (p. ej. F10.6) dejó un movimiento residual, el `DELETE FROM cash_sessions`
    viola la FK y TODA la puerta de terminales falla en cascada. Borrar los
    movimientos antes que las sesiones hace la limpieza robusta.
    """
    async with ent.Session() as db:
        await db.execute(delete(TerminalLock))
        await db.execute(delete(Order))
        await db.execute(delete(TicketItem))
        await db.execute(delete(Ticket))
        await db.execute(delete(CashMovement))
        await db.execute(delete(CashSession))
        await db.commit()


async def _sembrar_turno_abierto(
    ent: _Entorno,
    terminal_id: str,
    *,
    estado: str = "OPEN",
) -> uuid.UUID:
    """Inserta un turno de caja directamente en la BD. Devuelve su id.

    `estado` permite simular un turno ya cerrado (`CLOSED`) para verificar que
    el status solo marca `caja_habilitada` cuando el turno está ABIERTO (RN-49).
    """
    sesion_id = uuid.uuid4()
    async with ent.Session() as db:
        db.add(
            CashSession(
                id=sesion_id,
                terminal_id=terminal_id,
                employee_id=uuid.uuid5(uuid.NAMESPACE_URL, "pos-usuario:1"),
                employee_name="Cajero de prueba",
                opening_float=0,
                status=estado,
            )
        )
        await db.commit()
    return sesion_id


async def _sembrar_candado(
    ent: _Entorno,
    terminal_id: str,
    usuario_id: str,
    *,
    edad_minutos: int = 0,
) -> uuid.UUID:
    """Inserta un candado directamente en la BD. Devuelve el occupier_id.

    `edad_minutos` permite simular un candado vencido (RN-04).
    """
    occupier = uuid.uuid5(uuid.NAMESPACE_URL, f"pos-usuario:{usuario_id}")
    instante = datetime.now(timezone.utc) - timedelta(minutes=edad_minutos)
    async with ent.Session() as db:
        db.add(
            TerminalLock(
                terminal_id=terminal_id,
                occupier_id=occupier,
                occupier_name=str(usuario_id),
                locked_at=instante,
            )
        )
        await db.commit()
    return occupier


def _cliente() -> httpx.AsyncClient:
    """Cliente HTTP en proceso (ASGI), sin red real."""
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


# ---------------------------------------------------------------------------
# Criterio 1 — El router existe y responde (el hueco de la Fase 1).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_criterio1_status_responde_200(entorno):
    """`GET /pos/terminals/status` responde 200 (antes: 404)."""
    await _limpiar(entorno)
    async with _cliente() as cliente:
        r = await cliente.get("/pos/terminals/status")
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), dict)


@pytest.mark.asyncio
async def test_criterio1_config_responde_200(entorno):
    """`GET /pos/terminals/config` responde 200 con `{terminals, orden}`."""
    await _limpiar(entorno)
    async with _cliente() as cliente:
        r = await cliente.get("/pos/terminals/config")
    assert r.status_code == 200, r.text
    datos = r.json()
    # FIX "el orden no se persiste" (10 Oct 2026): la respuesta es un OBJETO con
    # la lista de terminales y la preferencia de despliegue, no una lista suelta.
    assert isinstance(datos, dict)
    assert isinstance(datos["terminals"], list) and datos["terminals"]
    assert datos["orden"] in ("izq-der", "der-izq")
    assert {"id", "name", "icon"} <= set(datos["terminals"][0].keys())


# ---------------------------------------------------------------------------
# Criterio 2 — El status proyecta el mapa de ocupación que consume el frontend.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_criterio2_status_libre_tiene_occupier_none(entorno):
    """Una terminal sin candado aparece libre (occupier_id = None)."""
    await _limpiar(entorno)
    async with _cliente() as cliente:
        r = await cliente.get("/pos/terminals/status")
    estado = r.json()
    assert "TERM-01" in estado
    assert estado["TERM-01"]["occupier_id"] is None
    assert estado["TERM-01"]["stale_session"] is False


@pytest.mark.asyncio
async def test_criterio2_status_ocupada_expone_occupier(entorno):
    """Una terminal con candado vigente expone occupier_id y locked_at."""
    await _limpiar(entorno)
    await _sembrar_candado(entorno, "TERM-02", "7")
    async with _cliente() as cliente:
        r = await cliente.get("/pos/terminals/status")
    estado = r.json()
    assert estado["TERM-02"]["occupier_id"] is not None
    assert estado["TERM-02"]["occupier_name"] == "7"
    assert estado["TERM-02"]["locked_at"] is not None


@pytest.mark.asyncio
async def test_criterio2_status_expone_occupier_ref_original(entorno):
    """El status expone `occupier_ref` con el id ORIGINAL del usuario.

    Regresión del bloqueo de entrada: el frontend identifica al usuario con su
    id original (`1`, `cajero-1`), no con el UUID derivado. Si el status solo
    expone el UUID, el dueño no se reconoce a sí mismo y su propia terminal se
    pinta como "ocupada por otro" — impidiendo entrar.
    """
    await _limpiar(entorno)
    await _sembrar_candado(entorno, "TERM-03", "1")
    async with _cliente() as cliente:
        r = await cliente.get("/pos/terminals/status")
    estado = r.json()
    # El UUID canónico sigue presente (C-01)...
    assert estado["TERM-03"]["occupier_id"] != "1"
    # ...pero además se expone el id original para que el frontend compare.
    assert estado["TERM-03"]["occupier_ref"] == "1"


@pytest.mark.asyncio
async def test_criterio2_occupier_ref_es_none_si_libre(entorno):
    """Una terminal libre expone `occupier_ref` en None (no un UUID fantasma)."""
    await _limpiar(entorno)
    async with _cliente() as cliente:
        r = await cliente.get("/pos/terminals/status")
    estado = r.json()
    assert estado["TERM-01"]["occupier_ref"] is None


@pytest.mark.asyncio
async def test_criterio2_occupier_ref_sobrevive_al_lock(entorno):
    """Tras un lock real, `occupier_ref` devuelve el id que envió el cliente."""
    await _limpiar(entorno)
    async with _cliente() as cliente:
        await cliente.post(
            "/pos/terminals/lock", json={"terminal_id": "TERM-04", "user_id": "1"}
        )
        r = await cliente.get("/pos/terminals/status")
    estado = r.json()
    assert estado["TERM-04"]["occupier_ref"] == "1"
    assert estado["TERM-04"]["occupier_id"] != "1"


# ---------------------------------------------------------------------------
# Criterio 3 — RN-03: el candado es exclusivo (409 si está ocupada).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_criterio3_lock_ocupada_por_otro_da_409(entorno):
    """Tomar una terminal ocupada por otro responde 409 (RN-03)."""
    await _limpiar(entorno)
    await _sembrar_candado(entorno, "TERM-01", "7")
    async with _cliente() as cliente:
        r = await cliente.post(
            "/pos/terminals/lock", json={"terminal_id": "TERM-01", "user_id": "9"}
        )
    assert r.status_code == 409, r.text
    assert r.json().get("regla") == "RN-03"


@pytest.mark.asyncio
async def test_criterio3_lock_libre_da_200(entorno):
    """Tomar una terminal libre responde 200 y crea el candado."""
    await _limpiar(entorno)
    async with _cliente() as cliente:
        r = await cliente.post(
            "/pos/terminals/lock", json={"terminal_id": "TERM-03", "user_id": "7"}
        )
    assert r.status_code == 200, r.text
    assert r.json()["success"] is True
    async with _cliente() as cliente:
        estado = (await cliente.get("/pos/terminals/status")).json()
    assert estado["TERM-03"]["occupier_name"] == "7"


# ---------------------------------------------------------------------------
# Criterio 4 — RN-04: el candado vence por TTL y la terminal vuelve a estar libre.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_criterio4_candado_vencido_se_reporta_libre(entorno):
    """Un candado más viejo que el TTL se reporta como libre (RN-04)."""
    await _limpiar(entorno)
    await _sembrar_candado(entorno, "TERM-04", "7", edad_minutos=60)
    async with _cliente() as cliente:
        estado = (await cliente.get("/pos/terminals/status")).json()
    assert estado["TERM-04"]["occupier_id"] is None


@pytest.mark.asyncio
async def test_criterio4_candado_vencido_lo_toma_otro(entorno):
    """Un candado vencido puede ser tomado por otro usuario (RN-04)."""
    await _limpiar(entorno)
    await _sembrar_candado(entorno, "TERM-05", "7", edad_minutos=60)
    async with _cliente() as cliente:
        r = await cliente.post(
            "/pos/terminals/lock", json={"terminal_id": "TERM-05", "user_id": "9"}
        )
    assert r.status_code == 200, r.text
    async with _cliente() as cliente:
        estado = (await cliente.get("/pos/terminals/status")).json()
    assert estado["TERM-05"]["occupier_name"] == "9"


# ---------------------------------------------------------------------------
# Criterio 5 — RN-05 / RN-06: solo el dueño libera; un admin puede forzar.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_criterio5_no_dueno_no_libera_403(entorno):
    """Un usuario que no es dueño no puede liberar (RN-05, 403)."""
    await _limpiar(entorno)
    await _sembrar_candado(entorno, "TERM-01", "7")
    async with _cliente() as cliente:
        r = await cliente.post(
            "/pos/terminals/unlock", json={"terminal_id": "TERM-01", "user_id": "9"}
        )
    assert r.status_code == 403, r.text
    assert r.json().get("regla") == "RN-05"


@pytest.mark.asyncio
async def test_criterio5_dueno_libera_200(entorno):
    """El dueño del candado lo libera con 200 (RN-05)."""
    await _limpiar(entorno)
    await _sembrar_candado(entorno, "TERM-01", "7")
    async with _cliente() as cliente:
        r = await cliente.post(
            "/pos/terminals/unlock", json={"terminal_id": "TERM-01", "user_id": "7"}
        )
    assert r.status_code == 200, r.text
    async with _cliente() as cliente:
        estado = (await cliente.get("/pos/terminals/status")).json()
    assert estado["TERM-01"]["occupier_id"] is None


@pytest.mark.asyncio
async def test_criterio5_admin_fuerza_desbloqueo(entorno):
    """Un administrador puede forzar el desbloqueo (RN-06)."""
    await _limpiar(entorno)
    await _sembrar_candado(entorno, "TERM-01", "7")
    async with _cliente() as cliente:
        r = await cliente.post(
            "/pos/terminals/unlock", json={"terminal_id": "TERM-01", "user_id": "admin1"}
        )
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# Criterio 6 — RN-07: el heartbeat renueva el TTL del dueño.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_criterio6_heartbeat_del_dueno_renueva(entorno):
    """El dueño renueva su candado con el heartbeat (RN-07, 200)."""
    await _limpiar(entorno)
    await _sembrar_candado(entorno, "TERM-01", "7", edad_minutos=10)
    async with _cliente() as cliente:
        r = await cliente.post(
            "/pos/terminals/TERM-01/heartbeat", json={"usuario_id": "7"}
        )
    assert r.status_code == 200, r.text
    assert r.json()["success"] is True


@pytest.mark.asyncio
async def test_criterio6_heartbeat_ajeno_da_409(entorno):
    """El latido de un usuario que no es dueño no resucita el candado (RN-07)."""
    await _limpiar(entorno)
    await _sembrar_candado(entorno, "TERM-01", "7")
    async with _cliente() as cliente:
        r = await cliente.post(
            "/pos/terminals/TERM-01/heartbeat", json={"usuario_id": "9"}
        )
    assert r.status_code == 409, r.text
    assert r.json().get("regla") == "RN-07"


@pytest.mark.asyncio
async def test_criterio6_heartbeat_sin_candado_da_409(entorno):
    """El latido sobre una terminal sin candado responde 409 (RN-07)."""
    await _limpiar(entorno)
    async with _cliente() as cliente:
        r = await cliente.post(
            "/pos/terminals/TERM-06/heartbeat", json={"usuario_id": "7"}
        )
    assert r.status_code == 409, r.text


# ---------------------------------------------------------------------------
# Criterio 7 — El contrato de la Fase 3.4 (por id) convive con el de la Fase 1.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_criterio7_lock_por_id_equivale_al_de_fase1(entorno):
    """`POST /{id}/lock` (Fase 3.4) crea el mismo candado que el de Fase 1."""
    await _limpiar(entorno)
    async with _cliente() as cliente:
        r = await cliente.post("/pos/terminals/TERM-02/lock", json={"usuario_id": "7"})
    assert r.status_code == 200, r.text
    async with _cliente() as cliente:
        estado = (await cliente.get("/pos/terminals/status")).json()
    assert estado["TERM-02"]["occupier_name"] == "7"


@pytest.mark.asyncio
async def test_criterio7_unlock_por_id_libera(entorno):
    """`POST /{id}/unlock` (Fase 3.4) libera el candado del dueño."""
    await _limpiar(entorno)
    await _sembrar_candado(entorno, "TERM-02", "7")
    async with _cliente() as cliente:
        r = await cliente.post("/pos/terminals/TERM-02/unlock", json={"usuario_id": "7"})
    assert r.status_code == 200, r.text
    async with _cliente() as cliente:
        estado = (await cliente.get("/pos/terminals/status")).json()
    assert estado["TERM-02"]["occupier_id"] is None


# ---------------------------------------------------------------------------
# Criterio 8 — La configuración se guarda y se relee.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_criterio8_guardar_y_releer_config(entorno):
    """`POST /config` persiste y `GET /config` devuelve lo guardado."""
    await _limpiar(entorno)
    nuevas = [
        {"id": "C1", "name": "Caja 1", "icon": "🧁"},
        {"id": "C2", "name": "Caja 2", "icon": "🍰"},
    ]
    async with _cliente() as cliente:
        r = await cliente.post("/pos/terminals/config", json={"terminals": nuevas})
        assert r.status_code == 200, r.text
        leidas = (await cliente.get("/pos/terminals/config")).json()
    assert [t["id"] for t in leidas["terminals"]] == ["C1", "C2"]
    # Restaurar la configuración por defecto (6 terminales, sin color) para no
    # contaminar otros tests. El fixture autouse también la restaura, pero
    # dejarla explícita mantiene el test autocontenido.
    # BUG-05 — CAJA NO es una terminal: la config por defecto son 6 `TERM-0N`.
    async with _cliente() as cliente:
        await cliente.post(
            "/pos/terminals/config",
            json={
                "terminals": [
                    {
                        "id": f"TERM-{n:02d}",
                        "name": f"Terminal {n}",
                        "icon": "🖥️",
                        "color": None,
                    }
                    for n in range(1, 7)
                ]
            },
        )


# ---------------------------------------------------------------------------
# Criterio 9 — Entradas inválidas se rechazan (422), no fallan en silencio.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_criterio9_terminal_id_vacio_es_rechazado(entorno):
    """Un `terminal_id` vacío es rechazado con 422 (no crea un candado fantasma)."""
    await _limpiar(entorno)
    async with _cliente() as cliente:
        r = await cliente.post(
            "/pos/terminals/lock", json={"terminal_id": "", "user_id": "7"}
        )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_criterio9_usuario_id_vacio_es_rechazado(entorno):
    """Un `usuario_id` vacío es rechazado con 422."""
    await _limpiar(entorno)
    async with _cliente() as cliente:
        r = await cliente.post("/pos/terminals/TERM-01/lock", json={"usuario_id": ""})
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_criterio10_user_id_numerico_es_rechazado_422(entorno):
    """El contrato declara `user_id` como `str`: un número es 422 (F7.7c).

    Este test DOCUMENTA la causa raíz del bloqueo de entrada. El frontend
    enviaba `user_id: 1` (número) y Pydantic v2 lo rechazaba con
    "Input should be a valid string". La corrección vive en la frontera del
    cliente (coerción a string); aquí se fija que el contrato NO acepta números,
    para que nadie "arregle" el 422 relajando el esquema en vez de coercionar.
    """
    await _limpiar(entorno)
    async with _cliente() as cliente:
        r = await cliente.post(
            "/pos/terminals/lock", json={"terminal_id": "TERM-01", "user_id": 1}
        )
    assert r.status_code == 422, r.text
    assert "string" in r.text.lower()


@pytest.mark.asyncio
async def test_criterio10_user_id_texto_es_aceptado(entorno):
    """El mismo id, enviado como string, sí toma el candado (200)."""
    await _limpiar(entorno)
    async with _cliente() as cliente:
        r = await cliente.post(
            "/pos/terminals/lock", json={"terminal_id": "TERM-01", "user_id": "1"}
        )
    assert r.status_code == 200, r.text
    assert r.json()["success"] is True


# ---------------------------------------------------------------------------
# Criterio 11 — El status expone `caja_habilitada` (FIX "habilitar caja").
#
# Paridad con el viejo POS (§6.8): el candado (quién está en la terminal) y la
# caja (si hay un turno ABIERTO) son DOS estados INDEPENDIENTES. El landing
# necesita saber si la terminal ya tiene caja habilitada para pintar el badge y
# para que el botón no diga "Habilitar" cuando ya lo está.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_criterio11_status_sin_turno_caja_deshabilitada(entorno):
    """Sin turno de caja, `caja_habilitada` es False en todas las terminales."""
    await _limpiar(entorno)
    async with _cliente() as cliente:
        estado = (await cliente.get("/pos/terminals/status")).json()
    assert estado["TERM-01"]["caja_habilitada"] is False
    assert estado["TERM-02"]["caja_habilitada"] is False


@pytest.mark.asyncio
async def test_criterio11_status_con_turno_abierto_marca_caja_habilitada(entorno):
    """Un turno OPEN en una terminal marca `caja_habilitada` SOLO en esa terminal."""
    await _limpiar(entorno)
    await _sembrar_turno_abierto(entorno, "TERM-01")
    async with _cliente() as cliente:
        estado = (await cliente.get("/pos/terminals/status")).json()
    assert estado["TERM-01"]["caja_habilitada"] is True
    assert estado["TERM-02"]["caja_habilitada"] is False


@pytest.mark.asyncio
async def test_criterio11_turno_cerrado_no_marca_caja_habilitada(entorno):
    """Un turno CLOSED NO marca `caja_habilitada` (solo cuentan los OPEN)."""
    await _limpiar(entorno)
    await _sembrar_turno_abierto(entorno, "TERM-01", estado="CLOSED")
    async with _cliente() as cliente:
        estado = (await cliente.get("/pos/terminals/status")).json()
    assert estado["TERM-01"]["caja_habilitada"] is False


@pytest.mark.asyncio
async def test_criterio11_caja_y_candado_son_independientes(entorno):
    """Caja habilitada y candado son estados INDEPENDIENTES (paridad viejo POS).

    Una terminal puede tener caja habilitada SIN candado (el cajero cerró el
    navegador pero el turno sigue abierto) y viceversa. El status debe exponer
    ambos sin confundirlos.
    """
    await _limpiar(entorno)
    await _sembrar_turno_abierto(entorno, "TERM-01")
    await _sembrar_candado(entorno, "TERM-02", "7")
    async with _cliente() as cliente:
        estado = (await cliente.get("/pos/terminals/status")).json()
    # TERM-01: caja abierta, sin candado.
    assert estado["TERM-01"]["caja_habilitada"] is True
    assert estado["TERM-01"]["occupier_id"] is None
    # TERM-02: candado vigente, sin caja.
    assert estado["TERM-02"]["caja_habilitada"] is False
    assert estado["TERM-02"]["occupier_id"] is not None


# ---------------------------------------------------------------------------
# Criterio 12 — Color de post-it por terminal (selector de color, 9 Oct 2026).
#
# Decisiones del usuario:
#   - SIN semilla: las terminales arrancan sin color (el pizarrón las pinta
#     amarillas, `bg-yellow-100`).
#   - NO se permiten colores repetidos (400 si dos terminales comparten color).
#   - La paleta son los 21 colores de `PALETA_POST_ITS`.
#
# BUG-05 — CAJA NO es una terminal. Toda terminal es una caja EN POTENCIA
# (basta abrir su turno). El modo "ver TODAS las cuentas" lo gobierna el turno
# de caja abierto (`caja_habilitada`), no un id de terminal llamado `CAJA`.
# ---------------------------------------------------------------------------


def _config_base() -> list[dict]:
    """Config mínima de dos terminales para los tests de color."""
    return [
        {"id": "TERM-01", "name": "Terminal 1", "icon": "🖥️"},
        {"id": "TERM-02", "name": "Terminal 2", "icon": "🖥️"},
    ]


@pytest.mark.asyncio
async def test_criterio12_config_incluye_color_none_por_defecto(entorno):
    """Sin config guardada, cada terminal trae `color = None` (sin semilla).

    Este test verifica el comportamiento de una INSTALACIÓN LIMPIA: cuando no
    existe `terminal_config.json`, el router cae a `CONFIG_POR_DEFECTO` y todas
    las terminales arrancan sin color. Por eso se elimina el archivo real
    (respaldado por el fixture autouse `aislar_config_terminales`) antes de
    consultar. Sin esto, el test dependía del contenido del archivo de
    ejecución del usuario y fallaba en cuanto este asignaba colores.
    """
    from routers.terminals import _RUTA_CONFIG

    await _limpiar(entorno)
    if _RUTA_CONFIG.exists():
        _RUTA_CONFIG.unlink()
    async with _cliente() as cliente:
        datos = (await cliente.get("/pos/terminals/config")).json()["terminals"]
    assert all("color" in t for t in datos)
    assert all(t["color"] is None for t in datos)


@pytest.mark.asyncio
async def test_criterio12_caja_no_es_terminal(entorno):
    """CAJA NO aparece en la config: toda terminal es una caja en potencia (BUG-05)."""
    await _limpiar(entorno)
    async with _cliente() as cliente:
        datos = (await cliente.get("/pos/terminals/config")).json()["terminals"]
    ids = {t["id"] for t in datos}
    assert "CAJA" not in ids
    assert ids == {f"TERM-{n:02d}" for n in range(1, 7)}


@pytest.mark.asyncio
async def test_criterio12_guardar_color_valido_persiste(entorno):
    """Guardar un color del catálogo responde 200 y se relee igual."""
    await _limpiar(entorno)
    config = _config_base()
    config[0]["color"] = "bg-cyan-300"
    async with _cliente() as cliente:
        r = await cliente.post("/pos/terminals/config", json={"terminals": config})
        assert r.status_code == 200, r.text
        datos = (await cliente.get("/pos/terminals/config")).json()["terminals"]
    por_id = {t["id"]: t for t in datos}
    assert por_id["TERM-01"]["color"] == "bg-cyan-300"
    assert por_id["TERM-02"]["color"] is None


@pytest.mark.asyncio
async def test_criterio12_color_fuera_del_catalogo_400(entorno):
    """Un color que no está en `PALETA_POST_ITS` responde 400."""
    await _limpiar(entorno)
    config = _config_base()
    config[0]["color"] = "bg-magenta-999"
    async with _cliente() as cliente:
        r = await cliente.post("/pos/terminals/config", json={"terminals": config})
    assert r.status_code == 400, r.text
    assert "paleta" in r.text.lower()


@pytest.mark.asyncio
async def test_criterio12_color_repetido_400(entorno):
    """Dos terminales con el MISMO color responde 400 (no se permiten repetidos)."""
    await _limpiar(entorno)
    config = _config_base()
    config[0]["color"] = "bg-pink-300"
    config[1]["color"] = "bg-pink-300"
    async with _cliente() as cliente:
        r = await cliente.post("/pos/terminals/config", json={"terminals": config})
    assert r.status_code == 400, r.text
    assert "ya está en uso" in r.text


@pytest.mark.asyncio
async def test_criterio12_varias_sin_color_es_valido(entorno):
    """Varias terminales SIN color a la vez es válido (None no cuenta para unicidad)."""
    await _limpiar(entorno)
    config = _config_base()
    # Ambas sin color (color ausente) → 200.
    async with _cliente() as cliente:
        r = await cliente.post("/pos/terminals/config", json={"terminals": config})
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_criterio12_colores_distintos_es_valido(entorno):
    """Dos terminales con colores DISTINTOS del catálogo es válido (200)."""
    await _limpiar(entorno)
    config = _config_base()
    config[0]["color"] = "bg-cyan-300"
    config[1]["color"] = "bg-pink-300"
    async with _cliente() as cliente:
        r = await cliente.post("/pos/terminals/config", json={"terminals": config})
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# FIX "el orden no se persiste" (10 Oct 2026) — la preferencia izq-der/der-izq
# vive en el BACKEND (`terminal_config.json`), no solo en el `localStorage` del
# navegador. Así el orden que el usuario fija en el gestor sobrevive entre
# navegadores y máquinas, y no hay que reconfigurarlo cada vez que entra.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_orden_por_defecto_es_izq_der(entorno):
    """Sin config guardada, el orden por defecto es `izq-der`."""
    from routers.terminals import _RUTA_CONFIG

    await _limpiar(entorno)
    if _RUTA_CONFIG.exists():
        _RUTA_CONFIG.unlink()
    async with _cliente() as cliente:
        datos = (await cliente.get("/pos/terminals/config")).json()
    assert datos["orden"] == "izq-der"


@pytest.mark.asyncio
async def test_orden_der_izq_se_persiste_y_se_relee(entorno):
    """`POST /config` con `orden='der-izq'` persiste y `GET /config` lo devuelve."""
    await _limpiar(entorno)
    config = _config_base()
    async with _cliente() as cliente:
        r = await cliente.post(
            "/pos/terminals/config",
            json={"terminals": config, "orden": "der-izq"},
        )
        assert r.status_code == 200, r.text
        datos = (await cliente.get("/pos/terminals/config")).json()
    assert datos["orden"] == "der-izq"
    # La lista de terminales NO se altera por cambiar el orden.
    assert [t["id"] for t in datos["terminals"]] == ["TERM-01", "TERM-02"]


@pytest.mark.asyncio
async def test_orden_ausente_conserva_el_guardado(entorno):
    """Un `POST /config` SIN `orden` conserva el orden ya guardado (retrocompat)."""
    await _limpiar(entorno)
    config = _config_base()
    async with _cliente() as cliente:
        # 1) Fijar der-izq.
        await cliente.post(
            "/pos/terminals/config",
            json={"terminals": config, "orden": "der-izq"},
        )
        # 2) Guardar solo la lista (cliente viejo): el orden debe sobrevivir.
        r = await cliente.post(
            "/pos/terminals/config", json={"terminals": config}
        )
        assert r.status_code == 200, r.text
        datos = (await cliente.get("/pos/terminals/config")).json()
    assert datos["orden"] == "der-izq"


@pytest.mark.asyncio
async def test_orden_invalido_responde_400(entorno):
    """Un `orden` fuera de `ORDENES_VALIDOS` responde 400."""
    await _limpiar(entorno)
    config = _config_base()
    async with _cliente() as cliente:
        r = await cliente.post(
            "/pos/terminals/config",
            json={"terminals": config, "orden": "diagonal"},
        )
    assert r.status_code == 400, r.text
    assert "orden" in r.text.lower()


@pytest.mark.asyncio
async def test_lector_tolera_formato_viejo_lista(entorno):
    """Un `terminal_config.json` en formato VIEJO (lista suelta) se lee sin romper.

    Antes de este fix el archivo era una lista `[...]`. El lector debe aceptarlo
    y asumir el orden por defecto, para no romper instalaciones existentes.
    """
    import json

    from routers.terminals import _RUTA_CONFIG

    await _limpiar(entorno)
    _RUTA_CONFIG.write_text(
        json.dumps([{"id": "TERM-01", "name": "Terminal 1", "icon": "🖥️"}]),
        encoding="utf-8",
    )
    async with _cliente() as cliente:
        datos = (await cliente.get("/pos/terminals/config")).json()
    assert datos["orden"] == "izq-der"
    assert [t["id"] for t in datos["terminals"]] == ["TERM-01"]
