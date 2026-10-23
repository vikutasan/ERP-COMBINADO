"""Esquemas del modulo de reparto -- MS-02."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Entrada: asignar repartidor a un pedido
# ---------------------------------------------------------------------------

class AsignarRepartidorEntrada(BaseModel):
    """Entrada del POST /delivery/assign -- asigna un repartidor a un pedido."""

    order_id: UUID = Field(..., description="UUID del pedido a asignar")
    repartidor_nombre: str = Field(..., min_length=2, max_length=120)
    repartidor_telefono: str | None = Field(None, max_length=20)
    notas: str | None = Field(None, max_length=500)


# ---------------------------------------------------------------------------
# Entrada: avanzar estado de una asignacion
# ---------------------------------------------------------------------------

class AvanzarEstadoEntrada(BaseModel):
    """Entrada del PATCH /delivery/{assignment_id}.

    Solo se permiten transiciones hacia adelante:
      ASIGNADO -> EN_CAMINO -> ENTREGADO | NO_ENTREGADO
    """

    estado: str = Field(
        ...,
        description="Nuevo estado: EN_CAMINO | ENTREGADO | NO_ENTREGADO",
        pattern="^(EN_CAMINO|ENTREGADO|NO_ENTREGADO)$",
    )
    notas: str | None = Field(None, max_length=500)


# ---------------------------------------------------------------------------
# Salida: asignacion de reparto
# ---------------------------------------------------------------------------

class DeliveryAssignmentSalida(BaseModel):
    """Representacion de una asignacion de reparto en la API."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    order_id: UUID
    repartidor_nombre: str
    repartidor_telefono: str | None = None
    estado: str
    notas: str | None = None
    asignado_at: datetime
    en_camino_at: datetime | None = None
    entregado_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Salida: lista de asignaciones activas
# ---------------------------------------------------------------------------

class DeliveryQueueSalida(BaseModel):
    """Salida del GET /delivery -- lista de asignaciones activas."""

    asignaciones: list[DeliveryAssignmentSalida] = Field(default_factory=list)
    total: int = 0
