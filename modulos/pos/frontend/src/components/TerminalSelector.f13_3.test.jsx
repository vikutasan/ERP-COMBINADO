/**
 * Puerta de FASE 13.3 — Selector de color de post-it en el gestor de terminales.
 *
 * @paridad: components/TerminalSelector.f13_3.test.jsx
 * @operacion: El selector de terminales muestra el estado (libre/ocupada) y bloquea
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ VERIFICA
 * ─────────────────────────────────────────────────────────────────────────────
 * El gestor de terminales permite asignar a cada terminal un color de post-it
 * tomado de la paleta compartida (`PALETA_POST_ITS`). Decisiones del usuario
 * (9 Oct 2026):
 *   1. NO hay semilla: las terminales nacen sin color (amarillo por defecto).
 *   2. BUG-05 — CAJA NO es una terminal: toda terminal es una caja en potencia.
 *   3. NO se permiten colores repetidos: un color ya asignado a OTRA terminal
 *      se BLOQUEA (no se puede elegir).
 *   4. Se ofrecen los 21 colores de la paleta.
 *
 * Criterios:
 *   1. Al editar una terminal aparece la paleta de colores.
 *   2. La paleta ofrece los 21 colores + la opción "sin color".
 *   3. Elegir un color y confirmar lo persiste en la terminal.
 *   4. Un color ya usado por OTRA terminal aparece deshabilitado (bloqueado).
 *   5. El color de la propia terminal NO se bloquea a sí mismo.
 *   6. Guardar envía el color al backend (saveTerminalConfig).
 *
 * @see PLAN_SELECTOR_COLOR_POST_IT.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TerminalSelector from './TerminalSelector.jsx';
import { PALETA_POST_ITS } from '../constants/paletaPostIts.js';
// TS-01 — FD-02: el borde de selección se ancla al token, no al hex literal.
import { TOKENS_TERMINAL } from '../theme/tokensVigentes.js';

// El servicio se simula: la puerta prueba la UI, no la red.
vi.mock('../services/terminalService.js', () => ({
  fetchTerminalStatuses: vi.fn(async () => ({})),
  lockTerminal: vi.fn(async () => ({ success: true })),
  unlockTerminal: vi.fn(async () => ({ success: true })),
  fetchTerminalConfig: vi.fn(async () => [
    { id: 'TERM-01', name: 'Terminal 1', icon: '🖥️', color: null },
    { id: 'TERM-02', name: 'Terminal 2', icon: '🖥️', color: 'bg-blue-400' },
  ]),
  saveTerminalConfig: vi.fn(async () => ({ success: true })),
}));

import { saveTerminalConfig } from '../services/terminalService.js';

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

/** Entra en modo edición de la primera terminal (TERM-01). */
async function editarTerminal01() {
  const botonesEditar = screen.getAllByTitle('Editar');
  fireEvent.click(botonesEditar[0]);
  await waitFor(() => expect(screen.getByTestId('paleta-color-TERM-01')).toBeTruthy());
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('F13.3 — Selector de color de post-it en el gestor', () => {
  it('criterio 1: al editar una terminal aparece la paleta de colores', async () => {
    await montar();
    await abrirGestor();
    await editarTerminal01();

    expect(screen.getByTestId('paleta-color-TERM-01')).toBeTruthy();
  });

  it('criterio 2: la paleta ofrece los 21 colores + la opción "sin color"', async () => {
    await montar();
    await abrirGestor();
    await editarTerminal01();

    // La opción "sin color" (∅) siempre está.
    expect(screen.getByTestId('color-TERM-01-ninguno')).toBeTruthy();

    // Los 21 colores de la paleta están presentes.
    PALETA_POST_ITS.forEach((token) => {
      expect(screen.getByTestId(`color-TERM-01-${token}`)).toBeTruthy();
    });
    expect(PALETA_POST_ITS.length).toBe(21);
  });

  it('criterio 3: elegir un color y confirmar lo persiste en la terminal', async () => {
    await montar();
    await abrirGestor();
    await editarTerminal01();

    // TERM-01 nace sin color; elegimos bg-green-400.
    fireEvent.click(screen.getByTestId('color-TERM-01-bg-green-400'));
    // Confirmar (✓).
    fireEvent.click(screen.getByText('✓'));

    // Al reabrir la edición, el color elegido sigue seleccionado (borde naranja).
    // TS-01 — FD-02: el componente emite `rgb(var(--acento-calido))`; jsdom NO
    // resuelve la var, así que se afirma el token vigente (fuente única).
    await editarTerminal01();
    const elegido = screen.getByTestId('color-TERM-01-bg-green-400');
    expect(elegido.style.border).toContain(TOKENS_TERMINAL.colorSeleccionadoBorde);
  });

  it('criterio 4: un color ya usado por OTRA terminal aparece deshabilitado', async () => {
    await montar();
    await abrirGestor();
    await editarTerminal01();

    // TERM-02 ya usa bg-blue-400: en la edición de TERM-01 debe estar bloqueado.
    const enUso = screen.getByTestId('color-TERM-01-bg-blue-400');
    expect(enUso.disabled).toBe(true);
  });

  it('criterio 5: el color de la propia terminal NO se bloquea a sí mismo', async () => {
    await montar();
    await abrirGestor();

    // Editamos TERM-02, que ya tiene bg-blue-400.
    const botonesEditar = screen.getAllByTitle('Editar');
    fireEvent.click(botonesEditar[1]);
    await waitFor(() => expect(screen.getByTestId('paleta-color-TERM-02')).toBeTruthy());

    // Su propio color NO debe estar deshabilitado.
    const propio = screen.getByTestId('color-TERM-02-bg-blue-400');
    expect(propio.disabled).toBe(false);
  });

  it('criterio 6: guardar envía el color al backend', async () => {
    await montar();
    await abrirGestor();
    await editarTerminal01();

    fireEvent.click(screen.getByTestId('color-TERM-01-bg-green-400'));
    fireEvent.click(screen.getByText('✓'));

    fireEvent.click(screen.getByText(/Guardar cambios/i));

    await waitFor(() => expect(saveTerminalConfig).toHaveBeenCalled());
    const enviadas = saveTerminalConfig.mock.calls.at(-1)[0];
    const term01 = enviadas.find((t) => t.id === 'TERM-01');
    expect(term01.color).toBe('bg-green-400');
  });
});
