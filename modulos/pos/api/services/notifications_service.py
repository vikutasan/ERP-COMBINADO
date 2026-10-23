"""Encolado de notificaciones (contrato 27) — FASE 12.22.

Materializa el patrón Outbox (Regla de Oro #7) para el envío del ticket por
WhatsApp/email. El POS NUNCA envía directamente: escribe una fila en
`notification_outbox` y un worker externo la procesa.

Reglas que gobiernan este servicio:
  - RN-85: el POS solo ENCOLA. Nunca llama al proveedor de WhatsApp/email.
  - RN-86: el encolado es idempotente por `evento_id`. Reintentar el mismo
    envío NO duplica la fila.
  - RN-89: el canal debe ser WHATSAPP o EMAIL.
  - RN-90: el destino debe corresponder al canal (teléfono o email).
  - RN-88 (DT-07): un fallo de Notificaciones NO tumba el POS. Aquí no hay
    llamada de red: el encolado es una escritura local, así que no puede fallar
    por el proveedor externo.

Frontera (A-02): este servicio escribe SOLO en `notification_outbox`. No conoce
el worker, ni el proveedor, ni el esquema del ticket.
"""

from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import NotificationOutbox
from rules import ReglaViolada

# Canales soportados (RN-89). En MAYÚSCULAS, como los envía el POS.
CANALES_SOPORTADOS = ("WHATSAPP", "EMAIL")

# Validación de destino (RN-90). Deliberadamente laxa: el POS no es un
# validador de RFC 5322 ni de E.164; solo descarta lo evidentemente vacío o
# malformado. El proveedor externo hará la validación final.
_RE_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_RE_TELEFONO = re.compile(r"^\+?[0-9][0-9\s\-()]{6,}$")


def _normalizar_canal(canal: str) -> str:
    """Normaliza y valida el canal (RN-89). Devuelve el canal en MAYÚSCULAS."""
    normalizado = (canal or "").strip().upper()
    if normalizado not in CANALES_SOPORTADOS:
        raise ReglaViolada(
            "RN-89",
            f"Canal no soportado: '{canal}'. Use WHATSAPP o EMAIL.",
            400,
        )
    return normalizado


def _validar_destino(destino: str, canal: str) -> str:
    """Valida el destino según el canal (RN-90). Devuelve el destino limpio."""
    limpio = (destino or "").strip()
    if not limpio:
        raise ReglaViolada("RN-90", "El destino no puede estar vacío.", 400)

    if canal == "EMAIL":
        if not _RE_EMAIL.match(limpio):
            raise ReglaViolada(
                "RN-90", f"Correo inválido para el canal EMAIL: '{limpio}'.", 400
            )
    elif canal == "WHATSAPP":
        if not _RE_TELEFONO.match(limpio):
            raise ReglaViolada(
                "RN-90", f"Teléfono inválido para el canal WHATSAPP: '{limpio}'.", 400
            )
    return limpio


def _destino_para_canal(destinatario: dict, canal: str) -> str:
    """Extrae el destino del diccionario `destinatario` según el canal.

    El POS envía `{telefono: '...'}` para WhatsApp y `{email: '...'}` para email.
    """
    if canal == "WHATSAPP":
        return destinatario.get("telefono", "")
    return destinatario.get("email", "")


async def encolar_ticket(
    db: AsyncSession,
    *,
    evento_id: str,
    ticket_uuid: UUID | None,
    canales: list[str],
    destinatario: dict,
    payload: dict,
) -> list[NotificationOutbox]:
    """Encola el envío del ticket por cada canal pedido (contrato 27).

    Idempotente por `evento_id` + canal (RN-86): si ya existe una fila para el
    mismo `evento_id` y canal, se devuelve la existente en vez de duplicarla.
    Esto permite que el cajero reintente sin miedo.

    Devuelve la lista de filas del outbox (nuevas o ya existentes), una por
    canal. Lanza `ReglaViolada` (400) si un canal no es soportado (RN-89) o si
    el destino no corresponde al canal (RN-90).

    NO hace commit: el llamador (el router) decide la transacción. Así el
    encolado puede ir en la MISMA transacción del ticket (RN-86).
    """
    if not canales:
        raise ReglaViolada("RN-89", "Debe indicar al menos un canal de envío.", 400)

    filas: list[NotificationOutbox] = []
    for canal_crudo in canales:
        canal = _normalizar_canal(canal_crudo)
        destino = _validar_destino(_destino_para_canal(destinatario, canal), canal)

        # Clave de idempotencia por canal: el mismo evento puede ir por dos
        # canales distintos y cada uno es una fila independiente.
        clave = f"{evento_id}:{canal}"

        existente = (
            await db.execute(
                select(NotificationOutbox).where(
                    NotificationOutbox.evento_id == clave
                )
            )
        ).scalars().first()

        if existente is not None:
            filas.append(existente)
            continue

        fila = NotificationOutbox(
            evento_id=clave,
            ticket_uuid=ticket_uuid,
            canal=canal,
            destino=destino,
            payload=payload or {},
            estado="PENDIENTE",
        )
        db.add(fila)
        filas.append(fila)

    await db.flush()
    return filas
