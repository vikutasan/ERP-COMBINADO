/**
 * Puerta de FASE 10.6.2 — Eliminar movimiento del Gestor de Caja (frontend).
 *
 * Verifica que `GestorDeCaja` recupera la OPERACIÓN del viejo POS: borrar un
 * movimiento mal capturado mientras el turno sigue abierto (RN-52). La
 * IMPLEMENTACIÓN se reescribe (§6.8): el botón ✕ abre un modal de advertencia
 * (FIX-BUG17, feedback #3) y, al confirmar, llama al servicio y refresca el
 * resumen; el backend aplica la regla.
 *
 *   1. Cada movimiento del resumen muestra un botón ✕ de eliminar.
 *   2. Pulsar ✕ abre el modal de confirmación (NO borra directo).
 *   3. Confirmar llama a `servicio.eliminarMovimiento` con el movement_id.
 *   4. Tras eliminar, el resumen se vuelve a consultar (refresco).
 *   5. Si el servicio falla, se muestra el mensaje de error y NO se refresca.
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 *
 * @see PLAN_DE_ABORDAJE_F10_6_PARIDAD_DE_OPERACION_DE_CAJA.md §5 (F10.6.2)
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import GestorDeCaja from './GestorDeCaja.jsx';

afterEach(() => {
  cleanup();
});

/** Turno abierto de ejemplo (contrato 10). */
function turnoAbierto() {
  return {
    cash_session_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    terminal_id: 'TERM-01',
    monto_inicial: '500.00',
    abierta_en: '2026-09-30T14:00:00Z',
  };
}

/** Resumen del turno (contrato 12) con dos movimientos. */
function resumenConMovimientos() {
  return {
    esperado: '1500.00',
    movimientos: [
      { movement_id: 'mov-1', tipo: 'ENTRADA', monto: '200.00', motivo: 'Refuerzo' },
      { movement_id: 'mov-2', tipo: 'SALIDA', monto: '30.00', motivo: 'Hielo' },
    ],
    fondo_inicial: '500.00',
    total_entradas: '200.00',
    total_salidas: '30.00',
    total_credito: '0.00',
    total_debito: '0.00',
    total_ventas: '0.00',
    num_transacciones: 0,
  };
}

/** Servicio de caja doble con turno abierto y movimientos. */
function servicioCaja(resumen = resumenConMovimientos()) {
  return {
    obtenerTurnoActivo: vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: turnoAbierto(),
    })),
    obtenerResumen: vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: resumen,
    })),
    eliminarMovimiento: vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: { eliminado: true },
    })),
    cerrarTurno: vi.fn(),
    abrirTurno: vi.fn(),
    registrarMovimiento: vi.fn(),
  };
}

/** Servicio de contexto doble (contrato 28) — no interviene aquí. */
function servicioContexto() {
  return {
    CLIMAS: [],
    enviarContextoDiario: vi.fn(async () => ({ outcome: 'ok', reason: null, data: {} })),
  };
}

/** Monta el gestor con un turno ya abierto y espera el resumen asíncrono. */
async function montarConTurnoAbierto(servicio) {
  render(
    <GestorDeCaja
      terminalId="TERM-01"
      usuarioId="user-1"
      servicio={servicio}
      servicioContexto={servicioContexto()}
    />
  );
  await waitFor(() => {
    expect(screen.getByText('Resumen del turno')).toBeTruthy();
  });
  await waitFor(() => {
    expect(servicio.obtenerResumen).toHaveBeenCalled();
  });
}

// ---------------------------------------------------------------------------
// 1. El botón ✕ existe por cada movimiento
// ---------------------------------------------------------------------------

describe('F10.6.2 — eliminar movimiento', () => {
  it('muestra un botón ✕ por cada movimiento del resumen', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    expect(screen.getByTestId('eliminar-movimiento-0')).toBeTruthy();
    expect(screen.getByTestId('eliminar-movimiento-1')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 2. Pulsar ✕ abre el modal (NO borra directo) y confirmar llama al servicio
  // -------------------------------------------------------------------------

  it('abre el modal al pulsar ✕ y llama a eliminarMovimiento al confirmar', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    // Pulsar ✕ NO borra: abre el modal de advertencia.
    fireEvent.click(screen.getByTestId('eliminar-movimiento-0'));
    expect(screen.getByTestId('confirmar-eliminar-movimiento')).toBeTruthy();
    expect(servicio.eliminarMovimiento).not.toHaveBeenCalled();

    // Confirmar SÍ llama al servicio con el movement_id correcto.
    fireEvent.click(screen.getByTestId('confirmar-eliminar-movimiento-si'));

    await waitFor(() => {
      expect(servicio.eliminarMovimiento).toHaveBeenCalledWith('mov-1');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Tras eliminar, el resumen se refresca
  // -------------------------------------------------------------------------

  it('refresca el resumen después de eliminar', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    const llamadasAntes = servicio.obtenerResumen.mock.calls.length;

    fireEvent.click(screen.getByTestId('eliminar-movimiento-1'));
    fireEvent.click(screen.getByTestId('confirmar-eliminar-movimiento-si'));

    await waitFor(() => {
      expect(servicio.obtenerResumen.mock.calls.length).toBeGreaterThan(llamadasAntes);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Si el servicio falla, se muestra el error y NO se refresca
  // -------------------------------------------------------------------------

  it('muestra el error y no refresca si el borrado falla', async () => {
    const servicio = servicioCaja();
    servicio.eliminarMovimiento = vi.fn(async () => ({
      outcome: 'error',
      reason: 'caja_cerrada',
      data: null,
    }));
    await montarConTurnoAbierto(servicio);

    const llamadasAntes = servicio.obtenerResumen.mock.calls.length;

    fireEvent.click(screen.getByTestId('eliminar-movimiento-0'));
    fireEvent.click(screen.getByTestId('confirmar-eliminar-movimiento-si'));

    await waitFor(() => {
      expect(servicio.eliminarMovimiento).toHaveBeenCalledWith('mov-1');
    });
    // No debe haber refrescado el resumen tras el fallo.
    expect(servicio.obtenerResumen.mock.calls.length).toBe(llamadasAntes);
  });
});
