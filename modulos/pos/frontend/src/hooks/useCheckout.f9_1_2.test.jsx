/**
 * Puerta de FASE 9.1.2 — Servicio + hook de cobro (pagos mixtos).
 *
 * @paridad: hooks/useCheckout.f9_1_2.test.jsx
 * @operacion: El cobro del ticket (efectivo/tarjeta)
 *
 * Verifica los criterios del plan (§3.3):
 *   A. SERVICIO (`checkoutService.js`):
 *      A1. Construye el `payment_details` canónico con N pagos.
 *      A2. Efectivo adjunta `recibido` y `cambio`; tarjeta adjunta `tipo`.
 *      A3. Rechaza una suma que NO cuadra el total (RN-94 en la frontera).
 *      A4. Rechaza método inválido y monto inválido.
 *      A5. NUNCA lanza: siempre devuelve `{outcome, reason, data}`.
 *      A6. `resumenDePagos` calcula abonado/faltante/cambio/cuadra.
 *   B. HOOK (`useCheckout.js`):
 *      B1. Expone la superficie esperada.
 *      B2. `agregarPago` acumula y actualiza el resumen.
 *      B3. `editarPago` cambia un abono por id.
 *      B4. `borrarPago` quita un abono por id.
 *      B5. `puedeCobrar` es true SOLO cuando la suma cuadra.
 *      B6. `construirPayload` devuelve el contrato del servicio.
 *
 * @see PLAN_DE_ABORDAJE_FASE_9_1_PAGOS_MIXTOS.md §3.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  construirPaymentDetails,
  resumenDePagos,
  calcularCambio,
  normalizarMetodo,
  aMonto,
} from '../services/checkoutService.js';
import { useCheckout } from './useCheckout.js';

beforeEach(() => {
  // Nada que limpiar: el servicio es puro y el hook se monta por test.
});

// ───────────────────────────────────────────────────────────────────────────
// A. SERVICIO
// ───────────────────────────────────────────────────────────────────────────

describe('F9.1.2 — A1: construye el payment_details canónico', () => {
  it('arma la lista de pagos con la forma que el backend entiende', () => {
    const r = construirPaymentDetails({
      abonos: [
        { metodo: 'EFECTIVO', monto: 40, recibido: 50 },
        { metodo: 'DEBITO', monto: 60 },
      ],
      total: 100,
      cajero: 'Ana',
    });
    expect(r.outcome).toBe('ok');
    expect(r.data.pagos).toHaveLength(2);
    expect(r.data.pagos[0]).toEqual({
      metodo: 'EFECTIVO',
      monto: '40.00',
      recibido: '50.00',
      cambio: '10.00',
    });
    expect(r.data.pagos[1]).toEqual({
      metodo: 'DEBITO',
      monto: '60.00',
      tipo: 'DEBITO',
    });
    expect(r.data.cajero).toBe('Ana');
  });
});

describe('F9.1.2 — A2: efectivo vs tarjeta', () => {
  it('el efectivo sin `recibido` asume recibido = monto (cambio 0)', () => {
    const r = construirPaymentDetails({
      abonos: [{ metodo: 'EFECTIVO', monto: 100 }],
      total: 100,
    });
    expect(r.outcome).toBe('ok');
    expect(r.data.pagos[0].recibido).toBe('100.00');
    expect(r.data.pagos[0].cambio).toBe('0.00');
  });

  it('la tarjeta NO lleva recibido ni cambio', () => {
    const r = construirPaymentDetails({
      abonos: [{ metodo: 'CREDITO', monto: 100 }],
      total: 100,
    });
    expect(r.data.pagos[0]).not.toHaveProperty('recibido');
    expect(r.data.pagos[0]).not.toHaveProperty('cambio');
    expect(r.data.pagos[0].tipo).toBe('CREDITO');
  });
});

describe('F9.1.2 — A3: la suma DEBE cuadrar (RN-94 en la frontera)', () => {
  it('rechaza cuando la suma es menor al total', () => {
    const r = construirPaymentDetails({
      abonos: [{ metodo: 'EFECTIVO', monto: 40 }],
      total: 100,
    });
    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('suma_no_cuadra');
    expect(r.data).toEqual({ suma: '40.00', total: '100.00' });
  });

  it('rechaza cuando la suma excede el total', () => {
    const r = construirPaymentDetails({
      abonos: [{ metodo: 'EFECTIVO', monto: 120 }],
      total: 100,
    });
    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('suma_no_cuadra');
  });

  it('acepta cuando la suma cuadra exactamente (3 pagos)', () => {
    const r = construirPaymentDetails({
      abonos: [
        { metodo: 'EFECTIVO', monto: 30 },
        { metodo: 'DEBITO', monto: 40 },
        { metodo: 'TRANSFERENCIA', monto: 30 },
      ],
      total: 100,
    });
    expect(r.outcome).toBe('ok');
    expect(r.data.pagos).toHaveLength(3);
  });
});

describe('F9.1.2 — A4: método y monto inválidos', () => {
  it('rechaza un método desconocido', () => {
    const r = construirPaymentDetails({
      abonos: [{ metodo: 'BITCOIN', monto: 100 }],
      total: 100,
    });
    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('metodo_invalido');
  });

  it('rechaza un monto no positivo', () => {
    const r = construirPaymentDetails({
      abonos: [{ metodo: 'EFECTIVO', monto: 0 }],
      total: 100,
    });
    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('monto_invalido');
  });

  it('rechaza una lista vacía', () => {
    const r = construirPaymentDetails({ abonos: [], total: 100 });
    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('sin_pagos');
  });
});

describe('F9.1.2 — A5: el servicio NUNCA lanza', () => {
  it('con entradas basura devuelve un fallo inspeccionable', () => {
    expect(() => construirPaymentDetails()).not.toThrow();
    expect(() => construirPaymentDetails({ abonos: null, total: 'x' })).not.toThrow();
    const r = construirPaymentDetails({ abonos: [null], total: 100 });
    expect(r.outcome).toBe('error');
  });
});

describe('F9.1.2 — A6: helpers del servicio', () => {
  it('resumenDePagos calcula abonado/faltante/cambio/cuadra', () => {
    expect(resumenDePagos([{ monto: 40 }], 100)).toEqual({
      abonado: 40,
      faltante: 60,
      cambio: 0,
      cuadra: false,
    });
    expect(resumenDePagos([{ monto: 100 }], 100)).toEqual({
      abonado: 100,
      faltante: 0,
      cambio: 0,
      cuadra: true,
    });
    expect(resumenDePagos([{ monto: 120 }], 100)).toEqual({
      abonado: 120,
      faltante: 0,
      cambio: 20,
      cuadra: true,
    });
  });

  it('calcularCambio nunca es negativo', () => {
    expect(calcularCambio(40, 50)).toBe(10);
    expect(calcularCambio(40, 30)).toBe(0);
  });

  it('normalizarMetodo y aMonto', () => {
    expect(normalizarMetodo('efectivo')).toBe('EFECTIVO');
    expect(normalizarMetodo('nope')).toBeNull();
    expect(aMonto(10.005)).toBe('10.01');
    expect(aMonto('abc')).toBe('0.00');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A7. FIX "suma_no_cuadra" (4ª VUELTA) — el servicio tolera un TOTAL con error
//     de coma flotante (p. ej. `33.33 × 3 = 99.99000000000001`). El backend
//     compara con `Decimal` EXACTO (RN-94, DT-02), así que la frontera debe
//     redondear a 2 decimales antes de decidir si la suma cuadra.
// ───────────────────────────────────────────────────────────────────────────

describe('FIX "suma_no_cuadra" (4ª vuelta) — total flotante en el servicio', () => {
  const TOTAL_FLOTANTE = 33.33 * 3; // 99.99000000000001

  it('un abono con el total flotante cuadra (no devuelve suma_no_cuadra)', () => {
    const r = construirPaymentDetails({
      abonos: [{ metodo: 'EFECTIVO', monto: 99.99, recibido: 100 }],
      total: TOTAL_FLOTANTE,
    });
    expect(r.outcome).toBe('ok');
    expect(r.data.pagos[0].monto).toBe('99.99');
  });

  it('un abono con monto flotante se redondea antes de sumar', () => {
    const r = construirPaymentDetails({
      abonos: [{ metodo: 'EFECTIVO', monto: TOTAL_FLOTANTE, recibido: 100 }],
      total: TOTAL_FLOTANTE,
    });
    expect(r.outcome).toBe('ok');
    // El monto serializado es 99.99, no 99.99000000000001.
    expect(r.data.pagos[0].monto).toBe('99.99');
  });

  it('pago mixto con total flotante cuadra exacto', () => {
    const r = construirPaymentDetails({
      abonos: [
        { metodo: 'EFECTIVO', monto: 50, recibido: 50 },
        { metodo: 'DEBITO', monto: 49.99 },
      ],
      total: TOTAL_FLOTANTE,
    });
    expect(r.outcome).toBe('ok');
    const suma = r.data.pagos.reduce((acc, p) => acc + Number(p.monto), 0);
    expect(Math.round(suma * 100) / 100).toBe(99.99);
  });

  it('un cobro realmente corto sigue rechazándose (sin regresión)', () => {
    const r = construirPaymentDetails({
      abonos: [{ metodo: 'EFECTIVO', monto: 99.98, recibido: 100 }],
      total: TOTAL_FLOTANTE,
    });
    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('suma_no_cuadra');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// B. HOOK
// ───────────────────────────────────────────────────────────────────────────

describe('F9.1.2 — B1: superficie del hook', () => {
  it('expone abonos, resumen, puedeCobrar, cambio, faltante y acciones', () => {
    const { result } = renderHook(() => useCheckout({ total: 100 }));
    expect(result.current).toHaveProperty('abonos');
    expect(result.current).toHaveProperty('resumen');
    expect(result.current).toHaveProperty('puedeCobrar');
    expect(result.current).toHaveProperty('cambio');
    expect(result.current).toHaveProperty('faltante');
    expect(typeof result.current.agregarPago).toBe('function');
    expect(typeof result.current.editarPago).toBe('function');
    expect(typeof result.current.borrarPago).toBe('function');
    expect(typeof result.current.limpiarPagos).toBe('function');
    expect(typeof result.current.construirPayload).toBe('function');
  });
});

describe('F9.1.2 — B2: agregarPago acumula y actualiza el resumen', () => {
  it('agrega dos abonos y el resumen refleja el faltante', () => {
    const { result } = renderHook(() => useCheckout({ total: 100 }));
    act(() => {
      result.current.agregarPago({ metodo: 'EFECTIVO', monto: 40, recibido: 50 });
    });
    expect(result.current.abonos).toHaveLength(1);
    expect(result.current.faltante).toBe(60);
    expect(result.current.puedeCobrar).toBe(false);

    act(() => {
      result.current.agregarPago({ metodo: 'DEBITO', monto: 60 });
    });
    expect(result.current.abonos).toHaveLength(2);
    expect(result.current.faltante).toBe(0);
    expect(result.current.puedeCobrar).toBe(true);
  });

  it('ignora un abono inválido y devuelve null', () => {
    const { result } = renderHook(() => useCheckout({ total: 100 }));
    let devuelto;
    act(() => {
      devuelto = result.current.agregarPago({ metodo: 'EFECTIVO', monto: 0 });
    });
    expect(devuelto).toBeNull();
    expect(result.current.abonos).toHaveLength(0);
  });
});

describe('F9.1.2 — B3: editarPago', () => {
  it('cambia el monto de un abono por id', () => {
    const { result } = renderHook(() => useCheckout({ total: 100 }));
    let creado;
    act(() => {
      creado = result.current.agregarPago({ metodo: 'EFECTIVO', monto: 40 });
    });
    act(() => {
      result.current.editarPago(creado.id, { monto: 100 });
    });
    expect(result.current.abonos[0].monto).toBe(100);
    expect(result.current.puedeCobrar).toBe(true);
  });

  it('devuelve false si el id no existe', () => {
    const { result } = renderHook(() => useCheckout({ total: 100 }));
    let ok;
    act(() => {
      ok = result.current.editarPago('no-existe', { monto: 10 });
    });
    expect(ok).toBe(false);
  });
});

describe('F9.1.2 — B4: borrarPago', () => {
  it('quita un abono por id y recalcula el faltante', () => {
    const { result } = renderHook(() => useCheckout({ total: 100 }));
    let a;
    act(() => {
      a = result.current.agregarPago({ metodo: 'EFECTIVO', monto: 40 });
      result.current.agregarPago({ metodo: 'DEBITO', monto: 60 });
    });
    expect(result.current.puedeCobrar).toBe(true);
    act(() => {
      result.current.borrarPago(a.id);
    });
    expect(result.current.abonos).toHaveLength(1);
    expect(result.current.faltante).toBe(40);
    expect(result.current.puedeCobrar).toBe(false);
  });
});

describe('F9.1.2 — B5: puedeCobrar exige suma cuadrada', () => {
  it('es false con la lista vacía y true solo al cuadrar', () => {
    const { result } = renderHook(() => useCheckout({ total: 100 }));
    expect(result.current.puedeCobrar).toBe(false);
    act(() => {
      result.current.agregarPago({ metodo: 'EFECTIVO', monto: 100 });
    });
    expect(result.current.puedeCobrar).toBe(true);
  });
});

describe('F9.1.2 — B6: construirPayload delega en el servicio', () => {
  it('devuelve el contrato {outcome, reason, data} con los pagos', async () => {
    const { result } = renderHook(() => useCheckout({ total: 100, cajero: 'Luis' }));
    act(() => {
      result.current.agregarPago({ metodo: 'EFECTIVO', monto: 40, recibido: 50 });
      result.current.agregarPago({ metodo: 'DEBITO', monto: 60 });
    });
    let r;
    await act(async () => {
      r = await result.current.construirPayload();
    });
    expect(r.outcome).toBe('ok');
    expect(r.data.pagos).toHaveLength(2);
    expect(r.data.cajero).toBe('Luis');
  });

  it('devuelve fallo si la suma no cuadra', async () => {
    const { result } = renderHook(() => useCheckout({ total: 100 }));
    act(() => {
      result.current.agregarPago({ metodo: 'EFECTIVO', monto: 40 });
    });
    let r;
    await act(async () => {
      r = await result.current.construirPayload();
    });
    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('suma_no_cuadra');
  });
});
