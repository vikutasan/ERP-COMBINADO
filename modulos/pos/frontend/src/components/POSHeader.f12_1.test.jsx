/**
 * Compuerta de FASE 12.1 — Selector VENTA DIRECTA / PEDIDO (UX heredada).
 *
 * QUÉ PRUEBA ESTA COMPUERTA
 * -------------------------
 * El viejo POS (`apps/pos/components/POSHeader.jsx:95-134`) tiene un selector
 * VENTA DIRECTA / PEDIDO que GOBIERNA la aparición del botón "Programación del
 * Pedido": el botón SOLO existe cuando `orderType === 'PEDIDO'`.
 *
 * En el nuevo POS el botón 📌 (`btn-programacion-pedido`) YA existía, pero el
 * SELECTOR que lo revela estaba OMITIDO. Esta es la lección de §10.6.5: el
 * componente existe y pasa su test, pero el usuario no puede llegar a él porque
 * falta la OPERACIÓN que lo revela.
 *
 * Esta compuerta fija las 4 invariantes de la operación heredada:
 *   1. El selector existe con sus dos botones (`btn-venta-directa`, `btn-pedido`).
 *   2. Por defecto el modo es VENTA_DIRECTA y el botón 📌 NO se muestra.
 *   3. Al pulsar PEDIDO, el botón 📌 APARECE (y se notifica el cambio de tipo).
 *   4. Al volver a VENTA DIRECTA, se notifica el cambio Y se limpia el bloque
 *      de pedido (`onLimpiarPedido`), fiel a `onOrderDataClear` del viejo POS.
 *
 * §6.8 — la INTEGRACIÓN se hereda; solo la IMPLEMENTACIÓN se reescribe.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import POSHeader from './POSHeader.jsx';

function montar(props = {}) {
  return render(<POSHeader terminalId="TERM-01" {...props} />);
}

describe('F12.1 — el selector VENTA DIRECTA / PEDIDO existe', () => {
  it('renderiza los dos botones del selector', () => {
    montar();
    expect(screen.getByText('Venta Directa')).toBeTruthy();
    expect(screen.getByText('📦 Pedido')).toBeTruthy();
  });

  it('expone los ids heredados del viejo POS', () => {
    const { container } = montar();
    expect(container.querySelector('#btn-venta-directa')).toBeTruthy();
    expect(container.querySelector('#btn-pedido')).toBeTruthy();
  });

  it('marca VENTA DIRECTA como activo por defecto (aria-pressed)', () => {
    const { container } = montar();
    expect(
      container.querySelector('#btn-venta-directa').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      container.querySelector('#btn-pedido').getAttribute('aria-pressed'),
    ).toBe('false');
  });
});

describe('F12.1 — el botón 📌 de programación depende del tipo de pedido', () => {
  it('NO se muestra el botón 📌 en VENTA_DIRECTA (por defecto)', () => {
    const { container } = montar();
    expect(container.querySelector('#btn-programacion-pedido')).toBeNull();
  });

  it('NO se muestra el botón 📌 si el tipo es VENTA_DIRECTA explícito', () => {
    const { container } = montar({ tipoPedido: 'VENTA_DIRECTA' });
    expect(container.querySelector('#btn-programacion-pedido')).toBeNull();
  });

  it('SÍ se muestra el botón 📌 en modo PEDIDO', () => {
    const { container } = montar({ tipoPedido: 'PEDIDO' });
    expect(container.querySelector('#btn-programacion-pedido')).toBeTruthy();
  });

  it('el botón 📌 dispara onAbrirPedido al pulsarlo', () => {
    const onAbrirPedido = vi.fn();
    const { container } = montar({ tipoPedido: 'PEDIDO', onAbrirPedido });
    fireEvent.click(container.querySelector('#btn-programacion-pedido'));
    expect(onAbrirPedido).toHaveBeenCalledTimes(1);
  });
});

describe('F12.1 — el selector notifica el cambio de tipo', () => {
  it('al pulsar PEDIDO llama a onCambiarTipoPedido con "PEDIDO"', () => {
    const onCambiarTipoPedido = vi.fn();
    montar({ onCambiarTipoPedido });
    fireEvent.click(screen.getByText('📦 Pedido'));
    expect(onCambiarTipoPedido).toHaveBeenCalledWith('PEDIDO');
  });

  it('al pulsar VENTA DIRECTA llama a onCambiarTipoPedido con "VENTA_DIRECTA"', () => {
    const onCambiarTipoPedido = vi.fn();
    montar({ tipoPedido: 'PEDIDO', onCambiarTipoPedido });
    fireEvent.click(screen.getByText('Venta Directa'));
    expect(onCambiarTipoPedido).toHaveBeenCalledWith('VENTA_DIRECTA');
  });
});

describe('F12.1 — volver a VENTA DIRECTA limpia el bloque de pedido', () => {
  it('al pulsar VENTA DIRECTA llama a onLimpiarPedido', () => {
    const onLimpiarPedido = vi.fn();
    montar({ tipoPedido: 'PEDIDO', onLimpiarPedido });
    fireEvent.click(screen.getByText('Venta Directa'));
    expect(onLimpiarPedido).toHaveBeenCalledTimes(1);
  });

  it('al pulsar PEDIDO NO limpia el bloque de pedido', () => {
    const onLimpiarPedido = vi.fn();
    montar({ onLimpiarPedido });
    fireEvent.click(screen.getByText('📦 Pedido'));
    expect(onLimpiarPedido).not.toHaveBeenCalled();
  });
});

describe('F12.1 — badge de pedido tentativo', () => {
  it('muestra el badge cuando hay un pedido programado', () => {
    montar({ pedidoProgramado: true });
    expect(screen.getByText('📦 Pedido tentativo')).toBeTruthy();
  });

  it('NO muestra el badge cuando no hay pedido programado', () => {
    montar({ pedidoProgramado: false });
    expect(screen.queryByText('📦 Pedido tentativo')).toBeNull();
  });
});
