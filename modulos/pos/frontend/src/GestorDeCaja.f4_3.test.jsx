/**
 * Puerta de FASE 4.3 — Pantalla de caja (`GestorDeCaja.jsx`).
 *
 * Criterio de la puerta (PLAN_DE_ABORDAJE_FASE_4_POR_PARTES.md §7.3.3):
 *   "los 3 estados (sin turno / abierto / cierre) se renderizan y las acciones
 *    llaman al servicio correcto."
 *
 * Estrategia: inyección de dependencias. El componente acepta la prop `servicio`
 * (por defecto `cashService`), así que aquí se le pasa un doble controlado y se
 * verifica QUÉ método se llamó y CON QUÉ argumentos. No se mockea el módulo:
 * se sustituye la dependencia, que es el patrón de la casa (igual que
 * `useCart({ api })`).
 *
 * Se usa `fireEvent` (no `user-event`, que no está instalado) para mantener el
 * estilo de `components.f3_4.test.jsx` y no añadir dependencias.
 *
 * Se respeta el contrato `{ outcome, reason, data }`: el doble devuelve esa
 * forma y el componente decide con `esOk(...)`.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import GestorDeCaja, { ESTADOS } from './GestorDeCaja.jsx';
// F12.29 v5 — los botones de cierre se arman con `useBotonArmado`: un toque
// real emite `pointerdown` + `click`. `tocar` encapsula esa secuencia.
import { tocar } from './test-utils/tocar.js';

const TERMINAL = 'TEST-F43';
const USUARIO = '11111111-1111-1111-1111-111111111111';
const TURNO_ID = '22222222-2222-2222-2222-222222222222';

/** Respuesta OK del contrato `{outcome, reason, data}`. */
function ok(data) {
  return { outcome: 'ok', reason: null, data };
}

/** Respuesta de error del contrato `{outcome, reason, data}`. */
function fallo(reason) {
  return { outcome: 'error', reason, data: null };
}

/** Doble del servicio de caja con todos los métodos espiados. */
function servicioFalso(overrides = {}) {
  return {
    obtenerTurnoActivo: vi.fn(async () => ok({ cash_session_id: null })),
    abrirTurno: vi.fn(async () => ok({ cash_session_id: TURNO_ID })),
    registrarMovimiento: vi.fn(async () => ok({ movement_id: 'm-1' })),
    obtenerResumen: vi.fn(async () => ok({ esperado: 0, movimientos: [] })),
    cerrarTurno: vi.fn(async () => ok({ esperado: 0, capturado: 0, diferencia: 0 })),
    obtenerReporteDiario: vi.fn(async () => ok({ fecha: '2026-01-01', reporte: [] })),
    ...overrides,
  };
}

function montar(servicio, props = {}) {
  return render(
    <GestorDeCaja
      terminalId={TERMINAL}
      usuarioId={USUARIO}
      servicio={servicio}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('GestorDeCaja — F4.3', () => {
  it('exporta los 3 estados como constantes congeladas', () => {
    expect(ESTADOS.SIN_TURNO).toBe('sin_turno');
    expect(ESTADOS.ABIERTO).toBe('abierto');
    expect(ESTADOS.CIERRE).toBe('cierre');
    expect(Object.isFrozen(ESTADOS)).toBe(true);
  });

  it('ESTADO 1 — sin turno: consulta el turno activo y muestra el formulario de apertura', async () => {
    const servicio = servicioFalso();
    montar(servicio);

    expect(await screen.findByLabelText('Fondo inicial')).toBeTruthy();
    expect(servicio.obtenerTurnoActivo).toHaveBeenCalledTimes(1);
    // No debe pedir resumen si no hay turno.
    expect(servicio.obtenerResumen).not.toHaveBeenCalled();
  });

  it('ESTADO 1 → 2 — abrir turno llama al servicio con terminal, usuario y fondo', async () => {
    const servicio = servicioFalso();
    montar(servicio);

    const fondo = await screen.findByLabelText('Fondo inicial');
    fireEvent.change(fondo, { target: { value: '250.50' } });
    // F12.7 B2 — la apertura tiene confirmación de 2 pasos: "Abrir turno" abre
    // el diálogo "Confirmar fondo inicial"; aquí se confirma con "Sí, abrir turno".
    fireEvent.click(screen.getByRole('button', { name: 'Abrir turno' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, abrir turno' }));

    await waitFor(() => expect(servicio.abrirTurno).toHaveBeenCalledTimes(1));
    expect(servicio.abrirTurno).toHaveBeenCalledWith({
      terminal_id: TERMINAL,
      usuario_id: USUARIO,
      monto_inicial: 250.5,
    });
    // Al abrir, entra al estado ABIERTO y pide el resumen.
    expect(await screen.findByText('Resumen del turno')).toBeTruthy();
    await waitFor(() => expect(servicio.obtenerResumen).toHaveBeenCalledWith(TURNO_ID));
  });

  it('ESTADO 2 — con turno abierto: renderiza esperado, contado y movimientos', async () => {
    const servicio = servicioFalso({
      obtenerTurnoActivo: vi.fn(async () => ok({ cash_session_id: TURNO_ID })),
      obtenerResumen: vi.fn(async () =>
        ok({
          esperado: 300,
          movimientos: [
            { tipo: 'ENTRADA', monto: 100, motivo: 'Refuerzo' },
            { tipo: 'SALIDA', monto: 50, motivo: 'Propina' },
          ],
        }),
      ),
    });
    montar(servicio);

    expect(await screen.findByText('Resumen del turno')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('esperado').textContent).toContain('300'));
    expect(screen.getByTestId('contado')).toBeTruthy();
    expect(screen.getByTestId('diferencia')).toBeTruthy();
    expect(screen.getByText(/Refuerzo/)).toBeTruthy();
    expect(screen.getByText(/Propina/)).toBeTruthy();
  });

  it('ESTADO 2 — registrar movimiento llama al servicio con el turno y el tipo elegido', async () => {
    const servicio = servicioFalso({
      obtenerTurnoActivo: vi.fn(async () => ok({ cash_session_id: TURNO_ID })),
    });
    montar(servicio);

    await screen.findByText('Resumen del turno');
    fireEvent.click(screen.getByRole('button', { name: 'Salida' }));
    fireEvent.change(screen.getByLabelText('Monto del movimiento'), {
      target: { value: '75' },
    });
    fireEvent.change(screen.getByLabelText('Motivo del movimiento'), {
      target: { value: 'Retiro' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar movimiento' }));

    await waitFor(() => expect(servicio.registrarMovimiento).toHaveBeenCalledTimes(1));
    expect(servicio.registrarMovimiento).toHaveBeenCalledWith({
      cash_session_id: TURNO_ID,
      tipo: 'SALIDA',
      monto: 75,
      motivo: 'Retiro',
    });
  });

  it('ESTADO 3 — cerrar turno captura los 3 conteos y muestra la diferencia final', async () => {
    const servicio = servicioFalso({
      obtenerTurnoActivo: vi.fn(async () => ok({ cash_session_id: TURNO_ID })),
      obtenerResumen: vi.fn(async () => ok({ esperado: 300, movimientos: [] })),
      cerrarTurno: vi.fn(async () =>
        ok({ esperado: 300, capturado: 290, diferencia: -10 }),
      ),
    });
    montar(servicio);

    await screen.findByText('Resumen del turno');
    // Primer "Cerrar turno" (estado ABIERTO) → pasa al estado CIERRE (arqueo).
    // F12.29 v5 — toque real (`pointerdown` + `click`).
    tocar(screen.getByRole('button', { name: 'Cerrar turno' }));

    fireEvent.change(await screen.findByLabelText('Efectivo contado'), {
      target: { value: '290' },
    });
    fireEvent.change(screen.getByLabelText('Crédito contado'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Débito contado'), { target: { value: '0' } });
    // F12.7 B3 — el cierre tiene confirmación de 2 pasos: el "Cerrar turno" del
    // estado CIERRE abre el diálogo; aquí se confirma con "Sí, cerrar turno".
    // F12.29 v5 — ambos botones están armados: se tocan de verdad.
    tocar(screen.getByRole('button', { name: 'Cerrar turno' }));
    tocar(await screen.findByRole('button', { name: 'Sí, cerrar turno' }));

    await waitFor(() => expect(servicio.cerrarTurno).toHaveBeenCalledTimes(1));
    expect(servicio.cerrarTurno).toHaveBeenCalledWith({
      cash_session_id: TURNO_ID,
      montos_fisicos: 290,
      credito: 0,
      debito: 0,
    });
    const final = await screen.findByTestId('diferencia-final');
    // El componente formatea como moneda: "-$10.00".
    expect(final.textContent).toContain('10.00');
    expect(final.textContent).toContain('-');
  });

  it('banner de error PERSISTENTE: un fallo del servicio se muestra y no se auto-oculta', async () => {
    const servicio = servicioFalso({
      abrirTurno: vi.fn(async () => fallo('ya_hay_turno_abierto')),
    });
    montar(servicio);

    // F12.7 B2 — "Abrir turno" abre el diálogo; se confirma para llegar al servicio.
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir turno' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, abrir turno' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/turno de caja abierto/i);
    // Sigue visible tras un tick (no hay timer que lo borre).
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('un fallo al consultar el turno activo muestra el banner (sin conexión)', async () => {
    const servicio = servicioFalso({
      obtenerTurnoActivo: vi.fn(async () => fallo('sin_conexion')),
    });
    montar(servicio);

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toMatch(/conexión/i);
  });

  it('el botón "Volver al POS" invoca onCerrar cuando se provee', async () => {
    const onCerrar = vi.fn();
    montar(servicioFalso(), { onCerrar });

    fireEvent.click(await screen.findByRole('button', { name: 'Volver al POS' }));
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });
});
