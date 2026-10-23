/**
 * useContextoDeVenta — el "cuarto" de la venta en curso (P1 del refactor por cuartos).
 *
 * CICATRIZ QUE LO ORIGINA (F12.32): al enviar una cuenta al pizarrón, el POS
 * reseteaba `ticketId` pero OLVIDABA `tipoPedido` y `bloquePedido`. El selector
 * se quedaba en 'PEDIDO' y el bloque del pedido anterior contaminaba la cuenta
 * siguiente. No fue un descuido aislado: fue el síntoma de tener **31 `useState`
 * + 3 `useRef` sueltos** en un solo componente, donde "cerrar una venta" es una
 * lista de resets que hay que recordar.
 *
 * Este hook cierra ese cuarto: es dueño de TODO el estado de la venta en curso
 * (datos + overlays + refs) y expone UN solo botón:
 *
 *   const venta = useContextoDeVenta();
 *   venta.cerrar();   // apaga TODOS los interruptores de la venta de golpe
 *
 * REGLAS QUE RESPETA (ver PLAN_DE_REFACTOR_POR_CUARTOS.md §3):
 *   1. REUTILIZA `state/sessionReset.js` (Regla 19, espejo de limpieza) para
 *      resetear los refs. NO reinventa la limpieza de refs a mano: eso fue
 *      exactamente lo que produjo la "cuenta fantasma" (refs huérfanos).
 *   2. RESPETA `FORBIDDEN_KEYS`: `cerrar()` NUNCA toca `sesion`, `productos`,
 *      `categorias`, `categoriaActiva`, `cargando`, `error`. Si alguien intentara
 *      meter una de esas claves al patch, `buildResetPatch` lanza `TypeError`
 *      (compuerta gratis: el diseño no puede violar la regla sin romper).
 *   3. PRESERVA la Prohibición #3 (§4): expone el estado **y** los refs espejo
 *      (`ticketIdRef`, `enviarCuentaRef`, `productosRef`), de modo que los
 *      callbacks asíncronos sigan leyendo `.current` y no la variable de estado.
 *
 * QUÉ **NO** ES ESTE CUARTO:
 *   - El catálogo (`categorias`, `productos`, `categoriaActiva`, `cargando`,
 *     `error`) → `FORBIDDEN_KEYS`; sobrevive entre cuentas.
 *   - La sesión de terminal (`sesion`) → `FORBIDDEN_KEYS`; persiste mientras el
 *     operador esté logueado.
 *   - La caja (`cajaAbierta`, `turnoCaja`, `avisoCaja`) → el turno pertenece a la
 *     TERMINAL, no a la cuenta.
 *   - El pizarrón, el PDF, la política de pago, la voz, el `viewMode` → no son
 *     estado de venta (peldaños P2/P3/P4).
 *
 * @see PLAN_DE_REFACTOR_POR_CUARTOS.md §3 (construir el cuarto crítico)
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §4 (Prohibición #3) · §5 (espejo de limpieza)
 * @see state/sessionReset.js (Regla 19 — limpieza espejo de refs)
 */

import { useCallback, useRef, useState } from 'react';
import { resetearSesion } from '../state/sessionReset.js';

/**
 * Valor inicial canónico de cada estado del cuarto de venta.
 *
 * Centralizado para que "cerrar la venta" signifique EXACTAMENTE lo mismo en
 * todas las ramas de salida (éxito, fallo, timeout, desmontaje). Es la versión
 * "estado" del espejo de limpieza (Regla 19): `cerrar()` aplica este mapa
 * completo, sin importar quién lo llame.
 *
 * NUNCA incluye claves de `FORBIDDEN_KEYS` (catálogo/sesión): esas tienen su
 * propio ciclo de vida y resetearlas aquí sería un bug silencioso.
 */
export const VALOR_INICIAL_VENTA = Object.freeze({
  // ── Datos de la venta en curso (lo que CONTAMINA la siguiente cuenta) ──────
  ticketId: null,
  tipoPedido: 'VENTA_DIRECTA',
  bloquePedido: null,
  avisoPedidoSinProgramar: null,
  cliente: null,
  // ── Overlays de venta (visibilidad; se cierran al terminar la venta) ───────
  checkoutAbierto: false,
  ticketAbierto: false,
  clienteAbierto: false,
  entregaAbierta: false,
});

/**
 * Claves de ref del cuarto de venta. Se pasan a `resetearSesion` para que la
 * limpieza de refs pase por `sessionReset.js` (Regla 19) y no a mano.
 *
 * `productosRef` NO se resetea aquí: es un espejo del CATÁLOGO (`productos`),
 * que está en `FORBIDDEN_KEYS`. Solo se expone para que los callbacks async lo
 * lean. Los refs que SÍ son de venta son `ticketIdRef` y `enviarCuentaRef`.
 */
const REFS_DE_VENTA = Object.freeze(['ticketIdRef', 'enviarCuentaRef']);

/**
 * Hook dueño del estado de la venta en curso.
 *
 * @returns {{
 *   ticketId: string|null,
 *   setTicketId: Function,
 *   tipoPedido: string,
 *   setTipoPedido: Function,
 *   bloquePedido: object|null,
 *   setBloquePedido: Function,
 *   avisoPedidoSinProgramar: object|null,
 *   setAvisoPedidoSinProgramar: Function,
 *   cliente: object|null,
 *   setCliente: Function,
 *   checkoutAbierto: boolean,
 *   setCheckoutAbierto: Function,
 *   ticketAbierto: boolean,
 *   setTicketAbierto: Function,
 *   clienteAbierto: boolean,
 *   setClienteAbierto: Function,
 *   entregaAbierta: boolean,
 *   setEntregaAbierta: Function,
 *   ticketIdRef: {current: string|null},
 *   enviarCuentaRef: {current: Function|null},
 *   productosRef: {current: Array},
 *   cerrar: Function,
 * }}
 */
export function useContextoDeVenta() {
  // ── Datos de la venta en curso ─────────────────────────────────────────────
  const [ticketId, setTicketId] = useState(VALOR_INICIAL_VENTA.ticketId);
  const [tipoPedido, setTipoPedido] = useState(VALOR_INICIAL_VENTA.tipoPedido);
  const [bloquePedido, setBloquePedido] = useState(VALOR_INICIAL_VENTA.bloquePedido);
  const [avisoPedidoSinProgramar, setAvisoPedidoSinProgramar] = useState(
    VALOR_INICIAL_VENTA.avisoPedidoSinProgramar,
  );
  const [cliente, setCliente] = useState(VALOR_INICIAL_VENTA.cliente);

  // ── Overlays de venta ──────────────────────────────────────────────────────
  const [checkoutAbierto, setCheckoutAbierto] = useState(
    VALOR_INICIAL_VENTA.checkoutAbierto,
  );
  const [ticketAbierto, setTicketAbierto] = useState(
    VALOR_INICIAL_VENTA.ticketAbierto,
  );
  const [clienteAbierto, setClienteAbierto] = useState(
    VALOR_INICIAL_VENTA.clienteAbierto,
  );
  const [entregaAbierta, setEntregaAbierta] = useState(
    VALOR_INICIAL_VENTA.entregaAbierta,
  );

  // ── Refs de venta (Prohibición #3: los callbacks async leen `.current`) ────
  // `ticketIdRef` es el espejo SÍNCRONO de `ticketId`: `setTicketId` no propaga
  // en el mismo tick, así que `asegurarTicket` y `confirmarCobro` leen el ref.
  const ticketIdRef = useRef(ticketId);
  ticketIdRef.current = ticketId;

  // `enviarCuentaRef` apunta a la versión vigente de `enviarCuentaAlPizarron`.
  // El aviso "PEDIDO sin programar" (F12.30) lo usa para reanudar el envío.
  const enviarCuentaRef = useRef(null);

  // `productosRef` es el espejo del CATÁLOGO (no se resetea: FORBIDDEN_KEYS).
  // Se expone aquí para que `alEscanear` lea el catálogo sin depender del estado.
  const productosRef = useRef([]);

  /**
   * Cierra la venta en curso: apaga TODOS los interruptores del cuarto.
   *
   * Es la ÚNICA forma de cerrar una venta. Reemplaza la lista de resets que se
   * olvidaba un interruptor (F12.32: `setTipoPedido` + `setBloquePedido`).
   *
   * 1. Resetea los ESTADOS de venta a su valor inicial canónico.
   * 2. Resetea los REFS de venta vía `resetearSesion` (Regla 19) — no a mano.
   * 3. NUNCA toca `FORBIDDEN_KEYS` (catálogo/sesión).
   *
   * NO limpia el carrito: eso lo hace `carrito.clearCart()` con verificación
   * post-envío (contrato 22). Resetear `lineas` aquí saltaría esa verificación.
   */
  const cerrar = useCallback(() => {
    // 1) Estados de venta → valor inicial canónico.
    setTicketId(VALOR_INICIAL_VENTA.ticketId);
    setTipoPedido(VALOR_INICIAL_VENTA.tipoPedido);
    setBloquePedido(VALOR_INICIAL_VENTA.bloquePedido);
    setAvisoPedidoSinProgramar(VALOR_INICIAL_VENTA.avisoPedidoSinProgramar);
    setCliente(VALOR_INICIAL_VENTA.cliente);
    setCheckoutAbierto(VALOR_INICIAL_VENTA.checkoutAbierto);
    setTicketAbierto(VALOR_INICIAL_VENTA.ticketAbierto);
    setClienteAbierto(VALOR_INICIAL_VENTA.clienteAbierto);
    setEntregaAbierta(VALOR_INICIAL_VENTA.entregaAbierta);

    // 2) Refs de venta → limpieza espejo vía sessionReset.js (Regla 19).
    //    Se pasan SOLO los refs de venta; `productosRef` NO (es catálogo).
    //    `buildResetPatch` lanza TypeError si alguna clave colisiona con
    //    FORBIDDEN_KEYS: compuerta gratis contra violar la regla.
    const refsDeVenta = {};
    for (const clave of REFS_DE_VENTA) {
      if (clave === 'ticketIdRef') refsDeVenta.ticketIdRef = ticketIdRef;
      if (clave === 'enviarCuentaRef') refsDeVenta.enviarCuentaRef = enviarCuentaRef;
    }
    resetearSesion(refsDeVenta);
  }, []);

  return {
    // Datos de venta
    ticketId,
    setTicketId,
    tipoPedido,
    setTipoPedido,
    bloquePedido,
    setBloquePedido,
    avisoPedidoSinProgramar,
    setAvisoPedidoSinProgramar,
    cliente,
    setCliente,
    // Overlays de venta
    checkoutAbierto,
    setCheckoutAbierto,
    ticketAbierto,
    setTicketAbierto,
    clienteAbierto,
    setClienteAbierto,
    entregaAbierta,
    setEntregaAbierta,
    // Refs de venta (Prohibición #3)
    ticketIdRef,
    enviarCuentaRef,
    productosRef,
    // El único botón del cuarto
    cerrar,
  };
}

export default useContextoDeVenta;
