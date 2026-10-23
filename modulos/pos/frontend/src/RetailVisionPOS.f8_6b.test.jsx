/**
 * Puerta de REGRESIÓN — F8.6b (dos bugs de runtime reportados en vivo).
 *
 * BUG 1: en el paso post-cobro de entrega (`TicketDeliveryPanel`) NO se podía
 *        capturar el teléfono/correo para enviar el ticket por WhatsApp/email.
 * BUG 2: tras imprimir u omitir el ticket, el operador quedaba ATRAPADO en el
 *        modal "Venta cobrada" (`OverlayExito`): pulsar "Nueva venta" no lo
 *        cerraba.
 *
 * CAUSA RAÍZ (una sola): `OverlayExito` y `TicketDeliveryPanel` se montaban
 * SIMULTÁNEAMENTE (ambos `fixed inset-0 z-50`). El `OverlayExito` se renderiza
 * ANTES en el DOM, así que su backdrop cubría la pantalla y competía por el
 * foco/pointer con el panel de entrega; y `onNuevaVenta` NO limpiaba
 * `acciones.ticket`, de modo que el overlay "Venta cobrada" nunca desaparecía.
 *
 * Se ejecuta con Vitest (jsdom):
 *   npx vitest run src/RetailVisionPOS.f8_6b.test.jsx
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
  listarCuentasAbiertas: vi.fn(),
  leerTicket: vi.fn(),
  leerLineas: vi.fn(),
  getSesionCajaActiva: vi.fn(),
  getResumenTurno: vi.fn(),
  getSettingValue: vi.fn(async () => null),
  getSesionCajaActiva: vi.fn(),
  abrirTurno: vi.fn(),
  registrarMovimiento: vi.fn(),
  getResumenTurno: vi.fn(),
  cerrarTurno: vi.fn(),
  getReporteDiario: vi.fn(),
  getBeneficiosParaTicket: vi.fn(),
  encolarTicket: vi.fn(),
}));

vi.mock('./api/client.js', () => apiSimulada);

// Importar DESPUÉS del mock para que la pantalla reciba el cliente simulado.
import RetailVisionPOS from './RetailVisionPOS.jsx';
import { ApiContext } from './context/ApiContext.jsx'; // TS-01 FIX

const PRODUCTO_A = {
  id: 'prod-A',
  sku: 'SKU-A',
  barcode: '111',
  name: 'Concha de Vainilla',
  price: 18.5,
  category_id: 'cat-1',
};

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
  // TS-01 FIX
  apiSimulada.listarCuentasAbiertas.mockResolvedValue({ cuentas: [] });
  apiSimulada.leerTicket.mockResolvedValue({ id: 'ticket-1', version: 1, total: 0, status: 'OPEN' });
  apiSimulada.leerLineas.mockResolvedValue({ ticket_id: 'ticket-1', version: 1, total: 0, lineas: [] });
  apiSimulada.getSesionCajaActiva.mockResolvedValue({ cash_session_id: 'caja-1', terminal_id: 'TERM-01', status: 'OPEN', opening_float: '200.00' });
  apiSimulada.getResumenTurno.mockResolvedValue(null);
  apiSimulada.getSesionCajaActiva.mockResolvedValue({
    cash_session_id: 'caja-1',
    terminal_id: 'TERM-01',
    status: 'OPEN',
    opening_float: '200.00',
  });
  apiSimulada.abrirTurno.mockResolvedValue({ cash_session_id: 'caja-1' });
  apiSimulada.registrarMovimiento.mockResolvedValue({ id: 'mov-1' });
  apiSimulada.getResumenTurno.mockResolvedValue({
    cash_session_id: 'caja-1',
    esperado_en_caja: '200.00',
  });
  apiSimulada.cerrarTurno.mockResolvedValue({ cash_session_id: 'caja-1' });
  apiSimulada.getReporteDiario.mockResolvedValue({ fecha: '2026-09-30' });
  apiSimulada.getBeneficiosParaTicket.mockResolvedValue(null);
  apiSimulada.encolarTicket.mockResolvedValue({ evento_id: 'ticket:A-0001' });
}

function montarPOS(props = {}) {
  return render(
    <ApiContext.Provider value={apiSimulada}>
      <RetailVisionPOS {...props} />
    </ApiContext.Provider>
  );
}

async function esperarCatalogo() {
  await screen.findByRole('button', { name: /Agregar Concha de Vainilla al ticket/i });
}

function botonProducto() {
  return screen.getByRole('button', {
    name: /Agregar Concha de Vainilla al ticket/i,
  });
}

/** Agrega el producto al carrito y cobra, dejando el paso de entrega abierto. */
async function agregarYCobrar() {
  fireEvent.click(botonProducto());
  await waitFor(() => {
    expect(apiSimulada.crearVenta).toHaveBeenCalled();
  });
  const cobrar = await screen.findByRole('button', { name: /COBRAR/i });
  await waitFor(() => {
    expect(cobrar.disabled).toBe(false);
  });
  fireEvent.click(cobrar);
  fireEvent.click(await screen.findByRole('button', { name: /Débito/i }));
  const confirmar = await screen.findByRole('button', {
    name: /CONFIRMAR PAGO/i,
  });
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

describe('F8.6b — regresión: entrega del ticket usable y salida del post-cobro', () => {
  it('BUG 1: se puede capturar el teléfono en el paso de entrega', async () => {
    montarPOS({ terminalId: 'TERM-01' });
    await esperarCatalogo();
    await agregarYCobrar();

    const input = await screen.findByLabelText(/WhatsApp/i);
    fireEvent.change(input, { target: { value: '5551234567' } });
    // El valor debe PERSISTIR (si el panel se remonta, vuelve a '').
    expect(input.value).toBe('5551234567');
  });

  it('BUG 1: se puede capturar el correo en el paso de entrega', async () => {
    montarPOS({ terminalId: 'TERM-01' });
    await esperarCatalogo();
    await agregarYCobrar();

    const input = await screen.findByLabelText(/Email/i);
    fireEvent.change(input, { target: { value: 'cliente@example.com' } });
    expect(input.value).toBe('cliente@example.com');
  });

  it('BUG 2: el modal "Venta cobrada" NO coexiste con el paso de entrega', async () => {
    montarPOS({ terminalId: 'TERM-01' });
    await esperarCatalogo();
    await agregarYCobrar();

    // Mientras el paso de entrega está abierto, el overlay "Venta cobrada"
    // NO debe estar presente (competían por el mismo z-50 y bloqueaban la UX).
    await screen.findByRole('dialog', { name: /Entrega del ticket/i });
    expect(
      screen.queryByRole('dialog', { name: /Venta cobrada/i })
    ).toBeNull();
  });

  it('BUG 2: tras cerrar el ticket se puede cerrar el post-cobro', async () => {
    montarPOS({ terminalId: 'TERM-01' });
    await esperarCatalogo();
    await agregarYCobrar();

    await screen.findByRole('dialog', { name: /Entrega del ticket/i });
    // FIX-BUG15: el botón de salida se rotula "Cerrar" (antes "Omitir").
    fireEvent.click(screen.getByRole('button', { name: /^Cerrar$/ }));

    // El paso de entrega desaparece.
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /Entrega del ticket/i })
      ).toBeNull();
    });

    // Y el operador NO queda atrapado: si aparece "Venta cobrada", su botón
    // "Nueva venta" debe cerrarlo.
    const exito = screen.queryByRole('dialog', { name: /Venta cobrada/i });
    if (exito) {
      fireEvent.click(screen.getByRole('button', { name: /Nueva venta/i }));
      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: /Venta cobrada/i })
        ).toBeNull();
      });
    }
  });
});







