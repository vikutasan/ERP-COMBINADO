/**
 * Puerta de regresión — "los post-its salen amarillos" (10 Oct 2026).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EL BUG
 * ─────────────────────────────────────────────────────────────────────────────
 * Al persistir el ORDEN de terminales en el backend (commit `9c4d655`),
 * `fetchTerminalConfig()` cambió su forma de retorno: antes devolvía una LISTA
 * suelta (`[...]`), ahora devuelve un OBJETO `{ terminals, orden }`.
 *
 * `RetailVisionPOS` construía el mapa de colores del pizarrón con:
 *
 *     for (const t of config || []) { ... }
 *
 * Al iterar un OBJETO con `for...of` se lanza `TypeError: config is not
 * iterable`. El `catch {}` que envuelve la lectura lo SILENCIABA: el mapa
 * quedaba vacío y TODOS los post-its caían al amarillo por defecto
 * (`COLOR_SIN_ASIGNAR` = `bg-yellow-100`). El usuario lo reportó como "establecí
 * color desde el gestor y refresqué, pero siguen amarillos".
 *
 * La corrección centraliza la lectura en `construirColoresPorTerminal(config)`,
 * que tolera AMBOS formatos. Esta puerta fija ese contrato para que la regresión
 * no vuelva.
 *
 * @see services/terminalService.js (construirColoresPorTerminal)
 * @see RetailVisionPOS.jsx (useEffect que alimenta `coloresPorTerminal`)
 */

import { describe, it, expect } from 'vitest';
import { construirColoresPorTerminal } from './terminalService.js';

describe('construirColoresPorTerminal — el color del post-it llega al pizarrón', () => {
  it('lee el formato NUEVO `{ terminals, orden }` (el que rompió el pizarrón)', () => {
    const config = {
      orden: 'izq-der',
      terminals: [
        { id: 'TERM-01', name: 'Terminal 1', icon: '🖥️', color: 'bg-blue-400' },
        { id: 'TERM-02', name: 'Terminal 2', icon: '🖥️', color: 'bg-green-400' },
      ],
    };

    expect(construirColoresPorTerminal(config)).toEqual({
      'TERM-01': 'bg-blue-400',
      'TERM-02': 'bg-green-400',
    });
  });

  it('tolera el formato VIEJO (lista suelta) por retrocompatibilidad', () => {
    const config = [
      { id: 'TERM-01', name: 'Terminal 1', icon: '🖥️', color: 'bg-rose-400' },
    ];

    expect(construirColoresPorTerminal(config)).toEqual({ 'TERM-01': 'bg-rose-400' });
  });

  it('OMITE las terminales SIN color (caen al amarillo por defecto)', () => {
    const config = {
      orden: 'izq-der',
      terminals: [
        { id: 'TERM-01', name: 'Terminal 1', icon: '🖥️', color: null },
        { id: 'TERM-02', name: 'Terminal 2', icon: '🖥️', color: 'bg-violet-400' },
      ],
    };

    const mapa = construirColoresPorTerminal(config);
    expect(mapa).toEqual({ 'TERM-02': 'bg-violet-400' });
    // La terminal sin color NO debe aparecer: el pizarrón usa `COLOR_SIN_ASIGNAR`.
    expect(mapa['TERM-01']).toBeUndefined();
  });

  it('un objeto sin `terminals` produce un mapa vacío (no lanza)', () => {
    expect(construirColoresPorTerminal({ orden: 'der-izq' })).toEqual({});
  });

  it('entradas nulas/indefinidas producen un mapa vacío (no lanza)', () => {
    expect(construirColoresPorTerminal(null)).toEqual({});
    expect(construirColoresPorTerminal(undefined)).toEqual({});
  });

  it('ignora entradas malformadas (sin id o sin color)', () => {
    const config = {
      terminals: [
        { name: 'sin id', color: 'bg-blue-400' },
        { id: 'TERM-09', name: 'sin color' },
        null,
      ],
    };

    expect(construirColoresPorTerminal(config)).toEqual({});
  });
});
