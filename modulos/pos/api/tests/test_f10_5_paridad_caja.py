"""Puerta de FASE 10.5 — Paridad de datos de caja (contratos 10 y 12).

La analogía del trasplante: el POS nuevo debe recibir la MISMA sangre (datos)
que el viejo, o el cuerpo (ERP) lo rechaza. El inventario de componentes de la
F10 no veía los FLUJOS DE DATOS: el `GestorDeCaja` nuevo consumía menos datos
que el viejo. Esta puerta cierra las dos brechas de datos detectadas:

  ✓ test_abrir_turno_persiste_el_nombre_del_cajero   (brecha #1, contrato 10)
  ✓ test_resumen_expone_el_desglose_completo         (brecha #2, contrato 12)
  ✓ test_contratos_10_y_12_declaran_los_campos_nuevos (frontera A-02)

Evidencia: la RESPUESTA HTTP real y la fila persistida, no la intención.

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

TERMINAL_ID = "TEST-F105"


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
        await db.execute(
            delete(CashSession).where(CashSession.terminal_id == TERMINAL_ID)
        )
        await db.execute(
            delete(TerminalSession).where(TerminalSession.terminal_id == TERMINAL_ID)
        )
        await db.execute(delete(Product).where(Product.sku.like("TEST-F105-%")))
        await db.commit()


def _cliente() -> httpx.AsyncClient:
    """Cliente HTTP async contra la app ASGI (sin red real)."""
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def _abrir_turno(
    cliente: httpx.AsyncClient,
    fondo: str = "100.00",
    nombre: str | None = None,
) -> dict:
    """Abre un turno de caja vía el contrato 10. Devuelve la respuesta."""
    cuerpo = {
        "terminal_id": TERMINAL_ID,
        "usuario_id": str(uuid.uuid4()),
        "monto_inicial": fondo,
    }
    if nombre is not None:
        cuerpo["usuario_nombre"] = nombre
    res = await cliente.post("/cash/open-session", json=cuerpo)
    assert res.status_code == 201, res.text
    return res.json()


# ---------------------------------------------------------------------------
# Brecha #1 — El nombre del cajero se persiste (contrato 10)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_abrir_turno_persiste_el_nombre_del_cajero(entorno):
    """`usuario_nombre` se guarda en `cash_sessions.employee_name` (F10.5).

    El viejo POS enviaba `employee_name` al abrir la sesión; el nuevo solo
    enviaba `usuario_id` y guardaba el UUID como nombre. Esta prueba verifica
    que el nombre REAL llega a la fila persistida.
    """
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            abierto = await _abrir_turno(cliente, nombre="María Cajera")
            caja_id = abierto["cash_session_id"]

        # La fila persistida debe tener el nombre, no el UUID.
        async with ent.Session() as db:
            sesion = (
                await db.execute(select(CashSession).where(CashSession.id == uuid.UUID(caja_id)))
            ).scalars().first()
            assert sesion is not None
            assert sesion.employee_name == "María Cajera", sesion.employee_name
    finally:
        await _limpiar(ent)


@pytest.mark.asyncio
async def test_abrir_turno_sin_nombre_cae_al_usuario_id(entorno):
    """Sin `usuario_nombre`, el nombre cae al `usuario_id` (retrocompatible).

    Un consumidor que aún no envíe el nombre no se rompe: se conserva el
    comportamiento anterior (el UUID como nombre).
    """
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            abierto = await _abrir_turno(cliente, nombre=None)
            caja_id = abierto["cash_session_id"]

        async with ent.Session() as db:
            sesion = (
                await db.execute(select(CashSession).where(CashSession.id == uuid.UUID(caja_id)))
            ).scalars().first()
            assert sesion is not None
            # El nombre es el UUID del empleado (comportamiento anterior).
            assert sesion.employee_name == str(sesion.employee_id), sesion.employee_name
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Brecha #2 — El resumen expone el desglose completo (contrato 12)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_resumen_expone_el_desglose_completo(entorno):
    """El resumen del turno expone los 7 campos de paridad (F10.5).

    El viejo POS mostraba al cajero: fondo, entradas, salidas, ventas por
    método (efectivo/crédito/débito), total de ventas y número de
    transacciones. El nuevo solo exponía `esperado` y `movimientos`. Esta
    prueba siembra un turno con movimientos y ventas MIXTAS y verifica que el
    desglose completo se reconstruye con las reglas (RN-53, RN-58).
    """
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            abierto = await _abrir_turno(cliente, fondo="100.00")
            caja_id = abierto["cash_session_id"]

            # Movimientos: +200 entrada, −30 salida.
            await cliente.post(
                "/cash/movements",
                json={
                    "cash_session_id": caja_id,
                    "tipo": "ENTRADA",
                    "monto": "200.00",
                    "motivo": "Refuerzo",
                },
            )
            await cliente.post(
                "/cash/movements",
                json={
                    "cash_session_id": caja_id,
                    "tipo": "SALIDA",
                    "monto": "30.00",
                    "motivo": "Hielo",
                },
            )

        # Ventas MIXTAS ligadas al turno: $40 efectivo + $60 crédito.
        async with ent.Session() as db:
            ticket = Ticket(
                account_num=f"V{uuid.uuid4().hex[:6]}",
                total=Decimal("100.00"),
                status="PAID",
                terminal_id=TERMINAL_ID,
                channel="PANADERIA",
                cash_session_id=uuid.UUID(caja_id),
                payment_details={
                    "pagos": [
                        {"metodo": "EFECTIVO", "monto": "40.00"},
                        {"metodo": "CREDITO", "monto": "60.00"},
                    ]
                },
            )
            db.add(ticket)
            await db.commit()

        async with _cliente() as cliente:
            res = await cliente.get(f"/cash/session-summary/{caja_id}")
            assert res.status_code == 200, res.text
            cuerpo = res.json()

            # RN-53: 100 + 200 − 30 + 40 (solo el efectivo) = 310.00
            assert Decimal(cuerpo["esperado"]) == Decimal("310.00"), cuerpo
            # Desglose de paridad (F10.5).
            assert Decimal(cuerpo["fondo_inicial"]) == Decimal("100.00"), cuerpo
            assert Decimal(cuerpo["total_entradas"]) == Decimal("200.00"), cuerpo
            assert Decimal(cuerpo["total_salidas"]) == Decimal("30.00"), cuerpo
            assert Decimal(cuerpo["total_credito"]) == Decimal("60.00"), cuerpo
            assert Decimal(cuerpo["total_debito"]) == Decimal("0.00"), cuerpo
            # Total de ventas = efectivo + crédito + débito + transferencia.
            assert Decimal(cuerpo["total_ventas"]) == Decimal("100.00"), cuerpo
            assert cuerpo["num_transacciones"] == 1, cuerpo
    finally:
        await _limpiar(ent)


@pytest.mark.asyncio
async def test_resumen_sin_ventas_deja_el_desglose_en_cero(entorno):
    """Un turno sin ventas expone el desglose en cero (no en None)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            abierto = await _abrir_turno(cliente, fondo="50.00")
            caja_id = abierto["cash_session_id"]

            res = await cliente.get(f"/cash/session-summary/{caja_id}")
            assert res.status_code == 200, res.text
            cuerpo = res.json()
            assert Decimal(cuerpo["esperado"]) == Decimal("50.00"), cuerpo
            assert Decimal(cuerpo["fondo_inicial"]) == Decimal("50.00"), cuerpo
            assert Decimal(cuerpo["total_entradas"]) == Decimal("0.00"), cuerpo
            assert Decimal(cuerpo["total_salidas"]) == Decimal("0.00"), cuerpo
            assert Decimal(cuerpo["total_credito"]) == Decimal("0.00"), cuerpo
            assert Decimal(cuerpo["total_debito"]) == Decimal("0.00"), cuerpo
            assert Decimal(cuerpo["total_ventas"]) == Decimal("0.00"), cuerpo
            assert cuerpo["num_transacciones"] == 0, cuerpo
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Frontera A-02 — Los contratos 10 y 12 declaran los campos nuevos
# ---------------------------------------------------------------------------

def test_contratos_10_y_12_declaran_los_campos_nuevos():
    """El registro declara `usuario_nombre` y los 7 campos del desglose.

    Un endpoint no puede exponer un campo que su contrato no declare (A-02).
    """
    por_numero = {c.numero: c for c in CONTRATOS}

    # Contrato 10: la entrada declara `usuario_nombre`.
    c10 = por_numero[10]
    assert c10.nombre == "caja.abrir_turno"
    assert "usuario_nombre" in c10.entrada, c10.entrada

    # Contrato 12: la salida declara los 7 campos de paridad.
    c12 = por_numero[12]
    assert c12.nombre == "caja.resumen_del_turno"
    for campo in (
        "fondo_inicial",
        "total_entradas",
        "total_salidas",
        "total_credito",
        "total_debito",
        "total_ventas",
        "num_transacciones",
    ):
        assert campo in c12.salida, f"Falta '{campo}' en la salida del contrato 12"
