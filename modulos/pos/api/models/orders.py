"""Los pedidos (orders) — FASE 1 (Sección 4 del Documento 8).

Tabla: `orders`.

Un pedido es una venta diferida con fecha de entrega compromiso. Se vincula
1:1 con un ticket del POS.
"""

from __future__ import annotations

import uuid

from sqlalchemy import DateTime, Float, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.base import Base
from core.timestamps import utcnow


class Order(Base):
    """Un pedido: venta diferida con fecha de entrega compromiso."""

    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id"),
        nullable=False,
        unique=True,
    )
    delivery_type: Mapped[str] = mapped_column(
        String, nullable=False, default="PICKUP"
    )
    status: Mapped[str] = mapped_column(String, nullable=False, default="TENTATIVO")
    customer_name: Mapped[str | None] = mapped_column(String, nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String, nullable=True)
    # Calculada por el sistema a partir de `order_lead_time_hours`.
    earliest_ready_at: Mapped[object | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Confirmada con el cliente.
    committed_at: Mapped[object | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    packaging_type: Mapped[str] = mapped_column(
        String, nullable=False, default="PROPIO"
    )
    delivery_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    delivery_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    delivery_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    delivery_distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    # O-16: hoy es Float en el ERP. Aquí se corrige a Numeric(12,2).
    # El dinero nunca va en Float (C-03).
    delivery_fee: Mapped[object] = mapped_column(
        Numeric(12, 2), nullable=False, default=0
    )
    created_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("ticket_id", name="uq_orders_ticket_id"),
    )
