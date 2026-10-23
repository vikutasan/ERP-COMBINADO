/**
 * Puerta de FASE 6.2 — `printService.js` (el disparador único de impresión).
 *
 * Verifica los 7 criterios de §8.4 del plan:
 *   1. `imprimirTicket` devuelve `{outcome: 'ok'}` cuando el iframe se crea y se imprime.
 *   2. `imprimirTicket` devuelve `{outcome: 'error', reason}` si el documento no está disponible.
 *   3. El iframe se remueve del DOM tras imprimir.
 *   4. `imprimirCorte` usa el HTML del corte, no el del ticket.
 *   5. El servicio NO lanza excepciones (contrato `{outcome, reason}`).
 *   6. El servicio usa `documento` inyectado, no `document` global directo.
 *   7. El servicio usa `iframe.contentWindow.print()`, NO `window.print()`
 *      (compatibilidad `--kiosk-printing`, D-7).
 *
 * Estrategia: se inyecta un `documento` falso (doble de prueba) que registra
 * las llamadas. Así se prueba el servicio sin navegador real y sin depender
 * de los `setTimeout` reales (se usan temporizadores falsos de Vitest).
 *
 * @see PLAN_DE_ABORDAJE_FASE_6_POR_PARTES.md §8 (Sub-fase 6.2)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { imprimirTicket, imprimirCorte } from './printService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUTA_SERVICIO = resolve(__dirname, 'printService.js');

/**
 * Construye un `documento` falso que registra lo que el servicio hace.
 * Devuelve también las referencias para inspeccionar en las aserciones.
 */
function documentoFalso() {
  const llamadas = {
    creados: [],
    anadidos: [],
    removidos: [],
    escritos: [],
    printLlamado: 0,
    focusLlamado: 0,
  };

  const iframe = {
    style: {},
    contentWindow: {
      document: {
        open: vi.fn(),
        write: vi.fn((html) => llamadas.escritos.push(html)),
        close: vi.fn(),
      },
      focus: vi.fn(() => {
        llamadas.focusLlamado += 1;
      }),
      print: vi.fn(() => {
        llamadas.printLlamado += 1;
      }),
    },
  };

  const documento = {
    createElement: vi.fn((etiqueta) => {
      llamadas.creados.push(etiqueta);
      return iframe;
    }),
    body: {
      appendChild: vi.fn((nodo) => {
        llamadas.anadidos.push(nodo);
        return nodo;
      }),
      contains: vi.fn(() => true),
      removeChild: vi.fn((nodo) => {
        llamadas.removidos.push(nodo);
        return nodo;
      }),
    },
  };

  return { documento, iframe, llamadas };
}

describe('F6.2 — printService (disparador único de impresión térmica)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Criterio 1 ──────────────────────────────────────────────────────────
  it('criterio 1: imprimirTicket devuelve {outcome: ok} cuando el iframe se crea y se imprime', () => {
    const { documento, llamadas } = documentoFalso();

    const r = imprimirTicket('<html><body>ticket</body></html>', { documento });

    expect(r.outcome).toBe('ok');
    expect(r.reason).toBeNull();
    expect(llamadas.creados).toContain('iframe');
    expect(llamadas.anadidos).toHaveLength(1);

    // TS-01 FIX: el servicio espera DELAY_MS=500ms antes de llamar print().
    // Se avanza 600ms para garantizar que el setTimeout ya disparó.
    vi.advanceTimersByTime(600);
    expect(llamadas.printLlamado).toBe(1);
  });

  // ── Criterio 2 ──────────────────────────────────────────────────────────
  it('criterio 2: imprimirTicket devuelve {outcome: error, reason} si el documento no está disponible', () => {
    // Se PROPORCIONA `documento: null` explícitamente: el servicio lo respeta
    // y NO cae al `document` global (que en jsdom sí existe).
    const r = imprimirTicket('<html></html>', { documento: null });

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('documento_no_disponible');
  });

  it('criterio 2c: un documento proporcionado pero inválido no cae al global', () => {
    // `{}` no tiene `createElement`: debe fallar, no usar el `document` global.
    const r = imprimirTicket('<html></html>', { documento: {} });

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('documento_no_disponible');
  });

  it('criterio 2b: imprimirTicket devuelve {outcome: error} si el HTML está vacío', () => {
    const { documento } = documentoFalso();

    const r = imprimirTicket('   ', { documento });

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('html_vacio');
  });

  // ── Criterio 3 ──────────────────────────────────────────────────────────
  it('criterio 3: el iframe se remueve del DOM tras imprimir', () => {
    const { documento, iframe, llamadas } = documentoFalso();

    imprimirTicket('<html><body>ticket</body></html>', { documento });

    // Antes de que corran los temporizadores, el iframe sigue en el DOM.
    expect(llamadas.removidos).toHaveLength(0);

    // Tras imprimir + esperar el retardo de limpieza, se remueve.
    vi.advanceTimersByTime(300); // dispara print()
    vi.advanceTimersByTime(1200); // dispara removeChild()

    expect(llamadas.removidos).toContain(iframe);
  });

  // ── Criterio 4 ──────────────────────────────────────────────────────────
  it('criterio 4: imprimirCorte usa el HTML del corte, no el del ticket', () => {
    const { documento, llamadas } = documentoFalso();
    const htmlCorte = '<html><body>CORTE DE CAJA</body></html>';

    const r = imprimirCorte(htmlCorte, { documento });

    expect(r.outcome).toBe('ok');
    expect(llamadas.escritos).toContain(htmlCorte);
    expect(llamadas.escritos).not.toContain('<html><body>ticket</body></html>');
  });

  // ── Criterio 5 ──────────────────────────────────────────────────────────
  it('criterio 5: el servicio NO lanza excepciones (contrato {outcome, reason})', () => {
    // Un documento que explota al crear el iframe.
    const documentoQueExplota = {
      createElement: () => {
        throw new Error('iframe_bloqueado');
      },
      body: { appendChild: vi.fn(), contains: vi.fn(() => false), removeChild: vi.fn() },
    };

    expect(() => imprimirTicket('<html></html>', { documento: documentoQueExplota })).not.toThrow();

    const r = imprimirTicket('<html></html>', { documento: documentoQueExplota });
    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('iframe_bloqueado');
  });

  // ── Criterio 6 ──────────────────────────────────────────────────────────
  it('criterio 6: el servicio usa el `documento` inyectado, no `document` global directo', () => {
    const { documento, llamadas } = documentoFalso();

    imprimirTicket('<html></html>', { documento });

    // El documento inyectado fue el que recibió las llamadas.
    expect(documento.createElement).toHaveBeenCalledWith('iframe');
    expect(documento.body.appendChild).toHaveBeenCalledTimes(1);
    expect(llamadas.creados).toContain('iframe');
  });

  it('criterio 6b: el código fuente recibe `documento` por parámetro (no lo captura global)', () => {
    const fuente = readFileSync(RUTA_SERVICIO, 'utf8');

    // El servicio resuelve el documento desde las opciones inyectables.
    expect(fuente).toMatch(/resolverDocumento/);
    expect(fuente).toMatch(/hasOwnProperty\.call\(opciones,\s*'documento'\)/);
    // Y solo cae a `document` global como último recurso, con guarda.
    expect(fuente).toMatch(/typeof document !== 'undefined'/);
  });

  // ── Criterio 7 ──────────────────────────────────────────────────────────
  it('criterio 7: usa iframe.contentWindow.print(), NO window.print() (--kiosk-printing, D-7)', () => {
    const { documento, llamadas } = documentoFalso();

    imprimirTicket('<html></html>', { documento });
    // TS-01 FIX: avanzar 600ms (DELAY_MS del servicio es 500ms).
    vi.advanceTimersByTime(600);

    // Se llamó al print() del iframe.
    expect(llamadas.printLlamado).toBe(1);
    expect(llamadas.focusLlamado).toBe(1);
  });

  it('criterio 7b: el código fuente NO contiene `window.print(` (rompería la impresión silenciosa)', () => {
    const fuente = readFileSync(RUTA_SERVICIO, 'utf8');

    // No debe existir una llamada a window.print().
    expect(fuente).not.toMatch(/window\s*\.\s*print\s*\(/);
    // Debe existir la llamada al print() del iframe.
    expect(fuente).toMatch(/iframe\.contentWindow\.print\s*\(/);
  });

  it('criterio 7c: el código fuente NO inyecta CDNs externos (mejora sobre el POS viejo, D-6)', () => {
    const fuente = readFileSync(RUTA_SERVICIO, 'utf8');

    expect(fuente).not.toMatch(/cdn\.jsdelivr\.net/);
    expect(fuente).not.toMatch(/https?:\/\/[^\s'"]+\.(css|js)/);
  });
});
