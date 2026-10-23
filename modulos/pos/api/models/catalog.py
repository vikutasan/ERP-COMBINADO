"""El catálogo (catalog) — FASE 1 (Sección 3 del Documento 8).

Tablas: `categories`, `products`, `product_technical_sheets`.

Deuda eliminada (Sección 7 del Documento 8):
  - `products.stock`     → NO existe. La fuente única es `stock_almacen`.
  - `products.warehouse` → NO existe. La ubicación real es `stock_almacen.almacen_id`.
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    Boolean,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.base import Base


class Category(Base):
    """Categoría de producto. Define el destino de proyección hacia los POS."""

    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    icon: Mapped[str | None] = mapped_column(String, nullable=True)
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vision_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    heladeria_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    # Única decisión que el usuario toma por categoría; el producto la hereda.
    pos_target: Mapped[str] = mapped_column(
        String, nullable=False, default="PANADERIA", index=True
    )
    heladeria_default_role: Mapped[str | None] = mapped_column(String, nullable=True)

    products: Mapped[list["Product"]] = relationship(back_populates="category")


class Product(Base):
    """El producto vendible. La entidad que el POS muestra en la grilla."""

    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    sku: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    barcode: Mapped[str | None] = mapped_column(
        String, nullable=True, unique=True, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False, index=True)
    price: Mapped[object] = mapped_column(Numeric(12, 2), nullable=False)
    cost: Mapped[object] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    nature: Mapped[str] = mapped_column(
        String, nullable=False, default="MANUFACTURADO"
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id"), nullable=True
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # NC-GP-07: disponibilidad temporal sin descontinuar el producto
    available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # NC-GP-04: unidad de venta (PZA, KG, LT, DOC, CAJA, GR, ML)
    unit_of_sale: Mapped[str] = mapped_column(String(10), nullable=False, default="PZA")

    category: Mapped["Category | None"] = relationship(back_populates="products")
    technical_sheet: Mapped["ProductTechnicalSheet | None"] = relationship(
        back_populates="product", uselist=False
    )
    # NC-GP-02: Las variantes se cargan manualmente en el router catalog.py
    # usando un SELECT separado, porque product_variants.product_id es INTEGER
    # (herencia del ERP viejo) mientras que products.id en el POS es UUID.
    # No se puede crear un ORM relationship directo entre tipos distintos.


class ProductTechnicalSheet(Base):
    """Ficha técnica del producto (masas, horneado, tiempos, BOM)."""

    __tablename__ = "product_technical_sheets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id"),
        nullable=False,
        unique=True,
    )
    # Las masas referencian `doughs` (Producción). En F1 no se crea esa tabla:
    # el POS la consulta por contrato (F2). Se guarda el UUID sin FK física.
    primary_mass_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    primary_mass_grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    secondary_mass_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    secondary_mass_grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    tertiary_mass_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    tertiary_mass_grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_per_piece: Mapped[float | None] = mapped_column(Float, nullable=True)
    baking_temp_top: Mapped[float | None] = mapped_column(Float, nullable=True)
    baking_temp_bottom: Mapped[float | None] = mapped_column(Float, nullable=True)
    baking_time_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    steam_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scoring_type: Mapped[str | None] = mapped_column(String, nullable=True)
    forming_procedure: Mapped[str | None] = mapped_column(Text, nullable=True)
    bom_extra: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    preparation_time_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Regla de negocio: calcula `earliest_ready_at` en los pedidos.
    order_lead_time_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recipe_procedure: Mapped[str | None] = mapped_column(Text, nullable=True)
    modifiers: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    provider: Mapped[str | None] = mapped_column(String, nullable=True)
    original_barcode: Mapped[str | None] = mapped_column(String, nullable=True)
    unit_measure: Mapped[str | None] = mapped_column(String, nullable=True)
    min_stock: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_stock: Mapped[int | None] = mapped_column(Integer, nullable=True)

    product: Mapped["Product"] = relationship(back_populates="technical_sheet")

    __table_args__ = (
        UniqueConstraint("product_id", name="uq_pts_product_id"),
    )
