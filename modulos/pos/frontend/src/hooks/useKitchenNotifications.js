/**
 * `useKitchenNotifications` -- MS-01 Paso 5.
 *
 * Detecta transiciones de kitchen_status -> LISTO en la cola de cocina
 * y dispara una notificacion temporal en el POS (callback `onListo`).
 *
 * Estrategia:
 *   - Compara el snapshot anterior de tickets con el nuevo despues de cada polling.
 *   - Un ticket "recien LISTO" es aquel cuyo kitchen_status cambia a LISTO
 *     entre dos snapshots consecutivos, o aparece directamente como LISTO.
 *   - El hook NO lleva su propio intervalo: recibe `tickets` del useColaCocina
 *     ya existente para evitar doble polling.
 *
 * Contratos: RN-MS01-05 (notificacion al POS <= 10 s desde LISTO).
 */

import { useEffect, useRef } from 'react';

export function useKitchenNotifications({ tickets, onListo, activo = true }) {
  // Snapshot de la ronda anterior: Map<id, kitchen_status>
  const prevStatusRef = useRef(new Map());
  // Set de IDs ya notificados para no repetir en la misma sesion.
  const notificadosRef = useRef(new Set());
  // Ref estable del callback para no re-ejecutar el efecto al cambiar.
  const onListoRef = useRef(onListo);
  useEffect(() => { onListoRef.current = onListo; }, [onListo]);

  useEffect(() => {
    if (!activo) return;

    const prevMap = prevStatusRef.current;
    const recienListos = [];

    if (Array.isArray(tickets)) {
      for (const ticket of tickets) {
        const estadoPrev = prevMap.get(ticket.id);
        const yaNotificado = notificadosRef.current.has(ticket.id);

        if (!yaNotificado && ticket.kitchen_status === 'LISTO') {
          // Notificar si: es nuevo (no estaba en snapshot) O si transiciono a LISTO.
          const esNuevo = estadoPrev === undefined;
          const transiciono = estadoPrev !== 'LISTO';
          if (esNuevo || transiciono) {
            recienListos.push(ticket);
            notificadosRef.current.add(ticket.id);
          }
        }
      }

      // Actualizar snapshot para la proxima ronda.
      prevStatusRef.current = new Map(tickets.map((t) => [t.id, t.kitchen_status]));
    }

    // Disparar callbacks.
    if (recienListos.length > 0 && typeof onListoRef.current === 'function') {
      recienListos.forEach((t) => onListoRef.current(t));
    }
  }, [tickets, activo]);

  const resetNotificados = () => {
    notificadosRef.current = new Set();
    prevStatusRef.current = new Map();
  };

  return { resetNotificados };
}
