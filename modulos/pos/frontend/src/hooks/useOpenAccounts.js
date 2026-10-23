/**
 * useOpenAccounts — estado del pizarrón de cuentas abiertas (F5.2).
 *
 * Expone la lista de cuentas OPEN de una terminal, su estado de carga/error,
 * una acción de refresco y una acción de recuperación.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LECCIÓN v6.0 — "Recuperación de cuenta = descargar versión fresca"
 * ─────────────────────────────────────────────────────────────────────────────
 * `recuperarCuenta(ticketId)` NO devuelve la copia que el pizarrón ya tiene en
 * memoria. Llama al contrato 21 (`pos.leer_ticket`) para traer la versión ACTUAL
 * del servidor. El bug que esto evita: el cajero abre una cuenta desde el
 * pizarrón, trabaja sobre una copia vieja, y al guardar pisa cambios que otra
 * terminal ya había hecho (o peor, escribe con un `version` obsoleto y recibe
 * un 409 confuso).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROHIBICIÓN #3 — nada de leer estado en callbacks asíncronos
 * ─────────────────────────────────────────────────────────────────────────────
 * Los callbacks leen de `useRef`, nunca del estado cerrado por el closure.
 * Si `refrescar` leyera `terminalId` del estado, una llamada disparada justo
 * antes de un cambio de terminal escribiría la respuesta de la terminal vieja.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * H1 — dependencias primitivas
 * ─────────────────────────────────────────────────────────────────────────────
 * El `useEffect` depende de `terminalId` (string primitivo), no de un objeto
 * recreado en cada render. Así no entra en un bucle de fetch infinito.
 *
 * @see PLAN_DE_ABORDAJE_FASE_5_POR_PARTES.md §6 (F5.2)
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §5 (Regla 1, Prohibición #3, H1)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as servicio from '../services/openAccountsService.js';
import { useApi } from '../context/ApiContext.jsx';
import { aOutcome, esOk } from '../utils/outcome.js';

/**
 * FIX_PIZARRON_POLLING (8 Oct 2026) — Cadencia del auto-refresco del pizarrón.
 * El corcho vuelve a descargar la lista cada 5 s mientras está montado, de modo
 * que un post-it nuevo aparece solo (misma pantalla o pantalla separada) sin
 * depender de que la señal externa llegue. Es una lectura ligera (contrato 23).
 */
export const INTERVALO_POLLING_MS = 5000;

/**
 * @param {object} [opciones]
 * @param {string} [opciones.terminalId] - terminal cuyas cuentas se listan
 * @param {object} [opciones.servicioCuentas] - inyectable para tests
 * @param {object} [opciones.clienteApi] - inyectable para tests
 * @returns {{
 *   cuentas: Array<object>,
 *   cargando: boolean,
 *   error: string|null,
 *   refrescar: () => Promise<void>,
 *   recuperarCuenta: (ticketId: string) => Promise<{outcome: string, reason: string|null, data: object|null}>,
 * }}
 */
export function useOpenAccounts(opciones = {}) {
  // FA-01 — cliente del API por contexto; los tests pueden inyectar uno propio.
  const apiCtx = useApi();
  const {
    terminalId = '',
    todasLasTerminales = false,
    servicioCuentas = servicio,
    clienteApi = apiCtx,
    // FIX_PIZARRON_NO_REFRESCA (8 Oct 2026) — Señal externa de refresco. El
    // pizarrón la incrementa al enviar una cuenta; al cambiar, el `useEffect`
    // de carga vuelve a disparar `refrescar()` y la lista se re-descarga.
    refrescarSenal = 0,
  } = opciones;

  const [cuentas, setCuentas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  // Refs: los callbacks asíncronos leen de aquí, no del estado cerrado.
  const terminalRef = useRef(terminalId);
  terminalRef.current = terminalId;
  const todasLasTerminalesRef = useRef(todasLasTerminales);
  todasLasTerminalesRef.current = todasLasTerminales;
  const servicioRef = useRef(servicioCuentas);
  servicioRef.current = servicioCuentas;
  const clienteRef = useRef(clienteApi);
  clienteRef.current = clienteApi;

  // Guardia de desmontaje: evita escribir estado tras desmontar (cleanup).
  const vivoRef = useRef(true);
  useEffect(() => {
    vivoRef.current = true;
    return () => {
      vivoRef.current = false;
    };
  }, []);

  /**
   * Descarga la lista de cuentas abiertas de la terminal actual.
   * No lanza: el servicio ya devuelve `{outcome, reason}`.
   */
  const refrescar = useCallback(async () => {
    const id = terminalRef.current;
    // FIX_PIZARRON_CAJA_SIN_TERMINAL (9 Oct 2026) — El modo CAJA (D1) lista las
    // cuentas de TODAS las terminales y NO tiene `terminalId` propio. Antes se
    // salía aquí en cuanto `id` era vacío, ANTES de mirar `todasLasTerminales`,
    // así que el pizarrón de caja quedaba SIEMPRE vacío. Solo se sale si no hay
    // ni terminal ni modo "todas".
    if (!id && !todasLasTerminalesRef.current) {
      setCuentas([]);
      setError(null);
      setCargando(false);
      return;
    }

    setCargando(true);
    // D1 — CAJA ve TODAS las cuentas; terminal normal solo las suyas (RN-31).
    const r = todasLasTerminalesRef.current
      ? await servicioRef.current.listarTodasLasCuentasAbiertas()
      : await servicioRef.current.listarCuentasAbiertas(id);
    if (!vivoRef.current) return;

    if (esOk(r)) {
      setCuentas(r.data?.cuentas ?? []);
      setError(null);
    } else {
      setCuentas([]);
      setError(r.reason || 'error_desconocido');
    }
    setCargando(false);
  }, []);

  /**
   * Recupera la versión FRESCA de una cuenta desde el servidor (contrato 21).
   * NO usa la copia del pizarrón: la lección v6.0 lo prohíbe.
   */
  const recuperarCuenta = useCallback(async (ticketId) => {
    const id = typeof ticketId === 'string' ? ticketId.trim() : '';
    if (!id) {
      return { outcome: 'error', reason: 'ticket_invalido', data: null };
    }
    return aOutcome(() => clienteRef.current.leerTicket(id));
  }, []);

  // Carga inicial y recarga al cambiar de terminal, modo o señal externa
  // (H1: dep primitiva). `refrescarSenal` permite al padre forzar un re-fetch
  // cuando envía una cuenta al pizarrón (FIX_PIZARRON_NO_REFRESCA).
  useEffect(() => {
    refrescar();
  }, [terminalId, todasLasTerminales, refrescar, refrescarSenal]);

  // FIX_PIZARRON_POLLING (8 Oct 2026) — Auto-refresco del pizarrón.
  //
  // POR QUÉ: el pizarrón solo descargaba la lista al montarse (y con la señal
  // externa). En el flujo real "envío la cuenta y LUEGO abro el pizarrón", el
  // montaje debía bastar; pero si el pizarrón es una pantalla SEPARADA (otro
  // monitor/ventana) o si la señal se pierde por un re-render, el post-it nunca
  // aparecía. Un corcho real debe reflejar el estado del servidor por sí solo.
  //
  // El sondeo es ligero (contrato 23, proyección escalar) y se detiene solo al
  // desmontar (cleanup). No pisa la carga inicial: el primer `refrescar()` ya
  // corrió arriba; el intervalo solo repite cada `INTERVALO_POLLING_MS`.
  useEffect(() => {
    const temporizador = setInterval(() => {
      refrescar();
    }, INTERVALO_POLLING_MS);
    return () => clearInterval(temporizador);
  }, [refrescar]);

  return { cuentas, cargando, error, refrescar, recuperarCuenta };
}

export default useOpenAccounts;
