/**
 * VisionVisor — FASE 7.3 (Visión cenital).
 *
 * Visor de la cámara cenital con las sugerencias de la IA. Muestra:
 *   1. El video en vivo de la cámara cenital (montaje fijo sobre el mostrador).
 *   2. El estado del motor (analizando / IA no disponible).
 *   3. Las sugerencias resueltas (producto + confianza) con un botón para
 *      agregarlas al carrito — SIEMPRE por decisión del operador.
 *
 * VISIÓN ASISTIVA (RN-74): este componente SUGIERE, nunca agrega al carrito
 * automáticamente. Cada sugerencia tiene su propio botón "Agregar"; el
 * operador decide. La visión jamás bloquea la venta manual.
 *
 * FLUJO PERSISTENTE (DT-08): el visor permanece abierto entre detecciones
 * (modo "escáner de charola"). No se cierra por producto; el operador lo
 * cierra explícitamente.
 *
 * REGLA: Solo presentación y callbacks. Cero lógica de negocio. Toda la
 * lógica vive en `useVision`.
 *
 * R-03: el visor es un overlay a pantalla completa, visible en los 3 modos
 *       (mostrador / compacto / móvil) — el contenedor usa `max-w-3xl` y
 *       `max-h-[80vh]` con scroll interno, nunca un ancho fijo en px.
 * R-04: todo control interactivo tiene `min-h-tactil` (≥44px).
 *
 * @see PLAN_DE_ABORDAJE_FASE_7_POR_PARTES.md §8
 * @see DIRECTRICES_TRANSVERSALES_DEL_ERP.md §6.7 (DT-08)
 */

/**
 * Etiqueta legible del estado del motor de visión.
 * @param {boolean} disponible
 * @param {boolean} analizando
 * @returns {{texto: string, color: string}}
 */
function estadoMotor(disponible, analizando) {
  if (!disponible) {
    return { texto: 'IA no disponible', color: 'bg-red-500' };
  }
  if (analizando) {
    return { texto: 'Analizando…', color: 'bg-blue-400 animate-pulse' };
  }
  return { texto: 'Escaneando charola', color: 'bg-acento' };
}

export default function VisionVisor({
  // Estado (de useVision)
  activo = false,
  analizando = false,
  sugerencias = [],
  disponible = true,
  error = null,
  umbral = 0.35,
  // Refs (de useVision)
  videoRef,
  canvasRef,
  // Callbacks
  onToggle,
  onAgregar,
  onLimpiar,
  onCerrar,
}) {
  const motor = estadoMotor(disponible, analizando);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Visión cenital"
    >
      <div className="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden">
        {/* Encabezado */}
        <div className="bg-black/60 px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black uppercase tracking-widest text-white">
              👁️ Visión <span className="text-acento">Cenital</span>
            </h2>
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mt-0.5">
              La IA sugiere · Tú decides
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="min-h-tactil min-w-tactil text-white/50 hover:text-white text-2xl font-black leading-none px-2"
            title="Cerrar"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Aviso de no disponibilidad (degradación elegante) */}
          {!disponible && (
            <div className="bg-amber-500/15 border border-amber-500/30 rounded-2xl px-4 py-3">
              <p className="text-amber-300 text-xs font-bold uppercase tracking-wider">
                ⚠️ IA no disponible. Usa la captura manual.
              </p>
            </div>
          )}

          {/* Video en vivo de la cámara cenital */}
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-video">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              autoPlay
              playsInline
              muted
              aria-label="Cámara cenital"
            />
            {/* Canvas oculto: aquí se dibuja el frame que se envía al contrato. */}
            <canvas ref={canvasRef} width="1280" height="720" className="hidden" />

            {/* Indicador de estado del motor */}
            <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 px-3 py-2 rounded-xl border border-white/10">
              <span className={`w-3 h-3 rounded-full ${motor.color}`} />
              <span className="text-[10px] font-black uppercase tracking-widest text-white/90">
                {motor.texto}
              </span>
            </div>

            {/* Botón de encendido/apagado del visor */}
            {!activo && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <button
                  type="button"
                  onClick={onToggle}
                  className="min-h-tactil bg-acento text-black px-8 py-4 rounded-2xl font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all"
                >
                  🔍 Iniciar visión
                </button>
              </div>
            )}
          </div>

          {/* Mensaje de error no bloqueante */}
          {error && disponible && (
            <p className="text-amber-300 text-xs font-bold uppercase tracking-wider">
              {error}
            </p>
          )}

          {/* Sugerencias resueltas */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-white/50">
                Sugerencias ({sugerencias.length}) · umbral {umbral}
              </h3>
              {sugerencias.length > 0 && (
                <button
                  type="button"
                  onClick={onLimpiar}
                  className="min-h-tactil text-white/40 hover:text-white text-[10px] font-black uppercase tracking-widest px-2"
                >
                  Limpiar
                </button>
              )}
            </div>

            {sugerencias.length === 0 && (
              <p className="text-white/30 text-xs font-bold uppercase tracking-wider py-4 text-center">
                Coloca los productos sobre el mostrador…
              </p>
            )}

            {sugerencias.map((s, i) => (
              <div
                key={`${s.sku}-${i}`}
                className="flex items-center justify-between gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-white font-bold truncate">
                    {s.nombre || s.sku || 'Producto desconocido'}
                  </p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/40">
                    SKU {s.sku || '—'} · {Math.round((s.confianza || 0) * 100)}%
                    {!s.resuelto && ' · no está en el catálogo'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onAgregar?.(s)}
                  disabled={!s.resuelto}
                  className={`min-h-tactil shrink-0 px-4 rounded-xl font-black uppercase tracking-widest text-xs transition-all ${
                    s.resuelto
                      ? 'bg-acento text-black hover:scale-105 active:scale-95'
                      : 'bg-zinc-700 text-white/30 cursor-not-allowed'
                  }`}
                  title={s.resuelto ? 'Agregar al carrito' : 'No está en el catálogo'}
                >
                  ➕ Agregar
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
