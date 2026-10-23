/**
 * DEUDA-BUG08 (Observación 4) — ¿Quién cuadra la caja? (frontend).
 *
 * El corte del turno ahora separa lo que ESTA caja vendió por sí misma
 * (`ventas_propias`) de lo que cobró por cuentas de OTRAS terminales
 * (`ventas_ajenas`). El total no cambia; el desglose le dice al cajero cuánto
 * de su caja no nació en su terminal (RN-53: el dinero se cuenta donde se
 * recibió).
 *
 * Criterios:
 *   1. Con cuentas ajenas, el desglose muestra la línea "De otras terminales".
 *   2. Sin cuentas ajenas, la línea NO aparece (no ensucia el corte normal).
 *   3. La línea muestra el monto y el número de transacciones ajenas.
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
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
    abierta_en: '2026-10-10T14:00:00Z',
  };
}

/** Resumen del turno (contrato 12) con el desglose por origen (Obs. 4). */
function resumenTurno(extra = {}) {
  return {
    esperado: '1500.00',
    movimientos: [],
    fondo_inicial: '500.00',
    total_entradas: '200.00',
    total_salidas: '50.00',
    total_credito: '300.00',
    total_debito: '150.00',
    total_ventas: '1250.00',
    num_transacciones: 7,
    ventas_propias: '1250.00',
    ventas_ajenas: '0.00',
    num_transacciones_ajenas: 0,
    ...extra,
  };
}

/** Servicio de caja doble con turno ya abierto. */
function servicioCaja(resumen = resumenTurno()) {
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
    cerrarTurno: vi.fn(),
    abrirTurno: vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: turnoAbierto(),
    })),
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

/** Monta el gestor con un turno abierto y espera el resumen asíncrono. */
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
// 1. Con cuentas ajenas, la línea aparece con el monto y el conteo
// ---------------------------------------------------------------------------

describe('DEUDA-BUG08 Obs.4 — criterio 1: cuentas ajenas visibles en el corte', () => {
  it('muestra "De otras terminales" con el monto y el número de transacciones', async () => {
    const servicio = servicioCaja(
      resumenTurno({
        ventas_propias: '1000.00',
        ventas_ajenas: '250.00',
        num_transacciones_ajenas: 3,
      })
    );
    await montarConTurnoAbierto(servicio);

    await waitFor(() => {
      expect(screen.getByTestId('desglose-ventas-ajenas')).toBeTruthy();
    });
    expect(screen.getByTestId('desglose-ventas-ajenas').textContent).toContain('250');
    expect(screen.getByText(/De otras terminales \(3\)/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Sin cuentas ajenas, la línea NO aparece
// ---------------------------------------------------------------------------

describe('DEUDA-BUG08 Obs.4 — criterio 2: sin ajenas no hay línea', () => {
  it('no muestra la línea cuando ventas_ajenas es 0', async () => {
    const servicio = servicioCaja(resumenTurno());
    await montarConTurnoAbierto(servicio);

    // El desglose ya cargó (el total está presente)…
    await waitFor(() => {
      expect(screen.getByTestId('desglose-total-ventas')).toBeTruthy();
    });
    // …pero la línea de ajenas NO existe.
    expect(screen.queryByTestId('desglose-ventas-ajenas')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. El total de ventas NO cambia por mostrar el desglose
// ---------------------------------------------------------------------------

describe('DEUDA-BUG08 Obs.4 — criterio 3: el total no cambia', () => {
  it('mantiene el total de ventas aunque haya ajenas', async () => {
    const servicio = servicioCaja(
      resumenTurno({
        ventas_propias: '1000.00',
        ventas_ajenas: '250.00',
        num_transacciones_ajenas: 3,
      })
    );
    await montarConTurnoAbierto(servicio);

    await waitFor(() => {
      expect(screen.getByTestId('desglose-total-ventas').textContent).toContain('1,250');
    });
  });
});
