/**
 * Puerta de FASE 12.10 — RECUPERAR UNA CUENTA HIDRATA EL CARRITO.
 *
 * Este test monta la PANTALLA REAL (`RetailVisionPOS`) con un cliente `api`
 * simulado y verifica que recuperar una cuenta desde el pizarrón NO solo adopta
 * su identidad (`ticketId`), sino que ADEMÁS HIDRATA el carrito con sus líneas:
 *
 *   - Recuperar una cuenta llama al contrato 30 (`leerLineas`) con el id de la
 *     cuenta.
 *   - Las líneas devueltas por el contrato 30 aparecen en el carrito (el
 *     `SalesReceipt` pinta los productos recuperados).
 *   - El total del carrito refleja las líneas recuperadas.
 *   - El pizarrón se cierra tras hidratar.
 *   - Si el contrato 30 falla, el POS NO se tumba y avisa por banner.
 *
 * POR QUÉ EXISTE ESTA COMPUERTA (18ª instancia de §10.6):
 * `recuperarCuentaAlCarrito` (F12.5) adoptaba la identidad de la cuenta
 * (`setTicketId`) y cerraba el pizarrón, pero NUNCA hidrataba el carrito. El
 * usuario recuperaba una cuenta y veía el carrito VACÍO. La causa raíz era un
 * hueco A-02: NINGÚN contrato devolvía las líneas (el contrato 21 es
 * deliberadamente ligero — Regla 15: EXACTAMENTE 5 campos escalares, sin
 * líneas). F12.10 cierra ese hueco con el contrato 30 (`pos.leer_lineas`,
 * `GET /pos/tickets/{id}/items`) y cablea la hidratación end-to-end. Esta
 * compuerta prueba la INTEGRACIÓN (¿la pantalla hidrata el carrito?), no la
 * unidad (ya cubierta por `test_f12_10_leer_lineas.py` en el backend).
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
  listarCuentasAbiertas: vi.fn(), leerTicket: vi.fn(), leerLineas: vi.fn(),
  getSesionCajaActiva: vi.fn(), getResumenTurno: vi.fn(), getSettingValue: vi.fn(async () => null),
  // Contrato 23 — lista de cuentas abiertas de la terminal.
  listarCuentasAbiertas: vi.fn(),
  // Contrato 21 — versión fresca de una cuenta (5 campos escalares, sin líneas).
  leerTicket: vi.fn(),
  // Contrato 30 — las LÍNEAS de un ticket (F12.10). Cierra el hueco A-02.
  leerLineas: vi.fn(),
}));

vi.mock('./api/client.js', () => apiSimulada);

// El servicio de cuentas abiertas se simula delegando en el cliente simulado.
// POR QUÉ: `openAccountsService` hace `import * as cliente from '../api/client.js'`
// y llama `cliente.listarCuentasAbiertas(id)`. Al simular el cliente con un
// objeto plano, la interop ESM/CJS de Vitest no garantiza que el namespace
// `cliente` exponga la función. Simular el SERVICIO con la MISMA forma
// `{ outcome, reason, data }` que produce el real aísla la compuerta de
// INTEGRACIÓN de la unidad del servicio (ya cubierta por
// `openAccountsService.f5_1.test.jsx`).
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

// El servicio de caja se simula para que la pantalla no intente hablar con el
// backend real al montar (el pizarrón no depende de la caja, pero la pantalla
// sí consulta el turno activo).
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

// Contrato 23 — EXACTAMENTE 5 campos escalares (sin líneas).
const CUENTA_1 = {
  id: 'cuenta-1',
  account_num: 'C-001',
  status: 'OPEN',
  total: 45.5,
  version: 3,
};

const CUENTA_2 = {
  id: 'cuenta-2',
  account_num: 'C-002',
  status: 'OPEN',
  total: 12.0,
  version: 1,
};

// Contrato 30 — las LÍNEAS de la cuenta-1 (F12.10). Dos líneas: una concha y
// un café. El total (45.5) coincide con el de la cuenta para que la hidratación
// sea coherente.
const LINEAS_CUENTA_1 = {
  ticket_id: 'cuenta-1',
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
  // Contrato 23 — el pizarrón lista dos cuentas abiertas.
  apiSimulada.listarCuentasAbiertas.mockResolvedValue({
    cuentas: [CUENTA_1, CUENTA_2],
  });
  // Contrato 21 — recuperar devuelve la versión fresca (5 campos, sin líneas).
  apiSimulada.leerTicket.mockResolvedValue({ ...CUENTA_1 });
  // Contrato 30 — las líneas de la cuenta-1 (F12.10).
  apiSimulada.leerLineas.mockResolvedValue({ ...LINEAS_CUENTA_1 });
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

/** Abre el pizarrón y recupera la PRIMERA cuenta (cuenta-1). */
async function recuperarPrimeraCuenta() {
  fireEvent.click(botonPizarron());
  const dialogo = await screen.findByRole('dialog', { name: /Cuentas abiertas/i });
  await screen.findByTestId('folio-cuenta-1');
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
// Criterio 1 — Recuperar una cuenta llama al contrato 30 (`leerLineas`).
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.10 · Criterio 1 — recuperar llama al contrato 30', () => {
  it('recuperar una cuenta pide sus líneas por el contrato 30', async () => {
    montarPOS();
    await esperarCatalogo();

    await recuperarPrimeraCuenta();

    // El handler pide las LÍNEAS de la cuenta recuperada (contrato 30).
    await waitFor(() => {
      expect(apiSimulada.leerLineas).toHaveBeenCalledWith('cuenta-1');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 2 — Las líneas del contrato 30 HIDRATAN el carrito.
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.10 · Criterio 2 — las líneas hidratan el carrito', () => {
  it('las líneas recuperadas aparecen en el carrito (SalesReceipt)', async () => {
    montarPOS();
    await esperarCatalogo();

    await recuperarPrimeraCuenta();

    // Las dos líneas de la cuenta-1 aparecen en el carrito. El nombre del
    // producto recuperado ("Café Americano") NO está en el catálogo sembrado,
    // así que su presencia prueba que vino del contrato 30, no del catálogo.
    expect(await screen.findByText('Café Americano')).toBeTruthy();
    // "Concha de Vainilla" está en el catálogo Y en el carrito: se acota la
    // búsqueda a que exista al menos una coincidencia (el carrito la pinta).
    expect(screen.getAllByText('Concha de Vainilla').length).toBeGreaterThan(0);
  });

  it('el carrito refleja el total de las líneas recuperadas', async () => {
    montarPOS();
    await esperarCatalogo();

    await recuperarPrimeraCuenta();

    // El total del carrito (45.5) se pinta formateado. Se busca el valor
    // formateado en es-MX ("45.50").
    expect(await screen.findByText(/45\.50/)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 3 — Recuperar cierra el pizarrón tras hidratar.
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.10 · Criterio 3 — recuperar cierra el pizarrón', () => {
  it('tras hidratar, el pizarrón se cierra', async () => {
    montarPOS();
    await esperarCatalogo();

    await recuperarPrimeraCuenta();

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /Cuentas abiertas/i })
      ).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 4 — Un fallo del contrato 30 NO tumba el POS.
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.10 · Criterio 4 — un fallo del contrato 30 no tumba el POS', () => {
  it('si el contrato 30 falla, el POS sigue vivo y avisa por banner', async () => {
    apiSimulada.leerLineas.mockRejectedValue(new Error('red caída'));

    montarPOS();
    await esperarCatalogo();

    await recuperarPrimeraCuenta();

    // El POS sigue vivo: el catálogo sigue pintado.
    expect(screen.getByText('Concha de Vainilla')).toBeTruthy();

    // Y avisa del fallo por banner (el handler pinta un banner de error).
    expect(await screen.findByText(/No se pudo recuperar la cuenta/i)).toBeTruthy();
  });
});


