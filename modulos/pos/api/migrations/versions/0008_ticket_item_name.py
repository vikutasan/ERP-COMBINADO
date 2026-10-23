"""Añade columna name a ticket_items — F12.6b

La columna se congela al momento de la venta (igual que unit_price):
el ticket impreso siempre muestra el nombre que tenía el producto al
venderse, aunque después sea editado o eliminado del catálogo.

Revision ID: 0008_ticket_item_name
Revises: 0007_ticket_item_intents
Create Date: 2026-10-15
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008_ticket_item_name"
down_revision: Union[str, None] = "0007_ticket_item_intents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Añade la columna name (nullable) a ticket_items.

    Nullable para compatibilidad retroactiva: los tickets ya existentes
    sin nombre imprimirán 'Artículo' (fallback en el generador del ticket).
    """
    op.add_column(
        "ticket_items",
        sa.Column("name", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ticket_items", "name")
