/**
 * Tests de useModo y resolución de breakpoints responsivos -- MR-01.
 *
 * Cubre:
 *   mr01.1 -- Viewport móvil (375px) resuelve modo MOVIL y esMovil=true.
 *   mr01.2 -- Viewport tablet (768px) resuelve modo COMPACTO y esCompacto=true.
 *   mr01.3 -- Viewport mostrador (1024px+) resuelve modo MOSTRADOR y esMostrador=true.
 *   mr01.4 -- Redimensionar ventana actualiza reactivamente el modo.
 *   mr01.5 -- Función pura modoParaAncho clasifica correctamente los límites.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { useModo, modoParaAncho } from './useModo.js';

function montar() {
  const captured = { current: null };
  function Sonda() {
    captured.current = useModo();
    return null;
  }
  render(<Sonda />);
  return captured;
}

describe('useModo & Breakpoints Responsivos (MR-01)', () => {
  let originalInnerWidth;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
  });

  function setWindowWidth(w) {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: w,
    });
    window.dispatchEvent(new Event('resize'));
  }

  it('mr01.1 -- Viewport móvil (375px) resuelve MOVIL', () => {
    setWindowWidth(375);
    const hook = montar();

    expect(hook.current.modo).toBe('MOVIL');
    expect(hook.current.esMovil).toBe(true);
    expect(hook.current.esCompacto).toBe(false);
    expect(hook.current.esMostrador).toBe(false);
    expect(hook.current.ancho).toBe(375);
  });

  it('mr01.2 -- Viewport tablet (768px) resuelve COMPACTO', () => {
    setWindowWidth(768);
    const hook = montar();

    expect(hook.current.modo).toBe('COMPACTO');
    expect(hook.current.esCompacto).toBe(true);
    expect(hook.current.esMovil).toBe(false);
    expect(hook.current.esMostrador).toBe(false);
    expect(hook.current.ancho).toBe(768);
  });

  it('mr01.3 -- Viewport mostrador (1024px+) resuelve MOSTRADOR', () => {
    setWindowWidth(1280);
    const hook = montar();

    expect(hook.current.modo).toBe('MOSTRADOR');
    expect(hook.current.esMostrador).toBe(true);
    expect(hook.current.esCompacto).toBe(false);
    expect(hook.current.esMovil).toBe(false);
  });

  it('mr01.4 -- Redimensionar ventana actualiza reactivamente el modo', () => {
    setWindowWidth(1280);
    const hook = montar();
    expect(hook.current.modo).toBe('MOSTRADOR');

    act(() => {
      setWindowWidth(375);
    });

    expect(hook.current.modo).toBe('MOVIL');
    expect(hook.current.esMovil).toBe(true);

    act(() => {
      setWindowWidth(800);
    });

    expect(hook.current.modo).toBe('COMPACTO');
    expect(hook.current.esCompacto).toBe(true);
  });

  it('mr01.5 -- modoParaAncho clasifica correctamente valores de frontera', () => {
    expect(modoParaAncho(0)).toBe('MOVIL');
    expect(modoParaAncho(375)).toBe('MOVIL');
    expect(modoParaAncho(767)).toBe('MOVIL');
    expect(modoParaAncho(768)).toBe('COMPACTO');
    expect(modoParaAncho(1023)).toBe('COMPACTO');
    expect(modoParaAncho(1024)).toBe('MOSTRADOR');
    expect(modoParaAncho(1920)).toBe('MOSTRADOR');
  });
});
