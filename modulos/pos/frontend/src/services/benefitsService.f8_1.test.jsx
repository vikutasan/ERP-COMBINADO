/**
 * Puerta de FASE 8.1 — Servicio de beneficios del cliente (contrato 26).
 *
 * Verifica los criterios de la puerta (Plan de Abordaje §3.2 FASE 8.1):
 *
 *   ✓ La operación existe y llama al endpoint correcto con el teléfono
 *   ✓ Éxito → `{ outcome:'ok', reason:null, data:{...} }`
 *   ✓ Un 404 se traduce a `reason: 'telefono_invalido'`
 *   ✓ Un 503 se traduce a `reason: 'crm_no_disponible'` (degradación DT-07)
 *   ✓ Teléfono vacío → NO llama al cliente, devuelve error local
 *   ✓ Reintentos: usa `withRetries` (3 intentos ante un fallo transitorio)
 *   ✓ NUNCA lanza: siempre devuelve un valor inspeccionable
 *
 * Se ejecuta con Vitest (jsdom): npm run test (en apps/pos)
 *
 * 30 Sep 2026.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// El mock del cliente debe declararse con vi.hoisted porque vi.mock se eleva
// por encima de los imports y necesita la referencia ya creada.
const apiSimulada = vi.hoisted(() => ({
  getBeneficiosParaTicket: vi.fn(),
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

import * as beneficios from './benefitsService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

/** Un carrito mínimo para las pruebas. */
function carritoEjemplo() {
  return {
    telefono: '5512345678',
    items: [{ product_id: 'p-1', qty: 2, unit_price: '35.00' }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 1 — La operación existe y llama al endpoint correcto
// ═══════════════════════════════════════════════════════════════════════════════

describe('benefitsService — superficie', () => {
  it('expone obtenerBeneficios (contrato 26)', () => {
    expect(typeof beneficios.obtenerBeneficios).toBe('function');
  });

  it('pasa el teléfono y los items al cliente', async () => {
    apiSimulada.getBeneficiosParaTicket.mockResolvedValue({ customer_id: null });

    await beneficios.obtenerBeneficios(carritoEjemplo());

    expect(apiSimulada.getBeneficiosParaTicket).toHaveBeenCalledWith({
      telefono: '5512345678',
      items: [{ product_id: 'p-1', qty: 2, unit_price: '35.00' }],
    });
  });

  it('recorta espacios del teléfono antes de llamar', async () => {
    apiSimulada.getBeneficiosParaTicket.mockResolvedValue({ customer_id: null });

    await beneficios.obtenerBeneficios({ telefono: '  5512345678  ', items: [] });

    expect(apiSimulada.getBeneficiosParaTicket).toHaveBeenCalledWith({
      telefono: '5512345678',
      items: [],
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 2 — Éxito: outcome 'ok' con la carga útil en data
// ═══════════════════════════════════════════════════════════════════════════════

describe('benefitsService — éxito', () => {
  it('devuelve ok con los beneficios del CRM', async () => {
    apiSimulada.getBeneficiosParaTicket.mockResolvedValue({
      customer_id: 'c-1',
      nombre: 'Ana',
      nivel: 'Oro',
      descuentos: [{ tipo: 'porcentaje', valor: '10', aplica_a: 'total', motivo: 'nivel' }],
      puntos_a_ganar: 12,
      puntos_disponibles: 340,
      puede_canjear: true,
    });

    const r = await beneficios.obtenerBeneficios(carritoEjemplo());

    expect(r.outcome).toBe('ok');
    expect(r.reason).toBeNull();
    expect(r.data.customer_id).toBe('c-1');
    expect(r.data.puntos_disponibles).toBe(340);
    expect(r.data.puede_canjear).toBe(true);
  });

  it('un cliente inexistente devuelve ok con customer_id null (200, no error)', async () => {
    // El contrato 26 garantiza: si el cliente no existe, es 200 con cero
    // beneficios, NO un error. El POS debe poder seguir cobrando.
    apiSimulada.getBeneficiosParaTicket.mockResolvedValue({
      customer_id: null,
      nombre: null,
      nivel: null,
      descuentos: [],
      puntos_a_ganar: 0,
      puntos_disponibles: 0,
      puede_canjear: false,
    });

    const r = await beneficios.obtenerBeneficios(carritoEjemplo());

    expect(r.outcome).toBe('ok');
    expect(r.data.customer_id).toBeNull();
    expect(r.data.descuentos).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 3 — Fallo: NUNCA lanza, siempre devuelve { outcome:'error', reason }
// ═══════════════════════════════════════════════════════════════════════════════

describe('benefitsService — fallo (nunca lanza)', () => {
  it('un 404 se traduce a telefono_invalido', async () => {
    apiSimulada.getBeneficiosParaTicket.mockRejectedValue(
      new apiSimulada.ApiError('teléfono no normalizable', 404)
    );

    const r = await beneficios.obtenerBeneficios(carritoEjemplo());

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('telefono_invalido');
    expect(r.data).toBeNull();
  });

  it('un 503 se traduce a crm_no_disponible (degradación DT-07)', async () => {
    apiSimulada.getBeneficiosParaTicket.mockRejectedValue(
      new apiSimulada.ApiError('CRM no disponible', 503)
    );

    const r = await beneficios.obtenerBeneficios(carritoEjemplo());

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('crm_no_disponible');
  });

  it('un fallo de red se traduce a sin_conexion', async () => {
    apiSimulada.getBeneficiosParaTicket.mockRejectedValue(
      new apiSimulada.ApiError('No se pudo contactar el API', 0)
    );

    const r = await beneficios.obtenerBeneficios(carritoEjemplo());

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('sin_conexion');
  });

  it('un 422 se traduce a datos_invalidos', async () => {
    apiSimulada.getBeneficiosParaTicket.mockRejectedValue(
      new apiSimulada.ApiError('Datos inválidos', 422)
    );

    const r = await beneficios.obtenerBeneficios(carritoEjemplo());

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('datos_invalidos');
  });

  it('un error no-ApiError se traduce a su mensaje', async () => {
    apiSimulada.getBeneficiosParaTicket.mockRejectedValue(new Error('boom'));

    const r = await beneficios.obtenerBeneficios(carritoEjemplo());

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('boom');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 4 — Reintentos: usa withRetries (3 intentos)
// ═══════════════════════════════════════════════════════════════════════════════

describe('benefitsService — reintentos', () => {
  it('reintenta ante un fallo transitorio y termina en ok', async () => {
    // Falla las 2 primeras veces, acierta la 3ª → withRetries debe recuperarlo.
    apiSimulada.getBeneficiosParaTicket
      .mockRejectedValueOnce(new apiSimulada.ApiError('parpadeo', 0))
      .mockRejectedValueOnce(new apiSimulada.ApiError('parpadeo', 0))
      .mockResolvedValueOnce({ customer_id: 'c-1', puntos_disponibles: 10 });

    const r = await beneficios.obtenerBeneficios(carritoEjemplo());

    expect(r.outcome).toBe('ok');
    expect(r.data.customer_id).toBe('c-1');
    expect(apiSimulada.getBeneficiosParaTicket).toHaveBeenCalledTimes(3);
  }, 15000);

  it('agota los 3 intentos y devuelve error', async () => {
    apiSimulada.getBeneficiosParaTicket.mockRejectedValue(
      new apiSimulada.ApiError('caído', 0)
    );

    const r = await beneficios.obtenerBeneficios(carritoEjemplo());

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('sin_conexion');
    expect(apiSimulada.getBeneficiosParaTicket).toHaveBeenCalledTimes(3);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 5 — Teléfono vacío: guarda local, NO llama al cliente
// ═══════════════════════════════════════════════════════════════════════════════

describe('benefitsService — guarda local', () => {
  it('teléfono vacío devuelve error sin llamar al cliente', async () => {
    const r = await beneficios.obtenerBeneficios({ telefono: '', items: [] });

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('telefono_requerido');
    expect(apiSimulada.getBeneficiosParaTicket).not.toHaveBeenCalled();
  });

  it('teléfono solo espacios devuelve error sin llamar al cliente', async () => {
    const r = await beneficios.obtenerBeneficios({ telefono: '   ', items: [] });

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('telefono_requerido');
    expect(apiSimulada.getBeneficiosParaTicket).not.toHaveBeenCalled();
  });

  it('teléfono no-string devuelve error sin llamar al cliente', async () => {
    const r = await beneficios.obtenerBeneficios({ telefono: undefined, items: [] });

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('telefono_requerido');
    expect(apiSimulada.getBeneficiosParaTicket).not.toHaveBeenCalled();
  });

  it('consulta nula devuelve error sin llamar al cliente', async () => {
    const r = await beneficios.obtenerBeneficios(null);

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('telefono_requerido');
    expect(apiSimulada.getBeneficiosParaTicket).not.toHaveBeenCalled();
  });
});
