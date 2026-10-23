/**
 * POSAlerts — Modales de alerta del POS. (FD-01)
 *
 * Extrae del monolito `RetailVisionPOS.jsx` los 3 alertdialog repetitivos
 * que compartían la misma estructura de caja flotante:
 *
 *   - AvisoCaja: caja cerrada, ofrece abrir gestor (F4.5.3).
 *   - AvisoPedidoSinProgramar: PEDIDO sin fecha, dos salidas (F12.24).
 *   - AvisoEmpaque: sin empaque en cuenta, dos salidas (P1 Capa 2).
 *
 * Patrón: cada alerta recibe `visible` + callbacks de acción. El componente
 * NO gestiona estado propio: es puro presentación.
 */

import React from 'react';

// ── Estructura base del modal de alerta ─────────────────────────────────────
function AlertaModal({ visible, ariaLabel, icono, titulo, clsTitulo, descripcion, acciones }) {
  if (!visible) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div className="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl w-full max-w-md p-6 text-center">
        <div className="text-5xl mb-3" aria-hidden="true">{icono}</div>
        <h2 className={`text-xl font-bold mb-2 ${clsTitulo}`}>{titulo}</h2>
        <div className="text-sm text-zinc-400 mb-6">{descripcion}</div>
        <div className="flex flex-col gap-3">{acciones}</div>
      </div>
    </div>
  );
}

// ── Aviso de caja cerrada (F4.5.3 / RN-49) ──────────────────────────────────
export function AvisoCaja({ visible, onAbrirCaja, onCancelar }) {
  return (
    <AlertaModal
      visible={visible}
      ariaLabel="Caja cerrada"
      icono="💰"
      titulo="Abre la caja antes de cobrar"
      clsTitulo="text-white"
      descripcion={
        <>
          No hay un turno de caja abierto en esta terminal. Para cobrar
          necesitas abrir la caja primero (RN-49).
        </>
      }
      acciones={
        <>
          <button
            type="button"
            onClick={onAbrirCaja}
            className="min-h-tactil rounded-2xl bg-acento px-5 py-3 font-semibold text-white hover:opacity-90"
          >
            Abrir caja
          </button>
          <button
            type="button"
            onClick={onCancelar}
            className="min-h-tactil rounded-2xl border border-white/15 px-5 py-3 font-semibold text-zinc-300 hover:bg-white/5"
          >
            Cancelar
          </button>
        </>
      }
    />
  );
}

// ── Aviso de pedido sin programar (F12.24) ───────────────────────────────────
export function AvisoPedidoSinProgramar({ visible, onProgramarAhora, onEnviarComoVentaDirecta }) {
  return (
    <AlertaModal
      visible={visible}
      ariaLabel="Pedido sin programar"
      icono="📅"
      titulo="Pedido sin programar"
      clsTitulo="text-acento-calido"
      descripcion={
        <>
          Marcaste esta cuenta como <strong className="text-crema-ticket">PEDIDO</strong>,
          pero no programaste fecha ni hora de entrega. Todo pedido requiere
          programación. ¿Qué quieres hacer?
        </>
      }
      acciones={
        <>
          <button
            type="button"
            id="btn-programar-ahora"
            onClick={onProgramarAhora}
            className="min-h-tactil rounded-2xl bg-acento-calido px-5 py-3 font-semibold text-black hover:opacity-90"
          >
            Programar ahora
          </button>
          <button
            type="button"
            id="btn-enviar-venta-directa"
            onClick={onEnviarComoVentaDirecta}
            className="min-h-tactil rounded-2xl border border-white/15 px-5 py-3 font-semibold text-zinc-300 hover:bg-white/5"
          >
            Enviar como Venta Directa
          </button>
        </>
      }
    />
  );
}

// ── Aviso de empaque faltante (P1 Capa 2) ───────────────────────────────────
export function AvisoEmpaque({ visible, onVolver, onCobrarSinEmpaque }) {
  return (
    <AlertaModal
      visible={visible}
      ariaLabel="Sin empaque en la cuenta"
      icono="📦"
      titulo="Sin empaque en la cuenta"
      clsTitulo="text-peligro"
      descripcion={
        <>
          Marcaste <strong className="text-crema-ticket">&ldquo;Vender Empaque&rdquo;</strong> en
          la programación del pedido, pero no hay ningún producto de empaque
          en la cuenta. ¿Quieres agregar uno antes de cobrar?
        </>
      }
      acciones={
        <>
          <button
            type="button"
            onClick={onVolver}
            className="min-h-tactil rounded-2xl bg-acento px-5 py-3 font-semibold text-fondo-profundo hover:opacity-90"
          >
            Volver y agregar empaque
          </button>
          <button
            type="button"
            onClick={onCobrarSinEmpaque}
            className="min-h-tactil rounded-2xl border border-white/15 px-5 py-3 font-semibold text-zinc-300 hover:bg-white/5"
          >
            Cobrar sin empaque
          </button>
        </>
      }
    />
  );
}
