/**
 * Puerta de FASE 10.4 — Contexto diario post-corte (integración).
 *
 * Verifica que `GestorDeCaja` INTEGRA el `DailyContextModal` (contrato 28,
 * `pos.contexto_diario`) y que la integración respeta las reglas de batalla:
 *
 *   1. El modal NO aparece antes de cerrar el turno.
 *   2. Al confirmar el cierre con éxito, el modal se abre automáticamente.
 *   3. Si el cierre FALLA, el modal NO se abre (el corte no quedó cerrado).
 *   4. "Omitir" cierra el modal sin mostrar la confirmación.
 *   5. "Guardar" muestra "✅ Contexto del día registrado".
 *   6. El contexto es NO crítico: si el envío falla, el corte sigue cerrado.
 *   7. El botón "Registrar contexto del día" reabre el modal tras omitir.
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 *
 * @see PLAN_DE_ABORDAJE_F10_4_CONTEXTO_DIARIO.md §5 (diseño técnico)
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import GestorDeCaja from './GestorDeCaja.jsx';
// F12.29 v5 — los botones de cierre se arman con `useBotonArmado`: un toque
// real emite `pointerdown` + `click`. `tocar` encapsula esa secuencia.
import { tocar } from './test-utils/tocar.js';

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

/** Resumen del turno (contrato 12). */
function resumenTurno() {
  return { esperado: '1500.00', movimientos: [] };
}

/**
 * Servicio de caja doble: turno ya abierto y cierre exitoso.
 * @param {object} [cierre] - resultado del cierre (por defecto, éxito).
 */
function servicioCaja(cierre = { outcome: 'ok', reason: null, data: { diferencia: '0.00' } }) {
  return {
    obtenerTurnoActivo: vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: turnoAbierto(),
    })),
    obtenerResumen: vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: resumenTurno(),
    })),
    cerrarTurno: vi.fn(async () => cierre),
    abrirTurno: vi.fn(),
    registrarMovimiento: vi.fn(),
  };
}

/** Servicio de contexto doble (contrato 28). */
function servicioContexto(resultado = { outcome: 'ok', reason: null, data: {} }) {
  return {
    CLIMAS: [
      { valor: 'SOLEADO', emoji: '☀️', etiqueta: 'Soleado' },
      { valor: 'LLUVIA', emoji: '🌧️', etiqueta: 'Lluvia' },
    ],
    enviarContextoDiario: vi.fn(async () => resultado),
  };
}

/** Monta el gestor y espera a que el turno abierto esté listo. */
async function montarConTurnoAbierto(servicio, servicioCtx) {
  render(
    <GestorDeCaja
      terminalId="TERM-01"
      usuarioId="user-1"
      servicio={servicio}
      servicioContexto={servicioCtx}
    />
  );
  await waitFor(() => {
    expect(screen.getByText('Resumen del turno')).toBeTruthy();
  });
}

/** Avanza al estado CIERRE y confirma el cierre (F12.7 B3: 2 pasos). */
async function cerrarTurno() {
  // F12.29 v5 — los botones de cierre están armados: se tocan de verdad
  // (`pointerdown` + `click`), no un `click` aislado.
  tocar(screen.getByText('Cerrar turno'));
  await waitFor(() => {
    expect(screen.getByText('Arqueo y cierre')).toBeTruthy();
  });
  // Paso 1: "Cerrar turno" abre el diálogo de confirmación (acción irreversible).
  tocar(screen.getByText('Cerrar turno'));
  // Paso 2: se confirma el cierre definitivo.
  tocar(await screen.findByText('Sí, cerrar turno'));
}

// ---------------------------------------------------------------------------
// 1. El modal NO aparece antes de cerrar
// ---------------------------------------------------------------------------

describe('F10.4 — criterio 1: el modal no aparece antes de cerrar', () => {
  it('no renderiza el diálogo de contexto mientras el turno está abierto', async () => {
    await montarConTurnoAbierto(servicioCaja(), servicioContexto());

    expect(screen.queryByRole('dialog', { name: 'Contexto diario post-corte' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. El modal se abre al cerrar con éxito
// ---------------------------------------------------------------------------

describe('F10.4 — criterio 2: el modal se abre al cerrar con éxito', () => {
  it('muestra el diálogo de contexto tras confirmar el cierre', async () => {
    await montarConTurnoAbierto(servicioCaja(), servicioContexto());
    await cerrarTurno();

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Contexto diario post-corte' })).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Si el cierre falla, el modal NO se abre
// ---------------------------------------------------------------------------

describe('F10.4 — criterio 3: si el cierre falla, el modal no se abre', () => {
  it('no muestra el diálogo cuando el cierre devuelve error', async () => {
    const servicio = servicioCaja({
      outcome: 'error',
      reason: 'sin_conexion',
      data: null,
    });
    await montarConTurnoAbierto(servicio, servicioContexto());
    await cerrarTurno();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(screen.queryByRole('dialog', { name: 'Contexto diario post-corte' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. "Omitir" cierra el modal sin confirmación
// ---------------------------------------------------------------------------

describe('F10.4 — criterio 4: "Omitir" cierra sin confirmación', () => {
  it('cierra el modal y NO muestra "Contexto del día registrado"', async () => {
    await montarConTurnoAbierto(servicioCaja(), servicioContexto());
    await cerrarTurno();

    await waitFor(() => {
      expect(screen.getByText('Omitir →')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Omitir →'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Contexto diario post-corte' })).toBeNull();
    });
    expect(screen.queryByTestId('contexto-registrado')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. "Guardar" muestra la confirmación
// ---------------------------------------------------------------------------

describe('F10.4 — criterio 5: "Guardar" muestra la confirmación', () => {
  it('envía el contexto y muestra "Contexto del día registrado"', async () => {
    const ctx = servicioContexto();
    await montarConTurnoAbierto(servicioCaja(), ctx);
    await cerrarTurno();

    await waitFor(() => {
      expect(screen.getByText('✓ Guardar')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('✓ Guardar'));

    await waitFor(() => {
      expect(ctx.enviarContextoDiario).toHaveBeenCalledTimes(1);
    });
    // El modal muestra su propia confirmación interna.
    await waitFor(() => {
      expect(screen.getByText('✅ Contexto del día registrado')).toBeTruthy();
    });
    // Al cerrar, el padre refleja la confirmación persistente.
    fireEvent.click(screen.getByText('Cerrar'));
    await waitFor(() => {
      expect(screen.getByTestId('contexto-registrado')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 6. El contexto es NO crítico: si falla, el corte sigue cerrado
// ---------------------------------------------------------------------------

describe('F10.4 — criterio 6: el contexto es no crítico', () => {
  it('si el envío falla, el corte permanece cerrado y se avisa', async () => {
    const ctx = servicioContexto({
      outcome: 'error',
      reason: 'estadisticas_no_disponible',
      data: null,
    });
    await montarConTurnoAbierto(servicioCaja(), ctx);
    await cerrarTurno();

    await waitFor(() => {
      expect(screen.getByText('✓ Guardar')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('✓ Guardar'));

    await waitFor(() => {
      expect(
        screen.getByText('Estadísticas no está disponible. El corte ya quedó cerrado.')
      ).toBeTruthy();
    });
    // El corte sigue cerrado: la diferencia final está visible.
    expect(screen.getByTestId('diferencia-final')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 7. El botón reabre el modal tras omitir
// ---------------------------------------------------------------------------

describe('F10.4 — criterio 7: el botón reabre el modal', () => {
  it('permite registrar el contexto después de haberlo omitido', async () => {
    await montarConTurnoAbierto(servicioCaja(), servicioContexto());
    await cerrarTurno();

    await waitFor(() => {
      expect(screen.getByText('Omitir →')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Omitir →'));

    await waitFor(() => {
      expect(screen.getByText('Registrar contexto del día')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Registrar contexto del día'));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Contexto diario post-corte' })).toBeTruthy();
    });
  });
});
