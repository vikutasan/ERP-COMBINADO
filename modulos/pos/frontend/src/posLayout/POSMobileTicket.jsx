/**
 * POSMobileTicket — FD-10: barra inferior + drawer del ticket en MÓVIL.
 *
 * Extrae del orquestador RetailVisionPOS las líneas 324-352:
 *   - Barra inferior con contador + total (solo en mobile)
 *   - Drawer del ticket abierto (SalesReceipt + botón Cerrar)
 */

import SalesReceipt from '../components/SalesReceipt.jsx';

export default function POSMobileTicket({
  esMovil, ticketAbierto, setTicketAbierto,
  lineas, total,
  receiptProps,
  onAbrirCheckout,
  onEnviarCuenta,
}) {
  if (!esMovil) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setTicketAbierto(true)}
        className="w-full min-h-tactil bg-acento text-fondo-profundo font-bold flex items-center justify-between px-4"
      >
        <span>Ver ticket ({lineas.length})</span>
        <span>${total.toFixed(2)}</span>
      </button>

      {ticketAbierto ? (
        <div className="fixed inset-0 z-40 bg-fondo-profundo/80 flex items-end">
          <div className="w-full max-h-[85vh] overflow-y-auto">
            <SalesReceipt
              {...receiptProps}
              onCobrar={() => { setTicketAbierto(false); onAbrirCheckout(); }}
              onEnviarCuenta={async () => { setTicketAbierto(false); await onEnviarCuenta(); }}
            />
            <button
              type="button"
              onClick={() => setTicketAbierto(false)}
              className="w-full min-h-tactil bg-fondo-panel text-crema-ticket"
            >
              Cerrar
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
