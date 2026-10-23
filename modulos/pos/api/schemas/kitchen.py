"""Esquemas de la cola de cocina — MS-01 (Contrato 28)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class LineaCocinaSchema(BaseModel):
    """Una línea de producto en la pantalla de cocina."""

    name: str
    quantity: int


class KitchenTicketSalida(BaseModel):
    """Un ticket en la cola de cocina (Contrato 28).

    PROYECCIÓN ligera: solo los campos que la pantalla de cocina necesita.
    Las líneas vienen pre-materializadas en `lineas` (sin JOIN).
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ticket_id: UUID
    account_num: str
    customer_name: str | None = None
    channel: str
    kitchen_status: str
    lineas: list[LineaCocinaSchema] = Field(default_factory=list)
    notas: str | None = None
    created_at: datetime
    updated_at: datetime
    listo_at: datetime | None = None


class KitchenQueueSalida(BaseModel):
    """Salida del endpoint GET /orders/kitchen-queue (Contrato 28)."""

    tickets: list[KitchenTicketSalida] = Field(default_factory=list)
    total: int = 0


class ActualizarEstadoCocinaEntrada(BaseModel):
    """Entrada del endpoint PATCH /orders/kitchen-queue/{id} (Contrato 29).

    Solo se permite avanzar el estado en la dirección válida:
    RECIBIDO → EN_PREP → LISTO
    """

    kitchen_status: str = Field(
        ...,
        description="Nuevo estado: EN_PREP o LISTO",
        pattern="^(EN_PREP|LISTO)$",
    )


class ActualizarEstadoCocinaRespuesta(BaseModel):
    """Respuesta del PATCH — el ticket actualizado."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    kitchen_status: str
    updated_at: datetime
    listo_at: datetime | None = None
