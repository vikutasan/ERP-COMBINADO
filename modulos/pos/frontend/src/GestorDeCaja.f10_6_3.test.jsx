/**
 * Puerta de FASE 10.6.3 — Hora y concepto del movimiento (frontend).
 *
 * Verifica que `GestorDeCaja` recupera la INFORMACIÓN que el viejo POS mostraba
 * por cada movimiento: su CONCEPTO (`motivo`) y su HORA (`creado_en`). El nuevo
 * POS solo mostraba tipo y monto, así que el cajero no podía saber qué se movió
 * ni cuándo. La hora viaja en UTC (RN-78) y el POS la formatea a hora local.
 *
 *   1. Cada movimiento muestra su concepto (`motivo`), no el tipo crudo.
 *   2. Cada movimiento muestra su hora formateada (HH:MM).
 *   3. La hora se formatea desde UTC a la hora local del negocio.
 *   4. Un movimiento sin hora no rompe la lista (muestra vacío).
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 *
 * @see PLAN_DE_ABORDAJE_F10_6_PARIDAD_DE_OPERACION_DE_CAJA.md §5 (F10.6.3)
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

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

/** Resumen del turno (contrato 12) con dos movimientos con hora y concepto. */
function resumenConMovimientos() {
  return {
    esperado: '1500.00',
    movimientos: [
      {
        movement_id: 'mov-1',
        tipo: 'ENTRADA',
        monto: '200.00',
        motivo: 'Refuerzo de cambio',
        creado_en: '2026-09-30T20:15:00Z',
      },
      {
        movement_id: 'mov-2',
        tipo: 'SALIDA',
        monto: '30.00',
        motivo: 'Compra de hielo',
        creado_en: '2026-09-30T21:45:00Z',
      },
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
    eliminarMovimiento: vi.fn(),
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
// 1. Cada movimiento muestra su CONCEPTO (motivo), no el tipo crudo
// ---------------------------------------------------------------------------

describe('F10.6.3 — concepto del movimiento', () => {
  it('muestra el motivo de cada movimiento', async () => {
    await montarConTurnoAbierto(servicioCaja());

    expect(screen.getByText(/Refuerzo de cambio/)).toBeTruthy();
    expect(screen.getByText(/Compra de hielo/)).toBeTruthy();
  });

  it('no muestra el tipo crudo cuando hay motivo', async () => {
    await montarConTurnoAbierto(servicioCaja());

    // El tipo crudo "ENTRADA"/"SALIDA" no debe aparecer como texto suelto.
    expect(screen.queryByText('ENTRADA')).toBeNull();
    expect(screen.queryByText('SALIDA')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Cada movimiento muestra su HORA formateada
// ---------------------------------------------------------------------------

describe('F10.6.3 — hora del movimiento', () => {
  it('muestra una hora por cada movimiento', async () => {
    await montarConTurnoAbierto(servicioCaja());

    const hora0 = screen.getByTestId('hora-movimiento-0');
    const hora1 = screen.getByTestId('hora-movimiento-1');
    expect(hora0.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(hora1.textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  it('formatea la hora desde UTC a la hora local del negocio', async () => {
    await montarConTurnoAbierto(servicioCaja());

    // 2026-09-30T20:15:00Z formateado en la zona local del entorno de prueba.
    const esperado = new Date('2026-09-30T20:15:00Z').toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(screen.getByTestId('hora-movimiento-0').textContent).toBe(esperado);
  });

  it('las dos horas son distintas (no se confunde el orden)', async () => {
    await montarConTurnoAbierto(servicioCaja());

    const hora0 = screen.getByTestId('hora-movimiento-0').textContent;
    const hora1 = screen.getByTestId('hora-movimiento-1').textContent;
    expect(hora0).not.toBe(hora1);
  });
});

// ---------------------------------------------------------------------------
// 3. Un movimiento sin hora no rompe la lista
// ---------------------------------------------------------------------------

describe('F10.6.3 — robustez', () => {
  it('un movimiento sin creado_en muestra la hora vacía sin romper', async () => {
    const resumen = resumenConMovimientos();
    resumen.movimientos = [
      { movement_id: 'mov-1', tipo: 'ENTRADA', monto: '200.00', motivo: 'Refuerzo' },
    ];
    await montarConTurnoAbierto(servicioCaja(resumen));

    expect(screen.getByTestId('hora-movimiento-0').textContent).toBe('');
    expect(screen.getByText(/Refuerzo/)).toBeTruthy();
  });
});
