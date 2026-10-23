/**
 * Puerta de FASE 12.29 — Modal de cierre estable (v6).
 *
 * SÍNTOMA reportado por el cajero: al pulsar "Cerrar turno", el modal de
 * confirmación aparecía durante una fracción de segundo y desaparecía solo.
 *
 * CAUSA RAÍZ (v6 — las hipótesis del ghost click de v1–v5 eran INCOMPLETAS):
 *   `onCajaHabilitada` es una lambda inline en RetailVisionPOS. Cada re-render
 *   del padre genera una referencia nueva. Como estaba en los deps del
 *   `useEffect` de carga, el efecto se re-ejecutaba, llamaba
 *   `setEstado(ESTADOS.ABIERTO)` y DESMONTABA la sección CIERRE y el modal.
 *
 * FIX (v6 — ELIMINAR LA CAUSA):
 *   Se usa el patrón "latest ref" para `onCajaHabilitada` y
 *   `onCajaDeshabilitada`: se almacenan en refs actualizados en cada render,
 *   pero NO aparecen en los deps del `useEffect`. Un re-render del padre
 *   ya NO re-ejecuta el efecto de carga.
 *
 *   `useBotonArmado` v6 usa un `WeakSet` per-element (ya no un ref compartido)
 *   como DEFENSA EN PROFUNDIDAD contra ghost clicks reales.
 *
 * Criterios cubiertos:
 *   1–9. Los ghost click tests se mantienen como defensa en profundidad.
 *   10.  Un re-render del padre NO resetea el estado durante el cierre.
 *
 * @see FICHA_F12_29_MODAL_CIERRE_GHOST_CLICK.md
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// Helpers de interacción táctil compartidos (F12.29 v5): `tocar` emite
// `pointerdown` + `click` (toque real); `ghostClick` emite solo `click`.
import { tocar, ghostClick } from './test-utils/tocar.js';

vi.mock('./services/printService.js', () => ({
  imprimirCorte: vi.fn(() => ({ outcome: 'ok', reason: null })),
  imprimirTicket: vi.fn(() => ({ outcome: 'ok', reason: null })),
}));

import GestorDeCaja from './GestorDeCaja.jsx';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
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

/** Resumen del turno (contrato 12). */
function resumen() {
  return {
    esperado: '1500.00',
    movimientos: [],
    fondo_inicial: '500.00',
    total_entradas: '0.00',
    total_salidas: '0.00',
    total_credito: '0.00',
    total_debito: '0.00',
    total_ventas: '0.00',
    num_transacciones: 0,
  };
}

/** Servicio de caja doble con turno abierto. */
function servicioCaja() {
  return {
    obtenerTurnoActivo: vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: turnoAbierto(),
    })),
    obtenerResumen: vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: resumen(),
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

/** Monta el gestor con un turno abierto (estado ABIERTO). */
async function montarAbierto(servicio) {
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
}

/** Monta el gestor y navega al estado CIERRE con un toque real. */
async function montarEnCierre(servicio) {
  await montarAbierto(servicio);
  // Estado ABIERTO → CIERRE (toque real).
  tocar(screen.getByText('Cerrar turno'));
  await waitFor(() => {
    expect(screen.getByText('Arqueo y cierre')).toBeTruthy();
  });
}

/** Devuelve el backdrop del modal (el overlay `fixed inset-0`). */
function backdrop() {
  const dialogo = screen.getByRole('alertdialog', { name: /Confirmar cierre de turno/i });
  return dialogo.parentElement;
}

describe('F12.29 v6 — modal de cierre estable', () => {
  it('un ghost click sobre "Cerrar turno" (ABIERTO) NO cambia al estado CIERRE', async () => {
    const servicio = servicioCaja();
    await montarAbierto(servicio);

    // Ghost click: sin `pointerdown` previo sobre el botón.
    ghostClick(screen.getByText('Cerrar turno'));

    // Sigue en ABIERTO: no apareció el arqueo.
    expect(screen.queryByText('Arqueo y cierre')).toBeNull();
    expect(screen.getByText('Resumen del turno')).toBeTruthy();
  });

  it('un toque real sobre "Cerrar turno" (ABIERTO) SÍ cambia al estado CIERRE', async () => {
    const servicio = servicioCaja();
    await montarAbierto(servicio);

    tocar(screen.getByText('Cerrar turno'));

    await waitFor(() => {
      expect(screen.getByText('Arqueo y cierre')).toBeTruthy();
    });
  });

  it('un ghost click sobre "Cerrar turno" (CIERRE) NO abre el modal', async () => {
    const servicio = servicioCaja();
    await montarEnCierre(servicio);

    // Ghost click sobre el botón que abre el modal de confirmación.
    ghostClick(screen.getByText('Cerrar turno'));

    // El modal NO se abrió.
    expect(screen.queryByText('Sí, cerrar turno')).toBeNull();
  });

  it('un toque real sobre "Cerrar turno" (CIERRE) SÍ abre el modal', async () => {
    const servicio = servicioCaja();
    await montarEnCierre(servicio);

    tocar(screen.getByText('Cerrar turno'));

    expect(await screen.findByText('Sí, cerrar turno')).toBeTruthy();
  });

  it('un ghost click sobre "Volver" NO cierra el modal', async () => {
    const servicio = servicioCaja();
    await montarEnCierre(servicio);

    tocar(screen.getByText('Cerrar turno'));
    expect(await screen.findByText('Sí, cerrar turno')).toBeTruthy();

    // Ghost click sobre "Volver": debe ignorarse.
    ghostClick(screen.getByText('Volver'));

    // El modal sigue abierto.
    expect(screen.getByText('Sí, cerrar turno')).toBeTruthy();
  });

  it('un toque real sobre "Volver" SÍ cierra el modal (salida explícita)', async () => {
    const servicio = servicioCaja();
    await montarEnCierre(servicio);

    tocar(screen.getByText('Cerrar turno'));
    expect(await screen.findByText('Sí, cerrar turno')).toBeTruthy();

    tocar(screen.getByText('Volver'));

    await waitFor(() => {
      expect(screen.queryByText('Sí, cerrar turno')).toBeNull();
    });
    // No se llamó al servicio de cierre.
    expect(servicio.cerrarTurno).not.toHaveBeenCalled();
  });

  it('un ghost click sobre "Sí, cerrar turno" NO cierra el turno', async () => {
    const servicio = servicioCaja();
    await montarEnCierre(servicio);

    tocar(screen.getByText('Cerrar turno'));
    expect(await screen.findByText('Sí, cerrar turno')).toBeTruthy();

    // Ghost click sobre el botón IRREVERSIBLE: debe ignorarse.
    ghostClick(screen.getByTestId('confirmar-cierre-definitivo'));

    // El servicio NO fue llamado y el modal sigue abierto.
    expect(servicio.cerrarTurno).not.toHaveBeenCalled();
    expect(screen.getByText('Sí, cerrar turno')).toBeTruthy();
  });

  it('un toque real sobre "Sí, cerrar turno" SÍ cierra el turno', async () => {
    const servicio = servicioCaja();
    await montarEnCierre(servicio);

    tocar(screen.getByText('Cerrar turno'));
    expect(await screen.findByText('Sí, cerrar turno')).toBeTruthy();

    tocar(screen.getByTestId('confirmar-cierre-definitivo'));

    await waitFor(() => {
      expect(servicio.cerrarTurno).toHaveBeenCalledTimes(1);
    });
    // El modal se cerró tras confirmar.
    await waitFor(() => {
      expect(screen.queryByText('Sí, cerrar turno')).toBeNull();
    });
  });

  it('el backdrop NO tiene handler de cierre (v4 se conserva)', async () => {
    const servicio = servicioCaja();
    await montarEnCierre(servicio);

    tocar(screen.getByText('Cerrar turno'));
    expect(await screen.findByText('Sí, cerrar turno')).toBeTruthy();

    // Un click sobre el backdrop no cierra el modal (no hay handler).
    fireEvent.click(backdrop());

    expect(screen.getByText('Sí, cerrar turno')).toBeTruthy();
  });

  // ===================================================================
  // Test #10 — CAUSA RAÍZ v6: un re-render del padre NO resetea el estado.
  //
  // ESCENARIO: el componente está en estado CIERRE con el modal abierto.
  // El padre (RetailVisionPOS) re-renderiza y pasa un nuevo
  // `onCajaHabilitada` (lambda inline). En v1–v5, esto re-ejecutaba el
  // `useEffect` de carga, que llamaba `setEstado(ABIERTO)` y DESMONTABA
  // el modal. Con el patrón "latest ref" de v6, el efecto NO se
  // re-ejecuta y el modal sigue abierto.
  // ===================================================================
  it('un re-render con nueva referencia de onCajaHabilitada NO desmonta el modal (causa raíz v6)', async () => {
    const servicio = servicioCaja();

    // Montamos con un callback explícito.
    const { rerender } = render(
      <GestorDeCaja
        terminalId="TERM-01"
        usuarioId="user-1"
        usuarioNombre="Ana Cajera"
        servicio={servicio}
        servicioContexto={servicioContexto()}
        onCajaHabilitada={() => {}}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('Resumen del turno')).toBeTruthy();
    });

    // ABIERTO → CIERRE.
    tocar(screen.getByText('Cerrar turno'));
    await waitFor(() => {
      expect(screen.getByText('Arqueo y cierre')).toBeTruthy();
    });

    // Abrir el modal de confirmación.
    tocar(screen.getByText('Cerrar turno'));
    expect(await screen.findByText('Sí, cerrar turno')).toBeTruthy();

    // SIMULAR re-render del padre con una NUEVA lambda (misma semántica).
    // En v1–v5 esto re-ejecutaba el useEffect y reseteaba a ABIERTO.
    rerender(
      <GestorDeCaja
        terminalId="TERM-01"
        usuarioId="user-1"
        usuarioNombre="Ana Cajera"
        servicio={servicio}
        servicioContexto={servicioContexto()}
        onCajaHabilitada={() => {}}
      />
    );

    // Esperar un tick para que cualquier efecto pendiente se ejecute.
    await waitFor(() => {
      // El modal SIGUE abierto: el re-render NO desmonta la sección CIERRE.
      expect(screen.getByText('Sí, cerrar turno')).toBeTruthy();
    });
    // Y no regregó a ABIERTO.
    expect(screen.queryByText('Resumen del turno')).toBeNull();
  });
});
