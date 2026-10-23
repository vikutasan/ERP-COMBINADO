/**
 * VoiceCartPanel — FASE 7.2 (Voz).
 *
 * Panel de dictado por voz para el carrito del POS. Muestra:
 *   1. El botón de micrófono (captura continua: presiona una vez y dicta).
 *   2. El medidor de nivel de audio en vivo + la fase de captura.
 *   3. El texto transcrito por Whisper (contrato 24).
 *   4. La propuesta editable de la IA (líneas con producto + cantidad).
 *   5. El botón de confirmación (human-in-the-loop).
 *
 * DECISIÓN DE DISEÑO: en el POS el dictado SOLO sirve para agregar productos a
 * la cuenta. El mapper degrada cualquier otra intención a DESCONOCIDA, por lo
 * que aquí solo existe la ruta de "agregar al carrito".
 *
 * REGLA: Solo presentación y callbacks. Cero lógica de negocio. Toda la lógica
 * vive en `useVoiceCart` y `voiceCartMapper`.
 *
 * R-03: el panel es un overlay a pantalla completa, visible en los 3 modos
 *       (mostrador / compacto / móvil) — el contenedor usa `max-w-2xl` y
 *       `max-h-[70vh]` con scroll interno, nunca un ancho fijo en px.
 * R-04: todo control interactivo tiene `min-h-tactil` (≥44px).
 *
 * @see PLAN_DE_ABORDAJE_FASE_7_POR_PARTES.md §7
 */

import { POS_VOICE_INTENTS } from '../utils/voiceCartMapper.js';

// Etiquetas legibles de cada fase de la captura continua.
const ETIQUETA_FASE = Object.freeze({
  inactivo: 'Listo para dictar',
  esperando_voz: 'Escuchando… empieza a dictar',
  capturando: 'Capturando… (se detiene solo al callar)',
  procesando: 'Procesando dictado…',
});

export default function VoiceCartPanel({
  // Estado (de useVoiceCart)
  grabando,
  transcribiendo,
  texto,
  propuesta,
  disponible,
  error,
  fase = 'inactivo',
  nivel = 0,
  // Datos
  productos = [],
  // Callbacks
  onToggleRecording,
  onEditLine,
  onRemoveLine,
  onToggleConfirm,
  onApply,
  onCancel,
}) {
  const lineas = propuesta?.lineas || [];
  const esDesconocida = propuesta?.intencion === POS_VOICE_INTENTS.DESCONOCIDA;
  const esAgregar = propuesta?.intencion === POS_VOICE_INTENTS.AGREGAR_ITEM;

  // La captura continua está activa mientras el hook no esté inactivo.
  const capturaActiva = fase === 'esperando_voz' || fase === 'capturando';
  // Nivel normalizado 0..1 → ancho de la barra (mínimo 4% para que se vea).
  const anchoNivel = `${Math.max(4, Math.min(100, Math.round((nivel || 0) * 100)))}%`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Dictado por voz"
    >
      <div className="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden">
        {/* Encabezado */}
        <div className="bg-black/60 px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black uppercase tracking-widest text-white">
              🎙️ Dictado por <span className="text-acento">Voz</span>
            </h2>
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mt-0.5">
              La IA propone · Tú confirmas
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="min-h-tactil min-w-tactil text-white/50 hover:text-white text-2xl font-black leading-none px-2"
            title="Cerrar"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Aviso de no disponibilidad */}
          {!disponible && (
            <div className="bg-amber-500/15 border border-amber-500/30 rounded-2xl px-4 py-3">
              <p className="text-amber-300 text-xs font-bold uppercase tracking-wider">
                ⚠️ Dictado por voz no disponible. Usa la captura manual.
              </p>
            </div>
          )}

          {/* Botón de micrófono + medidor de nivel (captura continua) */}
          {disponible && (
            <div className="flex flex-col items-center gap-3 py-2">
              <button
                type="button"
                onClick={onToggleRecording}
                disabled={transcribiendo}
                className={`min-h-tactil min-w-tactil w-24 h-24 rounded-full flex items-center justify-center text-4xl transition-all shadow-2xl ${
                  capturaActiva
                    ? 'bg-red-500 animate-pulse scale-110'
                    : transcribiendo
                      ? 'bg-zinc-700 cursor-wait'
                      : 'bg-acento hover:opacity-90'
                }`}
                title={capturaActiva ? 'Detener' : 'Dictar'}
                aria-label={capturaActiva ? 'Detener dictado' : 'Iniciar dictado'}
              >
                {transcribiendo ? '⏳' : capturaActiva ? '⏹️' : '🎙️'}
              </button>

              {/* Medidor de nivel de audio en vivo */}
              {capturaActiva && (
                <div className="w-full max-w-xs">
                  <div className="h-2 w-full rounded-full bg-black/50 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-acento transition-[width] duration-100 ease-out"
                      style={{ width: anchoNivel }}
                    />
                  </div>
                </div>
              )}

              <p className="text-[11px] font-black uppercase tracking-widest text-white/60 text-center">
                {transcribiendo
                  ? ETIQUETA_FASE.procesando
                  : capturaActiva
                    ? ETIQUETA_FASE[fase]
                    : 'Presiona y dicta: "agrega 3 conchas y 12 bolillos"'}
              </p>
              {!capturaActiva && !transcribiendo && (
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 text-center">
                  Se detiene solo al dejar de hablar
                </p>
              )}
            </div>
          )}

          {/* Texto transcrito */}
          {texto && (
            <div className="bg-black/40 border border-white/10 rounded-2xl px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-white/40 mb-1">
                Transcripción
              </p>
              <p className="text-white text-sm italic">"{texto}"</p>
            </div>
          )}

          {/* Error / aviso */}
          {error && (
            <div className="bg-red-500/15 border border-red-500/30 rounded-2xl px-4 py-3">
              <p className="text-red-300 text-xs font-bold">{error}</p>
            </div>
          )}

          {/* Propuesta de la IA */}
          {propuesta && (
            <div
              className={`rounded-2xl border px-4 py-3 ${
                propuesta.revisar
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-emerald-500/10 border-emerald-500/30'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-white">
                  {esAgregar ? '🛒 Agregar al carrito' : '❓ No entendido'}
                </p>
                <span
                  className={`text-[10px] font-black uppercase tracking-widest ${
                    propuesta.revisar ? 'text-amber-400' : 'text-emerald-400'
                  }`}
                >
                  Confianza {Math.round((propuesta.confianza || 0) * 100)}%
                </span>
              </div>

              {/* Líneas editables (solo agregar_item) */}
              {esAgregar && (
                <div className="space-y-2">
                  {lineas.map((l, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 ${
                        l.resuelto ? 'bg-black/40' : 'bg-red-500/20 border border-red-500/40'
                      }`}
                    >
                      {/* Selector de producto */}
                      <select
                        value={l.producto_id || ''}
                        onChange={(e) => onEditLine(i, 'producto_id', e.target.value)}
                        className="min-h-tactil flex-1 bg-zinc-800 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs font-bold"
                        aria-label={`Producto de la línea ${i + 1}`}
                      >
                        <option value="">
                          {l.resuelto ? '— Selecciona —' : `⚠️ "${l.sku_dictado}" no reconocido`}
                        </option>
                        {productos.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>

                      {/* Cantidad */}
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={l.cantidad}
                        onChange={(e) => onEditLine(i, 'cantidad', e.target.value)}
                        className="min-h-tactil w-20 bg-zinc-800 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs font-black text-center"
                        aria-label={`Cantidad de la línea ${i + 1}`}
                      />

                      {/* Precio */}
                      <span className="text-acento text-xs font-black w-16 text-right">
                        ${(Number(l.precio || 0) * Number(l.cantidad || 0)).toFixed(2)}
                      </span>

                      {/* Quitar línea */}
                      <button
                        type="button"
                        onClick={() => onRemoveLine(i)}
                        className="min-h-tactil min-w-tactil text-red-400 hover:text-red-300 text-lg font-black px-1"
                        title="Quitar línea"
                        aria-label={`Quitar línea ${i + 1}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Mensaje para dictado no entendido */}
              {esDesconocida && (
                <p className="text-white text-sm">
                  Por voz solo puedo agregar productos a la cuenta. Cierra e intenta de nuevo.
                </p>
              )}

              {/* Checkbox de confirmación (human-in-the-loop) */}
              {!esDesconocida && (
                <label className="flex items-center gap-2 mt-4 cursor-pointer select-none min-h-tactil">
                  <input
                    type="checkbox"
                    checked={Boolean(propuesta.confirmado)}
                    onChange={onToggleConfirm}
                    className="w-5 h-5 accent-[#c1d72e]"
                  />
                  <span className="text-[11px] font-black uppercase tracking-widest text-white/80">
                    Confirmo que los datos son correctos
                  </span>
                </label>
              )}
            </div>
          )}
        </div>

        {/* Pie de acciones */}
        <div className="bg-black/60 px-6 py-4 border-t border-white/10 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-tactil px-6 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-[11px] font-black uppercase tracking-widest transition-all"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={!propuesta || !propuesta.confirmado || esDesconocida}
            className={`min-h-tactil px-6 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
              propuesta && propuesta.confirmado && !esDesconocida
                ? 'bg-acento hover:opacity-90 text-black'
                : 'bg-zinc-800 text-white/30 cursor-not-allowed'
            }`}
          >
            Agregar al carrito
          </button>
        </div>
      </div>
    </div>
  );
}
