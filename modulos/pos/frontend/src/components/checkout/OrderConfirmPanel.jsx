/**
 * OrderConfirmPanel — FD-08: panel central "Confirmar con el Cliente".
 *
 * F12.21 — Solo aparece en un PEDIDO (order_type === 'PEDIDO'). El cajero
 * valida los datos de entrega con el cliente ANTES de cobrar.
 * Paridad con el viejo POS (§6.8).
 *
 * En una VENTA DIRECTA este componente no se monta.
 */

import { OrderDetailRow, etiquetaEntrega, etiquetaEmpaque, formatearFechaHora, formatearPrecio } from './checkoutUtils.jsx';

/**
 * @param {{
 *   orderData: object,
 *   lineas: Array,
 *   procesando: boolean,
 * }} props
 */
export default function OrderConfirmPanel({ orderData, lineas, procesando }) {
  return (
    <div className="w-full lg:w-full lg:max-w-[320px] lg:flex-shrink-0 bg-fondo-profundo/60 border-y lg:border-y-0 lg:border-x border-white/10 p-6 flex flex-col gap-4 overflow-y-auto">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-bold text-acento">
          Confirmar con el Cliente
        </h3>
        <p className="text-xs text-crema-ticket/60">
          Verifica estos datos antes de cobrar.
        </p>
      </div>

      <OrderDetailRow
        label="Tipo de entrega"
        value={etiquetaEntrega(orderData.delivery_type)}
        highlight
      />
      <OrderDetailRow label="Cliente"   value={orderData.customer_name} />
      <OrderDetailRow label="Teléfono"  value={orderData.customer_phone} />
      <OrderDetailRow
        label="Entrega compromiso"
        value={formatearFechaHora(orderData.committed_at)}
      />

      {/* Contenido del pedido (líneas del carrito) */}
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-crema-ticket/50">
          Contenido del pedido
        </span>
        {Array.isArray(lineas) && lineas.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {lineas.map((l, i) => (
              <li
                key={l.item_id || l.product_id || i}
                className="flex items-center justify-between gap-2 text-sm text-crema-ticket"
              >
                <span className="truncate">
                  {l.quantity}× {l.name}
                </span>
                <span className="text-crema-ticket/70 whitespace-nowrap">
                  {formatearPrecio(
                    (Number(l.unit_price) || 0) * (Number(l.quantity) || 0),
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-sm text-crema-ticket/50">—</span>
        )}
      </div>

      <OrderDetailRow
        label="Empaque"
        value={etiquetaEmpaque(orderData.packaging_type)}
      />
      {orderData.delivery_type === 'DOMICILIO' ? (
        <OrderDetailRow
          label="Dirección"
          value={orderData.delivery_address}
        />
      ) : null}
      {orderData.order_notes ? (
        <OrderDetailRow label="Notas" value={orderData.order_notes} />
      ) : null}

      {procesando ? (
        <div className="mt-auto rounded-canon35 bg-acento/20 text-acento px-4 py-3 text-sm font-bold text-center">
          ✅ PAGADO — EN ESPERA DE PRODUCCIÓN
        </div>
      ) : null}
    </div>
  );
}
