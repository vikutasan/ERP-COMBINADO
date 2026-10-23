/**
 * useColaCocina — MS-01: Polling de la cola de cocina.
 *
 * - Llama a GET /orders/kitchen-queue cada 5 s (configurable).
 * - Expone `avanzarEstado(id, nuevoEstado)` para el PATCH.
 * - El canal es opcional; si se omite, trae todos los canales.
 *
 * Ciclo de vida de kitchen_status:
 *   RECIBIDO → EN_PREP → LISTO
 *
 * Contratos: 28 (GET) y 29 (PATCH).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useApi } from '../context/ApiContext.jsx';

const INTERVALO_MS = 5_000; // Polling cada 5 s (RN-MS01-01).

/**
 * @param {object} opts
 * @param {string|null} [opts.canal]        Filtra por canal (null = todos).
 * @param {boolean}     [opts.activo=true]  Pausa el polling si false.
 * @returns {{
 *   tickets: KitchenTicket[],
 *   cargando: boolean,
 *   error: string|null,
 *   avanzarEstado: (id: string, nuevoEstado: string) => Promise<void>,
 *   recargar: () => void,
 * }}
 */
export function useColaCocina({ canal = null, activo = true } = {}) {
  const api = useApi();
  const [tickets, setTickets] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  // Ref para no recrear el timer si las deps cambian durante el render.
  const canalRef = useRef(canal);
  canalRef.current = canal;

  const cargar = useCallback(async () => {
    if (!api) return;
    try {
      const data = await api.getColaCocina(canalRef.current);
      // getColaCocina devuelve { tickets, total } o lanza ApiError.
      setTickets(data?.tickets ?? []);
      setError(null);
    } catch (e) {
      setError(e?.message ?? 'Error al leer la cola de cocina');
    }
  }, [api]);

  // Carga inicial
  useEffect(() => {
    if (!activo) return;
    setCargando(true);
    cargar().finally(() => setCargando(false));
  }, [activo, cargar]);

  // Polling cada 5 s
  useEffect(() => {
    if (!activo) return;
    const id = setInterval(cargar, INTERVALO_MS);
    return () => clearInterval(id);
  }, [activo, cargar]);

  /** Avanza el estado de un kitchen_ticket (RECIBIDO → EN_PREP → LISTO). */
  const avanzarEstado = useCallback(
    async (kitchenTicketId, nuevoEstado) => {
      if (!api) return;
      try {
        const actualizado = await api.actualizarEstadoCocina(kitchenTicketId, nuevoEstado);
        // Actualización optimista: reemplaza en el array local.
        setTickets((prev) =>
          prev
            .map((t) =>
              t.id === kitchenTicketId
                ? { ...t, kitchen_status: actualizado.kitchen_status, listo_at: actualizado.listo_at }
                : t
            )
            // Remueve del array si ya llegó a LISTO (no debe mostrarse).
            .filter((t) => t.kitchen_status !== 'LISTO')
        );
        setError(null);
      } catch (e) {
        setError(e?.message ?? 'Error al actualizar estado');
        // Recarga para sincronizar.
        cargar();
      }
    },
    [api, cargar]
  );

  return { tickets, cargando, error, avanzarEstado, recargar: cargar };
}
