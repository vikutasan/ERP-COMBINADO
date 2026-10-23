/**
 * Puerta de FASE 12.12 — AUTO-HEAL DE CONFLICTO DE VERSIÓN (409).
 *
 * Este test monta la PANTALLA REAL (`RetailVisionPOS`) con un cliente `api`
 * simulado y verifica el hueco de severidad ALTA que F12.11 detectó en el
 * handler `handleTicketAction` del viejo POS (paridad con `isBusinessError` +
 * `withRetries`):
 *
 *   (a) FILTRO DE ERRORES DE NEGOCIO (REGLA 18): un 409 (conflicto de versión,
 *       RN-25/RN-26) NO se reintenta. El viejo POS pasaba `isBusinessError` a
 *       `withRetries`; el nuevo POS reintentaba cualquier error (el default de
 *       `withRetries` es `debeReintentar = () => true`), lo que violaba la
 *       REGLA 18 ("PROHIBIDO reintentar 409") y podía cobrar dos veces.
 *
 *   (b) AUTO-HEAL (REGLA 9): cuando el cobro choca con un 409, el ticket sigue
 *       siendo VÁLIDO — solo está desactualizado porque otro vendedor lo
 *       modificó. En vez de mostrar un error críptico, el POS descarga la
 *       versión fresca (contrato 30 `pos.leer_lineas`), re-hidrata el carrito
 *       (lo que sincroniza `lineasRef`/`versionRef` ANTES de `setState`) y
 *       reabre el checkout para reintentar. El viejo POS resolvía el 409 con un
 *       `CollisionModal` bloqueante; el nuevo POS lo resuelve en línea.
 *
 * POR QUÉ EXISTE ESTA COMPUERTA (21ª instancia de §10.6):
 * La auditoría F12.11 recorrió los 21 efectos del viejo POS y clasificó este
 * como INFIEL: el nuevo POS tenía el `withRetries` pero SIN el filtro de
 * errores de negocio, y NO tenía auto-heal. F12.12 cierra ambos huecos.
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
  // Contrato 23 — lista de cuentas abiertas de la terminal.
  listarCuentasAbiertas: vi.fn(),
  // Contrato 21 — versión fresca de una cuenta (5 campos escalares, sin líneas).
  leerTicket: vi.fn(),
  // Contrato 30 — las LÍNEAS de un ticket (F12.10). El auto-heal lo usa.
  leerLineas: vi.fn(),
  // Caja (RN-49): el cobro exige una sesión de caja ABIERTA en la terminal.
  // Se simulan los métodos del cliente `api` (NO el servicio) para que el
  // `cashService` REAL corra, igual que en la compuerta F8.6.
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

// NOTA: NO se simula `cashService`. Se simulan los métodos de caja del cliente
// `api` (arriba) y se deja correr el `cashService` REAL, igual que la compuerta
// F8.6. Simular el servicio entero devolvía `data: null` en `obtenerTurnoActivo`,
// lo que dejaba la terminal SIN caja abierta (RN-49) y bloqueaba el cobro.

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

const PRODUCTO_B = {
  id: 'prod-B',
  sku: 'SKU-B',
  barcode: '222',
  name: 'Café Americano',
  price: 13.5,
  category_id: 'cat-1',
};

// Contrato 30 — la versión FRESCA que el auto-heal descarga tras el 409.
// Trae una línea MÁS que el carrito original (otro vendedor la agregó) y una
// versión MAYOR, para probar que el carrito se re-hidrata de verdad.
const LINEAS_FRESCAS = {
  ticket_id: 'ticket-1',
  version: 7,
  total: 46.0,
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

/**
 * Construye un error con la forma del `ApiError` real del cliente: expone el
 * código HTTP en `.codigo`. Es lo que `esErrorDeNegocio`/`esConflictoDeVersion`
 * inspeccionan.
 */
function errorHttp(codigo, mensaje) {
  const err = new Error(mensaje);
  err.codigo = codigo;
  return err;
}

/** Configura el cliente simulado con respuestas felices por defecto. */
function sembrarApiFeliz() {
  apiSimulada.getCatalogo.mockResolvedValue({
    categorias: [CATEGORIA_A],
    productos: [PRODUCTO_A, PRODUCTO_B],
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
  // RN-49 — el cobro exige una sesión de caja ABIERTA en la terminal. Sin esto,
  // `abrirCheckoutConGuardia` levanta el aviso de caja y nunca abre el checkout.
  apiSimulada.getSesionCajaActiva.mockResolvedValue({
    cash_session_id: 'caja-1',
    terminal_id: 'TERM-01',
    status: 'OPEN',
    opening_float: '200.00',
  });
  apiSimulada.getResumenTurno.mockResolvedValue({
    cash_session_id: 'caja-1',
    status: 'OPEN',
    movimientos: [],
  });
  apiSimulada.listarCuentasAbiertas.mockResolvedValue({ cuentas: [] });
  apiSimulada.leerTicket.mockResolvedValue({
    id: 'ticket-1',
    folio: 'A-0001',
    status: 'OPEN',
    version: 7,
    total: 46.0,
  });
  apiSimulada.leerLineas.mockResolvedValue({ ...LINEAS_FRESCAS });
}

/** Espera a que el catálogo termine de cargar y aparezcan los productos. */
function montarPOS(props = {}) {
  return render(<ApiContext.Provider value={apiSimulada}><RetailVisionPOS {...props} /></ApiContext.Provider>);
}

async function esperarCatalogo() {
  await screen.findByRole('button', { name: /Agregar Concha de Vainilla al ticket/i });
}

/** Localiza el botón de producto (aria-label "Agregar <nombre> al ticket"). */
function botonProductoA() {
  return screen.getByRole('button', {
    name: /Agregar Concha de Vainilla al ticket/i,
  });
}

/**
 * Agrega el producto A al carrito y cobra, replicando el flujo real:
 * producto → COBRAR (abre el modal) → Débito (habilita sin capturar efectivo)
 * → CONFIRMAR PAGO. El cobro dispara `cobrarTicket`.
 */
async function agregarYCobrar() {
  fireEvent.click(botonProductoA());
  await waitFor(() => {
    expect(apiSimulada.crearVenta).toHaveBeenCalled();
  });

  // F12.9 — El modal de pago lo abre "💰 COBRAR" (gateado por caja), NO
  // "ENVIAR CUENTA". Hay que esperar a que se habilite (la línea debe entrar
  // al carrito) antes de pulsarlo.
  const cobrar = await screen.findByRole('button', { name: /COBRAR/i });
  await waitFor(() => {
    expect(cobrar.disabled).toBe(false);
  });
  fireEvent.click(cobrar);

  // El modal arranca en EFECTIVO (CONFIRMAR PAGO deshabilitado hasta capturar
  // un monto >= total). Se elige "Débito" para habilitarlo sin capturar.
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

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 1 — REGLA 18: un 409 NO se reintenta.
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.12 · Criterio 1 — un 409 no se reintenta (REGLA 18)', () => {
  it('el cobro que recibe 409 llama a cobrarTicket UNA sola vez', async () => {
    // El cobro SIEMPRE falla con 409 (conflicto de versión).
    apiSimulada.cobrarTicket.mockRejectedValue(
      errorHttp(409, 'El version recibido no coincide con el actual'),
    );

    montarPOS();
    await esperarCatalogo();
    await agregarYCobrar();

    // El auto-heal descarga la versión fresca (contrato 30).
    await waitFor(() => {
      expect(apiSimulada.leerLineas).toHaveBeenCalled();
    });

    // REGLA 18: el 409 es un error de NEGOCIO. `withRetries` NO debe reintentar.
    // Si el filtro faltara, `cobrarTicket` se llamaría 3 veces (INTENTOS_POR_DEFECTO).
    expect(apiSimulada.cobrarTicket).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 2 — REGLA 9: el auto-heal descarga la versión fresca y re-hidrata.
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.12 · Criterio 2 — auto-heal descarga la versión fresca', () => {
  it('tras el 409, el carrito se re-hidrata con las líneas frescas del servidor', async () => {
    apiSimulada.cobrarTicket.mockRejectedValue(
      errorHttp(409, 'El version recibido no coincide con el actual'),
    );

    montarPOS();
    await esperarCatalogo();
    await agregarYCobrar();

    // El auto-heal descarga las líneas frescas (contrato 30) del ticket actual.
    await waitFor(() => {
      expect(apiSimulada.leerLineas).toHaveBeenCalledWith('ticket-1');
    });

    // La línea fresca que NO estaba en el carrito original aparece: el carrito
    // se re-hidrató de verdad (no solo se mostró un banner). El nombre aparece
    // DOS veces: en la rejilla de productos y en el ticket del carrito.
    const apariciones = await screen.findAllByText('Café Americano');
    expect(apariciones.length).toBeGreaterThanOrEqual(2);
  });

  it('el auto-heal avisa por banner que otro vendedor modificó la cuenta', async () => {
    apiSimulada.cobrarTicket.mockRejectedValue(
      errorHttp(409, 'El version recibido no coincide con el actual'),
    );

    montarPOS();
    await esperarCatalogo();
    await agregarYCobrar();

    // El banner de aviso (no de error) informa al operador.
    expect(
      await screen.findByText(/Otro vendedor modificó esta cuenta/i),
    ).toBeTruthy();
  });

  it('si la descarga fresca falla, se muestra un error y NO se pierde el ticket', async () => {
    apiSimulada.cobrarTicket.mockRejectedValue(
      errorHttp(409, 'El version recibido no coincide con el actual'),
    );
    // La descarga fresca también falla (red caída).
    apiSimulada.leerLineas.mockRejectedValue(errorHttp(0, 'Network Error'));

    montarPOS();
    await esperarCatalogo();
    await agregarYCobrar();

    // Se avisa que no se pudo descargar la versión fresca (no un error críptico).
    // El mensaje se pinta en varios sitios (aviso en línea + overlay), por eso
    // se usa `findAllByText`.
    const avisos = await screen.findAllByText(
      /no se pudo descargar la versión fresca/i,
    );
    expect(avisos.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 3 — REGLA 18: un error de RED SÍ se reintenta (no se rompió).
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.12 · Criterio 3 — un error de red sí se reintenta', () => {
  it('un fallo de red (sin código) reintenta y luego tiene éxito', async () => {
    // Primer intento: error de red (código 0). Segundo intento: éxito.
    apiSimulada.cobrarTicket
      .mockRejectedValueOnce(errorHttp(0, 'Network Error'))
      .mockResolvedValueOnce({
        id: 'ticket-1',
        folio: 'A-0001',
        status: 'PAID',
        version: 5,
        total: 18.5,
      });

    montarPOS();
    await esperarCatalogo();
    await agregarYCobrar();

    // El reintento ocurre: `cobrarTicket` se llama MÁS de una vez.
    await waitFor(() => {
      expect(apiSimulada.cobrarTicket.mock.calls.length).toBeGreaterThan(1);
    });

    // Y NO se dispara el auto-heal (no fue un 409).
    expect(apiSimulada.leerLineas).not.toHaveBeenCalled();
  });
});


