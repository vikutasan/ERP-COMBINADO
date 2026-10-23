"""Dependencias y utilidades compartidas del router POS — FD-04.

Todas las funciones helper que usan múltiples sub-routers viven aquí para
evitar importaciones cruzadas entre submódulos.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import CashSession, PosAuditLog, TerminalSession, Ticket, TicketItem
from rules import ReglaViolada
from rules.registry import (
    rn10_formato_de_folio,
    rn14_ciclo_de_vida,
    rn16_total_es_suma_de_subtotales,
    rn18_unit_price_congelado,
    rn19_subtotal_de_linea,
    rn24_sesion_activa,
    rn27_incrementar_version,
    rn49_una_sesion_caja_por_terminal,
)
from schemas import (
    EventoAuditableSalida,
    LineaAtomicaSalida,
    LineaSalida,
    TicketAtomicoSalida,
    TicketSalida,
)


# ---------------------------------------------------------------------------
# DEUDA-BUG08 (Observación 2) — Fallback de turno de caja observable.
# ---------------------------------------------------------------------------

def _estricto_turno_caja() -> bool:
    """True si `POS_ESTRICTO_TURNO_CAJA` exige que el cliente declare el turno."""
    return os.environ.get("POS_ESTRICTO_TURNO_CAJA", "").strip().lower() in (
        "1", "true", "yes", "on",
    )


# ---------------------------------------------------------------------------
# Queries de sesión
# ---------------------------------------------------------------------------

async def _sesion_activa_o_404(db: AsyncSession, terminal_id: str) -> TerminalSession:
    """Devuelve la sesión abierta de la terminal, o lanza 400 (RN-24)."""
    sesion = (
        await db.execute(
            select(TerminalSession).where(
                TerminalSession.terminal_id == terminal_id,
                TerminalSession.is_active.is_(True),
            )
        )
    ).scalars().first()

    rn24_sesion_activa("OPEN" if sesion is not None else "CLOSED")
    return sesion  # type: ignore[return-value]


async def _sesion_caja_activa_o_400(db: AsyncSession, terminal_id: str) -> CashSession:
    """Devuelve el turno de caja OPEN de la terminal, o lanza 400 (RN-49)."""
    sesiones = (
        await db.execute(
            select(CashSession).where(
                CashSession.terminal_id == terminal_id,
                CashSession.status == "OPEN",
            )
        )
    ).scalars().all()

    rn49_una_sesion_caja_por_terminal(
        [{"terminal_id": s.terminal_id, "estado": s.status} for s in sesiones],
        terminal_id,
    )
    if not sesiones:
        raise ReglaViolada(
            "RN-49", "No hay turno de caja abierto para esta terminal", 400
        )
    return sesiones[0]


async def _sesion_caja_por_id_o_400(db: AsyncSession, cash_session_id: UUID) -> CashSession:
    """Valida un turno de caja DECLARADO por el cliente (E-13) y lo devuelve.

    BUG-08 — Tres validaciones: existe + OPEN (RN-55) + terminal con sesión activa (RN-24).
    """
    sesion = (
        await db.execute(select(CashSession).where(CashSession.id == cash_session_id))
    ).scalars().first()
    if sesion is None:
        raise ReglaViolada("RN-49", "El turno de caja indicado no existe", 400)
    if sesion.status != "OPEN":
        raise ReglaViolada("RN-55", "El turno de caja indicado está cerrado", 400)
    await _sesion_activa_o_404(db, sesion.terminal_id)
    return sesion


# ---------------------------------------------------------------------------
# Queries de ticket
# ---------------------------------------------------------------------------

async def _siguiente_folio(db: AsyncSession) -> str:
    """Calcula el siguiente folio V#### a partir del máximo consecutivo (RN-10)."""
    total = (await db.execute(select(func.count(Ticket.id)))).scalar_one()
    return rn10_formato_de_folio(int(total) + 1)


async def _ticket_con_items_o_404(db: AsyncSession, ticket_id: UUID) -> Ticket:
    """Carga un ticket con sus líneas, o lanza 404 si no existe."""
    ticket = (
        await db.execute(
            select(Ticket).options(selectinload(Ticket.items)).where(Ticket.id == ticket_id)
        )
    ).scalars().first()
    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket inexistente")
    return ticket


# ---------------------------------------------------------------------------
# Proyecciones
# ---------------------------------------------------------------------------

def _ticket_a_salida(ticket: Ticket) -> TicketSalida:
    """Proyecta el modelo ORM al esquema de salida (con sus líneas).

    F9.1.4 — `payment_details` viaja al cliente para desglosar pagos mixtos.
    F12.21 — Los campos `order_*` viajan para doble copia al imprimir.
    """
    return TicketSalida(
        id=ticket.id,
        account_num=ticket.account_num,
        status=ticket.status,
        total=ticket.total,
        version=ticket.version,
        terminal_id=ticket.terminal_id,
        channel=ticket.channel,
        items=[LineaSalida.model_validate(i) for i in ticket.items],
        payment_details=ticket.payment_details,
        order_type=ticket.order_type,
        delivery_type=ticket.delivery_type,
        customer_name=ticket.customer_name,
        customer_phone=ticket.customer_phone,
        committed_at=ticket.committed_at,
        packaging_type=ticket.packaging_type,
        delivery_address=ticket.delivery_address,
        order_notes=ticket.order_notes,
        # F12.6 — Trazabilidad: viajan al cliente para el ticket impreso.
        captured_by_name=ticket.captured_by_name,
        cashed_by_name=ticket.cashed_by_name,
        created_at=ticket.created_at,
    )


def _lineas_atomicas(ticket: Ticket) -> list[LineaAtomicaSalida]:
    """Proyecta las líneas del ticket a la salida atómica (contratos 18–20).

    CIERRE DEUDA D-9 — Devuelve el `item_id` REAL persistido (no derivado).
    """
    return [
        LineaAtomicaSalida(
            item_id=item.item_id,
            product_id=item.product_id,
            quantity=item.quantity,
            unit_price=item.unit_price,
            subtotal=item.subtotal,
        )
        for item in ticket.items
    ]


def _ticket_atomico(ticket: Ticket, item_id: str) -> TicketAtomicoSalida:
    """Salida común de los contratos 18, 19 y 20."""
    return TicketAtomicoSalida(
        ticket_id=ticket.id,
        item_id=item_id,
        version=ticket.version,
        total=ticket.total,
        lineas=_lineas_atomicas(ticket),
    )


def _recalcular_total(ticket: Ticket) -> Decimal:
    """Recalcula el total del ticket como la suma de sus subtotales (RN-16)."""
    return rn16_total_es_suma_de_subtotales(
        [{"subtotal": item.subtotal} for item in ticket.items]
    )


def _evento_auditable(fila: PosAuditLog) -> EventoAuditableSalida:
    """Proyecta una fila de `pos_audit_log` al resumen del contrato 5 (O-23)."""
    return EventoAuditableSalida(
        tipo=fila.endpoint,
        ticket_id=(fila.payload or {}).get("ticket_id"),
        usuario_id=fila.usuario_id,
        timestamp=fila.timestamp,
        detalle={
            "codigo": fila.codigo,
            "payload": fila.payload or {},
            "extras": fila.extras or {},
        },
    )


# ---------------------------------------------------------------------------
# Normalización de pagos
# ---------------------------------------------------------------------------

def _normalizar_pagos(payment_details: dict, total: Decimal | None = None) -> dict:
    """FASE 9.1 — Normaliza `payment_details` a la forma canónica `pagos[]`.

    Retrocompatibilidad: un cobro viejo (`{metodo, recibido, cambio}`) se
    convierte en `{pagos: [{metodo, monto, recibido, cambio}]}`.

    FICHA_FIX_SUMA_NO_CUADRA_VUELTO (3ª vuelta, 7 Oct 2026) — Acota `monto`
    al total para que un vuelto legítimo no rompa RN-94.
    """
    detalles = dict(payment_details or {})
    if "pagos" in detalles:
        return detalles
    metodo = detalles.get("metodo")
    if metodo is None:
        return detalles
    pago: dict = {"metodo": str(metodo).upper()}
    if "monto" in detalles:
        pago["monto"] = detalles["monto"]
    elif total is not None:
        pago["monto"] = str(total)
    if total is not None and "monto" in pago:
        try:
            monto_dec = Decimal(str(pago["monto"]))
            total_dec = Decimal(str(total))
            if monto_dec > total_dec:
                pago["monto"] = str(total_dec)
        except (InvalidOperation, ValueError, TypeError):
            pass
    if "recibido" in detalles:
        pago["recibido"] = detalles["recibido"]
    if "cambio" in detalles:
        pago["cambio"] = detalles["cambio"]
    normalizado = {k: v for k, v in detalles.items() if k not in {"metodo", "recibido", "cambio", "monto"}}
    normalizado["pagos"] = [pago]
    return normalizado


# ---------------------------------------------------------------------------
# Registro de auditoría de fallback de turno
# ---------------------------------------------------------------------------

def _auditar_fallback_turno(
    ticket: Ticket,
    sesion_caja: CashSession,
) -> PosAuditLog:
    """Crea el asiento de auditoría cuando se usa el fallback de turno (DEUDA-BUG08)."""
    return PosAuditLog(
        endpoint="POST /pos/tickets/{id}/pay",
        payload={
            "ticket_id": str(ticket.id),
            "terminal_origen": ticket.terminal_id,
            "cash_session_id": str(sesion_caja.id),
            "terminal_caja": sesion_caja.terminal_id,
        },
        codigo=200,
        terminal_id=sesion_caja.terminal_id,
        usuario_id=None,
        extras={
            "motivo": "fallback_turno_de_la_terminal_del_ticket",
            "observacion": "DEUDA-BUG08-OBS2",
        },
        timestamp=datetime.now(timezone.utc),
    )
