/**
 * Puerta de BUG-01 — `selectTerminal` abre la sesión de terminal.
 *
 * CONTEXTO — por qué existe esta puerta
 * ─────────────────────────────────────
 * El viejo POS abre la `TerminalSession` al seleccionar la terminal. El nuevo
 * POS solo tomaba el candado, así que cualquier terminal sin sesión previa
 * fallaba con RN-24 al primer ticket ("La sesión de la terminal no está
 * activa"). La corrección (Opción A) llama a `abrirSesionTerminal` tras el lock.
 *
 * Criterios verificados:
 *  1. Tras un lock exitoso, se llama a `abrirSesionTerminal` con el terminal_id.
 *  2. Si el lock falla, NO se abre la sesión.
 *  3. Si abrir la sesión falla, `selectTerminal` reporta el error (no lo oculta).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTerminals } from './useTerminals.js';

// El servicio se simula: la puerta prueba el hook, no la red.
vi.mock('../services/terminalService.js', () => ({
  fetchTerminalStatuses: vi.fn(async () => ({})),
  lockTerminal: vi.fn(async () => ({ success: true })),
  unlockTerminal: vi.fn(async () => ({ success: true })),
  fetchTerminalConfig: vi.fn(async () => [
    { id: 'TERM-01', name: 'Terminal 1', icon: '🖥️' },
    { id: 'TERM-04', name: 'Terminal 4', icon: '🖥️' },
  ]),
  saveTerminalConfig: vi.fn(async () => ({ success: true })),
  abrirSesionTerminal: vi.fn(async (terminalId) => ({
    id: 's-1',
    terminal_id: terminalId,
    is_active: true,
  })),
}));

import {
  lockTerminal,
  abrirSesionTerminal,
} from '../services/terminalService.js';

const USUARIO = { id: 'u-1', name: 'Ana', role: 'ADMIN' };

async function montar() {
  const vista = renderHook(() => useTerminals(USUARIO));
  await waitFor(() => expect(vista.result.current.loading).toBe(false));
  return vista;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  lockTerminal.mockResolvedValue({ success: true });
  abrirSesionTerminal.mockImplementation(async (terminalId) => ({
    id: 's-1',
    terminal_id: terminalId,
    is_active: true,
  }));
});

describe('BUG-01 — selectTerminal abre la sesión de terminal', () => {
  it('criterio 1: tras el lock exitoso, abre la sesión con el terminal_id', async () => {
    const { result } = await montar();

    await act(async () => {
      await result.current.selectTerminal('TERM-04');
    });

    expect(lockTerminal).toHaveBeenCalledWith('TERM-04', 'u-1');
    expect(abrirSesionTerminal).toHaveBeenCalledWith('TERM-04');
  });

  it('criterio 2: si el lock falla, NO abre la sesión', async () => {
    lockTerminal.mockResolvedValue({ success: false, message: 'Ocupada' });
    const { result } = await montar();

    await act(async () => {
      await result.current.selectTerminal('TERM-04');
    });

    expect(abrirSesionTerminal).not.toHaveBeenCalled();
  });

  it('criterio 3: si abrir la sesión falla, selectTerminal reporta el error', async () => {
    abrirSesionTerminal.mockRejectedValue(new Error('Abrir sesión: 500'));
    const { result } = await montar();

    let salida;
    await act(async () => {
      salida = await result.current.selectTerminal('TERM-04');
    });

    expect(salida.success).toBe(false);
    expect(salida.message).toContain('500');
  });
});
