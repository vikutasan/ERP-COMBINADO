/**
 * Puerta de FASE 5.1 — Servicio de cuentas abiertas (contrato 23).
 *
 * Verifica los criterios de la puerta (Plan de Abordaje §5 FASE 5.1):
 *
 *   ✓ La operación existe y llama al endpoint correcto con el terminal_id
 *   ✓ Éxito → `{ outcome:'ok', reason:null, data:{cuentas:[...]} }`
 *   ✓ Un fallo de red se traduce a `reason: 'sin_conexion'`
 *   ✓ Un 400 se traduce a `reason: 'terminal_invalida'`
 *   ✓ Reintentos: usa `withRetries` (3 intentos ante un fallo transitorio)
 *   ✓ `terminalId` vacío → NO llama al cliente, devuelve error local
 *   ✓ NUNCA lanza: siempre devuelve un valor inspeccionable
 *
 * Se ejecuta con Vitest (jsdom): npm run test (en apps/pos)
 *
 * 29 Sep 2026.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// El mock del cliente debe declararse con vi.hoisted porque vi.mock se eleva
// por encima de los imports y necesita la referencia ya creada.
const apiSimulada = vi.hoisted(() => ({
  listarCuentasAbiertas: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(mensaje, codigo, detalle) {
      super(mensaje);
      this.name = 'ApiError';
      this.codigo = codigo;
      this.detalle = detalle;
    }
  },
}));

vi.mock('../api/client.js', () => apiSimulada);

import * as cuentas from './openAccountsService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 1 — La operación existe y llama al endpoint correcto
// ═══════════════════════════════════════════════════════════════════════════════

describe('openAccountsService — superficie', () => {
  it('expone listarCuentasAbiertas (contrato 23)', () => {
    expect(typeof cuentas.listarCuentasAbiertas).toBe('function');
  });

  it('pasa el terminal_id al cliente', async () => {
    apiSimulada.listarCuentasAbiertas.mockResolvedValue({ cuentas: [] });

    await cuentas.listarCuentasAbiertas('TERM-01');

    expect(apiSimulada.listarCuentasAbiertas).toHaveBeenCalledWith('TERM-01');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 2 — Éxito: outcome 'ok' con la carga útil en data
// ═══════════════════════════════════════════════════════════════════════════════

describe('openAccountsService — éxito', () => {
  it('devuelve ok con la lista de cuentas', async () => {
    apiSimulada.listarCuentasAbiertas.mockResolvedValue({
      cuentas: [
        { id: 'a-1', account_num: 'F-001', status: 'OPEN', total: '120.00', version: 1 },
        { id: 'a-2', account_num: 'F-002', status: 'OPEN', total: '80.00', version: 3 },
      ],
    });

    const r = await cuentas.listarCuentasAbiertas('TERM-01');

    expect(r.outcome).toBe('ok');
    expect(r.reason).toBeNull();
    expect(r.data.cuentas).toHaveLength(2);
    expect(r.data.cuentas[0].account_num).toBe('F-001');
  });

  it('una terminal sin cuentas devuelve ok con lista vacía', async () => {
    apiSimulada.listarCuentasAbiertas.mockResolvedValue({ cuentas: [] });

    const r = await cuentas.listarCuentasAbiertas('TERM-02');

    expect(r.outcome).toBe('ok');
    expect(r.data.cuentas).toEqual([]);
  });

  it('recorta espacios del terminal_id antes de llamar', async () => {
    apiSimulada.listarCuentasAbiertas.mockResolvedValue({ cuentas: [] });

    await cuentas.listarCuentasAbiertas('  TERM-01  ');

    expect(apiSimulada.listarCuentasAbiertas).toHaveBeenCalledWith('TERM-01');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 3 — Fallo: NUNCA lanza, siempre devuelve { outcome:'error', reason }
// ═══════════════════════════════════════════════════════════════════════════════

describe('openAccountsService — fallo (nunca lanza)', () => {
  it('un fallo de red se traduce a sin_conexion', async () => {
    apiSimulada.listarCuentasAbiertas.mockRejectedValue(
      new apiSimulada.ApiError('No se pudo contactar el API', 0)
    );

    const r = await cuentas.listarCuentasAbiertas('TERM-01');

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('sin_conexion');
    expect(r.data).toBeNull();
  });

  it('un 400 se traduce a terminal_invalida', async () => {
    apiSimulada.listarCuentasAbiertas.mockRejectedValue(
      new apiSimulada.ApiError('terminal_id vacío', 400)
    );

    const r = await cuentas.listarCuentasAbiertas('TERM-01');

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('terminal_invalida');
  });

  it('un 422 se traduce a datos_invalidos', async () => {
    apiSimulada.listarCuentasAbiertas.mockRejectedValue(
      new apiSimulada.ApiError('Datos inválidos', 422)
    );

    const r = await cuentas.listarCuentasAbiertas('TERM-01');

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('datos_invalidos');
  });

  it('un error no-ApiError se traduce a su mensaje', async () => {
    apiSimulada.listarCuentasAbiertas.mockRejectedValue(new Error('boom'));

    const r = await cuentas.listarCuentasAbiertas('TERM-01');

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('boom');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 4 — Reintentos: usa withRetries (3 intentos)
// ═══════════════════════════════════════════════════════════════════════════════

describe('openAccountsService — reintentos', () => {
  it('reintenta ante un fallo transitorio y termina en ok', async () => {
    // Falla las 2 primeras veces, acierta la 3ª → withRetries debe recuperarlo.
    apiSimulada.listarCuentasAbiertas
      .mockRejectedValueOnce(new apiSimulada.ApiError('parpadeo', 0))
      .mockRejectedValueOnce(new apiSimulada.ApiError('parpadeo', 0))
      .mockResolvedValueOnce({ cuentas: [{ id: 'a-1' }] });

    const r = await cuentas.listarCuentasAbiertas('TERM-01');

    expect(r.outcome).toBe('ok');
    expect(r.data.cuentas).toHaveLength(1);
    expect(apiSimulada.listarCuentasAbiertas).toHaveBeenCalledTimes(3);
  }, 15000);

  it('agota los 3 intentos y devuelve error', async () => {
    apiSimulada.listarCuentasAbiertas.mockRejectedValue(
      new apiSimulada.ApiError('caído', 0)
    );

    const r = await cuentas.listarCuentasAbiertas('TERM-01');

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('sin_conexion');
    expect(apiSimulada.listarCuentasAbiertas).toHaveBeenCalledTimes(3);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 5 — terminalId vacío: guarda local, NO llama al cliente
// ═══════════════════════════════════════════════════════════════════════════════

describe('openAccountsService — guarda local', () => {
  it('terminalId vacío devuelve error sin llamar al cliente', async () => {
    const r = await cuentas.listarCuentasAbiertas('');

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('terminal_invalida');
    expect(apiSimulada.listarCuentasAbiertas).not.toHaveBeenCalled();
  });

  it('terminalId solo espacios devuelve error sin llamar al cliente', async () => {
    const r = await cuentas.listarCuentasAbiertas('   ');

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('terminal_invalida');
    expect(apiSimulada.listarCuentasAbiertas).not.toHaveBeenCalled();
  });

  it('terminalId no-string devuelve error sin llamar al cliente', async () => {
    const r = await cuentas.listarCuentasAbiertas(undefined);

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('terminal_invalida');
    expect(apiSimulada.listarCuentasAbiertas).not.toHaveBeenCalled();
  });
});
