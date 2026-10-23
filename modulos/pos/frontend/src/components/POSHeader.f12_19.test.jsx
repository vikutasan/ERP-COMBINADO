/**
 * Compuerta de FASE 12.19 — Estado de transacción: `CTA {folio}` + `📝 BORRADOR`.
 *
 * QUÉ PRUEBA ESTA COMPUERTA
 * -------------------------
 * El viejo POS (`apps/pos/components/POSHeader.jsx:75-89`) mostraba en el
 * centro del header:
 *
 *     {currentAccountNum ? `CTA ${currentAccountNum}` : 'NUEVA VENTA'}
 *     {currentAccountNum && cartLength > 0 && !orderData && (📝 BORRADOR)}
 *
 * Es decir: en cuanto la cuenta tenía folio, la leyenda dejaba de ser
 * "NUEVA VENTA" y pasaba a `CTA {folio}`; y mientras la cuenta se estaba
 * capturando (folio + al menos una línea) y aún NO se había enviado al
 * pizarrón (sin pedido), aparecía el badge `📝 BORRADOR`.
 *
 * En el nuevo POS el centro del header pintaba SOLO la etiqueta de estado
 * (`Nueva Venta` / `Cobrando…` / `Venta Cobrada`) y NUNCA recibía el folio ni
 * el largo del carrito: el cambio de leyenda NO ocurría. Esta es la lección de
 * §10.6.5 — el componente existía y pasaba su test, pero la OPERACIÓN heredada
 * (cambiar la leyenda al capturar) estaba OMITIDA.
 *
 * Esta compuerta fija las 4 invariantes de la operación heredada:
 *   1. Sin folio → la leyenda es la etiqueta de estado (Nueva Venta).
 *   2. Con folio → la leyenda es `CTA {folio}` (no "Nueva Venta").
 *   3. Con folio + líneas + sin pedido → aparece `📝 Borrador`.
 *   4. Con folio + líneas + pedido programado → NO aparece `📝 Borrador`
 *      (paridad con `!orderData` del viejo POS).
 *
 * §6.8 — la INTEGRACIÓN se hereda; solo la IMPLEMENTACIÓN se reescribe.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import POSHeader from './POSHeader.jsx';

function montar(props = {}) {
  return render(<POSHeader terminalId="TERM-01" {...props} />);
}

describe('F12.19 — el centro del header muestra CTA {folio} cuando hay cuenta', () => {
  it('sin folio, la leyenda es la etiqueta de estado (Nueva Venta)', () => {
    montar();
    expect(screen.getByText('Nueva Venta')).toBeTruthy();
    expect(screen.queryByText(/^CTA /)).toBeNull();
  });

  it('con folio, la leyenda es `CTA {folio}` y NO "Nueva Venta"', () => {
    montar({ numeroCuenta: 'V77559' });
    expect(screen.getByText('CTA V77559')).toBeTruthy();
    expect(screen.queryByText('Nueva Venta')).toBeNull();
  });

  it('el folio manda sobre la etiqueta de estado (aunque el estado sea COBRANDO)', () => {
    montar({ numeroCuenta: 'V77559', estado: 'COBRANDO' });
    expect(screen.getByText('CTA V77559')).toBeTruthy();
    expect(screen.queryByText('Cobrando…')).toBeNull();
  });
});

describe('F12.19 — el badge 📝 Borrador aparece al capturar (paridad con el viejo POS)', () => {
  it('con folio + líneas + sin pedido → aparece `📝 Borrador`', () => {
    montar({ numeroCuenta: 'V77559', cartLength: 3 });
    expect(screen.getByText('📝 Borrador')).toBeTruthy();
  });

  it('con folio pero SIN líneas → NO aparece `📝 Borrador`', () => {
    montar({ numeroCuenta: 'V77559', cartLength: 0 });
    expect(screen.queryByText('📝 Borrador')).toBeNull();
  });

  it('sin folio → NO aparece `📝 Borrador` (aunque haya líneas)', () => {
    montar({ numeroCuenta: null, cartLength: 3 });
    expect(screen.queryByText('📝 Borrador')).toBeNull();
  });

  it('con folio + líneas + pedido programado → NO aparece `📝 Borrador`', () => {
    // Paridad con `!orderData` del viejo POS: si la cuenta ya es un pedido
    // programado, el badge de borrador cede su lugar al de pedido.
    montar({ numeroCuenta: 'V77559', cartLength: 3, pedidoProgramado: true });
    expect(screen.queryByText('📝 Borrador')).toBeNull();
  });
});
