/**
 * Puerta E2E (R4, peldaño 1) — FLUJO COMPLETO DE VENTA en el frontend.
 *
 * @paridad: RetailVisionPOS.e2e.test.jsx
 * @operacion: El flujo completo de venta (agregar → fusionar → cobrar → limpiar)
 *
 * POR QUÉ EXISTE (Riesgo 4 del PLAN_DE_CIERRE_DE_RIESGOS_ESTRUCTURALES.md):
 *   Todo lo demás es unitario o de fuente. Los bugs de INTEGRACIÓN (BUG-08,
 *   BUG-09, BUG-10) solo los veía el ojo del dueño al probar en el navegador.
 *   Este test monta la PANTALLA REAL (`RetailVisionPOS`) con un cliente `api`
 *   SIMULADO EN MEMORIA que implementa los contratos 18–22 y ejercita el flujo
 *   completo de una venta, de punta a punta, dentro de Vitest (ya corre en CI).
 *
 * DIFERENCIA CON `RetailVisionPOS.f3_cierre.test.jsx`:
 *   Aquel verifica CADA contrato por separado con respuestas fijas. Este es un
 *   cliente ESTATEFUL: mantiene el ticket y sus líneas en memoria, de modo que
 *   la fusión RN-17, el total y la limpieza se comportan como el backend real.
 *
 * FLUJO (los 5 pasos del plan §Riesgo 4):
 *   1. Montar la pantalla con catálogo simulado.
 *   2. Tocar un producto 3 veces → UNA línea con cantidad 3 (RN-17).
 *   3. Tocar otro producto → DOS líneas.
 *   4. Cobrar → el backend recibe el total correcto.
 *   5. El carrito se limpia SOLO tras la verificación post-envío (contrato 22).
 *
 * Se ejecuta con Vitest (jsdom): `npm run test` en apps/pos.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// ── Cliente `api` simulado EN MEMORIA (stateful) ─────────────────────────────
// `vi.hoisted` es obligatorio: `vi.mock` se eleva al tope del archivo.
const apiSimulada = vi.hoisted(() => {
  // Estado en memoria del "backend": un ticket con sus líneas.
  const estado = {
    ticket: null,
    lineas: [], // [{ item_id, product_id, quantity, unit_price }]
    version: 0,
    folio: null,
    // Catálogo del "backend": el precio NO viaja en el cuerpo del contrato 18
    // (el frontend manda `{ item_id, product_id, quantity, version }`); el
    // backend RESUELVE `unit_price` desde el catálogo por `product_id`.
    precios: {}, // { [product_id]: number }
  };

  const reiniciar = () => {
    estado.ticket = null;
    estado.lineas = [];
    estado.version = 0;
    estado.folio = null;
    estado.precios = {};
  };

  // El total se DERIVA en el "backend" (DT-02 regla 6): el frontend nunca suma.
  const total = () =>
    estado.lineas.reduce((acc, l) => acc + l.unit_price * l.quantity, 0);

  const proyeccion = () => ({
    id: estado.ticket,
    folio: estado.folio,
    status: 'OPEN',
    version: estado.version,
    total: total(),
    lineas: estado.lineas.map((l) => ({
      item_id: l.item_id,
      product_id: l.product_id,
      quantity: l.quantity,
      unit_price: l.unit_price,
      subtotal: l.unit_price * l.quantity,
    })),
  });

  return {
    _estado: estado,
    _reiniciar: reiniciar,
    _total: total,

    getCatalogo: vi.fn(),
    getSesionActiva: vi.fn(),
    latir: vi.fn(),
    tomarLock: vi.fn(),
    liberarLock: vi.fn(),
  listarCuentasAbiertas: vi.fn(), leerTicket: vi.fn(), leerLineas: vi.fn(),
  getSesionCajaActiva: vi.fn(), getResumenTurno: vi.fn(), getSettingValue: vi.fn(async () => null),
    listarCuentasAbiertas: vi.fn(),
    leerTicket: vi.fn(),
    leerLineas: vi.fn(),

    // Contrato 17 — crear el ticket (vacío; los ítems llegan por el 18).
    crearVenta: vi.fn(async () => {
      estado.ticket = 'ticket-e2e';
      estado.folio = 'A-0001';
      estado.version = 1;
      return proyeccion();
    }),

    // Contrato 18 — añadir ítem, IDEMPOTENTE por `item_id`, con FUSIÓN RN-17.
    anadirItem: vi.fn(async (_ticketId, cuerpo) => {
      const existente = estado.lineas.find((l) => l.item_id === cuerpo.item_id);
      if (existente) {
        // Mismo `item_id` → incrementa (no duplica). RN-17.
        existente.quantity += cuerpo.quantity ?? 1;
      } else {
        // El backend RESUELVE el precio desde el catálogo (el cuerpo del
        // contrato 18 no lo trae). Si no lo conoce, cae a 0.
        estado.lineas.push({
          item_id: cuerpo.item_id,
          product_id: cuerpo.product_id,
          quantity: cuerpo.quantity ?? 1,
          unit_price: estado.precios[cuerpo.product_id] ?? 0,
        });
      }
      estado.version += 1;
      return proyeccion();
    }),

    // Contrato 19 — cambiar cantidad (bloqueo optimista por `version`).
    cambiarCantidad: vi.fn(async (_ticketId, itemId, cuerpo) => {
      const linea = estado.lineas.find((l) => l.item_id === itemId);
      if (linea) linea.quantity = cuerpo.quantity;
      estado.version += 1;
      return proyeccion();
    }),

    // Contrato 20 — quitar ítem.
    quitarItem: vi.fn(async (_ticketId, itemId) => {
      estado.lineas = estado.lineas.filter((l) => l.item_id !== itemId);
      estado.version += 1;
      return proyeccion();
    }),

    // Contrato 22 — verificación post-envío: confirma que TODOS los item_id
    // están persistidos ANTES de que el frontend limpie el carrito.
    verificarEnvio: vi.fn(async (_ticketId, cuerpo) => {
      const persistidos = estado.lineas.map((l) => l.item_id);
      const faltantes = (cuerpo.item_ids || []).filter((id) => !persistidos.includes(id));
      return {
        existe: estado.ticket !== null,
        item_ids_persistidos: persistidos,
        faltantes,
      };
    }),

    // Cobro — el ticket pasa a PAID y devuelve el total del "backend".
    cobrarTicket: vi.fn(async () => {
      estado.version += 1;
      return {
        id: estado.ticket,
        folio: estado.folio,
        status: 'PAID',
        version: estado.version,
        total: total(),
      };
    }),

    // Caja (RN-49): turno ABIERTO para que el cobro no se bloquee.
    getSesionCajaActiva: vi.fn(),
    abrirTurno: vi.fn(),
    registrarMovimiento: vi.fn(),
    getResumenTurno: vi.fn(),
    cerrarTurno: vi.fn(),
    getReporteDiario: vi.fn(),
  };
});

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

// Importar DESPUÉS del mock para que la pantalla reciba el cliente simulado.
import RetailVisionPOS from './RetailVisionPOS.jsx';
import { ApiContext } from './context/ApiContext.jsx'; // TS-01

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
  apiSimulada._reiniciar();
  // El "backend" conoce el precio de cada producto (lo resuelve por `product_id`).
  apiSimulada._estado.precios[PRODUCTO_A.id] = PRODUCTO_A.price;
  apiSimulada._estado.precios[PRODUCTO_B.id] = PRODUCTO_B.price;
  apiSimulada.getCatalogo.mockResolvedValue({
    categorias: [{ id: 'cat-1', name: 'Panadería' }],
    productos: [PRODUCTO_A, PRODUCTO_B],
  });
  apiSimulada.getSesionActiva.mockResolvedValue({
    id: 'ses-1',
    employee_id: 'emp-1',
    terminal_id: 'TERM-01',
  });
  apiSimulada.latir.mockResolvedValue({ ok: true });
  apiSimulada.tomarLock.mockResolvedValue({ ok: true });
  apiSimulada.liberarLock.mockResolvedValue({ ok: true });
  apiSimulada.listarCuentasAbiertas.mockResolvedValue([]);
  apiSimulada.leerTicket.mockResolvedValue({ id: 'ticket-e2e', version: 1 });
  apiSimulada.leerLineas.mockResolvedValue({ lineas: [] });
  // Caja ABIERTA: la guarda de cobro (RN-49) deja pasar.
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
    opening_float: '200.00',
    entradas: '0.00',
    salidas: '0.00',
    ventas_efectivo: '0.00',
    efectivo_esperado: '200.00',
  });
  apiSimulada.cerrarTurno.mockResolvedValue({ cash_session_id: 'caja-1' });
  apiSimulada.getReporteDiario.mockResolvedValue({ lineas: [] });
}

/** Espera a que el catálogo termine de cargar y aparezcan los productos. */
function montarPOS(props = {}) {
  return render(<ApiContext.Provider value={apiSimulada}><RetailVisionPOS {...props} /></ApiContext.Provider>);
}

async function esperarCatalogo() {
  await screen.findByRole('button', { name: /Agregar Concha de Vainilla al ticket/i });
}

beforeEach(() => {
  vi.clearAllMocks();
  sembrarApiFeliz();
});

afterEach(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════════════════
// FLUJO COMPLETO DE VENTA (los 5 pasos del plan §Riesgo 4)
// ═══════════════════════════════════════════════════════════════════════════════

describe('E2E — flujo completo de venta (R4, peldaño 1)', () => {
  it('agrega, fusiona (RN-17), cobra con el total correcto y limpia tras verificar', async () => {
    // ── Paso 1: montar la pantalla con catálogo simulado ──────────────────────
    montarPOS();
    await esperarCatalogo();

    // ── Paso 2: tocar el MISMO producto 3 veces → UNA línea con cantidad 3 ────
    // RN-17: el POS viejo fusionaba por producto; el nuevo por `product_id`.
    // El cliente simulado es idempotente por `item_id`, así que la fusión se
    // refleja en el backend: 3 taps → 1 línea con quantity 3.
    //
    // Selector: la tarjeta del catálogo es un <button> con
    // `aria-label="Agregar <nombre> al ticket"`. NO usamos `getByText` porque
    // tras el primer tap el nombre aparece DOS veces (grid + línea del ticket)
    // y la consulta sería ambigua. El aria-label del grid es único.
    const tarjetaA = () =>
      screen.getByRole('button', { name: 'Agregar Concha de Vainilla al ticket' });
    fireEvent.click(tarjetaA());
    await waitFor(() => expect(apiSimulada.anadirItem).toHaveBeenCalledTimes(1));
    fireEvent.click(tarjetaA());
    await waitFor(() => expect(apiSimulada.anadirItem).toHaveBeenCalledTimes(2));
    fireEvent.click(tarjetaA());
    await waitFor(() => expect(apiSimulada.anadirItem).toHaveBeenCalledTimes(3));

    // El ticket nació UNA sola vez (contrato 17).
    expect(apiSimulada.crearVenta).toHaveBeenCalledTimes(1);

    // Los 3 taps usaron el MISMO `item_id` (fusión, no 3 líneas).
    const itemIdsA = apiSimulada.anadirItem.mock.calls.map((c) => c[1].item_id);
    expect(new Set(itemIdsA).size).toBe(1);
    // Y el backend tiene UNA sola línea con cantidad 3.
    expect(apiSimulada._estado.lineas).toHaveLength(1);
    expect(apiSimulada._estado.lineas[0].quantity).toBe(3);
    expect(apiSimulada._estado.lineas[0].product_id).toBe('prod-A');

    // ── Paso 3: tocar OTRO producto → DOS líneas ─────────────────────────────
    fireEvent.click(
      screen.getByRole('button', { name: 'Agregar Bolillo al ticket' })
    );
    await waitFor(() => expect(apiSimulada.anadirItem).toHaveBeenCalledTimes(4));

    expect(apiSimulada._estado.lineas).toHaveLength(2);
    const lineaB = apiSimulada._estado.lineas.find((l) => l.product_id === 'prod-B');
    expect(lineaB).toBeTruthy();
    expect(lineaB.quantity).toBe(1);
    // Sigue habiendo UN solo ticket.
    expect(apiSimulada.crearVenta).toHaveBeenCalledTimes(1);

    // Total esperado del "backend": 3×18.5 + 1×5 = 60.5
    const totalEsperado = 3 * 18.5 + 1 * 5;
    expect(apiSimulada._total()).toBeCloseTo(totalEsperado, 2);

    // ── Paso 4: cobrar → el backend recibe el cobro del ticket correcto ───────
    fireEvent.click(screen.getByRole('button', { name: /COBRAR/i }));
    fireEvent.click(screen.getByRole('button', { name: /Efectivo/i }));
    // Efectivo exige monto recibido ≥ total: un billete de $100 cubre 60.5.
    fireEvent.click(screen.getByText('$100'));
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));

    await waitFor(() => {
      expect(apiSimulada.cobrarTicket).toHaveBeenCalledTimes(1);
    });
    // El cobro NO reenvía los ítems: solo paga el ticket existente.
    const [ticketId, cuerpoCobro] = apiSimulada.cobrarTicket.mock.calls[0];
    expect(ticketId).toBe('ticket-e2e');
    expect(cuerpoCobro).not.toHaveProperty('items');

    // ── Paso 5: el carrito se limpia SOLO tras la verificación post-envío ─────
    await waitFor(() => {
      expect(apiSimulada.verificarEnvio).toHaveBeenCalledTimes(1);
    });
    const [ticketVerif, cuerpoVerif] = apiSimulada.verificarEnvio.mock.calls[0];
    expect(ticketVerif).toBe('ticket-e2e');
    // La verificación incluye TODOS los `item_id` del carrito.
    const idsEsperados = apiSimulada._estado.lineas.map((l) => l.item_id);
    expect(cuerpoVerif.item_ids.sort()).toEqual([...idsEsperados].sort());

    // Y SOLO entonces el carrito queda vacío: la línea del ticket desaparece.
    await waitFor(() => {
      expect(
        screen.queryByLabelText('Modificar cantidad de Concha de Vainilla')
      ).toBeNull();
    });
  });

  it('NO limpia el carrito si la verificación post-envío reporta faltantes', async () => {
    // La verificación reporta que un ítem NO llegó al servidor (prohibición #2).
    apiSimulada.verificarEnvio.mockResolvedValue({
      existe: true,
      item_ids_persistidos: [],
      faltantes: ['item-fantasma'],
    });

    montarPOS();
    await esperarCatalogo();

    fireEvent.click(
      screen.getByRole('button', { name: 'Agregar Concha de Vainilla al ticket' })
    );
    await waitFor(() => expect(apiSimulada.anadirItem).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /COBRAR/i }));
    fireEvent.click(screen.getByRole('button', { name: /Efectivo/i }));
    fireEvent.click(screen.getByText('$50'));
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));

    await waitFor(() => {
      expect(apiSimulada.verificarEnvio).toHaveBeenCalledTimes(1);
    });

    // El carrito NO se limpió: la línea del ticket sigue presente.
    expect(
      screen.getByLabelText('Modificar cantidad de Concha de Vainilla')
    ).toBeTruthy();
  });
});



