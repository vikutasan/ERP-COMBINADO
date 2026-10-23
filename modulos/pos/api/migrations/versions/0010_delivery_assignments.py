"""Tabla de asignaciones de reparto: `delivery_assignments` -- MS-02.

Revision ID: 0010_delivery_assignments
Revises: 0009_kitchen_tickets
Create Date: 2026-10-21

Por que existe esta migracion (MS-02 -- Modulo de Reparto):
  Antes de MS-02, el POS registraba la direccion de entrega en `orders`
  pero no habia un mecanismo para asignar un repartidor ni rastrear
  el estado de la entrega en tiempo real.

  Esta tabla materializa la asignacion de un repartidor a un pedido
  y rastrea el ciclo de vida de la entrega:

    ASIGNADO -> EN_CAMINO -> ENTREGADO
                          |-> NO_ENTREGADO (fallo de entrega)

  Relacion: 1 order -> 0..1 delivery_assignment (un pedido puede no
  tener reparto si el cliente recoge en tienda).

Reglas duras que respeta:
  C-01  PK UUID.
  C-02  timestamps en DateTime(timezone=True).
  C-03  El costo de entrega va en Numeric(12,2), no Float.
  RN-MS02-01  Un pedido solo puede tener una asignacion activa a la vez.
  RN-MS02-02  Solo pedidos con delivery_type='DOMICILIO' pueden tener
              asignacion de reparto.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_delivery_assignments"
down_revision: Union[str, None] = "0009_kitchen_tickets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "delivery_assignments",
        # PK UUID (C-01).
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        # FK al pedido -- UNIQUE (un pedido, una asignacion activa).
        sa.Column(
            "order_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orders.id"),
            nullable=False,
        ),
        # Nombre del repartidor (texto libre por ahora; futuro: FK a tabla staff).
        sa.Column("repartidor_nombre", sa.String(), nullable=False),
        # Telefono de contacto del repartidor.
        sa.Column("repartidor_telefono", sa.String(), nullable=True),
        # Estado del ciclo de vida de la entrega.
        # Valores: ASIGNADO | EN_CAMINO | ENTREGADO | NO_ENTREGADO
        sa.Column(
            "estado",
            sa.String(),
            nullable=False,
            server_default="ASIGNADO",
        ),
        # Notas del repartidor (incidencias, instrucciones especiales).
        sa.Column("notas", sa.Text(), nullable=True),
        # Cuando se asigno el repartidor.
        sa.Column("asignado_at", sa.DateTime(timezone=True), nullable=False),
        # Cuando salio a entregar (estado -> EN_CAMINO).
        sa.Column("en_camino_at", sa.DateTime(timezone=True), nullable=True),
        # Cuando se confirmo la entrega (estado -> ENTREGADO).
        sa.Column("entregado_at", sa.DateTime(timezone=True), nullable=True),
        # Timestamps estandar (C-02).
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    # Indice por estado: la pantalla de reparto filtra por ASIGNADO y EN_CAMINO.
    op.create_index(
        "ix_delivery_assignments_estado",
        "delivery_assignments",
        ["estado"],
    )

    # Indice por order_id para busquedas rapidas.
    op.create_index(
        "ix_delivery_assignments_order_id",
        "delivery_assignments",
        ["order_id"],
    )

    # UNIQUE en order_id: un pedido -> una sola asignacion activa (RN-MS02-01).
    op.create_unique_constraint(
        "uq_delivery_assignments_order_id",
        "delivery_assignments",
        ["order_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_delivery_assignments_order_id", "delivery_assignments", type_="unique"
    )
    op.drop_index("ix_delivery_assignments_order_id", table_name="delivery_assignments")
    op.drop_index("ix_delivery_assignments_estado", table_name="delivery_assignments")
    op.drop_table("delivery_assignments")
