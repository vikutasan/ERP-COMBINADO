/**
 * `ProductGrid` — interfaz 19 del registro de la superficie (Composición).
 *
 * Contenedor raíz declarado:
 *   `w-full grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4`
 *   - MÓVIL (<768px):      grid de 2 columnas (base).
 *   - COMPACTO (768–1023): grid de 3 columnas (`md:`).
 *   - MOSTRADOR (≥1024):   grid de 4 columnas (`lg:`).
 *
 * R-01: `w-full`. R-03: los 3 modos son explícitos vía breakpoints.
 */

import React from 'react';
import ProductCard from './ProductCard.jsx';

export default function ProductGrid({ productos, onAgregar }) {
  if (!productos || productos.length === 0) {
    return (
      <div className="w-full flex items-center justify-center py-16 text-crema-ticket/50">
        No hay productos para esta categoría.
      </div>
    );
  }

  return (
    <div className="w-full grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
      {productos.map((producto) => (
        <ProductCard key={producto.id} producto={producto} onAgregar={onAgregar} />
      ))}
    </div>
  );
}
