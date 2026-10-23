/**
 * `CheckoutScreen` — interfaz 8 del registro de la superficie (Modal).
 *
 * Contenedor raíz declarado: `w-full max-w-[1100px] mx-auto`.
 *   - MOSTRADOR: modal centrado w-full max-w-[1100px]; columna lateral
 *                w-full lg:w-1/3 (fluida, R-01).
 *   - COMPACTO:  modal w-full max-w-[800px].
 *   - MÓVIL:     modal w-full, 1 columna.
 *
 * FD-08: orquestador puro. La lógica de negocio y el estado local se
 * mantienen aquí; el JSX se delega a:
 *   - PaymentMethodSelector — columna izq (método + monto + teclado)
 *   - OrderConfirmPanel     — panel central (solo PEDIDO, datos del cliente)
 *   - PaymentSummary        — columna der (abonos + resumen + confirmar)
 *
 * @see PLAN_DE_ABORDAJE_FASE_9_1_PAGOS_MIXTOS.md §3.4
 */

import { useMemo, useState } from 'react';
import { useCheckout } from '../hooks/useCheckout.js';
import { METODOS_VALIDOS } from '../services/checkoutService.js';
import { redondear2, formatearPrecio } from './checkout/checkoutUtils.jsx';
import PaymentMethodSelector from './checkout/PaymentMethodSelector.jsx';
import OrderConfirmPanel    from './checkout/OrderConfirmPanel.jsx';
import PaymentSummary       from './checkout/PaymentSummary.jsx';

export default function CheckoutScreen({
  total,
  onConfirmar,
  onCancelar,
  procesando,
  error,
  montoMinimo,
  // F12.21 — Revisión pre-cobro de un PEDIDO (paridad con el viejo POS §6.8).
  orderData = null,
  // F12.21 — Líneas del pedido (para el "Contenido del Pedido" del panel).
  lineas = [],
}) {
  const esPedido = Boolean(orderData && orderData.order_type === 'PEDIDO');
  // P5 — El monto mínimo para confirmar. Default: total (pago completo).
  const minimo = (montoMinimo != null && montoMinimo > 0 && montoMinimo < total)
    ? montoMinimo
    : total;

  const [metodo,     setMetodo]     = useState('EFECTIVO');
  // Captura ÚNICA del monto a abonar (FIX cobro parcial).
  const [montoAbono, setMontoAbono] = useState('');
  const [editandoId, setEditandoId] = useState(null);

  const checkout = useCheckout({ total });
  const { abonos, resumen, puedeCobrar: cuadra, agregarPago, editarPago, borrarPago } = checkout;

  const esEfectivo    = metodo === 'EFECTIVO';
  const montoCapturado = Number(montoAbono) || 0;
  const hayAbonos     = abonos.length > 0;

  // FIX cobro parcial: el pago único sigue funcionando sin agregar abonos.
  const puedeCobrar = hayAbonos
    ? cuadra
    : !esEfectivo || montoCapturado >= minimo;

  const mensajeValidacion = useMemo(() => {
    if (hayAbonos) {
      return resumen.faltante > 0
        ? `Faltan ${formatearPrecio(resumen.faltante)} para cubrir el total.`
        : null;
    }
    if (!esEfectivo) return null;
    if (montoCapturado === 0) return 'Captura el efectivo recibido.';
    if (montoCapturado < minimo)
      return `Faltan ${formatearPrecio(minimo - montoCapturado)} para cubrir el mínimo (${formatearPrecio(minimo)}).`;
    return null;
  }, [hayAbonos, resumen.faltante, esEfectivo, montoCapturado, minimo]);

  // FIX "confirmar pago no hace nada": el motivo se muestra junto al botón.
  const motivoBloqueo = useMemo(() => {
    if (procesando) return null;
    if (hayAbonos) {
      return resumen.faltante > 0
        ? `Faltan ${formatearPrecio(resumen.faltante)} para poder cobrar.`
        : null;
    }
    if (esEfectivo && montoCapturado < minimo)
      return `Faltan ${formatearPrecio(minimo - montoCapturado)} para poder cobrar.`;
    return null;
  }, [procesando, hayAbonos, resumen.faltante, esEfectivo, montoCapturado, minimo]);

  // ── Helpers de negocio ────────────────────────────────────────────────────

  /** F9.1.5.0 — retrocompatibilidad: TARJETA → DEBITO. */
  function metodoCanonico(m) {
    if (m === 'TARJETA') return 'DEBITO';
    return METODOS_VALIDOS.includes(m) ? m : 'EFECTIVO';
  }

  /** Acota un monto al saldo PENDIENTE del ticket (redondeado a 2 dec.). */
  function acotarAlPendiente(capturado, pendiente) {
    return Math.min(capturado, Math.max(0, pendiente));
  }

  /** FIX "suma_no_cuadra" — monto APLICADO al total (nunca más que el pendiente). */
  function montoAplicado(metodoReal, capturado) {
    const pendiente = Math.max(0, Math.round((total - resumen.abonado) * 100) / 100);
    return acotarAlPendiente(capturado, pendiente);
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  function manejarAgregarPago() {
    const capturado = Number(montoAbono);
    if (!Number.isFinite(capturado) || capturado <= 0) return;
    const metodoReal = metodoCanonico(metodo);
    const monto = montoAplicado(metodoReal, capturado);
    const nuevo = agregarPago({
      metodo: metodoReal,
      monto,
      recibido: metodoReal === 'EFECTIVO' ? capturado : null,
    });
    if (nuevo) { setMontoAbono(''); setEditandoId(null); }
  }

  function manejarEditar(abono) {
    setEditandoId(abono.id);
    setMontoAbono(String(abono.monto));
    setMetodo(abono.metodo); // F9.1.5.0: DEBITO/CREDITO son de primer nivel.
  }

  /** FIX "suma_no_cuadra" (6ª vuelta) — la edición usa el MISMO acotamiento que el alta. */
  function manejarGuardarEdicion() {
    const capturado = Number(montoAbono);
    if (!Number.isFinite(capturado) || capturado <= 0) return;
    const metodoReal = metodoCanonico(metodo);
    const anterior = abonos.find((a) => a.id === editandoId);
    const abonadoSinEste = Math.max(
      0,
      Math.round((resumen.abonado - (Number(anterior?.monto) || 0)) * 100) / 100,
    );
    const pendiente = Math.max(0, Math.round((total - abonadoSinEste) * 100) / 100);
    const monto = acotarAlPendiente(capturado, pendiente);
    editarPago(editandoId, {
      metodo: metodoReal,
      monto,
      recibido: metodoReal === 'EFECTIVO' ? capturado : null,
    });
    setMontoAbono(''); setEditandoId(null);
  }

  function manejarCancelarEdicion() {
    setMontoAbono(''); setEditandoId(null);
  }

  /**
   * Confirma el cobro: con abonos envía N pagos; sin abonos, el pago único.
   *
   * FIX "suma_no_cuadra" (3ª vuelta) — el pago único ahora envía SIEMPRE un
   * `monto` EXPLÍCITO; `recibido` y `cambio` se redondean a 2 decimales.
   */
  function manejarConfirmar() {
    if (hayAbonos) { onConfirmar({ abonos }); return; }
    const metodoReal = metodoCanonico(metodo);
    if (esEfectivo) {
      const monto    = redondear2(Math.min(montoCapturado, total));
      const recibido = redondear2(montoCapturado);
      onConfirmar({ metodo: metodoReal, monto, recibido, cambio: redondear2(Math.max(recibido - monto, 0)) });
      return;
    }
    const totalRedondeado = redondear2(total);
    onConfirmar({ metodo: metodoReal, monto: totalRedondeado, recibido: totalRedondeado, cambio: 0 });
  }

  // ── Render (ensamblaje de subcomponentes) ─────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 bg-fondo-profundo/80 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Cobro del ticket"
    >
      <div
        className={`w-full ${
          esPedido ? 'max-w-[1400px]' : 'max-w-[1100px]'
        } mx-auto bg-fondo-panel rounded-canon50 overflow-hidden flex flex-col lg:flex-row`}
      >
        <PaymentMethodSelector
          metodo={metodo}
          setMetodo={setMetodo}
          montoAbono={montoAbono}
          setMontoAbono={setMontoAbono}
          esEfectivo={esEfectivo}
          editandoId={editandoId}
          procesando={procesando}
          montoCapturado={montoCapturado}
          hayAbonos={hayAbonos}
          mensajeValidacion={mensajeValidacion}
          titulo={esPedido ? 'Cobrar pedido' : 'Cobrar ticket'}
          error={error}
          onAgregar={manejarAgregarPago}
          onGuardarEdicion={manejarGuardarEdicion}
          onCancelarEdicion={manejarCancelarEdicion}
        />

        {esPedido ? (
          <OrderConfirmPanel
            orderData={orderData}
            lineas={lineas}
            procesando={procesando}
          />
        ) : null}

        <PaymentSummary
          total={total}
          abonos={abonos}
          resumen={resumen}
          hayAbonos={hayAbonos}
          esEfectivo={esEfectivo}
          montoCapturado={montoCapturado}
          minimo={minimo}
          procesando={procesando}
          puedeCobrar={puedeCobrar}
          motivoBloqueo={motivoBloqueo}
          onEditar={manejarEditar}
          onBorrar={borrarPago}
          onConfirmar={manejarConfirmar}
          onCancelar={onCancelar}
        />
      </div>
    </div>
  );
}
