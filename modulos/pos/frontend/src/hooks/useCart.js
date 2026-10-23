/**
 * useCart — carrito con persistencia atómica por ítem (v6.0 SaaS).
 *
 * Orquestador FD-07: delega estado en `useCartState` y persistencia en
 * `useCartSync`. La API pública es idéntica a la versión anterior para
 * que todos los consumidores (RetailVisionPOS, CheckoutScreen, tests)
 * no cambien ni una línea.
 *
 * Cicatriz v6.0 (SaaS): el carrito se persistía como un BLOB completo. Si dos
 * operaciones concurrentes tocaban el carrito, la última escritura pisaba a la
 * anterior y se perdían líneas. La corrección es persistir POR ÍTEM: cada
 * `item_id` es una operación atómica e idempotente (contrato 18).
 *
 * Reglas duras que este hook respeta:
 *   - Prohibición #3: los callbacks asíncronos leen `useRef`, nunca estado
 *     cerrado (Ticket #906, $124 → $2).
 *   - Prohibición #2: `clearCart()` SOLO ocurre tras HTTP 200 **+ verificación
 *     post-envío** (contrato 22). Si la verificación falla, el carrito NO se
 *     limpia.
 *   - H1: los `useEffect` dependen de primitivos, no de objetos recreados.
 *
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §5 (reglas arquitectónicas)
 * @see PLAN_DE_ABORDAJE_FASE_3_POR_PARTES.md §4 FASE 3.3
 */

import { useApi } from '../context/ApiContext.jsx';
import { useCartState } from './useCartState.js';
import { useCartSync } from './useCartSync.js';

// Re-exportar helpers para retrocompatibilidad con imports directos de useCart.
export { nuevoItemId } from './useCartState.js';

/**
 * @param {object} [opciones]
 * @param {object} [opciones.api] - cliente con `anadirItem`, `cambiarCantidad`,
 *   `quitarItem` y `verificarEnvio`. Inyectable para tests.
 * @param {string} [opciones.ticketId] - ticket OPEN en el servidor (si existe).
 * @param {number} [opciones.version] - versión optimista del ticket.
 * @param {() => void} [opciones.alLimpiar] - callback tras limpieza verificada.
 * @returns {object} estado y acciones del carrito
 */
export function useCart(opciones = {}) {
  // FA-01: `api` ya no es una prop; se obtiene del ApiContext.
  // Se mantiene el fallback `opciones.api` para retrocompatibilidad con tests
  // que inyectan el cliente directamente (sin ApiContext.Provider).
  const apiCtx = useApi();
  const { api: apiProp = null, ticketId = null, version = 0, alLimpiar = null } = opciones;
  const api = apiProp ?? apiCtx;

  // ── Estado puro (líneas, versión, total, refs espejo) ─────────────────────
  const st = useCartState({ api, ticketId, version, alLimpiar });

  // ── Persistencia al servidor (callbacks async con auto-heal) ──────────────
  const sync = useCartSync(st);

  // ── API pública — idéntica al contrato original de useCart ────────────────
  return {
    lineas:          st.lineas,
    total:           st.total,
    version:         st.versionActual,
    enviando:        st.enviando,
    anadirLinea:     sync.anadirLinea,
    cambiarCantidad: sync.cambiarCantidad,
    quitarLinea:     sync.quitarLinea,
    clearCart:       sync.clearCart,
    hidratarLineas:  st.hidratarLineas,
    refrescarTotal:  sync.refrescarTotal,
  };
}

export default useCart;
