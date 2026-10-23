/**
 * Puerta de FASE 12.30 — GUARDIA DE INTENCIÓN en el camino ENVIAR CUENTA.
 *
 * PROBLEMA (reportado en vivo): F12.24 cerró la contradicción "selector en
 * PEDIDO pero sin programar" SOLO para el camino COBRAR (`confirmarCobro`). El
 * camino ENVIAR CUENTA (`enviarCuentaAlPizarron`, F12.9) seguía mandando la
 * cuenta al pizarrón EN SILENCIO: el post-it nacía VENTA_DIRECTA y el selector
 * seguía mintiendo. El cajero podía "mandar cuentas como si nada aunque estés
 * con PEDIDO seleccionado".
 *
 * SOLUCIÓN (F12.30): la MISMA guardia de intención se aplica al camino ENVIAR
 * CUENTA. Antes de enviar, si `tipoPedido === 'PEDIDO'` y no hay `bloquePedido`,
 * se muestra el aviso con DOS salidas:
 *   (a) "Programar ahora" → abre el modal de programación (no envía).
 *   (b) "Enviar como Venta Directa" → regresa el selector a VENTA_DIRECTA y
 *       REANUDA el envío (bypass explícito `forzarVentaDirecta`).
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
  listarCuentasAbiertas: vi.fn(), leerTicket: vi.fn(), leerLineas: vi.fn(),
  getSesionCajaActiva: vi.fn(), getResumenTurno: vi.fn(), getSettingValue: vi.fn(async () => null),
  listarCuentasAbiertas: vi.fn(),
  leerTicket: vi.fn(),
  leerLineas: vi.fn(),
  // Caja (RN-49): el cobro exige una sesión de caja ABIERTA en la terminal.
  getSesionCajaActiva: vi.fn(),
  abrirTurno: vi.fn(),
  registrarMovimiento: vi.fn(),
  getResumenTurno: vi.fn(),
  cerrarTurno: vi.fn(),
  getReporteDiario: vi.fn(),
}));

vi.mock('./api/client.js', () => apiSimulada);
vi.mock('./services/cashService.js', () => ({
  obtenerTurnoActivo: vi.fn(async () => ({ outcome: 'ok', data: null })),
  abrirTurno: vi.fn(async () => ({ outcome: 'ok', data: null })),
  registrarMovimiento: vi.fn(async () => ({ outcome: 'ok', data: null })),
  cerrarTurno: vi.fn(async () => ({ outcome: 'ok', data: null })),
  obtenerResumen: vi.fn(async () => ({ outcome: 'ok', data: null })),
  default: { obtenerTurnoActivo: vi.fn(async () => ({ outcome: 'ok', data: null })), abrirTurno: vi.fn(async () => ({ outcome: 'ok', data: null })), registrarMovimiento: vi.fn(async () => ({ outcome: 'ok', data: null })), cerrarTurno: vi.fn(async () => ({ outcome: 'ok', data: null })), obtenerResumen: vi.fn(async () => ({ outcome: 'ok', data: null })) },
}));
vi.mock('./services/openAccountsService.js', () => ({
  listarCuentasAbiertas: vi.fn(async () => ({ outcome: 'ok', reason: null, data: { cuentas: [] } })),
  default: { listarCuentasAbiertas: vi.fn(async () => ({ outcome: 'ok', reason: null, data: { cuentas: [] } })) },
}));

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

// Importar DESPUÉS de los mocks para que la pantalla reciba los simulados.
import RetailVisionPOS from './RetailVisionPOS.jsx';
import { ApiContext } from './context/ApiContext.jsx'; // TS-01

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
    id: 'ticket-1',
    folio: 'A-0001',
    status: 'PAID',
    version: 5,
    total: 18.5,
  });
  apiSimulada.verificarEnvio.mockImplementation(async (_t, cuerpo) => ({
    existe: true,
    item_ids_persistidos: cuerpo.item_ids,
    faltantes: [],
  }));
  apiSimulada.latir.mockResolvedValue({ ok: true });
  apiSimulada.tomarLock.mockResolvedValue({ ok: true });
  apiSimulada.liberarLock.mockResolvedValue({ ok: true });
  apiSimulada.listarCuentasAbiertas.mockResolvedValue({ cuentas: [] });
  apiSimulada.leerTicket.mockResolvedValue({});
  apiSimulada.leerLineas.mockResolvedValue({ lineas: [], version: 1, total: 0 });
  // Caja abierta: el cobro pasa la guardia RN-49.
  apiSimulada.getSesionCajaActiva.mockResolvedValue({
    cash_session_id: 'caja-1',
    terminal_id: 'TERM-01',
    abierta: true,
  });
  apiSimulada.getResumenTurno.mockResolvedValue({
    cash_session_id: 'caja-1',
    total_efectivo: 0,
    movimientos: [],
  });
}

/** Espera a que el catálogo termine de cargar y aparezcan los productos. */
function montarPOS(props = {}) {
  return render(<ApiContext.Provider value={apiSimulada}><RetailVisionPOS {...props} /></ApiContext.Provider>);
}

async function esperarCatalogo() {
  await screen.findByRole('button', { name: /Agregar Concha de Vainilla al ticket/i });
}

/** Activa el modo PEDIDO en el selector del header. */
function activarModoPedido() {
  fireEvent.click(screen.getByRole('button', { name: /📦 Pedido/i }));
}

/**
 * Agrega el producto A y espera a que el ticket exista en el servidor.
 * NO abre el checkout: el camino ENVIAR CUENTA no pasa por el modal de pago.
 */
async function agregarProducto() {
  fireEvent.click(screen.getByText('Concha de Vainilla'));
  await waitFor(() => {
    expect(apiSimulada.crearVenta).toHaveBeenCalled();
  });
}

/** Localiza el botón ENVIAR CUENTA del ticket (panel lateral de escritorio). */
async function botonEnviarCuenta() {
  const boton = await screen.findByRole('button', { name: /ENVIAR CUENTA/i });
  await waitFor(() => {
    expect(boton.disabled).toBe(false);
  });
  return boton;
}

beforeEach(() => {
  vi.clearAllMocks();
  sembrarApiFeliz();
});

afterEach(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 1 — PEDIDO sin programar: NO envía, muestra el aviso
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.30 · Criterio 1 — PEDIDO sin programar detiene el ENVÍO', () => {
  it('con el selector en PEDIDO y sin bloque, aparece el aviso y NO se envía', async () => {
    montarPOS();
    await esperarCatalogo();

    activarModoPedido();
    await agregarProducto();

    const enviar = await botonEnviarCuenta();
    fireEvent.click(enviar);

    // El diálogo de confirmación aparece (la MISMA guardia que F12.24).
    expect(
      await screen.findByRole('alertdialog', { name: /Pedido sin programar/i }),
    ).toBeTruthy();

    // Y el envío NO se disparó: el ticket NO se vació (la cuenta sigue en el
    // carrito). El marcador "★ El ticket esta vacio ★" solo aparece tras un
    // envío exitoso que limpia el carrito.
    expect(screen.queryByText(/El ticket esta vacio/i)).toBeNull();
  });

  it('el aviso ofrece las dos salidas (Programar ahora / Venta Directa)', async () => {
    montarPOS();
    await esperarCatalogo();

    activarModoPedido();
    await agregarProducto();

    const enviar = await botonEnviarCuenta();
    fireEvent.click(enviar);

    await screen.findByRole('alertdialog', { name: /Pedido sin programar/i });
    expect(screen.getByRole('button', { name: /Programar ahora/i })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Enviar como Venta Directa/i }),
    ).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 2 — "Programar ahora" abre el modal y NO envía
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.30 · Criterio 2 — "Programar ahora" abre el modal', () => {
  it('al pulsar "Programar ahora" se abre el modal de programación', async () => {
    montarPOS();
    await esperarCatalogo();

    activarModoPedido();
    await agregarProducto();

    const enviar = await botonEnviarCuenta();
    fireEvent.click(enviar);

    await screen.findByRole('alertdialog', { name: /Pedido sin programar/i });
    fireEvent.click(screen.getByRole('button', { name: /Programar ahora/i }));

    expect(
      await screen.findByRole('dialog', { name: /Programación del pedido/i }),
    ).toBeTruthy();

    // El aviso se cerró y la cuenta sigue en el carrito (no se envió): el
    // ticket NO muestra el marcador de vacío.
    expect(
      screen.queryByRole('alertdialog', { name: /Pedido sin programar/i }),
    ).toBeNull();
    expect(screen.queryByText(/El ticket esta vacio/i)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 3 — "Enviar como Venta Directa" reanuda el ENVÍO
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.30 · Criterio 3 — "Enviar como Venta Directa" reanuda el envío', () => {
  it('al elegir Venta Directa, el envío procede y el selector vuelve a VENTA_DIRECTA', async () => {
    montarPOS();
    await esperarCatalogo();

    activarModoPedido();
    await agregarProducto();

    const enviar = await botonEnviarCuenta();
    fireEvent.click(enviar);

    await screen.findByRole('alertdialog', { name: /Pedido sin programar/i });
    fireEvent.click(
      screen.getByRole('button', { name: /Enviar como Venta Directa/i }),
    );

    // El envío se reanuda: la cuenta se limpia del carrito (se fue al pizarrón).
    // El ticket muestra el marcador de vacío tras el envío exitoso.
    await waitFor(() => {
      expect(screen.getByText(/El ticket esta vacio/i)).toBeTruthy();
    });

    // El ticket se creó SIN campos de pedido (venta directa, RN-59).
    const cuerpo = apiSimulada.crearVenta.mock.calls[0][0];
    expect(cuerpo.order_type).toBeUndefined();

    // El selector regresó a VENTA_DIRECTA (el estado visible coincide con lo
    // que se envió: se acabó la mentira visual).
    await waitFor(() => {
      const btnDirecta = document.getElementById('btn-venta-directa');
      expect(btnDirecta.getAttribute('aria-pressed')).toBe('true');
    });
  });
});


