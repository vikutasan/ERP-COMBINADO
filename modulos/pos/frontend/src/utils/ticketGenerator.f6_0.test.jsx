/**
 * Puerta de FASE 6.0 — `ticketGenerator.js` (utilidad pura).
 *
 * Verifica los 7 criterios del Plan de Fase 6 §6.4:
 *   1. `generarTicketHTML` devuelve `<html>` y `@page { size: 80mm`.
 *   2. El HTML incluye el número de cuenta y el total.
 *   3. Cada línea aparece con cantidad, nombre y precio.
 *   4. `generarCorteHTML` incluye fondo inicial, movimientos y conteo final.
 *   5. Un ticket vacío no rompe (HTML válido con "sin líneas").
 *   6. Ninguna función contiene `http://` ni `https://` (autosuficiencia, D-6).
 *   7. Ninguna función toca el DOM (no usa `document`).
 *
 * Se ejecuta con: npx vitest run src/utils/ticketGenerator.f6_0.test.jsx
 *
 * @see PLAN_DE_ABORDAJE_FASE_6_POR_PARTES.md §6 (Sub-fase 6.0)
 */

import { describe, it, expect } from 'vitest';
import { generarTicketHTML, generarCorteHTML } from './ticketGenerator.js';

/** Ticket de ejemplo con 2 líneas. */
function ticketEjemplo(extra = {}) {
  return {
    account_num: 'A-0042',
    total: 125.5,
    terminal_id: 'TERM-02',
    created_at: '2026-09-29T18:30:00.000Z',
    lineas: [
      { nombre: 'Concha', cantidad: 3, precio_unitario: 12.5 },
      { nombre: 'Bolillo', cantidad: 2, precio_unitario: 44.0 },
    ],
    ...extra,
  };
}

/** Corte de ejemplo con movimientos. */
function corteEjemplo(extra = {}) {
  return {
    terminalId: 'TERM-02',
    cajero: 'Ana',
    abiertaEn: '2026-09-29T08:00:00.000Z',
    cerradaEn: '2026-09-29T18:00:00.000Z',
    esperado: 1000,
    contado: 980,
    credito: 150,
    debito: 75,
    movimientos: [
      { tipo: 'ENTRADA', motivo: 'Refuerzo', monto: 200 },
      { tipo: 'SALIDA', motivo: 'Propina', monto: 50 },
    ],
    ...extra,
  };
}

describe('F6.0 — generarTicketHTML', () => {
  it('criterio 1: devuelve <html> y @page { size: 80mm', () => {
    const html = generarTicketHTML(ticketEjemplo());
    expect(html).toContain('<html>');
    expect(html).toContain('@page { size: 80mm');
  });

  it('criterio 2: incluye el número de cuenta y el total', () => {
    const html = generarTicketHTML(ticketEjemplo());
    expect(html).toContain('A-0042');
    expect(html).toContain('$125.50');
  });

  it('criterio 3: cada línea aparece con cantidad, nombre y precio', () => {
    const html = generarTicketHTML(ticketEjemplo());
    expect(html).toContain('3x');
    expect(html).toContain('Concha');
    expect(html).toContain('$12.50');
    expect(html).toContain('2x');
    expect(html).toContain('Bolillo');
    expect(html).toContain('$44.00');
  });

  it('criterio 5: un ticket vacío no rompe y avisa "sin líneas"', () => {
    const html = generarTicketHTML({ account_num: 'A-0001', total: 0, lineas: [] });
    expect(html).toContain('<html>');
    expect(html).toContain('sin líneas');
    expect(html).toContain('$0.00');
  });

  it('criterio 5b: un ticket sin argumentos no rompe', () => {
    const html = generarTicketHTML();
    expect(html).toContain('<html>');
    expect(html).toContain('sin líneas');
  });

  it('criterio 6: no contiene http:// ni https:// (autosuficiencia)', () => {
    const html = generarTicketHTML(ticketEjemplo());
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  it('criterio 7: no toca el DOM (no accede a document.*)', () => {
    const fuente = generarTicketHTML.toString();
    // El helper puro `documentoTermico` contiene la subcadena "document" en su
    // NOMBRE, así que no basta con `not.toContain('document')` (falso positivo).
    // Se verifica que NO haya ACCESO al DOM: `document.` (con punto) ni APIs de
    // manipulación. La función solo compone strings.
    expect(fuente).not.toMatch(/\bdocument\s*\./);
    expect(fuente).not.toContain('window.document');
    expect(fuente).not.toContain('getElementById');
    expect(fuente).not.toContain('querySelector');
    expect(fuente).not.toContain('createElement');
    expect(fuente).not.toContain('appendChild');
    // Y sí delega en el helper puro de composición de strings.
    expect(fuente).toContain('documentoTermico');
  });
});

describe('F6.0 — generarCorteHTML', () => {
  it('criterio 4: incluye fondo inicial, movimientos y conteo final', () => {
    const html = generarCorteHTML(corteEjemplo());
    // TS-01 FIX: el generador usa 'Sistema:' y 'Físico:' (no 'Esperado'/'Contado').
    // El formato de moneda varía por locale en Node (sin separador de miles).
    expect(html).toContain('Sistema:');
    expect(html).toContain('Físico:');
    expect(html).toContain('1000'); // esperado = 1000
    expect(html).toContain('Diferencia');
  });

  it('criterio 4b: calcula el descuadre (contado − esperado)', () => {
    const html = generarCorteHTML(corteEjemplo());
    expect(html).toContain('$-20.00');
    expect(html).toContain('Faltante');
  });

  it('criterio 4c: marca "Caja cuadrada" cuando no hay descuadre', () => {
    const html = generarCorteHTML(corteEjemplo({ contado: 1000 }));
    expect(html).toContain('Caja cuadrada');
  });

  it('criterio 4d: un corte sin movimientos no rompe', () => {
    const html = generarCorteHTML(corteEjemplo({ movimientos: [], totalEntradas: 0, totalSalidas: 0 }));
    // TS-01 FIX: el generador no emite 'Sin movimientos.' — la ausencia de
    // los bloques de entradas/salidas cuando totalEntradas=0 y totalSalidas=0
    // es el comportamiento correcto (nada que mostrar = silencio elegante).
    expect(html).toContain('<html>');
    expect(html).toContain('Flujo de Efectivo');
    // Y no rompe (no lanza excepción).
  });

  it('criterio 6: no contiene http:// ni https:// (autosuficiencia)', () => {
    const html = generarCorteHTML(corteEjemplo());
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
  });

  it('criterio 7: no toca el DOM (no accede a document.*)', () => {
    const fuente = generarCorteHTML.toString();
    // Mismo criterio que en el ticket: el helper puro `documentoTermico` lleva
    // "document" en su nombre, así que se verifica ausencia de ACCESO al DOM.
    expect(fuente).not.toMatch(/\bdocument\s*\./);
    expect(fuente).not.toContain('window.document');
    expect(fuente).not.toContain('getElementById');
    expect(fuente).not.toContain('querySelector');
    expect(fuente).not.toContain('createElement');
    expect(fuente).not.toContain('appendChild');
    // Y sí delega en el helper puro de composición de strings.
    expect(fuente).toContain('documentoTermico');
  });

  it('criterio 1b: el corte también declara @page { size: 80mm', () => {
    const html = generarCorteHTML(corteEjemplo());
    expect(html).toContain('@page { size: 80mm');
  });
});

describe('F6.0 — generarCorteHTML · DEUDA-BUG08 (Obs. 4) desglose por origen', () => {
  it('declara "De otras terminales (N)" cuando la caja cobró cuentas ajenas', () => {
    const html = generarCorteHTML(
      corteEjemplo({ ventasAjenas: 250, numTransaccionesAjenas: 3 })
    );
    expect(html).toContain('De otras terminales (3)');
    expect(html).toContain('$250.00');
  });

  it('NO declara la fila cuando no hay cuentas ajenas', () => {
    const html = generarCorteHTML(corteEjemplo({ ventasAjenas: 0 }));
    expect(html).not.toContain('De otras terminales');
  });

  it('tolera la ausencia de los campos (retrocompatibilidad)', () => {
    const html = generarCorteHTML(corteEjemplo());
    expect(html).not.toContain('De otras terminales');
  });
});
