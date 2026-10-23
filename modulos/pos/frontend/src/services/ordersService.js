/**
 * Servicio de pedidos — FASE 7.5.4 (contrato 16).
 *
 * Responsabilidad: exponer la lectura del pedido asociado a un ticket envuelta
 * en el contrato `{ outcome, reason, data }`. NUNCA lanza: un fallo de red o un
 * 4xx/5xx del API se traduce a `{ outcome:'error', reason }`.
 *
 * Por qué existe esta capa y no se llama al cliente directo:
 *   - Mismo patrón que `openAccountsService` (F5.1): la operación devuelve un
 *     valor inspeccionable, y el hook decide con `esOk(resultado)` sin try/catch.
 *   - El 404 NO es un error de red: significa "este ticket no tiene pedido"
 *     (venta directa). Se traduce a un `reason` propio (`sin_pedido`) para que
 *     el hook lo distinga de un fallo real.
 *
 * Endpoint consumido (del API PROPIO del POS nuevo):
 *   GET /orders/by-ticket/{ticket_id}  → contrato 16
 *
 * Nota de diseño (O-23): la respuesta es una PROYECCIÓN del pedido (10 campos),
 * no la fila completa de `orders`. Este servicio NO transforma la forma.
 *
 * @see PLAN_DE_ABORDAJE_F7_5_INTEGRACION.md §F7.5.4
 * @see FICHA_F7_5_3_PEDIDOS_API.md (el backend que consume)
 */

import * as cliente from '../api/client.js';
import { aOutcome, fallo } from '../utils/outcome.js';
import { withRetries } from '../utils/withRetries.js';

/**
 * Traduce un error del cliente a un `reason` legible para el cajero.
 * @param {Error} err
 * @returns {string}
 */
function motivo(err) {
  if (err && err.name === 'ApiError') {
    if (err.codigo === 0) return 'sin_conexion';
    // 404 = el ticket no tiene pedido (venta directa). No es un fallo de red.
    if (err.codigo === 404) return 'sin_pedido';
    if (err.codigo === 422) return 'datos_invalidos';
    return err.message || `error_${err.codigo}`;
  }
  return (err && err.message) || 'error_desconocido';
}

/**
 * PATCH /pos/tickets/{id}/order — persiste la programación de un ticket ya
 * creado (contrato 31, F12.20).
 *
 * Cierra el hueco del flujo REAL del POS "productos primero, pedido después":
 * el ticket nace VENTA_DIRECTA (contrato 29) y LUEGO se programa como PEDIDO.
 * Sin este contrato, `guardarPedido` no podía persistir el bloque y el post-it
 * del pizarrón no se distinguía de una cuenta normal.
 *
 * NO se reintenta: es una ESCRITURA con concurrencia optimista (RN-25). Un
 * reintento ciego tras un 409 reenviaría un `version` ya obsoleto. El hook
 * decide si refresca el `version` y reintenta.
 *
 * @param {string} ticketId
 * @param {{version: number} & Record<string, unknown>} cuerpo
 * @returns {Promise<{outcome: string, reason: string|null, data: object|null}>}
 */
export function actualizarPedidoDelTicket(ticketId, cuerpo) {
  const id = typeof ticketId === 'string' ? ticketId.trim() : '';
  if (!id) {
    return Promise.resolve(fallo('ticket_invalido', null));
  }
  if (!cuerpo || typeof cuerpo !== 'object') {
    return Promise.resolve(fallo('datos_invalidos', null));
  }
  return aOutcome(() => cliente.actualizarPedidoTicket(id, cuerpo), motivo);
}

/**
 * GET /orders/by-ticket/{ticket_id} — el pedido de un ticket (contrato 16).
 *
 * Es una lectura idempotente: se reintenta con backoff centralizado
 * (3 intentos, 1s/2s/3s) porque un pedido que no aparece por un parpadeo de
 * red es peor que una espera corta.
 *
 * @param {string} ticketId
 * @returns {Promise<{outcome: string, reason: string|null, data: object|null}>}
 */
export function obtenerPedidoDelTicket(ticketId) {
  const id = typeof ticketId === 'string' ? ticketId.trim() : '';
  if (!id) {
    // Guarda local: no se llama al cliente con un id vacío (evita un 422 inútil).
    return Promise.resolve(fallo('ticket_invalido', null));
  }
  return aOutcome(
    () => withRetries(() => cliente.getPedidoDelTicket(id)),
    motivo
  );
}

export default {
  obtenerPedidoDelTicket,
  actualizarPedidoDelTicket,
};
