/**
 * Puerta de BUG-05 — El gestor propaga el error REAL del backend al guardar.
 *
 * Contexto (10 Oct 2026): el usuario reportó que "Guardar cambios" parecía no
 * reaccionar. La causa raíz era doble:
 *   1. `addTerminal` generaba ids `T1`, `T2`… (cubierto en
 *      `useTerminals.bug05.test.jsx`).
 *   2. `handleSave` descartaba el `detail` del backend y SIEMPRE mostraba
 *      "❌ Error al guardar", así que un fallo de validación (color repetido,
 *      color fuera de la paleta…) parecía un botón muerto.
 *
 * Esta puerta cubre (2): el toast debe mostrar el mensaje real del backend.
 *
 * @see FICHA_FIX_BUG05_CAJA_NO_ES_TERMINAL.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import TerminalSelector from './TerminalSelector.jsx';

// El servicio se simula: la puerta prueba la UI, no la red.
vi.mock('../services/terminalService.js', () => ({
  fetchTerminalStatuses: vi.fn(async () => ({})),
  lockTerminal: vi.fn(async () => ({ success: true })),
  unlockTerminal: vi.fn(async () => ({ success: true })),
  fetchTerminalConfig: vi.fn(async () => [
    { id: 'TERM-01', name: 'Terminal 1', icon: '🖥️', color: null },
    { id: 'TERM-02', name: 'Terminal 2', icon: '🖥️', color: null },
  ]),
  saveTerminalConfig: vi.fn(async () => ({ success: true })),
}));

import { saveTerminalConfig } from '../services/terminalService.js';

const ADMIN = { id: 'u-1', name: 'Ana', role: 'ADMIN' };

async function montar(usuario = ADMIN) {
  const vista = render(<TerminalSelector currentUser={usuario} onTerminalSelected={() => {}} />);
  await waitFor(() => expect(screen.queryByText(/Cargando terminales/i)).toBeNull());
  return vista;
}

async function abrirGestor() {
  fireEvent.click(screen.getByText(/Gestor de Terminales/i));
  await waitFor(() => expect(screen.getByTestId('orden-izq-der')).toBeTruthy());
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // Re-establecer la implementación base tras `clearAllMocks` (que no la borra,
  // pero deja el mock listo para el `mockResolvedValueOnce` de cada test).
  saveTerminalConfig.mockResolvedValue({ success: true });
});

/** Pulsa "Guardar cambios" y espera a que el handler async resuelva dentro de `act`. */
async function guardar() {
  await act(async () => {
    fireEvent.click(screen.getByText(/Guardar cambios/i));
  });
}

describe('BUG-05 — handleSave propaga el error real del backend', () => {
  it('muestra el mensaje del backend cuando el guardado falla', async () => {
    saveTerminalConfig.mockResolvedValueOnce({
      success: false,
      message: 'El color ya está en uso por otra terminal',
    });

    await montar();
    await abrirGestor();
    await guardar();

    expect(saveTerminalConfig).toHaveBeenCalled();
    expect(screen.getByText(/El color ya está en uso por otra terminal/i)).toBeTruthy();
  });

  it('muestra el toast de éxito cuando el guardado funciona', async () => {
    await montar();
    await abrirGestor();
    await guardar();

    expect(screen.getByText(/Configuración guardada/i)).toBeTruthy();
  });

  it('cae a un mensaje genérico si el backend no da detalle', async () => {
    saveTerminalConfig.mockResolvedValueOnce({ success: false });

    await montar();
    await abrirGestor();
    await guardar();

    expect(screen.getByText(/Error al guardar/i)).toBeTruthy();
  });
});
