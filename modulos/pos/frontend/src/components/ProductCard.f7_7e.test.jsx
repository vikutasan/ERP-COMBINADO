/**
 * Puerta de FASE 7.7e — HALLAZGO 5: el precio llega como STRING desde la API.
 *
 * LA CICATRIZ (bug en vivo, no en el gate):
 *   `GET /catalog/products-for-sale` serializa `price` (Decimal de Pydantic)
 *   como STRING: `"price":"12.00"`. `ProductCard` hacía:
 *
 *       ${(producto.price || 0).toFixed(2)}
 *
 *   Un string no vacío es *truthy*, así que `|| 0` NO protegía nada y
 *   `.toFixed` —que solo existe en `Number`— lanzaba:
 *
 *       Uncaught TypeError: (producto.price || 0).toFixed is not a function
 *
 *   React desmontaba el árbol entero (no había error boundary) y la pantalla
 *   quedaba en blanco: solo se veía el fondo `--madera` del `body`.
 *
 * POR QUÉ EL GATE ANTERIOR NO LO DETECTÓ:
 *   Los fixtures de los gates usaban precios NUMÉRICOS (`price: 12.5`), que
 *   sí tienen `.toFixed`. El bug solo aparecía con datos REALES de la API.
 *
 * ESTA PUERTA CIERRA ESE HUECO: todos los fixtures usan precios STRING, tal
 * como los devuelve la API. Si alguien vuelve a llamar `.toFixed` sin
 * coercionar, esta puerta se pone roja.
 *
 * Criterios:
 *   1. `ProductCard` renderiza un precio STRING sin lanzar.
 *   2. `ProductCard` formatea el string con 2 decimales y el símbolo `$`.
 *   3. `ProductCard` tolera un precio ausente / no numérico (cae a `$0.00`).
 *   4. `ProductGrid` renderiza una lista con precios STRING sin lanzar.
 *   5. `RetailVisionPOS` monta con un catálogo de precios STRING (el caso que
 *      rompía en vivo) y muestra los productos.
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

import ProductCard from './ProductCard.jsx';
import ProductGrid from './ProductGrid.jsx';
// TS-01 — FA-01: la pantalla consume el cliente por ApiContext.
import { ApiContext } from '../context/ApiContext.jsx';

afterEach(() => {
  cleanup();
});

/** Un producto con el precio como STRING, igual que la API real. */
function productoConPrecioString(extra = {}) {
  return {
    id: 'prod-1',
    sku: 'PAN-001',
    name: 'Bolillo',
    price: '3.50', // ← STRING, como lo devuelve la API
    image_url: null,
    category_id: 'cat-1',
    nature: 'MANUFACTURADO',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 1–3. ProductCard con precio STRING
// ---------------------------------------------------------------------------

describe('ProductCard — precio STRING (HALLAZGO 5)', () => {
  it('criterio 1: renderiza un precio STRING sin lanzar TypeError', () => {
    const producto = productoConPrecioString();
    expect(() =>
      render(<ProductCard producto={producto} onAgregar={() => {}} />)
    ).not.toThrow();
  });

  it('criterio 2: formatea el string con 2 decimales y el símbolo $', () => {
    render(<ProductCard producto={productoConPrecioString()} onAgregar={() => {}} />);
    expect(screen.getByText('$3.50')).toBeTruthy();
  });

  it('criterio 2b: respeta el valor exacto del string de la API', () => {
    render(
      <ProductCard
        producto={productoConPrecioString({ price: '18.00' })}
        onAgregar={() => {}}
      />
    );
    expect(screen.getByText('$18.00')).toBeTruthy();
  });

  it('criterio 3: un precio ausente cae a $0.00 sin lanzar', () => {
    render(
      <ProductCard
        producto={productoConPrecioString({ price: undefined })}
        onAgregar={() => {}}
      />
    );
    expect(screen.getByText('$0.00')).toBeTruthy();
  });

  it('criterio 3b: un precio no numérico cae a $0.00 sin lanzar', () => {
    render(
      <ProductCard
        producto={productoConPrecioString({ price: 'no-es-un-numero' })}
        onAgregar={() => {}}
      />
    );
    expect(screen.getByText('$0.00')).toBeTruthy();
  });

  it('criterio 3c: sigue aceptando un precio NUMÉRICO (compatibilidad)', () => {
    render(
      <ProductCard
        producto={productoConPrecioString({ price: 12.5 })}
        onAgregar={() => {}}
      />
    );
    expect(screen.getByText('$12.50')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. ProductGrid con precios STRING
// ---------------------------------------------------------------------------

describe('ProductGrid — lista con precios STRING', () => {
  it('criterio 4: renderiza varios productos con precio STRING sin lanzar', () => {
    const productos = [
      productoConPrecioString({ id: 'p1', name: 'Bolillo', price: '3.50' }),
      productoConPrecioString({ id: 'p2', name: 'Telera', price: '4.00' }),
      productoConPrecioString({ id: 'p3', name: 'Concha', price: '8.00' }),
    ];
    expect(() =>
      render(<ProductGrid productos={productos} onAgregar={() => {}} />)
    ).not.toThrow();
    expect(screen.getByText('$3.50')).toBeTruthy();
    expect(screen.getByText('$4.00')).toBeTruthy();
    expect(screen.getByText('$8.00')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 5. RetailVisionPOS monta con un catálogo de precios STRING
//    (el caso EXACTO que rompía en vivo)
// ---------------------------------------------------------------------------

const apiSimulada = vi.hoisted(() => ({
  getCatalogo: vi.fn(),
  getSesionActiva: vi.fn(),
  crearVenta: vi.fn(),
  cobrarTicket: vi.fn(),
  verificarEnvio: vi.fn(),
  anadirItem: vi.fn(),
  cambiarCantidad: vi.fn(),
  quitarItem: vi.fn(),
  latir: vi.fn(),
  tomarLock: vi.fn(),
  liberarLock: vi.fn(),
  listarCuentasAbiertas: vi.fn(),
}));

vi.mock('../api/client.js', () => ({
  ...apiSimulada,
  ApiError: class ApiError extends Error {},
}));

// El catálogo con precios STRING, tal como lo devuelve la API real.
const CATALOGO_STRING = {
  productos: [
    {
      id: 'p1',
      sku: 'PAN-001',
      name: 'Bolillo',
      price: '3.50',
      image_url: null,
      category_id: 'cat-1',
      nature: 'MANUFACTURADO',
    },
    {
      id: 'p2',
      sku: 'BEB-001',
      name: 'Café americano',
      price: '18.00',
      image_url: null,
      category_id: 'cat-2',
      nature: 'MANUFACTURADO',
    },
  ],
  categorias: [
    { id: 'cat-1', name: 'Panes', icon: '🍞', position: 0 },
    { id: 'cat-2', name: 'Bebidas', icon: '🥤', position: 1 },
  ],
};

describe('RetailVisionPOS — monta con catálogo de precios STRING', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiSimulada.getCatalogo.mockResolvedValue(CATALOGO_STRING);
    apiSimulada.getSesionActiva.mockResolvedValue({
      id: 'ses-1',
      terminal_id: 'TERM-01',
      employee_id: 'emp-1',
      is_active: true,
    });
    apiSimulada.latir.mockResolvedValue({ success: true });
    apiSimulada.tomarLock.mockResolvedValue({ success: true });
    apiSimulada.liberarLock.mockResolvedValue({ success: true });
    apiSimulada.listarCuentasAbiertas.mockResolvedValue({ cuentas: [] });
  });

  it('criterio 5: el árbol NO se desmonta y los productos aparecen', async () => {
    const { default: RetailVisionPOS } = await import('../RetailVisionPOS.jsx');

    // TS-01 — FA-01: sin Provider, `useCatalogo` recibe `null` y el catálogo
    // nunca carga (el test fallaba con "Unable to find text: Bolillo").
    render(
      <ApiContext.Provider value={apiSimulada}>
        <RetailVisionPOS
          terminalId="TERM-01"
          currentUser={{ id: 1, name: 'Victor', role: 'ADMIN' }}
          onBackToTerminals={() => {}}
        />
      </ApiContext.Provider>
    );

    // Si el bug volviera, el render lanzaría y el árbol quedaría vacío.
    // Esperamos a que el catálogo cargue y los productos se pinten.
    await waitFor(() => {
      expect(screen.getByText('Bolillo')).toBeTruthy();
    });
    expect(screen.getByText('$3.50')).toBeTruthy();
    expect(screen.getByText('Café americano')).toBeTruthy();
    expect(screen.getByText('$18.00')).toBeTruthy();
  });
});
