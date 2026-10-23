"""Puerta de FASE 12.22 — Encolado del ticket (contrato 27).

Verifica los criterios de la puerta:

  ✓ test_contrato_27_declarado                    (frontera A-02)
  ✓ test_encolar_ticket_whatsapp_crea_fila        (Outbox, RN-85)
  ✓ test_encolar_ticket_email_crea_fila           (canal EMAIL)
  ✓ test_encolar_ticket_idempotente               (RN-86: no duplica)
  ✓ test_encolar_ticket_canal_invalido_400        (RN-89)
  ✓ test_encolar_ticket_destino_vacio_400         (RN-90)
  ✓ test_encolar_ticket_email_invalido_400        (RN-90)
  ✓ test_encolar_ticket_sin_canales_400           (RN-89)
  ✓ test_encolar_ticket_dos_canales               (una fila por canal)

CONTEXTO — por qué existe esta puerta
─────────────────────────────────────
El contrato 27 estaba DECLARADO en `contracts/registry.py` desde la FASE 8.0,
pero NUNCA se implementó: no había router, ni endpoint, ni modelo, ni servicio.
El `TicketDeliveryPanel` del POS llamaba a `POST /notifications/enqueue-ticket`
y recibía 404, así que los botones de WhatsApp y email SIEMPRE fallaban.

La F12.22 implementa el contrato: modelo `NotificationOutbox`, servicio
`notifications_service.encolar_ticket` y router `notifications`. Esta puerta
prueba el comportamiento real contra PostgreSQL.

La evidencia es la RESPUESTA HTTP real contra la app FastAPI montada sobre
PostgreSQL, no la intención. Se limpia al terminar.

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al
loop de ese test) y sobreescribe la dependencia `get_db` de FastAPI.

Regla A-02: ningún endpoint existe sin contrato. El primer test lo afirma.
"""

from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from contracts import CONTRATOS
from core.database import DATABASE_URL, get_db
from main import app
from models import NotificationOutbox

# El contrato que la F12.22 implementa.
CONTRATO_ENCOLAR_TICKET = 27
NOMBRE_CONTRATO = "notificaciones.encolar_ticket"

# Prefijo de los `evento_id` de prueba, para limpiar sin tocar datos reales.
PREFIJO_EVENTO = "TEST-F1222-"


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
    """Borra las filas de prueba del outbox (solo las de este prefijo)."""
    async with ent.Session() as db:
        await db.execute(
            delete(NotificationOutbox).where(
                NotificationOutbox.evento_id.like(f"{PREFIJO_EVENTO}%")
            )
        )
        await db.commit()


async def _leer_filas(ent: _Entorno, evento_id: str) -> list[NotificationOutbox]:
    """Lee las filas del outbox para un `evento_id` dado."""
    async with ent.Session() as db:
        res = await db.execute(
            select(NotificationOutbox).where(
                NotificationOutbox.evento_id.like(f"{evento_id}%")
            )
        )
        return list(res.scalars().all())


def _cliente() -> httpx.AsyncClient:
    """Cliente HTTP async contra la app ASGI (sin red real)."""
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


def _cuerpo(evento_id: str, canales: list[str], destinatario: dict) -> dict:
    """Arma el cuerpo del contrato 27 como lo envía el POS."""
    return {
        "evento_id": evento_id,
        "ticket_uuid": str(uuid.uuid4()),
        "canales": canales,
        "destinatario": destinatario,
        "payload": {"folio": "V0001", "total": "47.00", "items": [], "fecha": None},
    }


# ---------------------------------------------------------------------------
# Criterio 1 — Frontera A-02: el contrato 27 está declarado
# ---------------------------------------------------------------------------

def test_contrato_27_declarado():
    """El endpoint `POST /notifications/enqueue-ticket` ya NO existe sin contrato."""
    por_numero = {c.numero: c for c in CONTRATOS}
    assert CONTRATO_ENCOLAR_TICKET in por_numero, (
        f"Falta el contrato #{CONTRATO_ENCOLAR_TICKET} ({NOMBRE_CONTRATO})"
    )
    contrato = por_numero[CONTRATO_ENCOLAR_TICKET]
    assert contrato.nombre == NOMBRE_CONTRATO, (
        f"El contrato #{CONTRATO_ENCOLAR_TICKET} se llama '{contrato.nombre}', "
        f"no '{NOMBRE_CONTRATO}'"
    )
    # Un contrato es una OPERACIÓN, no una tabla (O-23).
    assert contrato.tabla_expuesta is None
    assert contrato.operacion == "POST /notifications/enqueue-ticket", (
        f"El contrato declara '{contrato.operacion}', "
        "no 'POST /notifications/enqueue-ticket'"
    )
    # La garantía del Outbox debe estar declarada explícitamente (RN-85).
    garantias = " ".join(contrato.garantias)
    assert "Outbox" in garantias, "El contrato no declara el patrón Outbox (RN-85)"


# ---------------------------------------------------------------------------
# Criterio 2 — El encolado por WhatsApp crea la fila del outbox
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_encolar_ticket_whatsapp_crea_fila(entorno):
    """Encolar por WhatsApp responde 200 y crea una fila PENDIENTE."""
    ent: _Entorno = entorno
    evento = f"{PREFIJO_EVENTO}{uuid.uuid4().hex[:8]}"
    try:
        async with _cliente() as cliente:
            res = await cliente.post(
                "/notifications/enqueue-ticket",
                json=_cuerpo(evento, ["WHATSAPP"], {"telefono": "5551234567"}),
            )
        assert res.status_code == 200, res.text
        cuerpo = res.json()
        assert cuerpo["encolado"] is True
        assert len(cuerpo["mensajes"]) == 1
        assert cuerpo["mensajes"][0]["canal"] == "WHATSAPP"
        assert cuerpo["mensajes"][0]["estado"] == "PENDIENTE"
        assert cuerpo["mensajes"][0]["envio_id"]

        filas = await _leer_filas(ent, evento)
        assert len(filas) == 1
        assert filas[0].canal == "WHATSAPP"
        assert filas[0].destino == "5551234567"
        assert filas[0].estado == "PENDIENTE"
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 3 — El encolado por email crea la fila del outbox
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_encolar_ticket_email_crea_fila(entorno):
    """Encolar por email responde 200 y crea una fila PENDIENTE."""
    ent: _Entorno = entorno
    evento = f"{PREFIJO_EVENTO}{uuid.uuid4().hex[:8]}"
    try:
        async with _cliente() as cliente:
            res = await cliente.post(
                "/notifications/enqueue-ticket",
                json=_cuerpo(evento, ["EMAIL"], {"email": "cliente@ejemplo.com"}),
            )
        assert res.status_code == 200, res.text
        cuerpo = res.json()
        assert cuerpo["encolado"] is True
        assert cuerpo["mensajes"][0]["canal"] == "EMAIL"

        filas = await _leer_filas(ent, evento)
        assert len(filas) == 1
        assert filas[0].destino == "cliente@ejemplo.com"
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 4 — Idempotencia por evento_id + canal (RN-86)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_encolar_ticket_idempotente(entorno):
    """Reintentar el mismo envío NO duplica la fila (RN-86)."""
    ent: _Entorno = entorno
    evento = f"{PREFIJO_EVENTO}{uuid.uuid4().hex[:8]}"
    try:
        async with _cliente() as cliente:
            primera = await cliente.post(
                "/notifications/enqueue-ticket",
                json=_cuerpo(evento, ["WHATSAPP"], {"telefono": "5551234567"}),
            )
            segunda = await cliente.post(
                "/notifications/enqueue-ticket",
                json=_cuerpo(evento, ["WHATSAPP"], {"telefono": "5551234567"}),
            )
        assert primera.status_code == 200, primera.text
        assert segunda.status_code == 200, segunda.text

        # El mismo `envio_id` en ambas respuestas: no se creó una fila nueva.
        id_1 = primera.json()["mensajes"][0]["envio_id"]
        id_2 = segunda.json()["mensajes"][0]["envio_id"]
        assert id_1 == id_2, "El reintento creó una fila nueva en vez de reusar la existente"

        filas = await _leer_filas(ent, evento)
        assert len(filas) == 1, f"Se esperaba 1 fila, hay {len(filas)}"
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 5 — Canal no soportado → 400 (RN-89)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_encolar_ticket_canal_invalido_400(entorno):
    """Un canal que no es WHATSAPP ni EMAIL responde 400 (RN-89)."""
    ent: _Entorno = entorno
    evento = f"{PREFIJO_EVENTO}{uuid.uuid4().hex[:8]}"
    try:
        async with _cliente() as cliente:
            res = await cliente.post(
                "/notifications/enqueue-ticket",
                json=_cuerpo(evento, ["TELEGRAMA"], {"telefono": "5551234567"}),
            )
        assert res.status_code == 400, res.text
        assert "RN-89" in res.text

        filas = await _leer_filas(ent, evento)
        assert filas == [], "Un canal inválido no debe crear fila"
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 6 — Destino vacío → 400 (RN-90)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_encolar_ticket_destino_vacio_400(entorno):
    """Un destino vacío responde 400 (RN-90)."""
    ent: _Entorno = entorno
    evento = f"{PREFIJO_EVENTO}{uuid.uuid4().hex[:8]}"
    try:
        async with _cliente() as cliente:
            res = await cliente.post(
                "/notifications/enqueue-ticket",
                json=_cuerpo(evento, ["WHATSAPP"], {"telefono": ""}),
            )
        assert res.status_code == 400, res.text
        assert "RN-90" in res.text
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 7 — Email malformado → 400 (RN-90)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_encolar_ticket_email_invalido_400(entorno):
    """Un correo sin arroba responde 400 (RN-90)."""
    ent: _Entorno = entorno
    evento = f"{PREFIJO_EVENTO}{uuid.uuid4().hex[:8]}"
    try:
        async with _cliente() as cliente:
            res = await cliente.post(
                "/notifications/enqueue-ticket",
                json=_cuerpo(evento, ["EMAIL"], {"email": "no-es-un-correo"}),
            )
        assert res.status_code == 400, res.text
        assert "RN-90" in res.text
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 8 — Sin canales → 400 (RN-89)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_encolar_ticket_sin_canales_400(entorno):
    """Una lista de canales vacía responde 400 (RN-89)."""
    ent: _Entorno = entorno
    evento = f"{PREFIJO_EVENTO}{uuid.uuid4().hex[:8]}"
    try:
        async with _cliente() as cliente:
            res = await cliente.post(
                "/notifications/enqueue-ticket",
                json=_cuerpo(evento, [], {"telefono": "5551234567"}),
            )
        assert res.status_code == 400, res.text
        assert "RN-89" in res.text
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 9 — Dos canales → una fila por canal
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_encolar_ticket_dos_canales(entorno):
    """Encolar por WhatsApp y email crea DOS filas independientes."""
    ent: _Entorno = entorno
    evento = f"{PREFIJO_EVENTO}{uuid.uuid4().hex[:8]}"
    try:
        async with _cliente() as cliente:
            res = await cliente.post(
                "/notifications/enqueue-ticket",
                json=_cuerpo(
                    evento,
                    ["WHATSAPP", "EMAIL"],
                    {"telefono": "5551234567", "email": "cliente@ejemplo.com"},
                ),
            )
        assert res.status_code == 200, res.text
        cuerpo = res.json()
        assert len(cuerpo["mensajes"]) == 2
        canales = {m["canal"] for m in cuerpo["mensajes"]}
        assert canales == {"WHATSAPP", "EMAIL"}

        filas = await _leer_filas(ent, evento)
        assert len(filas) == 2
    finally:
        await _limpiar(ent)
