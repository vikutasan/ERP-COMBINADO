/**
 * Puerta de FIX-BUG14 — UN SOLO PUNTO DE DECISIÓN DE IMPRESIÓN tras cobrar.
 *
 * PROBLEMA (reportado en vivo): al cerrar la venta saltaba el diálogo de
 * impresión del navegador (auto-impresión, F12.21) y, al omitirlo, el operador
 * caía en el `TicketDeliveryPanel` (F8.5) que volvía a ofrecer Imprimir. Dos
 * puntos de decisión para lo mismo: redundante.
 *
 * SOLUCIÓN: se elimina la auto-impresión del flujo de cobro. El
 * `TicketDeliveryPanel` queda como ÚNICO punto de decisión post-cobro
 * (Imprimir / WhatsApp / Email / Omitir). La impresión sigue respetando
 * `--kiosk-printing` vía `printService`, pero SOLO cuando el operador la pide
 * (RN-87: imprimir siempre disponible). Un fallo de impresión NO revierte el
 * cobro (DT-07).
 *
 * 3 criterios (anti-tautológicos: verifican el EFECTO, no la existencia del
 * símbolo):
 *   1. Al cobrar, `imprimirTicket` NO se llama automáticamente (efecto: el
 *      diálogo del navegador ya no salta solo).
 *   2. El paso de entrega SÍ aparece tras cobrar (el panel es el punto único).
 *   3. Al pulsar "🖨️ Imprimir" en el panel, SÍ se llama a `imprimirTicket` pero
 *      el paso NO se cierra (FIX-BUG15: imprimir ya no cierra; el operador sale
 *      con "Cerrar").
 *
 * Se ejecuta con Vitest (jsdom): `npm run test` en apps/pos.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// ── Cliente `api` simulado (se inyecta en el módulo real) ────────────────────
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
  listarCuentasAbiertas: vi.fn(),
  leerTicket: vi.fn(),
  leerLineas: vi.fn(),
  getSesionCajaActiva: vi.fn(),
  getResumenTurno: vi.fn(),
  getSettingValue: vi.fn(async () => null),
  listarCuentasAbiertas: vi.fn(),
  leerTicket: vi.fn(),
  leerLineas: vi.fn(),
  actualizarPedidoTicket: vi.fn(),
  getSesionCajaActiva: vi.fn(),
  abrirTurno: vi.fn(),
  registrarMovimiento: vi.fn(),
  getResumenTurno: vi.fn(),
  cerrarTurno: vi.fn(),
  getReporteDiario: vi.fn(),
}));

vi.mock('./api/client.js', () => apiSimulada);

// El servicio de cuentas abiertas se simula delegando en el cliente simulado.
vi.mock('./services/openAccountsService.js', () => ({
  listarCuentasAbiertas: vi.fn(async (terminalId) => {
    const id = typeof terminalId === 'string' ? terminalId.trim() : '';
    if (!id) return { outcome: 'error', reason: 'terminal_invalida', data: null };
    try {
      const data = await apiSimulada.listarCuentasAbiertas(id);
      return { outcome: 'ok', reason: null, data };
    } catch (err) {
      return { outcome: 'error', reason: err?.message || 'error_desconocido', data: null };
    }
  }),
  default: {
    listarCuentasAbiertas: vi.fn(async (terminalId) => {
      const id = typeof terminalId === 'string' ? terminalId.trim() : '';
      if (!id) return { outcome: 'error', reason: 'terminal_invalida', data: null };
      try {
        const data = await apiSimulada.listarCuentasAbiertas(id);
        return { outcome: 'ok', reason: null, data };
      } catch (err) {
        return { outcome: 'error', reason: err?.message || 'error_desconocido', data: null };
      }
    }),
  },
}));

// ── Servicio de impresión simulado (espía del EFECTO) ────────────────────────
// El panel lo inyecta por defecto desde `printService.js`; la pantalla ya NO lo
// importa. Se simula el módulo para espiar si la impresión se dispara sola.
const imprimirTicketEspia = vi.hoisted(() => vi.fn(() => ({ outcome: 'ok', reason: null })));

vi.mock('./services/printService.js', () => ({
  imprimirTicket: imprimirTicketEspia,
  imprimirCorte: vi.fn(() => ({ outcome: 'ok', reason: null })),
  default: {
    imprimirTicket: imprimirTicketEspia,
    imprimirCorte: vi.fn(() => ({ outcome: 'ok', reason: null })),
  },
}));

// Importar DESPUÉS de los mocks para que la pantalla reciba los simulados.
import RetailVisionPOS from './RetailVisionPOS.jsx';
import { ApiContext } from './context/ApiContext.jsx'; // TS-01 FIX

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
  // El cobro devuelve el ticket PAID con sus líneas y su `order_type` (el
  // backend los proyecta). Es lo que el panel de entrega consume.
  apiSimulada.cobrarTicket.mockResolvedValue({
    id: 'ticket-1',
    account_num: 'A-0001',
    folio: 'A-0001',
    status: 'PAID',
    order_type: 'VENTA_DIRECTA',
    version: 5,
    total: 18.5,
    lineas: [{ product_id: 'prod-A', qty: 1, unit_price: '18.50' }],
  });
  apiSimulada.verificarEnvio.mockImplementation(async (_t, cuerpo) => ({
    existe: true,
    item_ids_persistidos: cuerpo.item_ids,
    faltantes: [],
  }));
  apiSimulada.latir.mockResolvedValue({ ok: true });
  apiSimulada.tomarLock.mockResolvedValue({ ok: true });
  apiSimulada.liberarLock.mockResolvedValue({ ok: true });
  // TS-01 FIX
  apiSimulada.listarCuentasAbiertas.mockResolvedValue({ cuentas: [] });
  apiSimulada.leerTicket.mockResolvedValue({ id: 'ticket-1', version: 1, total: 0, status: 'OPEN' });
  apiSimulada.leerLineas.mockResolvedValue({ ticket_id: 'ticket-1', version: 1, total: 0, lineas: [] });
  apiSimulada.getSesionCajaActiva.mockResolvedValue({ cash_session_id: 'caja-1', terminal_id: 'TERM-01', status: 'OPEN', opening_float: '200.00' });
  apiSimulada.abrirTurno.mockResolvedValue({ cash_session_id: 'caja-1' });
  apiSimulada.getResumenTurno.mockResolvedValue({ cash_session_id: 'caja-1', esperado_en_caja: '200.00' });
  apiSimulada.getResumenTurno.mockResolvedValue(null);
  apiSimulada.listarCuentasAbiertas.mockResolvedValue({ cuentas: [] });
  apiSimulada.leerTicket.mockResolvedValue({});
  apiSimulada.leerLineas.mockResolvedValue({ lineas: [], version: 1, total: 0 });
  apiSimulada.actualizarPedidoTicket.mockResolvedValue({
    id: 'ticket-1',
    folio: 'A-0001',
    status: 'OPEN',
    version: 2,
    total: 18.5,
  });
  // Caja abierta: el cobro pasa la guardia RN-49.
  apiSimulada.getSesionCajaActiva.mockResolvedValue({
    cash_session_id: 'caja-1',
    terminal_id: 'TERM-01',
    abierta: true,
  });
  apiSimulada.abrirTurno.mockResolvedValue({ cash_session_id: 'caja-1' });
  apiSimulada.getResumenTurno.mockResolvedValue({ cash_session_id: 'caja-1', esperado_en_caja: '200.00' });
  apiSimulada.getResumenTurno.mockResolvedValue({
    cash_session_id: 'caja-1',
    total_efectivo: 0,
    movimientos: [],
  });
}

/** Espera a que el catálogo termine de cargar y aparezcan los productos. */
function montarPOS(props = {}) {
  return render(
    <ApiContext.Provider value={apiSimulada}>
      <RetailVisionPOS {...props} />
    </ApiContext.Provider>
  );
}

async function esperarCatalogo() {
  await screen.findByRole('button', { name: /Agregar Concha de Vainilla al ticket/i });
}

/** Localiza el botón de producto (aria-label "Agregar <nombre> al ticket"). */
function botonProducto() {
  return screen.getByRole('button', {
    name: /Agregar Concha de Vainilla al ticket/i,
  });
}

/** Agrega el producto A y espera a que el ticket se cree en el servidor. */
async function agregarProducto() {
  // Se pulsa el BOTÓN del producto (no el <p> del nombre): solo el botón
  // dispara `onAgregar`, y sin línea en el carrito "COBRAR" queda deshabilitado.
  fireEvent.click(botonProducto());
  await waitFor(() => {
    expect(apiSimulada.crearVenta).toHaveBeenCalled();
  });
}

/**
 * Cobra la venta: abre el checkout (COBRAR), confirma el pago y espera a que el
 * cobro se dispare. El cobro es el disparador del flujo post-cobro.
 */
async function cobrarVenta() {
  const cobrar = await screen.findByRole('button', { name: /COBRAR/i });
  await waitFor(() => {
    expect(cobrar.disabled).toBe(false);
  });
  fireEvent.click(cobrar);

  // El modal arranca en EFECTIVO, y con EFECTIVO "CONFIRMAR PAGO" queda
  // deshabilitado hasta capturar un monto >= total. Se elige "Débito" para
  // habilitarlo sin capturar efectivo.
  fireEvent.click(await screen.findByRole('button', { name: /Débito/i }));
  const confirmar = await screen.findByRole('button', { name: /CONFIRMAR PAGO/i });
  await waitFor(() => {
    expect(confirmar.disabled).toBe(false);
  });
  fireEvent.click(confirmar);

  await waitFor(() => {
    expect(apiSimulada.cobrarTicket).toHaveBeenCalled();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sembrarApiFeliz();
});

afterEach(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 1 — Al cobrar NO se imprime automáticamente
// ═══════════════════════════════════════════════════════════════════════════════

describe('FIX-BUG14 · Criterio 1 — sin auto-impresión al cobrar', () => {
  it('tras cobrar, imprimirTicket NO se llama solo (el diálogo ya no salta)', async () => {
    montarPOS();
    await esperarCatalogo();
    await agregarProducto();
    await cobrarVenta();

    // El paso de entrega ya está abierto (el cobro resolvió). Se da un margen
    // para que cualquier efecto de auto-impresión (si existiera) se dispare.
    await screen.findByRole('dialog', { name: /Entrega del ticket/i });
    await new Promise((r) => setTimeout(r, 50));

    // EFECTO verificado: la impresión NO se disparó por el simple hecho de
    // cobrar. El operador decide en el panel.
    expect(imprimirTicketEspia).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 2 — El paso de entrega es el punto único de decisión
// ═══════════════════════════════════════════════════════════════════════════════

describe('FIX-BUG14 · Criterio 2 — el panel de entrega aparece tras cobrar', () => {
  it('tras cobrar se abre el TicketDeliveryPanel con sus 4 controles', async () => {
    montarPOS();
    await esperarCatalogo();
    await agregarProducto();
    await cobrarVenta();

    const panel = await screen.findByRole('dialog', { name: /Entrega del ticket/i });
    expect(panel).toBeTruthy();

    // Los 4 controles del punto único de decisión. FIX-BUG15: la salida se
    // rotula "Cerrar" (antes "Omitir").
    expect(screen.getByRole('button', { name: /🖨️ Imprimir/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Enviar por WhatsApp/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Enviar por email/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Cerrar$/ })).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 3 — Imprimir desde el panel SÍ imprime, pero NO cierra (FIX-BUG15)
// ═══════════════════════════════════════════════════════════════════════════════

describe('FIX-BUG14 · Criterio 3 — Imprimir desde el panel imprime sin cerrar', () => {
  it('al pulsar "🖨️ Imprimir" se llama a imprimirTicket y el panel SIGUE abierto', async () => {
    montarPOS();
    await esperarCatalogo();
    await agregarProducto();
    await cobrarVenta();

    await screen.findByRole('dialog', { name: /Entrega del ticket/i });

    // El operador pide imprimir: AHORA sí se dispara el servicio.
    fireEvent.click(screen.getByRole('button', { name: /🖨️ Imprimir/i }));

    await waitFor(() => {
      expect(imprimirTicketEspia).toHaveBeenCalledTimes(1);
    });

    // FIX-BUG15: imprimir NO cierra el paso. El panel sigue abierto para que el
    // operador pueda además enviar por WhatsApp/Email y salir con "Cerrar".
    expect(
      screen.queryByRole('dialog', { name: /Entrega del ticket/i }),
    ).not.toBeNull();
  });

  it('solo "Cerrar" cierra el paso (el ciclo post-cobro termina ahí)', async () => {
    montarPOS();
    await esperarCatalogo();
    await agregarProducto();
    await cobrarVenta();

    await screen.findByRole('dialog', { name: /Entrega del ticket/i });

    // Imprimir primero: el panel permanece.
    fireEvent.click(screen.getByRole('button', { name: /🖨️ Imprimir/i }));
    await waitFor(() => expect(imprimirTicketEspia).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole('dialog', { name: /Entrega del ticket/i }),
    ).not.toBeNull();

    // "Cerrar" es la única salida: ahora sí se cierra el paso.
    fireEvent.click(screen.getByRole('button', { name: /^Cerrar$/ }));
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /Entrega del ticket/i }),
      ).toBeNull();
    });
  });
});







