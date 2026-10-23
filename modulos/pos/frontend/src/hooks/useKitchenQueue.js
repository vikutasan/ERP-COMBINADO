/**
 * `useKitchenQueue` — Hook de la cola de cocina (MS-01).
 *
 * Hace polling al endpoint `GET /orders/kitchen-queue` cada 5 segundos.
 * Expone la cola actual y la función para avanzar el estado de un ticket.
 *
 * Estados válidos: RECIBIDO → EN_PREP → LISTO
 *
 * @param {object} opts
 * @param {string} [opts.canal]       - Filtrar por canal (PANADERIA, HELADERIA, etc.)
 * @param {number} [opts.intervalo]   - Intervalo de polling en ms (default: 5000)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CONFIG } from '../../../../shared/config.js';

const BASE = CONFIG.API_BASE_URL;

export function useKitchenQueue({ canal = null, intervalo = 5000 } = {}) {
  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [actualizando, setActualizando] = useState(null); // id del ticket que se está actualizando

  const abortRef = useRef(null);

  const leerCola = useCallback(async () => {
    // Cancelar fetch anterior si aún está en vuelo.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const params = new URLSearchParams();
      if (canal) params.set('canal', canal);

      const resp = await fetch(
        `${BASE}/orders/kitchen-queue${params.size ? '?' + params : ''}`,
        { signal: controller.signal },
      );

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setTickets(data.tickets ?? []);
      setTotal(data.total ?? 0);
      setError(null);
    } catch (err) {
      if (err.name === 'AbortError') return; // Fetch cancelado deliberadamente — no es error.
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [canal]);

  // Polling inicial + cada `intervalo` ms.
  useEffect(() => {
    leerCola();
    const id = setInterval(leerCola, intervalo);
    return () => {
      clearInterval(id);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [leerCola, intervalo]);

  /**
   * Avanza el estado de un ticket en la cola de cocina.
   * @param {string} kitchenTicketId - UUID del kitchen_ticket
   * @param {'EN_PREP'|'LISTO'} nuevoEstado
   */
  const avanzarEstado = useCallback(async (kitchenTicketId, nuevoEstado) => {
    setActualizando(kitchenTicketId);
    try {
      const resp = await fetch(
        `${BASE}/orders/kitchen-queue/${kitchenTicketId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kitchen_status: nuevoEstado }),
        },
      );
      if (!resp.ok) {
        const detail = await resp.json().catch(() => ({}));
        throw new Error(detail?.detail ?? `HTTP ${resp.status}`);
      }
      // Actualizar optimísticamente en el estado local para respuesta inmediata.
      const actualizado = await resp.json();
      setTickets((prev) =>
        nuevoEstado === 'LISTO'
          ? prev.filter((t) => t.id !== kitchenTicketId) // LISTO desaparece de la cola
          : prev.map((t) =>
              t.id === kitchenTicketId
                ? { ...t, kitchen_status: actualizado.kitchen_status, updated_at: actualizado.updated_at }
                : t,
            ),
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      setActualizando(null);
    }
  }, []);

  /**
   * Encola un ticket en cocina desde el POS.
   * @param {string} ticketId - UUID del ticket
   */
  const enqueueTicket = useCallback(async (ticketId) => {
    try {
      const resp = await fetch(
        `${BASE}/orders/kitchen-queue?ticket_id=${ticketId}`,
        { method: 'POST' },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await leerCola(); // Refresca la cola inmediatamente.
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, [leerCola]);

  return {
    tickets,
    total,
    cargando,
    error,
    actualizando,
    avanzarEstado,
    enqueueTicket,
    refrescar: leerCola,
  };
}
