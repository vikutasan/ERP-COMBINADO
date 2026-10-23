/**
 * Clasificación pura del estado visual de una terminal.
 *
 * Portado del POS viejo: apps/pos/utils/terminalCardState.js
 * Bug original documentado: el ocupante veía su propia terminal como "libre"
 * porque solo había 2 ramas (ocupada/libre) y no 3 (ocupada/mía/libre).
 *
 * Esta función extrae la clasificación a un lugar puro y testeable.
 * No depende de React ni del DOM.
 *
 * FD-02: los colores de estado ahora referencian variables CSS en vez de hex
 * hardcodeados. Los tokens se declaran en index.css y tailwind.config.js.
 *
 * @param {object|null|undefined} info - Entrada de terminalStatuses[tid]
 * @param {number|string|null|undefined} currentUserId - ID del usuario actual
 * @returns {'free'|'mine'|'occupied'}
 *
 * IMPORTANTE: se compara contra `occupier_ref` (el id ORIGINAL del usuario,
 * tal como lo envió el cliente), NO contra `occupier_id` (el UUID canónico de
 * la tabla). El frontend identifica al usuario con `1` o `cajero-1`, nunca con
 * el UUID derivado; comparar contra el UUID hacía que el dueño no se reconociera
 * a sí mismo y su propia terminal se pintara como "ocupada por otro".
 * Se conserva el fallback a `occupier_id` por compatibilidad.
 */
export function resolveCardState(info, currentUserId) {
  if (!info || !info.occupier_id) return 'free';
  if (currentUserId == null) return 'occupied';
  const referencia = info.occupier_ref ?? info.occupier_id;
  // Comparación tolerante a tipo: `1` (number) y `"1"` (string) son el mismo usuario.
  if (String(referencia) === String(currentUserId)) return 'mine';
  return 'occupied';
}

/**
 * Determina el estado de conexión de una terminal.
 *
 * Portado del POS viejo: TerminalSelector.jsx getNetStatus()
 * Usa la misma lógica de timeouts (25 min = inactiva, sin lock = disponible).
 *
 * FD-02: colores como CSS custom properties (rgb(var(--token))) en vez de hex.
 *
 * @param {object|null|undefined} info - Entrada de terminalStatuses[tid]
 * @returns {{ color: string, label: string }}
 */
export function resolveNetStatus(info) {
  if (!info || !info.occupier_id) {
    return { color: 'rgb(var(--estado-disponible))', label: 'DISPONIBLE' };
  }
  if (info.stale_session) {
    return { color: 'rgb(var(--estado-expirada))', label: 'SESIÓN EXPIRADA' };
  }
  if (info.locked_at) {
    const lockTime = new Date(info.locked_at.endsWith('Z') ? info.locked_at : info.locked_at + 'Z');
    const lockAgeMinutes = (Date.now() - lockTime.getTime()) / 60000;
    if (lockAgeMinutes < 25) {
      return { color: 'rgb(var(--estado-en-linea))', label: 'EN LÍNEA' };
    }
  }
  return { color: 'rgb(var(--estado-inactiva))', label: 'INACTIVA' };
}

