/**
 * KitchenToast.ms01.test.jsx -- MS-01 Paso 5
 *
 * Tests del componente de notificacion visual de cocina.
 * Usa solo matchers nativos de Vitest (sin @testing-library/jest-dom).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { KitchenToast } from './KitchenToast.jsx';

const TOAST_1 = { id: 'toast-1', mensaje: 'Mesa 5 -- listo para servir', timestamp: Date.now() };
const TOAST_2 = { id: 'toast-2', mensaje: 'Orden #42 -- listo para servir', timestamp: Date.now() };

describe('KitchenToast', () => {
  let onCerrar;

  beforeEach(() => {
    vi.useFakeTimers();
    onCerrar = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('no renderiza nada si la lista esta vacia', () => {
    const { container } = render(<KitchenToast toasts={[]} onCerrar={onCerrar} />);
    expect(container.firstChild).toBeNull();
  });

  it('muestra el mensaje del toast en el DOM', () => {
    render(<KitchenToast toasts={[TOAST_1]} onCerrar={onCerrar} />);
    // getByText lanza si no encuentra; que no lance es la afirmacion.
    const el = screen.getByText('Mesa 5 -- listo para servir');
    expect(el).toBeTruthy();
  });

  it('muestra multiples toasts', () => {
    render(<KitchenToast toasts={[TOAST_1, TOAST_2]} onCerrar={onCerrar} />);
    expect(screen.getAllByTestId('kitchen-toast')).toHaveLength(2);
  });

  it('llama onCerrar al hacer clic en el boton cerrar', () => {
    render(<KitchenToast toasts={[TOAST_1]} onCerrar={onCerrar} />);
    const btnCerrar = screen.getByRole('button', { name: /cerrar/i });
    fireEvent.click(btnCerrar);
    expect(onCerrar).toHaveBeenCalledWith('toast-1');
  });

  it('llama onCerrar automaticamente despues de 6 segundos', () => {
    render(<KitchenToast toasts={[TOAST_1]} onCerrar={onCerrar} />);
    expect(onCerrar).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(6_000); });
    expect(onCerrar).toHaveBeenCalledWith('toast-1');
  });

  it('tiene role=status para accesibilidad', () => {
    render(<KitchenToast toasts={[TOAST_1]} onCerrar={onCerrar} />);
    const toasts = screen.getAllByRole('status');
    expect(toasts).toHaveLength(1);
  });

  it('incluye el mensaje del toast en aria-label', () => {
    render(<KitchenToast toasts={[TOAST_1]} onCerrar={onCerrar} />);
    const toastEl = screen.getByRole('status');
    expect(toastEl.getAttribute('aria-label')).toBe(
      'Pedido listo: Mesa 5 -- listo para servir'
    );
  });
});
