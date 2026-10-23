"""Agrega products.available y products.unit_of_sale -- cierre de brechas GP->POS.

Revision ID: 0012_products_available_unit
Revises: 0011_sync_and_central
Create Date: 2026-10-23

Por que existe esta migracion (FASE 1.11 del ERP COMBINADO):
  El modelo `models/catalog.py` declara dos columnas que la migracion
  `0001_initial_schema` nunca creo:

    1. `available`      -- NC-GP-07, disponibilidad temporal sin descontinuar.
    2. `unit_of_sale`   -- NC-GP-04, unidad de venta (PZA, KG, LT, DOC, CAJA...).

  Consecuencia real observada: `GET /catalog/products-for-sale` devolvia 500
  con `UndefinedColumnError: column products.available does not exist`, y el
  POS no podia pintar la grilla de productos.

  Se corrige con una migracion NUEVA (0012) y no editando la 0001, porque la
  0001 ya fue aplicada sobre `erp_pos` y reescribir historia de migraciones
  rompe cualquier base ya desplegada.

Reglas que respeta:
  RT-02  Booleanos y strings, sin dinero involucrado.
  RT-03  Cero codigo basura: solo las dos columnas que el modelo ya declara.
  CONTRATO_PRODUCTO_TRANSVERSAL
         `available=false` oculta el producto en el POS pero lo deja visible
         en la administracion de Gestion de Productos.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012_products_available_unit"
down_revision: Union[str, None] = "0011_sync_and_central"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NC-GP-07: disponibilidad temporal. Default TRUE para que los productos
    # existentes sigan siendo vendibles sin tocar datos.
    op.add_column(
        "products",
        sa.Column(
            "available",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    # NC-GP-04: unidad de venta. Default PZA (pieza), la unidad mas comun.
    op.add_column(
        "products",
        sa.Column(
            "unit_of_sale",
            sa.String(length=10),
            nullable=False,
            server_default="PZA",
        ),
    )
    # Indice para el filtro del POS: WHERE active AND available.
    op.create_index(
        "ix_products_active_available",
        "products",
        ["active", "available"],
    )


def downgrade() -> None:
    op.drop_index("ix_products_active_available", table_name="products")
    op.drop_column("products", "unit_of_sale")
    op.drop_column("products", "available")
