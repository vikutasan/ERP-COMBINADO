/**
 * DashboardSucursales — MS-03: Dashboard central de ventas por sucursal.
 *
 * Muestra métricas consolidadas en tiempo real:
 *   - Gran total de ventas y tickets de la cadena
 *   - Desglose por sucursal: estatus, última sync, ventas, ticket promedio
 *   - Auditoría de conflictos detectados con resolución manual
 */

import React, { useState } from 'react';
import { useSyncDashboard } from '../hooks/useSyncDashboard.js';

export default function DashboardSucursales({ onVolver }) {
  const {
    dashboard,
    conflictos,
    cargando,
    error,
    resolviendoId,
    recargar,
    resolverConflicto,
  } = useSyncDashboard(15000);

  const [conflictoSeleccionado, setConflictoSeleccionado] = useState(null);
  const [notasResolucion, setNotasResolucion] = useState('');

  const sucursales = dashboard?.sucursales ?? [];

  async function handleResolver(e) {
    e.preventDefault();
    if (!conflictoSeleccionado || !notasResolucion.trim()) return;
    try {
      await resolverConflicto(conflictoSeleccionado.id, notasResolucion);
      setConflictoSeleccionado(null);
      setNotasResolucion('');
    } catch {
      // El error ya se setea en el hook
    }
  }

  return (
    <div
      data-testid="dashboard-sucursales"
      className="min-h-screen bg-fondo-profundo text-crema-ticket flex flex-col p-6 gap-6 font-sans select-none"
    >
      {/* Encabezado */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          {onVolver && (
            <button
              onClick={onVolver}
              className="px-3 py-1.5 text-xs font-bold uppercase rounded-lg bg-white/10 hover:bg-white/20 transition-all text-white/80"
            >
              ← Volver
            </button>
          )}
          <div>
            <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
              <span>🏢</span> Panel Central de Sucursales
            </h1>
            <p className="text-xs text-white/50">
              Consolidación asíncrona multi-sucursal en tiempo real
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={recargar}
            className="px-3 py-1.5 text-xs font-bold uppercase rounded-lg bg-primary-600 hover:bg-primary-500 transition-all text-white flex items-center gap-1.5"
          >
            🔄 Actualizar
          </button>
        </div>
      </header>

      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Tarjetas KPI Globales */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wider text-white/50">
            Gran Total Ventas
          </span>
          <span className="text-3xl font-black text-green-400">
            ${(dashboard?.gran_total_ventas ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
          </span>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wider text-white/50">
            Tickets Consolidados
          </span>
          <span className="text-3xl font-black text-blue-400">
            {dashboard?.gran_total_tickets ?? 0}
          </span>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wider text-white/50">
            Sucursales Activas
          </span>
          <span className="text-3xl font-black text-yellow-400">
            {dashboard?.sucursales_activas ?? 0}
          </span>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wider text-white/50">
            Conflictos Pendientes
          </span>
          <span
            className={`text-3xl font-black ${
              (dashboard?.conflictos_pendientes ?? 0) > 0 ? 'text-red-400' : 'text-white/40'
            }`}
          >
            {dashboard?.conflictos_pendientes ?? 0}
          </span>
        </div>
      </section>

      {/* Grid de Sucursales */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-white/80">Desglose por Sucursal</h2>

        {cargando && !dashboard ? (
          <div className="p-8 text-center text-white/40 font-bold">Cargando métricas...</div>
        ) : sucursales.length === 0 ? (
          <div className="p-8 bg-white/5 border border-white/10 rounded-xl text-center text-white/40">
            No hay sucursales sincronizadas aún.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sucursales.map((suc) => (
              <div
                key={suc.branch_id}
                data-testid={`tarjeta-sucursal-${suc.branch_id}`}
                className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-3 hover:border-white/20 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-bold text-base text-white">{suc.branch_name}</span>
                    <span className="text-xs text-white/40 font-mono">{suc.branch_id}</span>
                  </div>
                  <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-green-500/20 text-green-300 border border-green-500/30">
                    {suc.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5 text-sm">
                  <div>
                    <span className="text-xs text-white/50 block">Ventas</span>
                    <span className="font-bold text-green-400">
                      ${suc.total_ventas.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-white/50 block">Tickets</span>
                    <span className="font-bold text-white">{suc.total_tickets}</span>
                  </div>
                  <div>
                    <span className="text-xs text-white/50 block">Promedio</span>
                    <span className="font-bold text-white">${suc.ticket_promedio.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-xs text-white/50 block">Conflictos</span>
                    <span
                      className={`font-bold ${
                        suc.total_conflicts > 0 ? 'text-red-400' : 'text-white/40'
                      }`}
                    >
                      {suc.total_conflicts}
                    </span>
                  </div>
                </div>

                <div className="text-[10px] text-white/40 pt-1 border-t border-white/5">
                  Última sincronización:{' '}
                  {suc.last_sync_at
                    ? new Date(suc.last_sync_at).toLocaleString('es-MX')
                    : 'Sin registro'}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sección de Conflictos Auditables */}
      {conflictos.length > 0 && (
        <section className="flex flex-col gap-3 mt-4 border-t border-white/10 pt-4">
          <h2 className="text-lg font-bold text-red-400 flex items-center gap-2">
            <span>⚠️</span> Conflictos Detectados para Revisión de Auditoría
          </h2>

          <div className="flex flex-col gap-2">
            {conflictos.map((conf) => (
              <div
                key={conf.id}
                data-testid={`conflicto-item-${conf.id}`}
                className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-sm"
              >
                <div className="flex flex-col">
                  <span className="font-bold text-white">
                    [{conf.branch_id}] {conf.conflict_reason} en {conf.domain}
                  </span>
                  <span className="text-xs text-white/50 font-mono">UUID: {conf.record_uuid}</span>
                </div>

                <button
                  onClick={() => setConflictoSeleccionado(conf)}
                  className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-xs"
                >
                  Resolver
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Modal de Resolución de Conflicto */}
      {conflictoSeleccionado && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form
            onSubmit={handleResolver}
            className="bg-[#18181b] border border-white/20 rounded-2xl p-6 max-w-md w-full flex flex-col gap-4"
          >
            <h3 className="text-lg font-bold text-white">
              Resolver Conflicto de Sincronización
            </h3>
            <p className="text-xs text-white/60">
              Sucursal: <strong>{conflictoSeleccionado.branch_id}</strong> — Dominio:{' '}
              <strong>{conflictoSeleccionado.domain}</strong>
            </p>

            <label className="flex flex-col gap-1 text-xs text-white/70">
              Notas de Auditoría:
              <textarea
                required
                rows={3}
                value={notasResolucion}
                onChange={(e) => setNotasResolucion(e.target.value)}
                placeholder="Explica la causa del ajuste o la justificación del arqueo..."
                className="bg-black/50 border border-white/20 rounded-lg p-2 text-white text-sm focus:outline-none focus:border-primary-500"
              />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConflictoSeleccionado(null)}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={resolviendoId !== null}
                className="px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-bold disabled:opacity-50"
              >
                {resolviendoId ? 'Guardando...' : 'Confirmar Resolución'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
