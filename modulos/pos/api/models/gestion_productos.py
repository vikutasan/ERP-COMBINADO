"""
gestion_productos.py -- Modelos SQLAlchemy del modulo Gestion de Productos

NC-GP-01: ProductPriceHistory -- ledger inmutable de cambios de precio.

RT-04: Esta tabla es APPEND-ONLY. No tiene UPDATE ni DELETE en produccion.
RT-01: changed_at es DateTime(timezone=True) -- UTC siempre.
RT-02: price y cost son Numeric(12,2) -- nunca Float.
"""

from __future__ import annotations

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Table, Column
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.base import Base
import uuid


class ProductPriceHistory(Base):
    """
    Ledger inmutable de cambios de precio de producto.

    NC-GP-01: Cada fila es un evento de cambio de precio. Los eventos son
    inmutables: solo se insertan, nunca se modifican ni se eliminan.

    La tabla la pobla el servicio automaticamente al detectar un cambio en
    los campos price o cost en PUT /catalog/products/{id}.
    """

    __tablename__ = "product_price_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # FK al producto. Si el producto se borra, se borra su historial (CASCADE).
    product_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("products.id", ondelete="CASCADE", name="fk_price_history_product"),
        nullable=False,
        index=True,
    )

    # RT-02: Numeric, nunca Float.
    price: Mapped[object] = mapped_column(
        Numeric(12, 2),
        nullable=False,
        comment="Precio publico al momento del cambio. RT-02: NUMERIC, no FLOAT.",
    )
    cost: Mapped[object] = mapped_column(
        Numeric(12, 2),
        nullable=True,
        comment="Costo al momento del cambio. RT-02: NUMERIC, no FLOAT.",
    )

    # RT-01: timezone=True garantiza TIMESTAMPTZ (UTC) en PostgreSQL.
    changed_at: Mapped[object] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        comment="RT-01: Timestamp UTC del momento del cambio.",
    )

    changed_by: Mapped[str | None] = mapped_column(
        String(120),
        nullable=True,
        comment="Usuario que realizo el cambio de precio.",
    )
    reason: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Motivo del cambio (opcional): 'Ajuste temporada', 'Error', etc.",
    )


# ---------------------------------------------------------------------------
# NC-GP-05: Tabla puente M2M (product_tag_map)
# ---------------------------------------------------------------------------
product_tag_map = Table(
    "product_tag_map",
    Base.metadata,
    Column(
        "product_id", Integer,
        ForeignKey("products.id", ondelete="CASCADE", name="fk_tag_map_product"),
        primary_key=True,
    ),
    Column(
        "tag_id", PG_UUID(as_uuid=True),
        ForeignKey("product_tags.id", ondelete="CASCADE", name="fk_tag_map_tag"),
        primary_key=True,
    ),
)


class ProductTag(Base):
    """
    NC-GP-05: Etiqueta transversal del catalogo de productos.

    Los tags son ortogonales a las categorias: un producto puede tener
    categoria 'Panes' y tags ['sin-gluten', 'vegano'] al mismo tiempo.
    RT-03: UUID como PK.
    """

    __tablename__ = "product_tags"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        unique=True,
        index=True,
        comment="Slug del tag: 'sin-gluten', 'vegano', 'temporada-navidad'.",
    )
    color: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
        comment="Color del chip en UI (hex o clase CSS). Opcional.",
    )


class ProductVariant(Base):
    """
    NC-GP-02: Variante de un producto (Chico/Mediano/Grande, 250g/500g, etc).

    Un producto sin variantes funciona igual que antes (compatibilidad garantizada).
    price_modifier es el delta sobre el precio base del producto padre.

    RT-02: price_modifier es Numeric(12,2), nunca Float.
    RT-03: UUID como PK.
    """

    __tablename__ = "product_variants"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    product_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("products.id", ondelete="CASCADE", name="fk_variants_product"),
        nullable=False,
        index=True,
    )
    variant_name: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
        comment="Ej: 'Chico', 'Mediano', 'Grande', '250g', 'Con extra queso'.",
    )
    # RT-02: Numeric, nunca Float
    price_modifier: Mapped[object] = mapped_column(
        Numeric(12, 2),
        nullable=False,
        default=0,
        comment="Delta sobre el precio base. RT-02: NUMERIC, no FLOAT.",
    )
    is_default: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="True si esta variante es la opcion por defecto en el POS.",
    )
    sort_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="Orden de presentacion (ASC).",
    )
    active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment="Variante inactiva no aparece en el POS.",
    )
