/**
 * useKitchenNotifications.ms01.test.jsx -- MS-01 Paso 5
 *
 * Verifica que el hook detecta correctamente transiciones a LISTO
 * y dispara el callback onListo sin repetir notificaciones.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKitchenNotifications } from './useKitchenNotifications.js';

const TICKET_RECIBIDO = { id: 'aaa', kitchen_status: 'RECIBIDO', mesa: '5', listo_at: null };
const TICKET_EN_PREP  = { id: 'bbb', kitchen_status: 'EN_PREP',  mesa: '3', listo_at: null };
const TICKET_LISTO    = { id: 'ccc', kitchen_status: 'LISTO',    mesa: '7', listo_at: '2026-10-21T20:00:00Z' };

describe('useKitchenNotifications', () => {
  let onListo;

  beforeEach(() => {
    onListo = vi.fn();
  });

  it('no llama onListo si no hay tickets LISTO', () => {
    renderHook(() =>
      useKitchenNotifications({
        tickets: [TICKET_RECIBIDO, TICKET_EN_PREP],
        onListo,
        activo: true,
      })
    );
    expect(onListo).not.toHaveBeenCalled();
  });

  it('llama onListo cuando aparece un ticket LISTO por primera vez', () => {
    renderHook(() =>
      useKitchenNotifications({
        tickets: [TICKET_LISTO],
        onListo,
        activo: true,
      })
    );
    expect(onListo).toHaveBeenCalledTimes(1);
    expect(onListo).toHaveBeenCalledWith(TICKET_LISTO);
  });

  it('no repite la notificacion en el siguiente polling si el ticket ya fue notificado', () => {
    const { rerender } = renderHook(
      ({ tickets }) =>
        useKitchenNotifications({ tickets, onListo, activo: true }),
      { initialProps: { tickets: [TICKET_LISTO] } }
    );
    expect(onListo).toHaveBeenCalledTimes(1);

    // Segundo polling: mismo ticket LISTO
    rerender({ tickets: [TICKET_LISTO] });
    expect(onListo).toHaveBeenCalledTimes(1); // no debe repetir
  });

  it('detecta transicion de EN_PREP a LISTO entre dos snapshots', () => {
    const ticketEnPrep = { id: 'ddd', kitchen_status: 'EN_PREP', mesa: '2', listo_at: null };
    const ticketListo  = { id: 'ddd', kitchen_status: 'LISTO',   mesa: '2', listo_at: '2026-10-21T20:01:00Z' };

    const { rerender } = renderHook(
      ({ tickets }) =>
        useKitchenNotifications({ tickets, onListo, activo: true }),
      { initialProps: { tickets: [ticketEnPrep] } }
    );
    expect(onListo).not.toHaveBeenCalled();

    rerender({ tickets: [ticketListo] });
    expect(onListo).toHaveBeenCalledTimes(1);
    expect(onListo).toHaveBeenCalledWith(ticketListo);
  });

  it('llama onListo por cada ticket LISTO cuando llegan varios a la vez', () => {
    const t1 = { id: 'e1', kitchen_status: 'LISTO', mesa: '1', listo_at: '2026-10-21T20:00:00Z' };
    const t2 = { id: 'e2', kitchen_status: 'LISTO', mesa: '2', listo_at: '2026-10-21T20:00:01Z' };

    renderHook(() =>
      useKitchenNotifications({ tickets: [t1, t2], onListo, activo: true })
    );
    expect(onListo).toHaveBeenCalledTimes(2);
  });

  it('no llama onListo si activo=false', () => {
    renderHook(() =>
      useKitchenNotifications({
        tickets: [TICKET_LISTO],
        onListo,
        activo: false,
      })
    );
    expect(onListo).not.toHaveBeenCalled();
  });

  it('resetNotificados permite volver a notificar el mismo ticket', () => {
    const { result, rerender } = renderHook(
      ({ tickets }) =>
        useKitchenNotifications({ tickets, onListo, activo: true }),
      { initialProps: { tickets: [TICKET_LISTO] } }
    );
    expect(onListo).toHaveBeenCalledTimes(1);

    result.current.resetNotificados();

    // Despues del reset, el mismo ticket debe notificarse de nuevo.
    rerender({ tickets: [TICKET_LISTO] });
    expect(onListo).toHaveBeenCalledTimes(2);
  });

  it('no falla si tickets es un array vacio', () => {
    expect(() => {
      renderHook(() =>
        useKitchenNotifications({ tickets: [], onListo, activo: true })
      );
    }).not.toThrow();
    expect(onListo).not.toHaveBeenCalled();
  });

  it('no falla si onListo no es funcion', () => {
    expect(() => {
      renderHook(() =>
        useKitchenNotifications({ tickets: [TICKET_LISTO], onListo: null, activo: true })
      );
    }).not.toThrow();
  });
});
