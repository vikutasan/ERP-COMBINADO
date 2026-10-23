/**
 * useCartSync — FD-07: persistencia al servidor + auto-heal 409.
 *
 * Recibe el objeto de estado de `useCartState` y provee los callbacks
 * async que se comunican con el API:
 *   - sincronizarVersion  — descarga versión fresca ante 409 (REGLA 9)
 *   - refrescarTotal      — lee total del BACKEND tras cada escritura
 *   - anadirLinea         — contrato 18 (atómico + idempotente)
 *   - cambiarCantidad     — contrato 19 (bloqueo optimista)
 *   - quitarLinea         — contrato 20 (anti-degradación RN-37)
 *   - clearCart           — prohibición #2: limpia SOLO tras verificación
 *
 * Reglas respetadas:
 *   - Prohibición #3: todos los callbacks leen refs, nunca estado cerrado.
 *   - Prohibición #2: `clearCart` no limpia sin HTTP 200 + verificación.
 *   - F12.17: auto-heal de conflicto de versión (409) en todas las escrituras.
 *   - DT-02 regla 6: el total lo dicta el BACKEND tras cada escritura.
 *
 * @param {ReturnType<import('./useCartState.js').useCartState>} st
 * @returns {object} callbacks de persistencia
 */

import { useCallback } from 'react';
import { aOutcome, esOk } from '../utils/outcome.js';
import { withRetries } from '../utils/withRetries.js';
import { buildResetPatch, aplicarReset } from '../state/sessionReset.js';
import { esErrorDeNegocio, esConflictoDeVersion } from './useTicketActions.js';
import { tieneLeerTicket, nuevoItemId } from './useCartState.js';

export function useCartSync(st) {
  const {
    setLineas, setVersionActual, setEnviando, setTotalServidor,
    lineasRef, versionRef, ticketRef, enviandoRef,
    apiRef, alLimpiarRef, totalServidorRef,
  } = st;

  // ── sincronizarVersion ─────────────────────────────────────────────────────
  /**
   * F12.17 — Auto-heal de conflicto de versión (409).
   *
   * Ante un 409, el ticket sigue siendo VÁLIDO, solo está desactualizado.
   * Se descarga la versión fresca (contrato 21) y se re-sincroniza
   * `versionRef` para que el reintento encadene (REGLA 9 — auto-heal).
   *
   * @returns {Promise<number|null>} versión fresca, o `null` si no se pudo.
   */
  const sincronizarVersion = useCallback(async () => {
    const cliente = apiRef.current;
    const idTicket = ticketRef.current;
    if (!cliente || !idTicket || !tieneLeerTicket(cliente)) return null;
    const lectura = await aOutcome(() => cliente.leerTicket(idTicket));
    if (!esOk(lectura) || !lectura.data) return null;
    const fresca = lectura.data.version;
    if (Number.isInteger(fresca) && fresca >= 0) {
      setVersionActual(fresca);
      versionRef.current = fresca;
    }
    // DT-02 regla 6: aprovechar la misma lectura para refrescar el total.
    const totalFresco = lectura.data.total;
    if (totalFresco !== undefined && totalFresco !== null) {
      const n = Number(totalFresco);
      if (Number.isFinite(n)) {
        setTotalServidor(n);
        totalServidorRef.current = n;
      }
    }
    return Number.isInteger(fresca) && fresca >= 0 ? fresca : null;
  }, [apiRef, ticketRef, versionRef, totalServidorRef, setVersionActual, setTotalServidor]);

  // ── refrescarTotal ─────────────────────────────────────────────────────────
  /**
   * Refresca el total desde el BACKEND (contrato 21).
   *
   * DT-02 regla 6: el total lo dicta el BACKEND. Se invoca tras CADA
   * escritura (añadir/cambiar/quitar) y al hidratar una cuenta.
   *
   * @returns {Promise<number|null>} total del servidor, o `null` si falló.
   */
  const refrescarTotal = useCallback(async () => {
    const cliente = apiRef.current;
    const idTicket = ticketRef.current;
    if (!cliente || !idTicket || !tieneLeerTicket(cliente)) return null;
    const lectura = await aOutcome(() => cliente.leerTicket(idTicket));
    if (!esOk(lectura) || !lectura.data) return null;
    const bruto = lectura.data.total;
    if (bruto === undefined || bruto === null) return null;
    const n = Number(bruto);
    if (!Number.isFinite(n)) return null;
    setTotalServidor(n);
    totalServidorRef.current = n;
    return n;
  }, [apiRef, ticketRef, totalServidorRef, setTotalServidor]);

  // ── anadirLinea ────────────────────────────────────────────────────────────
  /**
   * Añade una línea de forma ATÓMICA e IDEMPOTENTE (contrato 18).
   *
   * F12.23b — PARIDAD RN-17 CON EL POS VIEJO: fusiona por `product_id`
   * cuando el llamador no trae `item_id` explícito. Si trae `item_id`, lo
   * respeta para no pisar la identidad que el servidor ya conoce.
   *
   * @param {{product_id: string, quantity?: number, unit_price?: number, item_id?: string}} linea
   * @returns {Promise<import('../utils/outcome.js').Outcome>}
   */
  const anadirLinea = useCallback(async (linea) => {
    const cantidad = Number(linea.quantity ?? 1);
    const itemIdExplicito = linea.item_id || null;

    // F12.23b — resolver línea EXISTENTE antes de escribir.
    const existente =
      itemIdExplicito !== null
        ? lineasRef.current.find((l) => l.item_id === itemIdExplicito) || null
        : lineasRef.current.find((l) => l.product_id === linea.product_id) || null;
    const itemId = existente ? existente.item_id : itemIdExplicito || nuevoItemId();

    // Actualización optimista local
    setLineas((prev) => {
      const objetivo = itemIdExplicito
        ? prev.find((l) => l.item_id === itemIdExplicito)
        : prev.find((l) => l.product_id === linea.product_id);
      if (objetivo) {
        return prev.map((l) =>
          l === objetivo ? { ...l, quantity: l.quantity + cantidad } : l
        );
      }
      return [
        ...prev,
        {
          item_id:    itemId,
          product_id: linea.product_id,
          name:       linea.name ?? null,
          quantity:   cantidad,
          unit_price: Number(linea.unit_price ?? 0),
        },
      ];
    });

    const cliente = apiRef.current;
    const idTicket = linea.ticket_id || ticketRef.current;
    if (!cliente || !idTicket) {
      return { outcome: 'ok', reason: null, data: { item_id: itemId, local: true } };
    }

    // F12.17 — Escritura con auto-heal de versión (REGLA 9 + REGLA 18).
    let errorCrudo = null;
    let resultado = await aOutcome(() =>
      withRetries(
        () =>
          cliente.anadirItem(idTicket, {
            item_id:    itemId,
            product_id: linea.product_id,
            quantity:   cantidad,
            version:    versionRef.current,
          }),
        {
          debeReintentar: (err) => {
            errorCrudo = err;
            return !esErrorDeNegocio(err);
          },
        }
      )
    );

    if (!esOk(resultado) && esConflictoDeVersion(errorCrudo)) {
      const fresca = await sincronizarVersion();
      if (fresca !== null) {
        errorCrudo = null;
        resultado = await aOutcome(() =>
          withRetries(
            () =>
              cliente.anadirItem(idTicket, {
                item_id:    itemId,
                product_id: linea.product_id,
                quantity:   cantidad,
                version:    versionRef.current,
              }),
            { debeReintentar: (err) => !esErrorDeNegocio(err) }
          )
        );
      }
    }

    if (esOk(resultado) && resultado.data && typeof resultado.data.version === 'number') {
      setVersionActual(resultado.data.version);
      versionRef.current = resultado.data.version;
    }
    // DT-02 regla 6: tras persistir, el total lo dicta el BACKEND.
    if (esOk(resultado)) await refrescarTotal();
    // F12.28 — el `item_id` viaja SIEMPRE en `data`, también en caso de FALLO.
    return {
      ...resultado,
      data: { ...(resultado.data || {}), item_id: itemId },
    };
  }, [sincronizarVersion, refrescarTotal, setLineas, setVersionActual, apiRef, ticketRef, versionRef, lineasRef]);

  // ── cambiarCantidad ────────────────────────────────────────────────────────
  /**
   * Cambia la cantidad de una línea (contrato 19, bloqueo optimista).
   * @param {string} itemId
   * @param {number} quantity
   * @returns {Promise<import('../utils/outcome.js').Outcome>}
   */
  const cambiarCantidad = useCallback(async (itemId, quantity) => {
    setLineas((prev) =>
      prev.map((l) => (l.item_id === itemId ? { ...l, quantity: Number(quantity) } : l))
    );

    const cliente = apiRef.current;
    const idTicket = ticketRef.current;
    if (!cliente || !idTicket) {
      return { outcome: 'ok', reason: null, data: { item_id: itemId, local: true } };
    }

    let errorCrudo = null;
    let resultado = await aOutcome(() =>
      withRetries(
        () =>
          cliente.cambiarCantidad(idTicket, itemId, {
            quantity: Number(quantity),
            version:  versionRef.current,
          }),
        {
          debeReintentar: (err) => {
            errorCrudo = err;
            return !esErrorDeNegocio(err);
          },
        }
      )
    );

    if (!esOk(resultado) && esConflictoDeVersion(errorCrudo)) {
      const fresca = await sincronizarVersion();
      if (fresca !== null) {
        errorCrudo = null;
        resultado = await aOutcome(() =>
          withRetries(
            () =>
              cliente.cambiarCantidad(idTicket, itemId, {
                quantity: Number(quantity),
                version:  versionRef.current,
              }),
            { debeReintentar: (err) => !esErrorDeNegocio(err) }
          )
        );
      }
    }

    if (esOk(resultado) && resultado.data && typeof resultado.data.version === 'number') {
      setVersionActual(resultado.data.version);
      versionRef.current = resultado.data.version;
    }
    // DT-02 regla 6
    if (esOk(resultado)) await refrescarTotal();
    return resultado;
  }, [sincronizarVersion, refrescarTotal, setLineas, setVersionActual, apiRef, ticketRef, versionRef]);

  // ── quitarLinea ────────────────────────────────────────────────────────────
  /**
   * Quita una línea (contrato 20, anti-degradación RN-37).
   * @param {string} itemId
   * @returns {Promise<import('../utils/outcome.js').Outcome>}
   */
  const quitarLinea = useCallback(async (itemId) => {
    setLineas((prev) => prev.filter((l) => l.item_id !== itemId));

    const cliente = apiRef.current;
    const idTicket = ticketRef.current;
    if (!cliente || !idTicket) {
      return { outcome: 'ok', reason: null, data: { item_id: itemId, local: true } };
    }

    let errorCrudo = null;
    let resultado = await aOutcome(() =>
      withRetries(
        () => cliente.quitarItem(idTicket, itemId, { version: versionRef.current }),
        {
          debeReintentar: (err) => {
            errorCrudo = err;
            return !esErrorDeNegocio(err);
          },
        }
      )
    );

    if (!esOk(resultado) && esConflictoDeVersion(errorCrudo)) {
      const fresca = await sincronizarVersion();
      if (fresca !== null) {
        errorCrudo = null;
        resultado = await aOutcome(() =>
          withRetries(
            () => cliente.quitarItem(idTicket, itemId, { version: versionRef.current }),
            { debeReintentar: (err) => !esErrorDeNegocio(err) }
          )
        );
      }
    }

    if (esOk(resultado) && resultado.data && typeof resultado.data.version === 'number') {
      setVersionActual(resultado.data.version);
      versionRef.current = resultado.data.version;
    }
    // DT-02 regla 6
    if (esOk(resultado)) await refrescarTotal();
    return resultado;
  }, [sincronizarVersion, refrescarTotal, setLineas, setVersionActual, apiRef, ticketRef, versionRef]);

  // ── clearCart ──────────────────────────────────────────────────────────────
  /**
   * Limpia el carrito SOLO tras HTTP 200 + verificación post-envío.
   *
   * Prohibición #2: si la verificación no confirma que TODOS los `item_id`
   * están persistidos, el carrito NO se limpia.
   *
   * @returns {Promise<import('../utils/outcome.js').Outcome>}
   */
  const clearCart = useCallback(async () => {
    if (enviandoRef.current) {
      return { outcome: 'error', reason: 'envio_en_curso', data: null };
    }

    const cliente = apiRef.current;
    const idTicket = ticketRef.current;
    const ids = lineasRef.current.map((l) => l.item_id);
    // BUG-07 — Verificación por UNIDADES, no por número de líneas (RN-17 fusiona).
    const cantidades = lineasRef.current.map((l) => Number(l.quantity ?? 1));

    // Sin API o sin ticket: limpieza local
    if (!cliente || !idTicket) {
      setLineas([]);
      setTotalServidor(null);
      totalServidorRef.current = null;
      if (typeof alLimpiarRef.current === 'function') alLimpiarRef.current();
      return { outcome: 'ok', reason: null, data: { verificado: false, local: true } };
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      // 1) Verificación post-envío (contrato 22)
      // BUG-07 — Se envían `item_ids` Y `cantidades`.
      const verificacion = await aOutcome(() =>
        withRetries(() =>
          cliente.verificarEnvio(idTicket, { item_ids: ids, cantidades })
        )
      );

      if (!esOk(verificacion)) {
        return { outcome: 'error', reason: 'verificacion_fallo', data: null };
      }

      const faltantes = verificacion.data?.faltantes ?? [];
      if (faltantes.length > 0) {
        return {
          outcome: 'error',
          reason:  'items_no_persistidos',
          data:    { faltantes },
        };
      }

      // 2) Verificado: limpieza espejo (Regla 19).
      // F12.9 — `lineasRef` NO se pasa a `buildResetPatch` (FORBIDDEN_KEYS).
      setLineas([]);
      setTotalServidor(null);
      totalServidorRef.current = null;
      aplicarReset(
        { versionRef, ticketRef, enviandoRef },
        buildResetPatch({ versionRef, ticketRef, enviandoRef })
      );
      if (typeof alLimpiarRef.current === 'function') alLimpiarRef.current();
      return { outcome: 'ok', reason: null, data: { verificado: true } };
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }, [
    setLineas, setTotalServidor, setEnviando,
    apiRef, ticketRef, lineasRef, enviandoRef,
    alLimpiarRef, totalServidorRef, versionRef,
  ]);

  return {
    sincronizarVersion,
    refrescarTotal,
    anadirLinea,
    cambiarCantidad,
    quitarLinea,
    clearCart,
  };
}
