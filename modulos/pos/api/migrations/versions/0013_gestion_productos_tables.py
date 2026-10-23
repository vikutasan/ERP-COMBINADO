"""Crea las tablas de Gestion de Productos (NC-GP-01, NC-GP-02, NC-GP-05).

ADAPTACION ERP COMBINADO:
  En el NUEVO-ERP original `products.id` era INTEGER y estas tablas declaraban
  `product_id` como Integer. En el ERP COMBINADO el catalogo usa UUID como PK
  (ADR-GP-04 / REGLA 15), por lo que `product_id` se crea como UUID. Sin esta
  adaptacion PostgreSQL rechaza la FK con `DatatypeMismatchError: Key columns
  "product_id" and "id" are of incompatible types: integer and uuid`.

Revision ID: 0013_gestion_productos
Revises: 0012_products_available_unit
Create Date: 2026-10-23

Por que existe esta migracion (FASE 2.3b del ERP COMBINADO):
  El archivo `models/gestion_productos.py` declara CUATRO objetos de esquema
  que ninguna migracion anterior creo:

    1. `product_price_history`  -- NC-GP-01, ledger inmutable de precios.
    2. `product_tags`           -- NC-GP-05, etiquetas transversales.
    3. `product_tag_map`        -- NC-GP-05, tabla puente M2M producto<->tag.
    4. `product_variants`       -- NC-GP-02, variantes (Chico/Mediano/Grande).

  Consecuencia real observada: `GET /catalog/products-for-sale` devolvia 500
  con `UndefinedTableError: relation "product_variants" does not exist`
  (routers/catalog.py:105). El POS no podia pintar la grilla de productos
  aunque el catalogo ya estaba importado (392 productos, FASE 2.3).

  Se corrige con una migracion NUEVA (0013) y no editando la 0001, porque la
  0001 ya fue aplicada sobre `erp_pos` y reescribir historia de migraciones
  rompe cualquier base ya desplegada.

Orden de creacion (obligatorio por las FKs):
  1. `product_tags`           (sin dependencias)
  2. `product_variants`       (FK -> products)
  3. `product_price_history`  (FK -> products)
  4. `product_tag_map`        (FK -> products y -> product_tags)

Reglas que respeta:
  RT-01  `changed_at` es TIMESTAMPTZ (DateTime(timezone=True)) -- UTC siempre.
  RT-02  `price`, `cost` y `price_modifier` son NUMERIC(12,2), nunca FLOAT.
  RT-03  UUID como PK en `product_tags` y `product_variants`; cero basura.
  RT-04  `product_price_history` es APPEND-ONLY: no se crea ningun indice ni
         trigger de UPDATE/DELETE; la inmutabilidad la garantiza el servicio.
  CONTRATO_PRODUCTO_TRANSVERSAL
         `product_price_history` es append-only y `price_modifier` es un delta
         sobre el precio base del producto padre, nunca un precio absoluto.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013_gestion_productos"
down_revision: Union[str, None] = "0012_products_available_unit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. product_tags -- NC-GP-05
    # ------------------------------------------------------------------
    op.create_table(
        "product_tags",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "name",
            sa.String(length=50),
            nullable=False,
            comment="Slug del tag: 'sin-gluten', 'vegano', 'temporada-navidad'.",
        ),
        sa.Column(
            "color",
            sa.String(length=20),
            nullable=True,
            comment="Color del chip en UI (hex o clase CSS). Opcional.",
        ),
    )
    # unique=True + index=True en el modelo => indice UNIQUE con nombre.
    op.create_index(
        "ix_product_tags_name",
        "product_tags",
        ["name"],
        unique=True,
    )

    # ------------------------------------------------------------------
    # 2. product_variants -- NC-GP-02
    # ------------------------------------------------------------------
    op.create_table(
        "product_variants",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "variant_name",
            sa.String(length=80),
            nullable=False,
            comment="Ej: 'Chico', 'Mediano', 'Grande', '250g', 'Con extra queso'.",
        ),
        sa.Column(
            "price_modifier",
            sa.Numeric(precision=12, scale=2),
            nullable=False,
            server_default="0",
            comment="Delta sobre el precio base. RT-02: NUMERIC, no FLOAT.",
        ),
        sa.Column(
            "is_default",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
            comment="True si esta variante es la opcion por defecto en el POS.",
        ),
        sa.Column(
            "sort_order",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="Orden de presentacion (ASC).",
        ),
        sa.Column(
            "active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
            comment="Variante inactiva no aparece en el POS.",
        ),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name="fk_variants_product",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_product_variants_product_id",
        "product_variants",
        ["product_id"],
    )

    # ------------------------------------------------------------------
    # 3. product_price_history -- NC-GP-01 (APPEND-ONLY)
    # ------------------------------------------------------------------
    op.create_table(
        "product_price_history",
        sa.Column(
            "id",
            sa.Integer(),
            primary_key=True,
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "price",
            sa.Numeric(precision=12, scale=2),
            nullable=False,
            comment="Precio publico al momento del cambio. RT-02: NUMERIC, no FLOAT.",
        ),
        sa.Column(
            "cost",
            sa.Numeric(precision=12, scale=2),
            nullable=True,
            comment="Costo al momento del cambio. RT-02: NUMERIC, no FLOAT.",
        ),
        sa.Column(
            "changed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            comment="RT-01: Timestamp UTC del momento del cambio.",
        ),
        sa.Column(
            "changed_by",
            sa.String(length=120),
            nullable=True,
            comment="Usuario que realizo el cambio de precio.",
        ),
        sa.Column(
            "reason",
            sa.String(length=255),
            nullable=True,
            comment="Motivo del cambio (opcional): 'Ajuste temporada', 'Error', etc.",
        ),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name="fk_price_history_product",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_product_price_history_product_id",
        "product_price_history",
        ["product_id"],
    )

    # ------------------------------------------------------------------
    # 4. product_tag_map -- NC-GP-05 (M2M, PK compuesta)
    # ------------------------------------------------------------------
    op.create_table(
        "product_tag_map",
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "tag_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name="fk_tag_map_product",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tag_id"],
            ["product_tags.id"],
            name="fk_tag_map_tag",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("product_id", "tag_id"),
    )


def downgrade() -> None:
    # Orden inverso al de creacion para respetar las FKs.
    op.drop_table("product_tag_map")
    op.drop_index("ix_product_price_history_product_id", table_name="product_price_history")
    op.drop_table("product_price_history")
    op.drop_index("ix_product_variants_product_id", table_name="product_variants")
    op.drop_table("product_variants")
    op.drop_index("ix_product_tags_name", table_name="product_tags")
    op.drop_table("product_tags")
