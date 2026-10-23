/**
 * Puerta de FASE 12.2 — Plantilla de PEDIDO + doble copia (CLIENTE + COMERCIO).
 *
 * Contexto (F12 — portar funcionalidades puntuales del POS viejo):
 *   El viejo POS imprime el ticket de un PEDIDO DOS VECES:
 *     - COPIA CLIENTE   → para recoger/entregar el pedido.
 *     - COPIA COMERCIO  → respaldo físico por si cae el sistema.
 *   Y el ticket de un PEDIDO lleva una sección propia:
 *     *** DATOS DEL PEDIDO ***
 *   con CLIENTE, TIPO (PICKUP/DELIVERY), ENTREGA (fecha programada),
 *   EMPAQUE, DIRECCIÓN, NOTAS y el estado "PAGADO - PENDIENTE DE ...".
 *
 *   El nuevo POS había OMITIDO por completo esa sección y la doble copia
 *   (10ª instancia de la clase de fallo §10.6: "el inventario de componentes
 *   no ve la PARIDAD DE OPERACIÓN"). Esta compuerta blinda la operación.
 *
 * Regla dura 2 / E-19: "Verificar, no asumir".
 * §6.8: la INTEGRACIÓN se hereda; la IMPLEMENTACIÓN se reescribe.
 *
 * La compuerta verifica la OPERACIÓN observable:
 *   1.  Un PEDIDO imprime la sección *** DATOS DEL PEDIDO ***.
 *   2.  La sección trae CLIENTE, TIPO, ENTREGA y EMPAQUE.
 *   3.  PICKUP → "RECOLECCIÓN" y estado "PENDIENTE DE RECOLECCION".
 *   3b. Empaque PROPIO → "TRAE SU EMPAQUE".
 *   4.  DELIVERY → "ENTREGA A DOMICILIO" y estado "PENDIENTE DE ENTREGA".
 *   4b. DELIVERY → imprime la DIRECCIÓN.
 *   4c. Empaque PAGADO → "EMPAQUE PAGADO".
 *   5.  Las NOTAS del pedido se imprimen.
 *   5b. Sin NOTAS → no aparece la fila de NOTAS.
 *   6.  Una VENTA DIRECTA NO imprime la sección de pedido.
 *   6b. Un ticket sin order_type tampoco.
 *   7.  combinarCopiasPedido produce DOS copias: CLIENTE y COMERCIO.
 *   7b. La doble copia trae DOS secciones *** DATOS DEL PEDIDO ***.
 *   8.  La doble copia separa las copias con salto de página (.ticket-copy).
 *   9.  El documento es térmico y autocontenido (sin recursos externos).
 *   9b. combinarCopiasPedido sin argumentos no rompe.
 */

import { describe, it, expect } from 'vitest';
import { generarTicketHTML, combinarCopiasPedido } from './ticketGenerator.js';

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

function pedidoPickup(extra = {}) {
  return {
    folio: 'A-0001',
    created_at: '2026-10-01T15:30:00.000Z',
    order_type: 'PEDIDO',
    delivery_type: 'PICKUP',
    packaging_type: 'PROPIO',
    customer_name: 'María López',
    customer_phone: '5551234567',
    committed_at: '2026-10-01T20:00:00.000Z',
    notes: 'Sin nueces, por favor',
    lineas: [
      { nombre: 'Concha', cantidad: 2, precio_unitario: 12, importe: 24 },
    ],
    total: 24,
    payment_details: [
      { metodo: 'EFECTIVO', monto: 24 },
    ],
    ...extra,
  };
}

function pedidoDelivery(extra = {}) {
  return pedidoPickup({
    delivery_type: 'DELIVERY',
    packaging_type: 'PAGADO',
    delivery_address: 'Av. Reforma 123, Col. Centro',
    ...extra,
  });
}

function ventaDirecta(extra = {}) {
  return {
    folio: 'A-0002',
    created_at: '2026-10-01T15:30:00.000Z',
    order_type: 'VENTA_DIRECTA',
    lineas: [
      { nombre: 'Concha', cantidad: 1, precio_unitario: 12, importe: 12 },
    ],
    total: 12,
    payment_details: [
      { metodo: 'EFECTIVO', monto: 12 },
    ],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Criterios 1–6b — la sección *** DATOS DEL PEDIDO ***
// ---------------------------------------------------------------------------

describe('F12.2 — sección DATOS DEL PEDIDO', () => {
  it('criterio 1: un PEDIDO imprime la sección *** DATOS DEL PEDIDO ***', () => {
    const html = generarTicketHTML(pedidoPickup());
    expect(html).toContain('DATOS DEL PEDIDO');
  });

  it('criterio 2: la sección trae CLIENTE, TIPO, ENTREGA y EMPAQUE', () => {
    const html = generarTicketHTML(pedidoPickup());
    expect(html).toContain('CLIENTE');
    expect(html).toContain('María López');
    expect(html).toContain('TIPO');
    expect(html).toContain('ENTREGA');
    expect(html).toContain('EMPAQUE');
  });

  it('criterio 3: PICKUP imprime RECOLECCIÓN y estado PENDIENTE DE RECOLECCION', () => {
    const html = generarTicketHTML(pedidoPickup());
    expect(html).toContain('RECOLECCIÓN');
    expect(html).toContain('PENDIENTE DE RECOLECCION');
  });

  it('criterio 3b: empaque PROPIO imprime TRAE SU EMPAQUE', () => {
    const html = generarTicketHTML(pedidoPickup({ packaging_type: 'PROPIO' }));
    expect(html).toContain('TRAE SU EMPAQUE');
  });

  it('criterio 4: DELIVERY imprime ENTREGA A DOMICILIO y estado PENDIENTE DE ENTREGA', () => {
    const html = generarTicketHTML(pedidoDelivery());
    expect(html).toContain('ENTREGA A DOMICILIO');
    expect(html).toContain('PENDIENTE DE ENTREGA');
  });

  it('criterio 4b: DELIVERY imprime la DIRECCIÓN', () => {
    const html = generarTicketHTML(pedidoDelivery());
    expect(html).toContain('DIRECCIÓN');
    expect(html).toContain('Av. Reforma 123, Col. Centro');
  });

  it('criterio 4c: empaque PAGADO imprime EMPAQUE PAGADO', () => {
    const html = generarTicketHTML(pedidoDelivery({ packaging_type: 'PAGADO' }));
    expect(html).toContain('EMPAQUE PAGADO');
  });

  it('criterio 5: las NOTAS del pedido se imprimen', () => {
    const html = generarTicketHTML(pedidoPickup({ notes: 'Sin nueces, por favor' }));
    expect(html).toContain('NOTAS');
    expect(html).toContain('Sin nueces, por favor');
  });

  it('criterio 5b: sin NOTAS no aparece la fila de NOTAS', () => {
    const html = generarTicketHTML(pedidoPickup({ notes: '' }));
    expect(html).not.toContain('NOTAS');
  });

  it('criterio 6: una VENTA DIRECTA no imprime la sección de pedido', () => {
    const html = generarTicketHTML(ventaDirecta());
    expect(html).not.toContain('DATOS DEL PEDIDO');
    expect(html).not.toContain('PENDIENTE DE');
  });

  it('criterio 6b: un ticket sin order_type tampoco imprime la sección', () => {
    const html = generarTicketHTML(ventaDirecta({ order_type: undefined }));
    expect(html).not.toContain('DATOS DEL PEDIDO');
  });
});

// ---------------------------------------------------------------------------
// Criterios 7–9b — la doble copia (CLIENTE + COMERCIO)
// ---------------------------------------------------------------------------

describe('F12.2 — doble copia del PEDIDO', () => {
  it('criterio 7: combinarCopiasPedido produce DOS copias: CLIENTE y COMERCIO', () => {
    const html = combinarCopiasPedido(pedidoPickup());
    expect(html).toContain('CLIENTE');
    expect(html).toContain('COMERCIO');
  });

  it('criterio 7b: la doble copia trae DOS secciones DATOS DEL PEDIDO', () => {
    const html = combinarCopiasPedido(pedidoPickup());
    const apariciones = html.split('DATOS DEL PEDIDO').length - 1;
    expect(apariciones).toBe(2);
  });

  it('criterio 8: la doble copia separa las copias con salto de página', () => {
    const html = combinarCopiasPedido(pedidoPickup());
    expect(html).toContain('page-break-after: always');
    const copias = html.split('ticket-copy').length - 1;
    expect(copias).toBeGreaterThanOrEqual(2);
  });

  it('criterio 9: el documento es térmico y autocontenido (sin recursos externos)', () => {
    const html = combinarCopiasPedido(pedidoPickup());
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  it('criterio 9b: combinarCopiasPedido sin argumentos no rompe', () => {
    expect(() => combinarCopiasPedido()).not.toThrow();
    const html = combinarCopiasPedido();
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });
});
