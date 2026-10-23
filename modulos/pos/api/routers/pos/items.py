"""Contratos 18, 19, 20 — Ítems atómicos (añadir, cambiar, quitar) — FD-04."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models import Product, Ticket, TicketItem, TicketItemIntent
from rules.registry import (
    rn18_unit_price_congelado,
    rn19_subtotal_de_linea,
    rn20_cantidad_entero_positivo,
    rn21_producto_inexistente,
    rn22_producto_inactivo,
    rn23_no_modificar_paid,
    rn25_validar_version,
    rn26_version_obsoleta,
    rn27_incrementar_version,
    rn37_umbral_anti_degradacion,
)
from schemas import AnadirItemEntrada, CambiarCantidadEntrada, QuitarItemEntrada, TicketAtomicoSalida

from .deps import (
    _recalcular_total,
    _sesion_activa_o_404,
    _ticket_atomico,
    _ticket_con_items_o_404,
)

router = APIRouter()


@router.post("/tickets/{ticket_id}/items", response_model=TicketAtomicoSalida)
async def anadir_item(
    ticket_id: UUID,
    entrada: AnadirItemEntrada,
    db: AsyncSession = Depends(get_db),
) -> TicketAtomicoSalida:
    """Añade un ítem. IDEMPOTENTE por `item_id` (contrato 18).

    CIERRE DEUDA D-9 — Idempotencia contra la TABLA LEDGER `ticket_item_intents`.
    El reintento de una intención ya procesada es un NO-OP, incluso si el ticket
    ya está PAID (la idempotencia se evalúa ANTES que RN-23).
    """
    ticket = await _ticket_con_items_o_404(db, ticket_id)

    # IDEMPOTENCIA (ANTES de RN-23): si esta intención ya se procesó, NO-OP.
    ya_procesado = (
        await db.execute(
            select(TicketItemIntent.id).where(
                TicketItemIntent.ticket_id == ticket_id,
                TicketItemIntent.item_id == entrada.item_id,
            )
        )
    ).scalars().first() is not None
    if ya_procesado:
        return _ticket_atomico(ticket, entrada.item_id)

    await _sesion_activa_o_404(db, ticket.terminal_id or "")
    rn23_no_modificar_paid(ticket.status)
    rn20_cantidad_entero_positivo(entrada.quantity)
    rn25_validar_version(entrada.version, ticket.version)

    # RN-17: un producto aparece una sola vez; si ya está, se incrementa.
    existente = next(
        (i for i in ticket.items if str(i.product_id) == str(entrada.product_id)), None
    )
    if existente is not None:
        existente.quantity += entrada.quantity
        existente.subtotal = rn19_subtotal_de_linea(existente.unit_price, existente.quantity)
    else:
        producto = (
            await db.execute(select(Product).where(Product.id == entrada.product_id))
        ).scalars().first()
        rn21_producto_inexistente(None if producto is None else {"id": str(producto.id)})
        rn22_producto_inactivo({"activo": bool(producto.active)})  # type: ignore[union-attr]

        unit_price = rn18_unit_price_congelado(producto.price, None)  # type: ignore[union-attr]
        ticket.items.append(
            TicketItem(
                item_id=entrada.item_id,
                product_id=entrada.product_id,
                quantity=entrada.quantity,
                unit_price=unit_price,
                subtotal=rn19_subtotal_de_linea(unit_price, entrada.quantity),
                # Se congela junto a `unit_price`: el ticket impreso muestra el
                # nombre que tenía el producto al venderse (F12.6b).
                name=producto.name,  # type: ignore[union-attr]
            )
        )

    # CIERRE DEUDA D-9 — Registra la intención en ambos caminos (fusión y creación).
    db.add(TicketItemIntent(ticket_id=ticket_id, item_id=entrada.item_id))

    ticket.total = _recalcular_total(ticket)
    ticket.version = rn27_incrementar_version(ticket.version)

    await db.commit()
    ticket = await _ticket_con_items_o_404(db, ticket_id)
    return _ticket_atomico(ticket, entrada.item_id)


@router.patch("/tickets/{ticket_id}/items/{item_id}", response_model=TicketAtomicoSalida)
async def cambiar_cantidad(
    ticket_id: UUID,
    item_id: str,
    entrada: CambiarCantidadEntrada,
    db: AsyncSession = Depends(get_db),
) -> TicketAtomicoSalida:
    """Cambia la cantidad de una línea. Bloqueo optimista por `version` (contrato 19)."""
    ticket = await _ticket_con_items_o_404(db, ticket_id)

    rn23_no_modificar_paid(ticket.status)
    rn25_validar_version(entrada.version, ticket.version)
    rn26_version_obsoleta(entrada.version, ticket.version)
    rn20_cantidad_entero_positivo(entrada.quantity)

    # CIERRE DEUDA D-9 — La línea se localiza por su `item_id` PERSISTIDO.
    linea = next((i for i in ticket.items if i.item_id == item_id), None)
    if linea is None:
        raise HTTPException(status_code=404, detail="Ítem inexistente")

    linea.quantity = entrada.quantity
    linea.subtotal = rn19_subtotal_de_linea(linea.unit_price, entrada.quantity)

    ticket.total = _recalcular_total(ticket)
    ticket.version = rn27_incrementar_version(ticket.version)

    await db.commit()
    ticket = await _ticket_con_items_o_404(db, ticket_id)
    return _ticket_atomico(ticket, item_id)


@router.delete("/tickets/{ticket_id}/items/{item_id}", response_model=TicketAtomicoSalida)
async def quitar_item(
    ticket_id: UUID,
    item_id: str,
    entrada: QuitarItemEntrada,
    db: AsyncSession = Depends(get_db),
) -> TicketAtomicoSalida:
    """Quita una línea. Anti-degradación RN-37 (contrato 20)."""
    ticket = await _ticket_con_items_o_404(db, ticket_id)

    rn23_no_modificar_paid(ticket.status)
    rn25_validar_version(entrada.version, ticket.version)

    linea = next((i for i in ticket.items if i.item_id == item_id), None)
    if linea is None:
        raise HTTPException(status_code=404, detail="Ítem inexistente")

    total_actual = len(ticket.items)
    total_nuevo = total_actual - 1
    rn37_umbral_anti_degradacion(total_actual, total_nuevo)

    ticket.items.remove(linea)
    await db.delete(linea)

    ticket.total = _recalcular_total(ticket)
    ticket.version = rn27_incrementar_version(ticket.version)

    await db.commit()
    ticket = await _ticket_con_items_o_404(db, ticket_id)
    return _ticket_atomico(ticket, item_id)
