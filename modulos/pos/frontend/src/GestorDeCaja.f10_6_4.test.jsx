/**
 * Puerta de FASE 10.6.4 — Impresión del corte del Gestor de Caja (frontend).
 *
 * Verifica que `GestorDeCaja` recupera la OPERACIÓN del viejo POS: imprimir el
 * corte de caja al cerrar el turno. El viejo POS disparaba la impresión
 * automáticamente tras el cierre y ofrecía un botón para reimprimir; el nuevo
 * POS cerraba el turno pero NUNCA imprimía el corte, así que el cajero no tenía
 * el comprobante físico del arqueo. La IMPLEMENTACIÓN se reescribe (§6.8): el
 * botón genera el HTML térmico con `generarCorteHTML` y lo envía a
 * `imprimirCorte` (el disparador único de impresión del POS nuevo).
 *
 *   1. Tras cerrar el turno aparece el botón "Imprimir corte".
 *   2. Pulsarlo llama a `imprimirCorte` con un HTML no vacío.
 *   3. El HTML contiene los datos del arqueo (esperado, contado, cajero).
 *   4. El botón NO existe antes de cerrar el turno (no hay corte que imprimir).
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 *
 * @see PLAN_DE_ABORDAJE_F10_6_PARIDAD_DE_OPERACION_DE_CAJA.md §6 (F10.6.4)
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// Helpers de interacción táctil compartidos (F12.29 v5): `tocar` emite
// `pointerdown` + `click` (toque real sobre un botón armado con useBotonArmado).
import { tocar } from './test-utils/tocar.js';

// El servicio de impresión se sustituye por un espía: no queremos crear un
// iframe real en jsdom. `imprimirCorte` es lo único que el gestor consume.
vi.mock('./services/printService.js', () => ({
  imprimirCorte: vi.fn(() => ({ outcome: 'ok', reason: null })),
  imprimirTicket: vi.fn(() => ({ outcome: 'ok', reason: null })),
}));

import GestorDeCaja from './GestorDeCaja.jsx';
import { imprimirCorte } from './services/printService.js';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  imprimirCorte.mockClear();
});

/** Turno abierto de ejemplo (contrato 10). */
function turnoAbierto() {
  return {
    cash_session_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    terminal_id: 'TERM-01',
    monto_inicial: '500.00',
    abierta_en: '2026-09-30T14:00:00Z',
    usuario_nombre: 'Ana Cajera',
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

/** Servicio de caja doble con turno abierto, movimientos y cierre exitoso. */
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
    cerrarTurno: vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: { esperado: '1500.00', capturado: '1500.00', diferencia: '0.00' },
    })),
    eliminarMovimiento: vi.fn(),
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
      usuarioNombre="Ana Cajera"
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

/** Lleva la pantalla al estado CIERRE y confirma el cierre del turno (F12.7 B3: 2 pasos). */
async function cerrarTurno(servicio) {
  await montarConTurnoAbierto(servicio);
  tocar(screen.getByText('Cerrar turno'));
  await waitFor(() => {
    expect(screen.getByText('Arqueo y cierre')).toBeTruthy();
  });
  fireEvent.change(screen.getByTestId('campo-conteoEfectivo'), {
    target: { value: '1500' },
  });
  // Paso 1: "Cerrar turno" abre el diálogo de confirmación (acción irreversible).
  tocar(screen.getByText('Cerrar turno'));
  // Paso 2: se confirma el cierre definitivo.
  tocar(await screen.findByText('Sí, cerrar turno'));
  await waitFor(() => {
    expect(servicio.cerrarTurno).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(screen.getByTestId('diferencia-final')).toBeTruthy();
  });
}

// ---------------------------------------------------------------------------
// 1. El botón de imprimir corte aparece tras cerrar el turno
// ---------------------------------------------------------------------------

describe('F10.6.4 — imprimir corte', () => {
  it('muestra el botón "Imprimir corte" tras cerrar el turno', async () => {
    const servicio = servicioCaja();
    await cerrarTurno(servicio);
    expect(screen.getByTestId('imprimir-corte')).toBeTruthy();
  });

  it('NO muestra el botón antes de cerrar el turno', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);
    expect(screen.queryByTestId('imprimir-corte')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 2. Pulsar el botón dispara la impresión con un HTML no vacío
  // -------------------------------------------------------------------------

  it('pulsar el botón llama a imprimirCorte con un HTML no vacío', async () => {
    const servicio = servicioCaja();
    await cerrarTurno(servicio);

    fireEvent.click(screen.getByTestId('imprimir-corte'));

    expect(imprimirCorte).toHaveBeenCalledTimes(1);
    const html = imprimirCorte.mock.calls[0][0];
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 3. El HTML del corte contiene los datos del arqueo
  // -------------------------------------------------------------------------

  it('el HTML del corte contiene el cajero y el arqueo', async () => {
    const servicio = servicioCaja();
    await cerrarTurno(servicio);

    fireEvent.click(screen.getByTestId('imprimir-corte'));

    const html = imprimirCorte.mock.calls[0][0];
    // El cajero viaja en el corte (paridad con el viejo POS).
    expect(html).toContain('Ana Cajera');
    // El arqueo: esperado y contado. `generarCorteHTML` formatea con
    // `moneda()` → `$1500.00` (sin separador de miles).
    expect(html).toContain('$1500.00');
    // El encabezado del documento térmico. TS-01: `generarCorteHTML` emite
    // `*** CORTE CAJA ***` (mayúsculas, sin "de"), no "Corte de Caja".
    expect(html).toContain('CORTE CAJA');
  });

  // -------------------------------------------------------------------------
  // 4. La impresión es NO crítica: el corte ya quedó cerrado
  // -------------------------------------------------------------------------

  it('el botón de imprimir no vuelve a cerrar el turno', async () => {
    const servicio = servicioCaja();
    await cerrarTurno(servicio);
    const llamadasTrasCierre = servicio.cerrarTurno.mock.calls.length;

    fireEvent.click(screen.getByTestId('imprimir-corte'));

    expect(servicio.cerrarTurno.mock.calls.length).toBe(llamadasTrasCierre);
  });
});
