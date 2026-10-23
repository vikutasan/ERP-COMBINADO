"""Contratos 12 y 14 — resumen y reporte de caja (FS2-04).

  Contrato 12 GET /cash/session-summary/{id} → resumen_del_turno
  Contrato 14 GET /cash/daily-report/{fecha} → reporte_diario
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models import Ticket
from rules.registry import (
    rn53_efectivo_esperado,
    rn59_reporte_usa_dia_local,
)
from schemas import (
    LineaReporteDiario,
    MovimientoResumen,
    ReporteDiarioSalida,
    ResumenTurnoSalida,
)

from .deps import (
    clasificar_ventas_del_turno,
    movimientos_del_turno,
    sesion_o_404,
    sumar_movimientos,
)

router = APIRouter()


@router.get("/session-summary/{cash_session_id}", response_model=ResumenTurnoSalida)
async def resumen_del_turno(
    cash_session_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> ResumenTurnoSalida:
    """Devuelve la PROYECCIÓN del turno, no la tabla (RN-53, RN-58, RN-60).

    `esperado` = fondo + entradas − salidas + ventas en efectivo (RN-53).

    FASE 10.5 — PARIDAD DE DATOS DE CAJA. Además del `esperado`, se expone el
    desglose que el viejo POS mostraba al cerrar el turno: fondo inicial,
    totales de entradas/salidas, ventas por método (efectivo/crédito/débito),
    total de ventas y número de transacciones.

    DEUDA-BUG08 (Observación 4) — ¿QUIÉN CUADRA LA CAJA? Con BUG-08 una caja
    puede cobrar cuentas de OTRA terminal. El corte añade `ventas_propias` y
    `ventas_ajenas`: el mismo `total_ventas` repartido según la terminal de
    ORIGEN del ticket. `ventas_propias + ventas_ajenas == total_ventas` siempre.
    """
    sesion = await sesion_o_404(db, cash_session_id)

    movimientos = await movimientos_del_turno(db, cash_session_id)
    entradas, salidas = sumar_movimientos(movimientos)
    clasificado = await clasificar_ventas_del_turno(
        db, cash_session_id, terminal_del_turno=sesion.terminal_id
    )

    ventas_efectivo = clasificado.get("EFECTIVO", Decimal("0.00"))
    total_credito = clasificado.get("CREDITO", Decimal("0.00"))
    total_debito = clasificado.get("DEBITO", Decimal("0.00"))
    total_transferencia = clasificado.get("TRANSFERENCIA", Decimal("0.00"))
    total_ventas = ventas_efectivo + total_credito + total_debito + total_transferencia

    esperado = rn53_efectivo_esperado(
        Decimal(str(sesion.opening_float)), entradas, salidas, ventas_efectivo
    )

    return ResumenTurnoSalida(
        esperado=esperado,
        movimientos=[
            MovimientoResumen(
                movement_id=m.id,
                tipo=m.movement_type,
                monto=Decimal(str(m.amount)),
                motivo=m.concept,
                creado_en=m.created_at,
            )
            for m in movimientos
        ],
        fondo_inicial=Decimal(str(sesion.opening_float)),
        total_entradas=entradas,
        total_salidas=salidas,
        total_credito=total_credito,
        total_debito=total_debito,
        total_transferencia=total_transferencia,
        total_ventas=total_ventas,
        num_transacciones=clasificado.get("num_transacciones", 0),
        ventas_propias=clasificado.get("ventas_propias", Decimal("0.00")),
        ventas_ajenas=clasificado.get("ventas_ajenas", Decimal("0.00")),
        num_transacciones_ajenas=clasificado.get("num_transacciones_ajenas", 0),
    )


@router.get("/daily-report/{fecha}", response_model=ReporteDiarioSalida)
async def reporte_diario(
    fecha: date,
    db: AsyncSession = Depends(get_db),
) -> ReporteDiarioSalida:
    """Reporte del día LOCAL agrupado por canal y cajero/terminal (RN-59).

    RN-59: el día de negocio es el LOCAL, no el UTC. Se agrupan los tickets
    cobrados ese día por (canal, cajero, terminal) y se suma su total.
    """
    # RN-59: se usa el día local. El filtro por rango se hace en Python para
    # no hardcodear el offset (RN-81): `rn59_reporte_usa_dia_local` lo resuelve.
    tickets = (
        await db.execute(select(Ticket).where(Ticket.status == "PAID"))
    ).scalars().all()

    agrupado: dict[tuple[str, str, str], Decimal] = {}
    for t in tickets:
        if t.created_at is None:
            continue
        if rn59_reporte_usa_dia_local(t.created_at) != fecha.isoformat():
            continue
        detalles = t.payment_details or {}
        cajero = str(detalles.get("cajero", "—"))
        clave = (t.channel, cajero, t.terminal_id or "—")
        agrupado[clave] = agrupado.get(clave, Decimal("0.00")) + Decimal(str(t.total))

    return ReporteDiarioSalida(
        fecha=fecha.isoformat(),
        reporte=[
            LineaReporteDiario(canal=canal, cajero=cajero, terminal=terminal, total=total)
            for (canal, cajero, terminal), total in sorted(agrupado.items())
        ],
    )
