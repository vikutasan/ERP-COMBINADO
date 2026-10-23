"""Contratos 3 y 5 — Crear y Cobrar ticket — FD-04."""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.database import get_db
from models import PosAuditLog, Product, Ticket, TicketItem, TicketItemIntent
from rules.registry import (
    rn14_ciclo_de_vida,
    rn18_unit_price_congelado,
    rn19_subtotal_de_linea,
    rn20_cantidad_entero_positivo,
    rn21_producto_inexistente,
    rn22_producto_inactivo,
    rn23_no_modificar_paid,
    rn25_validar_version,
    rn27_incrementar_version,
    rn94_suma_de_pagos_cuadra_total,
    rn95_metodos_de_pago_validos,
)
from schemas import CobrarTicketEntrada, CrearTicketEntrada, TicketSalida
from services.orders_service import proyectar_pedido

from .deps import (
    _auditar_fallback_turno,
    _estricto_turno_caja,
    _normalizar_pagos,
    _sesion_activa_o_404,
    _sesion_caja_activa_o_400,
    _sesion_caja_por_id_o_400,
    _siguiente_folio,
    _ticket_a_salida,
    _ticket_con_items_o_404,
)

router = APIRouter()


@router.post("/tickets", response_model=TicketSalida, status_code=201)
async def crear_ticket(
    entrada: CrearTicketEntrada,
    db: AsyncSession = Depends(get_db),
) -> TicketSalida:
    """Crea un ticket OPEN con sus líneas, resolviendo precios contra el catálogo."""
    sesion = await _sesion_activa_o_404(db, entrada.terminal_id)

    lineas: list[TicketItem] = []
    item_ids_derivados: list[str] = []
    total = Decimal("0.00")

    for linea in entrada.items:
        rn20_cantidad_entero_positivo(linea.quantity)

        producto = (
            await db.execute(select(Product).where(Product.id == linea.product_id))
        ).scalars().first()

        rn21_producto_inexistente(None if producto is None else {"id": str(producto.id)})
        rn22_producto_inactivo({"activo": bool(producto.active)})  # type: ignore[union-attr]

        unit_price = rn18_unit_price_congelado(producto.price, None)  # type: ignore[union-attr]
        subtotal = rn19_subtotal_de_linea(unit_price, linea.quantity)
        total += subtotal

        # CIERRE DEUDA D-9 — `item_id` derivado del `product_id` para la vía
        # del contrato 3 (crear con items). Es la misma convención del backfill.
        item_id_derivado = str(linea.product_id)
        lineas.append(
            TicketItem(
                item_id=item_id_derivado,
                product_id=linea.product_id,
                quantity=linea.quantity,
                unit_price=unit_price,
                subtotal=subtotal,
            )
        )
        item_ids_derivados.append(item_id_derivado)

    ticket = Ticket(
        account_num=await _siguiente_folio(db),
        status=rn14_ciclo_de_vida("OPEN"),
        total=total,
        version=0,
        terminal_id=entrada.terminal_id,
        channel=entrada.channel or "PANADERIA",
        session_id=sesion.id,
        items=lineas,
        order_type=entrada.order_type or "VENTA_DIRECTA",
        order_status=entrada.order_status or "PROGRAMADO PARA SER PREPARADO",
        delivery_type=entrada.delivery_type,
        customer_name=entrada.customer_name,
        customer_phone=entrada.customer_phone,
        committed_at=entrada.committed_at,
        packaging_type=entrada.packaging_type,
        delivery_address=entrada.delivery_address,
        order_notes=entrada.order_notes,
        captured_by_name=entrada.capturista_nombre,
    )
    db.add(ticket)
    await db.flush()

    # CIERRE DEUDA D-9 — Sembrar el ledger de intenciones.
    for item_id_derivado in item_ids_derivados:
        db.add(TicketItemIntent(ticket_id=ticket.id, item_id=item_id_derivado))

    ticket = (
        await db.execute(
            select(Ticket).options(selectinload(Ticket.items)).where(Ticket.id == ticket.id)
        )
    ).scalars().one()

    await proyectar_pedido(db, ticket)
    await db.commit()
    return _ticket_a_salida(ticket)


@router.post("/tickets/{ticket_id}/pay", response_model=TicketSalida)
async def cobrar_ticket(
    ticket_id: UUID,
    entrada: CobrarTicketEntrada,
    db: AsyncSession = Depends(get_db),
) -> TicketSalida:
    """Cobra un ticket: valida versión, lo pasa a PAID y guarda el pago.

    FASE 4.0 — El cobro EXIGE un turno de caja abierto (RN-49).
    BUG-08 — La terminal que COBRA puede ser distinta a la de origen.
    """
    ticket = (
        await db.execute(
            select(Ticket).options(selectinload(Ticket.items)).where(Ticket.id == ticket_id)
        )
    ).scalars().first()

    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket inexistente")

    rn23_no_modificar_paid(ticket.status)
    rn25_validar_version(entrada.version, ticket.version)

    if entrada.cash_session_id is not None:
        sesion_caja = await _sesion_caja_por_id_o_400(db, entrada.cash_session_id)
        uso_fallback = False
    else:
        if _estricto_turno_caja():
            raise HTTPException(
                status_code=400,
                detail=(
                    "POS_ESTRICTO_TURNO_CAJA activo: el cobro exige declarar "
                    "`cash_session_id` (el turno de la caja que cobra)."
                ),
            )
        sesion_caja = await _sesion_caja_activa_o_400(db, ticket.terminal_id)
        uso_fallback = True

    detalles_normalizados = _normalizar_pagos(entrada.payment_details, ticket.total)
    pagos = detalles_normalizados.get("pagos", [])
    rn95_metodos_de_pago_validos(pagos)
    rn94_suma_de_pagos_cuadra_total(pagos, ticket.total)

    ticket.status = rn14_ciclo_de_vida("PAID")
    ticket.version = rn27_incrementar_version(ticket.version)
    ticket.payment_details = detalles_normalizados
    ticket.cash_session_id = sesion_caja.id
    ticket.cashed_by_name = entrada.cobrador_nombre

    await db.flush()
    await db.refresh(ticket)

    await proyectar_pedido(db, ticket, forzar=True)

    if uso_fallback:
        db.add(_auditar_fallback_turno(ticket, sesion_caja))

    await db.commit()
    return _ticket_a_salida(ticket)
