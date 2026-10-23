/**
 * `CategoryBar` — interfaz 21 del registro de la superficie (Composición).
 *
 * Réplica estética del POS viejo: tabs horizontales oscuras con la activa
 * en verde lima (#c1d72e), texto font-black uppercase tracking-widest.
 *
 * F7.6.0 — UX HEREDADA DEL VIEJO POS: la barra es también el CONMUTADOR DE
 * VISTA. El botón "Escáner IA" conmuta el cuerpo a `CAMERA` (visor cenital);
 * cada categoría conmuta el cuerpo a `GRID` (rejilla de productos). Es la
 * misma gramática de interacción que el viejo POS, donde la visión es un
 * MODO DE VISTA que reemplaza el cuerpo, no un overlay suelto.
 *
 * COMPATIBILIDAD: `viewMode` y `onCambiarVista` son OPCIONALES. Si no se
 * pasan, la barra se comporta como antes (solo selecciona categoría), de modo
 * que el gate de la Fase 3 (que la monta sin estas props) no se rompe.
 *
 * R-01: sin anchos absolutos. R-03: los 3 modos son explícitos. R-04: cada
 * botón respeta el target táctil de 44×44px (vía `min-h-tactil`).
 */

import React from 'react';

export default function CategoryBar({
  categorias,
  categoriaActiva,
  onSeleccionar,
  onExportarPDF = null,
  // F7.6.0 — conmutador de vista (UX heredada del viejo POS).
  viewMode = 'GRID',
  onCambiarVista,
}) {
  return (
    <div
      className="w-full flex items-center gap-2 overflow-x-auto pb-1"
      role="tablist"
      aria-label="Categorías de productos"
    >
      {/* Botón ESCÁNER IA (como el viejo): conmuta el cuerpo al visor cenital. */}
      <button
        type="button"
        className={`shrink-0 min-h-tactil px-6 py-3 rounded-lg text-[18px] font-black uppercase tracking-widest transition-all whitespace-nowrap shadow-xl flex items-center gap-2 ${
          viewMode === 'CAMERA'
            ? 'bg-acento text-fondo-profundo shadow-acento/20'
            : 'bg-white/5 text-crema-ticket/90 hover:bg-white/10'
        }`}
        role="tab"
        aria-selected={viewMode === 'CAMERA'}
        onClick={() => onCambiarVista?.('CAMERA')}
      >
        📷 Escáner IA
      </button>

      {categorias.map((cat) => (
        <button
          key={cat.id}
          type="button"
          role="tab"
          aria-selected={viewMode === 'GRID' && categoriaActiva === cat.id}
          onClick={() => {
            onSeleccionar(cat.id);
            onCambiarVista?.('GRID');
          }}
          className={`shrink-0 min-h-tactil px-6 py-3 rounded-lg text-[18px] font-black uppercase tracking-widest transition-all whitespace-nowrap drop-shadow-sm ${
            viewMode === 'GRID' && categoriaActiva === cat.id
              ? 'bg-acento text-fondo-profundo'
              : 'bg-white/5 text-crema-ticket/90 hover:bg-white/10'
          }`}
        >
          {cat.name}
        </button>
      ))}

      {/* Botón EXPORTAR PDF (F6.3): abre el selector de categorías de la carta. */}
      {onExportarPDF && (
        <button
          type="button"
          onClick={onExportarPDF}
          className="shrink-0 min-h-tactil px-6 py-3 rounded-lg text-[18px] font-black uppercase tracking-widest transition-all whitespace-nowrap shadow-xl flex items-center gap-2 bg-white/5 text-crema-ticket/90 hover:bg-white/10"
          aria-label="Exportar carta a PDF"
        >
          📄 Exportar PDF
        </button>
      )}
    </div>
  );
}
