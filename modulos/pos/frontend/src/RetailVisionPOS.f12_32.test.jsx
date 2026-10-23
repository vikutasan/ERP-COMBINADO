/**
 * Puerta de FASE 12.32 — RESET DEL CONTEXTO DE PEDIDO tras ENVIAR CUENTA.
 *
 * PROBLEMA (reportado en vivo): al enviar una cuenta al pizarrón, el selector
 * VENTA DIRECTA / PEDIDO (F12.1) se quedaba en 'PEDIDO' y `bloquePedido`
 * conservaba el bloque del pedido ANTERIOR. Dos consecuencias:
 *   (a) El POS seguía mostrando "PEDIDO" aunque la cuenta ya se había enviado
 *       (mentira visual: la próxima venta nacía marcada como pedido).
 *   (b) La guardia de intención de F12.24/F12.30 (`tipoPedido === 'PEDIDO' &&
 *       !bloquePedido`) quedaba BYPASSEADA por el `bloquePedido` pegado: la
 *       siguiente cuenta se enviaba "sin programar" en silencio.
 *
 * SOLUCIÓN: tras un envío EXITOSO, `enviarCuentaAlPizarron` resetea el contexto
 * de pedido (`setTipoPedido('VENTA_DIRECTA')` + `setBloquePedido(null)`),
 * paridad con `onOrderDataClear` del viejo POS. La cuenta enviada conserva su
 * programación en el servidor (contrato 31); el POS arranca la siguiente venta
 * LIMPIO.
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
  // Contrato 31 — persistir la programación del pedido en un ticket existente.
  actualizarPedidoTicket: vi.fn(),
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
  // Contrato 31: el PATCH de programación devuelve el ticket con versión fresca.
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

/** Agrega el producto A y espera a que el ticket se cree en el servidor. */
async function agregarProducto() {
  fireEvent.click(screen.getByText('Concha de Vainilla'));
  await waitFor(() => {
    expect(apiSimulada.crearVenta).toHaveBeenCalled();
  });
}

/**
 * Programa el pedido por el modal (📌): rellena nombre y teléfono (la fecha ya
 * viene pre-llenada) y guarda. El modal confirma con un `setTimeout` de 1200 ms
 * antes de llamar a `onGuardar`, por eso se espera al cierre del diálogo.
 */
async function programarPedido() {
  fireEvent.click(screen.getByRole('button', { name: /Programar pedido/i }));
  await screen.findByRole('dialog', { name: /Programación del pedido/i });

  fireEvent.change(document.getElementById('input-customer-name'), {
    target: { value: 'María García' },
  });
  fireEvent.change(document.getElementById('input-customer-phone'), {
    target: { value: '3121234567' },
  });

  const guardar = document.getElementById('btn-guardar-pedido');
  await waitFor(() => {
    expect(guardar.disabled).toBe(false);
  });
  fireEvent.click(guardar);

  // El modal muestra la pantalla de confirmación ("Pedido tentativo registrado")
  // y, tras un `setTimeout` de 1200 ms, llama a `onGuardar` y se cierra. Hay que
  // esperar a que AMBOS diálogos desaparezcan: esperar solo al de programación
  // resolvía demasiado pronto (la confirmación lo reemplaza antes de `onGuardar`).
  await waitFor(
    () => {
      expect(
        screen.queryByRole('dialog', { name: /Pedido tentativo registrado/i }),
      ).toBeNull();
      expect(
        screen.queryByRole('dialog', { name: /Programación del pedido/i }),
      ).toBeNull();
    },
    { timeout: 4000 },
  );
}

/** Devuelve el botón 📌 ENVIAR CUENTA del ticket. */
async function botonEnviarCuenta() {
  return screen.findByRole('button', { name: /ENVIAR CUENTA/i });
}

/** Lee el estado del selector VENTA DIRECTA / PEDIDO. */
function selectorEnVentaDirecta() {
  return document.getElementById('btn-venta-directa')?.getAttribute('aria-pressed') === 'true';
}

beforeEach(() => {
  vi.clearAllMocks();
  sembrarApiFeliz();
});

afterEach(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 1 — Tras enviar, el selector regresa a VENTA_DIRECTA
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.32 · Criterio 1 — el selector se resetea tras enviar', () => {
  it('con el selector en PEDIDO y bloque programado, tras enviar vuelve a VENTA_DIRECTA', async () => {
    montarPOS();
    await esperarCatalogo();

    // El cajero programa un pedido (bloque presente) → el envío NO se detiene.
    activarModoPedido();
    await agregarProducto();
    await programarPedido();

    // Enviar la cuenta al pizarrón.
    const enviar = await botonEnviarCuenta();
    await waitFor(() => {
      expect(enviar.disabled).toBe(false);
    });
    fireEvent.click(enviar);

    // El envío procede (clearCart verificado) y el selector se resetea.
    await waitFor(() => {
      expect(selectorEnVentaDirecta()).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 2 — Tras enviar, el carrito queda vacío (cuenta nueva)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.32 · Criterio 2 — tras enviar, el ticket queda vacío', () => {
  it('el envío limpia el carrito y deja el ticket listo para una cuenta nueva', async () => {
    montarPOS();
    await esperarCatalogo();

    activarModoPedido();
    await agregarProducto();
    await programarPedido();

    const enviar = await botonEnviarCuenta();
    await waitFor(() => {
      expect(enviar.disabled).toBe(false);
    });
    fireEvent.click(enviar);

    // El ticket queda vacío (marcador del componente SalesReceipt).
    await waitFor(() => {
      expect(screen.getByText(/El ticket esta vacio/i)).toBeTruthy();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 3 — La guardia NO se salta con un bloque pegado
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.32 · Criterio 3 — la guardia de intención no se bypassea', () => {
  it('tras enviar, una nueva cuenta en PEDIDO sin programar vuelve a detenerse', async () => {
    montarPOS();
    await esperarCatalogo();

    // 1) Primera cuenta: PEDIDO programado → se envía y el contexto se limpia.
    activarModoPedido();
    await agregarProducto();
    await programarPedido();

    const enviar1 = await botonEnviarCuenta();
    await waitFor(() => {
      expect(enviar1.disabled).toBe(false);
    });
    fireEvent.click(enviar1);
    await waitFor(() => {
      expect(selectorEnVentaDirecta()).toBe(true);
    });

    // 2) Segunda cuenta: el cajero vuelve a poner PEDIDO pero NO programa nada.
    activarModoPedido();
    await agregarProducto();

    const enviar2 = await botonEnviarCuenta();
    await waitFor(() => {
      expect(enviar2.disabled).toBe(false);
    });
    fireEvent.click(enviar2);

    // La guardia de intención (F12.30) vuelve a detener el envío: el bloque
    // pegado de la cuenta anterior NO debe bypassearla.
    expect(
      await screen.findByRole('alertdialog', { name: /Pedido sin programar/i }),
    ).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 4 — "Enviar como Venta Directa" desde el aviso reanuda el envío
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.32 · Criterio 4 — el aviso reanuda el envío como Venta Directa', () => {
  it('al elegir "Enviar como Venta Directa" la cuenta se envía y el selector queda limpio', async () => {
    montarPOS();
    await esperarCatalogo();

    activarModoPedido();
    await agregarProducto();

    const enviar = await botonEnviarCuenta();
    await waitFor(() => {
      expect(enviar.disabled).toBe(false);
    });
    fireEvent.click(enviar);

    // Aparece el aviso (PEDIDO sin programar).
    await screen.findByRole('alertdialog', { name: /Pedido sin programar/i });
    fireEvent.click(
      screen.getByRole('button', { name: /Enviar como Venta Directa/i }),
    );

    // El envío se reanuda y el selector queda en VENTA_DIRECTA.
    await waitFor(() => {
      expect(selectorEnVentaDirecta()).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText(/El ticket esta vacio/i)).toBeTruthy();
    });
  });
});


