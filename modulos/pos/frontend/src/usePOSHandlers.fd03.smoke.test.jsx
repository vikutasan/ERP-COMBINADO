/**
 * Smoke test FD-03 (1/3) — usePOSHandlers exporta los callbacks documentados.
 *
 * Verifica la FIRMA del hook refactorizado: que los 22+ callbacks esperados
 * existen y son funciones. NO prueba comportamiento — eso lo cubren los
 * tests de integración de RetailVisionPOS.
 *
 * Sin mocks de API: el hook solo necesita stubs básicos para ser instanciado.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePOSHandlers } from './hooks/usePOSHandlers.js';

// Stubs mínimos — el hook no llama a la API en el montaje.
function stubs() {
  const carrito = {
    lineas: [], total: 0, version: 1,
    anadirLinea: vi.fn(), quitarLinea: vi.fn(),
    cambiarCantidad: vi.fn(), clearCart: vi.fn(), hidratarLineas: vi.fn(),
  };
  const acciones = {
    crearTicket: vi.fn(), cobrar: vi.fn(), limpiarTicket: vi.fn(),
    ticket: null, enviando: false,
  };
  return {
    carrito,
    ticketId: null, ticketIdRef: { current: null }, enviarCuentaRef: { current: null },
    setTicketId: vi.fn(), tipoPedido: 'VENTA_DIRECTA', setTipoPedido: vi.fn(),
    bloquePedido: null, setBloquePedido: vi.fn(),
    avisoPedidoSinProgramar: null, setAvisoPedidoSinProgramar: vi.fn(),
    cliente: null, setCliente: vi.fn(),
    venta: { cerrar: vi.fn() },
    setCheckoutAbierto: vi.fn(), setAvisoEmpaque: vi.fn(),
    setSalidaAbierta: vi.fn(), setPedidoAbierto: vi.fn(),
    acciones, productos: [], productosRef: { current: [] },
    turnoCaja: null, setTurnoCaja: vi.fn(), politicaPagoPedido: 0,
    refrescarConteoCuentas: vi.fn(), setRefrescarSenal: vi.fn(), setPizarronAbierto: vi.fn(),
    terminalEfectiva: 'TERM-01', setBanner: vi.fn(), setError: vi.fn(),
    setExportandoPDF: vi.fn(), setSelectorPDFAbierto: vi.fn(),
    setCajaAbierta: vi.fn(), setAvisoCaja: vi.fn(),
    onBackToTerminals: vi.fn(),
  };
}

describe('FD-03 (1/3) — usePOSHandlers: firma del hook', () => {
  it('es una función exportada', () => {
    expect(typeof usePOSHandlers).toBe('function');
  });

  it('exporta los callbacks de carrito', () => {
    const { result } = renderHook(() => usePOSHandlers(stubs()));
    const h = result.current;
    expect(typeof h.agregarProducto).toBe('function');
    expect(typeof h.incrementar).toBe('function');
    expect(typeof h.decrementar).toBe('function');
    expect(typeof h.quitar).toBe('function');
    expect(typeof h.cambiarCantidad).toBe('function');
  });

  it('exporta los callbacks de persistencia y barcode', () => {
    const { result } = renderHook(() => usePOSHandlers(stubs()));
    const h = result.current;
    expect(typeof h.asegurarTicket).toBe('function');
    expect(typeof h.persistirLinea).toBe('function');
    expect(typeof h.alEscanear).toBe('function');
  });

  it('exporta los callbacks de checkout y guardia de empaque', () => {
    const { result } = renderHook(() => usePOSHandlers(stubs()));
    const h = result.current;
    expect(typeof h.abrirCheckoutConGuardia).toBe('function');
    expect(typeof h.confirmarCobro).toBe('function');
    expect(typeof h.empaqueRequerido).toBe('boolean');
    expect(typeof h.empaqueEnCarrito).toBe('boolean');
  });

  it('exporta los callbacks de pedido', () => {
    const { result } = renderHook(() => usePOSHandlers(stubs()));
    const h = result.current;
    expect(typeof h.guardarPedido).toBe('function');
    expect(typeof h.manejarProgramarDesdeAviso).toBe('function');
    expect(typeof h.manejarEnviarComoVentaDirecta).toBe('function');
  });

  it('exporta los callbacks de pizarrón, salida, PDF e IA', () => {
    const { result } = renderHook(() => usePOSHandlers(stubs()));
    const h = result.current;
    expect(typeof h.recuperarCuentaAlCarrito).toBe('function');
    expect(typeof h.intentarSalir).toBe('function');
    expect(typeof h.salirEnviandoAlPizarron).toBe('function');
    expect(typeof h.salirSinEnviar).toBe('function');
    expect(typeof h.exportarCartaPDF).toBe('function');
    expect(typeof h.aplicarVoz).toBe('function');
    expect(typeof h.aplicarVision).toBe('function');
  });

  it('empaqueRequerido es false cuando no hay bloquePedido', () => {
    const { result } = renderHook(() => usePOSHandlers(stubs()));
    expect(result.current.empaqueRequerido).toBe(false);
    expect(result.current.empaqueEnCarrito).toBe(false);
  });
});
