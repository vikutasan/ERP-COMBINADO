/**
 * Puerta de F9.0.2 — Teclado numérico + cambio en vivo.
 *
 * Rescate de UX del viejo POS: el teclado táctil permite capturar el efectivo
 * recibido sin depender del teclado físico. El input nativo se conserva.
 *
 * Criterios de la puerta:
 *   1. El teclado expone las teclas 1-9, 0, "." y "C".
 *   2. Los dígitos se concatenan al valor actual.
 *   3. El "." solo se acepta una vez.
 *   4. "C" limpia el valor.
 *   5. El cambio se recalcula en vivo al usar el teclado.
 *   6. CONFIRMAR PAGO se deshabilita si el recibido < total.
 *   7. Cada tecla respeta el target táctil de 44×44px.
 *   8. El input nativo sigue funcionando (no se eliminó).
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import TecladoNumerico, { aplicarTecla, TECLAS } from './TecladoNumerico.jsx';
import CheckoutScreen from './CheckoutScreen.jsx';

afterEach(() => cleanup());

describe('F9.0.2 — TecladoNumerico (componente puro)', () => {
  it('criterio 1: expone las teclas 1-9, 0, "." y "C"', () => {
    render(<TecladoNumerico valor="" onCambiar={() => {}} />);
    for (const tecla of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '.']) {
      expect(screen.getByRole('button', { name: tecla })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Borrar' })).toBeTruthy();
    expect(TECLAS).toHaveLength(12);
  });

  it('criterio 2: los dígitos se concatenan al valor actual', () => {
    expect(aplicarTecla('', '1')).toBe('1');
    expect(aplicarTecla('1', '5')).toBe('15');
    expect(aplicarTecla('15', '0')).toBe('150');
  });

  it('criterio 2b: no deja ceros a la izquierda sin sentido', () => {
    expect(aplicarTecla('0', '5')).toBe('5');
  });

  it('criterio 3: el "." solo se acepta una vez', () => {
    expect(aplicarTecla('15', '.')).toBe('15.');
    expect(aplicarTecla('15.', '5')).toBe('15.5');
    expect(aplicarTecla('15.5', '.')).toBe('15.5');
  });

  it('criterio 3b: un "." al inicio se interpreta como "0."', () => {
    expect(aplicarTecla('', '.')).toBe('0.');
  });

  it('criterio 4: "C" limpia el valor', () => {
    expect(aplicarTecla('150.50', 'C')).toBe('');
  });

  it('criterio 7: cada tecla respeta el target táctil de 44×44px', () => {
    render(<TecladoNumerico valor="" onCambiar={() => {}} />);
    const botones = screen.getAllByRole('button');
    expect(botones).toHaveLength(12);
    for (const boton of botones) {
      expect(boton.className).toContain('min-h-tactil');
      expect(boton.className).toContain('min-w-tactil');
    }
  });

  it('emite el valor siguiente al pulsar una tecla', () => {
    const onCambiar = vi.fn();
    render(<TecladoNumerico valor="15" onCambiar={onCambiar} />);
    fireEvent.click(screen.getByRole('button', { name: '0' }));
    expect(onCambiar).toHaveBeenCalledWith('150');
  });
});

describe('F9.0.2 — CheckoutScreen integra el teclado', () => {
  it('criterio 5: el cambio se recalcula en vivo al usar el teclado', () => {
    render(
      <CheckoutScreen total={100} onConfirmar={() => {}} onCancelar={() => {}} />,
    );
    // Captura "200" con el teclado táctil.
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: '0' }));
    fireEvent.click(screen.getByRole('button', { name: '0' }));

    // El cambio mostrado debe ser $100.00 (200 - 100). Se ancla al bloque
    // "Cambio" porque el total también vale $100.00 en este escenario.
    const etiquetaCambio = screen.getByText('Cambio');
    const bloqueCambio = etiquetaCambio.parentElement;
    expect(bloqueCambio.textContent).toContain('$100.00');
  });

  it('criterio 6: CONFIRMAR PAGO se deshabilita si el recibido < total', () => {
    render(
      <CheckoutScreen total={100} onConfirmar={() => {}} onCancelar={() => {}} />,
    );
    const confirmar = screen.getByRole('button', { name: 'CONFIRMAR PAGO' });
    expect(confirmar.disabled).toBe(true);

    // Captura "50" (insuficiente).
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: '0' }));
    expect(confirmar.disabled).toBe(true);

    // Completa a "500" (suficiente).
    fireEvent.click(screen.getByRole('button', { name: '0' }));
    expect(confirmar.disabled).toBe(false);
  });

  it('criterio 8: el input nativo sigue funcionando', () => {
    render(
      <CheckoutScreen total={100} onConfirmar={() => {}} onCancelar={() => {}} />,
    );
    // Se localiza por etiqueta: el input de "Monto del abono" (F9.1.3)
    // comparte el placeholder `0.00`.
    const input = screen.getByLabelText('Efectivo recibido');
    fireEvent.change(input, { target: { value: '150' } });
    expect(input.value).toBe('150');
    expect(screen.getByText('$50.00')).toBeTruthy();
  });

  it('criterio 4b: "C" limpia el recibido y vuelve a bloquear el cobro', () => {
    render(
      <CheckoutScreen total={100} onConfirmar={() => {}} onCancelar={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: '0' }));
    fireEvent.click(screen.getByRole('button', { name: '0' }));
    const confirmar = screen.getByRole('button', { name: 'CONFIRMAR PAGO' });
    expect(confirmar.disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));
    expect(confirmar.disabled).toBe(true);
  });
});
