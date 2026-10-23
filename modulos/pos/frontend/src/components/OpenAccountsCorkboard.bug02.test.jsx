/**
 * Puerta de BUG-02 — COLOR DEL POST-IT POR TERMINAL (vocabulario TERM-0X).
 *
 * @paridad: components/OpenAccountsCorkboard.bug02.test.jsx
 * @operacion: El color del post-it depende de la terminal (mapa heredado)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ VERIFICA
 * ─────────────────────────────────────────────────────────────────────────────
 * El pizarrón colorea cada post-it según la TERMINAL que creó la cuenta (no
 * según la persona que captura). El mapa de colores se heredó del viejo POS,
 * pero con las claves VIEJAS (`T6`, `T3`, …). El nuevo POS unificó los ids a
 * `TERM-01..TERM-06` (ver `useTerminals.js`, F7.7d), así que `colorDe('TERM-03')`
 * no encontraba la clave y caía al fallback `bg-yellow-100`: TODOS los post-its
 * salían amarillos.
 *
 * Esta compuerta fija el contrato REAL: con los ids `TERM-0X` que el backend
 * guarda en `tickets.terminal_id`, cada terminal recibe SU color.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FASE 13.3 (9 Oct 2026) — EL MAPA AHORA ES UNA PROP
 * ─────────────────────────────────────────────────────────────────────────────
 * El color por terminal dejó de ser una constante local (`COLOR_POR_TERMINAL`)
 * y ahora llega por la prop `coloresPorTerminal` (la construye `RetailVisionPOS`
 * desde la config de terminales). Estos tests pasan el mapa EXPLÍCITAMENTE para
 * fijar el contrato de `colorDe(terminal, coloresPorTerminal)`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS CRITERIOS
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. Cada terminal con color asignado recibe SU token.
 *   2. Una terminal SIN color asignado cae al fallback `bg-yellow-100`.
 *   3. Dos terminales distintas producen DOS colores distintos (la razón de ser
 *      del color: distinguir de un vistazo de qué terminal es cada cuenta).
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

import OpenAccountsCorkboard from './OpenAccountsCorkboard.jsx';

afterEach(() => {
  cleanup();
});

/** Una cuenta de ejemplo (proyección ligera, contrato 23). */
function cuenta(terminalId, extra = {}) {
  return {
    id: `id-${terminalId}`,
    account_num: 'T-0001',
    status: 'OPEN',
    total: '150.00',
    version: 3,
    terminal_id: terminalId,
    ...extra,
  };
}

/**
 * Servicio doble que devuelve una lista de cuentas.
 *
 * Expone AMBAS lecturas del contrato 23: la de terminal (`listarCuentasAbiertas`)
 * y la de CAJA (`listarTodasLasCuentasAbiertas`, D1). El modo CAJA del pizarrón
 * (`terminalId=""` + `cajaHabilitada`) usa la segunda; sin ella, el doble no
 * cubriría el camino real y el test 8 fallaría por un falso negativo.
 */
function servicioCon(cuentas) {
  const respuesta = async () => ({ outcome: 'ok', reason: null, data: { cuentas } });
  return {
    listarCuentasAbiertas: vi.fn(respuesta),
    listarTodasLasCuentasAbiertas: vi.fn(respuesta),
  };
}

/**
 * Renderiza el pizarrón con UNA cuenta de la terminal dada y devuelve el
 * elemento `<li>` del post-it (la tarjeta clickeable).
 */
async function renderPostIt(terminalId, coloresPorTerminal) {
  const { container } = render(
    <OpenAccountsCorkboard
      terminalId={terminalId}
      servicioCuentas={servicioCon([cuenta(terminalId)])}
      coloresPorTerminal={coloresPorTerminal}
    />
  );

  await waitFor(() => {
    expect(screen.getByTestId(`folio-id-${terminalId}`)).toBeTruthy();
  });

  return container.querySelector('li');
}

// ---------------------------------------------------------------------------
// 1..6 — Cada terminal recibe SU color (el que el usuario le asignó)
// ---------------------------------------------------------------------------

describe('BUG-02 — el color del post-it depende de la TERMINAL (ids TERM-0X)', () => {
  const mapa = {
    'TERM-06': 'bg-yellow-300',
    'TERM-05': 'bg-blue-300',
    'TERM-04': 'bg-lime-300',
    'TERM-03': 'bg-pink-300',
    'TERM-02': 'bg-purple-300',
    CAJA: 'bg-orange-300',
  };
  const casos = Object.entries(mapa);

  for (const [terminalId, claseEsperada] of casos) {
    it(`${terminalId} → ${claseEsperada}`, async () => {
      const postIt = await renderPostIt(terminalId, mapa);
      expect(postIt).toBeTruthy();
      expect(postIt.className).toContain(claseEsperada);
      // Y NO debe caer al fallback absoluto.
      expect(postIt.className).not.toContain('bg-yellow-100');
    });
  }
});

// ---------------------------------------------------------------------------
// 7 — Terminal sin color asignado: fallback amarillo (aviso "sin color")
// ---------------------------------------------------------------------------
// BUG-03 (9 Oct 2026): la asignación de color es MANUAL. Una terminal que no
// tenga color en el mapa NO recibe un color por hash: cae al amarillo claro,
// que es el aviso visual de "esta terminal no tiene color asignado".
describe('BUG-02 — terminal sin color cae al fallback amarillo', () => {
  it('una terminal fuera del mapa (ej. TERM-99) usa bg-yellow-100 (no rompe)', async () => {
    const postIt = await renderPostIt('TERM-99', { 'TERM-01': 'bg-cyan-300' });
    expect(postIt).toBeTruthy();
    expect(postIt.className).toContain('bg-yellow-100');
  });

  it('sin la prop coloresPorTerminal, TODAS caen al fallback amarillo', async () => {
    const postIt = await renderPostIt('TERM-03');
    expect(postIt).toBeTruthy();
    expect(postIt.className).toContain('bg-yellow-100');
  });
});

// ---------------------------------------------------------------------------
// 8 — Dos terminales distintas → dos colores distintos
// ---------------------------------------------------------------------------

describe('BUG-02 — dos terminales distintas se distinguen por color', () => {
  it('TERM-06 y TERM-03 producen colores distintos', async () => {
    const { container } = render(
      <OpenAccountsCorkboard
        terminalId=""
        cajaHabilitada
        servicioCuentas={servicioCon([
          cuenta('TERM-06', { id: 'id-a' }),
          cuenta('TERM-03', { id: 'id-b' }),
        ])}
        coloresPorTerminal={{
          'TERM-06': 'bg-yellow-300',
          'TERM-03': 'bg-pink-300',
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-id-a')).toBeTruthy();
      expect(screen.getByTestId('folio-id-b')).toBeTruthy();
    });

    const postIts = container.querySelectorAll('li');
    expect(postIts.length).toBe(2);

    const clases = Array.from(postIts).map((li) => li.className);
    const amarillo = clases.find((c) => c.includes('bg-yellow-300'));
    const rosa = clases.find((c) => c.includes('bg-pink-300'));

    expect(amarillo).toBeTruthy();
    expect(rosa).toBeTruthy();
    expect(amarillo).not.toBe(rosa);
  });
});
