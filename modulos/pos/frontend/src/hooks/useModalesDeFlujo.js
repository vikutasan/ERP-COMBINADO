/**
 * useModalesDeFlujo — el "cuarto" de los modales de flujo (P2b del refactor por
 * cuartos).
 *
 * ORIGEN: el refactor por cuartos nació de F12.32 (el selector de pedido
 * sobrevivía al envío de la cuenta). La causa de fondo era tener 31 `useState`
 * + 3 `useRef` sueltos en `RetailVisionPOS.jsx`, donde "cerrar una venta" era
 * una lista de resets que se olvidaba un interruptor. P1 cerró el cuarto de la
 * VENTA EN CURSO. P2a cerró el de las PREFERENCIAS DE VISTA. P2b cierra el de
 * los MODALES DE FLUJO.
 *
 * QUÉ ES ESTE CUARTO (y qué NO es):
 *   - `salidaAbierta` → visibilidad de `ExitAccountModal` (F9.0.1). Salvaguarda
 *     de salida: si el operador intenta salir con una cuenta abierta, se muestra
 *     este modal en vez de salir en silencio.
 *   - `avisoEmpaque`  → visibilidad del aviso de empaque (P1, Capa 2). Se
 *     enciende cuando el cajero intenta cobrar un PEDIDO con "Vender Empaque"
 *     marcado pero sin ningún producto EMPAQUE en el carrito.
 *
 *   Son los dos modales que INTERRUMPEN un flujo (salir / cobrar) para pedir una
 *   confirmación. Comparten ciclo de vida: se abren desde una acción del
 *   operador y se cierran al resolverla. Por eso forman UN cuarto.
 *
 *   NO es este cuarto:
 *   - El estado de la VENTA (ticket, tipoPedido, overlays de venta) → P1
 *     (`useContextoDeVenta`).
 *   - Las preferencias de vista (`vozAbierta`, `viewMode`) → P2a
 *     (`usePreferenciasDeVista`).
 *   - El `banner` → es un canal de mensajes TRANSVERSAL (lo escriben flujos de
 *     venta, caja y pizarrón). No es un cuarto cerrado; se difiere a un futuro
 *     cuarto de notificaciones.
 *   - `coloresPorTerminal` → es CONFIG de terminal (se puebla al montar desde
 *     `/pos/terminals/config`), no visibilidad efímera. Se difiere a un futuro
 *     `useConfigTerminales`.
 *   - Los overlays de caja/pizarrón/PDF (`cajaAbierta`, `pizarronAbierto`,
 *     `selectorPDFAbierto`, …) → P3: son cuartos con su propio ciclo y estado
 *     asociado (turno, cuentas, exportación), no simples modales de confirmación.
 *
 * REGLAS QUE RESPETA (ver PLAN_DE_REFACTOR_POR_CUARTOS.md §3 y §5):
 *   1. Valor inicial canónico CONGELADO: "cerrar los modales de flujo" significa
 *      lo mismo en todas las ramas de salida (espejo de limpieza, Regla 19).
 *   2. NO toca `FORBIDDEN_KEYS` (catálogo/sesión): este cuarto no tiene refs ni
 *      claves con ciclo propio.
 *   3. Preserva la Prohibición #3: estos estados NO se leen en callbacks
 *      asíncronos, así que no requieren refs espejo.
 *
 * @see PLAN_DE_REFACTOR_POR_CUARTOS.md §5 (peldaños P2a/P2b)
 * @see usePreferenciasDeVista.js (P2a — patrón replicado aquí)
 * @see useContextoDeVenta.js (P1 — el cuarto crítico, patrón original)
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §5 (espejo de limpieza)
 */

import { useCallback, useState } from 'react';

/**
 * Valor inicial canónico de cada estado del cuarto de modales de flujo.
 *
 * Centralizado para que "cerrar los modales de flujo" signifique EXACTAMENTE lo
 * mismo en todas las ramas de salida. Es la versión "estado" del espejo de
 * limpieza (Regla 19): `reset()` aplica este mapa completo, sin importar quién
 * lo llame.
 *
 * NUNCA incluye claves de `FORBIDDEN_KEYS` (catálogo/sesión): esas tienen su
 * propio ciclo de vida.
 */
export const VALOR_INICIAL_MODALES = Object.freeze({
  // ── F9.0.1 — Salvaguarda de salida con cuenta abierta ──────────────────────
  salidaAbierta: false,
  // ── P1 — Guardia de empaque (Capa 2: aviso al cobrar) ──────────────────────
  avisoEmpaque: false,
});

/**
 * Hook dueño de los modales de flujo del POS.
 *
 * @returns {{
 *   salidaAbierta: boolean,
 *   setSalidaAbierta: Function,
 *   avisoEmpaque: boolean,
 *   setAvisoEmpaque: Function,
 *   reset: Function,
 * }}
 */
export function useModalesDeFlujo() {
  // ── Salvaguarda de salida (F9.0.1) ─────────────────────────────────────────
  const [salidaAbierta, setSalidaAbierta] = useState(
    VALOR_INICIAL_MODALES.salidaAbierta,
  );

  // ── Guardia de empaque (P1, Capa 2) ────────────────────────────────────────
  const [avisoEmpaque, setAvisoEmpaque] = useState(
    VALOR_INICIAL_MODALES.avisoEmpaque,
  );

  /**
   * Cierra los modales de flujo a su valor inicial canónico.
   *
   * Es la ÚNICA forma de "cerrar los modales de flujo". Reemplaza la lista de
   * resets que se olvidaba un interruptor. NO toca `FORBIDDEN_KEYS` (no aplica).
   */
  const reset = useCallback(() => {
    setSalidaAbierta(VALOR_INICIAL_MODALES.salidaAbierta);
    setAvisoEmpaque(VALOR_INICIAL_MODALES.avisoEmpaque);
  }, []);

  return {
    salidaAbierta,
    setSalidaAbierta,
    avisoEmpaque,
    setAvisoEmpaque,
    reset,
  };
}

export default useModalesDeFlujo;
