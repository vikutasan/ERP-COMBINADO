/**
 * Puerta de FASE 4.4 — Plantilla de impresión del corte de caja.
 *
 * Verifica que `CorteTicketTemplate` existe, renderiza y cumple su contrato
 * visible (Plan de Fase 4 §8.4.3):
 *
 *   1. Renderiza el ARQUEO: esperado, contado y DIFERENCIA (descuadre).
 *   2. Clasifica el descuadre: cuadrada / faltante / sobrante.
 *   3. Renderiza la identidad del turno (cajero, apertura, cierre).
 *   4. Renderiza el desglose por método (efectivo, crédito, débito).
 *   5. Renderiza los movimientos del turno (o "sin movimientos").
 *   6. `calcularDescuadre` es la única fuente de verdad del descuadre.
 *
 * Decisión de diseño (§8.4.2): la plantilla SOLO RENDERIZA. No imprime.
 * Por eso este test NO busca llamadas a `window.print` ni similares.
 *
 * Reglas que se comprueban aquí (no en el backend):
 *   - R-01: el contenedor raíz es fluido (`w-full`), sin ancho fijo.
 *   - E-14: evidencia, no opinión — se lee el DOM, no se asume.
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import CorteTicketTemplate, { calcularDescuadre } from './CorteTicketTemplate.jsx';

afterEach(() => {
  cleanup();
});

/** Props base de un corte cuadrado. */
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

// ---------------------------------------------------------------------------
// 1. calcularDescuadre — la única fuente de verdad
// ---------------------------------------------------------------------------

describe('calcularDescuadre — contado − esperado', () => {
  it('devuelve 0 cuando la caja cuadra', () => {
    expect(calcularDescuadre(1500, 1500)).toBe(0);
  });

  it('devuelve negativo cuando hay faltante', () => {
    expect(calcularDescuadre(1500, 1480)).toBe(-20);
  });

  it('devuelve positivo cuando hay sobrante', () => {
    expect(calcularDescuadre(1500, 1525)).toBe(25);
  });

  it('tolera valores nulos o indefinidos sin romper', () => {
    expect(calcularDescuadre(null, null)).toBe(0);
    expect(calcularDescuadre(undefined, 100)).toBe(100);
    expect(calcularDescuadre(100, undefined)).toBe(-100);
  });
});

// ---------------------------------------------------------------------------
// 2. Arqueo — esperado, contado y diferencia
// ---------------------------------------------------------------------------

describe('CorteTicketTemplate — arqueo (esperado / contado / diferencia)', () => {
  it('renderiza el esperado y el contado formateados', () => {
    render(<CorteTicketTemplate {...corteBase()} />);
    expect(screen.getByTestId('esperado').textContent).toBe('$1500.00');
    expect(screen.getByTestId('contado').textContent).toBe('$1500.00');
  });

  it('renderiza la diferencia en cero cuando la caja cuadra', () => {
    render(<CorteTicketTemplate {...corteBase()} />);
    expect(screen.getByTestId('diferencia').textContent).toBe('$0.00');
    expect(screen.getByTestId('estado-cuadre').textContent).toContain('cuadrada');
  });

  it('marca FALTANTE cuando el contado es menor al esperado', () => {
    render(<CorteTicketTemplate {...corteBase({ contado: 1480 })} />);
    const diferencia = screen.getByTestId('diferencia').textContent;
    expect(diferencia).toContain('-');
    expect(diferencia).toContain('20.00');
    expect(screen.getByTestId('estado-cuadre').textContent).toContain('Faltante');
  });

  it('marca SOBRANTE cuando el contado es mayor al esperado', () => {
    render(<CorteTicketTemplate {...corteBase({ contado: 1525 })} />);
    expect(screen.getByTestId('diferencia').textContent).toBe('$25.00');
    expect(screen.getByTestId('estado-cuadre').textContent).toContain('Sobrante');
  });
});

// ---------------------------------------------------------------------------
// 3. Identidad del turno
// ---------------------------------------------------------------------------

describe('CorteTicketTemplate — identidad del turno', () => {
  it('renderiza el cajero, la apertura y el cierre', () => {
    render(<CorteTicketTemplate {...corteBase()} />);
    expect(screen.getByTestId('cajero').textContent).toBe('Ana López');
    expect(screen.getByTestId('apertura').textContent).not.toBe('—');
    expect(screen.getByTestId('cierre').textContent).not.toBe('—');
  });

  it('muestra "—" cuando faltan las fechas', () => {
    render(<CorteTicketTemplate {...corteBase({ abiertaEn: null, cerradaEn: null })} />);
    expect(screen.getByTestId('apertura').textContent).toBe('—');
    expect(screen.getByTestId('cierre').textContent).toBe('—');
  });

  it('muestra "—" cuando no hay cajero', () => {
    render(<CorteTicketTemplate {...corteBase({ cajero: null })} />);
    expect(screen.getByTestId('cajero').textContent).toBe('—');
  });

  it('muestra la terminal en el encabezado', () => {
    render(<CorteTicketTemplate {...corteBase({ terminalId: 'TERM-07' })} />);
    expect(screen.getByText('Term TERM-07')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. Desglose por método
// ---------------------------------------------------------------------------

describe('CorteTicketTemplate — desglose por método', () => {
  it('renderiza efectivo, crédito y débito', () => {
    render(<CorteTicketTemplate {...corteBase()} />);
    expect(screen.getByTestId('efectivo').textContent).toBe('$1500.00');
    expect(screen.getByTestId('credito').textContent).toBe('$320.00');
    expect(screen.getByTestId('debito').textContent).toBe('$180.00');
  });

  it('muestra $0.00 cuando no hay crédito ni débito', () => {
    render(<CorteTicketTemplate {...corteBase({ credito: 0, debito: 0 })} />);
    expect(screen.getByTestId('credito').textContent).toBe('$0.00');
    expect(screen.getByTestId('debito').textContent).toBe('$0.00');
  });
});

// ---------------------------------------------------------------------------
// 5. Movimientos del turno
// ---------------------------------------------------------------------------

describe('CorteTicketTemplate — movimientos del turno', () => {
  it('muestra "Sin movimientos" cuando la lista está vacía', () => {
    render(<CorteTicketTemplate {...corteBase({ movimientos: [] })} />);
    expect(screen.getByText('Sin movimientos.')).toBeTruthy();
    expect(screen.queryByTestId('movimientos')).toBeNull();
  });

  it('lista los movimientos con su motivo y monto', () => {
    render(
      <CorteTicketTemplate
        {...corteBase({
          movimientos: [
            { tipo: 'ENTRADA', motivo: 'Refuerzo', monto: 500 },
            { tipo: 'SALIDA', motivo: 'Retiro', monto: 200 },
          ],
        })}
      />
    );
    const lista = screen.getByTestId('movimientos');
    expect(lista.children.length).toBe(2);
    expect(lista.textContent).toContain('Refuerzo');
    expect(lista.textContent).toContain('$500.00');
    expect(lista.textContent).toContain('Retiro');
    expect(lista.textContent).toContain('$200.00');
  });
});

// ---------------------------------------------------------------------------
// 6. Contrato estructural (R-01) y decisión de diseño (§8.4.2)
// ---------------------------------------------------------------------------

describe('CorteTicketTemplate — contrato estructural', () => {
  it('el contenedor raíz es fluido (w-full) y sin ancho fijo (R-01)', () => {
    const { container } = render(<CorteTicketTemplate {...corteBase()} />);
    const raiz = container.querySelector('article');
    expect(raiz.className).toContain('w-full');
    // Un ancho MÁXIMO en píxeles es fluido y está permitido por R-01. Lo que
    // R-01 prohíbe es un ancho FIJO en píxeles (token que empieza con "w-[").
    const tokens = raiz.className.split(/\s+/);
    const anchoFijo = tokens.filter((t) => /^w-\[\d+px\]$/.test(t));
    expect(anchoFijo).toEqual([]);
  });

  it('es una plantilla de impresión: no imprime por sí misma (§8.4.2)', () => {
    // La plantilla solo renderiza. La impresión física es Fase 6.
    expect(typeof window.print).toBe('function');
    render(<CorteTicketTemplate {...corteBase()} />);
    expect(screen.getByText('Corte de Caja')).toBeTruthy();
  });
});
