/**
 * Tests de los hooks transversales — FASE 3.1.
 *
 * Cubre los 2 hooks que dependen de React/DOM:
 *   - useBeforeUnload  (H3 — sendBeacon al cerrar)
 *   - useNetworkHealth (v6.1 $453 — banner rojo + botón bloqueado)
 *
 * Se ejecuta con Vitest (jsdom): npm run test (en apps/pos)
 *
 * 29 Sep 2026.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBeforeUnload } from './useBeforeUnload.js';
import { useNetworkHealth } from './useNetworkHealth.js';

// ═══════════════════════════════════════════════════════════════════════════════
// useBeforeUnload — H3
// ═══════════════════════════════════════════════════════════════════════════════

describe('useBeforeUnload', () => {
  it('registra sendBeacon al disparar beforeunload', () => {
    const enviar = vi.fn(() => true);
    renderHook(() =>
      useBeforeUnload({
        url: '/pos/persist',
        obtenerPayload: () => ({ ticket: 'T1' }),
        enviar,
      })
    );

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar).toHaveBeenCalledWith('/pos/persist', JSON.stringify({ ticket: 'T1' }));
  });

  it('NO envía si obtenerPayload devuelve null', () => {
    const enviar = vi.fn(() => true);
    renderHook(() =>
      useBeforeUnload({ url: '/pos/persist', obtenerPayload: () => null, enviar })
    );

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    expect(enviar).not.toHaveBeenCalled();
  });

  it('limpia el listener al desmontar', () => {
    const enviar = vi.fn(() => true);
    const { unmount } = renderHook(() =>
      useBeforeUnload({ url: '/pos/persist', obtenerPayload: () => ({ a: 1 }), enviar })
    );

    unmount();

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    expect(enviar).not.toHaveBeenCalled();
  });

  it('no registra nada si activo=false', () => {
    const enviar = vi.fn(() => true);
    renderHook(() =>
      useBeforeUnload({
        url: '/pos/persist',
        obtenerPayload: () => ({ a: 1 }),
        enviar,
        activo: false,
      })
    );

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    expect(enviar).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// useNetworkHealth — v6.1 ($453)
// ═══════════════════════════════════════════════════════════════════════════════

describe('useNetworkHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('expone banner fijo + botón bloqueado cuando la red cae', async () => {
    const sonda = vi.fn(async () => false);
    const { result } = renderHook(() =>
      useNetworkHealth({ sonda, intervaloMs: 1000 })
    );

    // Deja resolver la sonda inicial (1er fallo → 'slow', aún en línea).
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.enLinea).toBe(true);

    // 2º fallo consecutivo → 'down' (anti-falso-positivo v6.1: FALLOS_PARA_DOWN = 2).
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(result.current.enLinea).toBe(false);
    expect(result.current.bannerVisible).toBe(true);
    expect(result.current.botonBloqueado).toBe(true);
  });

  it('no bloquea el botón cuando hay red', async () => {
    const sonda = vi.fn(async () => true);
    const { result } = renderHook(() =>
      useNetworkHealth({ sonda, intervaloMs: 1000 })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.enLinea).toBe(true);
    expect(result.current.bannerVisible).toBe(false);
    expect(result.current.botonBloqueado).toBe(false);
  });

  it('re-sondea según el intervalo', async () => {
    const sonda = vi.fn(async () => true);
    renderHook(() => useNetworkHealth({ sonda, intervaloMs: 1000 }));

    await act(async () => {
      await Promise.resolve();
    });
    const llamadasIniciales = sonda.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(sonda.mock.calls.length).toBeGreaterThan(llamadasIniciales);
  });

  it('trata una excepción de la sonda como red caída', async () => {
    const sonda = vi.fn(async () => {
      throw new Error('timeout');
    });
    const { result } = renderHook(() =>
      useNetworkHealth({ sonda, intervaloMs: 1000 })
    );

    // 1er fallo (excepción) → 'slow', aún en línea.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.enLinea).toBe(true);

    // 2º fallo consecutivo → 'down' (anti-falso-positivo v6.1: FALLOS_PARA_DOWN = 2).
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(result.current.enLinea).toBe(false);
    expect(result.current.botonBloqueado).toBe(true);
  });
});
