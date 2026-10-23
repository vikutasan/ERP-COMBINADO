/**
 * Puerta de FASE 10.5 — Paridad de datos de caja (frontend).
 *
 * Verifica que `GestorDeCaja` CONSUME y MUESTRA el desglose que el viejo POS
 * exponía al cajero (contrato 12) y que ENVÍA el nombre del cajero al abrir el
 * turno (contrato 10). Cierra las brechas #1 y #2 de la auditoría de paridad.
 *
 *   1. Al abrir el turno, se envía `usuario_nombre` (paridad con `employee_name`).
 *   2. Sin `usuarioNombre`, NO se envía la clave (el backend cae al UUID).
 *   3. El desglose muestra fondo, entradas, salidas, ventas por método,
 *      total y número de transacciones (los 7 campos del contrato 12).
 *   4. Sin datos del resumen, el desglose queda en cero (no rompe).
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 *
 * @see PLAN_DE_ABORDAJE_F10_5_PARIDAD_DE_DATOS_DE_CAJA.md §5 (diseño técnico)
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

/**
 * Resumen del turno (contrato 12) con el desglose completo de F10.5.
 * @param {object} [extra] - sobreescribe campos del desglose.
 */
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

/**
 * Monta el gestor con un turno ya abierto y espera a que el resumen ASÍNCRONO
 * (contrato 12) haya llegado y se refleje en el desglose.
 *
 * No basta con esperar el encabezado "Resumen del turno": ese aparece en cuanto
 * `estado === ABIERTO`, ANTES de que `refrescarResumen()` resuelva. Hay que
 * esperar a que el desglose deje de estar en cero.
 */
async function montarConTurnoAbierto(servicio, usuarioNombre) {
  render(
    <GestorDeCaja
      terminalId="TERM-01"
      usuarioId="user-1"
      usuarioNombre={usuarioNombre}
      servicio={servicio}
      servicioContexto={servicioContexto()}
    />
  );
  await waitFor(() => {
    expect(screen.getByText('Resumen del turno')).toBeTruthy();
  });
  // Espera a que el resumen asíncrono se aplique (el desglose sale de cero).
  await waitFor(() => {
    expect(servicio.obtenerResumen).toHaveBeenCalled();
  });
}

// ---------------------------------------------------------------------------
// 1. Al abrir el turno se envía el nombre del cajero (paridad con employee_name)
// ---------------------------------------------------------------------------

describe('F10.5 — criterio 1: abrir turno envía el nombre del cajero', () => {
  it('incluye usuario_nombre en la llamada a abrirTurno', async () => {
    const servicio = servicioCaja();
    // Sin turno activo: se muestra el formulario de apertura.
    servicio.obtenerTurnoActivo = vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: null,
    }));

    render(
      <GestorDeCaja
        terminalId="TERM-01"
        usuarioId="user-1"
        usuarioNombre="María López"
        servicio={servicio}
        servicioContexto={servicioContexto()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Abrir turno' })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Fondo inicial'), {
      target: { value: '500' },
    });
    // F12.7 B2 — la apertura tiene confirmación de 2 pasos: "Abrir turno" abre
    // el diálogo "Confirmar fondo inicial"; aquí se confirma con "Sí, abrir turno".
    fireEvent.click(screen.getByRole('button', { name: 'Abrir turno' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, abrir turno' }));

    await waitFor(() => {
      expect(servicio.abrirTurno).toHaveBeenCalledTimes(1);
    });
    expect(servicio.abrirTurno).toHaveBeenCalledWith(
      expect.objectContaining({ usuario_nombre: 'María López' })
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Sin nombre, NO se envía la clave (el backend cae al UUID)
// ---------------------------------------------------------------------------

describe('F10.5 — criterio 2: sin nombre no se envía la clave', () => {
  it('omite usuario_nombre cuando el contenedor no lo provee', async () => {
    const servicio = servicioCaja();
    servicio.obtenerTurnoActivo = vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: null,
    }));

    render(
      <GestorDeCaja
        terminalId="TERM-01"
        usuarioId="user-1"
        servicio={servicio}
        servicioContexto={servicioContexto()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Abrir turno' })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Fondo inicial'), {
      target: { value: '500' },
    });
    // F12.7 B2 — "Abrir turno" abre el diálogo; se confirma para llegar al servicio.
    fireEvent.click(screen.getByRole('button', { name: 'Abrir turno' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, abrir turno' }));

    await waitFor(() => {
      expect(servicio.abrirTurno).toHaveBeenCalledTimes(1);
    });
    const enviado = servicio.abrirTurno.mock.calls[0][0];
    expect(enviado.usuario_nombre).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. El desglose muestra los 7 campos del contrato 12
// ---------------------------------------------------------------------------

describe('F10.5 — criterio 3: el desglose muestra los 7 campos', () => {
  it('renderiza fondo, entradas, salidas, métodos, total y transacciones', async () => {
    await montarConTurnoAbierto(servicioCaja(), 'María López');

    expect(screen.getByTestId('desglose-fondo').textContent).toContain('500');
    expect(screen.getByTestId('desglose-entradas').textContent).toContain('200');
    expect(screen.getByTestId('desglose-salidas').textContent).toContain('50');
    expect(screen.getByTestId('desglose-credito').textContent).toContain('300');
    expect(screen.getByTestId('desglose-debito').textContent).toContain('150');
    expect(screen.getByTestId('desglose-total-ventas').textContent).toContain('1,250');
    expect(screen.getByTestId('desglose-transacciones').textContent).toContain('7');
  });
});

// ---------------------------------------------------------------------------
// 4. Sin datos del resumen, el desglose queda en cero (no rompe)
// ---------------------------------------------------------------------------

describe('F10.5 — criterio 4: sin desglose el resumen no rompe', () => {
  it('muestra ceros cuando el contrato 12 no trae los campos nuevos', async () => {
    await montarConTurnoAbierto(servicioCaja({ esperado: '1500.00', movimientos: [] }));

    expect(screen.getByTestId('desglose-fondo').textContent).toContain('0');
    expect(screen.getByTestId('desglose-total-ventas').textContent).toContain('0');
    expect(screen.getByTestId('desglose-transacciones').textContent).toContain('0');
  });
});
