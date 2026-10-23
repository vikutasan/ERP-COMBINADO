"""Esquema inicial: las 17 tablas del POS nuevo — FASE 1.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-09-26

Aplica las 4 correcciones estructurales (Documento 8):
  C-01  PK entero → UUID
  C-02  DateTime naive → DateTime(timezone=True) UTC
  C-03  dinero en Numeric(12,2), nunca Float
  C-04  columna `version` para bloqueo optimista

Además instala el guardián del ledger: un trigger que RECHAZA cualquier
UPDATE o DELETE sobre `movimientos_inventario`. El ledger es inmutable
(CA-09 / E-12): el stock se deriva, no se sobrescribe.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# Identificadores de revisión, usados por Alembic.
revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # SECCIÓN 1 — NÚCLEO TRANSACCIONAL (POS)
    # ------------------------------------------------------------------
    op.create_table(
        "terminal_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("terminal_id", sa.String(), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index(
        "ix_terminal_sessions_terminal_id", "terminal_sessions", ["terminal_id"]
    )
    op.create_index(
        "ix_terminal_sessions_terminal_active",
        "terminal_sessions",
        ["terminal_id", "is_active"],
    )

    op.create_table(
        "cash_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("terminal_id", sa.String(), nullable=False),
        sa.Column("employee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("employee_name", sa.String(), nullable=False),
        sa.Column("opening_float", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.String(), nullable=False, server_default="OPEN"),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("physical_cash", sa.Numeric(12, 2), nullable=True),
        sa.Column("physical_credit", sa.Numeric(12, 2), nullable=True),
        sa.Column("physical_debit", sa.Numeric(12, 2), nullable=True),
    )
    op.create_index("ix_cash_sessions_terminal_id", "cash_sessions", ["terminal_id"])
    op.create_index(
        "ix_cash_sessions_terminal_status", "cash_sessions", ["terminal_id", "status"]
    )

    op.create_table(
        "categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("icon", sa.String(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=True),
        sa.Column("vision_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("heladeria_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("pos_target", sa.String(), nullable=False, server_default="PANADERIA"),
        sa.Column("heladeria_default_role", sa.String(), nullable=True),
        sa.UniqueConstraint("name", name="uq_categories_name"),
    )
    op.create_index("ix_categories_name", "categories", ["name"])
    op.create_index("ix_categories_pos_target", "categories", ["pos_target"])

    op.create_table(
        "products",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("sku", sa.String(), nullable=False),
        sa.Column("barcode", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("price", sa.Numeric(12, 2), nullable=False),
        sa.Column("cost", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("image_url", sa.String(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=True),
        sa.Column("nature", sa.String(), nullable=False, server_default="MANUFACTURADO"),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], name="fk_products_category_id_categories"),
        sa.UniqueConstraint("sku", name="uq_products_sku"),
        sa.UniqueConstraint("barcode", name="uq_products_barcode"),
    )
    op.create_index("ix_products_sku", "products", ["sku"])
    op.create_index("ix_products_barcode", "products", ["barcode"])
    op.create_index("ix_products_name", "products", ["name"])
    op.create_index("ix_products_category_active", "products", ["category_id", "active"])

    op.create_table(
        "tickets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("account_num", sa.String(), nullable=False),
        sa.Column("total", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("payment_details", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="OPEN"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("order_type", sa.String(), nullable=False, server_default="VENTA_DIRECTA"),
        sa.Column(
            "order_status",
            sa.String(),
            nullable=False,
            server_default="PROGRAMADO PARA SER PREPARADO",
        ),
        sa.Column("delivery_type", sa.String(), nullable=True),
        sa.Column("customer_name", sa.String(), nullable=True),
        sa.Column("customer_phone", sa.String(), nullable=True),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("packaging_type", sa.String(), nullable=True),
        sa.Column("delivery_address", sa.Text(), nullable=True),
        sa.Column("order_notes", sa.Text(), nullable=True),
        sa.Column("terminal_id", sa.String(), nullable=True),
        sa.Column("channel", sa.String(), nullable=False, server_default="PANADERIA"),
        sa.Column("customer_group_name", sa.String(), nullable=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("cash_session_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("captured_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("cashed_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["session_id"], ["terminal_sessions.id"], name="fk_tickets_session_id_terminal_sessions"),
        sa.ForeignKeyConstraint(["cash_session_id"], ["cash_sessions.id"], name="fk_tickets_cash_session_id_cash_sessions"),
        sa.UniqueConstraint("account_num", name="uq_tickets_account_num"),
    )
    op.create_index("ix_tickets_account_num", "tickets", ["account_num"])
    op.create_index("ix_tickets_terminal_id", "tickets", ["terminal_id"])
    op.create_index("ix_tickets_channel", "tickets", ["channel"])
    op.create_index("ix_tickets_terminal_status", "tickets", ["terminal_id", "status"])
    op.create_index("ix_tickets_channel_created", "tickets", ["channel", "created_at"])
    op.create_index("ix_tickets_cash_session", "tickets", ["cash_session_id"])

    op.create_table(
        "ticket_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("subtotal", sa.Numeric(12, 2), nullable=False),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], name="fk_ticket_items_ticket_id_tickets"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], name="fk_ticket_items_product_id_products"),
    )
    op.create_index("ix_ticket_items_ticket_id", "ticket_items", ["ticket_id"])
    op.create_index("ix_ticket_items_product_id", "ticket_items", ["product_id"])

    op.create_table(
        "terminal_locks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("terminal_id", sa.String(), nullable=False),
        sa.Column("occupier_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("occupier_name", sa.String(), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("terminal_id", name="uq_terminal_locks_terminal_id"),
    )
    op.create_index("ix_terminal_locks_terminal_id", "terminal_locks", ["terminal_id"])

    op.create_table(
        "cash_movements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("cash_session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("movement_type", sa.String(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("concept", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["cash_session_id"], ["cash_sessions.id"], name="fk_cash_movements_cash_session_id_cash_sessions"),
    )
    op.create_index("ix_cash_movements_cash_session_id", "cash_movements", ["cash_session_id"])

    # ------------------------------------------------------------------
    # SECCIÓN 3 — CATÁLOGO (ficha técnica)
    # ------------------------------------------------------------------
    op.create_table(
        "product_technical_sheets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("primary_mass_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("primary_mass_grams", sa.Float(), nullable=True),
        sa.Column("secondary_mass_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("secondary_mass_grams", sa.Float(), nullable=True),
        sa.Column("tertiary_mass_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("tertiary_mass_grams", sa.Float(), nullable=True),
        sa.Column("weight_per_piece", sa.Float(), nullable=True),
        sa.Column("baking_temp_top", sa.Float(), nullable=True),
        sa.Column("baking_temp_bottom", sa.Float(), nullable=True),
        sa.Column("baking_time_min", sa.Integer(), nullable=True),
        sa.Column("steam_seconds", sa.Integer(), nullable=True),
        sa.Column("scoring_type", sa.String(), nullable=True),
        sa.Column("forming_procedure", sa.Text(), nullable=True),
        sa.Column("bom_extra", postgresql.JSONB(), nullable=True),
        sa.Column("preparation_time_min", sa.Integer(), nullable=True),
        sa.Column("order_lead_time_hours", sa.Integer(), nullable=True),
        sa.Column("recipe_procedure", sa.Text(), nullable=True),
        sa.Column("modifiers", postgresql.JSONB(), nullable=True),
        sa.Column("provider", sa.String(), nullable=True),
        sa.Column("original_barcode", sa.String(), nullable=True),
        sa.Column("unit_measure", sa.String(), nullable=True),
        sa.Column("min_stock", sa.Integer(), nullable=True),
        sa.Column("max_stock", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], name="fk_product_technical_sheets_product_id_products"),
        sa.UniqueConstraint("product_id", name="uq_pts_product_id"),
    )

    # ------------------------------------------------------------------
    # SECCIÓN 4 — PEDIDOS
    # ------------------------------------------------------------------
    op.create_table(
        "orders",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("delivery_type", sa.String(), nullable=False, server_default="PICKUP"),
        sa.Column("status", sa.String(), nullable=False, server_default="TENTATIVO"),
        sa.Column("customer_name", sa.String(), nullable=True),
        sa.Column("customer_phone", sa.String(), nullable=True),
        sa.Column("earliest_ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("packaging_type", sa.String(), nullable=False, server_default="PROPIO"),
        sa.Column("delivery_address", sa.Text(), nullable=True),
        sa.Column("delivery_lat", sa.Float(), nullable=True),
        sa.Column("delivery_lng", sa.Float(), nullable=True),
        sa.Column("delivery_distance_km", sa.Float(), nullable=True),
        # O-16: corregido de Float a Numeric(12,2). El dinero nunca va en Float.
        sa.Column("delivery_fee", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["ticket_id"], ["tickets.id"], name="fk_orders_ticket_id_tickets"),
        sa.UniqueConstraint("ticket_id", name="uq_orders_ticket_id"),
    )
    op.create_index("ix_orders_status_committed", "orders", ["status", "committed_at"])

    # ------------------------------------------------------------------
    # SECCIÓN 5 — ALMACÉN (el ledger inmutable)
    # ------------------------------------------------------------------
    op.create_table(
        "almacenes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("nombre", sa.String(), nullable=False),
        sa.Column("zona_termica", sa.String(), nullable=False),
        sa.Column("proposito", sa.String(), nullable=False),
        sa.Column("sucursal_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("foto_url", sa.String(), nullable=True),
        sa.Column("planograma_url", sa.String(), nullable=True),
        sa.Column("pautas_acomodo", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("activo", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_almacenes_sucursal_activo", "almacenes", ["sucursal_id", "activo"])

    op.create_table(
        "stock_almacen",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("almacen_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("item_id", sa.String(), nullable=False),
        sa.Column("item_type", sa.String(), nullable=False),
        sa.Column("cantidad_actual", sa.Float(), nullable=False, server_default="0"),
        sa.Column("stock_minimo", sa.Float(), nullable=False, server_default="0"),
        sa.Column("stock_maximo", sa.Float(), nullable=False, server_default="0"),
        sa.Column("fecha_ingreso", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dias_anaquel_alerta", sa.Integer(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("ultima_actualizacion", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["almacen_id"], ["almacenes.id"], name="fk_stock_almacen_almacen_id_almacenes"),
        sa.UniqueConstraint("almacen_id", "item_id", name="uq_stock_almacen_almacen_item"),
    )
    op.create_index("ix_stock_almacen_item_id", "stock_almacen", ["item_id"])

    op.create_table(
        "movimientos_inventario",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("almacen_origen_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("almacen_destino_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("item_id", sa.String(), nullable=False),
        sa.Column("item_type", sa.String(), nullable=False),
        sa.Column("cantidad", sa.Float(), nullable=False),
        sa.Column("tipo_movimiento", sa.String(), nullable=False),
        sa.Column("metodo_captura", sa.String(), nullable=False),
        sa.Column("usuario_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("notas", sa.String(), nullable=True),
        sa.Column("lote_entrada_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("evento_id", sa.Integer(), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("evento_id", "item_id", name="uq_movimiento_evento_item"),
    )
    op.create_index("ix_movimientos_inventario_item_id", "movimientos_inventario", ["item_id"])
    op.create_index(
        "ix_mov_inv_item_timestamp", "movimientos_inventario", ["item_id", "timestamp"]
    )

    op.create_table(
        "warehouse_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("items_json", postgresql.JSONB(), nullable=False),
        sa.Column("estado", sa.String(), nullable=False, server_default="PENDIENTE"),
        sa.Column("intentos", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_log", sa.String(), nullable=True),
        sa.Column("sucursal_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("ticket_id", name="uq_warehouse_events_ticket_id"),
    )
    op.create_index("ix_warehouse_events_ticket_id", "warehouse_events", ["ticket_id"])
    op.create_index("ix_warehouse_events_estado", "warehouse_events", ["estado"])
    op.create_index("ix_warehouse_events_sucursal_id", "warehouse_events", ["sucursal_id"])

    op.create_table(
        "warehouse_eventos_sin_almacen",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("evento_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("ticket_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("sku", sa.String(), nullable=True),
        sa.Column("cantidad", sa.Float(), nullable=True),
        sa.Column("motivo", sa.String(), nullable=False),
        sa.Column("detalle", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_we_sin_almacen_evento", "warehouse_eventos_sin_almacen", ["evento_id"]
    )
    op.create_index("ix_we_sin_almacen_sku", "warehouse_eventos_sin_almacen", ["sku"])

    # ------------------------------------------------------------------
    # SECCIÓN 6 — HELADERÍA
    # ------------------------------------------------------------------
    op.create_table(
        "heladeria_product_config",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("component_type", sa.String(), nullable=False),
        sa.Column("max_scoops", sa.Integer(), nullable=True),
        sa.Column("base_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("price_per_scoop", sa.Numeric(12, 2), nullable=True),
        sa.Column("is_available", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], name="fk_heladeria_product_config_product_id_products"),
        sa.UniqueConstraint("product_id", name="uq_heladeria_config_product"),
    )
    op.create_index(
        "ix_heladeria_config_type_available",
        "heladeria_product_config",
        ["component_type", "is_available"],
    )

    op.create_table(
        "ticket_item_components",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("ticket_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("component_type", sa.String(), nullable=False),
        sa.Column("component_name", sa.String(), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(["ticket_item_id"], ["ticket_items.id"], name="fk_ticket_item_components_ticket_item_id_ticket_items"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], name="fk_ticket_item_components_product_id_products"),
    )
    op.create_index(
        "ix_ticket_item_components_ticket_item_id",
        "ticket_item_components",
        ["ticket_item_id"],
    )

    # ------------------------------------------------------------------
    # GUARDIÁN DEL LEDGER — el ledger es inmutable (CA-09 / E-12)
    # ------------------------------------------------------------------
    # Un trigger que RECHAZA cualquier UPDATE o DELETE sobre
    # `movimientos_inventario`. El stock se deriva sumando asientos; nunca se
    # corrige un asiento, se inserta el contrario.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_ledger_inmutable()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION
                'El ledger de inventario es inmutable: no se permite % sobre movimientos_inventario',
                TG_OP;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_ledger_inmutable
        BEFORE UPDATE OR DELETE ON movimientos_inventario
        FOR EACH ROW EXECUTE FUNCTION fn_ledger_inmutable();
        """
    )


def downgrade() -> None:
    # El trigger y su función se van primero.
    op.execute("DROP TRIGGER IF EXISTS trg_ledger_inmutable ON movimientos_inventario;")
    op.execute("DROP FUNCTION IF EXISTS fn_ledger_inmutable();")

    # Orden inverso al de creación (respetando las FK).
    op.drop_table("ticket_item_components")
    op.drop_table("heladeria_product_config")
    op.drop_table("warehouse_eventos_sin_almacen")
    op.drop_table("warehouse_events")
    op.drop_table("movimientos_inventario")
    op.drop_table("stock_almacen")
    op.drop_table("almacenes")
    op.drop_table("orders")
    op.drop_table("product_technical_sheets")
    op.drop_table("cash_movements")
    op.drop_table("terminal_locks")
    op.drop_table("ticket_items")
    op.drop_table("tickets")
    op.drop_table("products")
    op.drop_table("categories")
    op.drop_table("cash_sessions")
    op.drop_table("terminal_sessions")
