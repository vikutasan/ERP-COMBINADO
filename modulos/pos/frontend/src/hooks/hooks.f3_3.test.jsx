/**
 * Puerta de FASE 3.3 — Hooks del POS (el corazón).
 *
 * @paridad: hooks/hooks.f3_3.test.jsx
 * @operacion: El escáner de código de barras agrega el producto
 *
 * Verifica los 5 criterios de la puerta (Plan de Abordaje §4 FASE 3.3):
 *
 *   ✓ clearCart solo ocurre tras HTTP 200 + verificación
 *   ✓ callback async lee useRef, no estado cerrado (Ticket #906)
 *   ✓ useTicketActions devuelve { outcome, reason } en toda rama
 *   ✓ simetría de limpieza: éxito y fallo limpian los mismos refs
 *   ✓ useEffect deps son primitivos (H1)
 *
 * Se ejecuta con Vitest (jsdom): npm run test (en apps/pos)
 *
 * 29 Sep 2026.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCart } from './useCart.js';
import { useTicketActions } from './useTicketActions.js';
import { useTerminalLocking } from './useTerminalLocking.js';
import { useBarcodeScanner, esObjetivoEditable } from './useBarcodeScanner.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 1 — clearCart solo tras HTTP 200 + verificación post-envío
// ═══════════════════════════════════════════════════════════════════════════════

describe('useCart — clearCart solo tras verificación', () => {
  it('NO limpia el carrito si la verificación reporta faltantes', async () => {
    const api = {
      anadirItem: vi.fn(async () => ({ version: 2 })),
      verificarEnvio: vi.fn(async () => ({
        existe: true,
        item_ids_persistidos: [],
        faltantes: ['item-1'],
      })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 1 }));

    await act(async () => {
      await result.current.anadirLinea({ item_id: 'item-1', product_id: 'P1', quantity: 1 });
    });

    let salida;
    await act(async () => {
      salida = await result.current.clearCart();
    });

    expect(salida.outcome).toBe('error');
    expect(salida.reason).toBe('items_no_persistidos');
    // El carrito NO se limpió.
    expect(result.current.lineas.length).toBe(1);
  });

  it('SÍ limpia el carrito cuando la verificación confirma todo persistido', async () => {
    const api = {
      anadirItem: vi.fn(async () => ({ version: 2 })),
      verificarEnvio: vi.fn(async () => ({
        existe: true,
        item_ids_persistidos: ['item-1'],
        faltantes: [],
      })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 1 }));

    await act(async () => {
      await result.current.anadirLinea({ item_id: 'item-1', product_id: 'P1', quantity: 1 });
    });

    let salida;
    await act(async () => {
      salida = await result.current.clearCart();
    });

    expect(salida.outcome).toBe('ok');
    expect(salida.data.verificado).toBe(true);
    expect(result.current.lineas.length).toBe(0);
  });

  it('NO limpia si la verificación falla (red caída)', async () => {
    const api = {
      anadirItem: vi.fn(async () => ({ version: 2 })),
      verificarEnvio: vi.fn(async () => {
        throw new Error('timeout');
      }),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 1 }));

    await act(async () => {
      await result.current.anadirLinea({ item_id: 'item-1', product_id: 'P1', quantity: 1 });
    });

    let salida;
    await act(async () => {
      salida = await result.current.clearCart();
    });

    expect(salida.outcome).toBe('error');
    expect(result.current.lineas.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 2 — callback async lee useRef, no estado cerrado (Ticket #906)
// ═══════════════════════════════════════════════════════════════════════════════

describe('useCart — el callback async lee useRef (Ticket #906)', () => {
  it('clearCart ve las líneas añadidas DESPUÉS de crear el callback', async () => {
    const api = {
      anadirItem: vi.fn(async () => ({ version: 2 })),
      verificarEnvio: vi.fn(async (_t, cuerpo) => ({
        existe: true,
        item_ids_persistidos: cuerpo.item_ids,
        faltantes: [],
      })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 1 }));

    // Se añade una línea DESPUÉS de que el hook montó (el callback ya existía).
    await act(async () => {
      await result.current.anadirLinea({ item_id: 'item-9', product_id: 'P9', quantity: 1 });
    });

    await act(async () => {
      await result.current.clearCart();
    });

    // La verificación recibió el item_id real, no un estado cerrado vacío.
    // BUG-07 — también viajan las CANTIDADES (contrato 22 verifica por unidades).
    expect(api.verificarEnvio).toHaveBeenCalledWith('T1', {
      item_ids: ['item-9'],
      cantidades: [1],
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 3 — useTicketActions devuelve { outcome, reason } en toda rama
// ═══════════════════════════════════════════════════════════════════════════════

describe('useTicketActions — contrato { outcome, reason }', () => {
  it('devuelve { outcome, reason } cuando no hay API', async () => {
    const { result } = renderHook(() => useTicketActions({ api: null }));

    let salida;
    await act(async () => {
      salida = await result.current.crearTicket([{ product_id: 'P1', quantity: 1 }]);
    });

    expect(salida).toHaveProperty('outcome');
    expect(salida).toHaveProperty('reason');
    expect(salida.outcome).toBe('error');
    expect(salida.reason).toBe('api_no_disponible');
  });

  it('devuelve { outcome:"ok", reason:null } cuando la API responde', async () => {
    const api = {
      crearVenta: vi.fn(async () => ({ id: 'T1', version: 1, total: 10 })),
    };
    const { result } = renderHook(() => useTicketActions({ api }));

    let salida;
    await act(async () => {
      salida = await result.current.crearTicket([{ product_id: 'P1', quantity: 1 }]);
    });

    expect(salida.outcome).toBe('ok');
    expect(salida.reason).toBeNull();
  });

  it('NUNCA lanza: convierte un rechazo en { outcome:"error" }', async () => {
    const api = {
      crearVenta: vi.fn(async () => {
        throw new Error('500 del servidor');
      }),
    };
    const { result } = renderHook(() => useTicketActions({ api }));

    let salida;
    await act(async () => {
      salida = await result.current.crearTicket([{ product_id: 'P1', quantity: 1 }]);
    });

    expect(salida.outcome).toBe('error');
    expect(typeof salida.reason).toBe('string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 4 — simetría de limpieza: éxito y fallo limpian los mismos refs
// ═══════════════════════════════════════════════════════════════════════════════

describe('useTicketActions — simetría de limpieza (Regla 19)', () => {
  it('el fallo deja el ticket en null (misma limpieza que el éxito)', async () => {
    const api = {
      crearVenta: vi.fn(async () => {
        throw new Error('fallo');
      }),
    };
    const { result } = renderHook(() => useTicketActions({ api }));

    await act(async () => {
      await result.current.crearTicket([{ product_id: 'P1', quantity: 1 }]);
    });

    // Tras un fallo, no queda un ticket huérfano (cuenta fantasma).
    expect(result.current.ticket).toBeNull();
    expect(result.current.enviando).toBe(false);
  });

  it('el éxito deja el ticket y enviando=false', async () => {
    const api = {
      crearVenta: vi.fn(async () => ({ id: 'T1', version: 1, total: 10 })),
    };
    const { result } = renderHook(() => useTicketActions({ api }));

    await act(async () => {
      await result.current.crearTicket([{ product_id: 'P1', quantity: 1 }]);
    });

    expect(result.current.ticket).not.toBeNull();
    expect(result.current.enviando).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FIX "confirmar pago no hace nada" (2ª vuelta, 7 Oct 2026) — REGRESIÓN
//
// CAUSA REAL: `cobrar` leía `ticketRef.current`, que SOLO se puebla cuando
// `crearTicket`/`cobrar` corren DENTRO de este hook. Pero en el flujo real el
// ticket lo crea `asegurarTicket` (al añadir el 1er ítem) o lo adopta
// `recuperarCuentaAlCarrito` (pizarrón): el id vive en `RetailVisionPOS`, NO
// aquí. Al cobrar una cuenta YA ABIERTA, `ticketRef.current` era `null` y
// `cobrar` devolvía `sin_ticket_o_api` en silencio → el botón "no hacía nada".
//
// La corrección: `cobrar(paymentDetails, { ticketId, version })` acepta el id
// EXPLÍCITO del llamador y cae al ref interno solo por retrocompatibilidad.
// ═══════════════════════════════════════════════════════════════════════════════

describe('useTicketActions — cobrar con ticketId explícito (FIX 2ª vuelta)', () => {
  it('cobra una cuenta YA ABIERTA aunque ticketRef esté vacío (sin crearTicket previo)', async () => {
    const api = {
      cobrarTicket: vi.fn(async () => ({ id: 'T-ABIERTA', version: 5, total: 100 })),
    };
    // NO se llama crearTicket: el ref interno queda null (cuenta creada fuera).
    const { result } = renderHook(() => useTicketActions({ api }));

    let salida;
    await act(async () => {
      salida = await result.current.cobrar(
        { pagos: [{ metodo: 'efectivo', monto: 100 }] },
        { ticketId: 'T-ABIERTA', version: 4 },
      );
    });

    // Antes del fix: { outcome:'error', reason:'sin_ticket_o_api' }.
    expect(salida.outcome).toBe('ok');
    expect(api.cobrarTicket).toHaveBeenCalledWith('T-ABIERTA', {
      payment_details: { pagos: [{ metodo: 'efectivo', monto: 100 }] },
      version: 4,
    });
  });

  it('usa la version del llamador (no la del ticket hidratado)', async () => {
    const api = {
      cobrarTicket: vi.fn(async () => ({ id: 'T1', version: 9, total: 50 })),
    };
    const { result } = renderHook(() => useTicketActions({ api }));

    await act(async () => {
      await result.current.cobrar({ pagos: [] }, { ticketId: 'T1', version: 7 });
    });

    expect(api.cobrarTicket).toHaveBeenCalledWith('T1', {
      payment_details: { pagos: [] },
      version: 7,
    });
  });

  it('sin ticketId explícito NI ticket hidratado sigue devolviendo sin_ticket_o_api', async () => {
    const api = { cobrarTicket: vi.fn(async () => ({ id: 'T1', version: 1 })) };
    const { result } = renderHook(() => useTicketActions({ api }));

    let salida;
    await act(async () => {
      salida = await result.current.cobrar({ pagos: [] });
    });

    expect(salida.outcome).toBe('error');
    expect(salida.reason).toBe('sin_ticket_o_api');
    expect(api.cobrarTicket).not.toHaveBeenCalled();
  });

  it('retrocompatibilidad: sin opciones usa el ticket hidratado por crearTicket', async () => {
    const api = {
      crearVenta: vi.fn(async () => ({ id: 'T-HIDRATADO', version: 3, total: 10 })),
      cobrarTicket: vi.fn(async () => ({ id: 'T-HIDRATADO', version: 4, total: 10 })),
    };
    const { result } = renderHook(() => useTicketActions({ api }));

    await act(async () => {
      await result.current.crearTicket([{ product_id: 'P1', quantity: 1 }]);
    });

    await act(async () => {
      await result.current.cobrar({ pagos: [] });
    });

    expect(api.cobrarTicket).toHaveBeenCalledWith('T-HIDRATADO', {
      payment_details: { pagos: [] },
      version: 3,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG-08 — El turno de caja lo determina la terminal que COBRA
// ═══════════════════════════════════════════════════════════════════════════════
//
// "Toda terminal es una caja en potencia": una terminal con turno abierto puede
// cobrar cuentas de OTRAS terminales, y el dinero se cuenta en la caja que lo
// recibió (RN-53). El frontend declara el turno de la terminal que cobra
// (`cashSessionId`); el backend lo VALIDA (E-13) y NUNCA sobreescribe el
// `terminal_id` del ticket (RN-12). Si no se declara, el backend cae al
// comportamiento retrocompatible (turno de la terminal del ticket).

describe('useTicketActions — cobrar declara el turno de la terminal que cobra (BUG-08)', () => {
  it('reenvía cash_session_id cuando el llamador lo declara', async () => {
    const api = {
      cobrarTicket: vi.fn(async () => ({ id: 'T-AJENA', version: 6, total: 80 })),
    };
    const { result } = renderHook(() => useTicketActions({ api }));

    let salida;
    await act(async () => {
      salida = await result.current.cobrar(
        { pagos: [{ metodo: 'efectivo', monto: 80 }] },
        { ticketId: 'T-AJENA', version: 5, cashSessionId: 'CAJA-9' },
      );
    });

    expect(salida.outcome).toBe('ok');
    expect(api.cobrarTicket).toHaveBeenCalledWith('T-AJENA', {
      payment_details: { pagos: [{ metodo: 'efectivo', monto: 80 }] },
      version: 5,
      cash_session_id: 'CAJA-9',
    });
  });

  it('NO incluye cash_session_id si el llamador no lo declara (retrocompatibilidad)', async () => {
    const api = {
      cobrarTicket: vi.fn(async () => ({ id: 'T1', version: 2, total: 10 })),
    };
    const { result } = renderHook(() => useTicketActions({ api }));

    await act(async () => {
      await result.current.cobrar({ pagos: [] }, { ticketId: 'T1', version: 1 });
    });

    // El cuerpo NO debe llevar la clave: el backend cae al turno del ticket.
    const [, cuerpo] = api.cobrarTicket.mock.calls[0];
    expect(cuerpo).toEqual({ payment_details: { pagos: [] }, version: 1 });
    expect('cash_session_id' in cuerpo).toBe(false);
  });

  it('NO incluye cash_session_id si viene null (sin turno vigente)', async () => {
    const api = {
      cobrarTicket: vi.fn(async () => ({ id: 'T1', version: 2, total: 10 })),
    };
    const { result } = renderHook(() => useTicketActions({ api }));

    await act(async () => {
      await result.current.cobrar(
        { pagos: [] },
        { ticketId: 'T1', version: 1, cashSessionId: null },
      );
    });

    const [, cuerpo] = api.cobrarTicket.mock.calls[0];
    expect('cash_session_id' in cuerpo).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 5 — useEffect deps son primitivos (H1)
// ═══════════════════════════════════════════════════════════════════════════════

describe('H1 — los hooks no re-registran listeners por objetos recreados', () => {
  it('useBarcodeScanner NO re-registra el listener si el callback cambia de identidad', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { rerender } = renderHook(
      ({ cb }) => useBarcodeScanner({ alEscanear: cb }),
      { initialProps: { cb: () => {} } }
    );

    const altasIniciales = addSpy.mock.calls.filter(([t]) => t === 'keydown').length;

    // Re-render con un callback NUEVO (identidad distinta) pero mismas deps primitivas.
    rerender({ cb: () => {} });

    const altasFinales = addSpy.mock.calls.filter(([t]) => t === 'keydown').length;
    // No se volvió a registrar: el callback vive en un ref (prohibición #3).
    expect(altasFinales).toBe(altasIniciales);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('useTerminalLocking late solo cuando el lock está tomado', async () => {
    vi.useFakeTimers();
    const api = {
      tomarLock: vi.fn(async () => ({ ok: true })),
      latir: vi.fn(async () => ({ ok: true })),
      liberarLock: vi.fn(async () => ({ ok: true })),
    };

    const { result } = renderHook(() =>
      useTerminalLocking({ api, terminalId: 'TERM-1', usuarioId: 'U1', intervaloMs: 1000 })
    );

    // Sin lock tomado, no hay latidos.
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(api.latir).not.toHaveBeenCalled();

    // Toma el lock → empiezan los latidos.
    await act(async () => {
      await result.current.tomarLock();
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(api.latir).toHaveBeenCalled();

    vi.useRealTimers();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Extra — useBarcodeScanner entrega el código al recibir Enter
// ═══════════════════════════════════════════════════════════════════════════════

describe('useBarcodeScanner — entrega el código completo', () => {
  it('acumula caracteres rápidos y entrega al Enter', () => {
    const alEscanear = vi.fn();
    renderHook(() => useBarcodeScanner({ alEscanear, umbralMs: 1000 }));

    act(() => {
      for (const ch of 'ABC123') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ch }));
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });

    expect(alEscanear).toHaveBeenCalledWith('ABC123');
  });

  it('ignora códigos demasiado cortos', () => {
    const alEscanear = vi.fn();
    renderHook(() => useBarcodeScanner({ alEscanear, umbralMs: 1000, longitudMinima: 3 }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });

    expect(alEscanear).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F12.31 — el lector NO debe "comer" lo que el operador teclea en un campo
// editable (BUG-12: el modal "Entrega del ticket" no dejaba teclear teléfono
// ni correo). El listener global de `window` acumulaba esos caracteres y, al
// pulsar Enter, disparaba `alEscanear` con basura, robando el foco.
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.31 — useBarcodeScanner ignora lo tecleado en campos editables', () => {
  it('NO entrega el código si los caracteres se teclean dentro de un <input>', () => {
    const alEscanear = vi.fn();
    renderHook(() => useBarcodeScanner({ alEscanear, umbralMs: 1000 }));

    const input = document.createElement('input');
    input.type = 'tel';
    document.body.appendChild(input);

    act(() => {
      for (const ch of '5512345678') {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      }
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(alEscanear).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('NO entrega el código si los caracteres se teclean dentro de un <textarea>', () => {
    const alEscanear = vi.fn();
    renderHook(() => useBarcodeScanner({ alEscanear, umbralMs: 1000 }));

    const area = document.createElement('textarea');
    document.body.appendChild(area);

    act(() => {
      for (const ch of 'ABC123') {
        area.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      }
      area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(alEscanear).not.toHaveBeenCalled();
    document.body.removeChild(area);
  });

  it('NO entrega el código si los caracteres se teclean dentro de un <select>', () => {
    const alEscanear = vi.fn();
    renderHook(() => useBarcodeScanner({ alEscanear, umbralMs: 1000 }));

    const select = document.createElement('select');
    document.body.appendChild(select);

    act(() => {
      for (const ch of 'ABC123') {
        select.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      }
      select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(alEscanear).not.toHaveBeenCalled();
    document.body.removeChild(select);
  });

  it('SÍ entrega el código cuando el evento nace en el body (lector real)', () => {
    const alEscanear = vi.fn();
    renderHook(() => useBarcodeScanner({ alEscanear, umbralMs: 1000 }));

    act(() => {
      for (const ch of 'ABC123') {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      }
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(alEscanear).toHaveBeenCalledWith('ABC123');
  });

  it('esObjetivoEditable reconoce input/textarea/select y rechaza el resto', () => {
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const select = document.createElement('select');
    const div = document.createElement('div');

    expect(esObjetivoEditable(input)).toBe(true);
    expect(esObjetivoEditable(area)).toBe(true);
    expect(esObjetivoEditable(select)).toBe(true);
    expect(esObjetivoEditable(div)).toBe(false);
    expect(esObjetivoEditable(null)).toBe(false);
    expect(esObjetivoEditable(undefined)).toBe(false);
    expect(esObjetivoEditable(window)).toBe(false);
  });

  it('esObjetivoEditable reconoce un elemento contenteditable', () => {
    const editable = document.createElement('div');
    // jsdom no implementa `isContentEditable`; se simula el contrato del DOM.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(esObjetivoEditable(editable)).toBe(true);
  });
});
