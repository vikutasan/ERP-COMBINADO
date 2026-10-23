/**
 * Puerta de FASE 12.21 — Revisión pre-cobro de un PEDIDO (`CheckoutScreen`).
 *
 * Paridad con el viejo POS (§6.8): antes de cobrar un pedido, el cajero debe
 * poder CONFIRMAR CON EL CLIENTE los datos capturados en la programación
 * (tipo de entrega, cliente, teléfono, compromiso, empaque, dirección, notas)
 * y ver el CONTENIDO del pedido. En una VENTA DIRECTA el panel NO aparece y el
 * modal conserva su ancho original (regresión).
 *
 * Criterios:
 *   1. Con `orderData.order_type === 'PEDIDO'` se pinta el panel "Confirmar con
 *      el Cliente" con TODOS los campos capturados.
 *   2. El contenido del pedido lista las líneas recibidas en `lineas`.
 *   3. La dirección SOLO se muestra cuando el tipo de entrega es DOMICILIO.
 *   4. El título cambia a "Cobrar pedido" y el modal se ensancha.
 *   5. Sin `orderData` (VENTA DIRECTA) el panel NO existe y el título es
 *      "Cobrar ticket" (REGRESIÓN).
 *   6. Un `orderData` con `order_type !== 'PEDIDO'` tampoco pinta el panel.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import CheckoutScreen from './CheckoutScreen.jsx';

afterEach(() => {
  cleanup();
});

/** Bloque `order_*` de un pedido a domicilio, como lo proyecta el backend. */
function pedidoDomicilio(extra = {}) {
  return {
    order_type: 'PEDIDO',
    delivery_type: 'DOMICILIO',
    customer_name: 'María López',
    customer_phone: '5551234567',
    committed_at: '2026-10-08T18:30:00.000Z',
    packaging_type: 'CAJA',
    delivery_address: 'Av. Reforma 123, Col. Centro',
    order_notes: 'Sin nueces, por favor',
    ...extra,
  };
}

/** Líneas del pedido (contrato 30). */
const LINEAS = [
  { product_id: 'p1', name: 'Concha de Vainilla', quantity: 2, unit_price: 18.5 },
  { product_id: 'p2', name: 'Bolillo', quantity: 3, unit_price: 4.0 },
];

/** Monta el checkout con (o sin) el bloque de pedido. */
function montar({ total = 100, orderData = null, lineas = [] } = {}) {
  const onConfirmar = vi.fn();
  const onCancelar = vi.fn();
  render(
    <CheckoutScreen
      total={total}
      onConfirmar={onConfirmar}
      onCancelar={onCancelar}
      procesando={false}
      error={null}
      orderData={orderData}
      lineas={lineas}
    />
  );
  return { onConfirmar, onCancelar };
}

// ---------------------------------------------------------------------------
// 1. El panel aparece con TODOS los campos del pedido
// ---------------------------------------------------------------------------

describe('F12.21 — panel "Confirmar con el Cliente"', () => {
  it('pinta el panel con los datos capturados en la programación', () => {
    montar({ orderData: pedidoDomicilio(), lineas: LINEAS });

    expect(screen.getByText('Confirmar con el Cliente')).toBeTruthy();
    expect(screen.getByText('María López')).toBeTruthy();
    expect(screen.getByText('5551234567')).toBeTruthy();
    expect(screen.getByText('Av. Reforma 123, Col. Centro')).toBeTruthy();
    expect(screen.getByText('Sin nueces, por favor')).toBeTruthy();
  });

  it('lista el contenido del pedido a partir de `lineas`', () => {
    montar({ orderData: pedidoDomicilio(), lineas: LINEAS });

    expect(screen.getByText(/Concha de Vainilla/)).toBeTruthy();
    expect(screen.getByText(/Bolillo/)).toBeTruthy();
  });

  it('cambia el título a "Cobrar pedido"', () => {
    montar({ orderData: pedidoDomicilio(), lineas: LINEAS });

    expect(screen.getByText('Cobrar pedido')).toBeTruthy();
    expect(screen.queryByText('Cobrar ticket')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. La dirección SOLO se muestra en DOMICILIO
// ---------------------------------------------------------------------------

describe('F12.21 — la dirección depende del tipo de entrega', () => {
  it('muestra la dirección cuando el tipo de entrega es DOMICILIO', () => {
    montar({
      orderData: pedidoDomicilio({ delivery_type: 'DOMICILIO' }),
      lineas: LINEAS,
    });

    expect(screen.getByText('Av. Reforma 123, Col. Centro')).toBeTruthy();
  });

  it('NO muestra la dirección cuando el tipo de entrega es PICKUP', () => {
    montar({
      orderData: pedidoDomicilio({
        delivery_type: 'PICKUP',
        delivery_address: 'Av. Reforma 123, Col. Centro',
      }),
      lineas: LINEAS,
    });

    // El panel sigue existiendo (es un PEDIDO)…
    expect(screen.getByText('Confirmar con el Cliente')).toBeTruthy();
    // …pero la dirección NO se pinta (no aplica a recoger en tienda).
    expect(screen.queryByText('Av. Reforma 123, Col. Centro')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. REGRESIÓN — sin pedido el panel NO existe
// ---------------------------------------------------------------------------

describe('F12.21 — regresión de VENTA DIRECTA', () => {
  it('sin `orderData` el panel NO se pinta y el título es "Cobrar ticket"', () => {
    montar({ orderData: null, lineas: LINEAS });

    expect(screen.queryByText('Confirmar con el Cliente')).toBeNull();
    expect(screen.getByText('Cobrar ticket')).toBeTruthy();
  });

  it('un `orderData` con order_type distinto de PEDIDO tampoco pinta el panel', () => {
    montar({
      orderData: pedidoDomicilio({ order_type: 'VENTA_DIRECTA' }),
      lineas: LINEAS,
    });

    expect(screen.queryByText('Confirmar con el Cliente')).toBeNull();
    expect(screen.getByText('Cobrar ticket')).toBeTruthy();
  });
});
