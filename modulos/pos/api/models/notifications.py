"""La cola de salida de notificaciones (notification_outbox) — FASE 12.22.

Tabla: `notification_outbox`.

Patrón Outbox (Regla de Oro #7, RN-85/RN-86): el POS NUNCA envía el ticket
directamente. Escribe una fila en esta tabla DENTRO de la transacción del
ticket; un worker externo (módulo Notificaciones) la lee después y hace el
envío real por WhatsApp/email.

Por qué una tabla y no una llamada HTTP directa:
  - RN-85: el POS solo ENCOLA. Si el proveedor de WhatsApp está caído, la
    venta NO se bloquea ni se revierte (DT-07).
  - RN-86: el encolado ocurre en la MISMA transacción del ticket. O se guarda
    el ticket y su envío pendiente, o no se guarda nada.
  - Idempotencia: `evento_id` es único. Si el cajero reintenta el envío del
    mismo ticket, no se duplica la fila (el worker envía una sola vez).

Frontera (A-02): esta tabla es del módulo Notificaciones. El POS la escribe
solo a través del contrato 27 (`POST /notifications/enqueue-ticket`), nunca
conociendo el worker ni el proveedor externo.
"""

from __future__ import annotations

import uuid

from sqlalchemy import DateTime, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.base import Base
from core.timestamps import utcnow


class NotificationOutbox(Base):
    """Un envío de ticket pendiente (o ya enviado) por un canal.

    El ciclo de vida del `estado` es:
      PENDIENTE → ENVIADO   (el worker lo envió con éxito)
      PENDIENTE → FALLIDO   (el worker agotó los reintentos)
    """

    __tablename__ = "notification_outbox"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Clave de idempotencia (RN-86). El POS la deriva del folio del ticket
    # (`ticket:V0001`), así que reintentar el mismo envío no duplica la fila.
    evento_id: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    # El ticket cuyo comprobante se envía. Puede ser NULL si el ticket aún no
    # tenía id al momento de encolar (caso raro: el POS siempre lo tiene).
    ticket_uuid: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    # Canal de envío: WHATSAPP | EMAIL (RN-89).
    canal: Mapped[str] = mapped_column(String, nullable=False)
    # Destino: teléfono (WhatsApp) o correo (email). Validado por RN-90.
    destino: Mapped[str] = mapped_column(String, nullable=False)
    # El comprobante a enviar (folio, total, items, fecha). JSONB para que el
    # worker lo consuma sin acoplarse al esquema del ticket.
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # PENDIENTE | ENVIADO | FALLIDO.
    estado: Mapped[str] = mapped_column(String, nullable=False, default="PENDIENTE")
    # Motivo del último fallo (para diagnóstico del worker). NULL si no falló.
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    creado_en: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    enviado_en: Mapped[object | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("evento_id", name="uq_notification_outbox_evento_id"),
    )
