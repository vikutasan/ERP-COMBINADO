/**
 * Puerta de FASE 6.1 — `TicketTemplate.jsx` (interfaz 23, Impresión).
 *
 * Verifica que la plantilla del TICKET DE VENTA renderiza el contrato declarado
 * de la interfaz 23 del registro de la superficie:
 *
 *   contenedor_raiz = "w-[58mm] font-mono" · paleta = ("#fdfbf7",) ·
 *   exenta_responsiva = True.
 *
 * Los 8 criterios de la puerta (§7.4 del plan de Fase 6):
 *   1. Renderiza el encabezado con "R DE RICO" y "Ticket de Venta".
 *   2. Renderiza el número de cuenta y la fecha.
 *   3. Renderiza cada línea con cantidad, nombre y precio.
 *   4. Renderiza el total.
 *   5. El contenedor raíz usa `w-[58mm]` y `font-mono`.
 *   6. La plantilla NO llama a `window.print` (solo renderiza).
 *   7. Un ticket vacío muestra "Ticket vacío" sin romper.
 *   8. El comentario de `CorteTicketTemplate.jsx` dice "interfaz 24" (D-8).
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import TicketTemplate, { totalArticulos } from './TicketTemplate.jsx';

afterEach(() => {
  cleanup();
});

/** Una línea de ticket de ejemplo (forma del POS nuevo). */
function lineaEjemplo(extra = {}) {
  return {
    nombre: 'Concha de Vainilla',
    cantidad: 2,
    precio_unitario: 18.5,
    ...extra,
  };
}

/** Un ticket de ejemplo completo. */
function ticketEjemplo(extra = {}) {
  return {
    accountNum: 'A-0042',
    total: 37.0,
    terminalId: 'TERM-01',
    createdAt: '2026-09-29T18:30:00.000Z',
    lineas: [lineaEjemplo()],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Criterio 1 — Encabezado
// ---------------------------------------------------------------------------

describe('criterio 1: encabezado "R DE RICO" + "Ticket de Venta"', () => {
  it('renderiza el nombre del negocio y el título del documento', () => {
    render(<TicketTemplate {...ticketEjemplo()} />);
    expect(screen.getByText('R DE RICO')).toBeTruthy();
    expect(screen.getByText('Ticket de Venta')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Criterio 2 — Identidad (cuenta + fecha)
// ---------------------------------------------------------------------------

describe('criterio 2: número de cuenta y fecha', () => {
  it('renderiza el número de cuenta', () => {
    render(<TicketTemplate {...ticketEjemplo()} />);
    expect(screen.getByTestId('cuenta').textContent).toContain('A-0042');
  });

  it('renderiza la fecha formateada (no el ISO crudo)', () => {
    render(<TicketTemplate {...ticketEjemplo()} />);
    const fecha = screen.getByTestId('fecha').textContent;
    expect(fecha).not.toContain('2026-09-29T');
    expect(fecha.length).toBeGreaterThan(0);
  });

  it('muestra un guion cuando no hay cuenta', () => {
    render(<TicketTemplate {...ticketEjemplo({ accountNum: null })} />);
    expect(screen.getByTestId('cuenta').textContent).toContain('---');
  });
});

// ---------------------------------------------------------------------------
// Criterio 3 — Líneas (cantidad, nombre, precio)
// ---------------------------------------------------------------------------

describe('criterio 3: cada línea con cantidad, nombre y precio', () => {
  it('renderiza la cantidad, el nombre y el importe de la línea', () => {
    render(<TicketTemplate {...ticketEjemplo()} />);
    const linea = screen.getByTestId('linea-0');
    expect(linea.textContent).toContain('2x');
    // El nombre se muestra en mayúsculas por CSS (`uppercase`), no por el texto.
    expect(linea.textContent).toContain('Concha de Vainilla');
    expect(linea.textContent).toContain('$18.50');
    expect(linea.textContent).toContain('$37.00');
  });

  it('renderiza varias líneas en orden', () => {
    const lineas = [
      lineaEjemplo({ nombre: 'Bolillo', cantidad: 3, precio_unitario: 4.0 }),
      lineaEjemplo({ nombre: 'Concha', cantidad: 1, precio_unitario: 18.5 }),
    ];
    render(<TicketTemplate {...ticketEjemplo({ lineas })} />);
    expect(screen.getByTestId('linea-0').textContent).toContain('Bolillo');
    expect(screen.getByTestId('linea-1').textContent).toContain('Concha');
  });

  it('acepta la forma en inglés del POS viejo (name/quantity/unit_price)', () => {
    const lineas = [{ name: 'Dona', quantity: 4, unit_price: 12.0 }];
    render(<TicketTemplate {...ticketEjemplo({ lineas })} />);
    const linea = screen.getByTestId('linea-0');
    expect(linea.textContent).toContain('Dona');
    expect(linea.textContent).toContain('4x');
    expect(linea.textContent).toContain('$48.00');
  });
});

// ---------------------------------------------------------------------------
// Criterio 4 — Total
// ---------------------------------------------------------------------------

describe('criterio 4: total y conteo de artículos', () => {
  it('renderiza el total formateado', () => {
    render(<TicketTemplate {...ticketEjemplo({ total: 123.45 })} />);
    expect(screen.getByTestId('total').textContent).toContain('$123.45');
  });

  it('renderiza el conteo total de artículos', () => {
    const lineas = [
      lineaEjemplo({ cantidad: 2 }),
      lineaEjemplo({ nombre: 'Bolillo', cantidad: 3 }),
    ];
    render(<TicketTemplate {...ticketEjemplo({ lineas })} />);
    expect(screen.getByTestId('articulos').textContent).toContain('5');
  });

  it('totalArticulos suma cantidades y tolera entradas inválidas', () => {
    expect(totalArticulos([{ cantidad: 2 }, { cantidad: 3 }])).toBe(5);
    expect(totalArticulos([])).toBe(0);
    expect(totalArticulos(null)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Criterio 5 — Contrato de superficie (w-[58mm] font-mono)
// ---------------------------------------------------------------------------

describe('criterio 5: contenedor raíz w-[58mm] font-mono', () => {
  it('el contenedor raíz declara el ancho físico y la fuente mono', () => {
    const { container } = render(<TicketTemplate {...ticketEjemplo()} />);
    const raiz = container.querySelector('article');
    expect(raiz).toBeTruthy();
    expect(raiz.className).toContain('w-[58mm]');
    expect(raiz.className).toContain('font-mono');
  });

  it('usa la paleta crema del ticket (#fdfbf7 vía bg-crema-ticket)', () => {
    const { container } = render(<TicketTemplate {...ticketEjemplo()} />);
    const raiz = container.querySelector('article');
    expect(raiz.className).toContain('bg-crema-ticket');
  });
});

// ---------------------------------------------------------------------------
// Criterio 6 — Solo renderiza, no imprime
// ---------------------------------------------------------------------------

describe('criterio 6: la plantilla NO llama a window.print', () => {
  it('no invoca window.print al renderizar', () => {
    const espia = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<TicketTemplate {...ticketEjemplo()} />);
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  it('el código fuente no contiene window.print ni document.write', () => {
    const aqui = dirname(fileURLToPath(import.meta.url));
    const fuente = readFileSync(join(aqui, 'TicketTemplate.jsx'), 'utf8');
    expect(fuente).not.toMatch(/window\s*\.\s*print/);
    expect(fuente).not.toMatch(/document\s*\.\s*write/);
  });
});

// ---------------------------------------------------------------------------
// Criterio 7 — Ticket vacío
// ---------------------------------------------------------------------------

describe('criterio 7: ticket vacío no rompe', () => {
  it('muestra "Ticket vacío" cuando no hay líneas', () => {
    render(<TicketTemplate {...ticketEjemplo({ lineas: [] })} />);
    expect(screen.getByTestId('ticket-vacio').textContent).toContain('Ticket vacío');
  });

  it('renderiza sin props (todo por defecto) sin lanzar', () => {
    expect(() => render(<TicketTemplate />)).not.toThrow();
    expect(screen.getByTestId('ticket-vacio')).toBeTruthy();
  });

  it('tolera lineas no-array sin romper', () => {
    expect(() => render(<TicketTemplate {...ticketEjemplo({ lineas: null })} />)).not.toThrow();
    expect(screen.getByTestId('ticket-vacio')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Criterio 8 — Deuda documental D-8 corregida
// ---------------------------------------------------------------------------

describe('criterio 8: CorteTicketTemplate declara "interfaz 24" (D-8)', () => {
  it('el comentario de cabecera dice "interfaz 24" y no "interfaz 15"', () => {
    const aqui = dirname(fileURLToPath(import.meta.url));
    const fuente = readFileSync(join(aqui, 'CorteTicketTemplate.jsx'), 'utf8');
    expect(fuente).toContain('interfaz 24');
    expect(fuente).not.toContain('interfaz 15');
  });
});
