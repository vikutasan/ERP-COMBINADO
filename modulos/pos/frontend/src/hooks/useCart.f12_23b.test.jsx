/**
 * Puerta de FASE 12.23b — Fusión por producto (paridad RN-17 con el POS viejo).
 *
 * @paridad: hooks/useCart.f12_23b.test.jsx
 * @operacion: RN-17: un producto aparece UNA vez; re-agregar incrementa la cantidad (fusión por id)
 *
 * @paridad: hooks/useCart.f12_23b.test.jsx
 * @operacion: RN-17: un producto aparece UNA vez; re-agregar incrementa la cantidad (fusión por id)
 *
 * BUG runtime (reportado por el dueño):
 *
 *   "en el viejo pos si yo doy tap varias veces sobre el mismo producto aumenta
 *    la cantidad pero no me aparece el producto varias veces y en el nuevo pos
 *    si doy tap varias veces al mismo producto, este aparece varias veces con
 *    cantidad 1"
 *
 * El POS viejo fusionaba por `product.id` (`apps/pos/hooks/useCart.js:105`):
 * tocar N veces el mismo producto dejaba UNA línea con `quantity: N`. El POS
 * nuevo fusionaba por `item_id`, pero `agregarProducto` (RetailVisionPOS.jsx)
 * NO pasa `item_id`; `anadirLinea` generaba un UUID nuevo en cada tap, así que
 * el `find` por `item_id` nunca encontraba la línea previa → N líneas de 1.
 *
 * El fix (F12.23b) replica la regla del POS viejo:
 *   1. Si el llamador NO trae `item_id` explícito, se fusiona por `product_id`.
 *   2. Si hay fusión, se reutiliza el `item_id` de la línea existente para que
 *      el SERVIDOR también fusione (contrato 18: mismo `item_id` incrementa).
 *
 * Criterios de la puerta:
 *   ✓ N taps sin `item_id` → UNA sola línea con `quantity: N`
 *   ✓ el `item_id` de la línea fusionada es ESTABLE (no cambia entre taps)
 *   ✓ el servidor recibe el MISMO `item_id` en cada tap (no duplica)
 *   ✓ un `item_id` explícito conserva la ruta por identidad (no se fusiona por producto)
 *   ✓ productos distintos NO se fusionan entre sí
 *
 * Se ejecuta con Vitest (jsdom): npm run test (en apps/pos)
 *
 * 10 Oct 2026.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCart } from './useCart.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 1 — N taps sin `item_id` → UNA sola línea con `quantity: N`
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.23b — anadirLinea fusiona por producto (RN-17)', () => {
  it('tres taps sobre el mismo producto dejan UNA línea con cantidad 3', async () => {
    const api = {
      anadirItem: vi.fn(async () => ({ version: 1 })),
      leerTicket: vi.fn(async () => ({ version: 1 })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    // Tres taps consecutivos sobre el MISMO producto, SIN `item_id`
    // (exactamente lo que hace `agregarProducto` en RetailVisionPOS.jsx).
    await act(async () => {
      await result.current.anadirLinea({ product_id: 'P1', name: 'Concha', quantity: 1, unit_price: 12 });
    });
    await act(async () => {
      await result.current.anadirLinea({ product_id: 'P1', name: 'Concha', quantity: 1, unit_price: 12 });
    });
    await act(async () => {
      await result.current.anadirLinea({ product_id: 'P1', name: 'Concha', quantity: 1, unit_price: 12 });
    });

    // UNA sola línea, con la cantidad acumulada (no tres líneas de 1).
    expect(result.current.lineas).toHaveLength(1);
    expect(result.current.lineas[0].product_id).toBe('P1');
    expect(result.current.lineas[0].quantity).toBe(3);
  });

  it('el `item_id` de la línea fusionada es ESTABLE entre taps', async () => {
    const api = {
      anadirItem: vi.fn(async () => ({ version: 1 })),
      leerTicket: vi.fn(async () => ({ version: 1 })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    await act(async () => {
      await result.current.anadirLinea({ product_id: 'P1', name: 'Concha', quantity: 1, unit_price: 12 });
    });
    const primerItemId = result.current.lineas[0].item_id;

    await act(async () => {
      await result.current.anadirLinea({ product_id: 'P1', name: 'Concha', quantity: 1, unit_price: 12 });
    });

    // La identidad NO se regenera: el servidor ve la misma línea.
    expect(result.current.lineas[0].item_id).toBe(primerItemId);
  });

  it('el servidor recibe el MISMO `item_id` en cada tap (no duplica)', async () => {
    const api = {
      anadirItem: vi.fn(async () => ({ version: 1 })),
      leerTicket: vi.fn(async () => ({ version: 1 })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    await act(async () => {
      await result.current.anadirLinea({ product_id: 'P1', name: 'Concha', quantity: 1, unit_price: 12 });
    });
    await act(async () => {
      await result.current.anadirLinea({ product_id: 'P1', name: 'Concha', quantity: 1, unit_price: 12 });
    });

    // Ambas llamadas al servidor usan el MISMO `item_id` → el backend fusiona
    // (contrato 18) en vez de crear dos filas.
    expect(api.anadirItem).toHaveBeenCalledTimes(2);
    const idPrimero = api.anadirItem.mock.calls[0][1].item_id;
    const idSegundo = api.anadirItem.mock.calls[1][1].item_id;
    expect(idSegundo).toBe(idPrimero);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 2 — un `item_id` explícito conserva la ruta por identidad
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.23b — un `item_id` explícito NO se fusiona por producto', () => {
  it('dos líneas con el mismo producto pero distinto `item_id` coexisten', async () => {
    const api = {
      anadirItem: vi.fn(async () => ({ version: 1 })),
      leerTicket: vi.fn(async () => ({ version: 1 })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    // Dos líneas del MISMO producto con identidad explícita distinta (p. ej.
    // hidratadas del servidor con modificadores distintos): NO se fusionan.
    await act(async () => {
      await result.current.anadirLinea({ item_id: 'item-a', product_id: 'P1', quantity: 1, unit_price: 12 });
    });
    await act(async () => {
      await result.current.anadirLinea({ item_id: 'item-b', product_id: 'P1', quantity: 1, unit_price: 12 });
    });

    expect(result.current.lineas).toHaveLength(2);
    expect(result.current.lineas.map((l) => l.item_id).sort()).toEqual(['item-a', 'item-b']);
  });

  it('repetir el MISMO `item_id` explícito incrementa esa línea', async () => {
    const api = {
      anadirItem: vi.fn(async () => ({ version: 1 })),
      leerTicket: vi.fn(async () => ({ version: 1 })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    await act(async () => {
      await result.current.anadirLinea({ item_id: 'item-a', product_id: 'P1', quantity: 1, unit_price: 12 });
    });
    await act(async () => {
      await result.current.anadirLinea({ item_id: 'item-a', product_id: 'P1', quantity: 2, unit_price: 12 });
    });

    expect(result.current.lineas).toHaveLength(1);
    expect(result.current.lineas[0].quantity).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 3 — productos distintos NO se fusionan entre sí
// ═══════════════════════════════════════════════════════════════════════════════

describe('F12.23b — productos distintos no se fusionan', () => {
  it('dos productos distintos dejan dos líneas', async () => {
    const api = {
      anadirItem: vi.fn(async () => ({ version: 1 })),
      leerTicket: vi.fn(async () => ({ version: 1 })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    await act(async () => {
      await result.current.anadirLinea({ product_id: 'P1', name: 'Concha', quantity: 1, unit_price: 12 });
    });
    await act(async () => {
      await result.current.anadirLinea({ product_id: 'P2', name: 'Bolillo', quantity: 1, unit_price: 8 });
    });

    expect(result.current.lineas).toHaveLength(2);
    expect(result.current.lineas.map((l) => l.product_id).sort()).toEqual(['P1', 'P2']);
  });
});
