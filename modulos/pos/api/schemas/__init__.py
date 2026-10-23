"""Paquete `schemas` — re-exportación para retrocompatibilidad — FD-03.

Antes: `from schemas import TicketSalida`  (un solo archivo de 812 líneas)
Ahora: `from schemas import TicketSalida`  (mismo import, código en submódulos)

Los routers NO necesitan cambiar sus imports. Los submódulos están en:
  - schemas/catalog.py       → Catálogo (Contrato 1)
  - schemas/pos.py           → POS: sesión, ticket, cobro, ítems atómicos (Contratos 3,5,9,18-22,31)
  - schemas/cash.py          → Caja: turno, movimientos, cierre, reporte (Contratos 9-14)
  - schemas/orders.py        → Cuentas abiertas, pedidos, auditoría (Contratos 16,23,26)
  - schemas/notifications.py → Notificaciones (Contrato 27)

ESPACIO_IDS_ERP se exporta desde cash.py (donde vive AbrirTurnoEntrada que
lo usa para normalizar el usuario_id del ERP). Los routers que lo necesiten
pueden importarlo desde aquí o desde cash directamente.
"""

from __future__ import annotations

from .catalog import (
    CategoriaParaVenta,
    CatalogoParaVenta,
    ProductoParaVenta,
)
from .cash import (
    ESPACIO_IDS_ERP,
    AbrirTurnoEntrada,
    AbrirTurnoSalida,
    CerrarTurnoEntrada,
    CerrarTurnoSalida,
    EliminarMovimientoSalida,
    LineaReporteDiario,
    MovimientoEntrada,
    MovimientoResumen,
    MovimientoSalida,
    ReporteDiarioSalida,
    ResumenTurnoSalida,
    SesionCajaActiva,
)
from .kitchen import (
    ActualizarEstadoCocinaEntrada,
    ActualizarEstadoCocinaRespuesta,
    KitchenQueueSalida,
    KitchenTicketSalida,
    LineaCocinaSchema,
)
from .delivery import (
    AsignarRepartidorEntrada,
    AvanzarEstadoEntrada,
    DeliveryAssignmentSalida,
    DeliveryQueueSalida,
)
from .sync import (
    BranchDashboardItem,
    CatalogPullSalida,
    ConflictSalida,
    DashboardConsolidadoSalida,
    ResolveConflictEntrada,
    SyncPushEntrada,
    SyncPushSalida,
)
from .notifications import (
    EncolarTicketEntrada,
    EncolarTicketSalida,
    MensajeEncoladoSalida,
)
from .orders import (
    CuentaAbiertaSalida,
    CuentasAbiertasSalida,
    EventoAuditableSalida,
    EventosAuditablesSalida,
    PedidoDelTicketSalida,
)
from .pos import (
    ActualizarPedidoEntrada,
    AnadirItemEntrada,
    CambiarCantidadEntrada,
    CobrarTicketEntrada,
    CrearTicketEntrada,
    LineaAtomicaSalida,
    LineaEntrada,
    LineaSalida,
    LineasTicketSalida,
    QuitarItemEntrada,
    SesionActiva,
    SesionTerminalEntrada,
    TicketAtomicoSalida,
    TicketLigeroSalida,
    TicketSalida,
    VerificarEnvioEntrada,
    VerificarEnvioSalida,
)

__all__ = [
    # catalog
    "CategoriaParaVenta",
    "CatalogoParaVenta",
    "ProductoParaVenta",
    # cash
    "ESPACIO_IDS_ERP",
    "AbrirTurnoEntrada",
    "AbrirTurnoSalida",
    "CerrarTurnoEntrada",
    "CerrarTurnoSalida",
    "EliminarMovimientoSalida",
    "LineaReporteDiario",
    "MovimientoEntrada",
    "MovimientoResumen",
    "MovimientoSalida",
    "ReporteDiarioSalida",
    "ResumenTurnoSalida",
    "SesionCajaActiva",
    # notifications
    "EncolarTicketEntrada",
    "EncolarTicketSalida",
    "MensajeEncoladoSalida",
    # orders
    "CuentaAbiertaSalida",
    "CuentasAbiertasSalida",
    "EventoAuditableSalida",
    "EventosAuditablesSalida",
    "PedidoDelTicketSalida",
    # kitchen (MS-01)
    "ActualizarEstadoCocinaEntrada",
    "ActualizarEstadoCocinaRespuesta",
    "KitchenQueueSalida",
    "KitchenTicketSalida",
    "LineaCocinaSchema",
    # delivery / reparto (MS-02)
    "AsignarRepartidorEntrada",
    "AvanzarEstadoEntrada",
    "DeliveryAssignmentSalida",
    "DeliveryQueueSalida",
    # sync / consolidación (MS-03)
    "SyncPushEntrada",
    "SyncPushSalida",
    "CatalogPullSalida",
    "ConflictSalida",
    "ResolveConflictEntrada",
    "BranchDashboardItem",
    "DashboardConsolidadoSalida",
    # pos
    "ActualizarPedidoEntrada",
    "AnadirItemEntrada",
    "CambiarCantidadEntrada",
    "CobrarTicketEntrada",
    "CrearTicketEntrada",
    "LineaAtomicaSalida",
    "LineaEntrada",
    "LineaSalida",
    "LineasTicketSalida",
    "QuitarItemEntrada",
    "SesionActiva",
    "SesionTerminalEntrada",
    "TicketAtomicoSalida",
    "TicketLigeroSalida",
    "TicketSalida",
    "VerificarEnvioEntrada",
    "VerificarEnvioSalida",
]
