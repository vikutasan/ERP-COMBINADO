/**
 * Puerta de FASE 4.2 — Servicio de caja (contratos 9–14).
 *
 * Verifica los criterios de la puerta (Plan de Abordaje §6 FASE 4.2):
 *
 *   ✓ Las 6 operaciones existen y llaman al endpoint correcto
 *   ✓ Toda operación devuelve `{ outcome, reason, data }` — NUNCA lanza
 *   ✓ Un fallo de red se traduce a `reason: 'sin_conexion'`
 *   ✓ Un 409 (turno ya abierto) se traduce a `reason: 'ya_hay_turno_abierto'`
 *   ✓ El éxito devuelve `outcome: 'ok'` con la carga útil en `data`
 *
 * Se ejecuta con Vitest (jsdom): npm run test (en apps/pos)
 *
 * 29 Sep 2026.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// El mock del cliente debe declararse con vi.hoisted porque vi.mock se eleva
// por encima de los imports y necesita la referencia ya creada.
const apiSimulada = vi.hoisted(() => ({
  getSesionCajaActiva: vi.fn(),
  abrirTurno: vi.fn(),
  registrarMovimiento: vi.fn(),
  getResumenTurno: vi.fn(),
  cerrarTurno: vi.fn(),
  getReporteDiario: vi.fn(),
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

import * as caja from './cashService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 1 — Las 6 operaciones existen
// ═══════════════════════════════════════════════════════════════════════════════

describe('cashService — superficie', () => {
  it('expone las 6 operaciones de caja (contratos 9–14)', () => {
    expect(typeof caja.obtenerTurnoActivo).toBe('function');
    expect(typeof caja.abrirTurno).toBe('function');
    expect(typeof caja.registrarMovimiento).toBe('function');
    expect(typeof caja.obtenerResumen).toBe('function');
    expect(typeof caja.cerrarTurno).toBe('function');
    expect(typeof caja.obtenerReporteDiario).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 2 — Éxito: outcome 'ok' con la carga útil en data
// ═══════════════════════════════════════════════════════════════════════════════

describe('cashService — éxito', () => {
  it('obtenerTurnoActivo devuelve ok con la sesión', async () => {
    apiSimulada.getSesionCajaActiva.mockResolvedValue({
      cash_session_id: 'caja-1',
      abierta_en: '2026-09-29T06:00:00Z',
    });

    const r = await caja.obtenerTurnoActivo();

    expect(r.outcome).toBe('ok');
    expect(r.reason).toBeNull();
    expect(r.data.cash_session_id).toBe('caja-1');
    expect(apiSimulada.getSesionCajaActiva).toHaveBeenCalledTimes(1);
  });

  // FIX "habilitar caja" (2ª vuelta) — el endpoint EXIGE `terminal_id`
  // (Query(...)). Sin él el API responde 422 y el POS nunca sabe que la caja
  // ya está habilitada: el botón se quedaba en "○ Habilitar" y la guarda de
  // cobro seguía activa. Este test fija que el `terminalId` se reenvía.
  it('obtenerTurnoActivo reenvía el terminalId al cliente', async () => {
    apiSimulada.getSesionCajaActiva.mockResolvedValue({ cash_session_id: 'caja-1' });

    await caja.obtenerTurnoActivo('TERM-03');

    expect(apiSimulada.getSesionCajaActiva).toHaveBeenCalledWith('TERM-03');
  });

  it('abrirTurno pasa el cuerpo tal cual al cliente', async () => {
    apiSimulada.abrirTurno.mockResolvedValue({ cash_session_id: 'caja-2' });

    const cuerpo = { terminal_id: 'TERM-01', usuario_id: 'u-1', monto_inicial: 100 };
    const r = await caja.abrirTurno(cuerpo);

    expect(r.outcome).toBe('ok');
    expect(apiSimulada.abrirTurno).toHaveBeenCalledWith(cuerpo);
  });

  it('registrarMovimiento devuelve el id del movimiento', async () => {
    apiSimulada.registrarMovimiento.mockResolvedValue({ movement_id: 'mov-1' });

    const r = await caja.registrarMovimiento({
      cash_session_id: 'caja-1',
      tipo: 'ENTRADA',
      monto: 200,
      motivo: 'refuerzo',
    });

    expect(r.outcome).toBe('ok');
    expect(r.data.movement_id).toBe('mov-1');
  });

  it('obtenerResumen devuelve el esperado del turno', async () => {
    apiSimulada.getResumenTurno.mockResolvedValue({
      esperado: '270.00',
      movimientos: [{ tipo: 'ENTRADA', monto: '200.00' }],
    });

    const r = await caja.obtenerResumen('caja-1');

    expect(r.outcome).toBe('ok');
    expect(r.data.esperado).toBe('270.00');
    expect(apiSimulada.getResumenTurno).toHaveBeenCalledWith('caja-1');
  });

  it('cerrarTurno devuelve la diferencia del arqueo', async () => {
    apiSimulada.cerrarTurno.mockResolvedValue({
      esperado: '270.00',
      capturado: '260.00',
      diferencia: '-10.00',
    });

    const r = await caja.cerrarTurno({
      cash_session_id: 'caja-1',
      montos_fisicos: 260,
      credito: 0,
      debito: 0,
    });

    expect(r.outcome).toBe('ok');
    expect(r.data.diferencia).toBe('-10.00');
  });

  it('obtenerReporteDiario pasa la fecha en la ruta', async () => {
    apiSimulada.getReporteDiario.mockResolvedValue({
      fecha: '2026-09-29',
      reporte: [],
    });

    const r = await caja.obtenerReporteDiario('2026-09-29');

    expect(r.outcome).toBe('ok');
    expect(apiSimulada.getReporteDiario).toHaveBeenCalledWith('2026-09-29');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 3 — Fallo: NUNCA lanza, siempre devuelve { outcome:'error', reason }
// ═══════════════════════════════════════════════════════════════════════════════

describe('cashService — fallo (nunca lanza)', () => {
  it('un fallo de red se traduce a sin_conexion', async () => {
    apiSimulada.getSesionCajaActiva.mockRejectedValue(
      new apiSimulada.ApiError('No se pudo contactar el API', 0)
    );

    const r = await caja.obtenerTurnoActivo();

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('sin_conexion');
    expect(r.data).toBeNull();
  });

  it('un 409 al abrir turno se traduce a ya_hay_turno_abierto', async () => {
    apiSimulada.abrirTurno.mockRejectedValue(
      new apiSimulada.ApiError('Ya hay un turno abierto', 409)
    );

    const r = await caja.abrirTurno({
      terminal_id: 'TERM-01',
      usuario_id: 'u-1',
      monto_inicial: 100,
    });

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('ya_hay_turno_abierto');
  });

  it('un 404 al leer el resumen se traduce a turno_no_encontrado', async () => {
    apiSimulada.getResumenTurno.mockRejectedValue(
      new apiSimulada.ApiError('Turno no encontrado', 404)
    );

    const r = await caja.obtenerResumen('caja-inexistente');

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('turno_no_encontrado');
  });

  it('un 422 al cerrar turno se traduce a datos_invalidos', async () => {
    apiSimulada.cerrarTurno.mockRejectedValue(
      new apiSimulada.ApiError('Datos inválidos', 422)
    );

    const r = await caja.cerrarTurno({
      cash_session_id: 'caja-1',
      montos_fisicos: -5,
      credito: 0,
      debito: 0,
    });

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('datos_invalidos');
  });

  it('un error inesperado no rompe el contrato', async () => {
    apiSimulada.registrarMovimiento.mockRejectedValue(new Error('boom'));

    const r = await caja.registrarMovimiento({
      cash_session_id: 'caja-1',
      tipo: 'SALIDA',
      monto: 30,
      motivo: 'gasto',
    });

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('boom');
  });

  it('ninguna operación lanza aunque el cliente falle', async () => {
    const error = new apiSimulada.ApiError('caído', 500);
    apiSimulada.getSesionCajaActiva.mockRejectedValue(error);
    apiSimulada.abrirTurno.mockRejectedValue(error);
    apiSimulada.registrarMovimiento.mockRejectedValue(error);
    apiSimulada.getResumenTurno.mockRejectedValue(error);
    apiSimulada.cerrarTurno.mockRejectedValue(error);
    apiSimulada.getReporteDiario.mockRejectedValue(error);

    const resultados = await Promise.all([
      caja.obtenerTurnoActivo(),
      caja.abrirTurno({}),
      caja.registrarMovimiento({}),
      caja.obtenerResumen('x'),
      caja.cerrarTurno({}),
      caja.obtenerReporteDiario('2026-09-29'),
    ]);

    for (const r of resultados) {
      expect(r.outcome).toBe('error');
      expect(typeof r.reason).toBe('string');
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });
});
