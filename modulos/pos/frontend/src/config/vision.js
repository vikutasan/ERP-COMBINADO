/**
 * vision.js — FASE 7.3 (Visión cenital).
 *
 * Configuración del subsistema de visión del POS. El valor clave es el
 * UMBRAL DE CONFIANZA, que NO es universal: es la calibración del montaje
 * cenital con iluminación dedicada (DT-08). Por eso vive aquí, en
 * configuración, y no hardcodeado en el hook.
 *
 * DT-08 (Directrices Transversales del ERP, §6.7): la cámara es cenital, con
 * iluminación especial para evitar sombras sobre el mostrador. Ese montaje
 * fijo y controlado es lo que permite un umbral bajo (0.35) sin falsos
 * positivos. Si el montaje cambia, el umbral se recalibra aquí (o desde el
 * Centro de IA), sin tocar el código del hook.
 *
 * @see DIRECTRICES_TRANSVERSALES_DEL_ERP.md §6.7 (DT-08)
 * @see PLAN_DE_ABORDAJE_FASE_7_POR_PARTES.md §8
 */

/**
 * Umbral por defecto de confianza para aceptar una detección (RN-72).
 * Calibrado para el montaje cenital con iluminación controlada (DT-08).
 * @type {number}
 */
export const UMBRAL_CONFIANZA_POR_DEFECTO = 0.35;

/**
 * Modo de captura declarado al contrato 17 (DT-08).
 * `cenital` = cámara fija sobre el mostrador; `manual` = captura puntual.
 * @type {string}
 */
export const MODO_CAPTURA_CENITAL = 'cenital';

/**
 * Número máximo de candidatos que se piden al contrato 17 (`top_k`).
 * @type {number}
 */
export const TOP_K_POR_DEFECTO = 3;

/**
 * Intervalo (ms) entre capturas del visor persistente ("escáner de charola").
 * El visor permanece abierto y muestrea el mostrador sin que el operador
 * apunte (DT-08).
 * @type {number}
 */
export const INTERVALO_CAPTURA_MS = 1500;

/**
 * Configuración completa de visión, congelada para evitar mutaciones.
 * @type {Readonly<{umbralConfianza: number, modoCaptura: string, topK: number, intervaloCapturaMs: number}>}
 */
export const VISION_CONFIG = Object.freeze({
  umbralConfianza: UMBRAL_CONFIANZA_POR_DEFECTO,
  modoCaptura: MODO_CAPTURA_CENITAL,
  topK: TOP_K_POR_DEFECTO,
  intervaloCapturaMs: INTERVALO_CAPTURA_MS,
});

export default VISION_CONFIG;
