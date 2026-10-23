"""El almacén (warehouse) — FASE 1 (Sección 5 del Documento 8).

Tablas: `almacenes`, `stock_almacen`, `movimientos_inventario`,
        `warehouse_events`, `warehouse_eventos_sin_almacen`.

Regla dura del ledger: el stock NO se sobrescribe. Cada entrada/salida es un
asiento inmutable en `movimientos_inventario`. `stock_almacen` es un CACHE
derivado del ledger, nunca la fuente de verdad.
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.base import Base
from core.timestamps import utcnow


class Almacen(Base):
    """Un almacén físico (seco, refrigerado, congelado)."""

    __tablename__ = "almacenes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    nombre: Mapped[str] = mapped_column(String, nullable=False)
    zona_termica: Mapped[str] = mapped_column(String, nullable=False)
    proposito: Mapped[str] = mapped_column(String, nullable=False)
    # O-18: hoy `sucursal_id` es un String suelto. Aquí se guarda como UUID;
    # la tabla `sucursales` llega con la consolidación (F6).
    sucursal_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    foto_url: Mapped[str | None] = mapped_column(String, nullable=True)
    planograma_url: Mapped[str | None] = mapped_column(String, nullable=True)
    pautas_acomodo: Mapped[list | None] = mapped_column(JSONB, nullable=False, default=list)
    activo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    stock: Mapped[list["StockAlmacen"]] = relationship(back_populates="almacen")


class StockAlmacen(Base):
    """El saldo actual de un ítem en un almacén. Es un CACHE del ledger."""

    __tablename__ = "stock_almacen"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    almacen_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("almacenes.id"), nullable=False
    )
    # SKU del ítem. No es FK: el ítem puede ser PRODUCTO o INSUMO.
    item_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    item_type: Mapped[str] = mapped_column(String, nullable=False)
    # O-17: hoy es Float. Se conserva Float en F1 porque el granel lo requiere;
    # la evaluación por `item_type` (Integer para piezas) queda como pendiente.
    cantidad_actual: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    stock_minimo: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    stock_maximo: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    fecha_ingreso: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    dias_anaquel_alerta: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Bloqueo optimista (C-04).
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    ultima_actualizacion: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    almacen: Mapped["Almacen"] = relationship(back_populates="stock")

    __table_args__ = (
        UniqueConstraint(
            "almacen_id", "item_id", name="uq_stock_almacen_almacen_item"
        ),
    )


class MovimientoInventario(Base):
    """El asiento contable del inventario. NUNCA se hace UPDATE de stock.

    Cada entrada/salida es una fila inmutable. El saldo se deriva sumando los
    asientos. El índice único `(evento_id, item_id)` es la cicatriz que impide
    descontar el mismo SKU dos veces si el evento se reprocesa (CA-09).
    """

    __tablename__ = "movimientos_inventario"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    almacen_origen_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    almacen_destino_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    item_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    item_type: Mapped[str] = mapped_column(String, nullable=False)
    cantidad: Mapped[float] = mapped_column(Float, nullable=False)
    tipo_movimiento: Mapped[str] = mapped_column(String, nullable=False)
    metodo_captura: Mapped[str] = mapped_column(String, nullable=False)
    usuario_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    notas: Mapped[str | None] = mapped_column(String, nullable=True)
    lote_entrada_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    # Idempotencia del Outbox: si el evento se reprocesa, el índice único
    # (evento_id, item_id) rechaza el segundo asiento.
    evento_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    timestamp: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    __table_args__ = (
        UniqueConstraint(
            "evento_id", "item_id", name="uq_movimiento_evento_item"
        ),
    )


class WarehouseEvent(Base):
    """El Outbox transaccional.

    El evento que el POS emite al cobrar, para que Almacenes descuente stock
    de forma asíncrona y confiable. Elimina el `try/except pass` de la ruta
    crítica (Regla de Oro #7).
    """

    __tablename__ = "warehouse_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, unique=True, index=True
    )
    items_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    estado: Mapped[str] = mapped_column(
        String, nullable=False, default="PENDIENTE", index=True
    )
    intentos: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_log: Mapped[str | None] = mapped_column(String, nullable=True)
    sucursal_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True, index=True
    )
    created_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    __table_args__ = (
        UniqueConstraint("ticket_id", name="uq_warehouse_events_ticket_id"),
    )


class WarehouseEventoSinAlmacen(Base):
    """Registra los SKUs que NO se pudieron descontar.

    Reemplaza el "ignorar en silencio": el operador ve el motivo y corrige la
    configuración. Es una cicatriz (el silencio era el bug).
    """

    __tablename__ = "warehouse_eventos_sin_almacen"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    evento_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True, index=True
    )
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    sku: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    cantidad: Mapped[float | None] = mapped_column(Float, nullable=True)
    motivo: Mapped[str] = mapped_column(String, nullable=False)
    detalle: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
