/**
 * Servicio de terminales — Capa de contrato con el backend.
 *
 * Responsabilidad: comunicarse con la API de terminales.
 * NO contiene lógica de negocio (eso va en el hook).
 * NO contiene estado de React (eso va en el componente).
 *
 * Endpoints consumidos:
 *   GET  /pos/terminals/status   → estado de todas las terminales
 *   POST /pos/terminals/lock     → tomar lock de una terminal
 *   POST /pos/terminals/unlock   → liberar lock
 *   GET  /pos/terminals/config   → configuración (lista, iconos)
 *   POST /pos/terminals/config   → guardar configuración
 *
 * @see FICHA 12 de ESPECIFICACION_DE_INTERFACES_POS.md
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §7 Fase 1
 */

// FP-01: URL dinámica desde CONFIG (shared/config.js → VITE_API_URL → .env).
import { CONFIG } from '../../../shared/config.js';
const API_BASE_URL = CONFIG.API_BASE_URL;

/**
 * Normaliza un id de usuario a string para la frontera HTTP.
 *
 * El contrato de la API declara `user_id`/`usuario_id` como `str` (Pydantic v2
 * rechaza un número con 422). Pero el usuario que entrega el ERP puede traer el
 * id como número (p. ej. `1`). Esta coerción vive AQUÍ, en la frontera del
 * servicio, para que ni el hook ni el componente tengan que conocer el tipo
 * exacto que exige el contrato.
 *
 * @param {string|number} userId
 * @returns {string}
 */
function aIdTexto(userId) {
  return userId === null || userId === undefined ? '' : String(userId);
}

/**
 * Obtiene el estado de ocupación de todas las terminales.
 * @returns {Promise<Object>} Mapa { T1: { occupier_id, occupier_name, locked_at, stale_session }, ... }
 */
export async function fetchTerminalStatuses() {
  const res = await fetch(`${API_BASE_URL}/pos/terminals/status`);
  if (!res.ok) throw new Error(`Terminal status: ${res.status}`);
  return res.json();
}

/**
 * Toma el lock de una terminal para el usuario actual.
 * @param {string} terminalId - ID de la terminal (ej: "T1")
 * @param {number} userId - ID del usuario
 * @returns {Promise<Object>} { success: bool, message: string }
 */
export async function lockTerminal(terminalId, userId) {
  const res = await fetch(`${API_BASE_URL}/pos/terminals/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terminal_id: terminalId, user_id: aIdTexto(userId) }),
  });
  if (!res.ok) throw new Error(`Lock terminal: ${res.status}`);
  return res.json();
}

/**
 * Abre (o reutiliza) la sesión de terminal — paridad con el viejo POS.
 *
 * El viejo POS crea la `TerminalSession` al seleccionar la terminal. Sin ella,
 * cualquier ticket falla con RN-24 ("La sesión de la terminal no está activa").
 * El endpoint es IDEMPOTENTE: si la terminal ya tiene sesión activa, la
 * devuelve; si no, la crea. Es seguro llamarlo en cada selección.
 *
 * @param {string} terminalId - ID de la terminal (ej: "TERM-04")
 * @returns {Promise<Object>} { id, terminal_id, is_active }
 */
export async function abrirSesionTerminal(terminalId) {
  const res = await fetch(`${API_BASE_URL}/pos/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terminal_id: terminalId }),
  });
  if (!res.ok) throw new Error(`Abrir sesión: ${res.status}`);
  return res.json();
}

/**
 * Libera el lock de una terminal.
 * @param {string} terminalId - ID de la terminal
 * @param {number} userId - ID del usuario
 * @returns {Promise<Object>} { success: bool }
 */
export async function unlockTerminal(terminalId, userId) {
  const res = await fetch(`${API_BASE_URL}/pos/terminals/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terminal_id: terminalId, user_id: aIdTexto(userId) }),
  });
  if (!res.ok) throw new Error(`Unlock terminal: ${res.status}`);
  return res.json();
}

/**
 * Obtiene la configuración de terminales (lista + iconos + orden de despliegue).
 *
 * FIX "el orden no se persiste" (10 Oct 2026): el backend devuelve
 * `{ terminals, orden }`. El orden (`izq-der` / `der-izq`) vive en el backend
 * para que sobreviva entre navegadores y máquinas; antes solo estaba en el
 * `localStorage` del navegador y se perdía.
 *
 * Tolerante a un backend viejo que devolvía solo la lista: en ese caso se
 * normaliza a `{ terminals: [...], orden: 'izq-der' }`.
 *
 * @returns {Promise<{terminals: Array, orden: string}>}
 */
export async function fetchTerminalConfig() {
  const res = await fetch(`${API_BASE_URL}/pos/terminals/config`);
  if (!res.ok) throw new Error(`Terminal config: ${res.status}`);
  const data = await res.json();
  // Retrocompatibilidad: si el backend devuelve una lista suelta, normalizar.
  if (Array.isArray(data)) {
    return { terminals: data, orden: 'izq-der' };
  }
  return {
    terminals: Array.isArray(data?.terminals) ? data.terminals : [],
    orden: data?.orden === 'der-izq' ? 'der-izq' : 'izq-der',
  };
}

/**
 * Construye el mapa `{ [terminal_id]: token }` que el pizarrón usa para pintar
 * cada post-it (FASE 13.3).
 *
 * FIX "los post-its salen amarillos" (10 Oct 2026): `fetchTerminalConfig`
 * devuelve `{ terminals, orden }`, NO una lista suelta. El consumidor iteraba
 * el objeto con `for...of`, lo que lanzaba `TypeError` y el `catch` lo
 * silenciaba: el mapa quedaba vacío y TODOS los post-its caían al amarillo por
 * defecto. Esta función centraliza la lectura y es tolerante a un backend viejo
 * que devolviera una lista suelta.
 *
 * Las terminales SIN color se OMITEN del mapa: el pizarrón cae al amarillo por
 * defecto (`COLOR_SIN_ASIGNAR`).
 *
 * @param {{terminals?: Array}|Array} config — salida de `fetchTerminalConfig`.
 * @returns {Record<string, string>} mapa id → token de color.
 */
export function construirColoresPorTerminal(config) {
  const lista = Array.isArray(config) ? config : (config?.terminals ?? []);
  const mapa = {};
  for (const t of lista) {
    if (t && t.id && t.color) mapa[t.id] = t.color;
  }
  return mapa;
}

/**
 * Guarda la configuración de terminales (lista + iconos + orden de despliegue).
 * @param {Array} terminals - [{ id, name, icon, color }, ...]
 * @param {string} [orden] - 'izq-der' | 'der-izq' (opcional; si falta, el
 *   backend conserva el orden ya guardado).
 * @returns {Promise<Object>} { success: bool }
 */
export async function saveTerminalConfig(terminals, orden) {
  const body = { terminals };
  if (orden) body.orden = orden;
  const res = await fetch(`${API_BASE_URL}/pos/terminals/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Save terminal config: ${res.status}`);
  return res.json();
}
