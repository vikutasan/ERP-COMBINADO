/**
 * Catálogo de colores de post-it — FASE 13.3 (selector de color en el gestor).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ ES
 * ─────────────────────────────────────────────────────────────────────────────
 * La ÚNICA fuente de verdad de la paleta de colores de los post-its del
 * pizarrón de cuentas abiertas. La consumen:
 *
 *   - `OpenAccountsCorkboard.jsx` — para pintar cada post-it.
 *   - `TerminalSelector.jsx`     — para el selector de color del gestor.
 *   - `RetailVisionPOS.jsx`      — para construir `coloresPorTerminal`.
 *
 * El backend (`apps/api/routers/terminals.py`, `PALETA_POST_ITS`) mantiene una
 * copia espejo de esta lista: es la que valida el catálogo en `POST /config`.
 * Si se agrega o quita un color aquí, hay que reflejarlo allá (y viceversa).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ORIGEN
 * ─────────────────────────────────────────────────────────────────────────────
 * Gama extraída de la imagen de diseño `COLORES-POST-ITS.png` (21 tonos:
 * azules/morados, rosas/rojos, amarillos/verdes). Se eligen pesos (200-400)
 * que garanticen contraste con el texto oscuro (#3d2b1f).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REGLAS
 * ─────────────────────────────────────────────────────────────────────────────
 *   DT-09 — tokens semánticos de Tailwind, no colores hardcodeados.
 *   Decisión del usuario (9 Oct 2026): NO hay semilla; el usuario asigna los
 *   colores a mano desde el gestor. NO se permiten colores repetidos.
 */

/** Catálogo de colores disponibles para los post-its (21 tonos). */
export const PALETA_POST_ITS = [
  'bg-blue-400',
  'bg-blue-300',
  'bg-cyan-300',
  'bg-sky-200',
  'bg-violet-400',
  'bg-purple-300',
  'bg-fuchsia-200',
  'bg-pink-300',
  'bg-rose-400',
  'bg-pink-400',
  'bg-pink-200',
  'bg-red-400',
  'bg-red-300',
  'bg-orange-400',
  'bg-orange-300',
  'bg-yellow-200',
  'bg-amber-300',
  'bg-yellow-300',
  'bg-green-400',
  'bg-lime-300',
  'bg-emerald-300',
];

/**
 * Color de respaldo cuando una terminal NO tiene color asignado.
 *
 * Es el aviso visual de "esta terminal aún no tiene color". El usuario lo
 * asigna desde el gestor de terminales.
 */
export const COLOR_SIN_ASIGNAR = 'bg-yellow-100';

/**
 * Etiqueta legible de un color de la paleta (para `title`/`aria-label`).
 *
 * Deriva el nombre del token de Tailwind: `bg-blue-400` → `blue 400`.
 */
export function etiquetaDeColor(token) {
  if (!token) return 'Sin color';
  return token.replace(/^bg-/, '').replace(/-/g, ' ');
}
