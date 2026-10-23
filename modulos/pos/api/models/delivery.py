"""Modulo de Reparto -- MS-02.

Tabla: `delivery_assignments`.

Cada fila representa la asignacion de un repartidor a un pedido con
entrega a domicilio. Rastrea el ciclo de vida:

  ASIGNADO -> EN_CAMINO -> ENTREGADO
                        |-> NO_ENTREGADO

Diseno deliberado:
  - FK a `orders.id` (no a tickets): el reparto es una extension del
    flujo de pedido, no del ticket de POS.
  - UNIQUE en order_id: un pedido tiene como maximo una asignacion activa.
  - Los timestamps de transicion (en_camino_at, entregado_at) sellan
    automaticamente cuando el estado avanza.
"""

from __future__ import annotations

import uuid

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.base import Base
from core.timestamps import utcnow

# Estados validos del ciclo de vida de reparto (MS-02).
ESTADOS_REPARTO = ("ASIGNADO", "EN_CAMINO", "ENTREGADO", "NO_ENTREGADO")
# Estados terminales (no pueden avanzar).
ESTADOS_TERMINALES = ("ENTREGADO", "NO_ENTREGADO")


class DeliveryAssignment(Base):
    """Asignacion de repartidor a un pedido de domicilio."""

    __tablename__ = "delivery_assignments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # FK al pedido (1 pedido -> 1 asignacion).
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orders.id"),
        nullable=False,
        unique=True,
        index=True,
    )
    # Nombre del repartidor (texto libre; futuro: FK a staff).
    repartidor_nombre: Mapped[str] = mapped_column(String, nullable=False)
    # Telefono de contacto del repartidor.
    repartidor_telefono: Mapped[str | None] = mapped_column(String, nullable=True)
    # Estado: ASIGNADO | EN_CAMINO | ENTREGADO | NO_ENTREGADO
    estado: Mapped[str] = mapped_column(
        String, nullable=False, default="ASIGNADO", index=True
    )
    # Notas del repartidor (incidencias, instrucciones especiales).
    notas: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Cuando se asigno el repartidor.
    asignado_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    # Cuando salio a entregar (estado -> EN_CAMINO).
    en_camino_at: Mapped[object | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Cuando se confirmo la entrega (estado -> ENTREGADO o NO_ENTREGADO).
    entregado_at: Mapped[object | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Timestamps estandar.
    created_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
