"""Utilidades internas del router de caja — FS2-04.

Funciones compartidas por sessions.py, movements.py y reports.py.
No se exponen como endpoints.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import CashMovement, CashSession, Ticket
from rules.registry import rn58_clasificacion_alimenta_resumen


async def sesion_o_404(db: AsyncSession, cash_session_id: UUID) -> CashSession:
    """Devuelve la sesión de caja o lanza 404 (contratos 12 y 13)."""
    sesion = (
        await db.execute(select(CashSession).where(CashSession.id == cash_session_id))
    ).scalars().first()
    if sesion is None:
        raise HTTPException(status_code=404, detail="Sesión de caja inexistente")
    return sesion


async def clasificar_ventas_del_turno(
    db: AsyncSession, cash_session_id: UUID, terminal_del_turno: str | None = None
) -> dict:
    """Clasifica las ventas del turno por método (RN-53, RN-57, RN-58).

    El cobro del POS (FASE 4.0) liga cada ticket a su caja. Aquí se leen esos
    tickets y se clasifican por método (RN-57): solo el EFECTIVO entra al
    esperado de la caja física. Crédito/débito/transferencia no son efectivo.

    FASE 9.1.1 — PAGOS MIXTOS (corrección crítica). Antes se leía
    `payment_details["metodo"]` como un único string y se sumaba `t.total`
    completo: un ticket pagado $40 en efectivo + $60 con tarjeta habría metido
    los $100 al efectivo esperado (inflando la caja en $60). Ahora se lee la
    forma canónica `pagos[]` y se suma SOLO el `monto` de cada abono. Se
    mantiene la retrocompatibilidad con el cobro viejo (`{metodo, monto}` sin
    `pagos[]`).

    FASE 10.5 — PARIDAD DE DATOS DE CAJA. Antes esta función devolvía solo el
    EFECTIVO (un Decimal). El viejo POS exponía el desglose completo
    (efectivo, crédito, débito, total de ventas y número de transacciones) en
    su resumen de caja. Ahora devuelve el diccionario COMPLETO de la
    clasificación (RN-58) más el conteo de tickets.

    DEUDA-BUG08 (Observación 4) — DESGLOSE POR ORIGEN. Con BUG-08 una caja
    puede cobrar cuentas de OTRA terminal. Si se pasa `terminal_del_turno`, se
    añaden al resultado `ventas_propias` / `ventas_ajenas` /
    `num_transacciones_ajenas`.
    """
    tickets = (
        await db.execute(select(Ticket).where(Ticket.cash_session_id == cash_session_id))
    ).scalars().all()

    pagos: list[dict] = []
    for t in tickets:
        detalles = t.payment_details or {}
        abonos = detalles.get("pagos")
        if isinstance(abonos, list) and abonos:
            for abono in abonos:
                metodo = str(abono.get("metodo", "")).upper()
                if metodo in {"EFECTIVO", "CREDITO", "DEBITO", "TRANSFERENCIA"}:
                    pagos.append({"metodo": metodo, "monto": abono.get("monto", "0.00")})
            continue
        metodo = str(detalles.get("metodo", "")).upper()
        if metodo in {"EFECTIVO", "CREDITO", "DEBITO", "TRANSFERENCIA"}:
            pagos.append({"metodo": metodo, "monto": detalles.get("monto", t.total)})

    clasificado = rn58_clasificacion_alimenta_resumen(pagos)
    clasificado["num_transacciones"] = len(tickets)

    if terminal_del_turno is not None:
        propias = Decimal("0.00")
        ajenas = Decimal("0.00")
        ajenas_n = 0
        for t in tickets:
            monto = Decimal(str(t.total))
            if t.terminal_id == terminal_del_turno:
                propias += monto
            else:
                ajenas += monto
                ajenas_n += 1
        clasificado["ventas_propias"] = propias
        clasificado["ventas_ajenas"] = ajenas
        clasificado["num_transacciones_ajenas"] = ajenas_n
    return clasificado


async def movimientos_del_turno(
    db: AsyncSession, cash_session_id: UUID
) -> list[CashMovement]:
    """Devuelve los movimientos del turno, del más antiguo al más reciente."""
    return (
        await db.execute(
            select(CashMovement)
            .where(CashMovement.cash_session_id == cash_session_id)
            .order_by(CashMovement.created_at)
        )
    ).scalars().all()


def sumar_movimientos(movimientos: list[CashMovement]) -> tuple[Decimal, Decimal]:
    """Separa los movimientos en (entradas, salidas) sumadas."""
    entradas = Decimal("0.00")
    salidas = Decimal("0.00")
    for m in movimientos:
        monto = Decimal(str(m.amount))
        if m.movement_type == "ENTRADA":
            entradas += monto
        else:
            salidas += monto
    return entradas, salidas
