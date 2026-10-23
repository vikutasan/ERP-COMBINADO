"""Contratos 21, 22, 30, 23, 31, 26 — Lecturas y operaciones mixtas — FD-04."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models import PosAuditLog, Ticket
from rules.registry import (
    rn23_no_modificar_paid,
    rn25_validar_version,
    rn27_incrementar_version,
    rn78_timestamps_en_utc,
)
from schemas import (
    ActualizarPedidoEntrada,
    CuentaAbiertaSalida,
    CuentasAbiertasSalida,
    EventosAuditablesSalida,
    LineasTicketSalida,
    TicketLigeroSalida,
    TicketSalida,
    VerificarEnvioEntrada,
    VerificarEnvioSalida,
)
from services.orders_service import proyectar_pedido

from .deps import (
    _evento_auditable,
    _lineas_atomicas,
    _ticket_a_salida,
    _ticket_con_items_o_404,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Contrato 21 — GET /pos/tickets/{id}
# ---------------------------------------------------------------------------

@router.get("/tickets/{ticket_id}", response_model=TicketLigeroSalida)
async def leer_ticket(
    ticket_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> TicketLigeroSalida:
    """Lee un ticket con RESPUESTA LIGERA: 5 campos escalares (contrato 21, Regla 15)."""
    ticket = (
        await db.execute(select(Ticket).where(Ticket.id == ticket_id))
    ).scalars().first()
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket inexistente")
    return TicketLigeroSalida.model_validate(ticket)


# ---------------------------------------------------------------------------
# Contrato 22 — POST /pos/tickets/{id}/verify
# ---------------------------------------------------------------------------

@router.post("/tickets/{ticket_id}/verify", response_model=VerificarEnvioSalida)
async def verificar_envio(
    ticket_id: UUID,
    entrada: VerificarEnvioEntrada,
    db: AsyncSession = Depends(get_db),
) -> VerificarEnvioSalida:
    """Verificación post-envío por COBERTURA (contrato 22).

    BUG-06 — Verifica cobertura, no identidad exacta de item_id.
    BUG-07 — Verifica UNIDADES (no número de filas) para respetar RN-17.
    """
    ticket = await _ticket_con_items_o_404(db, ticket_id)

    n_unidades_servidor = sum(int(item.quantity) for item in ticket.items)

    if entrada.cantidades:
        n_unidades_afirmadas = sum(int(c) for c in entrada.cantidades)
    else:
        n_unidades_afirmadas = len(entrada.item_ids)

    if n_unidades_servidor >= n_unidades_afirmadas:
        return VerificarEnvioSalida(
            existe=True,
            item_ids_persistidos=list(entrada.item_ids),
            faltantes=[],
        )

    deficit = n_unidades_afirmadas - n_unidades_servidor
    n_lineas_afirmadas = len(entrada.item_ids)
    n_lineas_persistidas = max(0, n_lineas_afirmadas - deficit)
    return VerificarEnvioSalida(
        existe=True,
        item_ids_persistidos=list(entrada.item_ids[:n_lineas_persistidas]),
        faltantes=list(entrada.item_ids[n_lineas_persistidas:]),
    )


# ---------------------------------------------------------------------------
# Contrato 30 — GET /pos/tickets/{id}/items
# ---------------------------------------------------------------------------

@router.get("/tickets/{ticket_id}/items", response_model=LineasTicketSalida)
async def leer_lineas(
    ticket_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> LineasTicketSalida:
    """Lee las LÍNEAS de un ticket (contrato 30, FASE 12.10)."""
    ticket = await _ticket_con_items_o_404(db, ticket_id)
    return LineasTicketSalida(
        ticket_id=ticket.id,
        version=ticket.version,
        total=ticket.total,
        lineas=_lineas_atomicas(ticket),
    )


# ---------------------------------------------------------------------------
# Contrato 31 — PATCH /pos/tickets/{id}/order
# ---------------------------------------------------------------------------

@router.patch("/tickets/{ticket_id}/order", response_model=TicketSalida)
async def actualizar_pedido(
    ticket_id: UUID,
    entrada: ActualizarPedidoEntrada,
    db: AsyncSession = Depends(get_db),
) -> TicketSalida:
    """Actualiza la programación de un ticket OPEN ya creado (contrato 31).

    Semántica PATCH: solo se aplican los campos enviados (`model_fields_set`).
    Atómico con la re-proyección del pedido (contrato 15).
    """
    ticket = await _ticket_con_items_o_404(db, ticket_id)

    rn23_no_modificar_paid(ticket.status)
    rn25_validar_version(entrada.version, ticket.version)

    enviados = entrada.model_fields_set

    if "order_type" in enviados:
        ticket.order_type = entrada.order_type or "VENTA_DIRECTA"
    if "order_status" in enviados:
        ticket.order_status = entrada.order_status or "PROGRAMADO PARA SER PREPARADO"
    if "delivery_type" in enviados:
        ticket.delivery_type = entrada.delivery_type
    if "customer_name" in enviados:
        ticket.customer_name = entrada.customer_name
    if "customer_phone" in enviados:
        ticket.customer_phone = entrada.customer_phone
    if "committed_at" in enviados:
        ticket.committed_at = entrada.committed_at
    if "packaging_type" in enviados:
        ticket.packaging_type = entrada.packaging_type
    if "delivery_address" in enviados:
        ticket.delivery_address = entrada.delivery_address
    if "order_notes" in enviados:
        ticket.order_notes = entrada.order_notes

    ticket.version = rn27_incrementar_version(ticket.version)
    await db.flush()
    await proyectar_pedido(db, ticket)
    await db.commit()

    ticket = await _ticket_con_items_o_404(db, ticket_id)
    return _ticket_a_salida(ticket)


# ---------------------------------------------------------------------------
# Contrato 23 — GET /pos/open-accounts
# ---------------------------------------------------------------------------

@router.get("/open-accounts", response_model=CuentasAbiertasSalida)
async def cuentas_abiertas(
    terminal_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> CuentasAbiertasSalida:
    """Lista las cuentas OPEN (contrato 23, FASE 5.0).

    FICHA_FIX_PIZARRON_422 — `terminal_id` es OPCIONAL: sin él devuelve TODAS
    las cuentas OPEN (modo CAJA, paridad con el viejo POS).
    """
    consulta = (
        select(Ticket)
        .where(Ticket.status == "OPEN")
        .order_by(Ticket.created_at.asc())
    )
    if terminal_id is not None and terminal_id.strip():
        consulta = consulta.where(Ticket.terminal_id == terminal_id)

    filas = (await db.execute(consulta)).scalars().all()
    return CuentasAbiertasSalida(
        cuentas=[CuentaAbiertaSalida.model_validate(t) for t in filas]
    )


# ---------------------------------------------------------------------------
# Contrato 26 — GET /pos/auditable-events
# ---------------------------------------------------------------------------

@router.get("/auditable-events", response_model=EventosAuditablesSalida)
async def eventos_auditables(
    desde: datetime = Query(..., description="Inicio del rango (ISO-8601, UTC)"),
    hasta: datetime = Query(..., description="Fin del rango (ISO-8601, UTC)"),
    db: AsyncSession = Depends(get_db),
) -> EventosAuditablesSalida:
    """Expone el resumen de eventos auditables (contrato 26, F13.1).

    RN-77: filtra por rango. RN-78: timestamps normalizados a UTC.
    """
    desde_utc = rn78_timestamps_en_utc(desde)
    hasta_utc = rn78_timestamps_en_utc(hasta)

    if desde_utc > hasta_utc:
        raise HTTPException(
            status_code=400,
            detail="El rango de fechas es inválido: 'desde' es posterior a 'hasta'.",
        )

    filas = (
        await db.execute(
            select(PosAuditLog)
            .where(PosAuditLog.timestamp >= desde_utc)
            .where(PosAuditLog.timestamp <= hasta_utc)
            .order_by(PosAuditLog.timestamp.asc())
        )
    ).scalars().all()

    return EventosAuditablesSalida(
        eventos=[_evento_auditable(f) for f in filas]
    )
