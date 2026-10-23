/**
 * PaymentMethodSelector — FD-08: columna izquierda del CheckoutScreen.
 *
 * Extrae el bloque de captura de pago del monolito CheckoutScreen.jsx:
 *   - Selector de método (Efectivo / Débito / Crédito / Transferencia)
 *   - Input de monto + botones rápidos de billetes
 *   - TecladoNumerico (siempre visible — FIX D2 del cobro parcial)
 *   - Botón "Agregar pago" / Botones "Guardar / Cancelar edición"
 *   - Mensaje de validación (sin abonos)
 */

import TecladoNumerico from '../TecladoNumerico.jsx';
import { METODOS_PAGO, BILLETES_RAPIDOS } from './checkoutUtils.jsx';

/**
 * @param {{
 *   metodo: string,
 *   setMetodo: Function,
 *   montoAbono: string,
 *   setMontoAbono: Function,
 *   esEfectivo: boolean,
 *   editandoId: string|null,
 *   procesando: boolean,
 *   montoCapturado: number,
 *   hayAbonos: boolean,
 *   mensajeValidacion: string|null,
 *   titulo: string,
 *   error: string|null,
 *   onAgregar: Function,
 *   onGuardarEdicion: Function,
 *   onCancelarEdicion: Function,
 * }} props
 */
export default function PaymentMethodSelector({
  metodo,
  setMetodo,
  montoAbono,
  setMontoAbono,
  esEfectivo,
  editandoId,
  procesando,
  montoCapturado,
  hayAbonos,
  mensajeValidacion,
  titulo,
  error,
  onAgregar,
  onGuardarEdicion,
  onCancelarEdicion,
}) {
  return (
    <div className="flex-1 p-6 flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-crema-ticket">{titulo}</h2>

      {error ? (
        <div role="alert" className="rounded-canon35 bg-peligro/20 text-peligro px-4 py-3 text-sm font-semibold">
          {error}
        </div>
      ) : null}

      {/* 1. Método de pago (F9.1.5.0: 4 métodos de primer nivel, sin QR) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {METODOS_PAGO.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMetodo(m.id)}
            className={`min-h-tactil rounded-canon35 border px-4 py-3 font-semibold flex items-center justify-center gap-2 transition-colors ${
              metodo === m.id
                ? 'bg-acento text-fondo-profundo border-acento'
                : 'bg-fondo-profundo text-crema-ticket border-white/10 hover:border-acento/60'
            }`}
          >
            <span aria-hidden="true">{m.icono}</span>
            {m.etiqueta}
          </button>
        ))}
      </div>

      {/* 2. Captura del monto (FIX cobro parcial: SIEMPRE visible) */}
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-2">
          <span className="text-sm text-crema-ticket/70">
            {esEfectivo ? 'Efectivo recibido' : 'Monto a cobrar'}
          </span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.50"
            value={montoAbono}
            onChange={(e) => setMontoAbono(e.target.value)}
            className="min-h-tactil rounded-canon35 bg-fondo-profundo text-crema-ticket px-4 text-lg border border-white/10 focus:border-acento outline-none"
            placeholder="0.00"
          />
        </label>

        {/* Botones rápidos de billetes (solo efectivo) */}
        {esEfectivo ? (
          <div className="grid grid-cols-4 gap-2">
            {BILLETES_RAPIDOS.map((billete) => (
              <button
                key={billete}
                type="button"
                onClick={() => setMontoAbono(String(billete))}
                className="min-h-tactil rounded-canon35 bg-fondo-profundo text-crema-ticket border border-white/10 hover:border-acento/60 font-bold transition-colors"
              >
                ${billete}
              </button>
            ))}
          </div>
        ) : null}

        {/* F9.1.5.1 — Teclado + "Agregar pago" en la MISMA fila */}
        <div className="flex gap-3">
          <div className="flex-grow">
            {/* Teclado numérico táctil (F9.0.2) — SIEMPRE visible (FIX D2) */}
            <TecladoNumerico
              valor={montoAbono}
              onCambiar={setMontoAbono}
              deshabilitado={procesando}
            />
          </div>

          {editandoId ? (
            <div className="w-24 flex flex-col gap-2">
              <button
                type="button"
                onClick={onGuardarEdicion}
                disabled={procesando}
                className="flex-1 min-h-tactil rounded-canon35 bg-acento text-fondo-profundo font-bold text-xs uppercase leading-tight transition hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Guardar abono
              </button>
              <button
                type="button"
                onClick={onCancelarEdicion}
                disabled={procesando}
                className="flex-1 min-h-tactil rounded-canon35 text-crema-ticket border border-white/20 hover:border-peligro hover:text-peligro text-xs uppercase leading-tight transition-colors"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onAgregar}
              disabled={procesando || montoCapturado <= 0}
              className="w-24 min-h-tactil rounded-canon35 bg-acento text-fondo-profundo font-bold flex flex-col items-center justify-center gap-1 transition hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span aria-hidden="true" className="text-2xl">➕</span>
              <span className="text-xs uppercase leading-none">Agregar</span>
              <span className="text-xs uppercase leading-none">pago</span>
            </button>
          )}
        </div>

        {!hayAbonos && mensajeValidacion ? (
          <p className="text-sm text-peligro font-semibold">{mensajeValidacion}</p>
        ) : null}
      </div>
    </div>
  );
}
