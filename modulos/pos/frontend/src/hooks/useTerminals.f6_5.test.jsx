/**
 * Puerta de FASE 6.5.0 — Selector de orden de terminales (hook).
 *
 * Verifica los 8 criterios del plan F6.5 §5.1:
 *  1. Valor inicial 'izq-der' con localStorage vacío.
 *  2. terminalesDesplegadas === terminals con orden 'izq-der'.
 *  3. terminalesDesplegadas es la inversa con orden 'der-izq'.
 *  4. invertirOrden() alterna entre ambos órdenes.
 *  5. terminals NO se muta al invertir el orden.
 *  6. La preferencia se persiste en localStorage (clave pos.ordenTerminales).
 *  7. Un valor inválido en localStorage cae al fallback 'izq-der'.
 *  8. addTerminal('end') añade al final del array CANÓNICO, no del visual.
 *
 * @see PLAN_DE_ABORDAJE_FASE_6_5_ORDEN_TERMINALES.md §5.1
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useTerminals,
  leerOrdenGuardado,
  CLAVE_ORDEN_TERMINALES,
  ORDEN_IZQ_DER,
  ORDEN_DER_IZQ,
} from './useTerminals.js';

// El servicio se simula: la puerta prueba el hook, no la red.
vi.mock('../services/terminalService.js', () => ({
  fetchTerminalStatuses: vi.fn(async () => ({})),
  lockTerminal: vi.fn(async () => ({ success: true })),
  unlockTerminal: vi.fn(async () => ({ success: true })),
  // F7.7d — El vocabulario de ids es `TERM-0N` (el mismo del API y la semilla).
  fetchTerminalConfig: vi.fn(async () => [
    { id: 'TERM-01', name: 'Terminal 1', icon: '🖥️' },
    { id: 'TERM-02', name: 'Terminal 2', icon: '🖥️' },
    { id: 'TERM-03', name: 'Terminal 3', icon: '🖥️' },
  ]),
  saveTerminalConfig: vi.fn(async () => ({ success: true })),
}));

const USUARIO = { id: 'u-1', name: 'Ana', role: 'ADMIN' };

/** Monta el hook y espera a que termine la carga inicial. */
async function montar() {
  const vista = renderHook(() => useTerminals(USUARIO));
  await waitFor(() => expect(vista.result.current.loading).toBe(false));
  return vista;
}

beforeEach(() => {
  localStorage.clear();
});

describe('F6.5.0 — Orden de terminales (hook)', () => {
  it('criterio 1: el orden inicial es izq-der cuando localStorage está vacío', async () => {
    const { result } = await montar();
    expect(result.current.ordenTerminales).toBe(ORDEN_IZQ_DER);
  });

  it('criterio 2: terminalesDesplegadas es igual a terminals con orden izq-der', async () => {
    const { result } = await montar();
    expect(result.current.ordenTerminales).toBe(ORDEN_IZQ_DER);
    expect(result.current.terminalesDesplegadas).toEqual(result.current.terminals);
  });

  it('criterio 3: terminalesDesplegadas es la inversa con orden der-izq', async () => {
    const { result } = await montar();
    const canonico = result.current.terminals.map(t => t.id);

    act(() => result.current.invertirOrden());

    expect(result.current.ordenTerminales).toBe(ORDEN_DER_IZQ);
    expect(result.current.terminalesDesplegadas.map(t => t.id)).toEqual([...canonico].reverse());
  });

  it('criterio 4: invertirOrden() alterna entre izq-der y der-izq', async () => {
    const { result } = await montar();

    act(() => result.current.invertirOrden());
    expect(result.current.ordenTerminales).toBe(ORDEN_DER_IZQ);

    act(() => result.current.invertirOrden());
    expect(result.current.ordenTerminales).toBe(ORDEN_IZQ_DER);
  });

  it('criterio 5: terminals NO se muta al invertir el orden', async () => {
    const { result } = await montar();
    const canonicoAntes = result.current.terminals.map(t => t.id);

    act(() => result.current.invertirOrden());

    // El array canónico conserva su orden original.
    expect(result.current.terminals.map(t => t.id)).toEqual(canonicoAntes);
    // Y el visual sí está invertido.
    expect(result.current.terminalesDesplegadas.map(t => t.id)).toEqual([...canonicoAntes].reverse());
  });

  it('criterio 6: la preferencia se persiste en localStorage', async () => {
    const { result } = await montar();

    act(() => result.current.invertirOrden());

    await waitFor(() => {
      expect(localStorage.getItem(CLAVE_ORDEN_TERMINALES)).toBe(ORDEN_DER_IZQ);
    });
  });

  it('criterio 7: un valor inválido en localStorage cae al fallback izq-der', async () => {
    localStorage.setItem(CLAVE_ORDEN_TERMINALES, 'valor-basura');
    expect(leerOrdenGuardado()).toBe(ORDEN_IZQ_DER);

    const { result } = await montar();
    expect(result.current.ordenTerminales).toBe(ORDEN_IZQ_DER);
  });

  it('criterio 8: addTerminal("end") añade al final del array CANÓNICO', async () => {
    const { result } = await montar();

    // Invertimos el orden visual: el canónico NO debe cambiar.
    act(() => result.current.invertirOrden());
    expect(result.current.ordenTerminales).toBe(ORDEN_DER_IZQ);

    const canonicoAntes = result.current.terminals.map(t => t.id);

    act(() => result.current.addTerminal('end'));

    const canonicoDespues = result.current.terminals.map(t => t.id);
    // El nuevo id va al FINAL del canónico (no al principio).
    expect(canonicoDespues.slice(0, canonicoAntes.length)).toEqual(canonicoAntes);
    expect(canonicoDespues.length).toBe(canonicoAntes.length + 1);
    // BUG-05 — El id nuevo habla el vocabulario canónico `TERM-0N` (no `T1`).
    expect(canonicoDespues[canonicoDespues.length - 1]).toBe('TERM-04');
    // Y visualmente aparece al principio (porque el orden está invertido).
    expect(result.current.terminalesDesplegadas[0].id).toBe(canonicoDespues[canonicoDespues.length - 1]);
  });
});
