/**
 * Puerta de FASE 10.2 — B-01: "Copiar URL" en el gestor de terminales.
 *
 * Contexto (F10.0/F10.1): el viejo POS tenía un botón "📋 Copiar URL" en el
 * gestor de terminales que copiaba `http://<host>:<port>/?terminal=<id>` para
 * pegar en el acceso directo de cada máquina. El nuevo POS lo había OMITIDO
 * por completo (ni botón ni lógica). Esta puerta verifica que la brecha B-01
 * quedó cerrada.
 *
 * Criterios:
 *  1. El botón "Copiar URL" existe en el gestor, por cada terminal.
 *  2. Al pulsarlo, se copia la URL correcta con el `?terminal=<id>`.
 *  3. La URL usa el id REAL de la terminal (TERM-0N), no un índice.
 *  4. Si la Clipboard API no está disponible, cae al fallback `execCommand`.
 *
 * @see PLAN_DE_ABORDAJE_FASE_10_PARIDAD.md §4.2 (B-01) y §5 (F10.2)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TerminalSelector from './TerminalSelector.jsx';

// El servicio se simula: la puerta prueba la UI, no la red.
vi.mock('../services/terminalService.js', () => ({
  fetchTerminalStatuses: vi.fn(async () => ({})),
  lockTerminal: vi.fn(async () => ({ success: true })),
  unlockTerminal: vi.fn(async () => ({ success: true })),
  fetchTerminalConfig: vi.fn(async () => [
    { id: 'TERM-01', name: 'Terminal 1', icon: '🖥️' },
    { id: 'TERM-02', name: 'Terminal 2', icon: '🖥️' },
  ]),
  saveTerminalConfig: vi.fn(async () => ({ success: true })),
}));

const ADMIN = { id: 'u-1', name: 'Ana', role: 'ADMIN' };

/** Espera a que el componente salga del estado de carga. */
async function montar(usuario = ADMIN) {
  const vista = render(<TerminalSelector currentUser={usuario} onTerminalSelected={() => {}} />);
  await waitFor(() => expect(screen.queryByText(/Cargando terminales/i)).toBeNull());
  return vista;
}

/** Abre el modo gestor pulsando el botón de engranaje. */
async function abrirGestor() {
  fireEvent.click(screen.getByText(/Gestor de Terminales/i));
  await waitFor(() => expect(screen.getByTestId('orden-izq-der')).toBeTruthy());
}

let writeTextSpy;

beforeEach(() => {
  localStorage.clear();
  // Clipboard API simulada (jsdom no la implementa por defecto).
  writeTextSpy = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextSpy },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('F10.2 — B-01: Copiar URL de acceso directo', () => {
  it('criterio 1: el botón "Copiar URL" existe por cada terminal en el gestor', async () => {
    await montar();
    await abrirGestor();

    expect(screen.getByTestId('copiar-url-TERM-01')).toBeTruthy();
    expect(screen.getByTestId('copiar-url-TERM-02')).toBeTruthy();
  });

  it('criterio 2: al pulsarlo, copia la URL con el ?terminal=<id>', async () => {
    await montar();
    await abrirGestor();

    fireEvent.click(screen.getByTestId('copiar-url-TERM-01'));

    await waitFor(() => expect(writeTextSpy).toHaveBeenCalledTimes(1));
    const url = writeTextSpy.mock.calls[0][0];
    expect(url).toContain('?terminal=TERM-01');
    expect(url).toMatch(/^http:\/\/.+\?terminal=TERM-01$/);
  });

  it('criterio 3: la URL usa el id REAL de la terminal, no un índice', async () => {
    await montar();
    await abrirGestor();

    fireEvent.click(screen.getByTestId('copiar-url-TERM-02'));

    await waitFor(() => expect(writeTextSpy).toHaveBeenCalledTimes(1));
    const url = writeTextSpy.mock.calls[0][0];
    expect(url).toContain('?terminal=TERM-02');
    expect(url).not.toContain('?terminal=1');
  });

  it('criterio 4: sin Clipboard API, cae al fallback execCommand', async () => {
    // Simula un contexto sin Clipboard API (http no seguro, navegador viejo).
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const execSpy = vi.fn(() => true);
    document.execCommand = execSpy;

    await montar();
    await abrirGestor();

    fireEvent.click(screen.getByTestId('copiar-url-TERM-01'));

    await waitFor(() => expect(execSpy).toHaveBeenCalledWith('copy'));
  });
});
