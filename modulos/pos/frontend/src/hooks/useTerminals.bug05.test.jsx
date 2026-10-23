/**
 * Puerta de BUG-05 — El id de una terminal nueva habla el vocabulario canónico.
 *
 * Contexto (10 Oct 2026): el usuario reportó que los cambios del Gestor de
 * Cajas no se persistían y que "Guardar cambios" parecía no reaccionar. La
 * causa raíz era doble:
 *   1. `addTerminal` generaba ids `T1`, `T2`… en vez de `TERM-0N`, así que al
 *      guardar se persistían ids que ninguna sesión/ticket reconocía y
 *      `terminal_config.json` quedaba corrupto.
 *   2. `handleSave` descartaba el `detail` del backend, así que un fallo de
 *      validación parecía un botón muerto.
 *
 * Esta puerta cubre (1) a nivel de hook. La (2) se cubre en
 * `TerminalSelector.bug05.test.jsx`.
 *
 * @see FICHA_FIX_BUG05_CAJA_NO_ES_TERMINAL.md
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
    { id: 'TERM-02', name: 'Terminal 2', icon: '🖥️' },
    { id: 'TERM-03', name: 'Terminal 3', icon: '🖥️' },
  ]),
  saveTerminalConfig: vi.fn(async () => ({ success: true })),
}));

const USUARIO = { id: 'u-1', name: 'Ana', role: 'ADMIN' };

async function montar() {
  const vista = renderHook(() => useTerminals(USUARIO));
  await waitFor(() => expect(vista.result.current.loading).toBe(false));
  return vista;
}

beforeEach(() => {
  localStorage.clear();
});

describe('BUG-05 — addTerminal genera ids TERM-0N', () => {
  it('el id nuevo continúa la serie TERM-0N (no T1)', async () => {
    const { result } = await montar();

    act(() => result.current.addTerminal('end'));

    const ids = result.current.terminals.map(t => t.id);
    expect(ids).toEqual(['TERM-01', 'TERM-02', 'TERM-03', 'TERM-04']);
    expect(ids.every(id => /^TERM-\d{2}$/.test(id))).toBe(true);
  });

  it('el nombre de la terminal nueva sigue el número correlativo', async () => {
    const { result } = await montar();

    act(() => result.current.addTerminal('end'));

    const nueva = result.current.terminals[result.current.terminals.length - 1];
    expect(nueva.name).toBe('Terminal 4');
  });

  it('ignora ids legados que no siguen el patrón TERM-0N al calcular el siguiente', async () => {
    const { result } = await montar();

    // Simula una config ya contaminada por el bug viejo (`T1`).
    act(() => result.current.updateTerminal('TERM-03', { id: 'T1' }));
    act(() => result.current.addTerminal('end'));

    const ids = result.current.terminals.map(t => t.id);
    // El siguiente número se calcula sobre los TERM-0N válidos (01, 02) → 03.
    expect(ids).toContain('TERM-03');
    expect(ids.filter(id => /^TERM-\d{2}$/.test(id))).toEqual([
      'TERM-01',
      'TERM-02',
      'TERM-03',
    ]);
  });

  it('addTerminal("start") también genera un id TERM-0N', async () => {
    const { result } = await montar();

    act(() => result.current.addTerminal('start'));

    expect(result.current.terminals[0].id).toBe('TERM-04');
  });
});
