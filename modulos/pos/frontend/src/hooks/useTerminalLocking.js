/**
 * useTerminalLocking — heartbeat + locks de terminal (OMEGA).
 *
 * Cicatriz OMEGA: una terminal podía quedar "ocupada" por un cajero que ya se
 * había ido (pestaña cerrada, red caída) y nadie liberaba el candado. Otra
 * terminal no podía tomar la caja. La corrección es un HEARTBEAT: mientras la
 * pestaña vive, late; si deja de latir, el lock expira.
 *
 * Este hook COMPLEMENTA la Fase 1 (que ya tiene `TerminalLock` en el backend):
 * aquí vive el latido del cliente y la decisión de tomar/liberar el candado.
 *
 * Reglas duras:
 *   - Prohibición #3: el latido lee `useRef`, no estado cerrado.
 *   - H1: `useEffect` deps = primitivos.
 *
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §5 (reglas arquitectónicas)
 * @see PLAN_DE_ABORDAJE_FASE_3_POR_PARTES.md §4 FASE 3.3
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { aOutcome, esOk } from '../utils/outcome.js';
import { useApi } from '../context/ApiContext.jsx';

/** Intervalo de latido por defecto (ms). */
export const LATIDO_POR_DEFECTO = 10000;

/**
 * @param {object} [opciones]
 * @param {object} [opciones.api] - cliente con `latir`, `tomarLock`, `liberarLock`.
 * @param {string} [opciones.terminalId]
 * @param {string} [opciones.usuarioId]
 * @param {number} [opciones.intervaloMs=10000]
 * @param {boolean} [opciones.activo=true]
 * @returns {object} estado y acciones del candado
 */
export function useTerminalLocking(opciones = {}) {
  // FA-01: `api` se obtiene del ApiContext; fallback a opciones.api para tests.
  const apiCtx = useApi();
  const {
    api: apiProp = null,
    terminalId = null,
    usuarioId = null,
    intervaloMs = LATIDO_POR_DEFECTO,
    activo = true,
  } = opciones;
  const api = apiProp ?? apiCtx;

  const [bloqueada, setBloqueada] = useState(false);
  const [dueno, setDueno] = useState(null);
  const [ultimoLatido, setUltimoLatido] = useState(null);

  // Refs espejo (prohibición #3).
  const apiRef = useRef(api);
  const terminalRef = useRef(terminalId);
  const usuarioRef = useRef(usuarioId);
  const bloqueadaRef = useRef(bloqueada);

  apiRef.current = api;
  terminalRef.current = terminalId;
  usuarioRef.current = usuarioId;
  bloqueadaRef.current = bloqueada;

  /** ¿El usuario actual es el dueño del candado? */
  const esDueno = Boolean(dueno) && dueno === usuarioRef.current;

  /**
   * Toma el candado de la terminal. NUNCA lanza.
   * @returns {Promise<import('../utils/outcome.js').Outcome>}
   */
  const tomarLock = useCallback(async () => {
    const cliente = apiRef.current;
    if (!cliente) {
      return { outcome: 'error', reason: 'api_no_disponible', data: null };
    }
    const resultado = await aOutcome(() =>
      cliente.tomarLock(terminalRef.current, usuarioRef.current)
    );
    if (esOk(resultado)) {
      setBloqueada(true);
      setDueno(usuarioRef.current);
    }
    return resultado;
  }, []);

  /**
   * Libera el candado. NUNCA lanza.
   * @returns {Promise<import('../utils/outcome.js').Outcome>}
   */
  const liberarLock = useCallback(async () => {
    const cliente = apiRef.current;
    if (!cliente) {
      return { outcome: 'error', reason: 'api_no_disponible', data: null };
    }
    const resultado = await aOutcome(() =>
      cliente.liberarLock(terminalRef.current, usuarioRef.current)
    );
    if (esOk(resultado)) {
      setBloqueada(false);
      setDueno(null);
    }
    return resultado;
  }, []);

  // Heartbeat: late mientras la pestaña vive y el lock está tomado.
  // H1: deps primitivos (activo, terminalId, intervaloMs, bloqueada).
  useEffect(() => {
    if (!activo || !bloqueada || typeof window === 'undefined') return undefined;

    let cancelado = false;

    async function latir() {
      const cliente = apiRef.current;
      if (!cliente || typeof cliente.latir !== 'function') return;
      try {
        await cliente.latir(terminalRef.current, usuarioRef.current);
        if (!cancelado) setUltimoLatido(Date.now());
      } catch {
        // Un latido fallido no rompe la UI; el lock expirará por TTL.
      }
    }

    latir();
    const id = setInterval(latir, intervaloMs);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [activo, bloqueada, terminalId, intervaloMs]);

  return {
    bloqueada,
    dueno,
    esDueno,
    ultimoLatido,
    tomarLock,
    liberarLock,
  };
}

export default useTerminalLocking;
