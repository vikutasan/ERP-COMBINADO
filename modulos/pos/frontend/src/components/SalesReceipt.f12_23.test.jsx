/**
 * Compuerta de FASE 12.23 — PARIDAD DE UX DE CANTIDAD (§6.8).
 *
 * QUÉ PRUEBA ESTA COMPUERTA
 * -------------------------
 * El viejo POS (`apps/pos/components/SalesReceipt.jsx`) NO editaba la cantidad
 * con botones −/+ laterales. La editaba así:
 *
 *   1. La cantidad del ticket era un `<div onClick={() => handleQuantityClick(item)}>`
 *      que mostraba `{item.quantity || 1}x` (líneas 71-77).
 *   2. Al pulsarla se abría un TECLADO NUMÉRICO en pantalla (líneas 203-241) con
 *      las teclas `[1..9, 'C', 0, 'OK']`.
 *   3. `handleEditConfirm` (líneas 24-33) parseaba la captura:
 *        - cantidad > 0 → `updateQuantity(id, n)`.
 *        - cantidad === 0 → `removeFromCart(id)`.
 *        - captura inválida → no aplicaba nada.
 *
 * El nuevo POS había reimplementado la cantidad con botones −/+ laterales, que
 * son lentos para cantidades grandes (hay que dar N taps). Es la 24ª instancia
 * de §10.6: el componente existía y pasaba su test, pero su OPERACIÓN (edición
 * por teclado numérico) se perdió en la traducción.
 *
 * Esta compuerta fija las invariantes de la operación heredada:
 *   1. La cantidad es un BOTÓN (no hay botones −/+ laterales).
 *   2. Pulsarla abre un modal (role="dialog") con el teclado numérico.
 *   3. El modal precarga la cantidad ACTUAL de la línea.
 *   4. Teclear dígitos y confirmar con OK emite `onCambiarCantidad(linea, n)`.
 *   5. Teclear 0 y confirmar QUITA la línea (`onQuitar`), no la deja en 0.
 *   6. Cancelar cierra el modal SIN emitir cambios.
 *   7. El botón de cantidad respeta el target táctil (R-04, ≥44px).
 *
 * §6.8 — la INTEGRACIÓN se hereda; solo la IMPLEMENTACIÓN se reescribe.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import SalesReceipt from './SalesReceipt.jsx';

const LINEA = {
  item_id: 'ITEM-1',
  product_id: 'PROD-1',
  name: 'Concha',
  unit_price: 12.5,
  quantity: 2,
};

function montar(props = {}) {
  const base = {
    lineas: [LINEA],
    onQuitar: vi.fn(),
    onCambiarCantidad: vi.fn(),
    onCobrar: vi.fn(),
    cobrando: false,
    terminalId: 'TERM-01',
    banner: null,
    cajaHabilitada: false,
  };
  return render(<SalesReceipt {...base} {...props} />);
}

function botonCantidad() {
  return screen.getByLabelText('Modificar cantidad de Concha');
}

function tecla(nombre) {
  return screen.getByRole('button', { name: nombre });
}

describe('F12.23 — la cantidad se edita con teclado numérico (paridad con el viejo POS)', () => {
  it('la cantidad es un botón clicable (no hay botones −/+ laterales)', () => {
    montar();
    expect(botonCantidad()).toBeTruthy();
    // Los botones −/+ del viejo diseño ya NO existen.
    expect(screen.queryByLabelText('Añadir una unidad de Concha')).toBeNull();
    expect(screen.queryByLabelText('Quitar una unidad de Concha')).toBeNull();
  });

  it('pulsar la cantidad abre el modal con el teclado numérico', () => {
    montar();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(botonCantidad());
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Modificar Cantidad')).toBeTruthy();
    // El teclado numérico reutilizado (F9.0.2) está presente.
    expect(screen.getByRole('group', { name: /Teclado numérico/ })).toBeTruthy();
  });

  it('el modal precarga la cantidad ACTUAL de la línea', () => {
    montar();
    fireEvent.click(botonCantidad());
    // La línea tiene quantity: 2 → el visor muestra "2". Se busca por el
    // contenedor del visor (la tecla "2" del teclado también dice "2").
    const visor = document.querySelector('.text-5xl');
    expect(visor.textContent).toBe('2');
  });

  it('teclear dígitos y confirmar con OK emite onCambiarCantidad(linea, n)', () => {
    const onCambiarCantidad = vi.fn();
    montar({ onCambiarCantidad });
    fireEvent.click(botonCantidad());
    // "2" precargado → pulsar "C" para limpiar → teclear "1" "2" → "12".
    fireEvent.click(tecla('Borrar'));
    fireEvent.click(tecla('1'));
    fireEvent.click(tecla('2'));
    fireEvent.click(tecla('OK'));
    expect(onCambiarCantidad).toHaveBeenCalledTimes(1);
    expect(onCambiarCantidad.mock.calls[0][0]).toBe(LINEA);
    expect(onCambiarCantidad.mock.calls[0][1]).toBe(12);
  });

  it('teclear 0 y confirmar QUITA la línea (no la deja en 0)', () => {
    const onCambiarCantidad = vi.fn();
    const onQuitar = vi.fn();
    montar({ onCambiarCantidad, onQuitar });
    fireEvent.click(botonCantidad());
    fireEvent.click(tecla('Borrar'));
    fireEvent.click(tecla('0'));
    fireEvent.click(tecla('OK'));
    expect(onQuitar).toHaveBeenCalledTimes(1);
    expect(onQuitar.mock.calls[0][0]).toBe(LINEA);
    expect(onCambiarCantidad).not.toHaveBeenCalled();
  });

  it('Cancelar cierra el modal SIN emitir cambios', () => {
    const onCambiarCantidad = vi.fn();
    const onQuitar = vi.fn();
    montar({ onCambiarCantidad, onQuitar });
    fireEvent.click(botonCantidad());
    fireEvent.click(tecla('Borrar'));
    fireEvent.click(tecla('9'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onCambiarCantidad).not.toHaveBeenCalled();
    expect(onQuitar).not.toHaveBeenCalled();
  });

  it('confirmar con la captura vacía NO emite cambios (captura inválida)', () => {
    const onCambiarCantidad = vi.fn();
    const onQuitar = vi.fn();
    montar({ onCambiarCantidad, onQuitar });
    fireEvent.click(botonCantidad());
    fireEvent.click(tecla('Borrar'));
    fireEvent.click(tecla('OK'));
    expect(onCambiarCantidad).not.toHaveBeenCalled();
    expect(onQuitar).not.toHaveBeenCalled();
    // El modal se cierra igual.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('R-04: el botón de cantidad respeta el target táctil (≥44px)', () => {
    montar();
    const boton = botonCantidad();
    expect(boton.className).toContain('min-h-tactil');
    expect(boton.className).toContain('min-w-tactil');
  });
});
