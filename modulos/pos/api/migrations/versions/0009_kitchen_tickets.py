"""Cola de cocina: `kitchen_tickets` — MS-01.

Revision ID: 0009_kitchen_tickets
Revises: 0008_ticket_item_name
Create Date: 2026-10-20

Por qué existe esta migración (MS-01 — Pantalla de Cocina):
  El POS de R de Rico no tenía pantalla de cocina: el cajero anotaba
  en papel o gritaba los pedidos. MS-01 crea la tabla `kitchen_tickets`
  que materializa una proyección ligera de cada ticket enviado a cocina.

  Ciclo de vida:
    RECIBIDO → EN_PREP → LISTO

  Cuando el estado llega a LISTO, el campo `listo_at` se sella. El POS
  puede detectar pedidos listos en el polling del pizarrón.

Reglas duras que respeta:
  C-01  PK UUID.
  C-02  `created_at` / `updated_at` / `listo_at` en DateTime(timezone=True).
  A-02  La pantalla de cocina NO hace JOIN con `tickets`: lee `lineas_json`
        (proyección pre-materializada en JSONB).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_kitchen_tickets"
down_revision: Union[str, None] = "0008_ticket_item_name"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "kitchen_tickets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        # FK de trazabilidad — NOT NULL y UNIQUE (1 ticket → 1 kitchen_ticket).
        sa.Column(
            "ticket_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tickets.id"),
            nullable=False,
        ),
        # Folio de presentación (V####).
        sa.Column("account_num", sa.String(), nullable=False),
        # Nombre del cliente (puede ser None para venta directa).
        sa.Column("customer_name", sa.String(), nullable=True),
        # Canal: PANADERIA, HELADERIA, REPARTO, etc.
        sa.Column("channel", sa.String(), nullable=False, server_default="PANADERIA"),
        # Estado del ciclo de vida de cocina.
        sa.Column(
            "kitchen_status",
            sa.String(),
            nullable=False,
            server_default="RECIBIDO",
        ),
        # Líneas resumidas para la pantalla de cocina (sin JOINs):
        # [{"name": "Pan dulce", "quantity": 3}, ...]
        sa.Column(
            "lineas_json",
            postgresql.JSONB(),
            nullable=True,
            server_default="[]",
        ),
        # Notas del pedido.
        sa.Column("notas", sa.String(), nullable=True),
        # Cuándo llegó a cocina.
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        # Cuándo cambió de estado por última vez.
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        # Cuándo fue marcado LISTO (para notificación al POS).
        sa.Column("listo_at", sa.DateTime(timezone=True), nullable=True),
    )

    # La consulta más frecuente de la pantalla de cocina: "¿qué está pendiente?"
    op.create_index(
        "ix_kitchen_tickets_kitchen_status",
        "kitchen_tickets",
        ["kitchen_status"],
    )
    # UNIQUE implícito en la columna ticket_id ya crea índice, pero lo nombramos.
    op.create_unique_constraint(
        "uq_kitchen_tickets_ticket_id",
        "kitchen_tickets",
        ["ticket_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_kitchen_tickets_ticket_id", "kitchen_tickets", type_="unique"
    )
    op.drop_index("ix_kitchen_tickets_kitchen_status", table_name="kitchen_tickets")
    op.drop_table("kitchen_tickets")
