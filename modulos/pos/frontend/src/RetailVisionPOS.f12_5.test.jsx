/**
 * Puerta de FASE 12.5 — EL PIZARRÓN DE CUENTAS ABIERTAS (integración en la
 * pantalla viva).
 *
 * Este test monta la PANTALLA REAL (`RetailVisionPOS`) con un cliente `api`
 * simulado y verifica que el pizarrón de cuentas abiertas quedó CABLEADO
 * end-to-end:
 *
 *   - El header expone el botón "Pizarrón" (F12.5).
 *   - Tocar "Pizarrón" abre el overlay `OpenAccountsCorkboard` (F5.3), que
 *     descarga la lista por el contrato 23 (`listarCuentasAbiertas`).
 *   - Recuperar una cuenta adopta su identidad (`ticketId`) y cierra el
 *     pizarrón (contrato 21, `leerTicket`).
 *   - "Cerrar" cierra el pizarrón SIN recuperar (no llama a `leerTicket`).
 *   - Un fallo del pizarrón NO tumba el POS (el catálogo sigue pintado).
 *
 * POR QUÉ EXISTE ESTA COMPUERTA (13ª instancia de §10.6):
 * `OpenAccountsCorkboard` (F5.3) + `useOpenAccounts` (F5.2) +
 * `openAccountsService` (F5.1) existían y pasaban sus tests AISLADOS, pero la
 * pantalla NUNCA los montaba y `POSHeader` no tenía botón para abrirlos. Es
 * decir: el componente existía y pasaba su test, pero el usuario NO podía
 * llegar a él (la lección de F4.5, repetida). Esta compuerta cierra ese hueco:
 * prueba la INTEGRACIÓN, no la unidad.
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
  // Contrato 23 — lista de cuentas abiertas de la terminal.
  listarCuentasAbiertas: vi.fn(),
  // Contrato 21 — versión fresca de una cuenta (5 campos escalares, sin líneas).
  leerTicket: vi.fn(),
  // Contrato 30 — las LÍNEAS de un ticket (F12.10). Recuperar una cuenta
  // hidrata el carrito con estas líneas; sin este mock, `api.leerLineas` no
  // existe y el handler falla antes de cerrar el pizarrón.
  leerLineas: vi.fn(),
}));

vi.mock('./api/client.js', () => apiSimulada);

// El servicio de cuentas abiertas se simula delegando en el cliente simulado.
// POR QUÉ: `openAccountsService` hace `import * as cliente from '../api/client.js'`
// y llama `cliente.listarCuentasAbiertas(id)`. Al simular el cliente con un
// objeto plano, la interop ESM/CJS de Vitest no garantiza que el namespace
// `cliente` exponga la función (el error real fue
// `cuentasAbiertas.listarCuentasAbiertas is not a function`). Simular el
// SERVICIO con la MISMA forma `{ outcome, reason, data }` que produce el real
// aísla la compuerta de INTEGRACIÓN (¿la pantalla monta y cablea el pizarrón?)
// de la unidad del servicio (ya cubierta por `openAccountsService.f5_1.test.jsx`).
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
// TS-01 — FA-01: la pantalla consume el cliente por ApiContext. Sin Provider,
// `useCatalogo` recibe `null` y el catálogo nunca carga.
import { ApiContext } from './context/ApiContext.jsx';

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
  // Contrato 30 — recuperar hidrata el carrito con las líneas (F12.10). La
  // cuenta-1 se recupera con una línea; el resto de cuentas, sin líneas.
  apiSimulada.leerLineas.mockResolvedValue({
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
    ],
  });
}

/** Espera a que el catálogo termine de cargar y aparezcan los productos. */
async function esperarCatalogo() {
  await screen.findByRole('button', { name: /Agregar Concha de Vainilla al ticket/i });
}

/**
 * TS-01 — Monta la pantalla real inyectando el cliente simulado por
 * `ApiContext` (patrón FA-01). Es el único modo en que `useCatalogo` recibe
 * un cliente no nulo.
 */
function montarPOS(props = {}) {
  return render(
    <ApiContext.Provider value={apiSimulada}>
      <RetailVisionPOS {...props} />
    </ApiContext.Provider>
  );
}

/** Localiza el botón "Pizarrón" del header (F12.5). */
function botonPizarron() {
  return screen.getByLabelText('Pizarrón de cuentas abiertas');
}

beforeEach(() => {
  vi.clearAllMocks();
  sembrarApiFeliz();
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 1 — El botón "Pizarrón" es ALCANZABLE desde el header.
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.5 · Criterio 1 — el botón "Pizarrón" es alcanzable', () => {
  it('el header pinta el botón "Pizarrón" (antes era inalcanzable)', async () => {
    montarPOS();
    await esperarCatalogo();

    expect(botonPizarron()).toBeTruthy();
  });

  it('el botón "Pizarrón" respeta el objetivo táctil mínimo (R-04)', async () => {
    montarPOS();
    await esperarCatalogo();

    expect(botonPizarron().className).toMatch(/min-h-tactil/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 2 — El botón ABRE el pizarrón y éste lista las cuentas (contrato 23).
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.5 · Criterio 2 — el botón abre el pizarrón', () => {
  it('tocar "Pizarrón" monta el diálogo "Cuentas abiertas"', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonPizarron());

    expect(
      await screen.findByRole('dialog', { name: /Cuentas abiertas/i })
    ).toBeTruthy();
  });

  it('el pizarrón lista las cuentas abiertas por el contrato 23', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonPizarron());
    await screen.findByRole('dialog', { name: /Cuentas abiertas/i });

    // Las dos cuentas sembradas aparecen en el corcho. El folio se muestra
    // CORTO (`#` + últimos 3 dígitos), como en el viejo POS.
    expect(await screen.findByTestId('folio-cuenta-1')).toBeTruthy();
    expect(await screen.findByTestId('folio-cuenta-2')).toBeTruthy();
    expect(screen.getByTestId('folio-cuenta-1').textContent).toBe('#001');
    expect(screen.getByTestId('folio-cuenta-2').textContent).toBe('#002');
    expect(apiSimulada.listarCuentasAbiertas).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 3 — Recuperar una cuenta adopta su identidad y cierra el pizarrón.
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.5 · Criterio 3 — recuperar una cuenta', () => {
  it('recuperar llama al contrato 21 y cierra el pizarrón', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonPizarron());
    const dialogo = await screen.findByRole('dialog', { name: /Cuentas abiertas/i });
    await screen.findByTestId('folio-cuenta-1');

    // El post-it entero es el elemento clickeable (role="button"): el primero
    // corresponde a la primera tarjeta (cuenta-1).
    const postIts = within(dialogo).getAllByRole('button', { name: /Ver Cuenta/i });
    fireEvent.click(postIts[0]);

    // El pizarrón pide la versión FRESCA por el contrato 21.
    await waitFor(() => {
      expect(apiSimulada.leerTicket).toHaveBeenCalledWith('cuenta-1');
    });

    // Y el pizarrón se cierra (el diálogo desaparece).
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /Cuentas abiertas/i })
      ).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 4 — "Cerrar" cierra el pizarrón SIN recuperar.
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.5 · Criterio 4 — cerrar sin recuperar', () => {
  it('"Cerrar" cierra el pizarrón y NO llama al contrato 21', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonPizarron());
    const dialogo = await screen.findByRole('dialog', { name: /Cuentas abiertas/i });

    // El botón "Cerrar" del pizarrón se busca ACOTADO al diálogo: el POS tiene
    // sus propios botones "Cerrar" (p. ej. el de la sesión de caja).
    fireEvent.click(within(dialogo).getByRole('button', { name: /^Cerrar$/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /Cuentas abiertas/i })
      ).toBeNull();
    });
    expect(apiSimulada.leerTicket).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Criterio 5 — Un fallo del pizarrón NO tumba el POS.
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.5 · Criterio 5 — un fallo del pizarrón no tumba el POS', () => {
  it('si el contrato 23 falla, el pizarrón muestra error y el POS sigue vivo', async () => {
    apiSimulada.listarCuentasAbiertas.mockRejectedValue(new Error('red caída'));

    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonPizarron());

    // El pizarrón se abre y muestra un error persistente (Regla 19).
    // NOTA: el POS también pinta su propio banner de "sin conexión" (role=alert),
    // así que NO se usa `findByRole('alert')` (habría varios). Se busca el texto
    // del error del pizarrón, que es el que prueba ESTA compuerta.
    expect(
      await screen.findByRole('dialog', { name: /Cuentas abiertas/i })
    ).toBeTruthy();
    expect(await screen.findByText(/red caída/i)).toBeTruthy();

    // Y el POS sigue vivo: el catálogo sigue pintado.
    // TS-01 FIX: usar findByText (async) en vez de getByText (sync) para tolerar
    // el re-render que ocurre cuando el error del pizarrón actualiza el estado.
    expect(await screen.findByText('Concha de Vainilla')).toBeTruthy();
  });
});

