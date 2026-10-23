/**
 * Puerta de FASE 9.1.4 — El ticket impreso desglosa los N pagos (pagos mixtos).
 *
 * Verifica la compuerta de la sub-fase F9.1.4:
 *   1. Un cobro MIXTO (2 pagos) imprime el desglose completo: cada método con
 *      su monto, y el cambio cuando el pago es en efectivo.
 *   2. Un cobro de UN solo pago sigue imprimiendo su línea (retrocompatibilidad).
 *   3. Un ticket SIN `payment_details` (aún no cobrado) no imprime el bloque y
 *      no rompe.
 *   4. El desglose respeta la forma canónica `{ pagos: [...] }` (F9.1) y la
 *      forma vieja `{ metodo, monto, recibido, cambio }`.
 *   5. El documento sigue siendo autosuficiente (sin http:// ni https://).
 *
 * Se ejecuta con: npx vitest run src/utils/ticketGenerator.f9_1_4.test.jsx
 *
 * @see PLAN_DE_ABORDAJE_FASE_9_1_PAGOS_MIXTOS.md §3.5 (Sub-fase 9.1.4)
 */

import { describe, it, expect } from 'vitest';
import { generarTicketHTML } from './ticketGenerator.js';

/** Ticket de ejemplo con 2 líneas y un `payment_details` dado. */
function ticketConPagos(paymentDetails, extra = {}) {
  return {
    account_num: 'A-0042',
    total: 100,
    terminal_id: 'TERM-02',
    created_at: '2026-09-29T18:30:00.000Z',
    lineas: [
      { nombre: 'Concha', cantidad: 2, precio_unitario: 25.0 },
      { nombre: 'Bolillo', cantidad: 1, precio_unitario: 50.0 },
    ],
    payment_details: paymentDetails,
    ...extra,
  };
}

describe('F9.1.4 — generarTicketHTML desglosa los pagos', () => {
  it('criterio 1: un cobro mixto (2 pagos) imprime ambos métodos y montos', () => {
    const html = generarTicketHTML(
      ticketConPagos({
        pagos: [
          { metodo: 'EFECTIVO', monto: '40.00', recibido: '50.00', cambio: '10.00' },
          { metodo: 'DEBITO', monto: '60.00' },
        ],
        cajero: 'Ana',
      })
    );
    // El título del bloque aparece (varios pagos → "Forma de pago").
    expect(html).toContain('Forma de pago');
    // Ambos métodos con su monto.
    expect(html).toContain('Efectivo');
    expect(html).toContain('$40.00');
    expect(html).toContain('Débito');
    expect(html).toContain('$60.00');
    // El cambio entregado del pago en efectivo.
    expect(html).toContain('Cambio');
    expect(html).toContain('$10.00');
  });

  it('criterio 1b: el desglose va DESPUÉS del total', () => {
    const html = generarTicketHTML(
      ticketConPagos({
        pagos: [
          { metodo: 'EFECTIVO', monto: '40.00' },
          { metodo: 'DEBITO', monto: '60.00' },
        ],
      })
    );
    const posTotal = html.indexOf('TOTAL');
    const posPagos = html.indexOf('Forma de pago');
    expect(posTotal).toBeGreaterThan(-1);
    expect(posPagos).toBeGreaterThan(posTotal);
  });

  it('criterio 2: un cobro de un solo pago imprime su línea', () => {
    const html = generarTicketHTML(
      ticketConPagos({ metodo: 'EFECTIVO', monto: '100.00', recibido: '100.00', cambio: '0.00' })
    );
    expect(html).toContain('Forma de pago');
    expect(html).toContain('Efectivo');
    expect(html).toContain('$100.00');
  });

  it('criterio 3: un ticket sin payment_details no imprime el bloque', () => {
    const html = generarTicketHTML(ticketConPagos(null));
    expect(html).toContain('<html>');
    expect(html).not.toContain('Forma de pago');
  });

  it('criterio 3b: un ticket sin argumentos no rompe', () => {
    const html = generarTicketHTML();
    expect(html).toContain('<html>');
    expect(html).not.toContain('Forma de pago');
  });

  it('criterio 4: reconoce la forma canónica `pagos[]`', () => {
    const html = generarTicketHTML(
      ticketConPagos({
        pagos: [
          { metodo: 'TRANSFERENCIA', monto: '30.00' },
          { metodo: 'CREDITO', monto: '70.00' },
        ],
      })
    );
    expect(html).toContain('Transferencia');
    expect(html).toContain('$30.00');
    expect(html).toContain('Crédito');
    expect(html).toContain('$70.00');
  });

  it('criterio 4b: reconoce la forma vieja (un solo pago suelto)', () => {
    const html = generarTicketHTML(
      ticketConPagos({ metodo: 'DEBITO', monto: '100.00' })
    );
    expect(html).toContain('Débito');
    expect(html).toContain('$100.00');
  });

  it('criterio 5: el documento con pagos sigue siendo autosuficiente', () => {
    const html = generarTicketHTML(
      ticketConPagos({
        pagos: [
          { metodo: 'EFECTIVO', monto: '40.00' },
          { metodo: 'DEBITO', monto: '60.00' },
        ],
      })
    );
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });
});
