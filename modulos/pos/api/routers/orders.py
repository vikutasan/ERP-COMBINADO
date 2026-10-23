"""Router de Pedidos — FASE 7.5.3 (contrato 16).

Materializa el contrato 16 (`pedidos.pedido_del_ticket`), la LECTURA del pedido
asociado a un ticket. La ESCRITURA (contrato 15) no vive aquí: es la proyección
interna que el POS invoca en la MISMA transacción del guardado/cobro del ticket
(`services/orders_service.proyectar_pedido`). Este router solo expone la
consulta, que es lo que el POS necesita para mostrar la programación de un
pedido ya creado.

Frontera por contratos (A-02):
  El POS NO lee la tabla `orders` directamente. Pide el pedido por este
  contrato y recibe una PROYECCIÓN (O-23), no la fila completa. Los campos
  internos de Reparto (`delivery_lat`, `delivery_lng`, `delivery_distance_km`)
  y los de auditoría (`created_at`, `updated_at`) NO se exponen.

  Contrato 16 `pedidos.pedido_del_ticket` → GET /orders/by-ticket/{ticket_id}
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models import Order
from schemas import PedidoDelTicketSalida

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("/by-ticket/{ticket_id}", response_model=PedidoDelTicketSalida)
async def pedido_del_ticket(
    ticket_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> PedidoDelTicketSalida:
    """Devuelve el pedido asociado al ticket, o 404 si no tiene.

    La relación ticket → pedido es 1:1 (RN-68). Un ticket de venta directa
    nunca tiene pedido: en ese caso, y también si el ticket no existe, la
    respuesta es 404 (el contrato 16 no distingue ambos casos: para el POS
    significan lo mismo, "este ticket no tiene pedido").
    """
    pedido = (
        await db.execute(select(Order).where(Order.ticket_id == ticket_id))
    ).scalars().first()

    if pedido is None:
        raise HTTPException(
            status_code=404,
            detail="El ticket no existe o no tiene pedido asociado",
        )

    # Proyección explícita (O-23): se arma el DTO campo por campo para no
    # filtrar columnas internas de `orders` al consumidor.
    return PedidoDelTicketSalida(
        order_id=pedido.id,
        delivery_type=pedido.delivery_type,
        status=pedido.status,
        customer_name=pedido.customer_name,
        customer_phone=pedido.customer_phone,
        committed_at=pedido.committed_at,
        packaging_type=pedido.packaging_type,
        delivery_address=pedido.delivery_address,
        delivery_fee=pedido.delivery_fee,
        notes=pedido.notes,
    )
