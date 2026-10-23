/**
 * usePreferenciasDeVista — el "cuarto" de las preferencias de vista (P2a del
 * refactor por cuartos).
 *
 * ORIGEN: el refactor por cuartos nació de F12.32 (el selector de pedido
 * sobrevivía al envío de la cuenta). La causa de fondo era tener 31 `useState`
 * + 3 `useRef` sueltos en `RetailVisionPOS.jsx`, donde "cerrar una venta" era
 * una lista de resets que se olvidaba un interruptor. P1 cerró el cuarto de la
 * VENTA EN CURSO. P2a cierra el cuarto de las PREFERENCIAS DE VISTA.
 *
 * QUÉ ES ESTE CUARTO (y qué NO es):
 *   - `vozAbierta` → visibilidad del overlay de voz (panel de IA).
 *   - `viewMode`   → modo de vista del cuerpo: 'GRID' | 'CAMERA' (la visión es
 *     un MODO DE VISTA, no un overlay; reemplaza el cuerpo, F7.6.2).
 *
 *   NO es este cuarto:
 *   - El estado de la VENTA (ticket, tipoPedido, overlays de venta) → P1
 *     (`useContextoDeVenta`).
 *   - El `banner` → es un canal de mensajes TRANSVERSAL (lo escriben flujos de
 *     venta, caja y pizarrón). No es un cuarto cerrado; se difiere a un futuro
 *     cuarto de notificaciones. Meterlo aquí lo acoplaría a todos los demás.
 *   - `coloresPorTerminal` → es CONFIG de terminal (se puebla al montar desde
 *     `/pos/terminals/config`), no visibilidad efímera. Se difiere a un futuro
 *     `useConfigTerminales`.
 *   - Los modales de flujo (`salidaAbierta`, `avisoEmpaque`) → P2b
 *     (`useModalesDeFlujo`).
 *
 * REGLAS QUE RESPETA (ver PLAN_DE_REFACTOR_POR_CUARTOS.md §3 y §5):
 *   1. Valor inicial canónico CONGELADO: "resetear la vista" significa lo mismo
 *      en todas las ramas de salida (espejo de limpieza, Regla 19).
 *   2. NO toca `FORBIDDEN_KEYS` (catálogo/sesión): este cuarto no tiene refs ni
 *      claves con ciclo propio.
 *   3. Preserva la Prohibición #3: estos estados NO se leen en callbacks
 *      asíncronos, así que no requieren refs espejo.
 *
 * @see PLAN_DE_REFACTOR_POR_CUARTOS.md §5 (peldaños P2a/P2b)
 * @see useContextoDeVenta.js (P1 — el cuarto crítico, patrón replicado aquí)
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §5 (espejo de limpieza)
 */

import { useCallback, useState } from 'react';

/**
 * Valor inicial canónico de cada estado del cuarto de preferencias de vista.
 *
 * Centralizado para que "resetear la vista" signifique EXACTAMENTE lo mismo en
 * todas las ramas de salida. Es la versión "estado" del espejo de limpieza
 * (Regla 19): `reset()` aplica este mapa completo, sin importar quién lo llame.
 *
 * NUNCA incluye claves de `FORBIDDEN_KEYS` (catálogo/sesión): esas tienen su
 * propio ciclo de vida.
 */
export const VALOR_INICIAL_VISTA = Object.freeze({
  // ── Overlay de voz (panel de IA) ───────────────────────────────────────────
  vozAbierta: false,
  // ── Modo de vista del cuerpo: 'GRID' | 'CAMERA' ────────────────────────────
  viewMode: 'GRID',
});

/**
 * Hook dueño de las preferencias de vista del POS.
 *
 * @returns {{
 *   vozAbierta: boolean,
 *   setVozAbierta: Function,
 *   viewMode: string,
 *   setViewMode: Function,
 *   reset: Function,
 * }}
 */
export function usePreferenciasDeVista() {
  // ── Overlay de voz ─────────────────────────────────────────────────────────
  const [vozAbierta, setVozAbierta] = useState(VALOR_INICIAL_VISTA.vozAbierta);

  // ── Modo de vista del cuerpo (grid ↔ visor de cámara) ──────────────────────
  const [viewMode, setViewMode] = useState(VALOR_INICIAL_VISTA.viewMode);

  /**
   * Resetea las preferencias de vista a su valor inicial canónico.
   *
   * Es la ÚNICA forma de "volver a la vista base". Reemplaza la lista de resets
   * que se olvidaba un interruptor. NO toca `FORBIDDEN_KEYS` (no aplica aquí).
   */
  const reset = useCallback(() => {
    setVozAbierta(VALOR_INICIAL_VISTA.vozAbierta);
    setViewMode(VALOR_INICIAL_VISTA.viewMode);
  }, []);

  return {
    vozAbierta,
    setVozAbierta,
    viewMode,
    setViewMode,
    reset,
  };
}

export default usePreferenciasDeVista;
