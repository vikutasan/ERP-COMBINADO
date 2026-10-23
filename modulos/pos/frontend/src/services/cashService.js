/**
 * Servicio de caja — FASE 4.2 (contratos 9–14).
 *
 * Responsabilidad: exponer las 6 operaciones de caja del POS nuevo envueltas
 * en el contrato `{ outcome, reason, data }`. NUNCA lanza: un fallo de red o
 * un 4xx/5xx del API se traduce a `{ outcome: 'error', reason }`.
 *
 * Por qué existe esta capa y no se llama al cliente directo:
 *   - Cicatriz v7.0.3 (cuentas perdidas): una promesa rechazada sin capturar
 *     hacía que el turno de caja quedara en un estado ambiguo. Aquí toda
 *     operación devuelve un valor inspeccionable.
 *   - El componente (F4.3 GestorDeCaja) decide con `esOk(resultado)` y muestra
 *     `resultado.reason` en el banner rojo, sin try/catch.
 *
 * Endpoints consumidos (todos del API PROPIO del POS nuevo):
 *   GET  /cash/active-session              → contrato 9  (turno abierto)
 *   POST /cash/open-session                → contrato 10 (RN-49, RN-50)
 *   POST /cash/movements                   → contrato 11 (RN-51, RN-55)
 *   GET  /cash/session-summary/{id}        → contrato 12 (RN-53)
 *   POST /cash/close-session               → contrato 13 (RN-54, RN-55)
 *   GET  /cash/daily-report/{fecha}        → contrato 14 (RN-57/58/59)
 *
 * @see PLAN_DE_ABORDAJE_FASE_4_POR_PARTES.md §6 (Sub-fase 4.2)
 * @see FICHA_F4_1_CAJA_API.md (el backend que consume)
 */

import * as cliente from '../api/client.js';
import { aOutcome } from '../utils/outcome.js';

/**
 * Traduce un error del cliente a un `reason` legible para el cajero.
 * @param {Error} err
 * @returns {string}
 */
function motivo(err) {
  if (err && err.name === 'ApiError') {
    if (err.codigo === 0) return 'sin_conexion';
    if (err.codigo === 404) return 'turno_no_encontrado';
    if (err.codigo === 409) return 'ya_hay_turno_abierto';
    if (err.codigo === 422) return 'datos_invalidos';
    return err.message || `error_${err.codigo}`;
  }
  return (err && err.message) || 'error_desconocido';
}

/**
 * GET /cash/active-session — el turno de caja abierto, o `null`.
 *
 * `terminalId` es OBLIGATORIO en el endpoint (Query(...)): sin él el API
 * responde 422 y el POS no puede saber que la caja ya está habilitada.
 * @param {string} [terminalId] terminal a consultar (por defecto la del POS)
 * @returns {Promise<{outcome: string, reason: string|null, data: object|null}>}
 */
export function obtenerTurnoActivo(terminalId) {
  return aOutcome(() => cliente.getSesionCajaActiva(terminalId), motivo);
}

/**
 * POST /cash/open-session — abre el turno (RN-49: uno por terminal).
 * @param {{terminal_id: string, usuario_id: string, monto_inicial: number|string}} datos
 */
export function abrirTurno(datos) {
  return aOutcome(() => cliente.abrirTurno(datos), motivo);
}

/**
 * POST /cash/movements — registra una entrada o salida de efectivo.
 * @param {{cash_session_id: string, tipo: string, monto: number|string, motivo: string}} datos
 */
export function registrarMovimiento(datos) {
  return aOutcome(() => cliente.registrarMovimiento(datos), motivo);
}

/**
 * DELETE /cash/movements/{id} — elimina un movimiento mal capturado (RN-52).
 *
 * FASE 10.6.2 — paridad de operación. Solo se permite con la caja ABIERTA;
 * si la sesión está cerrada, el API responde 400 y aquí se traduce a
 * `{ outcome: 'error', reason: 'datos_invalidos' }`.
 *
 * @param {string} movementId
 */
export function eliminarMovimiento(movementId) {
  return aOutcome(() => cliente.eliminarMovimiento(movementId), motivo);
}

/**
 * GET /cash/session-summary/{id} — el esperado en caja del turno (RN-53).
 * @param {string} cashSessionId
 */
export function obtenerResumen(cashSessionId) {
  return aOutcome(() => cliente.getResumenTurno(cashSessionId), motivo);
}

/**
 * POST /cash/close-session — cierra el turno con los conteos físicos.
 * @param {{cash_session_id: string, montos_fisicos: number|string, credito: number|string, debito: number|string}} datos
 */
export function cerrarTurno(datos) {
  return aOutcome(() => cliente.cerrarTurno(datos), motivo);
}

/**
 * GET /cash/daily-report/{fecha} — el reporte del día local (RN-59).
 * @param {string} fecha - `YYYY-MM-DD` en la zona horaria del negocio.
 */
export function obtenerReporteDiario(fecha) {
  return aOutcome(() => cliente.getReporteDiario(fecha), motivo);
}

export default {
  obtenerTurnoActivo,
  abrirTurno,
  registrarMovimiento,
  eliminarMovimiento,
  obtenerResumen,
  cerrarTurno,
  obtenerReporteDiario,
};
