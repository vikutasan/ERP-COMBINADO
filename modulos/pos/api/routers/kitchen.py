"""Router de la cola de cocina — MS-01 (Contratos 28 y 29).

Contratos:
  28 · kitchen.queue      → GET  /orders/kitchen-queue
  29 · kitchen.update     → PATCH /orders/kitchen-queue/{kitchen_ticket_id}
  30 · kitchen.enqueue    → POST  /orders/kitchen-queue  (interno: POS envía ticket)

Ciclo de vida:
  1. El POS envía un ticket a cocina (POST /orders/kitchen-queue).
     Esto lo hace automáticamente cuando el cajero pulsa "Enviar al pizarrón"
     y el canal es distinto a VENTA_DIRECTA, o cuando el operario lo dispara
     manualmente. En MS-01 lo dispara el propio endpoint de cobro (cuando
     order_status cambia a EN_COCINA).
  2. La pantalla de cocina hace polling GET /orders/kitchen-queue cada 5s.
  3. La cocina avanza el estado con PATCH (RECIBIDO → EN_PREP → LISTO).
  4. Cuando el estado llega a LISTO, el campo `listo_at` se sella con la hora
     actual. El POS puede detectar tickets LISTOS en el polling del pizarrón.

Frontera A-02:
  La pantalla de cocina NUNCA consulta `tickets` directamente. Lee solo
  `kitchen_tickets`, que es una proyección pre-materializada.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.timestamps import utcnow
from models.kitchen import ESTADOS_COCINA, KitchenTicket
from models.pos import Ticket, TicketItem
from schemas.kitchen import (
    ActualizarEstadoCocinaEntrada,
    ActualizarEstadoCocinaRespuesta,
    KitchenQueueSalida,
    KitchenTicketSalida,
    LineaCocinaSchema,
)

router = APIRouter(prefix="/orders", tags=["kitchen"])


# ---------------------------------------------------------------------------
# Contrato 28 — GET /orders/kitchen-queue
# ---------------------------------------------------------------------------

@router.get("/kitchen-queue", response_model=KitchenQueueSalida)
async def leer_cola_cocina(
    canal: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> KitchenQueueSalida:
    """Devuelve los pedidos activos en la cola de cocina.

    Filtra por `kitchen_status` ≠ LISTO: devuelve RECIBIDO y EN_PREP.
    Si se pasa `canal` (query param), filtra por ese canal.

    Orden: primero EN_PREP (ya empezados), luego RECIBIDO (por orden de llegada).
    """
    stmt = select(KitchenTicket).where(
        KitchenTicket.kitchen_status.in_(["RECIBIDO", "EN_PREP"])
    )
    if canal:
        stmt = stmt.where(KitchenTicket.channel == canal)

    # Orden: EN_PREP primero, luego RECIBIDO por created_at ascendente.
    stmt = stmt.order_by(
        KitchenTicket.kitchen_status.desc(),  # 'R' < 'E', así EN_PREP primero
        KitchenTicket.created_at.asc(),
    )

    filas = (await db.execute(stmt)).scalars().all()

    tickets_salida: list[KitchenTicketSalida] = []
    for kt in filas:
        lineas = [
            LineaCocinaSchema(name=l["name"], quantity=l["quantity"])
            for l in (kt.lineas_json or [])
        ]
        tickets_salida.append(
            KitchenTicketSalida(
                id=kt.id,
                ticket_id=kt.ticket_id,
                account_num=kt.account_num,
                customer_name=kt.customer_name,
                channel=kt.channel,
                kitchen_status=kt.kitchen_status,
                lineas=lineas,
                notas=kt.notas,
                created_at=kt.created_at,
                updated_at=kt.updated_at,
                listo_at=kt.listo_at,
            )
        )

    return KitchenQueueSalida(tickets=tickets_salida, total=len(tickets_salida))


# ---------------------------------------------------------------------------
# Contrato 29 — PATCH /orders/kitchen-queue/{kitchen_ticket_id}
# ---------------------------------------------------------------------------

@router.patch(
    "/kitchen-queue/{kitchen_ticket_id}",
    response_model=ActualizarEstadoCocinaRespuesta,
)
async def actualizar_estado_cocina(
    kitchen_ticket_id: UUID,
    body: ActualizarEstadoCocinaEntrada,
    db: AsyncSession = Depends(get_db),
) -> ActualizarEstadoCocinaRespuesta:
    """Avanza el estado de un ticket en cocina.

    Transición válida: RECIBIDO → EN_PREP → LISTO.
    Un estado ya en LISTO no puede retroceder (RN-KT-01).
    """
    kt = await db.get(KitchenTicket, kitchen_ticket_id)
    if kt is None:
        raise HTTPException(status_code=404, detail="Ticket de cocina no encontrado")

    nuevo_estado = body.kitchen_status
    estado_actual = kt.kitchen_status

    # Validar que la transición sea hacia adelante.
    idx_actual = ESTADOS_COCINA.index(estado_actual) if estado_actual in ESTADOS_COCINA else -1
    idx_nuevo = ESTADOS_COCINA.index(nuevo_estado) if nuevo_estado in ESTADOS_COCINA else -1

    if idx_nuevo <= idx_actual:
        raise HTTPException(
            status_code=422,
            detail=f"Transición inválida: {estado_actual} → {nuevo_estado}. "
                   "El estado solo puede avanzar: RECIBIDO → EN_PREP → LISTO.",
        )

    kt.kitchen_status = nuevo_estado
    kt.updated_at = utcnow()

    if nuevo_estado == "LISTO":
        kt.listo_at = utcnow()

    await db.commit()
    await db.refresh(kt)

    return ActualizarEstadoCocinaRespuesta(
        id=kt.id,
        kitchen_status=kt.kitchen_status,
        updated_at=kt.updated_at,
        listo_at=kt.listo_at,
    )


# ---------------------------------------------------------------------------
# Contrato 30 — POST /orders/kitchen-queue  (interno: el POS encola un ticket)
# ---------------------------------------------------------------------------

@router.post("/kitchen-queue", response_model=KitchenTicketSalida, status_code=201)
async def encolar_en_cocina(
    ticket_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> KitchenTicketSalida:
    """Encola un ticket en la pantalla de cocina.

    El POS llama a este endpoint cuando un ticket está listo para preparación.
    Si el ticket ya está en cola (idempotencia), devuelve el registro existente.

    Lee las líneas del ticket para materializar `lineas_json` (sin JOIN futuro).
    """
    # Idempotencia: si ya existe, devolvemos el existente.
    existente = (
        await db.execute(
            select(KitchenTicket).where(KitchenTicket.ticket_id == ticket_id)
        )
    ).scalars().first()

    if existente is not None:
        lineas = [
            LineaCocinaSchema(name=l["name"], quantity=l["quantity"])
            for l in (existente.lineas_json or [])
        ]
        return KitchenTicketSalida(
            id=existente.id,
            ticket_id=existente.ticket_id,
            account_num=existente.account_num,
            customer_name=existente.customer_name,
            channel=existente.channel,
            kitchen_status=existente.kitchen_status,
            lineas=lineas,
            notas=existente.notas,
            created_at=existente.created_at,
            updated_at=existente.updated_at,
            listo_at=existente.listo_at,
        )

    # Leer el ticket fuente para materializar la proyección.
    ticket = (
        await db.execute(select(Ticket).where(Ticket.id == ticket_id))
    ).scalars().first()

    if ticket is None:
        raise HTTPException(status_code=404, detail="Ticket no encontrado")

    # Leer líneas del ticket.
    items = (
        await db.execute(
            select(TicketItem).where(TicketItem.ticket_id == ticket_id)
        )
    ).scalars().all()

    lineas_json = [
        {"name": item.name or "Producto", "quantity": item.quantity}
        for item in items
    ]

    kt = KitchenTicket(
        ticket_id=ticket_id,
        account_num=ticket.account_num,
        customer_name=ticket.customer_name,
        channel=ticket.channel,
        kitchen_status="RECIBIDO",
        lineas_json=lineas_json,
        notas=ticket.order_notes,
    )
    db.add(kt)
    await db.commit()
    await db.refresh(kt)

    lineas_salida = [
        LineaCocinaSchema(name=l["name"], quantity=l["quantity"])
        for l in (kt.lineas_json or [])
    ]

    return KitchenTicketSalida(
        id=kt.id,
        ticket_id=kt.ticket_id,
        account_num=kt.account_num,
        customer_name=kt.customer_name,
        channel=kt.channel,
        kitchen_status=kt.kitchen_status,
        lineas=lineas_salida,
        notas=kt.notas,
        created_at=kt.created_at,
        updated_at=kt.updated_at,
        listo_at=kt.listo_at,
    )
