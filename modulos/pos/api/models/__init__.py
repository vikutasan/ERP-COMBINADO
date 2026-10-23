"""Los modelos del POS nuevo — FASE 1 (Cimiento de datos) + FASE 7.5.1a.

`TicketItemIntent` (cierre deuda D-9) se suma a los 18 modelos originales: es
el ledger de intenciones del contrato 18, la fuente de verdad de la
idempotencia por `item_id`.

Cada modelo corresponde a una tabla del `MODELO_DE_DATOS_DEL_NUEVO_POS.md`
(Documento 8). Todos aplican las 4 correcciones estructurales:

  C-01  PK entero → UUID
  C-02  DateTime naive → DateTime(timezone=True) UTC
  C-03  dinero en Numeric(12,2), nunca Float
  C-04  columna `version` para bloqueo optimista

El orden de import importa: Alembic descubre las tablas al importar este
paquete, y las FK necesitan que las tablas referenciadas ya estén declaradas.
"""

from __future__ import annotations

from .audit import PosAuditLog
from .cash import CashMovement, CashSession
from .catalog import Category, Product, ProductTechnicalSheet
from .heladeria import HeladeriaProductConfig, TicketItemComponent
from .notifications import NotificationOutbox
from .delivery import DeliveryAssignment
from .kitchen import KitchenTicket
from .orders import Order
from .pos import (
    TerminalLock,
    TerminalSession,
    Ticket,
    TicketItem,
    TicketItemIntent,
)
from .settings import SystemSetting
from .warehouse import (
    Almacen,
    MovimientoInventario,
    StockAlmacen,
    WarehouseEvent,
    WarehouseEventoSinAlmacen,
)
from .sync import (
    Branch,
    CentralConsolidatedRecord,
    SyncConflict,
    SyncOutbox,
)
# NC-GP-01: Ledger inmutable de historial de precios (Modulo Gestion de Productos)
# NC-GP-05: Tags transversales M2M
# NC-GP-02: Variantes de producto
from .gestion_productos import ProductPriceHistory, ProductTag, product_tag_map, ProductVariant

__all__ = [
    # POS (núcleo transaccional)
    "TerminalSession",
    "Ticket",
    "TicketItem",
    "TicketItemIntent",
    "TerminalLock",
    # Caja
    "CashSession",
    "CashMovement",
    # Catálogo
    "Category",
    "Product",
    "ProductTechnicalSheet",
    # Pedidos
    "Order",
    # Cola de cocina (MS-01)
    "KitchenTicket",
    # Reparto (MS-02)
    "DeliveryAssignment",
    # Sincronización central (MS-03)
    "Branch",
    "SyncOutbox",
    "CentralConsolidatedRecord",
    "SyncConflict",
    # Notificaciones (Outbox — FASE 12.22, contrato 27)
    "NotificationOutbox",
    # Configuración transversal (DT-06 — FASE 7.5.1a)
    "SystemSetting",
    # Almacén (ledger)
    "Almacen",
    "StockAlmacen",
    "MovimientoInventario",
    "WarehouseEvent",
    "WarehouseEventoSinAlmacen",
    # Heladería
    "HeladeriaProductConfig",
    "TicketItemComponent",
    # Auditoría (FASE 13.0 — RN-75/76/77)
    "PosAuditLog",
    # Gestion de Productos -- NC-GP-01 / NC-GP-05 / NC-GP-02
    "ProductPriceHistory",
    "ProductTag",
    "ProductVariant",
]
