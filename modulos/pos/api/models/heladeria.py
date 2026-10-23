"""La heladería (heladeria) — FASE 1 (Sección 6 del Documento 8).

Tablas: `heladeria_product_config`, `ticket_item_components`.

Un helado armado = 1 `TicketItem` con N `TicketItemComponent`.
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.base import Base


class HeladeriaProductConfig(Base):
    """Extiende un producto del catálogo con configuración de heladería.

    Ejemplo: 'Chocolate' → component_type='SABOR'. Es una PROYECCIÓN del
    catálogo, no una fuente de verdad paralela.
    """

    __tablename__ = "heladeria_product_config"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("products.id"),
        nullable=False,
        unique=True,
    )
    component_type: Mapped[str] = mapped_column(String, nullable=False)
    max_scoops: Mapped[int | None] = mapped_column(Integer, nullable=True)
    base_price: Mapped[object | None] = mapped_column(Numeric(12, 2), nullable=True)
    price_per_scoop: Mapped[object | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    # Toggle "AGOTAR SABOR".
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint("product_id", name="uq_heladeria_config_product"),
    )


class TicketItemComponent(Base):
    """Los componentes de un TicketItem compuesto (un helado armado)."""

    __tablename__ = "ticket_item_components"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    ticket_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ticket_items.id"),
        nullable=False,
        index=True,
    )
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id"), nullable=True
    )
    component_type: Mapped[str] = mapped_column(String, nullable=False)
    # Desnormalizado a propósito: el ticket debe poder imprimirse aunque el
    # producto se renombre después.
    component_name: Mapped[str] = mapped_column(String, nullable=False)
    unit_price: Mapped[object] = mapped_column(
        Numeric(12, 2), nullable=False, default=0
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    ticket_item: Mapped["TicketItem"] = relationship(back_populates="components")
