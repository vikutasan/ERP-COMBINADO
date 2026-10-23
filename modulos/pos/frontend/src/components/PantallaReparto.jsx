/**
 * PantallaReparto — MS-02: Módulo de reparto en tiempo real.
 *
 * Muestra las asignaciones activas (ASIGNADO y EN_CAMINO) con polling cada 5 s.
 * Permite avanzar el estado: ASIGNADO → EN_CAMINO → ENTREGADO | NO_ENTREGADO.
 *
 * Contratos: 31 (GET /delivery), 32 (POST /delivery/assign), 33 (PATCH /delivery/{id}).
 */

import React, { useState } from 'react';
import { useDelivery } from '../hooks/useDelivery.js';

/* ─── Paleta por estado ──────────────────────────────────────────────────── */

const ESTADO_CFG = {
  ASIGNADO: {
    label: 'ASIGNADO',
    dot: 'bg-blue-400',
    badge: 'bg-blue-500/20 text-blue-300 border border-blue-500/40',
    card: 'border-blue-500 bg-blue-500/10',
    btnLabel: 'Salió a entregar',
    btnSiguiente: 'EN_CAMINO',
    btnColor: 'bg-blue-600 hover:bg-blue-500',
  },
  EN_CAMINO: {
    label: 'EN CAMINO',
    dot: 'bg-orange-400 animate-pulse',
    badge: 'bg-orange-500/20 text-orange-300 border border-orange-500/40',
    card: 'border-orange-500 bg-orange-500/10',
    btnLabel: 'Confirmar entrega',
    btnSiguiente: 'ENTREGADO',
    btnColor: 'bg-green-600 hover:bg-green-500',
  },
};

/* ─── Tarjeta de asignación ──────────────────────────────────────────────── */

function TarjetaReparto({ asignacion, onAvanzar, avanzandoId }) {
  const cfg = ESTADO_CFG[asignacion.estado] ?? ESTADO_CFG.ASIGNADO;
  const [confirmarFallo, setConfirmarFallo] = useState(false);
  const avanzando = avanzandoId === asignacion.id;

  const horaAsignado = asignacion.asignado_at
    ? new Date(asignacion.asignado_at).toLocaleTimeString('es-MX', {
        hour: '2-digit', minute: '2-digit',
      })
    : '—';

  return (
    <article
      data-testid={`tarjeta-reparto-${asignacion.id}`}
      className={`
        relative flex flex-col gap-3 rounded-xl border-2 p-4
        transition-all duration-300 ${cfg.card}
      `}
    >
      {/* Encabezado */}
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-xl font-black tracking-tight text-white">
            {asignacion.repartidor_nombre}
          </span>
          {asignacion.repartidor_telefono && (
            <span className="text-sm text-white/60">
              📞 {asignacion.repartidor_telefono}
            </span>
          )}
        </div>
        <span className={`
          flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider
          ${cfg.badge}
        `}>
          <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </header>

      {/* Info del pedido */}
      <div className="flex flex-col gap-1 text-sm text-white/70">
        <span>🕐 Asignado: {horaAsignado}</span>
        {asignacion.notas && (
          <span className="italic">📝 {asignacion.notas}</span>
        )}
      </div>

      {/* Botones de acción */}
      <footer className="flex gap-2 mt-1">
        {cfg.btnSiguiente && !confirmarFallo && (
          <button
            id={`btn-avanzar-${asignacion.id}`}
            onClick={() => onAvanzar(asignacion.id, cfg.btnSiguiente)}
            disabled={avanzando}
            className={`
              flex-1 rounded-lg py-2 text-sm font-bold text-white
              transition-colors duration-200 disabled:opacity-50
              ${cfg.btnColor}
            `}
          >
            {avanzando ? '…' : cfg.btnLabel}
          </button>
        )}

        {asignacion.estado === 'EN_CAMINO' && !confirmarFallo && (
          <button
            id={`btn-fallo-${asignacion.id}`}
            onClick={() => setConfirmarFallo(true)}
            disabled={avanzando}
            className="rounded-lg px-3 py-2 text-sm font-bold text-red-400 border border-red-500/40 hover:bg-red-500/10 transition-colors"
          >
            ✕ No entregado
          </button>
        )}

        {confirmarFallo && (
          <div className="flex gap-2 w-full">
            <button
              id={`btn-confirmar-fallo-${asignacion.id}`}
              onClick={() => { onAvanzar(asignacion.id, 'NO_ENTREGADO'); setConfirmarFallo(false); }}
              disabled={avanzando}
              className="flex-1 rounded-lg py-2 text-sm font-bold text-white bg-red-700 hover:bg-red-600 transition-colors"
            >
              {avanzando ? '…' : 'Confirmar fallo'}
            </button>
            <button
              onClick={() => setConfirmarFallo(false)}
              className="rounded-lg px-3 py-2 text-sm text-white/50 hover:text-white border border-white/10 transition-colors"
            >
              Cancelar
            </button>
          </div>
        )}
      </footer>
    </article>
  );
}

/* ─── Componente principal ───────────────────────────────────────────────── */

/**
 * PantallaReparto
 * @param {{ onVolver?: () => void }} props
 */
export default function PantallaReparto({ onVolver }) {
  const { asignaciones, cargando, error, avanzarEstado } = useDelivery({ activo: true });
  const [avanzandoId, setAvanzandoId] = useState(null);

  const asignados  = asignaciones.filter((a) => a.estado === 'ASIGNADO');
  const enCamino   = asignaciones.filter((a) => a.estado === 'EN_CAMINO');

  async function handleAvanzar(id, nuevoEstado) {
    setAvanzandoId(id);
    await avanzarEstado(id, nuevoEstado);
    setAvanzandoId(null);
  }

  return (
    <div
      id="pantalla-reparto"
      className="min-h-screen bg-[rgb(var(--fondo-profundo))] text-[rgb(var(--crema-ticket))] flex flex-col"
    >
      {/* ── Barra superior ──────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 border-b border-white/10 bg-[rgb(var(--fondo-panel))]">
        <div className="flex items-center gap-3">
          {onVolver && (
            <button
              id="btn-volver-reparto"
              onClick={onVolver}
              className="text-white/50 hover:text-white transition-colors text-lg"
              aria-label="Volver"
            >
              ←
            </button>
          )}
          <h1 className="text-lg sm:text-xl font-black tracking-tight">
            🛵 Reparto
          </h1>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {cargando && (
            <span className="text-xs text-white/40 animate-pulse">Actualizando…</span>
          )}
          <div className="flex flex-wrap gap-1.5 sm:gap-2 text-xs sm:text-sm text-white/60">
            <span className="bg-blue-500/20 text-blue-300 rounded-full px-2.5 py-0.5 font-bold">
              {asignados.length} asignado{asignados.length !== 1 ? 's' : ''}
            </span>
            <span className="bg-orange-500/20 text-orange-300 rounded-full px-2.5 py-0.5 font-bold">
              {enCamino.length} en camino
            </span>
          </div>
        </div>
      </header>

      {/* ── Error de API ─────────────────────────────────────────────────── */}
      {error && (
        <div
          role="alert"
          className="mx-4 sm:mx-6 mt-4 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300"
        >
          ⚠️ Sin conexión con el módulo de reparto
        </div>
      )}

      {/* ── Contenido principal ──────────────────────────────────────────── */}
      <main className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 p-4 sm:p-6 overflow-auto">

        {/* Columna ASIGNADO */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-widest text-blue-400 mb-3">
            Asignados ({asignados.length})
          </h2>
          {asignados.length === 0 ? (
            <p className="text-white/30 text-sm italic">Sin repartos asignados</p>
          ) : (
            <div className="flex flex-col gap-3">
              {asignados.map((a) => (
                <TarjetaReparto
                  key={a.id}
                  asignacion={a}
                  onAvanzar={handleAvanzar}
                  avanzandoId={avanzandoId}
                />
              ))}
            </div>
          )}
        </section>

        {/* Columna EN CAMINO */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-widest text-orange-400 mb-3">
            En camino ({enCamino.length})
          </h2>
          {enCamino.length === 0 ? (
            <p className="text-white/30 text-sm italic">Ningún repartidor en ruta</p>
          ) : (
            <div className="flex flex-col gap-3">
              {enCamino.map((a) => (
                <TarjetaReparto
                  key={a.id}
                  asignacion={a}
                  onAvanzar={handleAvanzar}
                  avanzandoId={avanzandoId}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
