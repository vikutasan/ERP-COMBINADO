/**
 * Puerta de FASE 7.7c — Regresión del 422 al tomar una terminal.
 *
 * El bug que el usuario reportó ("aun no puedo entrar a ninguna terminal") tenía
 * una TERCERA causa, más profunda que las dos anteriores:
 *
 *   1. El router `/pos/terminals/*` no existía (404). → F7.7.
 *   2. El status exponía `occupier_id` como UUID y el frontend comparaba contra
 *      el id original (`1`), así que el dueño se veía "ocupado por otro". → F7.7b.
 *   3. El contrato declara `user_id`/`usuario_id` como `str`, pero el usuario que
 *      entrega el ERP trae el id como NÚMERO (`1`). `JSON.stringify` lo serializa
 *      como `1` (sin comillas) y Pydantic v2 lo rechaza con **422
 *      "Input should be a valid string"**. → F7.7c (este archivo).
 *
 * La corrección vive en la FRONTERA del servicio/cliente: el id se coerciona a
 * string antes de serializar. Estos tests fijan esa coerción para que el 422 no
 * vuelva, sin importar si el id llega como número o como texto.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  lockTerminal,
  unlockTerminal,
  fetchTerminalStatuses,
  fetchTerminalConfig,
  saveTerminalConfig,
} from './terminalService.js';

/** Captura el cuerpo JSON que el servicio envía al `fetch`. */
function interceptarFetch(respuesta = { success: true, message: 'ok' }) {
  const llamadas = [];
  global.fetch = vi.fn(async (url, opciones = {}) => {
    llamadas.push({ url, opciones, cuerpo: opciones.body ? JSON.parse(opciones.body) : null });
    return {
      ok: true,
      status: 200,
      json: async () => respuesta,
    };
  });
  return llamadas;
}

describe('terminalService — el id de usuario viaja SIEMPRE como string (F7.7c)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lockTerminal coerciona un id numérico a string (el caso que daba 422)', async () => {
    const llamadas = interceptarFetch();
    await lockTerminal('TERM-01', 1);

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].cuerpo).toEqual({ terminal_id: 'TERM-01', user_id: '1' });
    // El tipo importa: un número aquí es exactamente lo que Pydantic rechaza.
    expect(typeof llamadas[0].cuerpo.user_id).toBe('string');
  });

  it('lockTerminal conserva un id que ya es string', async () => {
    const llamadas = interceptarFetch();
    await lockTerminal('TERM-02', 'cajero-1');

    expect(llamadas[0].cuerpo).toEqual({ terminal_id: 'TERM-02', user_id: 'cajero-1' });
  });

  it('unlockTerminal coerciona el id numérico a string', async () => {
    const llamadas = interceptarFetch();
    await unlockTerminal('TERM-03', 7);

    expect(llamadas[0].cuerpo).toEqual({ terminal_id: 'TERM-03', user_id: '7' });
    expect(typeof llamadas[0].cuerpo.user_id).toBe('string');
  });

  it('el cuerpo serializado NO contiene un número sin comillas para user_id', async () => {
    const llamadas = interceptarFetch();
    await lockTerminal('TERM-04', 42);

    // La prueba directa del bug: el JSON crudo debe traer "42", no 42.
    expect(llamadas[0].opciones.body).toContain('"user_id":"42"');
    expect(llamadas[0].opciones.body).not.toContain('"user_id":42');
  });

  it('un id nulo o indefinido se normaliza a cadena vacía (no rompe la serialización)', async () => {
    const llamadas = interceptarFetch();
    await lockTerminal('TERM-05', null);
    expect(llamadas[0].cuerpo.user_id).toBe('');

    await lockTerminal('TERM-06', undefined);
    expect(llamadas[1].cuerpo.user_id).toBe('');
  });

  it('las lecturas (status/config) no llevan cuerpo y siguen funcionando', async () => {
    const llamadas = interceptarFetch({});
    await fetchTerminalStatuses();
    await fetchTerminalConfig();

    expect(llamadas[0].url).toContain('/pos/terminals/status');
    expect(llamadas[1].url).toContain('/pos/terminals/config');
    expect(llamadas[0].cuerpo).toBeNull();
  });

  it('saveTerminalConfig envía la lista tal cual (sin coerción de ids de terminal)', async () => {
    const llamadas = interceptarFetch();
    const terminales = [{ id: 'TERM-01', name: 'Caja 1', icon: '🖥️' }];
    await saveTerminalConfig(terminales);

    expect(llamadas[0].cuerpo).toEqual({ terminals: terminales });
  });
});
