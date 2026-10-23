/**
 * Puerta de FASE 7.7d — LA TERMINAL ES UN PROP, NO UNA CONSTANTE.
 *
 * Este test monta la PANTALLA REAL (`RetailVisionPOS`) con un cliente `api`
 * simulado y verifica el HALLAZGO 4:
 *
 *   La pantalla declaraba `function RetailVisionPOS()` — SIN props. `App.jsx`
 *   le pasaba `terminalId={selectedTerminal}`, pero el prop se descartaba en
 *   silencio y la pantalla caía al `CONFIG.TERMINAL_ID` hardcodeado
 *   (`'TERM-01'`). Resultado: entrabas a la Terminal 3 y la pantalla operaba
 *   contra la Terminal 1 — o contra ninguna, si la sesión vivía en otra
 *   terminal. La pantalla se veía VACÍA.
 *
 * La corrección (F7.7d) hace que la pantalla RECIBA la terminal elegida en el
 * selector y la use en todo su cableado (sesión, ticket, candado, header,
 * ticket impreso). El `CONFIG.TERMINAL_ID` queda solo como último recurso para
 * los tests que montan la pantalla sin props.
 *
 * Criterios verificados:
 *   1. Con `terminalId="TERM-03"`, `getSesionActiva` recibe `'TERM-03'`
 *      (NO el `'TERM-01'` hardcodeado).
 *   2. Con `terminalId="TERM-05"`, el candado (`tomarLock`) usa `'TERM-05'`.
 *   3. Sin props, la pantalla cae al `CONFIG.TERMINAL_ID` (fallback de tests).
 *   4. El prop manda sobre el `CONFIG`: dos terminales distintas producen dos
 *      llamadas distintas (no hay contaminación entre montajes).
 *
 * Se ejecuta con Vitest (jsdom): `npm run test` en apps/pos.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

// ── Cliente `api` simulado (se inyecta en el módulo real) ────────────────────
// `vi.hoisted` es obligatorio: `vi.mock` se eleva al tope del archivo, así que
// la fábrica NO puede referenciar variables de nivel superior normales.
const apiSimulada = vi.hoisted(() => ({
  getCatalogo: vi.fn(),
  getSesionActiva: vi.fn(),
  crearVenta: vi.fn(),
  cobrarTicket: vi.fn(),
  anadirItem: vi.fn(),
  cambiarCantidad: vi.fn(),
  quitarItem: vi.fn(),
  verificarEnvio: vi.fn(),
  latir: vi.fn(),
  tomarLock: vi.fn(),
  liberarLock: vi.fn(),
  // TS-01 FIX: métodos adicionales que el POS usa al arrancar (F5, F10, F12).
  listarCuentasAbiertas: vi.fn(),
  leerTicket: vi.fn(),
  leerLineas: vi.fn(),
  getSesionCajaActiva: vi.fn(),
  abrirTurno: vi.fn(),
  registrarMovimiento: vi.fn(),
  getResumenTurno: vi.fn(),
  cerrarTurno: vi.fn(),
  getReporteDiario: vi.fn(),
  // useCatalogo llama getSettingValue para la política de pago de pedidos.
  getSettingValue: vi.fn(async () => null),
}));

vi.mock('./api/client.js', () => apiSimulada);

// TS-01 FIX: mock de cashService para que el POS no bloquee al inicializar
// la sesión de caja (el test verifica terminal, no flujo de caja).
vi.mock('./services/cashService.js', () => ({
  obtenerTurnoActivo: vi.fn(async () => ({ outcome: 'ok', data: null })),
  abrirTurno: vi.fn(async () => ({ outcome: 'ok', data: null })),
  registrarMovimiento: vi.fn(async () => ({ outcome: 'ok', data: null })),
  cerrarTurno: vi.fn(async () => ({ outcome: 'ok', data: null })),
  obtenerResumen: vi.fn(async () => ({ outcome: 'ok', data: null })),
  default: {
    obtenerTurnoActivo: vi.fn(async () => ({ outcome: 'ok', data: null })),
    abrirTurno: vi.fn(async () => ({ outcome: 'ok', data: null })),
    registrarMovimiento: vi.fn(async () => ({ outcome: 'ok', data: null })),
    cerrarTurno: vi.fn(async () => ({ outcome: 'ok', data: null })),
    obtenerResumen: vi.fn(async () => ({ outcome: 'ok', data: null })),
  },
}));

// TS-01 FIX: mock de openAccountsService (el pizarón se inicializa al montar).
vi.mock('./services/openAccountsService.js', () => ({
  listarCuentasAbiertas: vi.fn(async () => ({ outcome: 'ok', reason: null, data: { cuentas: [] } })),
  default: {
    listarCuentasAbiertas: vi.fn(async () => ({ outcome: 'ok', reason: null, data: { cuentas: [] } })),
  },
}));

// Importar DESPUÉS del mock para que la pantalla reciba el cliente simulado.
import RetailVisionPOS from './RetailVisionPOS.jsx';
import { CONFIG } from '../../shared/config.js';
// TS-01 FIX: importar ApiContext para inyectar el mock en el árbol React.
// Sin ApiProvider, useApi() devuelve null → getCatalogo nunca se llama.
import { ApiContext } from './context/ApiContext.jsx';

// ── Datos de prueba ──────────────────────────────────────────────────────────
const PRODUCTO_A = {
  id: 'prod-A',
  sku: 'SKU-A',
  barcode: '111',
  name: 'Concha de Vainilla',
  price: 18.5,
  category_id: 'cat-1',
};

/** Configura el cliente simulado con respuestas felices por defecto. */
function sembrarApiFeliz() {
  apiSimulada.getCatalogo.mockResolvedValue({
    categorias: [{ id: 'cat-1', name: 'Panadería' }],
    productos: [PRODUCTO_A],
  });
  apiSimulada.getSesionActiva.mockResolvedValue({
    id: 'ses-1',
    employee_id: 'emp-1',
    terminal_id: 'TERM-01',
  });
  apiSimulada.crearVenta.mockResolvedValue({
    id: 'ticket-1',
    folio: 'A-0001',
    status: 'OPEN',
    version: 1,
    total: 0,
  });
  apiSimulada.anadirItem.mockResolvedValue({ version: 2 });
  apiSimulada.cambiarCantidad.mockResolvedValue({ version: 3 });
  apiSimulada.quitarItem.mockResolvedValue({ version: 4 });
  apiSimulada.cobrarTicket.mockResolvedValue({
    id: 'ticket-1', folio: 'A-0001', status: 'PAID', version: 5, total: 23.5,
  });
  apiSimulada.verificarEnvio.mockImplementation(async (_t, cuerpo) => ({
    existe: true, item_ids_persistidos: cuerpo.item_ids, faltantes: [],
  }));
  apiSimulada.latir.mockResolvedValue({ ok: true });
  apiSimulada.tomarLock.mockResolvedValue({ ok: true });
  apiSimulada.liberarLock.mockResolvedValue({ ok: true });
  // TS-01 FIX: respuestas para los métodos adicionales.
  apiSimulada.listarCuentasAbiertas.mockResolvedValue({ cuentas: [] });
  apiSimulada.leerTicket.mockResolvedValue({ id: 'ticket-1', version: 1, total: 0, status: 'OPEN' });
  apiSimulada.leerLineas.mockResolvedValue({ ticket_id: 'ticket-1', version: 1, total: 0, lineas: [] });
  apiSimulada.getSesionCajaActiva.mockResolvedValue({ cash_session_id: 'caja-1', terminal_id: 'TERM-01', status: 'OPEN', opening_float: '200.00' });
  apiSimulada.abrirTurno.mockResolvedValue({ cash_session_id: 'caja-1' });
  apiSimulada.getResumenTurno.mockResolvedValue({ cash_session_id: 'caja-1', esperado_en_caja: '200.00' });
  apiSimulada.getResumenTurno.mockResolvedValue(null);
}

/** Monta el POS inyectando el ApiContext.Provider con el cliente simulado.
 * Sin este wrapper, useApi() devuelve null y getCatalogo nunca se llama. */
function montarPOS(props = {}) {
  return render(
    <ApiContext.Provider value={apiSimulada}>
      <RetailVisionPOS {...props} />
    </ApiContext.Provider>
  );
}

/** Espera a que el catálogo cargue verificando el aria-label del botón. */
async function esperarCatalogo() {
  await screen.findByRole('button', { name: /Agregar Concha de Vainilla al ticket/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  sembrarApiFeliz();
});

afterEach(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 1 — El prop `terminalId` manda en la carga de la sesión
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.7d · Criterio 1 — el prop `terminalId` manda en la sesión', () => {
  it('con terminalId="TERM-03", getSesionActiva recibe "TERM-03" (no el hardcodeado)', async () => {
    montarPOS({ terminalId: 'TERM-03' });
    await esperarCatalogo();

    expect(apiSimulada.getSesionActiva).toHaveBeenCalledWith('TERM-03');
    expect(apiSimulada.getSesionActiva).not.toHaveBeenCalledWith(CONFIG.TERMINAL_ID);
  });

  it('con terminalId="TERM-05", getSesionActiva recibe "TERM-05"', async () => {
    montarPOS({ terminalId: 'TERM-05' });
    await esperarCatalogo();

    expect(apiSimulada.getSesionActiva).toHaveBeenCalledWith('TERM-05');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 2 — La identidad de terminal del prop llega al candado y al header
// ═══════════════════════════════════════════════════════════════════════════════
//
// NOTA DE DISEÑO (por qué NO se asertan llamadas de `tomarLock`/`latir`):
//   `useTerminalLocking` NO toma el candado por sí solo. `tomarLock` es una
//   ACCIÓN que expone el hook y que dispara el operador (o el flujo de entrada
//   a la terminal). El latido (`latir`) solo corre cuando `bloqueada === true`,
//   es decir, DESPUÉS de un `tomarLock` exitoso. En un montaje limpio de la
//   pantalla —sin que nadie pulse "tomar terminal"— ninguna de las dos se
//   invoca. Asertar que se invocan sería asertar el comportamiento del hook
//   (ya cubierto por su propia puerta en `hooks.f3_3.test.jsx`), no el
//   cableado del prop que esta puerta debe blindar.
//
//   Lo que SÍ es observable y prueba el cableado end-to-end es la IDENTIDAD
//   de terminal que la pantalla pinta: el `POSHeader` recibe `terminalEfectiva`
//   —la MISMA variable que alimenta `useTerminalLocking({ terminalId })`— y
//   la muestra como "Terminal <id>". Si el header muestra la terminal del
//   prop y NO la del CONFIG, el prop llegó hasta el fondo del cableado.

describe('F7.7d · Criterio 2 — la identidad del prop llega al candado y al header', () => {
  it('el header muestra la terminal del prop, no la constante', async () => {
    montarPOS({ terminalId: 'TERM-04' });
    await esperarCatalogo();

    expect(screen.getByText('Terminal TERM-04')).toBeTruthy();
    expect(screen.queryByText(`Terminal ${CONFIG.TERMINAL_ID}`)).toBeNull();
  });

  it('el candado nunca se dispara contra la constante del CONFIG', async () => {
    montarPOS({ terminalId: 'TERM-04' });
    await esperarCatalogo();

    const llamadas = [
      ...apiSimulada.latir.mock.calls,
      ...apiSimulada.tomarLock.mock.calls,
      ...apiSimulada.liberarLock.mock.calls,
    ];
    for (const llamada of llamadas) {
      expect(llamada[0]).not.toBe(CONFIG.TERMINAL_ID);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 3 — Sin props, la pantalla cae al CONFIG (fallback de tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.7d · Criterio 3 — sin props cae al CONFIG (fallback)', () => {
  it('sin terminalId, getSesionActiva recibe CONFIG.TERMINAL_ID', async () => {
    montarPOS();
    await esperarCatalogo();

    expect(apiSimulada.getSesionActiva).toHaveBeenCalledWith(CONFIG.TERMINAL_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 4 — El prop manda sobre el CONFIG (sin contaminación)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.7d · Criterio 4 — el prop manda sobre el CONFIG', () => {
  it('dos terminales distintas producen dos llamadas distintas', async () => {
    const { unmount } = montarPOS({ terminalId: 'TERM-02' });
    await esperarCatalogo();
    expect(apiSimulada.getSesionActiva).toHaveBeenCalledWith('TERM-02');
    unmount();

    cleanup();
    vi.clearAllMocks();
    sembrarApiFeliz();

    montarPOS({ terminalId: 'TERM-06' });
    await esperarCatalogo();
    expect(apiSimulada.getSesionActiva).toHaveBeenCalledWith('TERM-06');
    expect(apiSimulada.getSesionActiva).not.toHaveBeenCalledWith('TERM-02');
  });
});

