"""La cola de salida de notificaciones: `notification_outbox` — FASE 12.22.

Revision ID: 0005_notification_outbox
Revises: 0004_pos_audit_log
Create Date: 2026-10-08

Por qué existe esta migración (F12.22 — el hueco real del contrato 27):
  El contrato 27 (`notificaciones.encolar_ticket`) estaba DECLARADO en
  `contracts/registry.py` desde la FASE 8.0, pero NUNCA se implementó: no había
  router, ni endpoint, ni modelo, ni servicio. El `TicketDeliveryPanel` del POS
  llamaba a `POST /notifications/enqueue-ticket` y recibía 404, así que los
  botones de WhatsApp y email SIEMPRE fallaban.

  Esta tabla es la cola Outbox (Regla de Oro #7, RN-85/RN-86): el POS escribe
  aquí DENTRO de la transacción del ticket; un worker externo (módulo
  Notificaciones) la lee después y hace el envío real.

Reglas duras que respeta:
  C-01  PK UUID (identidad global), nunca entero.
  C-02  `creado_en`/`enviado_en` en DateTime(timezone=True) — UTC (RN-78).
  RN-86 `evento_id` UNIQUE: idempotencia del encolado (reintentar no duplica).
  RN-89 `canal` es WHATSAPP | EMAIL.
  RN-90 `destino` es el teléfono o correo validado por el servicio.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# Identificadores de revisión, usados por Alembic.
revision: str = "0005_notification_outbox"
down_revision: Union[str, None] = "0004_pos_audit_log"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notification_outbox",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        # RN-86 — clave de idempotencia. El POS la deriva del folio del ticket.
        sa.Column("evento_id", sa.String(), nullable=False),
        # El ticket cuyo comprobante se envía. Nullable: el POS siempre lo tiene,
        # pero el contrato lo permite ausente.
        sa.Column("ticket_uuid", postgresql.UUID(as_uuid=True), nullable=True),
        # RN-89 — canal de envío: WHATSAPP | EMAIL.
        sa.Column("canal", sa.String(), nullable=False),
        # RN-90 — destino: teléfono (WhatsApp) o correo (email).
        sa.Column("destino", sa.String(), nullable=False),
        # El comprobante a enviar (folio, total, items, fecha).
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default="{}"),
        # PENDIENTE | ENVIADO | FALLIDO.
        sa.Column(
            "estado", sa.String(), nullable=False, server_default="PENDIENTE"
        ),
        # Motivo del último fallo (diagnóstico del worker). NULL si no falló.
        sa.Column("error", sa.Text(), nullable=True),
        # RN-78 — UTC con tzinfo.
        sa.Column("creado_en", sa.DateTime(timezone=True), nullable=False),
        sa.Column("enviado_en", sa.DateTime(timezone=True), nullable=True),
    )
    # RN-86 — la idempotencia del encolado.
    op.create_unique_constraint(
        "uq_notification_outbox_evento_id", "notification_outbox", ["evento_id"]
    )
    # El worker consulta "qué está pendiente", ordenado por antigüedad.
    op.create_index(
        "ix_notification_outbox_estado", "notification_outbox", ["estado"]
    )


def downgrade() -> None:
    op.drop_index("ix_notification_outbox_estado", table_name="notification_outbox")
    op.drop_constraint(
        "uq_notification_outbox_evento_id",
        "notification_outbox",
        type_="unique",
    )
    op.drop_table("notification_outbox")
