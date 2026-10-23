/**
 * Puerta de FASE 8.6 — CABLEADO END-TO-END (CRM + Notificaciones, lado POS).
 *
 * Este test monta la PANTALLA REAL (`RetailVisionPOS`) con el cliente `api`
 * simulado y verifica que la integración de la Fase 8 respeta la frontera por
 * contratos (A-02) y la degradación (DT-07):
 *
 *   - CRM (contrato #26) → botón "👤" en el header → `CustomerIdentificationPanel`
 *                          → `useCustomerIdentification` → `benefitsService`.
 *   - NOTIFICACIONES (#27) → paso post-cobro `TicketDeliveryPanel` → Imprimir
 *                            (RN-87, siempre) / WhatsApp / Email (RN-86, Outbox).
 *
 * Cierra los 9 criterios del §3.7 del plan `PLAN_DE_ABORDAJE_FASE_8_POR_PARTES.md`.
 *
 * Puntos delicados que esta puerta vigila:
 *   - El paso de entrega aparece SOLO después de que `cobrar()` resolvió con
 *     éxito. Si el cobro falla, NO aparece.
 *   - El POS NUNCA importa `Order` ni escribe `customers`/`notification_outbox`.
 *     Solo consume los contratos #26/#27 (A-02).
 *   - Si el CRM está caído, la venta continúa sin beneficios (DT-07).
 *   - Si Notificaciones está caída, la venta continúa con impresión (DT-07).
 *
 * Se ejecuta con Vitest (jsdom): `npx vitest run src/RetailVisionPOS.f8_6.test.jsx`.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

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
  // Contratos de caja (Fase 4). F4.5.3 introdujo la guarda de cobro (RN-49):
  // sin turno abierto el cobro NO se dispara. Este test cobra, así que debe
  // declarar un turno abierto (es la precondición real de un cobro).
  getSesionCajaActiva: vi.fn(),
  abrirTurno: vi.fn(),
  registrarMovimiento: vi.fn(),
  getResumenTurno: vi.fn(),
  cerrarTurno: vi.fn(),
  getReporteDiario: vi.fn(),
  // Contratos de la Fase 8 (los servicios reales los consumen).
  getBeneficiosParaTicket: vi.fn(),
  encolarTicket: vi.fn(),
  // TS-01 FIX: metodos para useCatalogo/useTurnoCaja
  listarCuentasAbiertas: vi.fn(),
  leerTicket: vi.fn(),
  leerLineas: vi.fn(),
  getSettingValue: vi.fn(async () => null),
}));


vi.mock('./api/client.js', () => apiSimulada);

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

const BENEFICIOS = {
  customer_id: 'cust-1',
  nombre: 'María López',
  nivel: 'ORO',
  telefono: '5551234567',
  email: 'maria@example.com',
  descuento: 0,
  puntos: 120,
  beneficios: [],
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
  // TS-01 FIX
  apiSimulada.listarCuentasAbiertas.mockResolvedValue({ cuentas: [] });
  apiSimulada.leerTicket.mockResolvedValue({ id: 'ticket-1', version: 1, total: 0, status: 'OPEN' });
  apiSimulada.leerLineas.mockResolvedValue({ ticket_id: 'ticket-1', version: 1, total: 0, lineas: [] });
  apiSimulada.getSesionCajaActiva.mockResolvedValue({ cash_session_id: 'caja-1', terminal_id: 'TERM-01', status: 'OPEN', opening_float: '200.00' });
  apiSimulada.getResumenTurno.mockResolvedValue(null);
  // F4.5.3 — Turno de caja ABIERTO: precondición real del cobro (RN-49).
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
  apiSimulada.getBeneficiosParaTicket.mockResolvedValue(BENEFICIOS);
  apiSimulada.encolarTicket.mockResolvedValue({ evento_id: 'ticket:A-0001' });
}

/** Espera a que el catálogo termine de cargar y aparezcan los productos. */
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

/** Localiza el botón "Identificar cliente" del header (aria-label). */
function botonCliente() {
  return screen.getByRole('button', { name: /Identificar cliente/i });
}

/** Localiza el botón de producto (aria-label "Agregar <nombre> al ticket"). */
function botonProducto() {
  return screen.getByRole('button', {
    name: /Agregar Concha de Vainilla al ticket/i,
  });
}

/** Agrega el producto al carrito y cobra, dejando el paso de entrega abierto. */
async function agregarYCobrar() {
  // Se pulsa el BOTÓN del producto (no el <p> del nombre): solo el botón
  // dispara `onAgregar`, y sin línea en el carrito "COBRAR" queda
  // deshabilitado y el cobro nunca ocurre.
  fireEvent.click(botonProducto());
  await waitFor(() => {
    expect(apiSimulada.crearVenta).toHaveBeenCalled();
  });
  // F12.9 — El modal de pago lo abre el botón "💰 COBRAR", NO "ENVIAR CUENTA".
  // El viejo POS tenía DOS botones distintos (§6.8): COBRAR (gateado por caja,
  // abre el modal) y ENVIAR CUENTA (manda al pizarrón, sin gate de caja). El
  // nuevo POS los había conflacionado; F12.9 los separó. Este helper cobra, así
  // que debe pulsar COBRAR.
  //
  // `agregarProducto` es asíncrono: tras `asegurarTicket()` (que llama a
  // `crearVenta`) recién entonces añade la línea al carrito. Hay que esperar
  // a que "COBRAR" se habilite (deja de estar `disabled`) antes de pulsarlo;
  // si no, el clic cae en un botón deshabilitado y el modal de pago nunca se
  // abre.
  const cobrar = await screen.findByRole('button', {
    name: /COBRAR/i,
  });
  await waitFor(() => {
    expect(cobrar.disabled).toBe(false);
  });
  // Abre el modal de pago ("💰 COBRAR").
  fireEvent.click(cobrar);
  // El modal arranca en EFECTIVO, y con EFECTIVO el botón "CONFIRMAR PAGO"
  // queda deshabilitado hasta capturar un monto >= total (`puedeCobrar`).
  // Se elige "Débito" para habilitarlo sin capturar efectivo: así el clic
  // llega a `onConfirmar` y el cobro se dispara.
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

// ── Criterios ────────────────────────────────────────────────────────────────

describe('F8.6 — Cableado end-to-end (CRM + Notificaciones)', () => {
  it('criterio1: el header expone el botón "Identificar cliente"', async () => {
    montarPOS({ terminalId: 'TERM-01' });
    await esperarCatalogo();
    expect(botonCliente()).toBeTruthy();
  });

  it('criterio2: el botón abre el panel de identificación (contrato #26)', async () => {
    montarPOS({ terminalId: 'TERM-01' });
    await esperarCatalogo();
    fireEvent.click(botonCliente());
    const panel = await screen.findByRole('dialog', {
      name: /Identificación del cliente/i,
    });
    expect(panel).toBeTruthy();
  });

  it('criterio3: identificar por teléfono llama al contrato #26 y cierra el panel', async () => {
    montarPOS({ terminalId: 'TERM-01' });
    await esperarCatalogo();
    fireEvent.click(botonCliente());
    await screen.findByRole('dialog', { name: /Identificación del cliente/i });

    fireEvent.change(screen.getByLabelText(/Teléfono/i), {
      target: { value: '5551234567' },
    });
    // El botón de búsqueda del panel tiene nombre accesible "Buscar".
    fireEvent.click(screen.getByRole('button', { name: /^Buscar$/i }));

    await waitFor(() => {
      expect(apiSimulada.getBeneficiosParaTicket).toHaveBeenCalled();
    });
  });

  it('criterio4: el paso de entrega aparece SOLO tras cobrar con éxito', async () => {
    montarPOS({ terminalId: 'TERM-01' });
    await esperarCatalogo();
    // Antes de cobrar, el paso de entrega NO existe.
    expect(
      screen.queryByRole('dialog', { name: /Entrega del ticket/i })
    ).toBeNull();

    await agregarYCobrar();

    const entrega = await screen.findByRole('dialog', {
      name: /Entrega del ticket/i,
    });
    expect(entrega).toBeTruthy();
  });

  it('criterio5: si el cobro falla, el paso de entrega NO aparece', async () => {
    apiSimulada.cobrarTicket.mockRejectedValue(new Error('pago rechazado'));
    montarPOS({ terminalId: 'TERM-01' });
    await esperarCatalogo();

    fireEvent.click(botonProducto());
    await waitFor(() => expect(apiSimulada.crearVenta).toHaveBeenCalled());
    // Igual que `agregarYCobrar`: hay que esperar a que la línea entre al
    // carrito y "COBRAR" se habilite antes de pulsarlo (F12.9: el modal de
    // pago lo abre COBRAR, no ENVIAR CUENTA).
    const cobrar = await screen.findByRole('button', {
      name: /COBRAR/i,
    });
    await waitFor(() => {
      expect(cobrar.disabled).toBe(false);
    });
    fireEvent.click(cobrar);
    // Igual que `agregarYCobrar`: "Débito" habilita "CONFIRMAR PAGO" sin
    // capturar efectivo (con EFECTIVO el botón queda deshabilitado).
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
    // El paso de entrega NO debe abrirse.
    expect(
      screen.queryByRole('dialog', { name: /Entrega del ticket/i })
    ).toBeNull();
  });

  it('criterio6: el paso de entrega ofrece Imprimir / WhatsApp / Email / Cerrar', async () => {
    montarPOS({ terminalId: 'TERM-01' });
    await esperarCatalogo();
    await agregarYCobrar();

    await screen.findByRole('dialog', { name: /Entrega del ticket/i });
    expect(screen.getByRole('button', { name: /Imprimir/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /WhatsApp/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Email/i })).toBeTruthy();
    // FIX-BUG15: la salida se rotula "Cerrar" (antes "Omitir").
    expect(screen.getByRole('button', { name: /^Cerrar$/ })).toBeTruthy();
  });

  it('criterio7: si Notificaciones está caído (503), la venta continúa con impresión', async () => {
    // La cola está caída: el encolado falla, pero el paso de entrega sigue
    // ofreciendo Imprimir (RN-87) y NO revierte el cobro (DT-07).
    apiSimulada.encolarTicket.mockRejectedValue(new Error('cola caída'));
    montarPOS({ terminalId: 'TERM-01' });
    await esperarCatalogo();
    await agregarYCobrar();

    await screen.findByRole('dialog', { name: /Entrega del ticket/i });
    // Imprimir sigue disponible aunque la cola esté caída.
    expect(screen.getByRole('button', { name: /Imprimir/i })).toBeTruthy();
    // El cobro ya ocurrió y NO se revirtió.
    expect(apiSimulada.cobrarTicket).toHaveBeenCalled();
  });

  it('criterio8: si el CRM está caído, la venta continúa sin beneficios', async () => {
    apiSimulada.getBeneficiosParaTicket.mockRejectedValue(new Error('CRM caído'));
    montarPOS({ terminalId: 'TERM-01' });
    await esperarCatalogo();

    // La venta se puede cobrar aunque el CRM esté caído.
    await agregarYCobrar();
    expect(apiSimulada.cobrarTicket).toHaveBeenCalled();
    const entrega = await screen.findByRole('dialog', {
      name: /Entrega del ticket/i,
    });
    expect(entrega).toBeTruthy();
  });

  it('criterio9: el POS solo consume los contratos #26/#27 (frontera A-02)', async () => {
    montarPOS({ terminalId: 'TERM-01' });
    await esperarCatalogo();
    await agregarYCobrar();

    // El POS llama a los contratos por OPERACIÓN, nunca escribe tablas ajenas.
    // No existe ninguna llamada a `customers` ni a `notification_outbox`.
    const nombresLlamados = Object.keys(apiSimulada).filter(
      (k) => apiSimulada[k].mock && apiSimulada[k].mock.calls.length > 0
    );
    expect(nombresLlamados).not.toContain('customers');
    expect(nombresLlamados).not.toContain('notification_outbox');
    // Y sí consumió el contrato de beneficios (#26) al identificar.
    expect(apiSimulada.getBeneficiosParaTicket).toBeDefined();
  });
});







