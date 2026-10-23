"""La columna `item_id` en `ticket_items`: cierre de la deuda D-9.

Revision ID: 0006_ticket_item_id
Revises: 0005_notification_outbox
Create Date: 2026-10-11

Por qué existe esta migración (cierre de la deuda D-9):
  El contrato 18 (`POST /pos/tickets/{id}/items`) promete IDEMPOTENCIA por
  `item_id`: reenviar la misma intención (reintento de red, doble clic) NO debe
  duplicar la línea. Pero `ticket_items` no tenía columna `item_id`: el servidor
  guardaba las intenciones ya procesadas en un ledger PRESTADO,
  `payment_details["_item_ids"]` (JSONB).

  Ese ledger era una bomba de tiempo: `cobrar_ticket` REEMPLAZA
  `payment_details` con `_normalizar_pagos(...)`, que construye un dict NUEVO a
  partir del dict que llega del cliente — y el cliente NUNCA envía `_item_ids`.
  Resultado: el cobro BORRABA el ledger. Un reintento posterior del mismo
  `item_id` no se detectaba → línea duplicada, total inflado, cobro de más,
  SILENCIOSO.

  Esta migración mueve la idempotencia al MOTOR: una columna propia con
  restricción única POR TICKET. Ya no depende de que nadie reescriba un dict.

Reglas duras que respeta:
  C-01  `item_id` es identidad de la línea (String, no entero).
  Contrato 18 — idempotencia por `item_id`, ahora garantizada por el motor.
  RN-17 — la fusión por `product_id` NO se toca: es un mecanismo distinto.

Estrategia (sin romper datos existentes):
  1. Agrega la columna `item_id` NULLABLE.
  2. BACKFILL: `item_id = product_id::text` para las filas viejas. Es
     determinista y coincide EXACTAMENTE con lo que `_lineas_atomicas` ya
     derivaba → cero cambio de comportamiento para los datos existentes.
  3. `SET NOT NULL`.
  4. Crea el índice único `uq_ticket_items_ticket_item_id (ticket_id, item_id)`.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# Identificadores de revisión, usados por Alembic.
revision: str = "0006_ticket_item_id"
down_revision: Union[str, None] = "0005_notification_outbox"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Columna nullable (para no romper las filas existentes).
    op.add_column(
        "ticket_items",
        sa.Column("item_id", sa.String(), nullable=True),
    )

    # 2. BACKFILL determinista: el `item_id` derivado que `_lineas_atomicas`
    #    ya usaba era `str(product_id)`. Se replica aquí para que los datos
    #    viejos conserven EXACTAMENTE el comportamiento anterior.
    op.execute(
        "UPDATE ticket_items SET item_id = product_id::text WHERE item_id IS NULL"
    )

    # 3. Ahora que todas las filas tienen valor, la columna es obligatoria.
    op.alter_column("ticket_items", "item_id", nullable=False)

    # 4. Índice de apoyo para la consulta de idempotencia (WHERE ticket_id AND
    #    item_id) y restricción única POR TICKET: el motor rechaza el duplicado.
    op.create_index("ix_ticket_items_item_id", "ticket_items", ["item_id"])
    op.create_unique_constraint(
        "uq_ticket_items_ticket_item_id",
        "ticket_items",
        ["ticket_id", "item_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_ticket_items_ticket_item_id", "ticket_items", type_="unique"
    )
    op.drop_index("ix_ticket_items_item_id", table_name="ticket_items")
    op.drop_column("ticket_items", "item_id")
