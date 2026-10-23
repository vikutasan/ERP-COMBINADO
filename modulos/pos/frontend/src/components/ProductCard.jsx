/**
 * `ProductCard` — interfaz 20 del registro de la superficie (Composición).
 *
 * Réplica estética del POS viejo:
 *   - Fondo negro (bg-black) con borde sutil, rounded-[35px].
 *   - Imagen centrada con drop-shadow.
 *   - Nombre en font-black uppercase blanco.
 *   - Precio en badge verde (#c1d72e) con texto negro.
 *   - Hover: fondo verde, escala 105%, precio invierte colores.
 *   - Botón "+" invisible que aparece al hover.
 *
 * R-01: `w-full`. R-04: la tarjeta entera es el target táctil (≥44×44px).
 */

import React from 'react';

/**
 * F7.7e — HALLAZGO 5: la API serializa `price` (Decimal) como STRING.
 *
 * `GET /catalog/products-for-sale` devuelve `"price":"12.00"`, no `12.00`.
 * El código original hacía `(producto.price || 0).toFixed(2)`: como un string
 * no vacío es *truthy*, el `|| 0` no protegía nada y `.toFixed` —que solo
 * existe en `Number`— lanzaba `TypeError`. React desmontaba el árbol entero y
 * la pantalla quedaba en blanco (solo el fondo `--madera` del `body`).
 *
 * El gate no lo detectó porque sus fixtures usaban precios NUMÉRICOS. Este
 * helper coercionar SIEMPRE con `Number()` y cae a `0` si el valor no es
 * numérico, igual que `formatearMoneda` en `SalesReceipt`/`POSOverlays`.
 */
function formatearPrecio(valor) {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return '$0.00';
  return `$${numero.toFixed(2)}`;
}

export default function ProductCard({ producto, onAgregar }) {
  const sinStock = producto.activo === false;

  return (
    <button
      type="button"
      disabled={sinStock}
      onClick={() => onAgregar(producto)}
      className="group relative bg-fondo-profundo hover:bg-acento p-3 rounded-canon50 border border-white/10 transition-all duration-500 flex flex-col items-center justify-between gap-2 hover:scale-105 active:scale-95 shadow-[0_4px_20px_rgba(0,0,0,0.6)] hover:shadow-acento/20 h-full w-full disabled:opacity-40 disabled:cursor-not-allowed"
      aria-label={`Agregar ${producto.name} al ticket`}
    >
      {/* Imagen */}
      <div className="w-full h-20 2xl:h-24 flex items-center justify-center mt-1">
        {producto.image_url ? (
          <img
            src={producto.image_url}
            alt={producto.name}
            className="max-w-full max-h-full object-contain drop-shadow-2xl mix-blend-normal"
            loading="lazy"
          />
        ) : (
          <div className="text-6xl group-hover:scale-110 transition-transform">
            {producto.icono || '🍞'}
          </div>
        )}
      </div>

      {/* Nombre + Precio */}
      <div className="text-center w-full flex flex-col items-center gap-1.5 mb-2">
        <p className="text-xs font-black uppercase leading-tight text-crema-ticket group-hover:text-fondo-profundo line-clamp-2 px-1">
          {producto.name}
        </p>
        <div className="bg-acento group-hover:bg-fondo-profundo px-3 py-0.5 rounded-full shadow-md mt-1">
          <p className="text-[14px] font-black text-fondo-profundo group-hover:text-acento italic font-mono tracking-tighter">
            {formatearPrecio(producto.price)}
          </p>
        </div>
      </div>

      {/* Botón "+" al hover */}
      <div className="absolute top-3 right-3 w-6 h-6 bg-white/10 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-inner">
        <span className="text-fondo-profundo font-black text-xs">+</span>
      </div>
    </button>
  );
}
