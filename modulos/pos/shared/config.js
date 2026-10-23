/**
 * Configuración compartida del POS del ERP COMBINADO — FASE 1.6.
 *
 * `CONFIG.API_BASE_URL` es PROPIO del POS. NO se reutiliza el del ERP de
 * producción: el POS tiene su API y su base de datos separadas (RT-09,
 * REGLA 1). Ningún módulo del ERP COMBINADO importa código de otro.
 *
 * El valor se resuelve en este orden:
 *   1. `import.meta.env.VITE_API_URL` (inyectado por Vite en build/dev).
 *   2. El valor por defecto de desarrollo: `http://localhost:5211`.
 *
 * El puerto 5211 es el asignado al API del POS dentro del rango reservado del
 * ERP COMBINADO (5200-5241, frontends pares / APIs impares). No colisiona con
 * producción (5000/5001/5433) ni con NUEVO-ERP (5100/5101/5102/5432).
 * El frontend del POS vive en 5210.
 */

const DEFAULT_API_BASE_URL = 'http://localhost:5211';

function resolveApiBaseUrl() {
  // `import.meta.env` solo existe bajo Vite. Se accede con guarda para que el
  // módulo también pueda importarse desde Node (tests) sin romper.
  const fromEnv =
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_API_URL
      : undefined;
  return fromEnv && String(fromEnv).length > 0 ? String(fromEnv) : DEFAULT_API_BASE_URL;
}

export const CONFIG = Object.freeze({
  /** URL base del API del POS (propia, no la del ERP de producción). */
  API_BASE_URL: resolveApiBaseUrl(),
  /** Puerto del frontend del POS (rango ERP COMBINADO 5200-5241). */
  FRONTEND_PORT: 5210,
  /** Puerto del API del POS (rango ERP COMBINADO 5200-5241). */
  API_PORT: 5211,
  /** Terminal por defecto sembrada por `seed_demo.py`. */
  TERMINAL_ID: 'TERM-01',
  /** Canal por defecto (RN-13). */
  CANAL: 'PANADERIA',
  /** Los 3 modos de layout (R-03), con sus rangos en píxeles. */
  MODOS: Object.freeze({
    MOSTRADOR: { min: 1024, max: Infinity },
    COMPACTO: { min: 768, max: 1023 },
    MOVIL: { min: 0, max: 767 },
  }),
});

export default CONFIG;
