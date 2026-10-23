"""Puerta de FASE 5.0 — Pizarrón de cuentas abiertas (contrato 23).

El Plan Maestro §7 (Fase 5) promete un "Pizarrón de Cuentas Abiertas": varias
cuentas en paralelo sobre la misma terminal. La autocrítica del plan de Fase 5
(D-1) detectó que el contrato 23 NO existía: el frontend no tenía forma de
preguntar "¿qué cuentas están abiertas en esta terminal?" sin leer la tabla
`tickets` (prohibido por A-02).

Esta puerta verifica CUATRO cosas (Plan de Abordaje Fase 5 §4.0.3):

  ✓ test_contrato_23_declarado
      El contrato 23 existe en el registro, con su firma y su operación.

  ✓ test_lista_solo_las_cuentas_open_de_la_terminal  (positivo)
      Devuelve SOLO las cuentas OPEN de la terminal pedida, y NO las de otra
      terminal ni las ya cobradas (RN-31).

  ✓ test_respuesta_ligera_campos_escalares  (Regla 15)
      Cada cuenta expone una PROYECCIÓN de campos escalares explícitos (nunca
      las líneas ni un `SELECT *`). FASE 5.0: 5 campos. FASE 12.6 amplió la
      proyección a 12 campos para la paridad de presentación con el viejo POS
      (terminal, capturista, cliente, teléfono, tipo de pedido, hora). BUG-04
      la amplió a 16 con el contexto de pedido COMPLETO (fecha compromiso de
      entrega, empaque, dirección y notas).

  ✓ test_contexto_de_pedido_completo  (BUG-04)
      Al recuperar un PEDIDO del pizarrón, el cliente reconstruye su bloque
      `order_*` desde el post-it (contrato 23). Antes faltaban `committed_at`,
      `packaging_type`, `delivery_address` y `order_notes`, así que la fecha
      compromiso de entrega se PERDÍA del estado local al recuperar la cuenta.
      El dato SÍ estaba en la BD; se perdía al reconstruir el bloque.

  ✓ test_sin_terminal_id_devuelve_todas  (FICHA_FIX_PIZARRON_422)
      Sin `terminal_id` (o vacío) devuelve TODAS las cuentas OPEN de TODAS las
      terminales (modo CAJA, D1). Antes respondía 422 y dejaba el pizarrón vacío.

La evidencia es la RESPUESTA HTTP real contra la app FastAPI montada sobre
PostgreSQL, más una lectura directa de la BD para confirmar el filtro.

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al
loop de ese test) y sobreescribe la dependencia `get_db` de FastAPI, igual
que las puertas de FASE 3.2 y FASE 4.0.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from contracts import CONTRATOS
from core.database import DATABASE_URL, get_db
from main import app
from models import Product, TerminalSession, Ticket, TicketItem

TERMINAL_A = "TEST-F50-A"
TERMINAL_B = "TEST-F50-B"


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
    """Borra los datos de prueba de AMBAS terminales.

    El orden importa: primero los ítems (referencian el ticket), luego los
    tickets, luego las sesiones de terminal y al final los productos.
    """
    terminales = (TERMINAL_A, TERMINAL_B)
    async with ent.Session() as db:
        await db.execute(
            delete(TicketItem).where(
                TicketItem.ticket_id.in_(
                    select(Ticket.id).where(Ticket.terminal_id.in_(terminales))
                )
            )
        )
        await db.execute(delete(Ticket).where(Ticket.terminal_id.in_(terminales)))
        await db.execute(
            delete(TerminalSession).where(TerminalSession.terminal_id.in_(terminales))
        )
        await db.execute(delete(Product).where(Product.sku.like("TEST-F50-%")))
        await db.commit()


async def _sembrar(ent: _Entorno) -> uuid.UUID:
    """Crea una sesión de terminal activa y un producto. Devuelve el id."""
    async with ent.Session() as db:
        sesion = TerminalSession(terminal_id=TERMINAL_A, is_active=True)
        producto = Product(
            sku=f"TEST-F50-{uuid.uuid4().hex[:8]}",
            name="Producto F5.0",
            price=Decimal("10.00"),
            cost=Decimal("5.00"),
            active=True,
        )
        db.add_all([sesion, producto])
        await db.commit()
        return producto.id


async def _crear_ticket(ent: _Entorno, terminal_id: str) -> uuid.UUID:
    """Inserta un ticket OPEN directamente en la BD. Devuelve su id.

    Se inserta directo (no vía HTTP) para poder sembrar cuentas de DOS
    terminales distintas sin depender de dos sesiones de terminal activas.

    `account_num` es NOT NULL en el esquema (es el folio, RN-10): hay que
    dárselo explícitamente al insertar por fuera del contrato 3.
    """
    async with ent.Session() as db:
        ticket = Ticket(
            terminal_id=terminal_id,
            account_num=f"F50-{uuid.uuid4().hex[:8]}",
            channel="PANADERIA",
            status="OPEN",
            total=Decimal("10.00"),
        )
        db.add(ticket)
        await db.commit()
        return ticket.id


def _cliente() -> httpx.AsyncClient:
    """Cliente HTTP async contra la app ASGI (sin red real)."""
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


# ---------------------------------------------------------------------------
# Criterio 1 — el contrato 23 está declarado
# ---------------------------------------------------------------------------

def test_contrato_23_declarado():
    """El contrato 23 existe, con su firma y su operación HTTP (A-02)."""
    contrato = next((c for c in CONTRATOS if c.numero == 23), None)
    assert contrato is not None, "El contrato 23 no está declarado"
    assert contrato.nombre == "pos.cuentas_abiertas"
    assert contrato.operacion == "GET /pos/open-accounts"
    assert contrato.consumidor == "POS"
    assert contrato.proveedor == "POS"
    assert contrato.entrada, "El contrato 23 no declara entrada"
    assert contrato.salida, "El contrato 23 no declara salida"


# ---------------------------------------------------------------------------
# Criterio 2 — solo las cuentas OPEN de la terminal pedida (RN-31)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_lista_solo_las_cuentas_open_de_la_terminal(entorno):
    """Devuelve SOLO las cuentas OPEN de la terminal pedida (RN-31)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        await _sembrar(ent)
        # Dos cuentas OPEN en la terminal A, una en la terminal B.
        id_a1 = await _crear_ticket(ent, TERMINAL_A)
        id_a2 = await _crear_ticket(ent, TERMINAL_A)
        await _crear_ticket(ent, TERMINAL_B)

        async with _cliente() as cliente:
            res = await cliente.get(
                "/pos/open-accounts", params={"terminal_id": TERMINAL_A}
            )
        assert res.status_code == 200, res.text
        cuerpo = res.json()
        ids = {c["id"] for c in cuerpo["cuentas"]}

        assert ids == {str(id_a1), str(id_a2)}, (
            f"Se esperaban solo las cuentas de {TERMINAL_A}: {ids}"
        )
    finally:
        await _limpiar(ent)


@pytest.mark.asyncio
async def test_no_devuelve_cuentas_cobradas(entorno):
    """Una cuenta PAID no aparece en el pizarrón (solo status OPEN)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        await _sembrar(ent)
        id_open = await _crear_ticket(ent, TERMINAL_A)
        id_paid = await _crear_ticket(ent, TERMINAL_A)

        # Marcamos una como PAID directamente en la BD.
        async with ent.Session() as db:
            ticket = await db.get(Ticket, id_paid)
            ticket.status = "PAID"
            await db.commit()

        async with _cliente() as cliente:
            res = await cliente.get(
                "/pos/open-accounts", params={"terminal_id": TERMINAL_A}
            )
        assert res.status_code == 200, res.text
        ids = {c["id"] for c in res.json()["cuentas"]}

        assert str(id_open) in ids, "La cuenta OPEN debe aparecer"
        assert str(id_paid) not in ids, "La cuenta PAID NO debe aparecer"
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 3 — respuesta ligera: proyección de campos escalares (Regla 15)
# ---------------------------------------------------------------------------

# FASE 5.0: la proyección eran 5 campos. FASE 12.6 la amplió a 12 para la
# paridad de presentación con el viejo POS (corcho + post-it con terminal,
# capturista, cliente, teléfono, tipo de pedido y hora). BUG-04 la amplió a 16
# con el contexto de pedido COMPLETO (fecha compromiso de entrega, empaque,
# dirección y notas). Regla 15 NO exige "5 campos para siempre": exige una
# PROYECCIÓN de campos escalares explícitos — nunca las líneas, nunca un
# `SELECT *` (frontera A-02 / O-23).
CAMPOS_ESPERADOS = {
    "id",
    "account_num",
    "status",
    "total",
    "version",
    "terminal_id",
    "captured_by_name",
    "customer_name",
    "customer_phone",
    "order_type",
    "delivery_type",
    "created_at",
    # BUG-04 — contexto de pedido COMPLETO (paridad al recuperar del pizarrón).
    "committed_at",
    "packaging_type",
    "delivery_address",
    "order_notes",
}


@pytest.mark.asyncio
async def test_respuesta_ligera_campos_escalares(entorno):
    """Cada cuenta expone la proyección de campos escalares explícitos (Regla 15).

    FASE 12.6: la proyección era de 12 campos (paridad de presentación con el
    viejo POS). BUG-04 la amplió a 16 con el contexto de pedido COMPLETO. Lo que
    la Regla 15 prohíbe sigue prohibido: NO se exponen las líneas del ticket
    (eso es del contrato 21) ni un volcado de la tabla.
    """
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        await _sembrar(ent)
        await _crear_ticket(ent, TERMINAL_A)

        async with _cliente() as cliente:
            res = await cliente.get(
                "/pos/open-accounts", params={"terminal_id": TERMINAL_A}
            )
        assert res.status_code == 200, res.text
        cuentas = res.json()["cuentas"]
        assert len(cuentas) == 1, "Se esperaba exactamente una cuenta"

        campos = set(cuentas[0].keys())
        assert campos == CAMPOS_ESPERADOS, (
            f"La respuesta ligera debe exponer la proyección de F12.6 + BUG-04 "
            f"({len(CAMPOS_ESPERADOS)} campos), tiene: {campos}"
        )
        # NO debe exponer las líneas (eso es del contrato 21).
        assert "items" not in campos
        assert "lineas" not in campos
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 3b — BUG-04: contexto de pedido COMPLETO en el post-it
# ---------------------------------------------------------------------------
#
# BUG-04 (10 Oct 2026) — Al COBRAR un PEDIDO invocado desde el pizarrón, la
# fecha compromiso de entrega (`committed_at`) NO se restauraba. El dato SÍ
# estaba en la BD (columna del ticket); se perdía en el estado local del cliente
# al reconstruir el bloque `order_*` desde el post-it (contrato 23), porque la
# proyección NO exponía `committed_at` (ni `packaging_type`, `delivery_address`
# ni `order_notes`). Solo sobrevivía si el pedido nunca salía de la terminal.
#
# La corrección amplía la proyección del contrato 23 con esos cuatro campos.
# Esta prueba siembra un ticket con ellos y verifica que viajen en la respuesta.

@pytest.mark.asyncio
async def test_contexto_de_pedido_completo(entorno):
    """El post-it (contrato 23) expone el contexto de pedido COMPLETO (BUG-04).

    Siembra un ticket PEDIDO con `committed_at`, `packaging_type`,
    `delivery_address` y `order_notes`, y verifica que los cuatro viajen en la
    respuesta. Sin ellos, recuperar el pedido del pizarrón perdía su fecha
    compromiso de entrega en el estado local del cliente.
    """
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        await _sembrar(ent)
        ticket_id = await _crear_ticket(ent, TERMINAL_A)

        # Sembramos el contexto de pedido directamente en la BD.
        compromiso = datetime(2026, 10, 12, 18, 30, tzinfo=timezone.utc)
        async with ent.Session() as db:
            ticket = await db.get(Ticket, ticket_id)
            ticket.order_type = "PEDIDO"
            ticket.delivery_type = "DOMICILIO"
            ticket.packaging_type = "CAJA"
            ticket.delivery_address = "Av. Reforma 123, Col. Centro"
            ticket.order_notes = "Sin nueces, por favor"
            ticket.committed_at = compromiso
            await db.commit()

        async with _cliente() as cliente:
            res = await cliente.get(
                "/pos/open-accounts", params={"terminal_id": TERMINAL_A}
            )
        assert res.status_code == 200, res.text
        cuentas = res.json()["cuentas"]
        assert len(cuentas) == 1, "Se esperaba exactamente una cuenta"

        cuenta = cuentas[0]
        assert cuenta["order_type"] == "PEDIDO"
        assert cuenta["delivery_type"] == "DOMICILIO"
        assert cuenta["packaging_type"] == "CAJA"
        assert cuenta["delivery_address"] == "Av. Reforma 123, Col. Centro"
        assert cuenta["order_notes"] == "Sin nueces, por favor"
        # `committed_at` viaja como ISO-8601 (UTC). Comparamos el instante.
        assert cuenta["committed_at"] is not None, (
            "BUG-04: `committed_at` debe viajar en el post-it para que el "
            "cliente restaure la fecha compromiso al recuperar el pedido."
        )
        instante = datetime.fromisoformat(cuenta["committed_at"])
        assert instante == compromiso, (
            f"Se esperaba {compromiso.isoformat()}, llegó {cuenta['committed_at']}"
        )
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 4 — sin terminal_id (o vacío) devuelve TODAS las cuentas (modo CAJA)
# ---------------------------------------------------------------------------
#
# FICHA_FIX_PIZARRON_422 (7 Oct 2026) — CAMBIO DE CONTRATO.
#
# El contrato 23 declaraba `terminal_id` OBLIGATORIO (`Query(..., min_length=1)`).
# Pero el frontend, en modo CAJA (D1), llama `listarCuentasAbiertas('')`, que
# produce la URL `/pos/open-accounts` SIN el query param. FastAPI respondía 422
# ("Los datos recibidos no son válidos") y el pizarrón quedaba vacío.
#
# El contrato ahora declara `terminal_id` OPCIONAL: si se omite (o viene vacío),
# devuelve TODAS las cuentas OPEN de TODAS las terminales (paridad con el viejo
# POS `getOpenTickets()`). Si viene, filtra por esa terminal (RN-31).

@pytest.mark.asyncio
async def test_sin_terminal_id_devuelve_todas(entorno):
    """Sin `terminal_id` devuelve las cuentas OPEN de TODAS las terminales.

    Es el modo CAJA (D1): el cajero central necesita ver las cuentas de T2, T3,
    T4… para poder cobrarlas. Antes este caso respondía 422 y rompía el pizarrón.
    """
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        await _sembrar(ent)
        # Una cuenta OPEN en A y otra en B (insertadas directo en la BD).
        await _crear_ticket(ent, TERMINAL_A)
        await _crear_ticket(ent, TERMINAL_B)

        async with _cliente() as cliente:
            # SIN el query param: debe devolver AMBAS (no 422).
            res = await cliente.get("/pos/open-accounts")
        assert res.status_code == 200, res.text
        cuentas = res.json()["cuentas"]
        terminales = {c["terminal_id"] for c in cuentas}
        # La BD puede tener cuentas de otras terminales (datos de otros tests);
        # lo que importa es que las de AMBAS terminales de prueba estén.
        assert {TERMINAL_A, TERMINAL_B} <= terminales, (
            f"Sin terminal_id deben venir las cuentas de TODAS las terminales, "
            f"tiene: {terminales}"
        )
    finally:
        await _limpiar(ent)


@pytest.mark.asyncio
async def test_terminal_id_vacio_devuelve_todas(entorno):
    """Un `terminal_id` vacío se trata como "sin filtro" (modo CAJA), no 422.

    El frontend envía `terminal_id=''` para pedir TODAS las cuentas. Antes esto
    respondía 422; ahora devuelve 200 con todas las cuentas OPEN.
    """
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        await _sembrar(ent)
        await _crear_ticket(ent, TERMINAL_A)

        async with _cliente() as cliente:
            res = await cliente.get("/pos/open-accounts", params={"terminal_id": ""})
        assert res.status_code == 200, res.text
        assert len(res.json()["cuentas"]) >= 1
    finally:
        await _limpiar(ent)


@pytest.mark.asyncio
async def test_terminal_sin_cuentas_devuelve_lista_vacia(entorno):
    """Una terminal sin cuentas abiertas devuelve una lista vacía, no 404."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            res = await cliente.get(
                "/pos/open-accounts", params={"terminal_id": "TEST-F50-VACIA"}
            )
        assert res.status_code == 200, res.text
        assert res.json()["cuentas"] == []
    finally:
        await _limpiar(ent)
