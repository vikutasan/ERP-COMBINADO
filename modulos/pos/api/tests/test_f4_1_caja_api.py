"""Puerta de FASE 4.1 — Backend de caja (contratos 9–14).

Verifica los 6 endpoints de la caja contra la app FastAPI montada sobre
PostgreSQL. La evidencia es la RESPUESTA HTTP real, no la intención.

  ✓ test_contratos_9_a_14_declarados        (frontera A-02)
  ✓ test_abrir_turno_y_sesion_activa        (contratos 9 y 10)
  ✓ test_no_se_abren_dos_turnos_409         (RN-49 → 409)
  ✓ test_movimiento_entrada_y_salida        (contrato 11, RN-51)
  ✓ test_resumen_del_turno                  (contrato 12, RN-53)
  ✓ test_cerrar_turno_con_descuadre         (contrato 13, RN-54/RN-55)
  ✓ test_reporte_diario_usa_dia_local       (contrato 14, RN-59)

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al
loop de ese test) y sobreescribe la dependencia `get_db` de FastAPI, igual que
las puertas de FASE 3.2 y 4.0.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from contracts import CONTRATOS
from core.database import DATABASE_URL, get_db
from main import app
from models import CashMovement, CashSession, Product, TerminalSession, Ticket, TicketItem

# Los 6 contratos de caja de la FASE 4.1.
CONTRATOS_CAJA = {
    9: "caja.sesion_activa",
    10: "caja.abrir_turno",
    11: "caja.registrar_movimiento",
    12: "caja.resumen_del_turno",
    13: "caja.cerrar_turno",
    14: "caja.reporte_diario",
}

TERMINAL_ID = "TEST-F41"


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
        await db.execute(delete(Product).where(Product.sku.like("TEST-F41-%")))
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


# ---------------------------------------------------------------------------
# Criterio 1 — Frontera A-02: los contratos 9–14 están declarados
# ---------------------------------------------------------------------------

def test_contratos_9_a_14_declarados():
    """Ningún endpoint de caja existe sin contrato (regla A-02)."""
    por_numero = {c.numero: c for c in CONTRATOS}
    for numero, nombre in CONTRATOS_CAJA.items():
        assert numero in por_numero, f"Falta el contrato #{numero} ({nombre})"
        assert por_numero[numero].nombre == nombre, (
            f"El contrato #{numero} se llama '{por_numero[numero].nombre}', no '{nombre}'"
        )
        # Un contrato es una OPERACIÓN, no una tabla (O-23).
        assert por_numero[numero].tabla_expuesta is None
        assert por_numero[numero].operacion.startswith(
            ("GET ", "POST ", "PATCH ", "DELETE ")
        ), f"El contrato #{numero} no declara una operación HTTP"


# ---------------------------------------------------------------------------
# Criterio 2 — Abrir turno y consultar la sesión activa (contratos 9 y 10)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_abrir_turno_y_sesion_activa(entorno):
    """Abrir un turno y luego consultarlo por el contrato 9."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            # Sin turno abierto, el contrato 9 responde vacío (no es error).
            res = await cliente.get(
                "/cash/active-session", params={"terminal_id": TERMINAL_ID}
            )
            assert res.status_code == 200, res.text
            assert res.json()["cash_session_id"] is None

            abierto = await _abrir_turno(cliente)
            assert abierto["cash_session_id"]
            assert abierto["abierta_en"]

            # Con turno abierto, el contrato 9 lo devuelve.
            res = await cliente.get(
                "/cash/active-session", params={"terminal_id": TERMINAL_ID}
            )
            assert res.status_code == 200, res.text
            assert res.json()["cash_session_id"] == abierto["cash_session_id"]
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 3 — RN-49: no se abren dos turnos en la misma terminal (409)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_no_se_abren_dos_turnos_409(entorno):
    """Un segundo turno en la misma terminal responde 409 (RN-49)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            await _abrir_turno(cliente)

            res = await cliente.post(
                "/cash/open-session",
                json={
                    "terminal_id": TERMINAL_ID,
                    "usuario_id": str(uuid.uuid4()),
                    "monto_inicial": "50.00",
                },
            )
            assert res.status_code == 409, res.text
            assert "turno de caja abierto" in res.text.lower(), res.text
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 4 — Movimientos ENTRADA/SALIDA (contrato 11, RN-51)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_movimiento_entrada_y_salida(entorno):
    """Registrar una entrada y una salida; un tipo inválido es 400 (RN-51)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            abierto = await _abrir_turno(cliente)
            caja_id = abierto["cash_session_id"]

            res = await cliente.post(
                "/cash/movements",
                json={
                    "cash_session_id": caja_id,
                    "tipo": "ENTRADA",
                    "monto": "200.00",
                    "motivo": "Refuerzo de caja",
                },
            )
            assert res.status_code == 201, res.text
            assert res.json()["movement_id"]

            res = await cliente.post(
                "/cash/movements",
                json={
                    "cash_session_id": caja_id,
                    "tipo": "SALIDA",
                    "monto": "30.00",
                    "motivo": "Compra de hielo",
                },
            )
            assert res.status_code == 201, res.text

            # RN-51: un tipo que no es ENTRADA ni SALIDA es 400.
            res = await cliente.post(
                "/cash/movements",
                json={
                    "cash_session_id": caja_id,
                    "tipo": "TRANSFERENCIA",
                    "monto": "10.00",
                    "motivo": "Inválido",
                },
            )
            assert res.status_code == 400, res.text
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 5 — Resumen del turno (contrato 12, RN-53)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_resumen_del_turno(entorno):
    """El esperado = fondo + entradas − salidas + ventas efectivo (RN-53)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            abierto = await _abrir_turno(cliente, fondo="100.00")
            caja_id = abierto["cash_session_id"]

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

            res = await cliente.get(f"/cash/session-summary/{caja_id}")
            assert res.status_code == 200, res.text
            cuerpo = res.json()
            # 100 + 200 − 30 + 0 (sin ventas) = 270.00
            assert Decimal(cuerpo["esperado"]) == Decimal("270.00"), cuerpo
            assert len(cuerpo["movimientos"]) == 2
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 6 — Cerrar turno con descuadre (contrato 13, RN-54/RN-55)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cerrar_turno_con_descuadre(entorno):
    """Cerrar el turno devuelve el descuadre; re-cerrar es 400 (RN-55)."""
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        async with _cliente() as cliente:
            abierto = await _abrir_turno(cliente, fondo="100.00")
            caja_id = abierto["cash_session_id"]

            # Se cuenta 90.00 cuando el esperado es 100.00 → faltante de 10.00.
            res = await cliente.post(
                "/cash/close-session",
                json={
                    "cash_session_id": caja_id,
                    "montos_fisicos": "90.00",
                    "credito": "0.00",
                    "debito": "0.00",
                },
            )
            assert res.status_code == 200, res.text
            cuerpo = res.json()
            assert Decimal(cuerpo["esperado"]) == Decimal("100.00"), cuerpo
            assert Decimal(cuerpo["capturado"]) == Decimal("90.00"), cuerpo
            assert Decimal(cuerpo["diferencia"]) == Decimal("-10.00"), cuerpo

            # RN-55: una caja ya cerrada no se vuelve a cerrar.
            res = await cliente.post(
                "/cash/close-session",
                json={
                    "cash_session_id": caja_id,
                    "montos_fisicos": "90.00",
                    "credito": "0.00",
                    "debito": "0.00",
                },
            )
            assert res.status_code == 400, res.text

            # RN-55: una caja cerrada tampoco acepta movimientos.
            res = await cliente.post(
                "/cash/movements",
                json={
                    "cash_session_id": caja_id,
                    "tipo": "ENTRADA",
                    "monto": "10.00",
                    "motivo": "Tarde",
                },
            )
            assert res.status_code == 400, res.text
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 7 — Reporte diario con día local (contrato 14, RN-59)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_reporte_diario_usa_dia_local(entorno):
    """El reporte agrupa por canal/cajero/terminal del día local (RN-59).

    Determinismo horario: el día de negocio es el LOCAL (UTC-6), no el UTC. Si
    se siembra el ticket con el `now()` de la BD (UTC) y se consulta el día
    local, el test falla entre las 00:00 y las 06:00 UTC (18:00–00:00 local),
    porque el día UTC ya cambió y el local no. Para que la puerta sea estable a
    cualquier hora, se fija `created_at` al MEDIODÍA LOCAL del día local actual
    y se consulta ese mismo día local.
    """
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        # Día local de negocio (UTC-6) y su mediodía, expresado en UTC.
        tz_negocio = timezone(timedelta(hours=-6))
        ahora_local = datetime.now(tz=tz_negocio)
        hoy_local = ahora_local.strftime("%Y-%m-%d")
        mediodia_local = ahora_local.replace(
            hour=12, minute=0, second=0, microsecond=0
        )
        created_at_utc = mediodia_local.astimezone(timezone.utc)
        async with ent.Session() as db:
            caja = CashSession(
                terminal_id=TERMINAL_ID,
                employee_id=uuid.uuid4(),
                employee_name="Cajero F4.1",
                opening_float=Decimal("100.00"),
                status="OPEN",
            )
            db.add(caja)
            await db.flush()
            ticket = Ticket(
                account_num=f"V{uuid.uuid4().hex[:6]}",
                total=Decimal("150.00"),
                status="PAID",
                terminal_id=TERMINAL_ID,
                channel="PANADERIA",
                cash_session_id=caja.id,
                created_at=created_at_utc,
                payment_details={"metodo": "EFECTIVO", "cajero": "Cajero F4.1"},
            )
            db.add(ticket)
            await db.commit()

        async with _cliente() as cliente:
            res = await cliente.get(f"/cash/daily-report/{hoy_local}")
            assert res.status_code == 200, res.text
            cuerpo = res.json()
            assert cuerpo["fecha"] == hoy_local
            # Debe aparecer al menos la línea del ticket sembrado.
            lineas = [l for l in cuerpo["reporte"] if l["terminal"] == TERMINAL_ID]
            assert len(lineas) == 1, cuerpo
            assert lineas[0]["canal"] == "PANADERIA"
            assert lineas[0]["cajero"] == "Cajero F4.1"
            assert Decimal(lineas[0]["total"]) == Decimal("150.00")
    finally:
        await _limpiar(ent)
