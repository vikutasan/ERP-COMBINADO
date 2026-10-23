/**
 * Puerta de FASE 7.5a — EL PUENTE POS → PEDIDOS (integración en la pantalla viva).
 *
 * Este test monta la PANTALLA REAL (`RetailVisionPOS`) con un cliente `api`
 * simulado y verifica que el puente POS → Pedidos quedó CABLEADO end-to-end:
 *
 *   - El header expone el botón 📌 "Programar pedido" (F7.5.6).
 *   - Tocar 📌 abre el modal de programación (F7.5.5).
 *   - Guardar el modal puebla el bloque `order_*` y lo adjunta al crear el
 *     ticket: el cuerpo de `POST /pos/tickets` (vía `crearVenta`) INCLUYE los
 *     campos del pedido (contrato 15).
 *   - Una venta directa (sin programar) NO incluye campos de pedido (RN-59).
 *   - El frontend NUNCA llama a `/orders/from-ticket` ni lee `system_settings`
 *     (frontera por contratos, A-02 / P-01).
 *
 * Cierra los criterios 1–7 del §5.6 del plan
 * `PLAN_DE_ABORDAJE_FASE_7_5_PEDIDOS.md`.
 *
 * Se ejecuta con Vitest (jsdom): `npm run test` en apps/pos.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

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
  // TS-01 FIX: métodos adicionales requeridos por el POS al arrancar.
  listarCuentasAbiertas: vi.fn(),
  leerTicket: vi.fn(),
  leerLineas: vi.fn(),
  getSesionCajaActiva: vi.fn(),
  getResumenTurno: vi.fn(),
  getSettingValue: vi.fn(async () => null),
}));

vi.mock('./api/client.js', () => apiSimulada);

// TS-01 FIX: mocks de servicios auxiliares.
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
vi.mock('./services/openAccountsService.js', () => ({
  listarCuentasAbiertas: vi.fn(async () => ({ outcome: 'ok', reason: null, data: { cuentas: [] } })),
  default: { listarCuentasAbiertas: vi.fn(async () => ({ outcome: 'ok', reason: null, data: { cuentas: [] } })) },
}));

// Importar DESPUÉS del mock para que la pantalla reciba el cliente simulado.
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
  // TS-01 FIX: métodos adicionales.
  apiSimulada.listarCuentasAbiertas.mockResolvedValue({ cuentas: [] });
  apiSimulada.leerTicket.mockResolvedValue({ id: 'ticket-1', version: 1, total: 0, status: 'OPEN' });
  apiSimulada.leerLineas.mockResolvedValue({ ticket_id: 'ticket-1', version: 1, total: 0, lineas: [] });
  apiSimulada.getSesionCajaActiva.mockResolvedValue({ cash_session_id: 'caja-1', terminal_id: 'TERM-01', status: 'OPEN', opening_float: '200.00' });
  apiSimulada.getResumenTurno.mockResolvedValue(null);
}

/** Monta el POS con ApiContext.Provider para que useApi() funcione. */
function montarPOS(props = {}) {
  return render(
    <ApiContext.Provider value={apiSimulada}>
      <RetailVisionPOS {...props} />
    </ApiContext.Provider>
  );
}

/** Espera a que el catálogo termine de cargar y aparezcan los productos. */
async function esperarCatalogo() {
  await screen.findByRole('button', { name: /Agregar Concha de Vainilla al ticket/i });
}

/**
 * Localiza el botón 📌 "Programar pedido" del header.
 *
 * F12.1 — El botón 📌 ya NO está visible por defecto: hereda la operación del
 * viejo POS (§6.8), donde SOLO aparece cuando el selector está en modo PEDIDO.
 * Por eso este helper primero activa el modo PEDIDO (idempotente: pulsar
 * "📦 Pedido" cuando ya está activo no tiene efecto) y luego devuelve el botón.
 */
function botonProgramarPedido() {
  fireEvent.click(screen.getByRole('button', { name: /📦 Pedido/i }));
  return screen.getByRole('button', { name: /Programar pedido/i });
}

/** Localiza el botón "Guardar Pedido Tentativo" del modal. */
function botonGuardarPedido() {
  return screen.getByRole('button', { name: /Guardar Pedido Tentativo/i });
}

/**
 * Abre el modal de programación y lo completa con datos válidos.
 * Devuelve cuando el modal ya está en pantalla.
 */
async function abrirYCompletarModal() {
  fireEvent.click(botonProgramarPedido());
  await screen.findByRole('dialog', { name: /Programación del pedido/i });

  fireEvent.change(screen.getByLabelText(/Nombre del Cliente/i), {
    target: { value: 'María García' },
  });
  fireEvent.change(screen.getByLabelText(/Teléfono/i), {
    target: { value: '3121234567' },
  });
  // La fecha compromiso se pre-llena sola; basta con que exista.
  const fecha = document.getElementById('input-committed-at');
  expect(fecha.value).not.toBe('');
}

beforeEach(() => {
  vi.clearAllMocks();
  sembrarApiFeliz();
});

afterEach(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 1 — El header expone el botón 📌 "Programar pedido"
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.5a · Criterio 1 — el header expone el botón de programación', () => {
  it('el botón 📌 "Programar pedido" está presente', async () => {
    montarPOS();
    await esperarCatalogo();

    expect(botonProgramarPedido()).toBeTruthy();
  });

  it('el botón 📌 tiene target táctil (min-h-tactil, R-04)', async () => {
    montarPOS();
    await esperarCatalogo();

    expect(botonProgramarPedido().className).toMatch(/min-h-tactil/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 2 — Tocar 📌 abre el modal de programación
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.5a · Criterio 2 — tocar 📌 abre el modal', () => {
  it('el modal de programación aparece al tocar el botón', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonProgramarPedido());

    expect(
      await screen.findByRole('dialog', { name: /Programación del pedido/i }),
    ).toBeTruthy();
  });

  it('el modal arranca en PICKUP y con el empaque PROPIO (RN-56/RN-57)', async () => {
    montarPOS();
    await esperarCatalogo();
    fireEvent.click(botonProgramarPedido());
    await screen.findByRole('dialog', { name: /Programación del pedido/i });

    // La dirección de entrega NO se muestra en PICKUP.
    expect(screen.queryByLabelText(/Dirección de Entrega/i)).toBeNull();
  });

  it('el botón de guardar está deshabilitado hasta completar los obligatorios', async () => {
    montarPOS();
    await esperarCatalogo();
    fireEvent.click(botonProgramarPedido());
    await screen.findByRole('dialog', { name: /Programación del pedido/i });

    expect(botonGuardarPedido().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Nombre del Cliente/i), {
      target: { value: 'María García' },
    });
    fireEvent.change(screen.getByLabelText(/Teléfono/i), {
      target: { value: '3121234567' },
    });

    await waitFor(() => {
      expect(botonGuardarPedido().disabled).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 3 — Guardar el modal adjunta el bloque `order_*` al crear el ticket
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.5a · Criterio 3 — el bloque de pedido viaja en POST /pos/tickets', () => {
  it('al guardar el pedido, el cuerpo de crearVenta incluye los campos del pedido', async () => {
    montarPOS();
    await esperarCatalogo();

    await abrirYCompletarModal();
    fireEvent.click(botonGuardarPedido());

    // El modal muestra la confirmación y, tras la pausa, llama a onGuardar.
    await screen.findByText(/Pedido Tentativo Registrado/i);

    await waitFor(
      () => {
        expect(apiSimulada.crearVenta).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );

    const cuerpo = apiSimulada.crearVenta.mock.calls[0][0];
    expect(cuerpo.order_type).toBe('PEDIDO');
    expect(cuerpo.delivery_type).toBe('PICKUP');
    expect(cuerpo.packaging_type).toBe('PROPIO');
    expect(cuerpo.customer_name).toBe('María García');
    expect(cuerpo.customer_phone).toBe('3121234567');
    expect(cuerpo.committed_at).toBeTruthy();
  });

  it('el bloque NO incluye la dirección cuando el tipo de entrega es PICKUP', async () => {
    montarPOS();
    await esperarCatalogo();

    await abrirYCompletarModal();
    fireEvent.click(botonGuardarPedido());
    await screen.findByText(/Pedido Tentativo Registrado/i);

    await waitFor(
      () => {
        expect(apiSimulada.crearVenta).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );

    const cuerpo = apiSimulada.crearVenta.mock.calls[0][0];
    expect(cuerpo.delivery_address).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 4 — Una venta directa NO incluye campos de pedido (RN-59)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.5a · Criterio 4 — la venta directa no lleva campos de pedido', () => {
  it('agregar un producto sin programar pedido crea el ticket sin `order_type`', async () => {
    montarPOS();
    await esperarCatalogo();

    // Agregar un producto dispara `asegurarTicket()` (sin bloque).
    fireEvent.click(screen.getByText('Concha de Vainilla'));

    await waitFor(() => {
      expect(apiSimulada.crearVenta).toHaveBeenCalled();
    });

    const cuerpo = apiSimulada.crearVenta.mock.calls[0][0];
    expect(cuerpo.order_type).toBeUndefined();
    expect(cuerpo.customer_name).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 5 — El frontend NO llama a Pedidos ni a `system_settings` (frontera)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.5a · Criterio 5 — frontera por contratos (A-02 / P-01)', () => {
  it('la pantalla no llama a /orders/from-ticket ni a /settings', async () => {
    const fetchEspia = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    montarPOS();
    await esperarCatalogo();

    await abrirYCompletarModal();
    fireEvent.click(botonGuardarPedido());
    await screen.findByText(/Pedido Tentativo Registrado/i);

    await waitFor(
      () => {
        expect(apiSimulada.crearVenta).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );

    const rutas = fetchEspia.mock.calls.map((c) => String(c[0]));
    expect(rutas.some((r) => r.includes('/orders/from-ticket'))).toBe(false);
    expect(rutas.some((r) => r.includes('/settings'))).toBe(false);

    fetchEspia.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 6 — Cerrar el modal no rompe la pantalla
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.5a · Criterio 6 — cerrar el modal no rompe la pantalla', () => {
  it('el botón ✕ cierra el modal y el POS sigue usable', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonProgramarPedido());
    const dialogo = await screen.findByRole('dialog', {
      name: /Programación del pedido/i,
    });

    // El botón ✕ vive DENTRO del modal; se acota la búsqueda al diálogo para
    // no colisionar con otros controles "Cerrar" de la pantalla (p. ej. el
    // visor cenital, que también expone aria-label="Cerrar").
    fireEvent.click(within(dialogo).getByRole('button', { name: /Cerrar/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /Programación del pedido/i }),
      ).toBeNull();
    });

    // El catálogo sigue en pantalla.
    expect(screen.getByText('Concha de Vainilla')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 7 — El modal es fluido, sin ancho fijo en px (R-03)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.5a · Criterio 7 — el modal es fluido (R-03)', () => {
  it('el contenedor del modal no usa un ancho fijo en px sin max-/min-', async () => {
    montarPOS();
    await esperarCatalogo();
    fireEvent.click(botonProgramarPedido());
    const dialogo = await screen.findByRole('dialog', {
      name: /Programación del pedido/i,
    });

    // R-01/R-03: `w-[...px]` está prohibido; se usa `max-w-[...]` + `w-full`.
    expect(dialogo.className).not.toMatch(/(^|\s)w-\[\d+px\]/);
    expect(dialogo.className).toMatch(/w-full/);
  });
});


