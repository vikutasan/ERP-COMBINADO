/**
 * Servicio de notificaciones — FASE 8.2 (contrato 27).
 *
 * Responsabilidad: exponer la operación de encolado del ticket envuelta en el
 * contrato `{ outcome, reason, data }`. NUNCA lanza: un fallo de red o un
 * 4xx/5xx del API se traduce a `{ outcome:'error', reason }`.
 *
 * Por qué existe esta capa y no se llama al cliente directo:
 *   - Regla de Oro #7 (Outbox): el POS solo ESCRIBE en la cola; el worker
 *     envía después. Si la cola no está disponible, el ticket YA se cobró y
 *     NO se revierte. El servicio devuelve `reason: 'cola_no_disponible'` y
 *     el POS sigue con la impresión (RN-87).
 *   - El hook/componente (F8.5 TicketDeliveryPanel) decide con `esOk()` y
 *     muestra `resultado.reason` sin try/catch.
 *
 * Endpoint consumido (contrato 27, proveedor Notificaciones):
 *   POST /notifications/enqueue-ticket
 *     entrada: { evento_id, ticket_uuid, canales:[WHATSAPP|EMAIL],
 *                destinatario:{telefono?, email?}, payload:{folio, total, items, fecha} }
 *     salida:  { encolado: Boolean, mensajes:[{canal, estado}] }
 *
 * Nota de diseño (RN-86): el encolado va en la MISMA transacción del ticket.
 * Por eso el `evento_id` es obligatorio: es la clave de idempotencia que evita
 * encolar dos veces el mismo ticket si el cajero reintenta.
 *
 * Nota de frontera (A-02): el POS consume el contrato, NUNCA escribe en
 * `notification_outbox` ni conoce el worker. Este servicio no conoce tablas.
 *
 * @see PLAN_DE_ABORDAJE_FASE_8_POR_PARTES.md §3.3 (Sub-fase 8.2)
 * @see FICHA_F8_0_CONTRATOS_Y_REGLAS_CRM.md (el contrato que consume)
 */

import * as cliente from '../api/client.js';
import { aOutcome, fallo } from '../utils/outcome.js';
import { withRetries } from '../utils/withRetries.js';

/** Canales soportados por el contrato 27. */
export const CANALES_SOPORTADOS = Object.freeze(['WHATSAPP', 'EMAIL']);

/**
 * Traduce un error del cliente a un `reason` legible para el cajero.
 *
 * El 503 es el caso clave: la cola no está disponible, pero el ticket ya se
 * cobró. Se traduce a `cola_no_disponible` para que el panel lo muestre sin
 * alarmar (no es un error del cajero, es un módulo ausente).
 *
 * @param {Error} err
 * @returns {string}
 */
function motivo(err) {
  if (err && err.name === 'ApiError') {
    if (err.codigo === 0) return 'sin_conexion';
    if (err.codigo === 422) return 'destinatario_incompleto';
    if (err.codigo === 503) return 'cola_no_disponible';
    return err.message || `error_${err.codigo}`;
  }
  return (err && err.message) || 'error_desconocido';
}

/**
 * POST /notifications/enqueue-ticket — encola el envío del ticket (contrato 27).
 *
 * Es una escritura idempotente por `evento_id`, así que se reintenta con
 * backoff centralizado (3 intentos, 1s/2s/3s) porque un parpadeo de red no
 * debe dejar al cliente sin su ticket.
 *
 * Degradación (DT-07): si la cola está caída (503) o la red falla, devuelve
 * `{ outcome:'error', reason:'cola_no_disponible' | 'sin_conexion' }`. El POS
 * NO revierte el cobro; el ticket impreso sigue disponible (RN-87).
 *
 * @param {{evento_id: string, ticket_uuid: string, canales: string[],
 *          destinatario: {telefono?: string, email?: string}, payload: object}} solicitud
 * @returns {Promise<{outcome: string, reason: string|null, data: object|null}>}
 */
export function encolarTicket(solicitud) {
  const eventoId =
    solicitud && typeof solicitud.evento_id === 'string' ? solicitud.evento_id.trim() : '';

  // Guarda local: sin evento_id no hay clave de idempotencia. Encolar sin ella
  // podría duplicar el envío si el cajero reintenta. No se llama al cliente.
  if (!eventoId) {
    return Promise.resolve(fallo('evento_id_requerido', null));
  }

  const canales = Array.isArray(solicitud.canales) ? solicitud.canales : [];
  const cuerpo = {
    evento_id: eventoId,
    ticket_uuid: solicitud.ticket_uuid,
    canales,
    destinatario: solicitud.destinatario || {},
    payload: solicitud.payload || {},
  };

  return aOutcome(
    () => withRetries(() => cliente.encolarTicket(cuerpo)),
    motivo
  );
}

export default {
  encolarTicket,
  CANALES_SOPORTADOS,
};
