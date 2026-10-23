/**
 * Puerta de FASE 12.17 — Auto-heal del 409 en las acciones de línea.
 *
 * @paridad: hooks/useCart.f12_17.test.jsx
 * @operacion: El reintento de operaciones de red (withRetries) con auto-heal del 409
 *
 * BUG runtime (reportado por el dueño: "entré al POS y el bug aún continúa"):
 *
 *   Al pulsar dos productos seguidos (o producto + escáner), dos llamadas
 *   concurrentes a `anadirLinea` leían el MISMO `versionRef.current` antes de
 *   que ninguna confirmara. La primera avanzaba la versión en el servidor
 *   (v0 → v1); la segunda enviaba la versión obsoleta (v0) y recibía 409.
 *
 *   Como `anadirLinea` NO filtraba los errores de negocio en `withRetries`
 *   (REGLA 18), el 409 se reintentaba 3× con la MISMA versión obsoleta → 3×
 *   más 409. El ítem NUNCA se persistía. El ledger de idempotencia quedaba
 *   vacío, `verificar_envio` marcaba TODOS los ítems como `faltantes` y el
 *   carrito no se limpiaba → modal "No se pudo enviar: hay productos sin
 *   guardar en el servidor. Verifique la conexión WiFi."
 *
 * El fix (F12.17) replica el patrón de auto-heal de `cobrar` (F12.12):
 *   1. `debeReintentar` NO reintenta errores de negocio (409).
 *   2. Ante un 409, se descarga la versión fresca (`leerTicket`, contrato 21)
 *      y se reintenta UNA vez con la versión sincronizada.
 *
 * Criterios de la puerta:
 *   ✓ un 409 NO se reintenta con la versión obsoleta (se corta de inmediato)
 *   ✓ ante un 409, se descarga la versión fresca y se reintenta con ella
 *   ✓ tras el auto-heal, la línea queda persistida (versión sincronizada)
 *   ✓ si el auto-heal no puede leer la versión, NO se reintenta a ciegas
 *   ✓ `cambiarCantidad` y `quitarLinea` tienen el mismo comportamiento
 *
 * Se ejecuta con Vitest (jsdom): npm run test (en apps/pos)
 *
 * 6 Oct 2026.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCart } from './useCart.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Utilidad — construye un ApiError con código HTTP (como el cliente real)
// ═══════════════════════════════════════════════════════════════════════════════

function errorHttp(codigo, mensaje) {
  const err = new Error(mensaje);
  err.codigo = codigo;
  err.detalle = { mensaje };
  return err;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 1 — un 409 NO se reintenta con la versión obsoleta
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.17 — anadirLinea: el 409 no se reintenta a ciegas', () => {
  it('un 409 se corta de inmediato (no 3 reintentos con la misma versión)', async () => {
    // El servidor SIEMPRE responde 409 (versión obsoleta).
    const api = {
      anadirItem: vi.fn(async () => {
        throw errorHttp(409, 'conflicto de versión');
      }),
      // El auto-heal intenta leer la versión fresca; aquí también falla.
      leerTicket: vi.fn(async () => {
        throw errorHttp(500, 'sin lectura');
      }),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    await act(async () => {
      await result.current.anadirLinea({ item_id: 'item-1', product_id: 'P1', quantity: 1 });
    });

    // Sin el fix, `withRetries` haría 3 intentos. Con el fix, 1 solo.
    expect(api.anadirItem).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 2 — ante un 409, se descarga la versión fresca y se reintenta
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.17 — anadirLinea: auto-heal del 409', () => {
  it('descarga la versión fresca y reintenta con ella (la línea queda persistida)', async () => {
    // 1er intento: 409 (versión obsoleta v0). 2º intento: éxito con v1.
    const api = {
      anadirItem: vi
        .fn()
        .mockRejectedValueOnce(errorHttp(409, 'conflicto de versión'))
        .mockResolvedValueOnce({ version: 1 }),
      leerTicket: vi.fn(async () => ({ version: 1 })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    let salida;
    await act(async () => {
      salida = await result.current.anadirLinea({
        item_id: 'item-1',
        product_id: 'P1',
        quantity: 1,
      });
    });

    // El auto-heal leyó la versión fresca.
    expect(api.leerTicket).toHaveBeenCalledWith('T1');
    // Se reintentó UNA vez con la versión fresca (v1), no con la obsoleta (v0).
    expect(api.anadirItem).toHaveBeenCalledTimes(2);
    expect(api.anadirItem.mock.calls[1][1].version).toBe(1);
    // El resultado es OK: la línea quedó persistida.
    expect(salida.outcome).toBe('ok');
    expect(salida.data.version).toBe(1);
  });

  it('tras el auto-heal, la versión local queda sincronizada (v1)', async () => {
    const api = {
      anadirItem: vi
        .fn()
        .mockRejectedValueOnce(errorHttp(409, 'conflicto de versión'))
        .mockResolvedValueOnce({ version: 1 }),
      leerTicket: vi.fn(async () => ({ version: 1 })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    await act(async () => {
      await result.current.anadirLinea({ item_id: 'item-1', product_id: 'P1', quantity: 1 });
    });

    // La siguiente escritura debe usar la versión sincronizada (v1), no v0.
    api.anadirItem.mockResolvedValueOnce({ version: 2 });
    await act(async () => {
      await result.current.anadirLinea({ item_id: 'item-2', product_id: 'P2', quantity: 1 });
    });

    const ultimaLlamada = api.anadirItem.mock.calls.at(-1);
    expect(ultimaLlamada[1].version).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 3 — si el auto-heal no puede leer la versión, NO reintenta a ciegas
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.17 — anadirLinea: sin lectura fresca, no reintenta', () => {
  it('si leerTicket falla, no se reintenta el 409 (evita el bucle)', async () => {
    const api = {
      anadirItem: vi.fn(async () => {
        throw errorHttp(409, 'conflicto de versión');
      }),
      leerTicket: vi.fn(async () => {
        throw errorHttp(500, 'sin lectura');
      }),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    let salida;
    await act(async () => {
      salida = await result.current.anadirLinea({
        item_id: 'item-1',
        product_id: 'P1',
        quantity: 1,
      });
    });

    // Solo el intento original; el auto-heal no pudo leer → no reintenta.
    expect(api.anadirItem).toHaveBeenCalledTimes(1);
    expect(salida.outcome).toBe('error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 4 — cambiarCantidad y quitarLinea tienen el mismo comportamiento
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.17 — cambiarCantidad: auto-heal del 409', () => {
  it('descarga la versión fresca y reintenta con ella', async () => {
    const api = {
      anadirItem: vi.fn(async () => ({ version: 1 })),
      cambiarCantidad: vi
        .fn()
        .mockRejectedValueOnce(errorHttp(409, 'conflicto de versión'))
        .mockResolvedValueOnce({ version: 2 }),
      leerTicket: vi.fn(async () => ({ version: 1 })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    await act(async () => {
      await result.current.anadirLinea({ item_id: 'item-1', product_id: 'P1', quantity: 1 });
    });

    let salida;
    await act(async () => {
      salida = await result.current.cambiarCantidad('item-1', 3);
    });

    expect(api.cambiarCantidad).toHaveBeenCalledTimes(2);
    expect(api.cambiarCantidad.mock.calls[1][2].version).toBe(1);
    expect(salida.outcome).toBe('ok');
  });

  it('un 409 sin lectura fresca no se reintenta', async () => {
    const api = {
      cambiarCantidad: vi.fn(async () => {
        throw errorHttp(409, 'conflicto de versión');
      }),
      leerTicket: vi.fn(async () => {
        throw errorHttp(500, 'sin lectura');
      }),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    await act(async () => {
      await result.current.cambiarCantidad('item-1', 3);
    });

    expect(api.cambiarCantidad).toHaveBeenCalledTimes(1);
  });
});

describe('F12.17 — quitarLinea: auto-heal del 409', () => {
  it('descarga la versión fresca y reintenta con ella', async () => {
    const api = {
      anadirItem: vi.fn(async () => ({ version: 1 })),
      quitarItem: vi
        .fn()
        .mockRejectedValueOnce(errorHttp(409, 'conflicto de versión'))
        .mockResolvedValueOnce({ version: 2 }),
      leerTicket: vi.fn(async () => ({ version: 1 })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    await act(async () => {
      await result.current.anadirLinea({ item_id: 'item-1', product_id: 'P1', quantity: 1 });
    });

    let salida;
    await act(async () => {
      salida = await result.current.quitarLinea('item-1');
    });

    expect(api.quitarItem).toHaveBeenCalledTimes(2);
    expect(api.quitarItem.mock.calls[1][2].version).toBe(1);
    expect(salida.outcome).toBe('ok');
  });

  it('un 409 sin lectura fresca no se reintenta', async () => {
    const api = {
      quitarItem: vi.fn(async () => {
        throw errorHttp(409, 'conflicto de versión');
      }),
      leerTicket: vi.fn(async () => {
        throw errorHttp(500, 'sin lectura');
      }),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    await act(async () => {
      await result.current.quitarLinea('item-1');
    });

    expect(api.quitarItem).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 5 — el bug de producción: 2 añadidos concurrentes no dejan el
//              carrito sin persistir (el ledger queda completo)
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.17 — 2 añadidos concurrentes no dejan el carrito sin persistir', () => {
  it('el segundo añadido se auto-cura y el ledger queda completo', async () => {
    // Simula el servidor real: mantiene una versión y un ledger de item_ids.
    let versionServidor = 0;
    const ledger = new Set();

    const api = {
      anadirItem: vi.fn(async (_ticketId, cuerpo) => {
        if (cuerpo.version !== versionServidor) {
          throw errorHttp(409, 'conflicto de versión');
        }
        versionServidor += 1;
        ledger.add(cuerpo.item_id);
        return { version: versionServidor };
      }),
      leerTicket: vi.fn(async () => ({ version: versionServidor })),
      verificarEnvio: vi.fn(async (_ticketId, cuerpo) => ({
        existe: true,
        item_ids_persistidos: [...ledger],
        faltantes: cuerpo.item_ids.filter((id) => !ledger.has(id)),
      })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    // Dos añadidos concurrentes (dos clics rápidos). Ambos leen v0.
    await act(async () => {
      await Promise.all([
        result.current.anadirLinea({ item_id: 'item-1', product_id: 'P1', quantity: 1 }),
        result.current.anadirLinea({ item_id: 'item-2', product_id: 'P2', quantity: 1 }),
      ]);
    });

    // El ledger del servidor debe tener AMBOS ítems (el 2º se auto-curó).
    expect(ledger.has('item-1')).toBe(true);
    expect(ledger.has('item-2')).toBe(true);

    // La verificación post-envío NO reporta faltantes → el carrito SÍ se limpia.
    let salida;
    await act(async () => {
      salida = await result.current.clearCart();
    });

    expect(salida.outcome).toBe('ok');
    expect(salida.data.verificado).toBe(true);
    expect(result.current.lineas.length).toBe(0);
  });
});
