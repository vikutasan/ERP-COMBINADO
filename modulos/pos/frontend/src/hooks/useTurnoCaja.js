/**
 * useTurnoCaja — consulta y refresca el turno de caja activo.
 *
 * Extraído de `RetailVisionPOS.jsx` (FS2-03). Antes `refrescarTurnoCaja`
 * era un `useCallback` suelto en el componente orquestador, lo que hacía
 * difícil testear la lógica de turno de forma aislada.
 *
 * F4.5.3 — Se consulta al montar y cada vez que el gestor de caja se cierra
 * (por si el operador abrió o cerró el turno). Si el API no responde, se
 * deja en `null`: la guarda es un AVISO, no un bloqueo duro (el backend
 * sigue siendo la autoridad final vía RN-49).
 *
 * @param {object} opciones
 * @param {string} opciones.terminalId - ID de la terminal activa.
 * @param {object} [opciones.servicio] - Servicio de caja (inyectable en tests).
 * @returns {{ turnoCaja, setTurnoCaja, refrescarTurnoCaja }}
 */

import { useState, useEffect, useCallback } from 'react';
import * as cajaDefault from '../services/cashService.js';

export function useTurnoCaja({ terminalId, servicio } = {}) {
  const caja = servicio ?? cajaDefault;
  const [turnoCaja, setTurnoCaja] = useState(null);

  const refrescarTurnoCaja = useCallback(async () => {
    const r = await caja.obtenerTurnoActivo(terminalId);
    if (r.outcome === 'ok') {
      setTurnoCaja(r.data && r.data.cash_session_id ? r.data : null);
    }
  }, [caja, terminalId]);

  useEffect(() => {
    refrescarTurnoCaja();
  }, [refrescarTurnoCaja]);

  return { turnoCaja, setTurnoCaja, refrescarTurnoCaja };
}
