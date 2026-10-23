/**
 * Puerta de FASE 6.5.1 — Selector de orden de terminales (UI).
 *
 * Verifica los 3 criterios del plan F6.5 §5.2:
 *  1. El selector de orden solo se renderiza en modo gestor (canManage === true).
 *  2. Al pulsar "Derecha a izquierda", el orden visual de las tarjetas se invierte.
 *  3. Los id de las tarjetas (TERM-01, TERM-02…) NO cambian al invertir el orden.
 *
 * @see PLAN_DE_ABORDAJE_FASE_6_5_ORDEN_TERMINALES.md §5.2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TerminalSelector from './TerminalSelector.jsx';

// El servicio se simula: la puerta prueba la UI, no la red.
vi.mock('../services/terminalService.js', () => ({
  fetchTerminalStatuses: vi.fn(async () => ({})),
  lockTerminal: vi.fn(async () => ({ success: true })),
  unlockTerminal: vi.fn(async () => ({ success: true })),
  // F7.7d — El vocabulario de ids es `TERM-0N` (el mismo del API y la semilla).
  fetchTerminalConfig: vi.fn(async () => [
    { id: 'TERM-01', name: 'Terminal 1', icon: '🖥️' },
    { id: 'TERM-02', name: 'Terminal 2', icon: '🖥️' },
    { id: 'TERM-03', name: 'Terminal 3', icon: '🖥️' },
  ]),
  saveTerminalConfig: vi.fn(async () => ({ success: true })),
}));

const ADMIN = { id: 'u-1', name: 'Ana', role: 'ADMIN' };
const CAJERO = { id: 'u-2', name: 'Luis', role: 'CASHIER', permissions: {} };

/** Espera a que el componente salga del estado de carga. */
async function montar(usuario) {
  const vista = render(<TerminalSelector currentUser={usuario} onTerminalSelected={() => {}} />);
  await waitFor(() => expect(screen.queryByText(/Cargando terminales/i)).toBeNull());
  return vista;
}

/** Abre el modo gestor pulsando el botón de engranaje. */
async function abrirGestor() {
  fireEvent.click(screen.getByText(/Gestor de Terminales/i));
  await waitFor(() => expect(screen.getByTestId('orden-izq-der')).toBeTruthy());
}

beforeEach(() => {
  localStorage.clear();
});

describe('F6.5.1 — Orden de terminales (UI)', () => {
  it('criterio 1: el selector de orden solo aparece en modo gestor', async () => {
    // Un cajero sin permisos NO ve el botón del gestor ni el selector.
    await montar(CAJERO);
    expect(screen.queryByText(/Gestor de Terminales/i)).toBeNull();
    expect(screen.queryByTestId('orden-izq-der')).toBeNull();

    // Un admin SÍ ve el botón; el selector aparece al abrir el gestor.
    await montar(ADMIN);
    await abrirGestor();
    expect(screen.getByTestId('orden-izq-der')).toBeTruthy();
    expect(screen.getByTestId('orden-der-izq')).toBeTruthy();
  });

  it('criterio 2: pulsar "Derecha a izquierda" invierte el orden visual', async () => {
    await montar(ADMIN);
    await abrirGestor();

    // Orden canónico: TERM-01, TERM-02, TERM-03.
    const idsAntes = screen.getAllByText(/^TERM-\d\d$/).map(n => n.textContent);
    expect(idsAntes).toEqual(['TERM-01', 'TERM-02', 'TERM-03']);

    fireEvent.click(screen.getByTestId('orden-der-izq'));

    await waitFor(() => {
      const idsDespues = screen.getAllByText(/^TERM-\d\d$/).map(n => n.textContent);
      expect(idsDespues).toEqual(['TERM-03', 'TERM-02', 'TERM-01']);
    });
  });

  it('criterio 3: los id de las tarjetas NO cambian al invertir el orden', async () => {
    await montar(ADMIN);
    await abrirGestor();

    const idsAntes = screen.getAllByText(/^TERM-\d\d$/).map(n => n.textContent).sort();

    fireEvent.click(screen.getByTestId('orden-der-izq'));

    await waitFor(() => {
      const idsDespues = screen.getAllByText(/^TERM-\d\d$/).map(n => n.textContent).sort();
      // El CONJUNTO de ids es idéntico: solo cambió el orden, no la identidad.
      expect(idsDespues).toEqual(idsAntes);
    });
  });
});
