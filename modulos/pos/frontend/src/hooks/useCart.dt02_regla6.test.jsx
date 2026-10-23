/**
 * Puerta DT-02 regla 6 — "El dinero no se suma en el frontend.
 * Los totales vienen del backend. El frontend solo formatea."
 *
 * @paridad: hooks/useCart.dt02_regla6.test.jsx
 * @operacion: El total del ticket viene del backend (no se suma en el frontend)
 *
 * CONTEXTO (deuda arquitectónica detectada por el dueño):
 *
 *   El bug `suma_no_cuadra` se "arregló" 4 veces redondeando una suma de
 *   flotantes en el frontend (`Math.round(reduce(...) * 100) / 100`). Ese parche
 *   trataba el SÍNTOMA, pero seguía violando DT-02 regla 6: el frontend seguía
 *   sumando dinero. La causa raíz es que el total del ticket se DERIVABA en el
 *   cliente en vez de LEERSE del backend (`Numeric(12,2)`).
 *
 * EL FIX ARQUITECTÓNICO:
 *   - `useCart.total` viene del BACKEND (contrato 21 `leerTicket` / contrato 30
 *     `leerLineas`), no de `lineas.reduce(...)`.
 *   - Tras cada escritura (añadir/cambiar/quitar) se refresca el total del
 *     servidor.
 *   - `hidratarLineas` ADOPTA el total del backend (contrato 30).
 *   - La suma local queda SOLO como fallback en modo puramente local (sin API
 *     ni ticket), marcada con `DT-02-FALLBACK-LOCAL`.
 *
 * Criterios de la puerta:
 *   ✓ el total viene del backend tras añadir una línea
 *   ✓ el total viene del backend tras cambiar la cantidad
 *   ✓ el total viene del backend tras quitar una línea
 *   ✓ `hidratarLineas` adopta el total del backend (contrato 30)
 *   ✓ sin servidor (modo local), el total es la suma local redondeada
 *   ✓ el guard E-09-FE detecta una suma de dinero NO marcada en el frontend
 *
 * Se ejecuta con Vitest (jsdom): npm run test (en apps/pos)
 *
 * 7 Oct 2026.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useCart } from './useCart.js';

// Vitest corre desde la raíz del frontend, así que las rutas se resuelven
// desde el cwd. En NUEVO-ERP el POS vivía en `apps/pos` (dos niveles hasta la
// raíz del repo); en el ERP COMBINADO vive en `modulos/pos/frontend`, que son
// TRES niveles. `RAIZ_REPO` absorbe esa diferencia para que las rutas a
// `scripts/` sigan apuntando a la raíz real del repositorio.
const RAIZ_POS = process.cwd();
const RAIZ_REPO = resolve(RAIZ_POS, '..', '..', '..');

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 1 — el total viene del BACKEND tras añadir una línea
// ═══════════════════════════════════════════════════════════════════════════════

describe('DT-02 regla 6 — el total viene del backend (no se suma en el frontend)', () => {
  it('tras añadir una línea, el total es el del servidor (contrato 21)', async () => {
    // El servidor devuelve un total que NO coincide con la suma local a propósito
    // (99.99 vs 33.33×3 = 99.99000000000001). Si el frontend sumara, daría el
    // flotante; el backend da el Decimal exacto.
    const api = {
      anadirItem: vi.fn(async () => ({ version: 1 })),
      leerTicket: vi.fn(async () => ({ version: 1, total: '99.99' })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    await act(async () => {
      await result.current.anadirLinea({
        item_id: 'item-1',
        product_id: 'P1',
        quantity: 3,
        unit_price: 33.33,
      });
    });

    // El total es EXACTAMENTE el del backend, no la suma flotante local.
    expect(result.current.total).toBe(99.99);
    expect(api.leerTicket).toHaveBeenCalledWith('T1');
  });

  it('tras cambiar la cantidad, el total se refresca desde el backend', async () => {
    const api = {
      cambiarCantidad: vi.fn(async () => ({ version: 2 })),
      leerTicket: vi.fn(async () => ({ version: 2, total: '66.66' })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 1 }));

    await act(async () => {
      await result.current.cambiarCantidad('item-1', 2);
    });

    expect(result.current.total).toBe(66.66);
    expect(api.leerTicket).toHaveBeenCalledWith('T1');
  });

  it('tras quitar una línea, el total se refresca desde el backend', async () => {
    const api = {
      quitarItem: vi.fn(async () => ({ version: 3 })),
      leerTicket: vi.fn(async () => ({ version: 3, total: '0.00' })),
    };

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 2 }));

    await act(async () => {
      await result.current.quitarLinea('item-1');
    });

    expect(result.current.total).toBe(0);
    expect(api.leerTicket).toHaveBeenCalledWith('T1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 2 — `hidratarLineas` adopta el total del backend (contrato 30)
// ═══════════════════════════════════════════════════════════════════════════════

describe('DT-02 regla 6 — hidratarLineas adopta el total del backend', () => {
  it('el total de una cuenta recuperada es el del backend, no la suma local', () => {
    const api = {};

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    act(() => {
      result.current.hidratarLineas(
        [
          { item_id: 'i1', product_id: 'P1', quantity: 3, unit_price: 33.33 },
          { item_id: 'i2', product_id: 'P2', quantity: 1, unit_price: 10.0 },
        ],
        5,
        '109.99',
      );
    });

    // El backend dice 109.99; la suma local daría 109.99 (33.33×3=99.99 + 10).
    // El punto es que se ADOPTA el valor del backend, no se recalcula.
    expect(result.current.total).toBe(109.99);
    expect(result.current.version).toBe(5);
  });

  it('si el backend no provee total, cae al fallback local (modo sin servidor)', () => {
    const api = {};

    const { result } = renderHook(() => useCart({ api, ticketId: 'T1', version: 0 }));

    act(() => {
      result.current.hidratarLineas(
        [{ item_id: 'i1', product_id: 'P1', quantity: 2, unit_price: 5.0 }],
        1,
        null,
      );
    });

    // Sin total de servidor, el fallback local redondeado da 10.
    expect(result.current.total).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 3 — el fallback local SOLO aplica sin servidor
// ═══════════════════════════════════════════════════════════════════════════════

describe('DT-02 regla 6 — fallback local solo en modo sin servidor', () => {
  it('sin API ni ticket, el total es la suma local redondeada a 2 decimales', () => {
    const { result } = renderHook(() => useCart({}));

    act(() => {
      result.current.hidratarLineas(
        [{ item_id: 'i1', product_id: 'P1', quantity: 3, unit_price: 33.33 }],
        undefined,
        null,
      );
    });

    // 33.33×3 = 99.99000000000001 en flotante; el fallback redondea a 99.99.
    expect(result.current.total).toBe(99.99);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Criterio 4 — el guard E-09-FE detecta una suma de dinero NO marcada
// ═══════════════════════════════════════════════════════════════════════════════

describe('DT-02 regla 6 — el guard E-09-FE cierra el punto ciego del frontend', () => {
  it('el guard declara la regla E-09-FE y honra el marcador DT-02-FALLBACK-LOCAL', () => {
    const ruta = resolve(RAIZ_REPO, 'scripts', 'guards.mjs');
    const fuente = readFileSync(ruta, 'utf8');

    // El guard declara el grep E-09-FE (suma de dinero en el frontend).
    expect(fuente).toContain("id: 'E-09-FE'");
    // El guard honra el escape hatch explícito del fallback local.
    expect(fuente).toContain('DT-02-FALLBACK-LOCAL');
    // El guard acota el grep a la superficie del POS.
    expect(fuente).toContain("onlyPath: 'apps/pos/'");
  });

  it('las dos únicas sumas de dinero del frontend están marcadas como fallback local', () => {
    // FD-07: la suma del fallback local vive en useCartState.js (el hook de
    // estado puro). useCart.js es ahora el orquestador y ya no contiene la suma.
    const useCartStateSrc = readFileSync(
      resolve(RAIZ_POS, 'src', 'hooks', 'useCartState.js'),
      'utf8',
    );
    const receiptSrc = readFileSync(
      resolve(RAIZ_POS, 'src', 'components', 'SalesReceipt.jsx'),
      'utf8',
    );

    // Cada suma de líneas en el frontend lleva el marcador explícito.
    const sumaUseCart = useCartStateSrc
      .split(/\r?\n/)
      .filter((l) => /\.reduce\s*\(/.test(l) && /\bunit_price\b/.test(l));
    const sumaReceipt = receiptSrc
      .split(/\r?\n/)
      .filter((l) => /\.reduce\s*\(/.test(l) && /\bunit_price\b/.test(l));

    expect(sumaUseCart.length).toBeGreaterThan(0);
    expect(sumaReceipt.length).toBeGreaterThan(0);
    for (const linea of [...sumaUseCart, ...sumaReceipt]) {
      expect(linea).toContain('DT-02-FALLBACK-LOCAL');
    }
  });
});
