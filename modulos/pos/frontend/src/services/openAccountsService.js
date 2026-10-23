/**
 * Servicio de cuentas abiertas — FASE 5.1 (contrato 23).
 *
 * Responsabilidad: exponer la operación de listado del pizarrón de cuentas
 * abiertas envuelta en el contrato `{ outcome, reason, data }`. NUNCA lanza:
 * un fallo de red o un 4xx/5xx del API se traduce a `{ outcome:'error', reason }`.
 *
 * Por qué existe esta capa y no se llama al cliente directo:
 *   - Cicatriz v7.0.3 (cuentas perdidas): una promesa rechazada sin capturar
 *     dejaba el pizarrón en un estado ambiguo (¿no hay cuentas, o falló la red?).
 *     Aquí la operación devuelve un valor inspeccionable.
 *   - El hook (F5.2 useOpenAccounts) decide con `esOk(resultado)` y muestra
 *     `resultado.reason` en el banner rojo, sin try/catch.
 *
 * Endpoint consumido (del API PROPIO del POS nuevo):
 *   GET /pos/open-accounts?terminal_id=  → contrato 23 (RN-31)
 *
 * Nota de diseño (Regla 15): la respuesta es una PROYECCIÓN ligera — cada
 * cuenta expone EXACTAMENTE 5 campos (`id`, `account_num`, `status`, `total`,
 * `version`). Este servicio NO transforma la forma; solo la envuelve.
 *
 * @see PLAN_DE_ABORDAJE_FASE_5_POR_PARTES.md §5 (Sub-fase 5.1)
 * @see FICHA_F5_0_CUENTAS_ABIERTAS.md (el backend que consume)
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
    if (err.codigo === 400) return 'terminal_invalida';
    if (err.codigo === 422) return 'datos_invalidos';
    return err.message || `error_${err.codigo}`;
  }
  return (err && err.message) || 'error_desconocido';
}

/**
 * GET /pos/open-accounts — las cuentas OPEN de una terminal (contrato 23).
 *
 * Es una lectura idempotente: se reintenta con backoff centralizado
 * (3 intentos, 1s/2s/3s) porque un pizarrón desactualizado por un parpadeo
 * de red es peor que una espera corta.
 *
 * @param {string} terminalId
 * @returns {Promise<{outcome: string, reason: string|null, data: object|null}>}
 */
export function listarCuentasAbiertas(terminalId) {
  const id = typeof terminalId === 'string' ? terminalId.trim() : '';
  if (!id) {
    // Guarda local: no se llama al cliente con un id vacío (evita un 422 inútil).
    return Promise.resolve(fallo('terminal_invalida', null));
  }
  return aOutcome(
    () => withRetries(() => cliente.listarCuentasAbiertas(id)),
    motivo
  );
}

/**
 * GET /pos/open-accounts — TODAS las cuentas OPEN sin filtro de terminal.
 *
 * Se usa cuando la terminal está habilitada como CAJA (punto de cobro central).
 * El cajero necesita ver las cuentas de TODAS las terminales para poder cobrar
 * las que le traigan de T2, T3, T4, etc.
 *
 * El viejo POS (`posService.getOpenTickets()`) siempre listaba todas; el nuevo
 * filtraba por terminal (RN-31). Esta función restaura la vista global para CAJA.
 */
export function listarTodasLasCuentasAbiertas() {
  return aOutcome(
    () => withRetries(() => cliente.listarCuentasAbiertas('')),
    motivo
  );
}

export default {
  listarCuentasAbiertas,
  listarTodasLasCuentasAbiertas,
};
