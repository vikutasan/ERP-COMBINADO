/**
 * Compuerta de FASE 12.4 — Carta/catálogo en PDF (F6.3) INTEGRADO al POS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ SE ESTÁ PROTEGIENDO (y por qué)
 * ─────────────────────────────────────────────────────────────────────────────
 * El componente `CatalogoPDF` (F6.3) existe desde hace fases y pasa su test
 * aislado. `SelectorCategoriasPDF` también existe. PERO la pantalla
 * `RetailVisionPOS` NUNCA le pasaba `onExportarPDF` a `CategoryBar`, y
 * `CategoryBar` pinta el botón "Exportar carta a PDF" SOLO si recibe ese prop.
 *
 * Resultado: el dueño NO podía imprimir la carta desde el POS. El componente
 * estaba construido, probado… y HUÉRFANO. Es la 12ª instancia de la lección
 * §10.6: "el componente existe y pasa su test" ≠ "el usuario puede llegar a él".
 *
 * NOTA IMPORTANTE: esta función es NUEVA del nuevo POS. NO existe en el viejo
 * POS, así que NO es una omisión de paridad (§6.8) sino un HUÉRFANO de
 * integración. La compuerta, por eso, no compara contra el viejo POS: verifica
 * que el flujo COMPLETO (botón → selector → descarga) sea alcanzable y opere.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS 5 CRITERIOS
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. El botón "Exportar carta a PDF" es ALCANZABLE desde el POS (existe y se
 *     puede pulsar). Sin el cableado, este test falla en el primer `getByLabelText`.
 *  2. Pulsar el botón ABRE el selector de categorías (diálogo accesible).
 *  3. Confirmar el selector DESCARGA el PDF con las categorías marcadas y CIERRA
 *     el selector. Se verifica el argumento exacto que recibe el servicio.
 *  4. Cancelar CIERRA el selector SIN descargar (no hay efecto colateral).
 *  5. Un fallo del servicio NO tumba el POS: se avisa por el banner y el POS
 *     sigue vivo (contrato `{outcome, reason}` — el POS nunca usa try/catch).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// ── Doble de la capa HTTP ────────────────────────────────────────────────────
// Se simula el cliente de API completo que la pantalla consume al montar.
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

// ── Doble del servicio de PDF ────────────────────────────────────────────────
// Se conserva el módulo real completo (formateadores, generador) y solo se sustituye
// `descargarCatalogoPDF`, que es el efecto de borde (descarga en el navegador).
// Así la compuerta verifica el CABLEADO, no el renderizado del PDF (que ya tiene
// su propia compuerta en `CatalogoPDF.f6_3.test.jsx`).
const catalogoSimulado = vi.hoisted(() => ({
  descargarCatalogoPDF: vi.fn(),
}));

vi.mock('./components/CatalogoPDF.jsx', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    descargarCatalogoPDF: catalogoSimulado.descargarCatalogoPDF,
  };
});

// El import va DESPUÉS de los mocks (Vitest los eleva, pero el orden deja claro
// que la pantalla recibe los dobles).
import RetailVisionPOS from './RetailVisionPOS.jsx';
import { ApiContext } from './context/ApiContext.jsx'; // TS-01

// ── Datos de prueba ──────────────────────────────────────────────────────────
const CATEGORIA_A = { id: 'cat-1', name: 'Panadería' };
const CATEGORIA_B = { id: 'cat-2', name: 'Heladería' };

const PRODUCTO_A = {
  id: 'prod-A',
  sku: 'SKU-A',
  barcode: '111',
  name: 'Concha de Vainilla',
  price: 18.5,
  category_id: 'cat-1',
};

// ── Sembrado de la API ───────────────────────────────────────────────────────
function sembrarApiFeliz() {
  apiSimulada.getCatalogo.mockResolvedValue({
    categorias: [CATEGORIA_A, CATEGORIA_B],
    productos: [PRODUCTO_A],
  });
  apiSimulada.getSesionActiva.mockResolvedValue({
    sesion: null,
    turno_caja: null,
  });
  apiSimulada.crearVenta.mockResolvedValue({
    outcome: 'ok',
    data: { id: 'ticket-1', folio: 'T-0001', version: 1 },
  });
  apiSimulada.cobrarTicket.mockResolvedValue({
    outcome: 'ok',
    data: { id: 'ticket-1', folio: 'T-0001', status: 'PAID' },
  });
  apiSimulada.anadirItem.mockResolvedValue({ outcome: 'ok', data: {} });
  apiSimulada.cambiarCantidad.mockResolvedValue({ outcome: 'ok', data: {} });
  apiSimulada.quitarItem.mockResolvedValue({ outcome: 'ok', data: {} });
  apiSimulada.verificarEnvio.mockResolvedValue({ outcome: 'ok', data: {} });
  apiSimulada.latir.mockResolvedValue({ outcome: 'ok', data: {} });
  apiSimulada.tomarLock.mockResolvedValue({ outcome: 'ok', data: {} });
  apiSimulada.liberarLock.mockResolvedValue({ outcome: 'ok', data: {} });
}

// ── Utilidades de la compuerta ───────────────────────────────────────────────
function montarPOS(props = {}) {
  return render(<ApiContext.Provider value={apiSimulada}><RetailVisionPOS {...props} /></ApiContext.Provider>);
}

async function esperarCatalogo() {
  // El catálogo se pinta cuando la carga termina; este texto viene del producto.
  await screen.findByRole('button', { name: /Agregar Concha de Vainilla al ticket/i });
}

function botonExportarCarta() {
  // `CategoryBar` marca el botón con este aria-label exacto.
  return screen.getByLabelText('Exportar carta a PDF');
}

beforeEach(() => {
  vi.clearAllMocks();
  sembrarApiFeliz();
  catalogoSimulado.descargarCatalogoPDF.mockReturnValue({
    outcome: 'ok',
    data: { paginas: 1 },
  });
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITERIO 1 — El botón es ALCANZABLE desde el POS
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.4 · Criterio 1 — el botón "Exportar carta a PDF" es alcanzable', () => {
  it('la pantalla pinta el botón (el prop onExportarPDF llegó a CategoryBar)', async () => {
    montarPOS();
    await esperarCatalogo();

    expect(botonExportarCarta()).toBeTruthy();
  });

  it('el botón es pulsable (no está deshabilitado)', async () => {
    montarPOS();
    await esperarCatalogo();

    expect(botonExportarCarta().disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITERIO 2 — El botón ABRE el selector de categorías
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.4 · Criterio 2 — el botón abre el selector de categorías', () => {
  it('al pulsar el botón aparece el diálogo del selector', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonExportarCarta());

    const dialogo = await screen.findByLabelText(
      'Seleccionar categorías para la carta PDF',
    );
    expect(dialogo).toBeTruthy();
  });

  it('el selector lista las categorías del catálogo', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonExportarCarta());
    await screen.findByLabelText('Seleccionar categorías para la carta PDF');

    expect(screen.getByLabelText('Panadería')).toBeTruthy();
    expect(screen.getByLabelText('Heladería')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITERIO 3 — Confirmar DESCARGA con las categorías marcadas y CIERRA
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.4 · Criterio 3 — confirmar descarga el PDF y cierra el selector', () => {
  it('descarga el PDF con las categorías marcadas', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonExportarCarta());
    await screen.findByLabelText('Seleccionar categorías para la carta PDF');

    // El selector marca TODAS por defecto (decisión de F6.3). Para dejar solo
    // "Panadería", se DESMARCA "Heladería".
    fireEvent.click(screen.getByLabelText('Heladería'));
    fireEvent.click(screen.getByText('Exportar PDF'));

    await waitFor(() => {
      expect(catalogoSimulado.descargarCatalogoPDF).toHaveBeenCalledTimes(1);
    });

    // El primer argumento son las categorías seleccionadas (solo Panadería).
    const [seleccionadas] = catalogoSimulado.descargarCatalogoPDF.mock.calls[0];
    expect(seleccionadas).toHaveLength(1);
    expect(seleccionadas[0].id).toBe('cat-1');
  });

  it('al confirmar, el selector se cierra', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonExportarCarta());
    await screen.findByLabelText('Seleccionar categorías para la carta PDF');

    fireEvent.click(screen.getByLabelText('Panadería'));
    fireEvent.click(screen.getByText('Exportar PDF'));

    await waitFor(() => {
      expect(
        screen.queryByLabelText('Seleccionar categorías para la carta PDF'),
      ).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITERIO 4 — Cancelar CIERRA sin descargar
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.4 · Criterio 4 — cancelar cierra sin descargar', () => {
  it('cancelar cierra el selector y NO llama al servicio de PDF', async () => {
    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonExportarCarta());
    await screen.findByLabelText('Seleccionar categorías para la carta PDF');

    fireEvent.click(screen.getByText('Cancelar'));

    await waitFor(() => {
      expect(
        screen.queryByLabelText('Seleccionar categorías para la carta PDF'),
      ).toBeNull();
    });
    expect(catalogoSimulado.descargarCatalogoPDF).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITERIO 5 — Un fallo del servicio NO tumba el POS
// ─────────────────────────────────────────────────────────────────────────────
describe('F12.4 · Criterio 5 — un fallo del PDF no tumba el POS', () => {
  it('si el servicio falla, avisa por el banner y el POS sigue vivo', async () => {
    catalogoSimulado.descargarCatalogoPDF.mockReturnValue({
      outcome: 'error',
      reason: 'sin_categorias',
    });

    montarPOS();
    await esperarCatalogo();

    fireEvent.click(botonExportarCarta());
    await screen.findByLabelText('Seleccionar categorías para la carta PDF');

    fireEvent.click(screen.getByLabelText('Panadería'));
    fireEvent.click(screen.getByText('Exportar PDF'));

    // El POS avisa del fallo por el banner (contrato {outcome, reason}).
    await screen.findByText(/No se pudo generar la carta/i);

    // Y el POS sigue operando: el catálogo sigue en pantalla.
    expect(screen.getByText('Concha de Vainilla')).toBeTruthy();
  });
});


