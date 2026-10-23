"""Router del modulo de reparto -- MS-02.

Contratos:
  31 . delivery.list   -> GET  /delivery
  32 . delivery.assign -> POST /delivery/assign
  33 . delivery.update -> PATCH /delivery/{assignment_id}

Ciclo de vida:
  1. El cajero asigna un repartidor a un pedido con domicilio
     (POST /delivery/assign).
  2. La pantalla de reparto hace polling GET /delivery cada 5 s
     para ver asignaciones activas (ASIGNADO y EN_CAMINO).
  3. El estado avanza con PATCH:
       ASIGNADO -> EN_CAMINO -> ENTREGADO
                             |-> NO_ENTREGADO

Reglas de negocio:
  RN-MS02-01  Un pedido solo puede tener una asignacion activa.
              (UNIQUE en order_id + validacion en POST)
  RN-MS02-02  Solo pedidos con delivery_type='DOMICILIO' pueden asignarse.
  RN-MS02-03  Los estados ENTREGADO y NO_ENTREGADO son terminales.
  RN-MS02-04  Los timestamps se sellan automaticamente en cada transicion.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.timestamps import utcnow
from models.delivery import ESTADOS_REPARTO, ESTADOS_TERMINALES, DeliveryAssignment
from models.orders import Order
from schemas.delivery import (
    AsignarRepartidorEntrada,
    AvanzarEstadoEntrada,
    DeliveryAssignmentSalida,
    DeliveryQueueSalida,
)

router = APIRouter(prefix="/delivery", tags=["reparto"])

# Transiciones validas del ciclo de vida.
_TRANSICIONES_VALIDAS: dict[str, list[str]] = {
    "ASIGNADO":     ["EN_CAMINO"],
    "EN_CAMINO":    ["ENTREGADO", "NO_ENTREGADO"],
    "ENTREGADO":    [],
    "NO_ENTREGADO": [],
}


# ---------------------------------------------------------------------------
# Contrato 31 -- GET /delivery
# ---------------------------------------------------------------------------

@router.get("", response_model=DeliveryQueueSalida)
async def listar_reparto(
    estado: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> DeliveryQueueSalida:
    """Devuelve las asignaciones de reparto activas.

    Por defecto devuelve ASIGNADO y EN_CAMINO (las activas).
    Si se pasa ?estado=ENTREGADO devuelve las completadas del dia.
    """
    if estado:
        if estado not in ESTADOS_REPARTO:
            raise HTTPException(
                status_code=422,
                detail=f"Estado invalido: {estado}. "
                       f"Valores validos: {', '.join(ESTADOS_REPARTO)}",
            )
        stmt = select(DeliveryAssignment).where(
            DeliveryAssignment.estado == estado
        )
    else:
        # Por defecto: asignaciones activas (no terminales).
        stmt = select(DeliveryAssignment).where(
            DeliveryAssignment.estado.in_(["ASIGNADO", "EN_CAMINO"])
        )

    stmt = stmt.order_by(DeliveryAssignment.asignado_at.asc())
    filas = (await db.execute(stmt)).scalars().all()

    return DeliveryQueueSalida(
        asignaciones=[DeliveryAssignmentSalida.model_validate(f) for f in filas],
        total=len(filas),
    )


# ---------------------------------------------------------------------------
# Contrato 32 -- POST /delivery/assign
# ---------------------------------------------------------------------------

@router.post("/assign", response_model=DeliveryAssignmentSalida, status_code=201)
async def asignar_repartidor(
    body: AsignarRepartidorEntrada,
    db: AsyncSession = Depends(get_db),
) -> DeliveryAssignmentSalida:
    """Asigna un repartidor a un pedido de domicilio.

    Valida:
      - El pedido existe (404 si no).
      - El pedido es de tipo DOMICILIO (422 si no -- RN-MS02-02).
      - El pedido no tiene ya una asignacion activa (409 si ya tiene -- RN-MS02-01).
    """
    # Verificar que el pedido existe.
    order = await db.get(Order, body.order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")

    # RN-MS02-02: solo pedidos DOMICILIO.
    if order.delivery_type != "DOMICILIO":
        raise HTTPException(
            status_code=422,
            detail=f"El pedido tiene delivery_type='{order.delivery_type}'. "
                   "Solo se pueden asignar repartidores a pedidos con delivery_type='DOMICILIO'.",
        )

    # RN-MS02-01: idempotencia -- verificar si ya existe asignacion activa.
    existente = (
        await db.execute(
            select(DeliveryAssignment).where(
                DeliveryAssignment.order_id == body.order_id
            )
        )
    ).scalars().first()

    if existente is not None:
        if existente.estado not in ESTADOS_TERMINALES:
            raise HTTPException(
                status_code=409,
                detail=f"El pedido ya tiene una asignacion activa "
                       f"(estado: {existente.estado}). "
                       "Actualice el estado existente en lugar de crear uno nuevo.",
            )
        # Si la asignacion previa es terminal (ENTREGADO/NO_ENTREGADO),
        # permitir reasignacion eliminando la anterior.
        await db.delete(existente)
        await db.flush()

    ahora = utcnow()
    asignacion = DeliveryAssignment(
        order_id=body.order_id,
        repartidor_nombre=body.repartidor_nombre,
        repartidor_telefono=body.repartidor_telefono,
        estado="ASIGNADO",
        notas=body.notas,
        asignado_at=ahora,
        created_at=ahora,
        updated_at=ahora,
    )
    db.add(asignacion)
    await db.commit()
    await db.refresh(asignacion)

    return DeliveryAssignmentSalida.model_validate(asignacion)


# ---------------------------------------------------------------------------
# Contrato 33 -- PATCH /delivery/{assignment_id}
# ---------------------------------------------------------------------------

@router.patch("/{assignment_id}", response_model=DeliveryAssignmentSalida)
async def avanzar_estado_reparto(
    assignment_id: UUID,
    body: AvanzarEstadoEntrada,
    db: AsyncSession = Depends(get_db),
) -> DeliveryAssignmentSalida:
    """Avanza el estado de una asignacion de reparto.

    Transiciones validas:
      ASIGNADO -> EN_CAMINO
      EN_CAMINO -> ENTREGADO | NO_ENTREGADO

    Los estados ENTREGADO y NO_ENTREGADO son terminales (RN-MS02-03).
    """
    asignacion = await db.get(DeliveryAssignment, assignment_id)
    if asignacion is None:
        raise HTTPException(status_code=404, detail="Asignacion de reparto no encontrada")

    # RN-MS02-03: verificar que no sea un estado terminal.
    if asignacion.estado in ESTADOS_TERMINALES:
        raise HTTPException(
            status_code=422,
            detail=f"La asignacion esta en estado terminal '{asignacion.estado}'. "
                   "No puede avanzar mas.",
        )

    # Verificar transicion valida.
    estados_siguientes = _TRANSICIONES_VALIDAS.get(asignacion.estado, [])
    if body.estado not in estados_siguientes:
        raise HTTPException(
            status_code=422,
            detail=f"Transicion invalida: {asignacion.estado} -> {body.estado}. "
                   f"Transiciones validas desde '{asignacion.estado}': "
                   f"{', '.join(estados_siguientes) or 'ninguna (estado terminal)'}.",
        )

    ahora = utcnow()
    asignacion.estado = body.estado
    asignacion.updated_at = ahora

    if body.notas:
        asignacion.notas = body.notas

    # Sellar timestamps de transicion (RN-MS02-04).
    if body.estado == "EN_CAMINO":
        asignacion.en_camino_at = ahora
    elif body.estado in ("ENTREGADO", "NO_ENTREGADO"):
        asignacion.entregado_at = ahora

    await db.commit()
    await db.refresh(asignacion)

    return DeliveryAssignmentSalida.model_validate(asignacion)
