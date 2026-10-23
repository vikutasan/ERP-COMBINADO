/**
 * DEUDA-BUG08 (Observación 4) — ¿Quién cuadra la caja? El corte impreso
 * explica el cobro ajeno.
 *
 * Cuando una caja (terminal con turno abierto) cobra cuentas de OTRAS
 * terminales (BUG-08), el corte debe decirle al cajero cuánto de su caja no
 * nació en su propia terminal. El total NO cambia; el desglose por origen sí
 * aparece.
 *
 * Criterios que se comprueban aquí:
 *   1. Con cuentas ajenas: se muestra "De otras terminales (N)" con el monto.
 *   2. Sin cuentas ajenas: la fila NO aparece (no ensucia el ticket).
 *   3. El desglose por método (efectivo/crédito/débito) sigue intacto.
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import CorteTicketTemplate from './CorteTicketTemplate.jsx';

afterEach(() => {
  cleanup();
});

/** Props base de un corte cuadrado, con desglose por origen opcional. */
function corteBase(extra = {}) {
  return {
    terminalId: 'TERM-01',
    cajero: 'Ana López',
    abiertaEn: '2026-09-29T14:00:00.000Z',
    cerradaEn: '2026-09-29T22:00:00.000Z',
    esperado: 1500,
    contado: 1500,
    credito: 320,
    debito: 180,
    movimientos: [],
    ...extra,
  };
}

describe('CorteTicketTemplate — desglose por origen (DEUDA-BUG08 Obs. 4)', () => {
  it('criterio 1: muestra "De otras terminales (N)" cuando la caja cobró ajenas', () => {
    render(
      <CorteTicketTemplate
        {...corteBase({
          ventasPropias: 1000,
          ventasAjenas: 250,
          numTransaccionesAjenas: 3,
        })}
      />
    );
    const fila = screen.getByTestId('ventas-ajenas');
    expect(fila.textContent).toContain('$250.00');
    expect(screen.getByText('De otras terminales (3)')).toBeTruthy();
  });

  it('criterio 2: NO muestra la fila cuando no hay cuentas ajenas', () => {
    render(
      <CorteTicketTemplate
        {...corteBase({ ventasPropias: 1500, ventasAjenas: 0, numTransaccionesAjenas: 0 })}
      />
    );
    expect(screen.queryByTestId('ventas-ajenas')).toBeNull();
  });

  it('criterio 3: el desglose por método sigue intacto con cuentas ajenas', () => {
    render(
      <CorteTicketTemplate
        {...corteBase({
          ventasPropias: 1000,
          ventasAjenas: 250,
          numTransaccionesAjenas: 3,
        })}
      />
    );
    expect(screen.getByTestId('efectivo').textContent).toBe('$1500.00');
    expect(screen.getByTestId('credito').textContent).toBe('$320.00');
    expect(screen.getByTestId('debito').textContent).toBe('$180.00');
  });
});
