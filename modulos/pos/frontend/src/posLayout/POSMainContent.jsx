/**
 * POSMainContent — FD-10: cuerpo principal del POS.
 *
 * Extrae del orquestador RetailVisionPOS el bloque `<main>` + la columna
 * lateral del ticket en desktop (líneas 281-321 del monolito).
 *
 * Renderiza:
 *   - CategoryBar (barra de categorías + selector de vista + exportar PDF)
 *   - Estado "Cargando catálogo…"
 *   - VisionVisor (modo cámara)
 *   - ProductGrid (modo grid)
 *   - SalesReceipt lateral (solo en desktop, hidden lg:flex)
 */

import CategoryBar from '../components/CategoryBar.jsx';
import ProductGrid from '../components/ProductGrid.jsx';
import SalesReceipt from '../components/SalesReceipt.jsx';
import VisionVisor from '../components/VisionVisor.jsx';

export default function POSMainContent({
  categorias, categoriaActiva, setCategoriaActiva,
  viewMode, setViewMode,
  cargando, productosVisibles,
  vision, onAplicarVision,
  onAbrirSelectorPDF,
  onAgregarProducto,
  receiptProps,
}) {
  return (
    <main className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3 sm:gap-4 p-2 sm:p-4">
      <section className="flex-1 min-w-0 flex flex-col gap-3 sm:gap-4">
        <CategoryBar
          categorias={categorias}
          categoriaActiva={categoriaActiva}
          onSeleccionar={setCategoriaActiva}
          viewMode={viewMode}
          onCambiarVista={setViewMode}
          onExportarPDF={onAbrirSelectorPDF}
        />
        {cargando ? (
          <div className="w-full flex items-center justify-center py-16 text-crema-ticket/50">
            Cargando catálogo…
          </div>
        ) : viewMode === 'CAMERA' ? (
          <VisionVisor
            activo={vision.activo}
            analizando={vision.analizando}
            sugerencias={vision.sugerencias}
            disponible={vision.disponible}
            error={vision.error}
            umbral={vision.umbral}
            videoRef={vision.videoRef}
            canvasRef={vision.canvasRef}
            onToggle={vision.alternar}
            onAgregar={onAplicarVision}
            onLimpiar={vision.limpiarSugerencias}
            onCerrar={() => { vision.detener(); setViewMode('GRID'); }}
          />
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ProductGrid productos={productosVisibles} onAgregar={onAgregarProducto} />
          </div>
        )}
      </section>

      {/* Ticket lateral (MOSTRADOR) */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <SalesReceipt {...receiptProps} />
      </div>
    </main>
  );
}
