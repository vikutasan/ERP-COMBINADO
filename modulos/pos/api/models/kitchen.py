"""Cola de cocina — MS-01.

Tabla: `kitchen_tickets`.

Cada fila representa un ticket que el cajero "envió a cocina" (su `order_status`
pasó a `EN_COCINA`). La cocina avanza el estado:

  RECIBIDO → EN_PREP → LISTO

Cuando el estado llega a LISTO, el POS puede notificar al cajero.

Diseño deliberado:
  - NO hereda de `Ticket`. Es una proyección ligera: solo los campos que
    la pantalla de cocina necesita (folio, cliente, líneas resumidas).
  - Las líneas se guardan como JSONB (`lineas_json`): la cocina no necesita
    JOINs, solo saber qué preparar. Esto elimina una dependencia de `ticket_items`
    desde un contexto de tiempo real.
  - FK a `tickets.id` para trazabilidad, pero la pantalla de cocina NUNCA
    consulta `tickets` directamente (frontera A-02).
"""

from __future__ import annotations

import uuid

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.base import Base
from core.timestamps import utcnow

# Estados válidos del ciclo de vida de cocina (MS-01).
ESTADOS_COCINA = ("RECIBIDO", "EN_PREP", "LISTO")


class KitchenTicket(Base):
    """Proyección de un ticket en la pantalla de cocina."""

    __tablename__ = "kitchen_tickets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # FK de trazabilidad — NO se usa para JOIN en la pantalla de cocina.
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id"),
        nullable=False,
        unique=True,
        index=True,
    )
    # Folio de presentación (V####) — solo para mostrar en pantalla de cocina.
    account_num: Mapped[str] = mapped_column(String, nullable=False)
    # Nombre del cliente si identificado (puede ser None para venta directa).
    customer_name: Mapped[str | None] = mapped_column(String, nullable=True)
    # Canal: PANADERIA, HELADERIA, REPARTO, etc.
    channel: Mapped[str] = mapped_column(String, nullable=False, default="PANADERIA")
    # Estado del ciclo de vida de cocina.
    # Transición válida: RECIBIDO → EN_PREP → LISTO
    kitchen_status: Mapped[str] = mapped_column(
        String, nullable=False, default="RECIBIDO", index=True
    )
    # Líneas resumidas para la pantalla de cocina (sin JOINs):
    # [{"name": "Pan dulce", "quantity": 3}, ...]
    lineas_json: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # Notas del pedido (order_notes del ticket).
    notas: Mapped[str | None] = mapped_column(String, nullable=True)
    # Cuándo llegó a cocina.
    created_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    # Cuándo cambió de estado por última vez.
    updated_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
    # Cuándo fue marcado LISTO (para notificación al POS).
    listo_at: Mapped[object | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
