/**
 * Servicio de auditoría — FASE 13.2a (contrato 5).
 *
 * Responsabilidad: exponer la operación de consulta de eventos auditables del
 * POS envuelta en el contrato `{ outcome, reason, data }`. NUNCA lanza: un fallo
 * de red o un 4xx/5xx del API se traduce a `{ outcome:'error', reason }`.
 *
 * Por qué existe esta capa y no se llama al cliente directo:
 *   - El POS PRODUCE la evidencia (escribe `pos_audit_log`, F13.0); el módulo de
 *     Auditoría y Control la CONSUME por contrato (P-02). Esta capa es la
 *     frontera de servicio reutilizable: el panel de auditoría vive en el módulo
 *     de Auditoría, no en el POS (ver PLAN_DE_REORGANIZACION_DE_MODULOS_DE_
 *     OBSERVABILIDAD.md §4.2).
 *   - Igual que en F5.1, una promesa rechazada sin capturar dejaría la pantalla
 *     en un estado ambiguo (¿no hay eventos, o falló la red?). Aquí la operación
 *     devuelve un valor inspeccionable.
 *   - El consumidor decide con `esOk(resultado)` y muestra `resultado.reason`
 *     en el banner rojo, sin try/catch.
 *
 * Endpoint consumido (del API PROPIO del POS nuevo):
 *   GET /pos/auditable-events?desde=&hasta=  → contrato 5 (RN-77, RN-78)
 *
 * Nota de diseño (O-23): la respuesta es una PROYECCIÓN ligera — cada evento
 * expone EXACTAMENTE 5 campos (`tipo`, `ticket_id`, `usuario_id`, `timestamp`,
 * `detalle`). Este servicio NO transforma la forma; solo la envuelve.
 *
 * @see PLAN_DE_ABORDAJE_FASE_13_POR_PARTES.md (Sub-fase 13.2a)
 * @see FICHA_F13_1_CONTRATO_5.md (el backend que consume)
 * @see PLAN_DE_REORGANIZACION_DE_MODULOS_DE_OBSERVABILIDAD.md §4.2 (por qué el
 *      panel NO vive en el POS)
 */

import * as cliente from '../api/client.js';
import { aOutcome, fallo } from '../utils/outcome.js';
import { withRetries } from '../utils/withRetries.js';

/**
 * Traduce un error del cliente a un `reason` legible para el auditor.
 * @param {Error} err
 * @returns {string}
 */
function motivo(err) {
  if (err && err.name === 'ApiError') {
    if (err.codigo === 0) return 'sin_conexion';
    if (err.codigo === 400) return 'rango_invalido';
    if (err.codigo === 422) return 'datos_invalidos';
    return err.message || `error_${err.codigo}`;
  }
  return (err && err.message) || 'error_desconocido';
}

/**
 * Normaliza un extremo del rango a string ISO-8601 para la frontera HTTP.
 *
 * El contrato 5 declara `desde`/`hasta` como `datetime` (Pydantic v2 rechaza un
 * valor vacío con 422). Acepta un `Date` o un string y devuelve un string
 * recortado; cualquier otra cosa se considera vacía.
 *
 * @param {string|Date} valor
 * @returns {string}
 */
function aInstanteTexto(valor) {
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? '' : valor.toISOString();
  }
  return typeof valor === 'string' ? valor.trim() : '';
}

/**
 * GET /pos/auditable-events — los eventos auditables en un rango (contrato 5).
 *
 * Es una lectura idempotente: se reintenta con backoff centralizado
 * (3 intentos, 1s/2s/3s) porque una consulta de auditoría desactualizada por un
 * parpadeo de red es peor que una espera corta.
 *
 * @param {string|Date} desde  Inicio del rango (ISO-8601, UTC).
 * @param {string|Date} hasta  Fin del rango (ISO-8601, UTC).
 * @returns {Promise<{outcome: string, reason: string|null, data: object|null}>}
 */
export function listarEventosAuditables(desde, hasta) {
  const d = aInstanteTexto(desde);
  const h = aInstanteTexto(hasta);
  if (!d || !h) {
    // Guarda local: no se llama al cliente con un rango incompleto (evita un 422 inútil).
    return Promise.resolve(fallo('rango_invalido', null));
  }
  return aOutcome(
    () => withRetries(() => cliente.listarEventosAuditables(d, h)),
    motivo
  );
}

export default {
  listarEventosAuditables,
};
