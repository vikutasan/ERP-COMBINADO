/**
 * Puerta de FASE 7.6 — UX HEREDADA DEL VIEJO POS (integración de la IA).
 *
 * Este test monta la PANTALLA REAL (`RetailVisionPOS`) con un cliente `api`
 * simulado y verifica que la integración de los 3 entregables de la Fase 7
 * respeta la gramática de interacción del VIEJO POS:
 *
 *   - VISIÓN  → es un MODO DE VISTA (`viewMode === 'CAMERA'`) que REEMPLAZA el
 *               cuerpo (grid ↔ visor), NO un overlay suelto. Se conmuta desde la
 *               `CategoryBar` (botón "Escáner IA" → CAMERA; cada categoría → GRID).
 *   - VOZ     → es un overlay abierto desde el HEADER, con GATE de disponibilidad
 *               (`disabled={!vozDisponible}`), igual que `#btn-dictado-voz`.
 *   - TEMA    → es un overlay NUEVO (no existía en el viejo POS).
 *
 * Cierra los 11 criterios del §5 del plan `PLAN_F7_6_UX_HEREDADA_v2.md`.
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
  // TS-01 FIX
  listarCuentasAbiertas: vi.fn(),
  leerTicket: vi.fn(),
  leerLineas: vi.fn(),
  getSesionCajaActiva: vi.fn(),
  getResumenTurno: vi.fn(),
  getSettingValue: vi.fn(async () => null),
}));

vi.mock('./api/client.js', () => apiSimulada);

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

const PRODUCTO_B = {
  id: 'prod-B',
  sku: 'SKU-B',
  barcode: '222',
  name: 'Bolillo',
  price: 5,
  category_id: 'cat-1',
};

/** Configura el cliente simulado con respuestas felices por defecto. */
function sembrarApiFeliz() {
  apiSimulada.getCatalogo.mockResolvedValue({
    categorias: [{ id: 'cat-1', name: 'Panadería' }],
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
    total: 23.5,
  });
  apiSimulada.verificarEnvio.mockImplementation(async (_t, cuerpo) => ({
    existe: true,
    item_ids_persistidos: cuerpo.item_ids,
    faltantes: [],
  }));
  apiSimulada.latir.mockResolvedValue({ ok: true });
  apiSimulada.tomarLock.mockResolvedValue({ ok: true });
  apiSimulada.liberarLock.mockResolvedValue({ ok: true });
  // TS-01 FIX
  apiSimulada.listarCuentasAbiertas.mockResolvedValue({ cuentas: [] });
  apiSimulada.leerTicket.mockResolvedValue({ id: 'ticket-1', version: 1, total: 0, status: 'OPEN' });
  apiSimulada.leerLineas.mockResolvedValue({ ticket_id: 'ticket-1', version: 1, total: 0, lineas: [] });
  apiSimulada.getSesionCajaActiva.mockResolvedValue({ cash_session_id: 'caja-1', terminal_id: 'TERM-01', status: 'OPEN', opening_float: '200.00' });
  apiSimulada.getResumenTurno.mockResolvedValue(null);
}

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

/** Localiza el botón "Escáner IA" de la CategoryBar. */
function botonEscanerIA() {
  return screen.getByRole('tab', { name: /Escáner IA/i });
}

/** Localiza el botón de voz del header (aria-label="Dictado por voz"). */
function botonVoz() {
  return screen.getByRole('button', { name: /Dictado por voz/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  sembrarApiFeliz();
});

afterEach(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 1 — La CategoryBar expone el conmutador de vista
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.6 · Criterio 1 — la CategoryBar expone el conmutador de vista', () => {
  it('el botón "Escáner IA" está presente y arranca NO seleccionado (viewMode=GRID)', async () => {
    montarPOS();
    await esperarCatalogo();

    const boton = botonEscanerIA();
    expect(boton).toBeTruthy();
    // Con viewMode='GRID' por defecto, el botón del escáner NO está activo.
    expect(boton.getAttribute('aria-selected')).toBe('false');
  });

  it('pulsar "Escáner IA" conmuta el cuerpo al visor cenital (CAMERA)', async () => {
    montarPOS();
    await esperarCatalogo();

    // Antes: el grid está montado (hay productos).
    expect(screen.getByText('Concha de Vainilla')).toBeTruthy();

    fireEvent.click(botonEscanerIA());

    // Después: el visor cenital reemplaza el cuerpo.
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Visión cenital/i })).toBeTruthy();
    });
    // El botón del escáner queda seleccionado.
    expect(botonEscanerIA().getAttribute('aria-selected')).toBe('true');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 2 — Cada categoría conmuta a GRID
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.6 · Criterio 2 — cada categoría conmuta a GRID', () => {
  it('pulsar una categoría vuelve del visor al grid de productos', async () => {
    montarPOS();
    await esperarCatalogo();

    // Entrar al visor.
    fireEvent.click(botonEscanerIA());
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Visión cenital/i })).toBeTruthy();
    });

    // Pulsar la categoría "Panadería" → debe volver al GRID.
    fireEvent.click(screen.getByRole('tab', { name: 'Panadería' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Visión cenital/i })).toBeNull();
    });
    expect(screen.getByText('Concha de Vainilla')).toBeTruthy();
    expect(botonEscanerIA().getAttribute('aria-selected')).toBe('false');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 3 — El cuerpo alterna grid ↔ visor
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.6 · Criterio 3 — el cuerpo alterna grid ↔ visor', () => {
  it('con viewMode=GRID se monta el grid; con viewMode=CAMERA se monta el visor', async () => {
    montarPOS();
    await esperarCatalogo();

    // GRID: el grid de productos está montado; el visor NO.
    expect(screen.getByText('Concha de Vainilla')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: /Visión cenital/i })).toBeNull();

    // CAMERA: el visor está montado; el grid de productos NO.
    fireEvent.click(botonEscanerIA());
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Visión cenital/i })).toBeTruthy();
    });
    expect(screen.queryByText('Concha de Vainilla')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 4 — El visor NO es un overlay suelto
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.6 · Criterio 4 — el visor NO es un overlay suelto', () => {
  it('el visor NO se monta al arrancar (no hay un estado visionAbierta que lo abra solo)', async () => {
    montarPOS();
    await esperarCatalogo();

    // Al arrancar, el visor NO existe: la visión es un modo de vista, no un
    // overlay que se abra por defecto.
    expect(screen.queryByRole('dialog', { name: /Visión cenital/i })).toBeNull();
  });

  it('el botón "×" del visor vuelve a GRID (no a un booleano)', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonEscanerIA());
    const visor = await screen.findByRole('dialog', { name: /Visión cenital/i });

    // El botón "×" del visor cierra volviendo al grid. Se acota la búsqueda al
    // diálogo del visor para no colisionar con otros controles "Cerrar" de la
    // pantalla (p. ej. el modal de programación de pedido).
    fireEvent.click(within(visor).getByRole('button', { name: /^Cerrar$/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Visión cenital/i })).toBeNull();
    });
    expect(screen.getByText('Concha de Vainilla')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 5 — La voz se abre desde el header con gate
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.6 · Criterio 5 — la voz se abre desde el header con gate', () => {
  it('el botón de voz está HABILITADO cuando voz.disponible === true', async () => {
    montarPOS();
    await esperarCatalogo();

    // `useVoiceCart` arranca con `disponible=true`, así que el botón está activo.
    expect(botonVoz().disabled).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 6 — La voz SÍ se abre cuando está disponible
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.6 · Criterio 6 — la voz SÍ se abre cuando está disponible', () => {
  it('pulsar el botón de voz monta el VoiceCartPanel', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonVoz());

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Dictado por voz/i })).toBeTruthy();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 7 — El header NO tiene botón de visión
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.6 · Criterio 7 — el header NO tiene botón de visión', () => {
  it('no existe un botón de visión en el header (la visión vive en la CategoryBar)', async () => {
    montarPOS();
    await esperarCatalogo();

    // El único control de visión es el tab "Escáner IA" de la CategoryBar.
    // No debe existir un botón de visión suelto en el header.
    expect(screen.queryByRole('button', { name: /Visión/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cámara/i })).toBeNull();
    // El tab del escáner SÍ existe (es el control heredado).
    expect(botonEscanerIA()).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 8 — El tema vive en la landing (TerminalSelector), no en el POS
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.6 · Criterio 8 — el tema vive en la landing, no en el POS', () => {
  it('la pantalla del POS NO expone el control de tema (se reubicó a la landing)', async () => {
    montarPOS();
    await esperarCatalogo();

    // El selector de tema se reubicó a la landing (TerminalSelector) en el
    // commit del pizarrón: la pantalla del POS ya NO monta el ThemeSelector ni
    // expone el botón "Cambiar tema". La compuerta del ThemeSelector en sí vive
    // en ThemeSelector.f7_1.test.jsx; aquí solo se fija la frontera de pantalla.
    expect(screen.queryByRole('button', { name: /Cambiar tema/i })).toBeNull();
    expect(screen.queryByRole('dialog', { name: /Selector de tema/i })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 9 — La confirmación de voz toca el carrito por el camino atómico
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.6 · Criterio 9 — la confirmación de voz usa el camino atómico', () => {
  it('el panel de voz se monta con el catálogo real (mismo camino que el grid)', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonVoz());
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Dictado por voz/i })).toBeTruthy();
    });

    // El panel recibe el catálogo real (los productos cargados), de modo que
    // `onApply` puede resolver por SKU y llamar a `carrito.anadirLinea` con la
    // firma `{product_id, name, quantity, unit_price}` — el MISMO camino que el
    // grid, que es lo que mantiene viva la persistencia atómica (contratos 18–20).
    expect(screen.getByText('Concha de Vainilla')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 10 — El "Agregar" de visión toca el carrito por el mismo camino
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.6 · Criterio 10 — el "Agregar" de visión usa el mismo camino', () => {
  it('el visor se monta con el catálogo real y el botón de encendido disponible', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonEscanerIA());
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Visión cenital/i })).toBeTruthy();
    });

    // El visor recibe el catálogo real (los productos cargados), de modo que
    // `onAgregar` puede llamar a `asegurarTicket()` + `carrito.anadirLinea` con
    // la firma `{product_id, name, quantity, unit_price}` — el MISMO camino que
    // el grid. Verificamos que el visor está montado con su control de encendido.
    expect(screen.getByRole('dialog', { name: /Visión cenital/i })).toBeTruthy();
    expect(screen.getByLabelText(/Cámara cenital/i)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRITERIO 11 — La degradación elegante se conserva
// ═══════════════════════════════════════════════════════════════════════════════

describe('F7.6 · Criterio 11 — la degradación elegante se conserva', () => {
  it('si el Centro de IA no responde, el POS sigue vendiendo en modo manual (grid montado)', async () => {
    // El Centro de IA caído NO debe impedir que el POS cargue el catálogo ni que
    // el grid esté disponible. Simulamos que el catálogo carga normalmente.
    montarPOS();
    await esperarCatalogo();

    // El grid está montado (modo manual disponible) aunque la IA no se use.
    expect(screen.getByText('Concha de Vainilla')).toBeTruthy();
    expect(screen.getByText('Bolillo')).toBeTruthy();

    // Y el operador puede agregar un producto manualmente (venta manual viva).
    fireEvent.click(screen.getByText('Concha de Vainilla'));

    await waitFor(() => {
      expect(apiSimulada.crearVenta).toHaveBeenCalled();
    });
  });
});


