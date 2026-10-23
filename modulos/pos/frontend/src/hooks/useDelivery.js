/**
 * useDelivery -- MS-02: Polling del modulo de reparto.
 *
 * - Llama a GET /delivery cada 5 s para obtener asignaciones activas.
 * - Expone `asignarRepartidor(orderId, nombre, telefono)` para POST.
 * - Expone `avanzarEstado(assignmentId, estado, notas)` para PATCH.
 *
 * Ciclo de vida de delivery_status:
 *   ASIGNADO -> EN_CAMINO -> ENTREGADO | NO_ENTREGADO
 *
 * Contratos: 31 (GET), 32 (POST /assign), 33 (PATCH /{id}).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useApi } from '../context/ApiContext.jsx';

const INTERVALO_MS = 5_000;

/**
 * @param {object} opts
 * @param {string|null} [opts.estado]   Filtra por estado (null = activos).
 * @param {boolean}     [opts.activo]   Pausa el polling si false.
 */
export function useDelivery({ estado = null, activo = true } = {}) {
  const api = useApi();
  const [asignaciones, setAsignaciones] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  const cargar = useCallback(async () => {
    if (!api) return;
    try {
      const data = await api.getDeliveryQueue(estadoRef.current);
      setAsignaciones(data?.asignaciones ?? []);
      setError(null);
    } catch (e) {
      setError(e?.message ?? 'Error al leer el modulo de reparto');
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

  /** Asigna un repartidor a un pedido DOMICILIO. */
  const asignarRepartidor = useCallback(
    async (orderId, repartidorNombre, repartidorTelefono = null, notas = null) => {
      if (!api) return { ok: false, error: 'API no disponible' };
      try {
        const resultado = await api.asignarRepartidor({
          order_id: orderId,
          repartidor_nombre: repartidorNombre,
          repartidor_telefono: repartidorTelefono,
          notas,
        });
        setAsignaciones((prev) => [...prev, resultado]);
        setError(null);
        return { ok: true, data: resultado };
      } catch (e) {
        const msg = e?.message ?? 'Error al asignar repartidor';
        setError(msg);
        return { ok: false, error: msg };
      }
    },
    [api]
  );

  /** Avanza el estado de una asignacion. */
  const avanzarEstado = useCallback(
    async (assignmentId, nuevoEstado, notas = null) => {
      if (!api) return { ok: false, error: 'API no disponible' };
      try {
        const actualizado = await api.avanzarEstadoReparto(assignmentId, nuevoEstado, notas);
        setAsignaciones((prev) =>
          nuevoEstado === 'ENTREGADO' || nuevoEstado === 'NO_ENTREGADO'
            ? prev.filter((a) => a.id !== assignmentId) // Terminales desaparecen de activos
            : prev.map((a) => (a.id === assignmentId ? { ...a, ...actualizado } : a))
        );
        setError(null);
        return { ok: true, data: actualizado };
      } catch (e) {
        const msg = e?.message ?? 'Error al avanzar estado';
        setError(msg);
        cargar(); // Resincroniza
        return { ok: false, error: msg };
      }
    },
    [api, cargar]
  );

  return { asignaciones, cargando, error, asignarRepartidor, avanzarEstado, recargar: cargar };
}
