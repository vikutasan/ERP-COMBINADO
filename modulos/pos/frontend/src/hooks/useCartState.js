/**
 * useCartState — FD-07: estado local puro del carrito.
 *
 * Contiene TODO el estado (useState, useRef, useMemo) sin ninguna
 * llamada al API. El hook de sincronización (useCartSync) recibe este
 * objeto y actúa sobre los refs y setters que aquí se exponen.
 *
 * Reglas respetadas:
 *   - Prohibición #3: los refs espejo se actualizan en cada render para
 *     que los callbacks async lean SIEMPRE el estado actual.
 *   - H1: los useEffect dependen de primitivos, no de objetos recreados.
 *   - DT-02 regla 6: el total viene del backend; el fallback local está
 *     marcado con DT-02-FALLBACK-LOCAL.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Genera un `item_id` estable para una línea del carrito. */
export function nuevoItemId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * ¿El cliente expone `leerTicket` (contrato 21)?
 *
 * Se accede a la propiedad dentro de un `try/catch` porque los mocks de Vitest
 * lanzan al leer un export NO definido (en vez de devolver `undefined`). Sin
 * esto, un test que mockea `api/client.js` sin `leerTicket` rompería al
 * refrescar el total (DT-02 regla 6).
 *
 * @param {object} cliente
 * @returns {boolean}
 */
export function tieneLeerTicket(cliente) {
  try {
    return typeof cliente.leerTicket === 'function';
  } catch {
    return false;
  }
}

/**
 * @param {object} [opciones]
 * @param {object|null} [opciones.api] - cliente API resuelto (ya mergeado ctx+prop).
 * @param {string|null} [opciones.ticketId]
 * @param {number} [opciones.version]
 * @param {Function|null} [opciones.alLimpiar]
 * @returns {object} estado completo + refs + setters + helpers
 */
export function useCartState({ api = null, ticketId = null, version = 0, alLimpiar = null } = {}) {

  // ── Estado reactivo ────────────────────────────────────────────────────────
  const [lineas, setLineas]               = useState([]);
  const [versionActual, setVersionActual] = useState(version);
  const [enviando, setEnviando]           = useState(false);
  // DT-02 regla 6: el total NO se suma en el frontend. `null` = desconocido.
  const [totalServidor, setTotalServidor] = useState(null);

  // ── Refs espejo (prohibición #3): los callbacks async leen AQUÍ ───────────
  const lineasRef          = useRef(lineas);
  const versionRef         = useRef(versionActual);
  const ticketRef          = useRef(ticketId);
  const enviandoRef        = useRef(false);
  const apiRef             = useRef(api);
  const alLimpiarRef       = useRef(alLimpiar);
  const totalServidorRef   = useRef(totalServidor);

  // Actualizar refs en cada render (sin useEffect para que sean síncronos)
  lineasRef.current        = lineas;
  versionRef.current       = versionActual;
  ticketRef.current        = ticketId;
  apiRef.current           = api;
  alLimpiarRef.current     = alLimpiar;
  totalServidorRef.current = totalServidor;

  // H1: el efecto depende de primitivos
  useEffect(() => { setVersionActual(version); }, [version]);
  useEffect(() => { ticketRef.current = ticketId; }, [ticketId]);

  // ── Total (DT-02 regla 6) ──────────────────────────────────────────────────
  const total = useMemo(() => {
    if (totalServidor !== null) return totalServidor;
    // DT-02-FALLBACK-LOCAL: única suma de dinero permitida en el frontend,
    // SOLO en ausencia total de servidor.
    return (
      Math.round(
        lineas.reduce((acc, l) => acc + Number(l.unit_price) * Number(l.quantity), 0) * 100 // DT-02-FALLBACK-LOCAL
      ) / 100
    );
  }, [totalServidor, lineas]);

  // ── hidratarLineas (operación de solo estado, sin API) ────────────────────
  /**
   * Hidrata el carrito con las líneas de un ticket existente (F12.10).
   *
   * Reemplaza las líneas (no las suma): es una ADOPCIÓN de una cuenta.
   *
   * @param {Array} lineasServidor
   * @param {number} [versionServidor]
   * @param {number|string} [totalServidorParam]
   */
  const hidratarLineas = useCallback((lineasServidor, versionServidor, totalServidorParam) => {
    const normalizadas = (Array.isArray(lineasServidor) ? lineasServidor : []).map((l) => ({
      item_id:    l.item_id,
      product_id: l.product_id,
      name:       l.name ?? null,
      quantity:   Number(l.quantity ?? 1),
      unit_price: Number(l.unit_price ?? 0),
    }));

    setLineas(normalizadas);
    lineasRef.current = normalizadas;

    if (Number.isInteger(versionServidor) && versionServidor >= 0) {
      setVersionActual(versionServidor);
      versionRef.current = versionServidor;
    }

    // DT-02 regla 6: el total de una cuenta recuperada es el del BACKEND.
    if (totalServidorParam !== undefined && totalServidorParam !== null) {
      const n = Number(totalServidorParam);
      if (Number.isFinite(n)) {
        setTotalServidor(n);
        totalServidorRef.current = n;
      }
    }

    return { outcome: 'ok', reason: null, data: { hidratadas: normalizadas.length } };
  }, []);

  return {
    // Estado reactivo
    lineas, setLineas,
    versionActual, setVersionActual,
    enviando, setEnviando,
    totalServidor, setTotalServidor,
    // Refs espejo
    lineasRef, versionRef, ticketRef, enviandoRef,
    apiRef, alLimpiarRef, totalServidorRef,
    // Computed
    total,
    // Acciones de solo estado
    hidratarLineas,
  };
}
