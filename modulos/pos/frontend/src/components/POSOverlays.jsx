/**
 * `POSOverlays` — modales de confirmación del POS (FASE 3.4) + banner de red (F9.0.3).
 *
 * Agrupa los overlays que la pantalla raíz necesita, para que `RetailVisionPOS`
 * sea un orquestador y no un monolito de JSX:
 *
 *   - `OverlayExito`   — venta cobrada (folio + total + "Nueva venta").
 *   - `OverlayError`   — fallo persistente (motivo + "Reintentar" / "Cerrar").
 *   - `OverlayConfirmar` — confirmación genérica (título + mensaje + 2 acciones).
 *   - `OfflineBanner`  — aviso fijo de red caída (F9.0.3, cicatriz v6.1 $453).
 *
 * Todos usan `role="dialog"` + `aria-modal="true"` y respetan el target táctil
 * de 44×44px (R-04). El contenedor raíz es `fixed inset-0` (fluido, R-01).
 *
 * DECISIÓN ARQUITECTÓNICA (F9.0, v1.1): el `OfflineBanner` del nuevo POS NO
 * muestra un conteo de pendientes. El nuevo POS no tiene cola local: cada
 * acción va directo al servidor (el servidor es la única fuente de verdad).
 * Por eso el banner solo comunica el ESTADO de red y que el cobro está
 * bloqueado. Si algún día se construye un modo offline-first, será una fase
 * dedicada (p. ej. "F10 — Modo offline-first"), no un parche de UX.
 */

import React from 'react';

/** Formatea un precio numérico como moneda mexicana. */
function formatearPrecio(valor) {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return '$0.00';
  return `$${numero.toFixed(2)}`;
}

/** Overlay de venta cobrada con éxito. */
export function OverlayExito({ ticket, onNuevaVenta }) {
  if (!ticket) return null;
  return (
    <div className="fixed inset-0 z-50 bg-fondo-profundo/80 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Venta cobrada"
        className="w-full max-w-[420px] bg-crema-ticket text-fondo-profundo rounded-canon40 p-6 flex flex-col gap-4 text-center"
      >
        <h2 className="text-2xl font-bold">✅ Venta cobrada</h2>
        <p className="text-sm">
          Folio <strong>{ticket.account_num}</strong>
        </p>
        <p className="text-3xl font-bold text-acento">{formatearPrecio(ticket.total)}</p>
        <p className="text-xs text-fondo-profundo/60">Estado: {ticket.status}</p>
        <button
          type="button"
          onClick={onNuevaVenta}
          className="w-full min-h-tactil rounded-canon35 bg-acento text-fondo-profundo font-bold"
        >
          Nueva venta
        </button>
      </div>
    </div>
  );
}

/** Overlay de error persistente (no se auto-oculta). */
export function OverlayError({ mensaje, onReintentar, onCerrar }) {
  if (!mensaje) return null;
  return (
    <div className="fixed inset-0 z-50 bg-fondo-profundo/80 flex items-center justify-center p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Error"
        className="w-full max-w-[420px] bg-fondo-panel text-crema-ticket rounded-canon40 p-6 flex flex-col gap-4 text-center border border-peligro/40"
      >
        <h2 className="text-2xl font-bold text-peligro">⚠️ No se pudo completar</h2>
        <p className="text-sm text-crema-ticket/80">{mensaje}</p>
        <div className="flex flex-col gap-2">
          {onReintentar ? (
            <button
              type="button"
              onClick={onReintentar}
              className="w-full min-h-tactil rounded-canon35 bg-acento text-fondo-profundo font-bold"
            >
              Reintentar
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCerrar}
            className="w-full min-h-tactil rounded-canon35 bg-transparent text-crema-ticket border border-white/20 hover:border-peligro hover:text-peligro transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

/** Overlay de confirmación genérica (2 acciones). */
export function OverlayConfirmar({
  titulo,
  mensaje,
  etiquetaConfirmar = 'Confirmar',
  etiquetaCancelar = 'Cancelar',
  onConfirmar,
  onCancelar,
  peligro = false,
}) {
  if (!titulo) return null;
  return (
    <div className="fixed inset-0 z-50 bg-fondo-profundo/80 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="w-full max-w-[420px] bg-fondo-panel text-crema-ticket rounded-canon40 p-6 flex flex-col gap-4 text-center"
      >
        <h2 className="text-xl font-bold">{titulo}</h2>
        {mensaje ? <p className="text-sm text-crema-ticket/80">{mensaje}</p> : null}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirmar}
            className={`w-full min-h-tactil rounded-canon35 font-bold ${
              peligro ? 'bg-peligro text-crema-ticket' : 'bg-acento text-fondo-profundo'
            }`}
          >
            {etiquetaConfirmar}
          </button>
          <button
            type="button"
            onClick={onCancelar}
            className="w-full min-h-tactil rounded-canon35 bg-transparent text-crema-ticket border border-white/20 hover:border-acento/60 transition-colors"
          >
            {etiquetaCancelar}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Banner fijo de red caída (F9.0.3).
 *
 * Rescate de UX del viejo POS: el viejo POS avisaba con un banner persistente
 * cuando no había red. Aquí se conserva el aviso, pero SIN conteo de
 * pendientes (el nuevo POS no tiene cola local — ver la nota de arriba).
 *
 * Es persistente: NO se auto-oculta. Solo desaparece cuando `visible` pasa a
 * `false` (es decir, cuando la red vuelve). Usa `role="alert"` para que los
 * lectores de pantalla lo anuncien de inmediato.
 *
 * @param {object} props
 * @param {boolean} props.visible - `true` cuando no hay red.
 */
export function OfflineBanner({ visible = false }) {
  if (!visible) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-0 inset-x-0 z-[60] bg-peligro text-crema-ticket px-4 py-3 flex items-center justify-center gap-2 text-center font-semibold shadow-lg"
    >
      <span aria-hidden="true">📡</span>
      <span>
        Sin conexión con el servidor. El cobro está bloqueado hasta que vuelva la red.
      </span>
    </div>
  );
}

export default { OverlayExito, OverlayError, OverlayConfirmar, OfflineBanner };
