"""Proyección ticket → pedido (contrato 15) — FASE 7.5.2.

Este es el PUENTE POS → Pedidos → Producción que el plan documentaba en 4
lugares y la ejecución había omitido. Aquí se materializa.

Frontera por contratos (A-02):
  El POS NO escribe la tabla `orders` "a mano" como si fuera suya. La
  proyección es la implementación INTERNA del proveedor "Pedidos" (contrato
  15, `pedidos.registrar_desde_ticket`). El POS la invoca; Pedidos decide el
  mapeo de estado y calcula `earliest_ready_at`. En esta fase ambos viven en
  el mismo proceso, pero la frontera se respeta: el POS llama a esta función,
  no toca `Order` directamente.

Atomicidad (D-5):
  Esta función NO hace commit. Se llama DENTRO de la transacción abierta por
  el endpoint del POS, entre el `flush()` del ticket y el `commit()` final.
  Así el ticket y su pedido nacen (o se actualizan) juntos: o existen los dos,
  o no existe ninguno.

Política de pago (DT-06, leída con degradación segura DT-07):
  - `SIN_PAGO`      → se proyecta al CREAR el ticket (TENTATIVO).
  - `ANTICIPO`      → se proyecta cuando el pago cubre el anticipo (TENTATIVO).
  - `PAGO_COMPLETO` → se proyecta solo al COBRAR (PAGADO). Default seguro.

Mapeo de estado (lo decide el PROVEEDOR, no el POS):
  - ticket OPEN  → pedido TENTATIVO
  - ticket PAID  → pedido PAGADO
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Order, Ticket
from rules.registry import rn69_catorce_estados
from services.settings_service import (
    POLITICA_ANTICIPO,
    POLITICA_PAGO_COMPLETO,
    POLITICA_SIN_PAGO,
    leer_politica_pago,
)

# Horas de anticipación por defecto para calcular `earliest_ready_at` cuando el
# pedido no trae `committed_at`. Es un valor conservador; el módulo Pedidos lo
# reemplazará por su propia configuración cuando exista.
HORAS_PREPARACION_POR_DEFECTO = 24


def _mapear_estado(status_ticket: str) -> str:
    """Mapea el estado del ticket al estado del pedido (lo decide Pedidos).

    OPEN → PENDIENTE (aún no confirmado). PAID → PAGADO (cobrado).

    HALLAZGO F12.20: antes se mapeaba OPEN → "TENTATIVO", pero `TENTATIVO` NO
    es uno de los 14 estados válidos de RN-69 (la lista es PENDIENTE,
    CONFIRMADO, EN_PREPARACION, LISTO, EN_RUTA, ENTREGADO, CANCELADO,
    DEVUELTO, REPROGRAMADO, EN_ESPERA, PARCIAL, FACTURADO, PAGADO, ARCHIVADO).
    `rn69_catorce_estados("TENTATIVO")` lanzaba `ReglaViolada` (400), así que
    la proyección de CUALQUIER ticket OPEN bajo política SIN_PAGO/ANTICIPO
    fallaba. El estado correcto para un pedido recién proyectado y aún no
    confirmado es PENDIENTE (el mismo que usa `rn67_ticket_a_pedido`).
    """
    if status_ticket == "PAID":
        return rn69_catorce_estados("PAGADO")
    return rn69_catorce_estados("PENDIENTE")


def _calcular_earliest_ready_at(ticket: Ticket) -> datetime:
    """Calcula cuándo puede estar listo el pedido.

    Si el ticket trae `committed_at` (compromiso con el cliente), se usa ese
    instante. Si no, se asume un tiempo de preparación por defecto desde ahora.
    """
    if ticket.committed_at is not None:
        return ticket.committed_at
    return datetime.now(timezone.utc) + timedelta(hours=HORAS_PREPARACION_POR_DEFECTO)


def _es_pedido(ticket: Ticket) -> bool:
    """Un ticket es pedido si su `order_type` NO es una venta directa."""
    return (ticket.order_type or "VENTA_DIRECTA") != "VENTA_DIRECTA"


async def proyectar_pedido(
    db: AsyncSession,
    ticket: Ticket,
    *,
    forzar: bool = False,
) -> Order | None:
    """Proyecta el ticket a un pedido, si la política y el tipo lo permiten.

    Devuelve el `Order` creado/actualizado, o `None` si no corresponde
    proyectar (venta directa, o política que aún no autoriza la proyección).

    NO hace commit: se ejecuta dentro de la transacción del endpoint.

    Args:
        db: la sesión con la transacción abierta.
        ticket: el ticket ya `flush()`eado (tiene `id`).
        forzar: si es `True`, ignora la política y proyecta igual. Se usa en el
            cobro cuando la política es `PAGO_COMPLETO` (el cobro ES la señal).
    """
    # Solo los pedidos se proyectan. Una venta directa de mostrador no genera
    # pedido: no hay nada que preparar con anticipación.
    if not _es_pedido(ticket):
        return None

    # La política decide SI corresponde proyectar en este momento.
    if not forzar:
        politica = await leer_politica_pago(db)
        if politica == POLITICA_PAGO_COMPLETO:
            # Solo se proyecta al cobrar (PAID). Al crear (OPEN) no se proyecta.
            if ticket.status != "PAID":
                return None
        elif politica == POLITICA_ANTICIPO:
            # Se proyecta cuando el pago cubre el anticipo. Sin el detalle del
            # anticipo declarado, se degrada a NO proyectar al crear (seguro).
            if ticket.status != "PAID":
                return None
        elif politica == POLITICA_SIN_PAGO:
            # Se proyecta al crear, sin esperar pago.
            pass

    # Idempotencia por `ticket_id` (garantía del contrato 15): si el pedido ya
    # existe, se ACTUALIZA en vez de crear un duplicado (relación 1:1, RN-68).
    existente = (
        await db.execute(select(Order).where(Order.ticket_id == ticket.id))
    ).scalars().first()

    estado = _mapear_estado(ticket.status)
    earliest = _calcular_earliest_ready_at(ticket)

    if existente is not None:
        existente.status = estado
        existente.earliest_ready_at = earliest
        # H3-FIX: asignación directa (sin `or`): el campo se actualiza aunque
        # venga vacío. Esto permite que el cajero borre notas, dirección, etc.
        # El endpoint (contrato 31) ya filtra qué campos vienen en `model_fields_set`;
        # aquí solo se aplica lo que el ticket trae.
        existente.delivery_type = ticket.delivery_type or existente.delivery_type
        existente.customer_name = ticket.customer_name if ticket.customer_name is not None else existente.customer_name
        existente.customer_phone = ticket.customer_phone if ticket.customer_phone is not None else existente.customer_phone
        existente.committed_at = ticket.committed_at if ticket.committed_at is not None else existente.committed_at
        existente.packaging_type = ticket.packaging_type or existente.packaging_type
        # `delivery_address` y `notes` sí pueden borrarse (string vacío es válido).
        existente.delivery_address = ticket.delivery_address  # None o string vacío = borrar
        existente.notes = ticket.order_notes  # None o string vacío = borrar
        await db.flush()
        return existente

    pedido = Order(
        ticket_id=ticket.id,
        delivery_type=ticket.delivery_type or "PICKUP",
        status=estado,
        customer_name=ticket.customer_name,
        customer_phone=ticket.customer_phone,
        earliest_ready_at=earliest,
        committed_at=ticket.committed_at,
        packaging_type=ticket.packaging_type or "PROPIO",
        delivery_address=ticket.delivery_address,
        notes=ticket.order_notes,
    )
    db.add(pedido)
    await db.flush()
    return pedido
