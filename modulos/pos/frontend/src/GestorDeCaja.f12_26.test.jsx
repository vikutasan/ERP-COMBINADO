/**
 * Puerta de FASE 12.26 — UX de respuesta y confirmación de cierre (frontend).
 *
 * El cajero reportó que al pulsar "Cerrar turno" "no pasaba nada": el botón no
 * daba feedback táctil, el modal de confirmación era un bloque inline al fondo
 * de la vista (fuera del viewport) y, tras cerrar, la pantalla no se desplazaba
 * al bloque "Imprimir corte". Esta puerta fija las tres correcciones:
 *
 *   1. Todos los botones llevan la clase de feedback táctil (`FEEDBACK_TACTIL`).
 *   2. El modal de confirmación es un OVERLAY `fixed inset-0 z-50` centrado.
 *   3. Al cerrar el turno, la pantalla hace scroll al bloque "Imprimir corte".
 *
 * Es una puerta de PRESENTACIÓN: no toca contratos ni lógica de cierre. Los
 * `data-testid` existentes se conservan intactos.
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 *
 * @see FICHA_F12_26_UX_CIERRE.md
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// Helpers de interacción táctil compartidos (F12.29 v5): `tocar` emite
// `pointerdown` + `click` (toque real sobre un botón armado con useBotonArmado).
import { tocar } from './test-utils/tocar.js';

// El servicio de impresión se sustituye por un espía: no queremos crear un
// iframe real en jsdom.
vi.mock('./services/printService.js', () => ({
  imprimirCorte: vi.fn(() => ({ outcome: 'ok', reason: null })),
  imprimirTicket: vi.fn(() => ({ outcome: 'ok', reason: null })),
}));

import GestorDeCaja from './GestorDeCaja.jsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // jsdom no implementa `scrollIntoView`; se espía para verificar la llamada.
  Element.prototype.scrollIntoView = vi.fn();
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

// ---------------------------------------------------------------------------
// 1. Feedback táctil en los botones
// ---------------------------------------------------------------------------

describe('F12.26 — feedback táctil', () => {
  it('el botón "Cerrar turno" del Balance lleva la clase de feedback táctil', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    const boton = screen.getByText('Cerrar turno');
    expect(boton.className).toContain('active:scale-[0.97]');
    expect(boton.className).toContain('active:brightness-90');
  });

  it('el botón "Registrar movimiento" lleva la clase de feedback táctil', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    const boton = screen.getByText('Registrar movimiento');
    expect(boton.className).toContain('active:scale-[0.97]');
  });
});

// ---------------------------------------------------------------------------
// 2. El modal de confirmación es un overlay visible
// ---------------------------------------------------------------------------

describe('F12.26 — modal de confirmación como overlay', () => {
  it('al pulsar "Cerrar turno" (paso 1) aparece el diálogo de confirmación', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    // Paso 1: entra al estado CIERRE.
    tocar(screen.getByText('Cerrar turno'));
    await waitFor(() => {
      expect(screen.getByText('Arqueo y cierre')).toBeTruthy();
    });

    // Paso 2: pide confirmación → debe aparecer el diálogo.
    tocar(screen.getByText('Cerrar turno'));
    const dialogo = await screen.findByRole('alertdialog', {
      name: 'Confirmar cierre de turno',
    });
    expect(dialogo).toBeTruthy();
  });

  it('el diálogo se monta dentro de un overlay `fixed inset-0 z-50`', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    tocar(screen.getByText('Cerrar turno'));
    await waitFor(() => {
      expect(screen.getByText('Arqueo y cierre')).toBeTruthy();
    });
    tocar(screen.getByText('Cerrar turno'));

    const dialogo = await screen.findByRole('alertdialog', {
      name: 'Confirmar cierre de turno',
    });
    // El overlay es el contenedor padre del diálogo.
    const overlay = dialogo.parentElement;
    expect(overlay.className).toContain('fixed');
    expect(overlay.className).toContain('inset-0');
    expect(overlay.className).toContain('z-50');
  });

  it('"Volver" cierra el diálogo sin cerrar el turno', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    tocar(screen.getByText('Cerrar turno'));
    await waitFor(() => {
      expect(screen.getByText('Arqueo y cierre')).toBeTruthy();
    });
    tocar(screen.getByText('Cerrar turno'));
    await screen.findByRole('alertdialog', { name: 'Confirmar cierre de turno' });

    tocar(screen.getByText('Volver'));

    await waitFor(() => {
      expect(
        screen.queryByRole('alertdialog', { name: 'Confirmar cierre de turno' })
      ).toBeNull();
    });
    expect(servicio.cerrarTurno).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Scroll automático al bloque "Imprimir corte" tras cerrar
// ---------------------------------------------------------------------------

describe('F12.26 — scroll al bloque de impresión tras cerrar', () => {
  it('al cerrar el turno se hace scrollIntoView sobre el bloque "Imprimir corte"', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    tocar(screen.getByText('Cerrar turno'));
    await waitFor(() => {
      expect(screen.getByText('Arqueo y cierre')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('campo-conteoEfectivo'), {
      target: { value: '1500' },
    });
    tocar(screen.getByText('Cerrar turno'));
    tocar(await screen.findByText('Sí, cerrar turno'));

    await waitFor(() => {
      expect(servicio.cerrarTurno).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByTestId('diferencia-final')).toBeTruthy();
    });

    // El bloque que contiene el botón de impresión recibió el scroll.
    const bloque = screen.getByTestId('imprimir-corte').closest('[role="status"]');
    expect(bloque).toBeTruthy();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
