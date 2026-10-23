"""Esquemas de sincronización central y multi-sucursal -- MS-03."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SyncPushEntrada(BaseModel):
    """Payload de envío desde una sucursal a la central."""

    branch_id: str = Field(..., min_length=2, max_length=50, description="Identificador único de sucursal")
    domain: str = Field(..., pattern="^(ventas|caja|inventario|catalogo)$", description="Dominio de consolidación")
    records: list[dict[str, Any]] = Field(..., description="Lista de registros a sincronizar")
    schema_version: str = Field("1.0", max_length=20)
    erp_version: str = Field("1.0.0", max_length=20)


class SyncPushSalida(BaseModel):
    """Respuesta de recepción de la central."""

    status: str = Field("ok")
    received: int
    conflicts: int
    message: str


class CatalogPullSalida(BaseModel):
    """Respuesta con catálogo maestro para sucursales."""

    schema_version: str = "1.0"
    total_products: int
    products: list[dict[str, Any]]
    categories: list[dict[str, Any]]
    synced_at: datetime


class ConflictSalida(BaseModel):
    """Representación de un conflicto registrado."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    branch_id: str
    domain: str
    record_uuid: str
    conflict_reason: str
    payload_local: dict[str, Any] | None = None
    payload_remote: dict[str, Any] | None = None
    resolved: bool
    resolution_notes: str | None = None
    created_at: datetime
    resolved_at: datetime | None = None


class ResolveConflictEntrada(BaseModel):
    """Entrada para resolver un conflicto auditado."""

    resolution_notes: str = Field(..., min_length=3, max_length=1000)


class BranchDashboardItem(BaseModel):
    """Métricas consolidadas de una sucursal individual."""

    branch_id: str
    branch_name: str
    status: str
    last_sync_at: datetime | None
    total_ventas: float
    total_tickets: int
    ticket_promedio: float
    total_conflicts: int


class DashboardConsolidadoSalida(BaseModel):
    """Dashboard gerencial con KPIs consolidados de todas las sucursales."""

    sucursales: list[BranchDashboardItem]
    gran_total_ventas: float
    gran_total_tickets: int
    sucursales_activas: int
    conflictos_pendientes: int
