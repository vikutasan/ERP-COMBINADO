/**
 * Puerta de FASE 12.28 — PERSISTENCIA VERIFICADA DE LA LÍNEA (BUG-11).
 *
 * Este test monta la PANTALLA REAL (`RetailVisionPOS`) con un cliente `api`
 * simulado y verifica el hueco que produjo el error reportado en producción:
 *
 *   "quise enviar una cuenta y No se pudo completar / No se pudo enviar: hay
 *    productos sin guardar en el servidor. Verifique la conexión WiFi."
 *
 * CAUSA RAÍZ (BUG-11):
 * `agregarProducto` / `alEscanear` / el `onAgregar` de la visión llamaban a
 * `carrito.anadirLinea(...)` SIN `await` y SIN inspeccionar el `Outcome`. Como
 * `anadirLinea` hace una actualización OPTIMISTA (`setLineas` primero, servidor
 * después), la línea aparecía en el carrito aunque la escritura al servidor
 * hubiera fallado. Al enviar la cuenta, `clearCart` → `verificar_envio`
 * (contrato 22) detectaba el faltante y mostraba el modal "hay productos sin
 * guardar en el servidor. Verifique la conexión WiFi." — un mensaje ENGAÑOSO,
 * porque el problema no era el WiFi sino una escritura que nunca se confirmó.
 *
 * QUÉ FIJA ESTA COMPUERTA:
 *   (a) Si la persistencia FALLA, la línea optimista se REVIERTE del carrito
 *       (el espejo nunca miente: prohibición #3) y se muestra un error claro.
 *   (b) Si la persistencia tiene ÉXITO, la línea permanece y NO se revierte.
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
const CATEGORIA_A = { id: 'cat-1', name: 'Panadería' };

const PRODUCTO_A = {
  id: 'prod-A',
  sku: 'SKU-A',
  barcode: '111',
  name: 'Concha de Vainilla',
  price: 18.5,
  category_id: 'cat-1',
};

/** Construye un error con la forma del `ApiError` real del cliente. */
function errorHttp(codigo, mensaje) {
  const err = new Error(mensaje);
  err.codigo = codigo;
  return err;
}

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
    version: 2,
    total: 18.5,
  });
  apiSimulada.leerLineas.mockResolvedValue({
    ticket_id: 'ticket-1',
    version: 2,
    total: 18.5,
    lineas: [],
  });
}

/** Espera a que el catálogo termine de cargar y aparezca el producto. */
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

beforeEach(() => {
  vi.clearAllMocks();
  sembrarApiFeliz();
});

afterEach(() => {
  cleanup();
});

describe('F12.28 — persistencia verificada de la línea (BUG-11)', () => {
  it('si la persistencia FALLA, revierte la línea optimista y avisa', async () => {
    // La escritura al servidor falla con un 409 (error de negocio, RN-25/RN-26).
    // `esErrorDeNegocio` reconoce el 409, así que `withRetries` NO reintenta con
    // backoff (un 500 SÍ reintentaría 3× con 1s/2s/3s y tardaría ~3s, excediendo
    // el timeout de `waitFor`). El 409 dispara el auto-heal de versión UNA vez
    // (`sincronizarVersion` → `leerTicket`), y el reintento vuelve a fallar con
    // 409 (no reintentable) → el fallo es inmediato y determinista.
    apiSimulada.anadirItem.mockRejectedValue(
      errorHttp(409, 'Conflicto de versión')
    );

    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonProductoA());

    // El intento de persistir ocurrió…
    await waitFor(() => {
      expect(apiSimulada.anadirItem).toHaveBeenCalled();
    });

    // …y la reversión se disparó (quitarItem).
    await waitFor(() => {
      expect(apiSimulada.quitarItem).toHaveBeenCalled();
    });

    // …y la línea optimista se REVIRTIÓ: el carrito vuelve a estar vacío.
    // El botón COBRAR queda deshabilitado porque no hay líneas.
    await waitFor(() => {
      const cobrar = screen.getByRole('button', { name: /COBRAR/i });
      expect(cobrar.disabled).toBe(true);
    });

    // El error visible es claro y NO menciona el WiFi.
    const aviso = await screen.findByText(/No se pudo guardar el producto en el servidor/i);
    expect(aviso).toBeTruthy();
    expect(screen.queryByText(/Verifique la conexión WiFi/i)).toBeNull();
  });

  it('si la persistencia tiene ÉXITO, la línea permanece en el carrito', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonProductoA());

    await waitFor(() => {
      expect(apiSimulada.anadirItem).toHaveBeenCalled();
    });

    // La línea permanece: COBRAR se habilita (hay al menos una línea).
    await waitFor(() => {
      const cobrar = screen.getByRole('button', { name: /COBRAR/i });
      expect(cobrar.disabled).toBe(false);
    });

    // No se revirtió: no se llamó a `quitarItem`.
    expect(apiSimulada.quitarItem).not.toHaveBeenCalled();
  });
});


