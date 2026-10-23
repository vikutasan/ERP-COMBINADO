"""Contratos 9, 10 y 13 — sesión de caja (FS2-04).

  Contrato 9  GET  /cash/active-session   → sesion_activa
  Contrato 10 POST /cash/open-session     → abrir_turno
  Contrato 13 POST /cash/close-session    → cerrar_turno
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models import CashSession
from rules import ReglaViolada
from rules.registry import (
    rn49_una_sesion_caja_por_terminal,
    rn50_opening_float,
    rn53_efectivo_esperado,
    rn54_cierre_registra_conteos,
    rn55_sesion_cerrada_inmutable,
)
from schemas import (
    AbrirTurnoEntrada,
    AbrirTurnoSalida,
    CerrarTurnoEntrada,
    CerrarTurnoSalida,
    SesionCajaActiva,
)

from .deps import (
    clasificar_ventas_del_turno,
    movimientos_del_turno,
    sesion_o_404,
    sumar_movimientos,
)

router = APIRouter()


@router.get("/active-session", response_model=SesionCajaActiva)
async def sesion_activa(
    terminal_id: str = Query(..., description="Terminal a consultar"),
    db: AsyncSession = Depends(get_db),
) -> SesionCajaActiva:
    """Devuelve la sesión de caja abierta de la terminal, o vacío.

    El POS NO lee la tabla `cash_sessions` (garantía del contrato 9). Si no hay
    turno abierto, responde `cash_session_id = None` — no es un error.
    """
    sesion = (
        await db.execute(
            select(CashSession).where(
                CashSession.terminal_id == terminal_id,
                CashSession.status == "OPEN",
            )
        )
    ).scalars().first()

    if sesion is None:
        return SesionCajaActiva(cash_session_id=None, abierta_en=None)
    return SesionCajaActiva(cash_session_id=sesion.id, abierta_en=sesion.opened_at)


@router.post("/open-session", response_model=AbrirTurnoSalida, status_code=201)
async def abrir_turno(
    entrada: AbrirTurnoEntrada,
    db: AsyncSession = Depends(get_db),
) -> AbrirTurnoSalida:
    """Abre un turno de caja para la terminal (RN-49, RN-50).

    RN-49: solo puede haber UNA sesión OPEN por terminal. Si ya hay una, la
    regla lanza 409 (el contrato 10 declara 409 para este caso).
    RN-50: el fondo inicial no puede ser negativo.
    """
    abiertas = (
        await db.execute(
            select(CashSession).where(
                CashSession.terminal_id == entrada.terminal_id,
                CashSession.status == "OPEN",
            )
        )
    ).scalars().all()

    if abiertas:
        raise ReglaViolada(
            "RN-49",
            f"La terminal {entrada.terminal_id} ya tiene un turno de caja abierto",
            409,
        )

    fondo = rn50_opening_float(entrada.monto_inicial)

    # FASE 10.5 — PARIDAD DE DATOS DE CAJA. El viejo POS persistía el NOMBRE
    # del cajero (`employee_name`); el nuevo guardaba el UUID como nombre, así
    # que el corte y el reporte diario mostraban un UUID. Si el POS envía
    # `usuario_nombre`, se usa; si no, se cae al `usuario_id` (comportamiento
    # anterior) para no romper a un consumidor que aún no lo envíe.
    nombre_cajero = entrada.usuario_nombre or str(entrada.usuario_id)

    sesion = CashSession(
        terminal_id=entrada.terminal_id,
        employee_id=entrada.usuario_id,
        employee_name=nombre_cajero,
        opening_float=fondo,
        status="OPEN",
    )
    db.add(sesion)
    await db.commit()
    await db.refresh(sesion)

    return AbrirTurnoSalida(cash_session_id=sesion.id, abierta_en=sesion.opened_at)


@router.post("/close-session", response_model=CerrarTurnoSalida)
async def cerrar_turno(
    entrada: CerrarTurnoEntrada,
    db: AsyncSession = Depends(get_db),
) -> CerrarTurnoSalida:
    """Cierra el turno con el conteo físico y devuelve el descuadre (RN-54).

    RN-55: una sesión ya cerrada no se vuelve a cerrar (400).
    RN-54: se registran el efectivo contado, el crédito y el débito.
    `diferencia` = capturado − esperado (positivo = sobrante).
    """
    sesion = await sesion_o_404(db, entrada.cash_session_id)
    rn55_sesion_cerrada_inmutable(sesion.status)

    movimientos = await movimientos_del_turno(db, entrada.cash_session_id)
    entradas, salidas = sumar_movimientos(movimientos)
    # F10.5: la clasificación por método (RN-58) alimenta el esperado con el
    # EFECTIVO del turno. RN-58 solo incluye las claves de los métodos PRESENTES:
    # sin ventas en efectivo la clave no existe, por eso se usa `.get` con cero.
    clasificacion = await clasificar_ventas_del_turno(db, entrada.cash_session_id)
    ventas_efectivo = clasificacion.get("EFECTIVO", Decimal("0.00"))

    esperado = rn53_efectivo_esperado(
        Decimal(str(sesion.opening_float)), entradas, salidas, ventas_efectivo
    )

    conteos = rn54_cierre_registra_conteos(
        entrada.montos_fisicos, entrada.credito, entrada.debito
    )

    sesion.status = "CLOSED"
    sesion.closed_at = datetime.now(tz=sesion.opened_at.tzinfo)
    sesion.physical_cash = conteos["physical_cash"]
    sesion.physical_credit = conteos["credito"]
    sesion.physical_debit = conteos["debito"]
    await db.commit()
    await db.refresh(sesion)

    capturado = Decimal(str(sesion.physical_cash))
    return CerrarTurnoSalida(
        esperado=esperado,
        capturado=capturado,
        diferencia=capturado - esperado,
    )
