/**
 * PaymentSummary — FD-08: columna lateral derecha del CheckoutScreen.
 *
 * F9.1.5.2 — Los abonos se cargan AQUÍ (panel derecho), como el viejo POS;
 * se eliminó el resumen duplicado que vivía en la columna izquierda.
 *
 * Contiene:
 *   - Total a cobrar
 *   - Lista de abonos con botones Editar / Borrar
 *   - Resumen (abonado / faltante / cambio)
 *   - Motivo de bloqueo junto al botón (FIX "confirmar pago no hace nada")
 *   - Botones CONFIRMAR PAGO y Cancelar
 */

import { formatearPrecio, etiquetaMetodo } from './checkoutUtils.jsx';

/**
 * @param {{
 *   total: number,
 *   abonos: Array,
 *   resumen: {abonado: number, faltante: number, cambio: number},
 *   hayAbonos: boolean,
 *   esEfectivo: boolean,
 *   montoCapturado: number,
 *   minimo: number,
 *   procesando: boolean,
 *   puedeCobrar: boolean,
 *   motivoBloqueo: string|null,
 *   onEditar: Function,
 *   onBorrar: Function,
 *   onConfirmar: Function,
 *   onCancelar: Function,
 * }} props
 */
export default function PaymentSummary({
  total,
  abonos,
  resumen,
  hayAbonos,
  esEfectivo,
  montoCapturado,
  minimo,
  procesando,
  puedeCobrar,
  motivoBloqueo,
  onEditar,
  onBorrar,
  onConfirmar,
  onCancelar,
}) {
  return (
    <div className="w-full lg:w-1/3 lg:flex-shrink-0 bg-fondo-profundo p-6 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm text-crema-ticket/60">Total a cobrar</span>
        <span className="text-3xl font-bold text-acento">{formatearPrecio(total)}</span>
      </div>

      {/* Lista de abonos (F9.1.5.2 — panel derecho) */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-crema-ticket/70">
          Abonos del ticket
        </span>
        {hayAbonos ? (
          <ul className="flex flex-col gap-2" aria-label="Abonos agregados">
            {abonos.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-canon35 bg-fondo-profundo border border-white/10 px-4 py-2"
              >
                <span className="flex flex-col">
                  <span className="text-crema-ticket font-semibold">
                    {etiquetaMetodo(a.metodo)}
                  </span>
                  <span className="text-xs text-crema-ticket/60">
                    {a.recibido && a.recibido !== a.monto
                      ? `Entregó ${formatearPrecio(a.recibido)} (Aplica: ${formatearPrecio(a.monto)})`
                      : formatearPrecio(a.monto)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onEditar(a)}
                    disabled={procesando}
                    className="min-h-tactil px-3 rounded-canon35 text-crema-ticket border border-white/20 hover:border-acento/60 transition-colors"
                    aria-label={`Editar abono de ${formatearPrecio(a.monto)}`}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => onBorrar(a.id)}
                    disabled={procesando}
                    className="min-h-tactil px-3 rounded-canon35 text-peligro border border-peligro/40 hover:bg-peligro/10 transition-colors"
                    aria-label={`Borrar abono de ${formatearPrecio(a.monto)}`}
                  >
                    Borrar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-crema-ticket/50">
            Sin abonos: se cobrará el total con el método seleccionado.
          </p>
        )}
      </div>

      {/* Resumen abonado / faltante / cambio */}
      {hayAbonos ? (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-crema-ticket/60">Abonado</span>
            <span className="text-2xl font-bold text-crema-ticket">
              {formatearPrecio(resumen.abonado)}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-crema-ticket/60">Faltante</span>
            <span
              className={`text-2xl font-bold ${
                resumen.faltante > 0 ? 'text-peligro' : 'text-crema-ticket'
              }`}
            >
              {formatearPrecio(resumen.faltante)}
            </span>
          </div>
          {resumen.cambio > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-crema-ticket/60">Cambio</span>
              <span className="text-2xl font-bold text-crema-ticket">
                {formatearPrecio(resumen.cambio)}
              </span>
            </div>
          ) : null}
        </>
      ) : esEfectivo ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm text-crema-ticket/60">Cambio</span>
          <span
            className={`text-2xl font-bold ${
              montoCapturado - minimo < 0 ? 'text-peligro' : 'text-crema-ticket'
            }`}
          >
            {formatearPrecio(Math.max(montoCapturado - minimo, 0))}
          </span>
        </div>
      ) : null}

      {/* Botones de acción */}
      <div className="mt-auto flex flex-col gap-3">
        {/* FIX "confirmar pago no hace nada": el motivo de bloqueo se muestra
            JUNTO al botón (no solo en la columna izquierda). */}
        {motivoBloqueo ? (
          <p
            role="status"
            className="rounded-canon35 bg-peligro/20 text-peligro px-4 py-3 text-sm font-semibold text-center"
          >
            {motivoBloqueo}
          </p>
        ) : null}
        <button
          type="button"
          disabled={!puedeCobrar || procesando}
          onClick={onConfirmar}
          className="w-full min-h-tactil rounded-canon35 bg-acento text-fondo-profundo font-bold text-lg hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {procesando ? 'Procesando…' : 'CONFIRMAR PAGO'}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          disabled={procesando}
          className="w-full min-h-tactil rounded-canon35 bg-transparent text-crema-ticket border border-white/20 hover:border-peligro hover:text-peligro transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
