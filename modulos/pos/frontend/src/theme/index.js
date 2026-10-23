/**
 * Contrato de temas del módulo POS — apps/pos/src/theme/index.js
 *
 * Fuente de verdad del módulo POS para el motor de temas (@nuevo-pos/theme-engine).
 * Gobernado por ARQUITECTURA_SAAS_PERSONALIZACION_Y_TEMAS.md.
 *
 * ARQUITECTURA DE SLOTS:
 * - Slot 1 (default / Clásico): TEMA ESTÁNDAR INALTERABLE que captura la esencia del
 *   oficio (madera natural, tonos harina y acento dorado para panadería/pastelería).
 *   Es la firma de autor ineditable del sistema.
 * - Slot 2 (Opción 2): Variante estética alternativa provista por el autor del software,
 *   personalizable por el negocio o reemplazable con el Extractor de IA.
 * - Slot 3 (Opción 3): Lienzo abierto personalizable para el negocio mediante la
 *   herramienta de extracción de estética de IA (desde imágenes de Pinterest/Dribbble).
 */

export const TEMA_DEL_MODULO = {
  /** Nombre del módulo. Debe coincidir con la carpeta. */
  modulo: 'pos',

  /** El tema con el que nace el módulo. Debe estar en 'permitidos'. */
  default: 'default',

  /**
   * ¿El módulo ofrece cambiar de tema?
   * Si es false, no hay selector y permitidos tiene exactamente 1.
   * Si es true, se muestra el ThemeSelector (Fase 4).
   */
  ofreceSelector: true,

  /**
   * Los temas que el usuario puede elegir.
   * Máximo 3: el default + hasta 2 opcionales.
   */
  permitidos: ['default', 'nocturno', 'minimal'],

  /**
   * Mapa de nombre → loader del tema.
   * Se usa import() dinámico para que los temas opcionales
   * no aumenten el bundle inicial (lazy loading).
   * El default se importa estáticamente (siempre está en el bundle).
   */
  temas: {
    default:  () => import('./default.js'),
    nocturno: () => import('./nocturno.js'),
    minimal:  () => import('./minimal.js'),
  },
};
