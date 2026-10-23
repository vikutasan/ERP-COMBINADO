"""El ledger de intenciones `ticket_item_intents`: cierre de la deuda D-9.

Revision ID: 0007_ticket_item_intents
Revises: 0006_ticket_item_id
Create Date: 2026-10-11

Por qué existe esta migración (corrección del cierre de la deuda D-9):

  La migración 0006 agregó `ticket_items.item_id` con unicidad POR TICKET y
  movió la idempotencia del contrato 18 a esa columna. Al correr la suite se
  descubrió que una COLUMNA POR LÍNEA no basta: RN-17 FUSIONA por `product_id`,
  así que dos intenciones distintas del MISMO producto producen UNA sola línea.
  La columna solo puede recordar UNA de las dos intenciones; el reintento de la
  otra volvía a fusionar y duplicaba la cantidad.

  La idempotencia del contrato 18 es sobre el CONJUNTO de intenciones
  procesadas, no sobre una por línea. Esta migración crea el ledger que lo
  representa, con unicidad garantizada por el MOTOR.

  `ticket_items.item_id` SE CONSERVA: es la IDENTIDAD de la línea (la intención
  que la creó), y es lo que `_lineas_atomicas` devuelve y el cliente usa para
  direccionar la línea en PATCH/DELETE (contratos 19/20). Son dos cosas
  distintas: identidad de la línea vs. conjunto de intenciones del ticket.

Reglas duras que respeta:
  C-01  PK UUID (identidad global).
  C-02  `created_at` con zona horaria UTC.
  Contrato 18 — idempotencia por `item_id`, ahora garantizada por el motor.
  RN-17 — la fusión por `product_id` NO se toca: es un mecanismo distinto.

Estrategia (sin romper datos existentes):
  1. Crea la tabla `ticket_item_intents`.
  2. BACKFILL: siembra una intención por cada línea existente
     (`item_id = ticket_items.item_id`). Es determinista y coincide con lo que
     la columna de la 0006 ya guardaba → cero cambio de comportamiento.
  3. Crea el índice único `uq_ticket_item_intents_ticket_item_id`.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# Identificadores de revisión, usados por Alembic.
revision: str = "0007_ticket_item_intents"
down_revision: Union[str, None] = "0006_ticket_item_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. La tabla del ledger de intenciones.
    op.create_table(
        "ticket_item_intents",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "ticket_id",
            sa.UUID(as_uuid=True),
            # ON DELETE CASCADE: una intención no tiene sentido sin su ticket.
            sa.ForeignKey("tickets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("item_id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # 2. BACKFILL determinista: cada línea existente aporta su intención
    #    (`ticket_items.item_id`, sembrado por la 0006). Así los tickets viejos
    #    conservan EXACTAMENTE la idempotencia que ya tenían.
    op.execute(
        "INSERT INTO ticket_item_intents (id, ticket_id, item_id, created_at) "
        "SELECT gen_random_uuid(), ticket_id, item_id, now() FROM ticket_items"
    )

    # 3. Índices de apoyo y restricción única POR TICKET: el motor rechaza el
    #    duplicado de una intención dentro del mismo ticket.
    op.create_index(
        "ix_ticket_item_intents_ticket_id", "ticket_item_intents", ["ticket_id"]
    )
    op.create_index(
        "ix_ticket_item_intents_item_id", "ticket_item_intents", ["item_id"]
    )
    op.create_unique_constraint(
        "uq_ticket_item_intents_ticket_item_id",
        "ticket_item_intents",
        ["ticket_id", "item_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_ticket_item_intents_ticket_item_id",
        "ticket_item_intents",
        type_="unique",
    )
    op.drop_index(
        "ix_ticket_item_intents_item_id", table_name="ticket_item_intents"
    )
    op.drop_index(
        "ix_ticket_item_intents_ticket_id", table_name="ticket_item_intents"
    )
    op.drop_table("ticket_item_intents")
