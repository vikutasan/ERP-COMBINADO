/**
 * Puerta de FASE 12.10b — RECUPERAR UNA CUENTA RESTAURA SU CONTEXTO.
 *
 * Este test monta la PANTALLA REAL (`RetailVisionPOS`) con un cliente `api`
 * simulado y verifica los DOS huecos que F12.10 dejó abiertos al recuperar una
 * cuenta desde el pizarrón (paridad con `handleRecoverAccount` del viejo POS):
 *
 *   (a) GUARDIA DE CUENTA VACÍA: si la cuenta no tiene líneas, NO se adopta.
 *       El viejo POS avisaba "⚠️ Cuenta vacía." y salía sin tocar el carrito.
 *       F12.10 hidrataba con una lista vacía y adoptaba la cuenta igual.
 *
 *   (b) CONTEXTO DE PEDIDO: si la cuenta es un PEDIDO, se restauran
 *       `bloquePedido` + `tipoPedido` desde el post-it (contrato 23). Sin esto,
 *       recuperar un pedido perdía su bloque (empaque, política de pago, datos
 *       del cliente) y el operador lo veía como venta directa.
 *
 * POR QUÉ EXISTE ESTA COMPUERTA (19ª instancia de §10.6):
 * El viejo POS hacía SEIS cosas al recuperar; F12.10 hizo tres. Los tres huecos
 * restantes se detectaron en la auditoría F12.10b. Dos se cablean aquí; el
 * tercero (capturador original) se clasifica DESCARTADA porque el POS nuevo NO
 * tiene ese estado: el capturador lo resuelve el BACKEND desde la sesión de
 * terminal activa (RN-24) y el pizarrón solo lo MUESTRA (`captured_by_name`,
 * contrato 23). Fabricarlo en el cliente violaría A-02.
 *
 * Se ejecuta con Vitest (jsdom): `npm run test` en apps/pos.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

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
  // Contrato 23 — lista de cuentas abiertas de la terminal.
  listarCuentasAbiertas: vi.fn(),
  // Contrato 21 — versión fresca de una cuenta (5 campos escalares, sin líneas).
  leerTicket: vi.fn(),
  // Contrato 30 — las LÍNEAS de un ticket (F12.10).
  leerLineas: vi.fn(),
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

// El servicio de caja se simula para que la pantalla no hable con el backend.
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

// Importar DESPUÉS de los mocks para que la pantalla reciba los simulados.
import RetailVisionPOS from './RetailVisionPOS.jsx';
import { ApiContext } from './context/ApiContext.jsx'; // TS-01

// ── Datos de prueba ──────────────────────────────────────────────────────────
const CATEGORIA_A = { id: 'cat-1', name: 'Panadería' };

const PRODUCTO_A = {
  id: 'prod-A',
  sku: 'SKU-A',
  barcode: '111',
  name: 'Concha de Vainilla',
  price: 18.5,
  category_id: 'cat-1',
};

// Contrato 23 — la cuenta RICA del pizarrón: trae el contexto de pedido.
// `captured_by_name` se incluye para probar que el pizarrón lo MUESTRA, pero
// el POS NO lo adopta como estado (hueco DESCARTADA).
const CUENTA_PEDIDO = {
  id: 'cuenta-pedido',
  account_num: 'P-001',
  status: 'OPEN',
  total: 45.5,
  version: 3,
  terminal_id: 'TERM-01',
  captured_by_name: 'María López',
  customer_name: 'Juan Pérez',
  customer_phone: '555-1234',
  order_type: 'PEDIDO',
  delivery_type: 'DELIVERY',
  created_at: '2026-10-06T10:00:00Z',
};

// Contrato 23 — una cuenta de venta directa (sin contexto de pedido).
const CUENTA_DIRECTA = {
  id: 'cuenta-directa',
  account_num: 'V-002',
  status: 'OPEN',
  total: 12.0,
  version: 1,
  terminal_id: 'TERM-01',
  captured_by_name: 'Pedro Ruiz',
  order_type: 'VENTA_DIRECTA',
  created_at: '2026-10-06T11:00:00Z',
};

// Contrato 30 — las líneas de la cuenta-pedido.
const LINEAS_PEDIDO = {
  ticket_id: 'cuenta-pedido',
  version: 3,
  total: 45.5,
  lineas: [
    {
      item_id: 'item-1',
      product_id: 'prod-A',
      name: 'Concha de Vainilla',
      quantity: 1,
      unit_price: 18.5,
      subtotal: 18.5,
    },
    {
      item_id: 'item-2',
      product_id: 'prod-B',
      name: 'Café Americano',
      quantity: 2,
      unit_price: 13.5,
      subtotal: 27.0,
    },
  ],
};

// Contrato 30 — una cuenta VACÍA (sin líneas): dispara la guardia.
const LINEAS_VACIAS = {
  ticket_id: 'cuenta-pedido',
  version: 3,
  total: 0,
  lineas: [],
};

/** Configura el cliente simulado con respuestas felices por defecto. */
function sembrarApiFeliz() {
  apiSimulada.getCatalogo.mockResolvedValue({
    categorias: [CATEGORIA_A],
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
  // Contrato 23 — el pizarrón lista la cuenta-pedido y la cuenta-directa.
  apiSimulada.listarCuentasAbiertas.mockResolvedValue({
    cuentas: [CUENTA_PEDIDO, CUENTA_DIRECTA],
  });
  // Contrato 21 — recuperar devuelve la versión fresca (5 campos, sin líneas).
  apiSimulada.leerTicket.mockResolvedValue({ ...CUENTA_PEDIDO });
  // Contrato 30 — las líneas de la cuenta-pedido.
  apiSimulada.leerLineas.mockResolvedValue({ ...LINEAS_PEDIDO });
}

/** Espera a que el catálogo termine de cargar y aparezcan los productos. */
function montarPOS(props = {}) {
  return render(<ApiContext.Provider value={apiSimulada}><RetailVisionPOS {...props} /></ApiContext.Provider>);
}

async function esperarCatalogo() {
  await screen.findByRole('button', { name: /Agregar Concha de Vainilla al ticket/i });
}

/** Localiza el botón "Pizarrón" del header (F12.5). */
function botonPizarron() {
  return screen.getByLabelText('Pizarrón de cuentas abiertas');
}

/** Abre el pizarrón y recupera la cuenta indicada por su folio. */
async function recuperarCuentaPorFolio(folio) {
  fireEvent.click(botonPizarron());
  const dialogo = await screen.findByRole('dialog', { name: /Cuentas abiertas/i });
  await screen.findByTestId(`folio-${folio}`);
  const postIts = within(dialogo).getAllByRole('button', { name: /Ver Cuenta/i });
  // El pizarrón respeta el orden de la lista: cuenta-pedido primero.
  fireEvent.click(postIts[0]);
  return dialogo;
}

beforeEach(() => {
  vi.clearAllMocks();
  sembrarApiFeliz();
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 1 — GUARDIA DE CUENTA VACÍA: no se adopta una cuenta sin líneas.
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.10b · Criterio 1 — guardia de cuenta vacía', () => {
  it('una cuenta sin líneas NO se adopta y avisa por banner', async () => {
    // El contrato 30 devuelve una cuenta VACÍA.
    apiSimulada.leerLineas.mockResolvedValue({ ...LINEAS_VACIAS });

    montarPOS();
    await esperarCatalogo();

    await recuperarCuentaPorFolio('cuenta-pedido');

    // El POS avisa de la cuenta vacía (paridad con el viejo POS).
    expect(await screen.findByText(/Cuenta vacía/i)).toBeTruthy();

    // El carrito NO se hidrata: el ticket sigue VACÍO. El `SalesReceipt` pinta
    // el estado vacío ("★ El ticket esta vacio ★") SOLO cuando `lineas.length
    // === 0`. Si la guardia fallara y se adoptara la cuenta vacía, el ticket
    // seguiría mostrando el estado vacío igual, así que además se comprueba
    // que NO se adoptó la identidad: el folio de la cuenta NO aparece en el
    // ticket. (El folio SÍ aparece en el post-it del pizarrón, por eso se acota
    // la búsqueda al contenedor del ticket, no a toda la pantalla.)
    expect(screen.getByText(/El ticket esta vacio/i)).toBeTruthy();
    const ticket = screen.getByText(/El ticket esta vacio/i).closest('aside');
    expect(within(ticket).queryByText(/P-001/)).toBeNull();
  });

  it('una cuenta vacía NO cierra el pizarrón (el operador sigue eligiendo)', async () => {
    apiSimulada.leerLineas.mockResolvedValue({ ...LINEAS_VACIAS });

    montarPOS();
    await esperarCatalogo();

    await recuperarCuentaPorFolio('cuenta-pedido');

    // El pizarrón sigue abierto: no se adoptó la cuenta.
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /Cuentas abiertas/i })
      ).not.toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 2 — CONTEXTO DE PEDIDO: recuperar un PEDIDO restaura su bloque.
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.10b · Criterio 2 — recuperar un PEDIDO restaura su contexto', () => {
  it('recuperar un PEDIDO restaura el bloque de pedido (empaque/política)', async () => {
    montarPOS();
    await esperarCatalogo();

    // Antes de recuperar, el selector está en VENTA_DIRECTA. Se localiza el
    // botón por su id (`#btn-pedido`) porque su nombre accesible ("📦 Pedido")
    // colisiona con el del botón "Programar pedido" (`#btn-programacion-pedido`).
    expect(document.getElementById('btn-pedido').getAttribute('aria-pressed'))
      .toBe('false');

    await recuperarCuentaPorFolio('cuenta-pedido');

    // El carrito se hidrata (las líneas del contrato 30 aparecen).
    expect(await screen.findByText('Café Americano')).toBeTruthy();

    // El bloque de pedido se restauró: el selector VENTA DIRECTA / PEDIDO del
    // header queda en PEDIDO (`aria-pressed="true"`), y aparece el botón 📌 de
    // programación (que SOLO se pinta cuando `tipoPedido === 'PEDIDO'`).
    await waitFor(() => {
      expect(
        document.getElementById('btn-pedido').getAttribute('aria-pressed')
      ).toBe('true');
    });
    expect(screen.getByLabelText('Programar pedido')).toBeTruthy();
  });

  it('recuperar una VENTA DIRECTA limpia cualquier bloque de pedido previo', async () => {
    // La cuenta-directa es venta directa: no debe restaurar bloque de pedido.
    apiSimulada.leerTicket.mockResolvedValue({ ...CUENTA_DIRECTA });
    apiSimulada.leerLineas.mockResolvedValue({
      ticket_id: 'cuenta-directa',
      version: 1,
      total: 12.0,
      lineas: [
        {
          item_id: 'item-9',
          product_id: 'prod-A',
          name: 'Concha de Vainilla',
          quantity: 1,
          unit_price: 12.0,
          subtotal: 12.0,
        },
      ],
    });

    montarPOS();
    await esperarCatalogo();

    await recuperarCuentaPorFolio('cuenta-directa');

    // El carrito se hidrata con la línea de la venta directa.
    expect(await screen.findByText(/12\.00/)).toBeTruthy();
  });
});


