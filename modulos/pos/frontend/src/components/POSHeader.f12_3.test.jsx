/**
 * Compuerta de FASE 12.3 — Botón CAJA con texto + estado (UX heredada).
 *
 * QUÉ PRUEBA ESTA COMPUERTA
 * -------------------------
 * El viejo POS (`apps/pos/components/POSHeader.jsx:159-170`) tiene un botón de
 * Caja que muestra DOS cosas:
 *   - El rótulo "Caja".
 *   - Su ESTADO: "● Activa" cuando hay un turno abierto, "○ Habilitar" cuando no.
 *
 * En el nuevo POS ese botón fue REEMPLAZADO por un icono 💰 que no comunica
 * nada. Esta es la lección de §10.6.5: el componente existe y pasa su test,
 * pero su OPERACIÓN (mostrar el estado de la caja) se perdió en la traducción.
 *
 * Esta compuerta fija las invariantes de la operación heredada:
 *   1. El botón muestra el rótulo "Caja" (no un icono mudo).
 *   2. Sin turno abierto muestra "○ Habilitar".
 *   3. Con turno abierto muestra "● Activa".
 *   4. El botón sigue siendo el punto de entrada (`onAbrirCaja`).
 *   5. El `title` describe la acción (Habilitar / Gestionar).
 *
 * §6.8 — la INTEGRACIÓN se hereda; solo la IMPLEMENTACIÓN se reescribe.
 *
 * F12.8 — CORRECCIÓN DE LA FUENTE DE VERDAD
 * -----------------------------------------
 * La versión original de esta compuerta afirmaba el estado con `cajaAbierta`
 * (la VISIBILIDAD del overlay del gestor de caja). Eso era un error de
 * traducción: el viejo POS usaba UNA sola fuente (`isCashEnabled`, el turno
 * real). El nuevo POS tenía DOS (`cajaAbierta` para el rótulo, `turnoCaja`
 * para los totales), y abrir el gestor pintaba "● Activa" aunque no hubiera
 * turno abierto. F12.8 unifica la fuente de verdad en `turnoCaja` (el turno
 * de caja REAL). Esta compuerta ahora afirma con `turnoCaja`.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import POSHeader from './POSHeader.jsx';

function montar(props = {}) {
  return render(<POSHeader terminalId="TERM-01" {...props} />);
}

function botonCaja() {
  return screen.getByLabelText('Gestor de caja');
}

describe('F12.3 — el botón CAJA muestra su rótulo y su estado', () => {
  it('muestra el rótulo "Caja" (no un icono mudo)', () => {
    montar();
    expect(screen.getByText('Caja')).toBeTruthy();
  });

  it('sin turno abierto muestra "○ Habilitar"', () => {
    montar({ turnoCaja: null });
    expect(screen.getByText('○ Habilitar')).toBeTruthy();
  });

  it('con turno abierto muestra "● Activa"', () => {
    montar({ turnoCaja: { id: 'TURNO-1' } });
    expect(screen.getByText('● Activa')).toBeTruthy();
  });

  it('el estado cambia al alternar turnoCaja', () => {
    const { rerender } = montar({ turnoCaja: null });
    expect(screen.getByText('○ Habilitar')).toBeTruthy();

    rerender(<POSHeader terminalId="TERM-01" turnoCaja={{ id: 'TURNO-1' }} />);
    expect(screen.getByText('● Activa')).toBeTruthy();
    expect(screen.queryByText('○ Habilitar')).toBeNull();
  });

  it('F12.8: abrir el overlay (cajaAbierta) NO pinta "● Activa" sin turno real', () => {
    // La visibilidad del gestor de caja no es el estado de la caja. Solo un
    // turno REAL (`turnoCaja`) habilita el rótulo "● Activa".
    montar({ cajaAbierta: true, turnoCaja: null });
    expect(screen.getByText('○ Habilitar')).toBeTruthy();
    expect(screen.queryByText('● Activa')).toBeNull();
  });

  it('ya NO usa el icono 💰 como única señal', () => {
    const { container } = montar();
    expect(container.textContent).not.toContain('💰');
  });
});

describe('F12.3 — el botón CAJA sigue siendo el punto de entrada', () => {
  it('invoca onAbrirCaja al pulsarlo', () => {
    const onAbrirCaja = vi.fn();
    montar({ onAbrirCaja });
    fireEvent.click(botonCaja());
    expect(onAbrirCaja).toHaveBeenCalledTimes(1);
  });

  it('el title describe la acción según el estado', () => {
    const { rerender } = montar({ turnoCaja: null });
    expect(botonCaja().getAttribute('title')).toBe('Habilitar como Caja');

    rerender(<POSHeader terminalId="TERM-01" turnoCaja={{ id: 'TURNO-1' }} />);
    expect(botonCaja().getAttribute('title')).toBe('Gestionar Caja (Activa)');
  });

  it('R-04: el botón respeta el target táctil (min-h-tactil)', () => {
    montar();
    expect(botonCaja().className).toContain('min-h-tactil');
  });
});
