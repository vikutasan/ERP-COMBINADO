"""Esquemas de notificaciones — Contrato 27 (FASE 12.22) (FD-03)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class EncolarTicketEntrada(BaseModel):
    """Entrada del contrato 27: encolar el envío del ticket (Outbox).

    La firma está ALINEADA con lo que el POS realmente envía. El contrato
    declarado originalmente describía una operación de UN canal; el POS encola
    VARIOS canales de una vez.

    Reglas que respeta:
      - RN-86: `evento_id` es la clave de idempotencia. Obligatorio.
      - RN-89: cada canal debe ser WHATSAPP o EMAIL.
      - RN-90: el destino debe corresponder al canal (teléfono o email).
    """

    evento_id: str = Field(min_length=1)
    ticket_uuid: UUID | None = None
    canales: list[str] = Field(default_factory=list)
    destinatario: dict[str, Any] = Field(default_factory=dict)
    payload: dict[str, Any] = Field(default_factory=dict)


class MensajeEncoladoSalida(BaseModel):
    """El resultado del encolado de UN canal."""

    canal: str
    estado: str
    envio_id: UUID


class EncolarTicketSalida(BaseModel):
    """Salida del contrato 27: el resultado del encolado.

    `encolado` es True si al menos un canal quedó en la cola. `mensajes` detalla
    cada canal con su `envio_id` (el id de la fila del outbox).
    """

    encolado: bool
    mensajes: list[MensajeEncoladoSalida] = Field(default_factory=list)
