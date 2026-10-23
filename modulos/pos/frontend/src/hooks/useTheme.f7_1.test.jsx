/**
 * Puerta de FASE 7.1 — Cableado del motor de temas (useTheme).
 *
 * Verifica los criterios 1–4 y 9 del plan §6.4:
 *   1. `useTheme` llama a `resolverTema` con `TEMA_DEL_MODULO`.
 *   2. `useTheme` llama a `aplicarTema`.
 *   3. La elección se persiste en `localStorage` (clave `pos.tema`).
 *   4. Al montar, el POS aplica el tema guardado (o el default).
 *   9. Un tema inválido en `localStorage` cae al default (no rompe).
 *
 * El motor se MOCKEA: esta puerta prueba el CABLEADO, no el motor (que ya
 * tiene su propia prueba en `packages/theme-engine/theme-engine.test.js`).
 *
 * @see PLAN_DE_ABORDAJE_FASE_7_POR_PARTES.md §6.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ─── Mock del motor compartido ────────────────────────────────────────────────
// Se intercepta ANTES de importar el hook para observar las llamadas.
const motor = vi.hoisted(() => ({
  aplicarTema: vi.fn(),
  resolverTema: vi.fn(async () => ({ acento: '193 215 46', fondoProfundo: '13 13 13' })),
}));

vi.mock('@nuevo-pos/theme-engine', () => ({
  aplicarTema: motor.aplicarTema,
  resolverTema: motor.resolverTema,
}));

import { useTheme, leerTemaGuardado, CLAVE_TEMA } from './useTheme.js';
import { TEMA_DEL_MODULO } from '../theme/index.js';

beforeEach(() => {
  localStorage.clear();
  motor.aplicarTema.mockClear();
  motor.resolverTema.mockClear();
  motor.resolverTema.mockResolvedValue({ acento: '193 215 46', fondoProfundo: '13 13 13' });
});

afterEach(() => {
  localStorage.clear();
});

describe('F7.1 — useTheme (cableado del motor de temas)', () => {
  // ── Criterio 1 ──────────────────────────────────────────────────────────────
  it('criterio 1: llama a resolverTema con TEMA_DEL_MODULO', async () => {
    renderHook(() => useTheme());

    await waitFor(() => expect(motor.resolverTema).toHaveBeenCalled());

    const [modulo, eleccion, identidad] = motor.resolverTema.mock.calls[0];
    expect(modulo).toBe(TEMA_DEL_MODULO);
    expect(modulo.modulo).toBe('pos');
    // Sin elección guardada, la elección es el default del módulo.
    expect(eleccion).toBe(TEMA_DEL_MODULO.default);
    // Vista General aún no existe (DT-06): identidad = null.
    expect(identidad).toBeNull();
  });

  // ── Criterio 2 ──────────────────────────────────────────────────────────────
  it('criterio 2: llama a aplicarTema con el tema resuelto', async () => {
    const resuelto = { acento: '240 165 0', fondoProfundo: '13 27 42' };
    motor.resolverTema.mockResolvedValue(resuelto);

    renderHook(() => useTheme());

    await waitFor(() => expect(motor.aplicarTema).toHaveBeenCalled());
    expect(motor.aplicarTema.mock.calls[0][0]).toBe(resuelto);
  });

  it('criterio 2: aplica al contenedor indicado, no siempre a :root', async () => {
    const contenedor = document.createElement('div');

    renderHook(() => useTheme({ contenedor }));

    await waitFor(() => expect(motor.aplicarTema).toHaveBeenCalled());
    expect(motor.aplicarTema.mock.calls[0][1]).toBe(contenedor);
  });

  // ── Criterio 3 ──────────────────────────────────────────────────────────────
  it('criterio 3: cambiarTema persiste la elección en localStorage', async () => {
    const { result } = renderHook(() => useTheme());
    await waitFor(() => expect(result.current.cargando).toBe(false));

    act(() => {
      result.current.cambiarTema('nocturno');
    });

    expect(localStorage.getItem(CLAVE_TEMA)).toBe('nocturno');
    expect(CLAVE_TEMA).toBe('pos.tema');
    expect(result.current.tema).toBe('nocturno');
  });

  it('criterio 3: cambiarTema a un tema NO permitido no persiste ni cambia', async () => {
    const { result } = renderHook(() => useTheme());
    await waitFor(() => expect(result.current.cargando).toBe(false));

    act(() => {
      result.current.cambiarTema('tema-inexistente');
    });

    expect(localStorage.getItem(CLAVE_TEMA)).toBeNull();
    expect(result.current.tema).toBe(TEMA_DEL_MODULO.default);
  });

  // ── Criterio 4 ──────────────────────────────────────────────────────────────
  it('criterio 4: al montar aplica el tema GUARDADO', async () => {
    localStorage.setItem(CLAVE_TEMA, 'minimal');

    const { result } = renderHook(() => useTheme());

    await waitFor(() => expect(motor.resolverTema).toHaveBeenCalled());
    expect(result.current.tema).toBe('minimal');
    expect(motor.resolverTema.mock.calls[0][1]).toBe('minimal');
  });

  it('criterio 4: sin nada guardado aplica el default del módulo', async () => {
    const { result } = renderHook(() => useTheme());

    await waitFor(() => expect(motor.resolverTema).toHaveBeenCalled());
    expect(result.current.tema).toBe(TEMA_DEL_MODULO.default);
    expect(motor.resolverTema.mock.calls[0][1]).toBe(TEMA_DEL_MODULO.default);
  });

  it('criterio 4: expone los temas permitidos y ofreceSelector del contrato', async () => {
    const { result } = renderHook(() => useTheme());
    await waitFor(() => expect(result.current.cargando).toBe(false));

    expect(result.current.temas).toEqual(TEMA_DEL_MODULO.permitidos);
    expect(result.current.temas).toHaveLength(3);
    expect(result.current.ofreceSelector).toBe(true);
  });

  // ── Criterio 9 ──────────────────────────────────────────────────────────────
  it('criterio 9: un tema inválido en localStorage cae al default (no rompe)', async () => {
    localStorage.setItem(CLAVE_TEMA, 'tema-corrupto-que-no-existe');

    const { result } = renderHook(() => useTheme());

    await waitFor(() => expect(motor.resolverTema).toHaveBeenCalled());
    expect(result.current.tema).toBe(TEMA_DEL_MODULO.default);
    expect(motor.resolverTema.mock.calls[0][1]).toBe(TEMA_DEL_MODULO.default);
  });

  it('criterio 9: leerTemaGuardado devuelve null si el valor es inválido', () => {
    localStorage.setItem(CLAVE_TEMA, 'basura');
    expect(leerTemaGuardado()).toBeNull();
  });

  it('criterio 9: leerTemaGuardado devuelve el valor si es válido', () => {
    localStorage.setItem(CLAVE_TEMA, 'nocturno');
    expect(leerTemaGuardado()).toBe('nocturno');
  });

  it('criterio 9: leerTemaGuardado devuelve null si no hay nada', () => {
    expect(leerTemaGuardado()).toBeNull();
  });

  it('criterio 9: si el motor falla al resolver, el hook no propaga la excepción', async () => {
    motor.resolverTema.mockRejectedValue(new Error('motor caído'));

    const { result } = renderHook(() => useTheme());

    // El hook no debe lanzar; el estado queda consistente.
    await waitFor(() => expect(motor.resolverTema).toHaveBeenCalled());
    expect(result.current.tema).toBe(TEMA_DEL_MODULO.default);
  });
});
