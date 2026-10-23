/**
 * `DailyContextModal` — contexto diario post-corte (FASE 10.4, contrato 28).
 *
 * Se muestra al cajero DESPUÉS de cerrar el turno. Captura cómo estuvo el día
 * (clima, si fue atípico, notas) y lo envía al módulo de Estadísticas, que es
 * el DUEÑO de la tabla `daily_contexts`.
 *
 * ── Herencia (§6.8) ───────────────────────────────────────────────────────────
 * La INTEGRACIÓN se hereda del viejo POS (`apps/pos/components/GestorDeCaja.jsx`,
 * bloque "Contexto diario post-cierre"): 6 climas canónicos, toggle "Atípico",
 * notas opcionales, botones "Guardar" y "Omitir". La IMPLEMENTACIÓN se reescribe
 * como componente aislado con el contrato `{outcome, reason}`.
 *
 * ── No bloqueante ─────────────────────────────────────────────────────────────
 * El contexto es OPCIONAL: "Omitir" cierra el modal sin enviar nada. Si el envío
 * falla, se muestra un aviso discreto pero el corte ya quedó cerrado. El POS
 * NUNCA bloquea el cierre por culpa de Estadísticas.
 *
 * ── Reglas de batalla respetadas ──────────────────────────────────────────────
 *   - Contrato `{outcome, reason}`: no hay try/catch; se decide con `esOk`.
 *   - Sin timers ni auto-guardado (prohibición #1).
 *   - Sin estado leído en callbacks async: se usa el valor devuelto por el
 *     servicio, no un cierre sobre el estado de React (prohibición #3).
 *
 * @see PLAN_DE_ABORDAJE_F10_4_CONTEXTO_DIARIO.md §5 (diseño técnico)
 * @see dailyContextService.js (el servicio que consume)
 */

import React, { useCallback, useState } from 'react';
import * as contexto from '../services/dailyContextService.js';
import { esOk } from '../utils/outcome.js';

/** Traduce un `reason` del servicio a un mensaje humano. */
const MENSAJES = Object.freeze({
  sin_conexion: 'No se pudo contactar Estadísticas. El corte ya quedó cerrado.',
  contexto_no_soportado: 'El módulo de Estadísticas aún no acepta contexto diario.',
  estadisticas_no_disponible: 'Estadísticas no está disponible. El corte ya quedó cerrado.',
  datos_invalidos: 'Los datos del contexto no son válidos.',
  error_desconocido: 'No se pudo guardar el contexto del día.',
});

function mensajeDe(reason) {
  if (!reason) return MENSAJES.error_desconocido;
  return MENSAJES[reason] || reason;
}

/**
 * @param {object} props
 * @param {string} [props.fecha] - `YYYY-MM-DD`; por defecto, el día local de hoy.
 * @param {object} [props.servicio] - inyectable para tests; por defecto el real.
 * @param {(registrado?: boolean) => void} props.onCerrar - se llama al guardar
 *   (`true`) u omitir (`false`); el padre usa el flag para mostrar la confirmación.
 */
export default function DailyContextModal({ fecha, servicio = contexto, onCerrar }) {
  const [clima, setClima] = useState(null);
  const [atipico, setAtipico] = useState(false);
  const [notas, setNotas] = useState('');
  const [guardado, setGuardado] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  /** Cierra el modal propagando si el contexto quedó registrado. */
  const cerrar = useCallback(
    (registrado = false) => {
      if (onCerrar) onCerrar(registrado);
    },
    [onCerrar],
  );

  /** Alterna el clima seleccionado (volver a pulsar lo deselecciona). */
  const alternarClima = useCallback((valor) => {
    setClima((actual) => (actual === valor ? null : valor));
  }, []);

  /** Envía el contexto al módulo de Estadísticas (contrato 28). */
  const alGuardar = useCallback(async () => {
    setAviso(null);
    setOcupado(true);
    const r = await servicio.enviarContextoDiario({ clima, atipico, notas }, fecha);
    setOcupado(false);

    if (!esOk(r)) {
      // El contexto es opcional: se avisa pero NO se bloquea el cierre.
      setAviso(mensajeDe(r.reason));
      return;
    }
    setGuardado(true);
  }, [servicio, clima, atipico, notas, fecha]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Contexto diario post-corte"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-carbon-800 p-5 flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-crema-ticket">📝 ¿Cómo estuvo el día?</h2>
          <button
            type="button"
            onClick={() => cerrar(guardado)}
            className="text-white/40 hover:text-white/80 text-sm font-bold"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </header>

        {guardado ? (
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-center">
            <p className="text-sm font-bold text-emerald-400">✅ Contexto del día registrado</p>
            <button
              type="button"
              onClick={() => cerrar(true)}
              className="mt-3 w-full rounded-xl bg-white/5 hover:bg-white/10 py-2.5 text-[10px] font-black uppercase tracking-widest text-white/60 transition"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <>
            {/* Los 6 climas canónicos (heredados del viejo POS). */}
            <div className="flex flex-wrap items-center gap-2">
              {servicio.CLIMAS.map((w) => (
                <button
                  key={w.valor}
                  type="button"
                  onClick={() => alternarClima(w.valor)}
                  title={w.etiqueta}
                  aria-pressed={clima === w.valor}
                  className={`text-2xl p-2 rounded-xl transition-all ${
                    clima === w.valor
                      ? 'bg-white/20 ring-2 ring-blue-400 scale-110'
                      : 'hover:bg-white/10 opacity-60 hover:opacity-100'
                  }`}
                >
                  {w.emoji}
                </button>
              ))}
              <span className="text-white/20 mx-1">|</span>
              <button
                type="button"
                onClick={() => setAtipico((v) => !v)}
                aria-pressed={atipico}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border ${
                  atipico
                    ? 'bg-red-500/20 border-red-400/30 text-red-300'
                    : 'border-white/10 text-white/30 hover:text-white/60'
                }`}
              >
                ⚠️ Atípico
              </button>
            </div>

            <input
              type="text"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Notas del día (opcional)..."
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-white/80 placeholder-white/20 focus:border-blue-400/50 focus:outline-none"
            />

            {aviso && (
              <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-300">
                {aviso}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={alGuardar}
                disabled={ocupado}
                className="flex-1 rounded-xl border border-blue-400/30 bg-blue-500/20 py-2.5 text-[10px] font-black uppercase tracking-widest text-blue-300 transition hover:bg-blue-500/40 disabled:opacity-50"
              >
                {ocupado ? 'Guardando…' : '✓ Guardar'}
              </button>
              <button
                type="button"
                onClick={() => cerrar(false)}
                className="flex-1 rounded-xl bg-white/5 py-2.5 text-[10px] font-black uppercase tracking-widest text-white/40 transition hover:bg-white/10"
              >
                Omitir →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
