/**
 * Puerta de FASE 13.2a — Servicio de auditoría (contrato 5).
 *
 * Verifica los criterios de la puerta (Plan de Abordaje F13 §13.2a):
 *
 *   ✓ La operación existe y llama al endpoint correcto con `desde` y `hasta`
 *   ✓ Éxito → `{ outcome:'ok', reason:null, data:{eventos:[...]} }`
 *   ✓ Un fallo de red se traduce a `reason: 'sin_conexion'`
 *   ✓ Un 400 se traduce a `reason: 'rango_invalido'` (desde > hasta, RN-77)
 *   ✓ Reintentos: usa `withRetries` (3 intentos ante un fallo transitorio)
 *   ✓ Rango incompleto → NO llama al cliente, devuelve error local
 *   ✓ NUNCA lanza: siempre devuelve un valor inspeccionable
 *   ✓ La proyección conserva los 5 campos (O-23), sin transformar la forma
 *
 * Se ejecuta con Vitest (jsdom): npm run test (en apps/pos)
 *
 * 6 Oct 2026.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// El mock del cliente debe declararse con vi.hoisted porque vi.mock se eleva
// por encima de los imports y necesita la referencia ya creada.
const apiSimulada = vi.hoisted(() => ({
  listarEventosAuditables: vi.fn(),
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

import * as auditoria from './auditService.js';

const DESDE = '2026-10-06T00:00:00.000Z';
const HASTA = '2026-10-06T23:59:59.999Z';

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 1 — La operación existe y llama al endpoint correcto
// ═══════════════════════════════════════════════════════════════════════════════

describe('auditService — superficie', () => {
  it('expone listarEventosAuditables (contrato 5)', () => {
    expect(typeof auditoria.listarEventosAuditables).toBe('function');
  });

  it('pasa desde y hasta al cliente', async () => {
    apiSimulada.listarEventosAuditables.mockResolvedValue({ eventos: [] });

    await auditoria.listarEventosAuditables(DESDE, HASTA);

    expect(apiSimulada.listarEventosAuditables).toHaveBeenCalledWith(DESDE, HASTA);
  });

  it('acepta objetos Date y los normaliza a ISO-8601', async () => {
    apiSimulada.listarEventosAuditables.mockResolvedValue({ eventos: [] });

    await auditoria.listarEventosAuditables(new Date(DESDE), new Date(HASTA));

    expect(apiSimulada.listarEventosAuditables).toHaveBeenCalledWith(DESDE, HASTA);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 2 — Éxito: outcome 'ok' con la carga útil en data
// ═══════════════════════════════════════════════════════════════════════════════

describe('auditService — éxito', () => {
  it('devuelve ok con la lista de eventos', async () => {
    apiSimulada.listarEventosAuditables.mockResolvedValue({
      eventos: [
        {
          tipo: 'ticket_creado',
          ticket_id: 't-1',
          usuario_id: 'u-1',
          timestamp: DESDE,
          detalle: { total: '120.00' },
        },
        {
          tipo: 'ticket_cobrado',
          ticket_id: 't-1',
          usuario_id: 'u-2',
          timestamp: HASTA,
          detalle: { metodo: 'efectivo' },
        },
      ],
    });

    const r = await auditoria.listarEventosAuditables(DESDE, HASTA);

    expect(r.outcome).toBe('ok');
    expect(r.reason).toBeNull();
    expect(r.data.eventos).toHaveLength(2);
    expect(r.data.eventos[0].tipo).toBe('ticket_creado');
  });

  it('un rango sin eventos devuelve ok con lista vacía', async () => {
    apiSimulada.listarEventosAuditables.mockResolvedValue({ eventos: [] });

    const r = await auditoria.listarEventosAuditables(DESDE, HASTA);

    expect(r.outcome).toBe('ok');
    expect(r.data.eventos).toEqual([]);
  });

  it('NO transforma la forma: conserva los 5 campos de la proyección (O-23)', async () => {
    const evento = {
      tipo: 'ticket_creado',
      ticket_id: 't-1',
      usuario_id: 'u-1',
      timestamp: DESDE,
      detalle: { total: '120.00' },
    };
    apiSimulada.listarEventosAuditables.mockResolvedValue({ eventos: [evento] });

    const r = await auditoria.listarEventosAuditables(DESDE, HASTA);

    expect(r.data.eventos[0]).toEqual(evento);
    expect(Object.keys(r.data.eventos[0]).sort()).toEqual(
      ['detalle', 'ticket_id', 'timestamp', 'tipo', 'usuario_id']
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 3 — Fallo: NUNCA lanza, siempre devuelve { outcome:'error', reason }
// ═══════════════════════════════════════════════════════════════════════════════

describe('auditService — fallo (nunca lanza)', () => {
  it('un fallo de red se traduce a sin_conexion', async () => {
    apiSimulada.listarEventosAuditables.mockRejectedValue(
      new apiSimulada.ApiError('No se pudo contactar el API', 0)
    );

    const r = await auditoria.listarEventosAuditables(DESDE, HASTA);

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('sin_conexion');
    expect(r.data).toBeNull();
  });

  it('un 400 se traduce a rango_invalido (desde > hasta, RN-77)', async () => {
    apiSimulada.listarEventosAuditables.mockRejectedValue(
      new apiSimulada.ApiError('El rango de fechas es inválido', 400)
    );

    const r = await auditoria.listarEventosAuditables(HASTA, DESDE);

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('rango_invalido');
  });

  it('un 422 se traduce a datos_invalidos', async () => {
    apiSimulada.listarEventosAuditables.mockRejectedValue(
      new apiSimulada.ApiError('Datos inválidos', 422)
    );

    const r = await auditoria.listarEventosAuditables(DESDE, HASTA);

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('datos_invalidos');
  });

  it('un error no-ApiError se traduce a su mensaje', async () => {
    apiSimulada.listarEventosAuditables.mockRejectedValue(new Error('boom'));

    const r = await auditoria.listarEventosAuditables(DESDE, HASTA);

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('boom');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 4 — Reintentos: usa withRetries (3 intentos)
// ═══════════════════════════════════════════════════════════════════════════════

describe('auditService — reintentos', () => {
  it('reintenta ante un fallo transitorio y termina en ok', async () => {
    // Falla las 2 primeras veces, acierta la 3ª → withRetries debe recuperarlo.
    apiSimulada.listarEventosAuditables
      .mockRejectedValueOnce(new apiSimulada.ApiError('parpadeo', 0))
      .mockRejectedValueOnce(new apiSimulada.ApiError('parpadeo', 0))
      .mockResolvedValueOnce({ eventos: [{ tipo: 'ticket_creado' }] });

    const r = await auditoria.listarEventosAuditables(DESDE, HASTA);

    expect(r.outcome).toBe('ok');
    expect(r.data.eventos).toHaveLength(1);
    expect(apiSimulada.listarEventosAuditables).toHaveBeenCalledTimes(3);
  }, 15000);

  it('agota los 3 intentos y devuelve error', async () => {
    apiSimulada.listarEventosAuditables.mockRejectedValue(
      new apiSimulada.ApiError('caído', 0)
    );

    const r = await auditoria.listarEventosAuditables(DESDE, HASTA);

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('sin_conexion');
    expect(apiSimulada.listarEventosAuditables).toHaveBeenCalledTimes(3);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 5 — Rango incompleto: guarda local, NO llama al cliente
// ═══════════════════════════════════════════════════════════════════════════════

describe('auditService — guarda local', () => {
  it('desde vacío devuelve error sin llamar al cliente', async () => {
    const r = await auditoria.listarEventosAuditables('', HASTA);

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('rango_invalido');
    expect(apiSimulada.listarEventosAuditables).not.toHaveBeenCalled();
  });

  it('hasta vacío devuelve error sin llamar al cliente', async () => {
    const r = await auditoria.listarEventosAuditables(DESDE, '');

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('rango_invalido');
    expect(apiSimulada.listarEventosAuditables).not.toHaveBeenCalled();
  });

  it('desde solo espacios devuelve error sin llamar al cliente', async () => {
    const r = await auditoria.listarEventosAuditables('   ', HASTA);

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('rango_invalido');
    expect(apiSimulada.listarEventosAuditables).not.toHaveBeenCalled();
  });

  it('un extremo no-string/no-Date devuelve error sin llamar al cliente', async () => {
    const r = await auditoria.listarEventosAuditables(undefined, HASTA);

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('rango_invalido');
    expect(apiSimulada.listarEventosAuditables).not.toHaveBeenCalled();
  });

  it('un Date inválido devuelve error sin llamar al cliente', async () => {
    const r = await auditoria.listarEventosAuditables(new Date('no-es-fecha'), HASTA);

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('rango_invalido');
    expect(apiSimulada.listarEventosAuditables).not.toHaveBeenCalled();
  });
});
