"""Contratos 11 y 29 — movimientos de caja (FS2-04).

  Contrato 11 POST   /cash/movements               → registrar_movimiento
  Contrato 29 DELETE /cash/movements/{movement_id} → eliminar_movimiento
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models import CashMovement
from rules.registry import (
    rn51_movimiento_entrada_o_salida,
    rn52_movimiento_eliminable_si_abierta,
    rn55_sesion_cerrada_inmutable,
)
from schemas import (
    EliminarMovimientoSalida,
    MovimientoEntrada,
    MovimientoSalida,
)

from .deps import sesion_o_404

router = APIRouter()


@router.post("/movements", response_model=MovimientoSalida, status_code=201)
async def registrar_movimiento(
    entrada: MovimientoEntrada,
    db: AsyncSession = Depends(get_db),
) -> MovimientoSalida:
    """Registra una entrada o salida de efectivo del turno (RN-51, RN-55).

    RN-55: una sesión CLOSED es inmutable — no acepta movimientos (400).
    RN-51: el tipo es ENTRADA o SALIDA, con monto y concepto.
    """
    sesion = await sesion_o_404(db, entrada.cash_session_id)
    rn55_sesion_cerrada_inmutable(sesion.status)

    normalizado = rn51_movimiento_entrada_o_salida(
        entrada.tipo, entrada.monto, entrada.motivo
    )

    movimiento = CashMovement(
        cash_session_id=sesion.id,
        movement_type=normalizado["tipo"],
        amount=normalizado["monto"],
        concept=normalizado["concepto"],
    )
    db.add(movimiento)
    await db.commit()
    await db.refresh(movimiento)

    return MovimientoSalida(movement_id=movimiento.id)


@router.delete("/movements/{movement_id}", response_model=EliminarMovimientoSalida)
async def eliminar_movimiento(
    movement_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> EliminarMovimientoSalida:
    """Elimina un movimiento de efectivo del turno (RN-52).

    PARIDAD DE OPERACIÓN (F10.6.2). El viejo POS permitía borrar un movimiento
    mal capturado mientras la caja estuviera abierta. El nuevo POS lo había
    OMITIDO: el cajero no podía corregir un error de captura. Este endpoint
    restaura esa operación, con la misma regla de negocio (RN-52) que ya
    existía en el registro de reglas pero que ningún endpoint usaba.

    RN-52: solo se elimina si la sesión está ABIERTA. Una sesión CLOSED es
    inmutable (RN-55) → 400.
    """
    movimiento = (
        await db.execute(select(CashMovement).where(CashMovement.id == movement_id))
    ).scalars().first()
    if movimiento is None:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")

    sesion = await sesion_o_404(db, movimiento.cash_session_id)
    rn52_movimiento_eliminable_si_abierta(sesion.status)

    await db.delete(movimiento)
    await db.commit()

    return EliminarMovimientoSalida(eliminado=True)
