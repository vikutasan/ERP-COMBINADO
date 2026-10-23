/**
 * Puerta de FASE 12.24 — GUARDIA DE INTENCIÓN: "PEDIDO sin programar".
 *
 * PROBLEMA (reportado en vivo): el selector VENTA DIRECTA / PEDIDO (F12.1) y el
 * bloque de programación (`bloquePedido`) son DOS estados independientes. Si el
 * cajero deja el selector en PEDIDO pero NUNCA toca 📌 "Programar pedido", al
 * enviar la cuenta el sistema la mandaba como VENTA DIRECTA en silencio: una
 * mentira visual. En R de Rico TODO pedido requiere fecha y hora.
 *
 * SOLUCIÓN: antes de cobrar, si `tipoPedido === 'PEDIDO'` y no hay bloque, se
 * muestra un diálogo de confirmación con DOS salidas:
 *   (a) "Programar ahora" → abre el modal de programación (no cobra).
 *   (b) "Enviar como Venta Directa" → regresa el selector a VENTA_DIRECTA y
 *       REANUDA el cobro (el ticket se manda sin `order_type`).
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
// TS-01 — `obtenerTurnoActivo` DELEGA en el cliente simulado para que el turno
// sembrado en `getSesionCajaActiva` habilite COBRAR (RN-49). Devolver `data: null`
// dejaba la terminal sin caja y el botón COBRAR siempre deshabilitado.
// NOTA: la fábrica de `vi.mock` se iza al tope del archivo, así que la delegación
// se define DENTRO de la fábrica (solo `apiSimulada`, creado con `vi.hoisted`, es visible).
vi.mock('./services/cashService.js', () => {
  const obtenerTurnoActivo = vi.fn(async (terminalId) => {
    try {
      const data = await apiSimulada.getSesionCajaActiva(terminalId);
      return { outcome: 'ok', reason: null, data: data ?? null };
    } catch (err) {
      return { outcome: 'error', reason: err?.message || 'error_desconocido', data: null };
    }
  });
  return {
    obtenerTurnoActivo,
    abrirTurno: vi.fn(async () => ({ outcome: 'ok', data: null })),
    registrarMovimiento: vi.fn(async () => ({ outcome: 'ok', data: null })),
    cerrarTurno: vi.fn(async () => ({ outcome: 'ok', data: null })),
    obtenerResumen: vi.fn(async () => ({ outcome: 'ok', data: null })),
    default: { obtenerTurnoActivo, abrirTurno: vi.fn(async () => ({ outcome: 'ok', data: null })), registrarMovimiento: vi.fn(async () => ({ outcome: 'ok', data: null })), cerrarTurno: vi.fn(async () => ({ outcome: 'ok', data: null })), obtenerResumen: vi.fn(async () => ({ outcome: 'ok', data: null })) },
  };
});
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
 * Agrega el producto A, abre el checkout y confirma el pago (Débito).
 * NO espera a que el cobro resuelva: el llamador decide qué verificar.
 */
async function agregarYAbrirCheckout() {
  fireEvent.click(screen.getByText('Concha de Vainilla'));
  await waitFor(() => {
    expect(apiSimulada.crearVenta).toHaveBeenCalled();
  });

  const cobrar = await screen.findByRole('button', { name: /COBRAR/i });
  await waitFor(() => {
    expect(cobrar.disabled).toBe(false);
  });
  fireEvent.click(cobrar);

  fireEvent.click(await screen.findByRole('button', { name: /Débito/i }));
  const confirmar = await screen.findByRole('button', { name: /CONFIRMAR PAGO/i });
  await waitFor(() => {
    expect(confirmar.disabled).toBe(false);
  });
  fireEvent.click(confirmar);
}

beforeEach(() => {
  vi.clearAllMocks();
  sembrarApiFeliz();
});

afterEach(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 1 — PEDIDO sin programar: NO cobra, muestra el aviso
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.24 · Criterio 1 — PEDIDO sin programar detiene el cobro', () => {
  it('con el selector en PEDIDO y sin bloque, aparece el aviso y NO se cobra', async () => {
    montarPOS();
    await esperarCatalogo();

    activarModoPedido();
    await agregarYAbrirCheckout();

    // El diálogo de confirmación aparece.
    expect(
      await screen.findByRole('alertdialog', { name: /Pedido sin programar/i }),
    ).toBeTruthy();

    // Y el cobro NO se disparó.
    expect(apiSimulada.cobrarTicket).not.toHaveBeenCalled();
  });

  it('el aviso ofrece las dos salidas (Programar ahora / Venta Directa)', async () => {
    montarPOS();
    await esperarCatalogo();

    activarModoPedido();
    await agregarYAbrirCheckout();

    await screen.findByRole('alertdialog', { name: /Pedido sin programar/i });
    expect(screen.getByRole('button', { name: /Programar ahora/i })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Enviar como Venta Directa/i }),
    ).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 2 — "Programar ahora" abre el modal y NO cobra
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.24 · Criterio 2 — "Programar ahora" abre el modal', () => {
  it('al pulsar "Programar ahora" se abre el modal de programación', async () => {
    montarPOS();
    await esperarCatalogo();

    activarModoPedido();
    await agregarYAbrirCheckout();

    await screen.findByRole('alertdialog', { name: /Pedido sin programar/i });
    fireEvent.click(screen.getByRole('button', { name: /Programar ahora/i }));

    expect(
      await screen.findByRole('dialog', { name: /Programación del pedido/i }),
    ).toBeTruthy();

    // El aviso se cerró y el cobro sigue sin dispararse.
    expect(
      screen.queryByRole('alertdialog', { name: /Pedido sin programar/i }),
    ).toBeNull();
    expect(apiSimulada.cobrarTicket).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 3 — "Enviar como Venta Directa" reanuda el cobro sin `order_type`
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.24 · Criterio 3 — "Enviar como Venta Directa" reanuda el cobro', () => {
  it('al elegir Venta Directa, el cobro procede y el selector vuelve a VENTA_DIRECTA', async () => {
    montarPOS();
    await esperarCatalogo();

    activarModoPedido();
    await agregarYAbrirCheckout();

    await screen.findByRole('alertdialog', { name: /Pedido sin programar/i });
    fireEvent.click(
      screen.getByRole('button', { name: /Enviar como Venta Directa/i }),
    );

    // El cobro se reanuda y resuelve.
    await waitFor(() => {
      expect(apiSimulada.cobrarTicket).toHaveBeenCalled();
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


