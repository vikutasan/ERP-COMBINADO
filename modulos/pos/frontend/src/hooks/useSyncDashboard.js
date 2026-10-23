/**
 * useSyncDashboard — Hook para el dashboard central multi-sucursal (MS-03).
 *
 * Consume:
 *   - getSyncDashboardSales() -> GET /sync/dashboard/sales
 *   - getSyncConflicts()      -> GET /sync/conflicts
 *   - resolveSyncConflict()   -> POST /sync/conflicts/{id}/resolve
 */

import { useState, useEffect, useCallback } from 'react';
import * as api from '../api/client.js';

export function useSyncDashboard(pollIntervalMs = 10000) {
  const [dashboard, setDashboard] = useState(null);
  const [conflictos, setConflictos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [resolviendoId, setResolviendoId] = useState(null);

  const cargarDatos = useCallback(async () => {
    try {
      const [dashData, confsData] = await Promise.all([
        api.getSyncDashboardSales(),
        api.getSyncConflicts(null, false),
      ]);
      setDashboard(dashData);
      setConflictos(confsData);
      setError(null);
    } catch (err) {
      setError(err.message ?? 'Error al cargar datos de sincronización');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargarDatos();
    if (pollIntervalMs > 0) {
      const timer = setInterval(cargarDatos, pollIntervalMs);
      return () => clearInterval(timer);
    }
  }, [cargarDatos, pollIntervalMs]);

  const resolverConflicto = useCallback(
    async (conflictId, notas) => {
      setResolviendoId(conflictId);
      try {
        await api.resolveSyncConflict(conflictId, notas);
        await cargarDatos();
      } catch (err) {
        setError(err.message ?? 'Error al resolver conflicto');
        throw err;
      } finally {
        setResolviendoId(null);
      }
    },
    [cargarDatos]
  );

  return {
    dashboard,
    conflictos,
    cargando,
    error,
    resolviendoId,
    recargar: cargarDatos,
    resolverConflicto,
  };
}
