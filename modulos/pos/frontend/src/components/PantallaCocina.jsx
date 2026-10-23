/**
 * PantallaCocina — MS-01: Pantalla de cocina en tiempo real.
 *
 * Muestra los pedidos activos (RECIBIDO y EN_PREP) con polling cada 5 s.
 * Permite avanzar el estado: RECIBIDO → EN_PREP → LISTO.
 *
 * Cuando un ticket llega a LISTO desaparece de la cola (se filtra en el hook).
 *
 * Rutas:
 *   - /cocina           → todos los canales
 *   - /cocina?canal=X   → filtra por canal
 */

import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useColaCocina } from '../hooks/useColaCocina.js';

/* ─── Constantes de estado ─────────────────────────────────────────────────── */

const ESTADOS = {
  RECIBIDO: {
    label: 'RECIBIDO',
    siguiente: 'EN_PREP',
    btnLabel: 'Iniciar prep',
    color: 'border-yellow-500 bg-yellow-500/10',
    badge: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40',
    dot: 'bg-yellow-400',
  },
  EN_PREP: {
    label: 'EN PREP',
    siguiente: 'LISTO',
    btnLabel: 'Marcar listo',
    color: 'border-orange-500 bg-orange-500/10',
    badge: 'bg-orange-500/20 text-orange-300 border border-orange-500/40',
    dot: 'bg-orange-400 animate-pulse',
  },
};

const CANALES_DISPONIBLES = ['', 'PANADERIA', 'HELADERIA', 'REPARTO'];

/* ─── Componente tarjeta de pedido ─────────────────────────────────────────── */

function TarjetaPedido({ ticket, onAvanzar, avanzando }) {
  const cfg = ESTADOS[ticket.kitchen_status] ?? ESTADOS.RECIBIDO;

  const horaLlegada = useMemo(() => {
    if (!ticket.created_at) return '—';
    return new Date(ticket.created_at).toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [ticket.created_at]);

  const minutosEspera = useMemo(() => {
    if (!ticket.created_at) return 0;
    return Math.floor((Date.now() - new Date(ticket.created_at).getTime()) / 60_000);
  }, [ticket.created_at]);

  return (
    <article
      data-testid={`tarjeta-${ticket.id}`}
      className={`
        relative flex flex-col gap-3 rounded-xl border-2 p-4
        transition-all duration-300
        ${cfg.color}
      `}
    >
      {/* Encabezado */}
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-xl font-black tracking-tight text-white">
            {ticket.account_num}
          </span>
          {ticket.customer_name && (
            <span className="text-sm text-white/70 truncate max-w-[160px]">
              {ticket.customer_name}
            </span>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          {/* Badge de estado */}
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${cfg.dot}`} />
            {cfg.label}
          </span>
          {/* Canal */}
          <span className="text-[10px] text-white/40 uppercase tracking-widest">
            {ticket.channel}
          </span>
        </div>
      </header>

      {/* Líneas del pedido */}
      <ul className="flex flex-col gap-1 border-t border-white/10 pt-2">
        {(ticket.lineas ?? []).map((l, i) => (
          <li key={i} className="flex justify-between text-sm">
            <span className="text-white/80">{l.name}</span>
            <span className="font-bold text-white">×{l.quantity}</span>
          </li>
        ))}
        {(ticket.lineas ?? []).length === 0 && (
          <li className="text-sm text-white/30 italic">Sin líneas</li>
        )}
      </ul>

      {/* Notas */}
      {ticket.notas && (
        <p className="rounded-lg bg-white/5 px-3 py-1.5 text-sm text-yellow-200/80 italic border border-white/10">
          📝 {ticket.notas}
        </p>
      )}

      {/* Pie: tiempo + botón */}
      <footer className="flex items-center justify-between gap-2 border-t border-white/10 pt-2">
        <span className="text-xs text-white/40">
          {horaLlegada}
          {minutosEspera > 0 && (
            <span className={`ml-2 ${minutosEspera >= 20 ? 'text-red-400 font-bold' : 'text-white/40'}`}>
              ({minutosEspera} min)
            </span>
          )}
        </span>

        <button
          id={`btn-avanzar-${ticket.id}`}
          data-testid={`btn-avanzar-${ticket.id}`}
          onClick={() => onAvanzar(ticket.id, cfg.siguiente)}
          disabled={avanzando}
          className={`
            flex items-center gap-1.5 rounded-lg px-4 py-2
            text-sm font-bold
            transition-all duration-200 active:scale-95
            disabled:opacity-50 disabled:cursor-not-allowed
            ${ticket.kitchen_status === 'RECIBIDO'
              ? 'bg-yellow-500 text-black hover:bg-yellow-400'
              : 'bg-[rgb(var(--acento))] text-black hover:brightness-110'}
          `}
        >
          {avanzando ? '…' : cfg.btnLabel}
        </button>
      </footer>
    </article>
  );
}

/* ─── Componente principal ──────────────────────────────────────────────────── */

/**
 * PantallaCocina
 * @param {{ onVolver?: () => void }} props
 */
export default function PantallaCocina({ onVolver }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const canalActivo = searchParams.get('canal') ?? '';

  const { tickets, cargando, error, avanzarEstado, recargar } = useColaCocina({
    canal: canalActivo || null,
    activo: true,
  });

  // Estado de carga de cada PATCH individual.
  const [avanzandoId, setAvanzandoId] = React.useState(null);

  async function handleAvanzar(id, nuevoEstado) {
    setAvanzandoId(id);
    await avanzarEstado(id, nuevoEstado);
    setAvanzandoId(null);
  }

  function handleCanalChange(canal) {
    if (canal) {
      setSearchParams({ canal });
    } else {
      setSearchParams({});
    }
  }

  const recibidos = tickets.filter((t) => t.kitchen_status === 'RECIBIDO');
  const enPrep = tickets.filter((t) => t.kitchen_status === 'EN_PREP');

  return (
    <div
      id="pantalla-cocina"
      className="min-h-screen bg-[rgb(var(--fondo-profundo))] text-[rgb(var(--crema-ticket))] flex flex-col"
    >
      {/* ── Barra superior ────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 border-b border-white/10 bg-[rgb(var(--fondo-panel))] shrink-0">
        <div className="flex items-center gap-3">
          {onVolver && (
            <button
              id="btn-volver-cocina"
              onClick={onVolver}
              className="text-white/50 hover:text-white transition-colors text-lg"
              aria-label="Volver"
            >
              ←
            </button>
          )}
          <h1 className="text-lg sm:text-xl font-black tracking-tight">
            🍳 Pantalla de Cocina
          </h1>
          {cargando && (
            <span className="text-xs text-white/30 animate-pulse">actualizando…</span>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Filtro por canal */}
          <div className="flex gap-1 rounded-lg bg-white/5 p-1 overflow-x-auto max-w-[220px] sm:max-w-none">
            {CANALES_DISPONIBLES.map((c) => (
              <button
                key={c || 'todos'}
                id={`btn-canal-${c || 'todos'}`}
                onClick={() => handleCanalChange(c)}
                className={`
                  px-2.5 sm:px-3 py-1 rounded-md text-[10px] sm:text-xs font-bold uppercase tracking-wide
                  transition-all duration-150 whitespace-nowrap
                  ${canalActivo === c
                    ? 'bg-[rgb(var(--acento))] text-black'
                    : 'text-white/50 hover:text-white hover:bg-white/10'}
                `}
              >
                {c || 'Todos'}
              </button>
            ))}
          </div>

          {/* Recarga manual */}
          <button
            id="btn-recargar-cocina"
            onClick={recargar}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-white/60 hover:text-white"
            title="Recargar cola"
          >
            ↺
          </button>
        </div>
      </header>

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div className="mx-4 sm:mx-6 mt-4 rounded-xl bg-red-500/10 border border-red-500/40 px-4 py-3 text-red-300 text-sm">
          ⚠ {error}
        </div>
      )}

      {/* ── Contenido principal: 2 columnas ───────────────────────────────── */}
      <main className="flex-1 flex flex-col md:grid md:grid-cols-2 gap-0 overflow-y-auto md:overflow-hidden">

        {/* Columna RECIBIDO */}
        <section
          id="columna-recibido"
          className="flex flex-col gap-0 border-b md:border-b-0 md:border-r border-white/10"
        >
          <div className="sticky top-0 z-10 flex items-center gap-2 px-4 sm:px-6 py-3 bg-[rgb(var(--fondo-profundo))] border-b border-white/10">
            <span className="w-2 h-2 rounded-full bg-yellow-400" />
            <h2 className="font-bold text-xs sm:text-sm uppercase tracking-widest text-yellow-300">
              Recibido
            </h2>
            <span className="ml-auto bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 text-xs font-bold px-2 py-0.5 rounded-full">
              {recibidos.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {recibidos.length === 0 ? (
              <p className="text-center text-white/20 text-sm py-12">Sin pedidos</p>
            ) : (
              recibidos.map((t) => (
                <TarjetaPedido
                  key={t.id}
                  ticket={t}
                  onAvanzar={handleAvanzar}
                  avanzando={avanzandoId === t.id}
                />
              ))
            )}
          </div>
        </section>

        {/* Columna EN_PREP */}
        <section id="columna-en-prep" className="flex flex-col gap-0">
          <div className="sticky top-0 z-10 flex items-center gap-2 px-6 py-3 bg-[rgb(var(--fondo-profundo))] border-b border-white/10">
            <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            <h2 className="font-bold text-sm uppercase tracking-widest text-orange-300">
              En preparación
            </h2>
            <span className="ml-auto bg-orange-500/20 text-orange-300 border border-orange-500/40 text-xs font-bold px-2 py-0.5 rounded-full">
              {enPrep.length}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {enPrep.length === 0 ? (
              <p className="text-center text-white/20 text-sm py-12">Sin pedidos</p>
            ) : (
              enPrep.map((t) => (
                <TarjetaPedido
                  key={t.id}
                  ticket={t}
                  onAvanzar={handleAvanzar}
                  avanzando={avanzandoId === t.id}
                />
              ))
            )}
          </div>
        </section>
      </main>

      {/* ── Pie de página: contador + intervalo ────────────────────────────── */}
      <footer className="flex items-center justify-between px-6 py-2 border-t border-white/10 text-xs text-white/20">
        <span>
          {tickets.length} pedido{tickets.length !== 1 ? 's' : ''} activo{tickets.length !== 1 ? 's' : ''}
        </span>
        <span>Actualización automática cada 5 s</span>
      </footer>
    </div>
  );
}
