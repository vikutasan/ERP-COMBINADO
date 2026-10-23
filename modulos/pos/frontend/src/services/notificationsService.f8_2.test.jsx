/**
 * Puerta de FASE 8.2 — Servicio de notificaciones (contrato 27).
 *
 * Verifica los criterios de la puerta (Plan de Abordaje §3.3 FASE 8.2):
 *
 *   ✓ La operación existe y llama al endpoint correcto con el evento_id
 *   ✓ Éxito → `{ outcome:'ok', reason:null, data:{...} }`
 *   ✓ Un 422 se traduce a `reason: 'destinatario_incompleto'`
 *   ✓ Un 503 se traduce a `reason: 'cola_no_disponible'` (degradación DT-07)
 *   ✓ evento_id vacío → NO llama al cliente, devuelve error local
 *   ✓ Reintentos: usa `withRetries` (3 intentos ante un fallo transitorio)
 *   ✓ NUNCA lanza: siempre devuelve un valor inspeccionable
 *   ✓ El POS NO revierte el cobro: un fallo de la cola no es un fallo de venta
 *
 * Se ejecuta con Vitest (jsdom): npm run test (en apps/pos)
 *
 * 30 Sep 2026.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// El mock del cliente debe declararse con vi.hoisted porque vi.mock se eleva
// por encima de los imports y necesita la referencia ya creada.
const apiSimulada = vi.hoisted(() => ({
  encolarTicket: vi.fn(),
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

import * as notificaciones from './notificationsService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

/** Una solicitud mínima de encolado para las pruebas. */
function solicitudEjemplo(extra = {}) {
  return {
    evento_id: 'evt-ticket-001',
    ticket_uuid: 't-0001',
    canales: ['WHATSAPP'],
    destinatario: { telefono: '5512345678' },
    payload: { folio: 'A-0001', total: '70.00', items: 2, fecha: '2026-09-30T10:00:00Z' },
    ...extra,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 1 — La operación existe y llama al endpoint correcto
// ═══════════════════════════════════════════════════════════════════════════════

describe('notificationsService — superficie', () => {
  it('expone encolarTicket (contrato 27)', () => {
    expect(typeof notificaciones.encolarTicket).toBe('function');
  });

  it('expone los canales soportados (WHATSAPP, EMAIL)', () => {
    expect(notificaciones.CANALES_SOPORTADOS).toEqual(['WHATSAPP', 'EMAIL']);
  });

  it('pasa el evento_id, el ticket y los canales al cliente', async () => {
    apiSimulada.encolarTicket.mockResolvedValue({ encolado: true, mensajes: [] });

    await notificaciones.encolarTicket(solicitudEjemplo());

    expect(apiSimulada.encolarTicket).toHaveBeenCalledWith({
      evento_id: 'evt-ticket-001',
      ticket_uuid: 't-0001',
      canales: ['WHATSAPP'],
      destinatario: { telefono: '5512345678' },
      payload: { folio: 'A-0001', total: '70.00', items: 2, fecha: '2026-09-30T10:00:00Z' },
    });
  });

  it('recorta espacios del evento_id antes de llamar', async () => {
    apiSimulada.encolarTicket.mockResolvedValue({ encolado: true, mensajes: [] });

    await notificaciones.encolarTicket(solicitudEjemplo({ evento_id: '  evt-x  ' }));

    expect(apiSimulada.encolarTicket).toHaveBeenCalledWith(
      expect.objectContaining({ evento_id: 'evt-x' })
    );
  });

  it('normaliza canales ausentes a un arreglo vacío', async () => {
    apiSimulada.encolarTicket.mockResolvedValue({ encolado: true, mensajes: [] });

    await notificaciones.encolarTicket(solicitudEjemplo({ canales: undefined }));

    expect(apiSimulada.encolarTicket).toHaveBeenCalledWith(
      expect.objectContaining({ canales: [] })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 2 — Éxito: outcome 'ok' con la carga útil en data
// ═══════════════════════════════════════════════════════════════════════════════

describe('notificationsService — éxito', () => {
  it('devuelve ok con el resultado del encolado', async () => {
    apiSimulada.encolarTicket.mockResolvedValue({
      encolado: true,
      mensajes: [{ canal: 'WHATSAPP', estado: 'PENDIENTE' }],
    });

    const r = await notificaciones.encolarTicket(solicitudEjemplo());

    expect(r.outcome).toBe('ok');
    expect(r.reason).toBeNull();
    expect(r.data.encolado).toBe(true);
    expect(r.data.mensajes[0].canal).toBe('WHATSAPP');
  });

  it('un encolado con varios canales devuelve ok con todos los mensajes', async () => {
    apiSimulada.encolarTicket.mockResolvedValue({
      encolado: true,
      mensajes: [
        { canal: 'WHATSAPP', estado: 'PENDIENTE' },
        { canal: 'EMAIL', estado: 'PENDIENTE' },
      ],
    });

    const r = await notificaciones.encolarTicket(
      solicitudEjemplo({ canales: ['WHATSAPP', 'EMAIL'] })
    );

    expect(r.outcome).toBe('ok');
    expect(r.data.mensajes).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 3 — Fallo: se traduce a un reason legible y NUNCA lanza
// ═══════════════════════════════════════════════════════════════════════════════

describe('notificationsService — fallo (nunca lanza)', () => {
  it('un 422 se traduce a destinatario_incompleto', async () => {
    apiSimulada.encolarTicket.mockRejectedValue(
      new apiSimulada.ApiError('destinatario inválido', 422)
    );

    const r = await notificaciones.encolarTicket(solicitudEjemplo());

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('destinatario_incompleto');
    expect(r.data).toBeNull();
  });

  it('un 503 se traduce a cola_no_disponible (degradación DT-07)', async () => {
    apiSimulada.encolarTicket.mockRejectedValue(
      new apiSimulada.ApiError('cola caída', 503)
    );

    const r = await notificaciones.encolarTicket(solicitudEjemplo());

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('cola_no_disponible');
  });

  it('un fallo de red (codigo 0) se traduce a sin_conexion', async () => {
    apiSimulada.encolarTicket.mockRejectedValue(
      new apiSimulada.ApiError('sin red', 0)
    );

    const r = await notificaciones.encolarTicket(solicitudEjemplo());

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('sin_conexion');
  });

  it('un error inesperado no rompe la firma: devuelve error con mensaje', async () => {
    apiSimulada.encolarTicket.mockRejectedValue(new Error('boom'));

    const r = await notificaciones.encolarTicket(solicitudEjemplo());

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('boom');
  });

  it('NUNCA lanza: la promesa siempre resuelve', async () => {
    apiSimulada.encolarTicket.mockRejectedValue(new Error('explosión'));

    await expect(
      notificaciones.encolarTicket(solicitudEjemplo())
    ).resolves.toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 4 — Reintentos: usa withRetries ante un fallo transitorio
// ═══════════════════════════════════════════════════════════════════════════════

describe('notificationsService — reintentos', () => {
  it('reintenta y termina en ok si el segundo intento funciona', async () => {
    apiSimulada.encolarTicket
      .mockRejectedValueOnce(new apiSimulada.ApiError('parpadeo', 0))
      .mockResolvedValueOnce({ encolado: true, mensajes: [] });

    const r = await notificaciones.encolarTicket(solicitudEjemplo());

    expect(r.outcome).toBe('ok');
    expect(apiSimulada.encolarTicket).toHaveBeenCalledTimes(2);
  }, 15000);

  it('agota los 3 intentos y devuelve error si siempre falla', async () => {
    apiSimulada.encolarTicket.mockRejectedValue(
      new apiSimulada.ApiError('caído', 0)
    );

    const r = await notificaciones.encolarTicket(solicitudEjemplo());

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('sin_conexion');
    expect(apiSimulada.encolarTicket).toHaveBeenCalledTimes(3);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 5 — Guarda local: sin evento_id no se llama al cliente
// ═══════════════════════════════════════════════════════════════════════════════

describe('notificationsService — guarda local', () => {
  it('sin evento_id devuelve error local y NO llama al cliente', async () => {
    const r = await notificaciones.encolarTicket(solicitudEjemplo({ evento_id: '' }));

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('evento_id_requerido');
    expect(apiSimulada.encolarTicket).not.toHaveBeenCalled();
  });

  it('un evento_id solo con espacios se trata como vacío', async () => {
    const r = await notificaciones.encolarTicket(solicitudEjemplo({ evento_id: '   ' }));

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('evento_id_requerido');
    expect(apiSimulada.encolarTicket).not.toHaveBeenCalled();
  });

  it('una solicitud nula devuelve error local sin lanzar', async () => {
    const r = await notificaciones.encolarTicket(null);

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('evento_id_requerido');
    expect(apiSimulada.encolarTicket).not.toHaveBeenCalled();
  });

  it('un evento_id no-string se trata como vacío', async () => {
    const r = await notificaciones.encolarTicket(solicitudEjemplo({ evento_id: 12345 }));

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('evento_id_requerido');
    expect(apiSimulada.encolarTicket).not.toHaveBeenCalled();
  });
});
