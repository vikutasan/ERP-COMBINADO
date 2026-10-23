/**
 * FIX "el orden no se persiste" (10 Oct 2026) — el orden izq-der/der-izq vive
 * en el BACKEND (`terminal_config.json`), no solo en el `localStorage`.
 *
 * @paridad: hooks/useTerminals.orden_backend.test.jsx
 * @operacion: El orden de terminales (izq-der / der-izq) persiste en el backend
 *
 * Antes: la preferencia se guardaba únicamente en `localStorage`, así que se
 * perdía al cambiar de navegador o de máquina. El usuario tenía que
 * reconfigurarla cada vez que entraba.
 *
 * Ahora: el backend es la fuente de verdad. Al montar, el hook lee `orden` de
 * `GET /pos/terminals/config` y lo aplica (sobreescribiendo la caché local).
 * Al invertir el orden, el hook lo persiste con `POST /pos/terminals/config`.
 * `localStorage` queda como caché local (respuesta instantánea al montar).
 *
 * @see routers/terminals.py (GET/POST /config)
 * @see services/terminalService.js (fetchTerminalConfig / saveTerminalConfig)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useTerminals,
  CLAVE_ORDEN_TERMINALES,
  ORDEN_IZQ_DER,
  ORDEN_DER_IZQ,
} from './useTerminals.js';

// El servicio se simula: la puerta prueba el hook, no la red.
vi.mock('../services/terminalService.js', () => ({
  fetchTerminalStatuses: vi.fn(async () => ({})),
  lockTerminal: vi.fn(async () => ({ success: true })),
  unlockTerminal: vi.fn(async () => ({ success: true })),
  // El backend devuelve `{ terminals, orden }` (formato nuevo).
  fetchTerminalConfig: vi.fn(async () => ({
    terminals: [
      { id: 'TERM-01', name: 'Terminal 1', icon: '🖥️' },
      { id: 'TERM-02', name: 'Terminal 2', icon: '🖥️' },
      { id: 'TERM-03', name: 'Terminal 3', icon: '🖥️' },
    ],
    orden: 'izq-der',
  })),
  saveTerminalConfig: vi.fn(async () => ({ success: true })),
}));

import { fetchTerminalConfig, saveTerminalConfig } from '../services/terminalService.js';

const USUARIO = { id: 'u-1', name: 'Ana', role: 'ADMIN' };

/** Monta el hook y espera a que termine la carga inicial. */
async function montar() {
  const vista = renderHook(() => useTerminals(USUARIO));
  await waitFor(() => expect(vista.result.current.loading).toBe(false));
  return vista;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // Restaurar el comportamiento por defecto del mock tras `clearAllMocks`.
  fetchTerminalConfig.mockResolvedValue({
    terminals: [
      { id: 'TERM-01', name: 'Terminal 1', icon: '🖥️' },
      { id: 'TERM-02', name: 'Terminal 2', icon: '🖥️' },
      { id: 'TERM-03', name: 'Terminal 3', icon: '🖥️' },
    ],
    orden: 'izq-der',
  });
  saveTerminalConfig.mockResolvedValue({ success: true });
});

describe('Orden de terminales persistido en el backend', () => {
  it('al montar, adopta el orden que devuelve el backend', async () => {
    fetchTerminalConfig.mockResolvedValue({
      terminals: [{ id: 'TERM-01', name: 'Terminal 1', icon: '🖥️' }],
      orden: 'der-izq',
    });

    const { result } = await montar();

    expect(result.current.ordenTerminales).toBe(ORDEN_DER_IZQ);
  });

  it('el orden del backend sobreescribe la caché local de localStorage', async () => {
    // La caché local dice izq-der, pero el backend dice der-izq: manda el backend.
    localStorage.setItem(CLAVE_ORDEN_TERMINALES, ORDEN_IZQ_DER);
    fetchTerminalConfig.mockResolvedValue({
      terminals: [{ id: 'TERM-01', name: 'Terminal 1', icon: '🖥️' }],
      orden: 'der-izq',
    });

    const { result } = await montar();

    expect(result.current.ordenTerminales).toBe(ORDEN_DER_IZQ);
  });

  it('invertirOrden() persiste el nuevo orden en el backend', async () => {
    const { result } = await montar();
    expect(result.current.ordenTerminales).toBe(ORDEN_IZQ_DER);

    act(() => result.current.invertirOrden());

    await waitFor(() => {
      expect(saveTerminalConfig).toHaveBeenCalledWith(
        expect.any(Array),
        ORDEN_DER_IZQ
      );
    });
    expect(result.current.ordenTerminales).toBe(ORDEN_DER_IZQ);
  });

  it('saveConfig() envía la lista JUNTO con el orden vigente', async () => {
    const { result } = await montar();

    act(() => result.current.invertirOrden());
    await waitFor(() => expect(result.current.ordenTerminales).toBe(ORDEN_DER_IZQ));

    await act(async () => {
      await result.current.saveConfig();
    });

    // La última llamada de guardado lleva el orden invertido.
    expect(saveTerminalConfig).toHaveBeenLastCalledWith(
      expect.any(Array),
      ORDEN_DER_IZQ
    );
  });

  it('tolera un backend viejo que devuelve solo la lista (sin orden)', async () => {
    // Formato legado: array suelto. El hook no debe romper ni forzar un orden.
    fetchTerminalConfig.mockResolvedValue([
      { id: 'TERM-01', name: 'Terminal 1', icon: '🖥️' },
    ]);

    const { result } = await montar();

    // Sin orden en la respuesta, se conserva el default local (izq-der).
    expect(result.current.ordenTerminales).toBe(ORDEN_IZQ_DER);
    expect(result.current.terminals.map(t => t.id)).toEqual(['TERM-01']);
  });
});
