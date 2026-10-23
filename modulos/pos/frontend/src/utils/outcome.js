/**
 * outcome — contrato `{ outcome, reason }`.
 *
 * Cicatriz v7.0.3 (cuentas perdidas): en el POS viejo, una función de
 * persistencia podía fallar lanzando una excepción que nadie capturaba,
 * o "tener éxito" devolviendo algo ambiguo. El resultado fueron cuentas
 * que se perdían silenciosamente.
 *
 * Este módulo define un contrato explícito y total: toda operación de
 * persistencia devuelve `{ outcome, reason, data }` y NUNCA lanza.
 *
 * Regla de batalla: "contrato {outcome, reason} en toda función de
 * persistencia" + "post-send verification".
 *
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §5 (reglas arquitectónicas)
 * @see PLAN_DE_ABORDAJE_FASE_3_POR_PARTES.md §4 FASE 3.1
 */

/** Valores válidos de `outcome`. */
export const OK = 'ok';
export const ERROR = 'error';

/**
 * @typedef {object} Outcome
 * @property {'ok'|'error'} outcome
 * @property {string|null} reason - motivo legible; `null` si outcome === 'ok'
 * @property {*} [data] - carga útil opcional
 */

/**
 * Construye un éxito.
 * @param {*} [data=null]
 * @returns {Outcome}
 */
export function ok(data = null) {
  return { outcome: OK, reason: null, data };
}

/**
 * Construye un fallo.
 * @param {string} reason - motivo legible (obligatorio)
 * @param {*} [data=null]
 * @returns {Outcome}
 */
export function fallo(reason, data = null) {
  return { outcome: ERROR, reason: reason ?? 'error_desconocido', data };
}

/**
 * Discrimina sin asumir excepción.
 * @param {Outcome} resultado
 * @returns {boolean}
 */
export function esOk(resultado) {
  return Boolean(resultado) && resultado.outcome === OK;
}

/**
 * Envuelve una promesa en el contrato. NUNCA lanza: convierte un rechazo
 * en `{ outcome:'error', reason }`. Esto es lo que evita las cuentas
 * perdidas — el llamador siempre recibe un valor inspeccionable.
 *
 * @template T
 * @param {Promise<T>|(() => Promise<T>)} promesaOFn
 * @param {(err: Error) => string} [mapearReason] - traduce el error a `reason`
 * @returns {Promise<Outcome>}
 */
export async function aOutcome(promesaOFn, mapearReason = null) {
  try {
    const valor = typeof promesaOFn === 'function' ? await promesaOFn() : await promesaOFn;
    return ok(valor);
  } catch (err) {
    const reason =
      typeof mapearReason === 'function'
        ? mapearReason(err)
        : (err && err.message) || 'error_desconocido';
    return fallo(reason, null);
  }
}

export default { ok, fallo, esOk, aOutcome, OK, ERROR };
