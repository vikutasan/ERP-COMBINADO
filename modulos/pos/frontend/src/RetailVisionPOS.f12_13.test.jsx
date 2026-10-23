/**
 * Puerta de FASE 12.13 — MUTEX DE ACCIONES DE PERSISTENCIA (REGLA 2).
 *
 * Este test monta la PANTALLA REAL (`RetailVisionPOS`) con un cliente `api`
 * simulado y verifica el hueco de severidad MEDIA que F12.11 detectó en el
 * handler `handleTicketAction` del viejo POS (paridad con `actionMutexRef`):
 *
 *   (a) MUTEX (REGLA 2): el viejo POS serializaba las acciones de persistencia
 *       con un mutex de cadena de promesas (`actionMutexRef`), de modo que un
 *       doble clic en COBRAR no disparaba dos cobros. El nuevo POS tenía
 *       `enviandoRef` (una bandera) pero NO un mutex que RECHAZARA la segunda
 *       llamada concurrente. Un doble clic podía emitir dos `cobrarTicket`.
 *
 *   (b) INFIEL A PROPÓSITO: el nuevo POS NO serializa (encola) la segunda
 *       llamada — la RECHAZA con `{ outcome: 'error', reason: 'accion_en_curso' }`.
 *       Es más seguro: la segunda intención de un doble clic es un error, no una
 *       petición legítima que deba esperar su turno. La pantalla ignora ese
 *       rechazo en silencio (no es un error para el operador).
 *
 *   (c) LIBERACIÓN GARANTIZADA: el mutex se libera SIEMPRE en `finally`, de modo
 *       que un fallo (red, 409, excepción) no deja el candado pegado y bloquea
 *       la siguiente acción legítima.
 *
 * POR QUÉ EXISTE ESTA COMPUERTA (22ª instancia de §10.6):
 * La auditoría F12.11 recorrió los 21 efectos del viejo POS y clasificó este
 * como INFIEL: el nuevo POS tenía la bandera `enviandoRef` pero NO el mutex que
 * rechaza. F12.13 cierra ese hueco.
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
  // Contrato 30 — las LÍNEAS de un ticket (F12.10).
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
// Los helpers del mutex se prueban directamente (unidad).
import { adquirirMutex, liberarMutex } from './hooks/useTicketActions.js';

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
  // RN-49 — el cobro exige una sesión de caja ABIERTA en la terminal.
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
  apiSimulada.leerLineas.mockResolvedValue({ ticket_id: 'ticket-1', version: 7, lineas: [] });
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
 * Agrega el producto A al carrito y ABRE el modal de pago (sin confirmar).
 * Devuelve el botón CONFIRMAR PAGO ya habilitado, listo para disparar el cobro.
 */
async function agregarYAbrirPago() {
  fireEvent.click(botonProductoA());
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
  return confirmar;
}

/**
 * Crea una promesa "deferred" (controlable desde el test). Permite mantener el
 * primer cobro EN VUELO mientras se dispara el segundo.
 */
function diferido() {
  let resolver;
  let rechazar;
  const promesa = new Promise((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

beforeEach(() => {
  vi.clearAllMocks();
  sembrarApiFeliz();
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 1 — REGLA 2: un doble clic en CONFIRMAR PAGO NO cobra dos veces.
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.13 · Criterio 1 — el mutex rechaza el 2º cobro concurrente', () => {
  it('un doble clic en CONFIRMAR PAGO llama a cobrarTicket UNA sola vez', async () => {
    // El primer cobro queda EN VUELO (promesa diferida) hasta que el test lo
    // resuelva. Así el segundo clic ocurre con el mutex TOMADO.
    const enVuelo = diferido();
    apiSimulada.cobrarTicket.mockReturnValue(enVuelo.promesa);

    montarPOS();
    await esperarCatalogo();
    const confirmar = await agregarYAbrirPago();

    // Primer clic: toma el mutex y dispara el cobro (queda pendiente).
    fireEvent.click(confirmar);
    await waitFor(() => {
      expect(apiSimulada.cobrarTicket).toHaveBeenCalledTimes(1);
    });

    // Segundo clic (doble clic): el mutex está TOMADO → se rechaza. NO debe
    // emitir un segundo `cobrarTicket`.
    fireEvent.click(confirmar);
    // Se da un ciclo de microtareas para que cualquier 2ª llamada se registre.
    await new Promise((r) => setTimeout(r, 0));
    expect(apiSimulada.cobrarTicket).toHaveBeenCalledTimes(1);

    // Se resuelve el cobro en vuelo para cerrar limpio (sin act() pendiente).
    enVuelo.resolver({
      id: 'ticket-1',
      folio: 'A-0001',
      status: 'PAID',
      version: 5,
      total: 18.5,
    });
    await waitFor(() => {
      expect(apiSimulada.cobrarTicket).toHaveBeenCalledTimes(1);
    });
  });

  it('tras liberarse el mutex, un cobro posterior SÍ procede', async () => {
    // El primer cobro falla con error de RED (se reintenta y agota). Al liberar
    // el mutex en `finally`, un segundo intento legítimo debe poder cobrar.
    apiSimulada.cobrarTicket
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({
        id: 'ticket-1',
        folio: 'A-0001',
        status: 'PAID',
        version: 5,
        total: 18.5,
      });

    montarPOS();
    await esperarCatalogo();
    const confirmar = await agregarYAbrirPago();

    // Primer intento: agota los 3 reintentos y falla. El backoff de `withRetries`
    // es 1s/2s/3s (temporizadores reales), así que 3 intentos tardan ~3s: hay que
    // ampliar el timeout de `waitFor` (por defecto 1000ms).
    fireEvent.click(confirmar);
    await waitFor(
      () => {
        expect(apiSimulada.cobrarTicket.mock.calls.length).toBeGreaterThanOrEqual(3);
      },
      { timeout: 10000 },
    );

    // El mutex quedó LIBRE (finally). Un segundo clic vuelve a intentar y ahora
    // tiene éxito: el candado no se quedó pegado.
    const llamadasTrasFallo = apiSimulada.cobrarTicket.mock.calls.length;
    fireEvent.click(confirmar);
    await waitFor(() => {
      expect(apiSimulada.cobrarTicket.mock.calls.length).toBeGreaterThan(llamadasTrasFallo);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 2 — REGLA 2: el mutex también protege la CREACIÓN del ticket.
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.13 · Criterio 2 — el mutex protege la creación del ticket', () => {
  it('un doble clic en un producto NO crea dos tickets', async () => {
    // La creación queda EN VUELO hasta que el test la resuelva.
    const enVuelo = diferido();
    apiSimulada.crearVenta.mockReturnValue(enVuelo.promesa);

    montarPOS();
    await esperarCatalogo();

    // Primer clic: toma el mutex y dispara la creación (queda pendiente).
    fireEvent.click(botonProductoA());
    await waitFor(() => {
      expect(apiSimulada.crearVenta).toHaveBeenCalledTimes(1);
    });

    // Segundo clic (doble clic): el mutex está TOMADO → se rechaza. NO debe
    // emitir un segundo `crearVenta`.
    fireEvent.click(botonProductoA());
    await new Promise((r) => setTimeout(r, 0));
    expect(apiSimulada.crearVenta).toHaveBeenCalledTimes(1);

    // Se resuelve la creación en vuelo para cerrar limpio.
    enVuelo.resolver({
      id: 'ticket-1',
      folio: 'A-0001',
      status: 'OPEN',
      version: 1,
      total: 0,
    });
    await waitFor(() => {
      expect(apiSimulada.crearVenta).toHaveBeenCalledTimes(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 3 — Unidad: los helpers del mutex son correctos y simétricos.
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.13 · Criterio 3 — helpers del mutex (unidad)', () => {
  it('adquirirMutex devuelve true la 1ª vez y false mientras está tomado', () => {
    const ref = { current: false };
    expect(adquirirMutex(ref)).toBe(true);
    expect(ref.current).toBe(true);
    // Segunda adquisición concurrente: rechazada.
    expect(adquirirMutex(ref)).toBe(false);
    expect(ref.current).toBe(true);
  });

  it('liberarMutex permite volver a adquirir (simetría)', () => {
    const ref = { current: false };
    expect(adquirirMutex(ref)).toBe(true);
    liberarMutex(ref);
    expect(ref.current).toBe(false);
    // Tras liberar, se puede adquirir de nuevo.
    expect(adquirirMutex(ref)).toBe(true);
  });
});


