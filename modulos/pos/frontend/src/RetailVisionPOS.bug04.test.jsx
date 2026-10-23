/**
 * Puerta de BUG-04 — RECUPERAR UN PEDIDO DEL PIZARRÓN RESTAURA SU FECHA
 * COMPROMISO DE ENTREGA.
 *
 * REPORTE DEL USUARIO (10 Oct 2026):
 *   "HAY UN DETALLE AL COBRAR PEDIDOS INVOCÁNDOLOS DESDE EL PIZARRÓN YA QUE AL
 *    INVOCARLOS NO PERSISTEN LA INFORMACIÓN DE LA FECHA COMPROMISO DE ENTREGA,
 *    SOLO LA PERSISTEN SI SE LA AGREGO DESDE ESA MISMA TERMINAL."
 *
 * DIAGNÓSTICO:
 *   El dato NUNCA se perdió en la BD: la columna `committed_at` del ticket
 *   siempre lo guardó (contrato 31). Se perdía en el ESTADO LOCAL del cliente:
 *   `recuperarCuentaAlCarrito` reconstruía el bloque `order_*` desde el post-it
 *   (contrato 23) restaurando SOLO 4 campos (`order_type`, `delivery_type`,
 *   `customer_name`, `customer_phone`) y OMITÍA `committed_at` (y con él
 *   `packaging_type`, `delivery_address`, `order_notes`). Por eso el pedido
 *   "solo conservaba la fecha si nunca salía de la terminal".
 *
 * CORRECCIÓN (frontera A-02, dos lados):
 *   (1) BACKEND — el contrato 23 (`CuentaAbiertaSalida`) ahora proyecta los
 *       cuatro campos de contexto de pedido. Sin ellos el cliente no tenía de
 *       dónde reconstruir el bloque.
 *   (2) FRONTEND — `recuperarCuentaAlCarrito` los pasa a `construirBloquePedido`.
 *
 * ESTA COMPUERTA verifica el lado FRONTEND: tras recuperar un PEDIDO del
 * pizarrón, al abrir el modal de programación, el input de fecha compromiso
 * (`#input-committed-at`) muestra la fecha que viajó en el post-it.
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

// La fecha compromiso que viaja en el post-it (contrato 23, BUG-04).
const COMMITTED_AT = '2026-10-12T18:30:00.000Z';

// Contrato 23 — la cuenta RICA del pizarrón: trae el contexto de pedido
// COMPLETO (BUG-04: incluye `committed_at`, `packaging_type`,
// `delivery_address` y `order_notes`).
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
  // BUG-04 — contexto de pedido completo.
  committed_at: COMMITTED_AT,
  packaging_type: 'CAJA',
  delivery_address: 'Av. Reforma 123, Col. Centro',
  order_notes: 'Sin nueces, por favor',
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
  // Contrato 23 — el pizarrón lista la cuenta-pedido.
  apiSimulada.listarCuentasAbiertas.mockResolvedValue({
    cuentas: [CUENTA_PEDIDO],
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
// Criterio 1 — la fecha compromiso se restaura al recuperar el PEDIDO.
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG-04 · recuperar un PEDIDO del pizarrón restaura su fecha compromiso', () => {
  it('el modal de programación muestra el `committed_at` que viajó en el post-it', async () => {
    montarPOS();
    await esperarCatalogo();

    // Recuperamos el PEDIDO desde el pizarrón.
    await recuperarCuentaPorFolio('cuenta-pedido');

    // El carrito se hidrata (las líneas del contrato 30 aparecen).
    expect(await screen.findByText('Café Americano')).toBeTruthy();

    // El bloque de pedido se restauró: aparece el botón 📌 de programación.
    const botonProgramar = await screen.findByLabelText('Programar pedido');
    fireEvent.click(botonProgramar);

    // El modal de programación se abre con los datos iniciales del bloque.
    const modal = await screen.findByRole('dialog', {
      name: /Programación del pedido/i,
    });

    // BUG-04 — la fecha compromiso NO se perdió: el input la muestra.
    // `datetime-local` recibe el valor en hora LOCAL (aIsoLocal), así que
    // comparamos contra la conversión local del instante que viajó.
    const input = within(modal).getByLabelText(/Fecha y Hora Compromiso/i);
    const esperado = (() => {
      const d = new Date(COMMITTED_AT);
      const pad = (n) => String(n).padStart(2, '0');
      return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}`
      );
    })();
    expect(input.value).toBe(esperado);
    expect(input.value).not.toBe('');
  });

  it('el modal de programación restaura empaque, dirección y notas del post-it', async () => {
    montarPOS();
    await esperarCatalogo();

    await recuperarCuentaPorFolio('cuenta-pedido');
    expect(await screen.findByText('Café Americano')).toBeTruthy();

    const botonProgramar = await screen.findByLabelText('Programar pedido');
    fireEvent.click(botonProgramar);

    const modal = await screen.findByRole('dialog', {
      name: /Programación del pedido/i,
    });

    // BUG-04 — el resto del contexto de pedido también se restaura.
    expect(within(modal).getByLabelText(/Nombre del Cliente/i).value)
      .toBe('Juan Pérez');
    expect(within(modal).getByLabelText(/Teléfono/i).value).toBe('555-1234');
    // La dirección solo se pinta cuando el tipo de entrega es Domicilio.
    expect(within(modal).getByLabelText(/Dirección de Entrega/i).value)
      .toBe('Av. Reforma 123, Col. Centro');
    expect(within(modal).getByLabelText(/Notas adicionales/i).value)
      .toBe('Sin nueces, por favor');
  });
});


