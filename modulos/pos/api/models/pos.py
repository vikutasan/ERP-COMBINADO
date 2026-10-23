"""Núcleo transaccional del POS — FASE 1 (Sección 1 del Documento 8).

Tablas: `terminal_sessions`, `tickets`, `ticket_items`, `terminal_locks`.

Nota de identidad (C-01): el `id` es UUID (identidad global). El folio
`account_num` es local y de presentación; NUNCA se usa como identidad.
"""

from __future__ import annotations

import uuid

from sqlalchemy import (
    Boolean,
    DateTime,
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
from core.timestamps import utcnow


class TerminalSession(Base):
    """El turno de una terminal. Agrupa los tickets de una jornada."""

    __tablename__ = "terminal_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    terminal_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    opened_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    closed_at: Mapped[object | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    tickets: Mapped[list["Ticket"]] = relationship(back_populates="session")

    __table_args__ = (
        # Índice compuesto: la consulta "¿hay turno abierto en esta terminal?"
        # es la más frecuente del POS.
        {"comment": "ix_terminal_sessions_terminal_active (terminal_id, is_active)"},
    )


class Ticket(Base):
    """El ticket de venta. La entidad central del POS."""

    __tablename__ = "tickets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Folio local V#### — NO es identidad (C-01). Único por sucursal (O-15).
    account_num: Mapped[str] = mapped_column(String, nullable=False, index=True)
    total: Mapped[object] = mapped_column(
        Numeric(12, 2), nullable=False, default=0
    )
    payment_details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    status: Mapped[str] = mapped_column(String, nullable=False, default="OPEN")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    order_type: Mapped[str] = mapped_column(
        String, nullable=False, default="VENTA_DIRECTA"
    )
    order_status: Mapped[str] = mapped_column(
        String, nullable=False, default="PROGRAMADO PARA SER PREPARADO"
    )
    delivery_type: Mapped[str | None] = mapped_column(String, nullable=True)
    customer_name: Mapped[str | None] = mapped_column(String, nullable=True)
    customer_phone: Mapped[str | None] = mapped_column(String, nullable=True)
    committed_at: Mapped[object | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    packaging_type: Mapped[str | None] = mapped_column(String, nullable=True)
    delivery_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    terminal_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    channel: Mapped[str] = mapped_column(
        String, nullable=False, default="PANADERIA", index=True
    )
    customer_group_name: Mapped[str | None] = mapped_column(String, nullable=True)

    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("terminal_sessions.id"), nullable=True
    )
    cash_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cash_sessions.id"), nullable=True
    )
    # Auditoría: quién capturó y quién cobró. Es una cicatriz valiosa (CA-14).
    captured_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    cashed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    # F12.6 — PARIDAD DE PRESENTACIÓN: el pizarrón muestra QUIÉN capturó y
    # QUIÉN cobró, igual que el viejo POS. El nombre se DESNORMALIZA (patrón
    # F10.5, igual que `cash_sessions.employee_name`): es una FOTO HISTÓRICA
    # ("quién capturó ESTA cuenta el día X"), no un valor vivo que deba
    # sincronizarse. Por eso NO es una segunda fuente de verdad (ver
    # MODELO_DE_DATOS_DEL_NUEVO_POS.md:166 y :486, `component_name`).
    # El POS lo envía al crear/cobrar; el backend lo persiste. Sin JOIN, sin
    # leer `employees` (frontera A-02 / O-23).
    captured_by_name: Mapped[str | None] = mapped_column(String, nullable=True)
    cashed_by_name: Mapped[str | None] = mapped_column(String, nullable=True)

    session: Mapped["TerminalSession | None"] = relationship(back_populates="tickets")
    items: Mapped[list["TicketItem"]] = relationship(back_populates="ticket")
    # CIERRE DEUDA D-9 — el conjunto de INTENCIONES de escritura procesadas
    # (contrato 18). Es la fuente de verdad de la idempotencia.
    intents: Mapped[list["TicketItemIntent"]] = relationship(
        back_populates="ticket", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # O-15: el folio es único POR SUCURSAL, no global. En F1 no hay tabla
        # `sucursales` todavía (llega con O-18); se deja la unicidad del folio
        # y se documenta la corrección pendiente.
        UniqueConstraint("account_num", name="uq_tickets_account_num"),
    )


class TicketItem(Base):
    """Las líneas del ticket. Cada producto agregado al carrito."""

    __tablename__ = "ticket_items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tickets.id"),
        nullable=False,
        index=True,
    )
    # CIERRE DEUDA D-9 — `item_id` es la IDENTIDAD de la LÍNEA: la intención que
    # la CREÓ. Es lo que `_lineas_atomicas` devuelve y lo que el cliente usa para
    # direccionar la línea en PATCH/DELETE (contratos 19/20). Antes se derivaba
    # del `product_id`, lo que rompía la dirección de una cuenta recuperada del
    # pizarrón (brecha F12.18); ahora es un valor persistido y estable.
    #
    # Es distinto de `product_id`: `product_id` = QUÉ producto (fusión RN-17);
    # `item_id` = QUÉ línea. Un producto aparece una sola vez por ticket (RN-17),
    # así que la línea conserva el `item_id` de la PRIMERA intención que la creó.
    # El conjunto COMPLETO de intenciones procesadas (incluidas las que fusionan)
    # vive en `ticket_item_intents` — esa tabla es la que garantiza la
    # idempotencia del contrato 18.
    item_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id"), nullable=False, index=True
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # `unit_price` se congela al momento de la venta: no se recalcula desde el
    # producto. Eso es correcto y se mantiene.
    unit_price: Mapped[object] = mapped_column(Numeric(12, 2), nullable=False)
    subtotal: Mapped[object] = mapped_column(Numeric(12, 2), nullable=False)
    # `name` se congela junto a `unit_price` (mismo principio): el ticket impreso
    # siempre muestra el nombre que tenía el producto al venderse, aunque después
    # sea editado o eliminado del catálogo.
    name: Mapped[str | None] = mapped_column(String, nullable=True)

    ticket: Mapped["Ticket"] = relationship(back_populates="items")
    components: Mapped[list["TicketItemComponent"]] = relationship(
        back_populates="ticket_item"
    )

    __table_args__ = (
        # CIERRE DEUDA D-9 — idempotencia del contrato 18 garantizada por el
        # motor: dentro de un ticket, un `item_id` no puede repetirse. El alcance
        # es POR TICKET (no global) porque el `item_id` lo genera el cliente
        # (`nuevoItemId()`); dos terminales podrían colisionar en el mismo valor.
        UniqueConstraint(
            "ticket_id", "item_id", name="uq_ticket_items_ticket_item_id"
        ),
    )


class TicketItemIntent(Base):
    """CIERRE DEUDA D-9 — el ledger de INTENCIONES de escritura del contrato 18.

    Cada fila es una intención (`item_id`) que el cliente envió a
    `POST /pos/tickets/{id}/items` y que el servidor YA procesó. Es la fuente de
    verdad de la idempotencia: si la misma intención se reenvía (reintento de
    red, doble clic), el servidor la encuentra aquí y responde NO-OP.

    Por qué una tabla y no una columna en `ticket_items`:

    - **Preserva el CONJUNTO de intenciones.** RN-17 fusiona por `product_id`:
      dos intenciones distintas del MISMO producto producen UNA sola línea. Una
      columna por línea solo podría recordar una de las dos intenciones, así que
      el reintento de la otra duplicaría la cantidad. El ledger recuerda TODAS.
    - **Vive en el dominio de las LÍNEAS**, no en el de los pagos. El ledger
      anterior (`payment_details["_item_ids"]`) se BORRABA al cobrar, porque
      `_normalizar_pagos` reconstruye `payment_details`; esta tabla no la toca
      ningún flujo de pago.
    - **Unicidad garantizada por el MOTOR.** `UniqueConstraint(ticket_id,
      item_id)` hace imposible el duplicado a nivel de base de datos, no por una
      convención en Python.

    El alcance es POR TICKET (no global): el `item_id` lo genera el cliente
    (`nuevoItemId()`), así que dos terminales podrían colisionar en el mismo
    valor; la idempotencia solo tiene sentido dentro de un ticket.
    """

    __tablename__ = "ticket_item_intents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        # ON DELETE CASCADE: una intención no tiene sentido sin su ticket. Al
        # borrar el ticket (p. ej. limpieza de pruebas), el motor borra sus
        # intenciones; sin esto, el FK bloquearía el borrado.
        ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    item_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    created_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    ticket: Mapped["Ticket"] = relationship(back_populates="intents")

    __table_args__ = (
        UniqueConstraint(
            "ticket_id", "item_id", name="uq_ticket_item_intents_ticket_item_id"
        ),
    )


class TerminalLock(Base):
    """Candado persistente de terminal.

    Reemplaza el diccionario en RAM que se perdía con los reinicios: esa era
    la causa del bug de terminales bloqueadas. Es una cicatriz, no deuda.
    """

    __tablename__ = "terminal_locks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    terminal_id: Mapped[str] = mapped_column(
        String, nullable=False, unique=True, index=True
    )
    occupier_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    occupier_name: Mapped[str] = mapped_column(String, nullable=False)
    locked_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
