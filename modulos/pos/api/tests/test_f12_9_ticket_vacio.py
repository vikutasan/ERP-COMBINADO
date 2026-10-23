"""Puerta de FASE 12.9.1 — El ticket puede nacer SIN LÍNEAS (contrato 29).

Verifica los 5 criterios de la puerta (Plan de Abordaje §10.6, 17ª instancia):

  ✓ test_contrato_29_declarado                 (frontera A-02)
  ✓ test_ticket_vacio_nace_open_total_cero     (201 + status OPEN + total 0.00)
  ✓ test_ticket_vacio_aparece_en_el_pizarron   (contrato 23 lo lista)
  ✓ test_ticket_vacio_se_llena_despues         (contrato 18 añade la 1ª línea)
  ✓ test_items_ausente_es_valido               (el campo `items` es opcional)

CONTEXTO — por qué existe esta puerta
─────────────────────────────────────
El flujo REAL del POS es "crear-vacío-luego-llenar": `asegurarTicket`
(RetailVisionPOS.jsx) llama a `crearTicket([], bloque)` para obtener el folio y
el `account_num` de la cuenta, y cada producto entra DESPUÉS, uno a uno, por el
contrato atómico 18 (`pos.añadir_item`). El caso de uso primario es la CUENTA
VACÍA que se envía al pizarrón y se cobra más tarde.

El esquema `CrearTicketEntrada` declaraba `items` con `min_length=1`, lo que
ASUMÍA el flujo inverso (crear-con-líneas). Ese supuesto era falso: el POS
nunca crea un ticket con líneas. La F12.9.1 relaja el campo a
`default_factory=list` y declara el contrato 29 que faltaba (el endpoint
`POST /pos/tickets` existía SIN contrato — violación de la regla A-02).

La evidencia es la RESPUESTA HTTP real contra la app FastAPI montada sobre
PostgreSQL, no la intención. Se siembra un producto y una sesión de terminal,
se ejercita el flujo completo (crear vacío → listar en pizarrón → añadir línea)
y se limpia al terminar.

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al
loop de ese test) y sobreescribe la dependencia `get_db` de FastAPI. Así se
evita el error "Future attached to a different loop" que aparece cuando un
engine module-level se reutiliza entre loops distintos.

Regla A-02: ningún endpoint existe sin contrato. El primer test lo afirma.
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
from models import Product, TerminalSession, Ticket, TicketItem

# El contrato que la F12.9.1 declara (cierra el hueco A-02 del endpoint).
CONTRATO_CREAR_TICKET = 29
NOMBRE_CONTRATO = "pos.crear_ticket"

TERMINAL_ID = "TEST-F1291"


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
    """Borra los datos de prueba (tickets, ítems, sesión y producto)."""
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
        await db.execute(delete(Product).where(Product.sku.like("TEST-F1291-%")))
        await db.commit()


async def _sembrar(ent: _Entorno) -> uuid.UUID:
    """Crea una sesión de terminal activa y un producto. Devuelve su id."""
    async with ent.Session() as db:
        sesion = TerminalSession(terminal_id=TERMINAL_ID, is_active=True)
        producto = Product(
            sku=f"TEST-F1291-{uuid.uuid4().hex[:8]}",
            name="Producto F12.9.1",
            price=Decimal("15.00"),
            cost=Decimal("6.00"),
            active=True,
        )
        db.add_all([sesion, producto])
        await db.commit()
        return producto.id


def _cliente() -> httpx.AsyncClient:
    """Cliente HTTP async contra la app ASGI (sin red real)."""
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def _crear_ticket_vacio(cliente: httpx.AsyncClient) -> httpx.Response:
    """Crea un ticket SIN LÍNEAS vía el contrato 29 (el flujo real del POS)."""
    return await cliente.post(
        "/pos/tickets",
        json={
            "terminal_id": TERMINAL_ID,
            "channel": "PANADERIA",
            "items": [],
        },
    )


# ---------------------------------------------------------------------------
# Criterio 1 — Frontera A-02: el contrato 29 está declarado
# ---------------------------------------------------------------------------

def test_contrato_29_declarado():
    """El endpoint `POST /pos/tickets` ya NO existe sin contrato (regla A-02)."""
    por_numero = {c.numero: c for c in CONTRATOS}
    assert CONTRATO_CREAR_TICKET in por_numero, (
        f"Falta el contrato #{CONTRATO_CREAR_TICKET} ({NOMBRE_CONTRATO})"
    )
    contrato = por_numero[CONTRATO_CREAR_TICKET]
    assert contrato.nombre == NOMBRE_CONTRATO, (
        f"El contrato #{CONTRATO_CREAR_TICKET} se llama '{contrato.nombre}', "
        f"no '{NOMBRE_CONTRATO}'"
    )
    # Un contrato es una OPERACIÓN, no una tabla (O-23).
    assert contrato.tabla_expuesta is None
    assert contrato.operacion == "POST /pos/tickets", (
        f"El contrato declara '{contrato.operacion}', no 'POST /pos/tickets'"
    )
    # La garantía del ticket vacío debe estar declarada explícitamente.
    garantias = " ".join(contrato.garantias)
    assert "SIN LÍNEAS" in garantias or "sin líneas" in garantias.lower(), (
        "El contrato no declara la garantía del ticket vacío"
    )


# ---------------------------------------------------------------------------
# Criterio 2 — El ticket vacío nace OPEN con total 0.00
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ticket_vacio_nace_open_total_cero(entorno):
    """`POST /pos/tickets` con `items: []` responde 201, OPEN y total 0.00."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        await _sembrar(ent)
        async with _cliente() as cliente:
            res = await _crear_ticket_vacio(cliente)

        assert res.status_code == 201, res.text
        cuerpo = res.json()
        assert cuerpo["status"] == "OPEN", cuerpo
        assert Decimal(str(cuerpo["total"])) == Decimal("0.00"), cuerpo
        assert cuerpo["version"] == 0, cuerpo
        assert cuerpo["items"] == [], cuerpo
        # El folio se asigna al nacer (RN-10), aunque no haya líneas.
        assert cuerpo["account_num"].startswith("V"), cuerpo
        assert cuerpo["terminal_id"] == TERMINAL_ID, cuerpo
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 3 — El ticket vacío aparece en el pizarrón (contrato 23)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ticket_vacio_aparece_en_el_pizarron(entorno):
    """Una cuenta vacía OPEN se lista en el pizarrón de la terminal (RN-31)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        await _sembrar(ent)
        async with _cliente() as cliente:
            creado = await _crear_ticket_vacio(cliente)
            assert creado.status_code == 201, creado.text
            ticket_id = creado.json()["id"]

            res = await cliente.get(
                "/pos/open-accounts", params={"terminal_id": TERMINAL_ID}
            )

        assert res.status_code == 200, res.text
        cuentas = res.json()["cuentas"]
        ids = [c["id"] for c in cuentas]
        assert ticket_id in ids, (
            "La cuenta vacía NO aparece en el pizarrón; el caso de uso primario "
            "de la F12.9.1 (enviar la cuenta vacía al pizarrón) se rompe."
        )
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 4 — El ticket vacío se llena después (contrato 18)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ticket_vacio_se_llena_despues(entorno):
    """Tras crear vacío, el contrato 18 añade la 1ª línea y recalcula el total."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        product_id = await _sembrar(ent)
        async with _cliente() as cliente:
            creado = await _crear_ticket_vacio(cliente)
            assert creado.status_code == 201, creado.text
            ticket_id = creado.json()["id"]

            res = await cliente.post(
                f"/pos/tickets/{ticket_id}/items",
                json={
                    "product_id": str(product_id),
                    "quantity": 2,
                    "item_id": str(uuid.uuid4()),
                    "version": 0,
                },
            )

        assert res.status_code in (200, 201), res.text
        cuerpo = res.json()
        # El total pasa de 0.00 a 30.00 (2 × 15.00), resuelto por el servidor.
        assert Decimal(str(cuerpo["total"])) == Decimal("30.00"), cuerpo
        assert len(cuerpo["lineas"]) == 1, cuerpo
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 5 — El campo `items` es opcional (capacidad GENERAL)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_items_ausente_es_valido(entorno):
    """Omitir `items` por completo también crea un ticket vacío válido.

    La capacidad es GENERAL: todo ticket puede nacer sin líneas, no solo el
    caso de la cuenta vacía. El esquema usa `default_factory=list`.
    """
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        await _sembrar(ent)
        async with _cliente() as cliente:
            res = await cliente.post(
                "/pos/tickets",
                json={"terminal_id": TERMINAL_ID, "channel": "PANADERIA"},
            )

        assert res.status_code == 201, res.text
        cuerpo = res.json()
        assert cuerpo["items"] == [], cuerpo
        assert Decimal(str(cuerpo["total"])) == Decimal("0.00"), cuerpo
    finally:
        await _limpiar(ent)
