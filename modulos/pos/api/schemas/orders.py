"""Esquemas de cuentas abiertas, pedidos y auditoría — Contratos 16, 23, 26 (FD-03)."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Cuentas abiertas — Contrato 23 (FASE 5.0)
# ---------------------------------------------------------------------------

class CuentaAbiertaSalida(BaseModel):
    """Una cuenta abierta del pizarrón (contrato 23).

    RESPUESTA LIGERA: una PROYECCIÓN de campos escalares explícitos (Regla 15).
    NO incluye las líneas: leer las líneas es responsabilidad del contrato 21.

    F12.6 — PARIDAD DE PRESENTACIÓN: amplía la proyección con campos del viejo POS.
    BUG-04 — Contexto de pedido COMPLETO para reconstruir bloque `order_*`.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_num: str
    status: str
    total: Decimal
    version: int
    terminal_id: str | None = None
    captured_by_name: str | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    order_type: str = "VENTA_DIRECTA"
    delivery_type: str | None = None
    created_at: datetime | None = None
    committed_at: datetime | None = None
    packaging_type: str | None = None
    delivery_address: str | None = None
    order_notes: str | None = None


class CuentasAbiertasSalida(BaseModel):
    """Salida del contrato 23: las cuentas OPEN de una terminal (RN-31)."""

    cuentas: list[CuentaAbiertaSalida] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Pedidos — Contrato 16 (FASE 7.5.3)
# ---------------------------------------------------------------------------

class PedidoDelTicketSalida(BaseModel):
    """El pedido asociado a un ticket (contrato 16).

    Es una PROYECCIÓN, no la fila completa de `orders` (O-23): expone solo los
    10 campos que el POS necesita para mostrar la programación.
    """

    model_config = ConfigDict(from_attributes=True)

    order_id: UUID
    delivery_type: str
    status: str
    customer_name: str | None = None
    customer_phone: str | None = None
    committed_at: datetime | None = None
    packaging_type: str
    delivery_address: str | None = None
    delivery_fee: Decimal | None = None
    notes: str | None = None


# ---------------------------------------------------------------------------
# Auditoría — Contrato 26 (FASE 13.1)
# ---------------------------------------------------------------------------

class EventoAuditableSalida(BaseModel):
    """Un evento auditable del POS (contrato 26).

    Es una PROYECCIÓN, no la fila completa de `pos_audit_log` (O-23).
    """

    model_config = ConfigDict(from_attributes=True)

    tipo: str
    ticket_id: str | None = None
    usuario_id: str | None = None
    timestamp: datetime
    detalle: dict = Field(default_factory=dict)


class EventosAuditablesSalida(BaseModel):
    """La lista de eventos auditables en un rango (contrato 26)."""

    model_config = ConfigDict(from_attributes=True)

    eventos: list[EventoAuditableSalida] = Field(default_factory=list)
