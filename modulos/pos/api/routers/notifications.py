"""Router de Notificaciones — FASE 12.22 (contrato 27).

Materializa el contrato 27 (`notificaciones.encolar_ticket`), la operación con
la que el POS ENCOLA el envío del ticket por WhatsApp/email. El envío real lo
hace un worker externo (módulo Notificaciones); este router solo escribe en la
cola Outbox.

Por qué existe esta F12.22:
  El contrato 27 estaba DECLARADO en `contracts/registry.py` desde la FASE 8.0,
  pero NUNCA se implementó: no había router, ni endpoint, ni modelo, ni
  servicio. El `TicketDeliveryPanel` del POS llamaba a
  `POST /notifications/enqueue-ticket` y recibía 404, así que los botones de
  WhatsApp y email SIEMPRE fallaban. Esta fase cierra ese hueco.

Frontera por contratos (A-02):
  El POS NO escribe en `notification_outbox` directamente. Pide el encolado por
  este contrato y recibe el `envio_id` de cada canal.

  Contrato 27 `notificaciones.encolar_ticket` → POST /notifications/enqueue-ticket

Degradación (DT-07, RN-88):
  El encolado es una escritura LOCAL (no hay llamada de red al proveedor), así
  que no puede fallar por WhatsApp/email caído. Si la BD falla, el POS ya cobró
  y el ticket impreso sigue siendo válido (RN-87).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from schemas import (
    EncolarTicketEntrada,
    EncolarTicketSalida,
    MensajeEncoladoSalida,
)
from services.notifications_service import encolar_ticket

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.post("/enqueue-ticket", response_model=EncolarTicketSalida)
async def enqueue_ticket(
    entrada: EncolarTicketEntrada,
    db: AsyncSession = Depends(get_db),
) -> EncolarTicketSalida:
    """Encola el envío del ticket por cada canal pedido (contrato 27).

    Idempotente por `evento_id` + canal (RN-86): reintentar el mismo envío no
    duplica la fila del outbox. Devuelve el `envio_id` de cada canal para que el
    POS pueda trazarlo.

    Lanza 400 (ReglaViolada) si un canal no es soportado (RN-89) o si el destino
    no corresponde al canal (RN-90).
    """
    filas = await encolar_ticket(
        db,
        evento_id=entrada.evento_id,
        ticket_uuid=entrada.ticket_uuid,
        canales=entrada.canales,
        destinatario=entrada.destinatario,
        payload=entrada.payload,
    )

    await db.commit()

    mensajes = [
        MensajeEncoladoSalida(
            canal=fila.canal,
            estado=fila.estado,
            envio_id=fila.id,
        )
        for fila in filas
    ]

    return EncolarTicketSalida(encolado=bool(mensajes), mensajes=mensajes)
