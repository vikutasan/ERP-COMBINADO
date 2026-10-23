/**
 * withRetries — reintentos con backoff centralizado.
 *
 * Cicatriz v7.0.1 (asimetría): en el POS viejo los reintentos estaban
 * dispersos y asimétricos — unas rutas reintentaban, otras no, con
 * backoffs distintos. El resultado fue que una operación podía "tener
 * éxito" en el cliente y no en el servidor (o al revés).
 *
 * Esta utilidad centraliza la política: 3 intentos, backoff 1s/2s/3s.
 * Es pura respecto a React y al DOM: no depende de nada del navegador.
 *
 * Regla de batalla: "centralized withRetries (3 attempts, backoff 1s/2s/3s)".
 *
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §5 (reglas arquitectónicas)
 * @see PLAN_DE_ABORDAJE_FASE_3_POR_PARTES.md §4 FASE 3.1
 */

/** Backoff por defecto: 1s, 2s, 3s (3 intentos = 2 esperas). */
export const BACKOFF_POR_DEFECTO = [1000, 2000, 3000];

/** Número de intentos por defecto. */
export const INTENTOS_POR_DEFECTO = 3;

/**
 * Espera `ms` milisegundos. Inyectable para que los tests no esperen
 * 6 segundos reales (evita tests frágiles y lentos).
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function dormirReal(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ejecuta `fn` con reintentos y backoff centralizado.
 *
 * Idempotencia: si `fn` es idempotente, llamar `withRetries` dos veces
 * deja el mismo estado final. La utilidad NO muta nada por sí misma.
 *
 * @template T
 * @param {() => Promise<T>} fn - operación a ejecutar
 * @param {object} [opciones]
 * @param {number} [opciones.intentos=3] - número total de intentos
 * @param {number[]} [opciones.backoffMs=[1000,2000,3000]] - espera entre intentos
 * @param {(err: Error, intento: number) => boolean} [opciones.debeReintentar]
 *        - decide si un error merece otro intento (por defecto: siempre sí)
 * @param {(ms: number) => Promise<void>} [opciones.dormir=dormirReal]
 *        - inyectable para tests
 * @param {(err: Error, intento: number) => void} [opciones.alReintentar]
 *        - hook de observación (logging/telemetría), opcional
 * @returns {Promise<T>} el resultado del primer intento exitoso
 * @throws {Error} el último error si se agotan los intentos
 */
export async function withRetries(fn, opciones = {}) {
  const {
    intentos = INTENTOS_POR_DEFECTO,
    backoffMs = BACKOFF_POR_DEFECTO,
    debeReintentar = () => true,
    dormir = dormirReal,
    alReintentar = null,
  } = opciones;

  if (typeof fn !== 'function') {
    throw new TypeError('withRetries: `fn` debe ser una función');
  }
  if (!Number.isInteger(intentos) || intentos < 1) {
    throw new RangeError('withRetries: `intentos` debe ser un entero >= 1');
  }

  let ultimoError = null;

  for (let intento = 1; intento <= intentos; intento += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn(intento);
    } catch (err) {
      ultimoError = err;

      const esUltimo = intento === intentos;
      if (esUltimo || !debeReintentar(err, intento)) {
        throw err;
      }

      if (typeof alReintentar === 'function') {
        alReintentar(err, intento);
      }

      // Backoff: índice intento-1 (tras el 1er fallo espera backoffMs[0]).
      const espera = backoffMs[Math.min(intento - 1, backoffMs.length - 1)] ?? 0;
      // eslint-disable-next-line no-await-in-loop
      await dormir(espera);
    }
  }

  // Inalcanzable en la práctica, pero deja el contrato explícito.
  throw ultimoError;
}

export default withRetries;
