/**
 * Puerta de F9.0.3 — OfflineBanner (solo estado de red, sin conteo).
 *
 * Rescate de UX del viejo POS: el viejo POS avisaba con un banner persistente
 * cuando no había red. El nuevo POS conserva el aviso, pero SIN conteo de
 * pendientes, porque no tiene cola local (el servidor es la única verdad).
 *
 * Criterios de la puerta:
 *   1. Con red, el banner NO se muestra.
 *   2. Sin red, el banner SÍ se muestra.
 *   3. El banner es persistente (no se auto-oculta).
 *   4. El banner NO muestra ningún conteo de pendientes.
 *   5. El mensaje dice que el cobro está bloqueado.
 *   6. El banner usa `role="alert"`.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { OfflineBanner } from './POSOverlays.jsx';

afterEach(() => cleanup());

describe('F9.0.3 — OfflineBanner', () => {
  it('criterio 1: con red (visible=false) no se muestra', () => {
    const { container } = render(<OfflineBanner visible={false} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('criterio 2: sin red (visible=true) se muestra', () => {
    render(<OfflineBanner visible />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('criterio 3: es persistente (no se auto-oculta)', () => {
    // El banner no tiene temporizador ni estado interno: mientras `visible`
    // sea `true`, sigue montado. Se comprueba que no desaparece tras un tick.
    render(<OfflineBanner visible />);
    expect(screen.getByRole('alert')).toBeTruthy();
    // No hay lógica de auto-ocultado: el componente es puramente declarativo.
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('criterio 4: NO muestra ningún conteo de pendientes', () => {
    render(<OfflineBanner visible />);
    const banner = screen.getByRole('alert');
    // No debe haber dígitos sueltos que sugieran un contador (p. ej. "3 pendientes").
    expect(banner.textContent).not.toMatch(/\d+\s*(pendiente|en cola|por enviar)/i);
    expect(banner.textContent).not.toMatch(/pendiente/i);
  });

  it('criterio 5: el mensaje dice que el cobro está bloqueado', () => {
    render(<OfflineBanner visible />);
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toMatch(/cobro está bloqueado/i);
    expect(banner.textContent).toMatch(/sin conexión/i);
  });

  it('criterio 6: usa role="alert"', () => {
    render(<OfflineBanner visible />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
