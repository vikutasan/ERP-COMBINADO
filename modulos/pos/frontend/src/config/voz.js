/**
 * voz — FASE 7.2 (Voz). Configuración central de la captura de voz del POS.
 *
 * Portado del Centro de IA viejo (`apps/ai/utils/aiCenterConstants.js`). En el
 * POS nuevo NO se importa de `apps/ai/` (esa carpeta no existe aquí): las
 * constantes de negocio viven en MAYÚSCULAS en este archivo de configuración
 * central, para que sean auditables y compartibles con el futuro Centro de IA.
 *
 * Este archivo NO importa nada: es la fuente de verdad.
 *
 * @see PLAN_DE_ABORDAJE_FASE_7_POR_PARTES.md §7.2
 */

/**
 * Parámetros de la captura continua con auto-stop por silencio.
 *
 * FLUJO MANOS LIBRES: el operador presiona el botón UNA vez, dicta varios
 * productos y la grabación se detiene SOLA cuando deja de hablar.
 */
export const VOZ_CONFIG = Object.freeze({
  // RMS mínimo (0..1) para considerar que hay voz. Por debajo = silencio.
  UMBRAL_RMS: 0.02,
  // ms de silencio continuo tras haber hablado → detener y transcribir.
  SILENCIO_MS: 1500,
  // ms máximos esperando a que el operador empiece a hablar antes de abortar.
  ESPERA_VOZ_MS: 6000,
  // ms máximos de grabación total (red de seguridad anti-olvido).
  MAX_GRABACION_MS: 30000,
  // ms mínimos de voz acumulada para considerar el dictado válido.
  MIN_VOZ_MS: 300,
  // Cada cuánto se muestrea el nivel de audio (ms).
  INTERVALO_MUESTREO_MS: 100,
});

/**
 * Etiquetas legibles de cada parámetro de voz, para la pestaña Voz del Centro
 * de IA. El orden del array define el orden de presentación en la UI.
 */
export const ETIQUETA_PARAMETRO_VOZ = Object.freeze([
  { clave: 'UMBRAL_RMS', etiqueta: 'Umbral de voz (RMS)', unidad: '' },
  { clave: 'SILENCIO_MS', etiqueta: 'Silencio para auto-detener', unidad: 'ms' },
  { clave: 'ESPERA_VOZ_MS', etiqueta: 'Espera antes de abortar', unidad: 'ms' },
  { clave: 'MAX_GRABACION_MS', etiqueta: 'Duración máxima de grabación', unidad: 'ms' },
  { clave: 'MIN_VOZ_MS', etiqueta: 'Voz mínima para validar', unidad: 'ms' },
  { clave: 'INTERVALO_MUESTREO_MS', etiqueta: 'Frecuencia de muestreo', unidad: 'ms' },
]);

/**
 * Intenciones que cada módulo acepta por voz (allowlist visible).
 *
 * DECISIÓN DE DISEÑO (acordada con el negocio): en el POS el dictado por voz
 * sirve ÚNICAMENTE para capturar/agregar productos a la cuenta. Las acciones
 * destructivas o fiscales (cobrar, cancelar) pasan siempre por un toque
 * explícito del operador.
 */
export const INTENCIONES_POR_MODULO = Object.freeze({
  POS: Object.freeze(['agregar_item']),
  ALMACEN: Object.freeze(['entrada_insumo']),
});

export default { VOZ_CONFIG, ETIQUETA_PARAMETRO_VOZ, INTENCIONES_POR_MODULO };
