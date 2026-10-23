/**
 * useTicketActions — acciones del ticket con contrato `{outcome, reason}`.
 *
 * Cicatriz v7.0.3 (cuentas perdidas): las acciones de persistencia podían
 * lanzar excepciones que nadie capturaba, o "tener éxito" devolviendo algo
 * ambiguo. El resultado fueron cuentas que se perdían silenciosamente.
 *
 * Este hook garantiza que TODA acción devuelve `{ outcome, reason, data }` y
 * NUNCA lanza. Además, toda rama de salida (éxito, fallo, timeout) limpia
 * EXACTAMENTE los mismos refs (Regla 19 — limpieza espejo).
 *
 * Reglas duras:
 *   - Prohibición #3: callbacks async leen `useRef`, no estado cerrado.
 *   - H1: `useEffect` deps = primitivos.
 *   - Contrato `{outcome, reason}` en toda función de persistencia.
 *
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §5 (reglas arquitectónicas)
 * @see PLAN_DE_ABORDAJE_FASE_3_POR_PARTES.md §4 FASE 3.3
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { aOutcome, esOk } from '../utils/outcome.js';
import { withRetries } from '../utils/withRetries.js';
import { buildResetPatch, aplicarReset } from '../state/sessionReset.js';
import { useApi } from '../context/ApiContext.jsx';

/**
 * F12.12 — ¿Es un error de NEGOCIO (no de red)?
 *
 * REGLA 18 (v7.0.2): el checkout debe reintentar errores de RED, pero NUNCA
 * errores de lógica de negocio. Reintentar un 409 (conflicto de versión) o un
 * "ya ha sido pagado" es inútil y peligroso: el auto-heal / la condición
 * terminal ya los manejan.
 *
 * El `ApiError` del cliente expone el código HTTP en `.codigo` (0 = red caída).
 * Un 409 es SIEMPRE de negocio (RN-25/RN-26). Un 400 con "ya ha sido pagado"
 * (RN-23) también es terminal.
 *
 * @param {Error & {codigo?: number}} err
 * @returns {boolean}
 */
export function esErrorDeNegocio(err) {
  if (!err) return false;
  if (err.codigo === 409) return true;
  const mensaje = String(err.message || '').toLowerCase();
  return mensaje.includes('ya ha sido pagado') || mensaje.includes('conflicto de versión');
}

/**
 * F12.12 — ¿Es un conflicto de versión (409)?
 * @param {Error & {codigo?: number}} err
 * @returns {boolean}
 */
export function esConflictoDeVersion(err) {
  return Boolean(err) && err.codigo === 409;
}

/**
 * F12.13 — Mutex de acciones de persistencia (REGLA 2).
 *
 * Cicatriz v7.0.3 (doble cobro): un doble clic en COBRAR podía disparar dos
 * llamadas concurrentes a `cobrarTicket`. El viejo POS lo resolvía con un
 * mutex de cadena de promesas que SERIALIZABA (la 2ª llamada esperaba a la
 * 1ª). Eso evita el doble cobro, pero encola trabajo que el usuario ya no
 * quiere: si el cajero hace doble clic, la 2ª intención es un error, no una
 * petición legítima.
 *
 * El nuevo POS lo hace INFIEL a propósito: RECHAZA la 2ª llamada concurrente
 * con `{ outcome: 'error', reason: 'accion_en_curso' }` en vez de encolarla.
 * Es más seguro: nunca se emite un segundo `cobrarTicket` por accidente.
 *
 * El mutex es un `useRef` booleano (prohibición #3: los callbacks async leen
 * refs, no estado cerrado). Se libera SIEMPRE en `finally`, de modo que un
 * fallo no deja el candado pegado.
 *
 * @param {{current: boolean}} mutexRef
 * @returns {boolean} `true` si se adquirió; `false` si ya había una acción en curso
 */
export function adquirirMutex(mutexRef) {
  if (mutexRef.current) return false;
  mutexRef.current = true;
  return true;
}

/**
 * F12.13 — Libera el mutex de acciones de persistencia.
 * @param {{current: boolean}} mutexRef
 */
export function liberarMutex(mutexRef) {
  mutexRef.current = false;
}

/**
 * @param {object} [opciones]
 * @param {object} [opciones.api] - cliente con `crearVenta` y `cobrarTicket`.
 * @param {string} [opciones.terminalId]
 * @param {string} [opciones.channel]
 * @param {() => void} [opciones.alCobrar] - callback tras cobro verificado.
 * @returns {object} estado y acciones del ticket
 */
export function useTicketActions(opciones = {}) {
  // FA-01: `api` se obtiene del ApiContext; fallback a opciones.api para tests.
  const apiCtx = useApi();
  const { api: apiProp = null, terminalId = null, channel = 'PANADERIA', alCobrar = null } = opciones;
  const api = apiProp ?? apiCtx;

  const [ticket, setTicket] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [ultimoOutcome, setUltimoOutcome] = useState(null);

  // Refs espejo (prohibición #3).
  const ticketRef = useRef(ticket);
  const enviandoRef = useRef(false);
  const apiRef = useRef(api);
  const terminalRef = useRef(terminalId);
  const channelRef = useRef(channel);
  const alCobrarRef = useRef(alCobrar);
  // F12.13 — Mutex de acciones de persistencia (REGLA 2). Rechaza la 2ª
  // llamada concurrente en vez de encolarla (ver `adquirirMutex`).
  const mutexRef = useRef(false);

  ticketRef.current = ticket;
  apiRef.current = api;
  terminalRef.current = terminalId;
  channelRef.current = channel;
  alCobrarRef.current = alCobrar;

  // H1: deps primitivos.
  useEffect(() => {
    terminalRef.current = terminalId;
  }, [terminalId]);

  useEffect(() => {
    channelRef.current = channel;
  }, [channel]);

  /** Limpieza espejo: TODA rama de salida limpia los mismos refs (Regla 19). */
  const limpiarRefs = useCallback(() => {
    aplicarReset(
      { ticketRef, enviandoRef },
      buildResetPatch({ ticketRef, enviandoRef })
    );
  }, []);

  /**
   * F8.6b — Limpia el ticket en memoria (estado + refs).
   *
   * Cicatriz (bug de runtime reportado en vivo): tras cobrar, `acciones.ticket`
   * quedaba con el ticket `PAID` para siempre. El `OverlayExito` ("Venta
   * cobrada") se montaba con `status === 'PAID'` y su botón "Nueva venta" NO
   * limpiaba el ticket, así que el operador quedaba ATRAPADO en el modal.
   *
   * Esta acción cierra el ciclo post-cobro: la pantalla la invoca al omitir/
   * enviar el ticket o al pulsar "Nueva venta", de modo que el overlay
   * desaparece y el POS queda listo para la siguiente venta.
   */
  const limpiarTicket = useCallback(() => {
    limpiarRefs();
    setTicket(null);
    setUltimoOutcome(null);
  }, [limpiarRefs]);

  /**
   * Crea el ticket con sus líneas (contrato 3). NUNCA lanza.
   *
   * F7.5.6 — El segundo argumento `bloquePedido` es OPCIONAL: son los campos
   * `order_*` que el modal de programación (F7.5.5) arma con
   * `construirBloquePedido`. Si no viene (o viene `{}`), el ticket es una venta
   * directa de mostrador y el comportamiento es idéntico al de la Fase 3.
   *
   * @param {Array<{product_id: string, quantity: number}>} items
   * @param {object} [bloquePedido] - campos `order_*` (contrato 3, opcionales)
   * @returns {Promise<import('../utils/outcome.js').Outcome>}
   */
  const crearTicket = useCallback(async (items, bloquePedido = null) => {
    const cliente = apiRef.current;
    if (!cliente) {
      const r = { outcome: 'error', reason: 'api_no_disponible', data: null };
      setUltimoOutcome(r);
      return r;
    }

    // F12.13 — Mutex (REGLA 2): rechazar la 2ª llamada concurrente. Un doble
    // clic en "Enviar Cuenta" no debe crear dos tickets.
    if (!adquirirMutex(mutexRef)) {
      const r = { outcome: 'error', reason: 'accion_en_curso', data: null };
      setUltimoOutcome(r);
      return r;
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      const resultado = await aOutcome(() =>
        withRetries(
          () =>
            cliente.crearVenta({
              terminal_id: terminalRef.current,
              channel: channelRef.current,
              items,
              // Solo se adjunta el bloque si trae campos (no se mandan `{}`).
              ...(bloquePedido && Object.keys(bloquePedido).length > 0
                ? bloquePedido
                : {}),
            }),
          // F12.12 / REGLA 18: no reintentar errores de negocio (409, ya pagado).
          { debeReintentar: (err) => !esErrorDeNegocio(err) }
        )
      );

      if (esOk(resultado)) {
        setTicket(resultado.data);
        ticketRef.current = resultado.data;
      } else {
        limpiarRefs();
      }
      setUltimoOutcome(resultado);
      return resultado;
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
      // F12.13 — Liberar SIEMPRE el mutex (éxito, fallo o excepción).
      liberarMutex(mutexRef);
    }
  }, [limpiarRefs]);

  /**
   * Cobra el ticket (contrato 4). NUNCA lanza. Toda rama limpia los mismos refs.
   *
   * FIX "confirmar pago no hace nada" (2ª vuelta, 7 Oct 2026): el `ticketRef`
   * interno SOLO se puebla cuando `crearTicket`/`cobrar` corren DENTRO de este
   * hook. Pero en el flujo real el ticket nace por `asegurarTicket` (al agregar
   * el primer ítem) o se adopta del pizarrón (`recuperarCuentaAlCarrito`): en
   * ambos casos el id vive en `RetailVisionPOS.ticketIdRef`, NO aquí. Al cobrar
   * una cuenta YA ABIERTA, `ticketRef.current` era `null` y `cobrar` devolvía
   * `sin_ticket_o_api` en silencio: el botón "no hacía nada".
   *
   * La corrección: `cobrar` acepta el `ticketId` EXPLÍCITO del llamador (que sí
   * lo conoce) y cae a `ticketRef.current` solo por retrocompatibilidad. El
   * `version` también puede venir del llamador; si no, se usa el del ticket
   * hidratado (o `undefined`, que el backend trata como "sin control de versión").
   *
   * @param {object} paymentDetails
   * @param {{ticketId?: string, version?: number, cashSessionId?: string}} [opciones]
   * @returns {Promise<import('../utils/outcome.js').Outcome>}
   */
  const cobrar = useCallback(async (paymentDetails, opciones = {}) => {
    const cliente = apiRef.current;
    const actual = ticketRef.current;
    // El id puede venir del llamador (cuenta abierta) o del ticket hidratado.
    const idTicket = opciones.ticketId || (actual && actual.id) || null;
    if (!cliente || !idTicket) {
      const r = { outcome: 'error', reason: 'sin_ticket_o_api', data: null };
      setUltimoOutcome(r);
      return r;
    }
    // La versión: la del llamador si viene; si no, la del ticket hidratado.
    const version =
      opciones.version != null ? opciones.version : (actual && actual.version);

    // F12.13 — Mutex (REGLA 2): rechazar la 2ª llamada concurrente. Un doble
    // clic en "CONFIRMAR PAGO" no debe cobrar dos veces (RN-23).
    if (!adquirirMutex(mutexRef)) {
      const r = { outcome: 'error', reason: 'accion_en_curso', data: null };
      setUltimoOutcome(r);
      return r;
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      // F12.12 / REGLA 18: se captura el error crudo para distinguir un 409
      // (conflicto de versión) de un fallo de red. Un 409 NO se reintenta.
      let errorCrudo = null;
      // BUG-08 — El turno de caja lo determina la terminal que COBRA, no la de
      // origen del ticket. "Toda terminal es una caja en potencia": una terminal
      // con turno abierto puede cobrar cuentas de OTRAS terminales, y el dinero
      // se cuenta en la caja que lo recibió (RN-53). Se declara el turno de la
      // terminal que cobra; el backend lo VALIDA (E-13) y NUNCA sobreescribe el
      // `terminal_id` del ticket (RN-12). Si no se declara, el backend cae al
      // comportamiento retrocompatible (turno de la terminal del ticket).
      const cuerpo = {
        payment_details: paymentDetails,
        version,
      };
      if (opciones.cashSessionId) {
        cuerpo.cash_session_id = opciones.cashSessionId;
      }
      const resultado = await aOutcome(() =>
        withRetries(
          () => cliente.cobrarTicket(idTicket, cuerpo),
          {
            debeReintentar: (err) => {
              errorCrudo = err;
              return !esErrorDeNegocio(err);
            },
          }
        )
      );

      if (esOk(resultado)) {
        setTicket(resultado.data);
        ticketRef.current = resultado.data;
        if (typeof alCobrarRef.current === 'function') alCobrarRef.current(resultado.data);
      } else if (esConflictoDeVersion(errorCrudo)) {
        // F12.12 — Auto-heal: el ticket sigue siendo VÁLIDO, solo está
        // desactualizado (otro vendedor lo modificó). NO se limpian los refs:
        // la pantalla descargará la versión fresca y re-hidratará el carrito
        // (REGLA 9). Se devuelve un `reason` distinguible para que la pantalla
        // dispare el auto-heal en vez de mostrar un error genérico.
        const r = {
          outcome: 'error',
          reason: 'version_conflict',
          data: { ticket_id: idTicket },
        };
        setUltimoOutcome(r);
        return r;
      } else {
        // Simetría: el fallo limpia los MISMOS refs que el éxito.
        limpiarRefs();
      }
      setUltimoOutcome(resultado);
      return resultado;
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
      // F12.13 — Liberar SIEMPRE el mutex (éxito, fallo o excepción).
      liberarMutex(mutexRef);
    }
  }, [limpiarRefs]);

  return {
    ticket,
    enviando,
    ultimoOutcome,
    crearTicket,
    cobrar,
    limpiarTicket,
  };
}

export default useTicketActions;
