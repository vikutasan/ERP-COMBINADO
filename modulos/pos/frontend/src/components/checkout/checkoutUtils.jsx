/**
 * checkoutUtils.js — FD-08: helpers compartidos de CheckoutScreen.
 *
 * Constantes y funciones puras extraídas del monolito CheckoutScreen.jsx
 * para que los subcomponentes las importen sin duplicarlas.
 */

/**
 * Redondea a 2 decimales (frontera del dinero, DT-02).
 *
 * FIX "suma_no_cuadra" (4ª vuelta): el pago único enviaba `monto` SIN
 * redondear y el backend lo rechazaba con RN-94.
 */
export function redondear2(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Formatea un precio numérico como moneda mexicana. */
export function formatearPrecio(valor) {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return '$0.00';
  return numero.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  });
}

/**
 * F9.1.5.0 — Métodos de pago de primer nivel (UX heredada del viejo POS).
 *
 * El viejo POS desdobla la tarjeta en DEBITO / CREDITO (y un QR que el nuevo
 * POS NUNCA tuvo). Se hereda ese desdoble SIN el QR: cuatro botones de
 * primer nivel.
 */
export const METODOS_PAGO = [
  { id: 'EFECTIVO',       etiqueta: 'Efectivo',       icono: '💵' },
  { id: 'DEBITO',         etiqueta: 'Débito',         icono: '💳' },
  { id: 'CREDITO',        etiqueta: 'Crédito',        icono: '💳' },
  { id: 'TRANSFERENCIA',  etiqueta: 'Transferencia',  icono: '🏦' },
];

/** Denominaciones rápidas de efectivo (MXN). */
export const BILLETES_RAPIDOS = [50, 100, 200, 500];

/** Etiqueta legible de un método de pago. */
export function etiquetaMetodo(metodo) {
  const encontrado = METODOS_PAGO.find((m) => m.id === metodo);
  return encontrado ? encontrado.etiqueta : metodo;
}

/**
 * F12.21 — Etiqueta legible del tipo de entrega de un pedido.
 * Paridad con el viejo POS (`CheckoutScreen.jsx` §6.8).
 */
export function etiquetaEntrega(deliveryType) {
  if (deliveryType === 'DOMICILIO') return 'Domicilio';
  if (deliveryType === 'PICKUP')    return 'Recoger en tienda';
  return deliveryType || '—';
}

/** F12.21 — Etiqueta legible del tipo de empaque de un pedido. */
export function etiquetaEmpaque(packagingType) {
  if (packagingType === 'PROPIO') return 'Empaque propio (del cliente)';
  if (packagingType === 'VENTA')  return 'Empaque de venta (se cobra)';
  return packagingType || '—';
}

/**
 * F12.21 — Formatea una fecha ISO a hora local legible (es-MX).
 * Devuelve '—' si no hay fecha válida.
 */
export function formatearFechaHora(fecha) {
  if (!fecha) return '—';
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-MX', {
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

/**
 * F12.21 — Fila etiqueta/valor del panel "Confirmar con el Cliente".
 * Paridad con el `OrderDetailRow` del viejo POS (§6.8).
 */
export function OrderDetailRow({ label, value, highlight = false }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-crema-ticket/50">
        {label}
      </span>
      <span
        className={`text-sm font-semibold ${
          highlight ? 'text-acento' : 'text-crema-ticket'
        }`}
      >
        {value || '—'}
      </span>
    </div>
  );
}
