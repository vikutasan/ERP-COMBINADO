"""La caja (cash) — FASE 1 (Sección 2 del Documento 8).

Tablas: `cash_sessions`, `cash_movements`.
"""

from __future__ import annotations

import uuid

from sqlalchemy import DateTime, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.base import Base
from core.timestamps import utcnow


class CashSession(Base):
    """El turno de un cajero. Se abre con fondo inicial y se cierra al final."""

    __tablename__ = "cash_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    terminal_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    # Desnormalizado a propósito: reportes rápidos sin cruzar con Seguridad.
    # Es una decisión consciente, no un accidente.
    employee_name: Mapped[str] = mapped_column(String, nullable=False)
    opening_float: Mapped[object] = mapped_column(
        Numeric(12, 2), nullable=False, default=0
    )
    status: Mapped[str] = mapped_column(String, nullable=False, default="OPEN")
    opened_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    closed_at: Mapped[object | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Conteo físico al cierre (arqueo).
    physical_cash: Mapped[object | None] = mapped_column(Numeric(12, 2), nullable=True)
    physical_credit: Mapped[object | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    physical_debit: Mapped[object | None] = mapped_column(
        Numeric(12, 2), nullable=True
    )

    movements: Mapped[list["CashMovement"]] = relationship(back_populates="session")


class CashMovement(Base):
    """Entrada o salida de dinero durante un turno (propinas, refuerzos)."""

    __tablename__ = "cash_movements"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    cash_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cash_sessions.id"),
        nullable=False,
        index=True,
    )
    movement_type: Mapped[str] = mapped_column(String, nullable=False)
    amount: Mapped[object] = mapped_column(Numeric(12, 2), nullable=False)
    concept: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    session: Mapped["CashSession"] = relationship(back_populates="movements")
