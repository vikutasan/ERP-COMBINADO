/**
 * Puerta P1 — El "cuarto" de la venta en curso (`useContextoDeVenta`).
 *
 * CICATRIZ QUE PROTEGE (F12.32): al enviar una cuenta al pizarrón, el POS
 * reseteaba `ticketId` pero OLVIDABA `tipoPedido` y `bloquePedido`. El selector
 * se quedaba en 'PEDIDO' y el bloque del pedido anterior contaminaba la cuenta
 * siguiente. La causa de fondo: 31 `useState` + 3 `useRef` sueltos, donde
 * "cerrar una venta" era una lista de resets que se olvidaba un interruptor.
 *
 * Esta puerta NO verifica que `cerrar` exista (eso sería tautológico: probar la
 * clase que escribí). Verifica el EFECTO: que `cerrar()` apague TODOS los
 * interruptores del cuarto —estados Y refs— y que NUNCA toque las claves
 * prohibidas (catálogo/sesión), que deben sobrevivir entre cuentas.
 *
 * Lección de las compuertas anti-tautología (BUG-10e/10f/10g/10h): una compuerta
 * que solo verifica el símbolo que escribiste no verifica el efecto.
 *
 * @paridad: hooks/useContextoDeVenta.p1.test.jsx
 * @operacion: Cierre de la venta en curso (apagar todos los interruptores)
 * @see PLAN_DE_REFACTOR_POR_CUARTOS.md §3 (construir el cuarto crítico)
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §4 (Prohibición #3) · §5 (espejo de limpieza)
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useContextoDeVenta,
  VALOR_INICIAL_VENTA,
} from './useContextoDeVenta.js';
import { FORBIDDEN_KEYS } from '../state/sessionReset.js';

// ─── Utilidad: "ensuciar" el cuarto con una venta en curso ───────────────────
// Simula el estado real tras capturar una cuenta: ticket abierto, selector en
// PEDIDO, bloque de pedido, aviso pendiente, cliente identificado y overlays
// abiertos. Es el escenario EXACTO que produjo la cicatriz F12.32.
function ensuciarElCuarto(result) {
  act(() => {
    result.current.setTicketId('T-123');
    result.current.setTipoPedido('PEDIDO');
    result.current.setBloquePedido({ fecha: '2026-10-14T10:00', packaging_type: 'CAJA' });
    result.current.setAvisoPedidoSinProgramar({ accion: 'ENVIAR' });
    result.current.setCliente({ id: 7, nombre: 'Ana' });
    result.current.setCheckoutAbierto(true);
    result.current.setTicketAbierto(true);
    result.current.setClienteAbierto(true);
    result.current.setEntregaAbierta(true);
  });
  // Refs: se ensucian a mano (son espejos que los callbacks async leen).
  result.current.ticketIdRef.current = 'T-123';
  result.current.enviarCuentaRef.current = () => {};
}

describe('P1 — useContextoDeVenta: cerrar() apaga TODO el cuarto', () => {
  // ── 1. El efecto central: TODOS los estados de venta vuelven a su inicial ──
  it('cerrar() resetea TODOS los estados de venta a su valor inicial canónico', () => {
    const { result } = renderHook(() => useContextoDeVenta());

    ensuciarElCuarto(result);

    // Precondición: el cuarto está "sucio" (si no, el test sería vacío).
    expect(result.current.ticketId).toBe('T-123');
    expect(result.current.tipoPedido).toBe('PEDIDO');
    expect(result.current.bloquePedido).not.toBeNull();
    expect(result.current.checkoutAbierto).toBe(true);

    act(() => {
      result.current.cerrar();
    });

    // Postcondición: cada interruptor de venta apagado, uno por uno.
    // Se enumeran EXPLÍCITAMENTE (no un bucle sobre VALOR_INICIAL_VENTA) para
    // que el test falle si alguien AGREGA un estado de venta y olvida cerrarlo.
    expect(result.current.ticketId).toBe(VALOR_INICIAL_VENTA.ticketId);
    expect(result.current.tipoPedido).toBe(VALOR_INICIAL_VENTA.tipoPedido);
    expect(result.current.bloquePedido).toBe(VALOR_INICIAL_VENTA.bloquePedido);
    expect(result.current.avisoPedidoSinProgramar).toBe(
      VALOR_INICIAL_VENTA.avisoPedidoSinProgramar,
    );
    expect(result.current.cliente).toBe(VALOR_INICIAL_VENTA.cliente);
    expect(result.current.checkoutAbierto).toBe(VALOR_INICIAL_VENTA.checkoutAbierto);
    expect(result.current.ticketAbierto).toBe(VALOR_INICIAL_VENTA.ticketAbierto);
    expect(result.current.clienteAbierto).toBe(VALOR_INICIAL_VENTA.clienteAbierto);
    expect(result.current.entregaAbierta).toBe(VALOR_INICIAL_VENTA.entregaAbierta);
  });

  // ── 2. La cicatriz F12.32: el selector NO puede quedarse en PEDIDO ─────────
  it('cerrar() devuelve el selector a VENTA_DIRECTA y borra el bloque (cicatriz F12.32)', () => {
    const { result } = renderHook(() => useContextoDeVenta());

    act(() => {
      result.current.setTipoPedido('PEDIDO');
      result.current.setBloquePedido({ fecha: '2026-10-14T10:00' });
    });

    act(() => {
      result.current.cerrar();
    });

    // La cuenta siguiente nace LIMPIA: sin selector mintiendo, sin bloque pegado.
    expect(result.current.tipoPedido).toBe('VENTA_DIRECTA');
    expect(result.current.bloquePedido).toBeNull();
  });

  // ── 3. Los REFS también se apagan (Regla 19, espejo de limpieza) ───────────
  it('cerrar() resetea los refs de venta vía sessionReset.js (no a mano)', () => {
    const { result } = renderHook(() => useContextoDeVenta());

    ensuciarElCuarto(result);
    expect(result.current.ticketIdRef.current).toBe('T-123');
    expect(result.current.enviarCuentaRef.current).not.toBeNull();

    act(() => {
      result.current.cerrar();
    });

    // Un ref huérfano es la "cuenta fantasma": el ticket viejo reaparece.
    expect(result.current.ticketIdRef.current).toBeNull();
    expect(result.current.enviarCuentaRef.current).toBeNull();
  });

  // ── 4. `productosRef` NO se resetea: es espejo del CATÁLOGO ────────────────
  it('cerrar() NO toca productosRef (espejo del catálogo, FORBIDDEN_KEYS)', () => {
    const { result } = renderHook(() => useContextoDeVenta());

    const catalogo = [{ id: 1, name: 'Concha', sku: 'CON-01' }];
    result.current.productosRef.current = catalogo;

    act(() => {
      result.current.cerrar();
    });

    // El catálogo sobrevive entre cuentas: resetearlo forzaría una recarga.
    expect(result.current.productosRef.current).toBe(catalogo);
  });

  // ── 5. Compuerta de diseño: el cuarto NO puede resetear FORBIDDEN_KEYS ─────
  it('VALOR_INICIAL_VENTA no contiene NINGUNA clave de FORBIDDEN_KEYS', () => {
    // Si alguien mete `productos`/`sesion`/`error` al cuarto, este test falla
    // ANTES de que `buildResetPatch` lance TypeError en producción.
    for (const clave of Object.keys(VALOR_INICIAL_VENTA)) {
      expect(FORBIDDEN_KEYS).not.toContain(clave);
    }
  });

  // ── 6. Idempotencia: cerrar dos veces no rompe ni revive nada ─────────────
  it('cerrar() es idempotente: llamarlo dos veces deja el cuarto igual de limpio', () => {
    const { result } = renderHook(() => useContextoDeVenta());

    ensuciarElCuarto(result);

    act(() => {
      result.current.cerrar();
    });
    const trasPrimero = {
      ticketId: result.current.ticketId,
      tipoPedido: result.current.tipoPedido,
      bloquePedido: result.current.bloquePedido,
    };

    act(() => {
      result.current.cerrar();
    });

    expect(result.current.ticketId).toBe(trasPrimero.ticketId);
    expect(result.current.tipoPedido).toBe(trasPrimero.tipoPedido);
    expect(result.current.bloquePedido).toBe(trasPrimero.bloquePedido);
    expect(result.current.ticketIdRef.current).toBeNull();
  });
});
