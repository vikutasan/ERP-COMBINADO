/**
 * POSFlowOverlays — FD-10: overlays secundarios del flujo de venta.
 *
 * Extrae del orquestador RetailVisionPOS los overlays de flujo complejo
 * (líneas 388-496): VoiceCartPanel, OrderProgrammingModal,
 * SelectorCategoriasPDF, OpenAccountsCorkboard, CustomerIdentificationPanel,
 * TicketDeliveryPanel y GestorDeCaja.
 *
 * Los overlays simples (CheckoutScreen, OfflineBanner, OverlayExito,
 * OverlayError, ExitAccountModal, Alertas) se mantienen en el orquestador
 * porque sus props son directos y no tienen cálculos derivados.
 */

import React, { Suspense, lazy } from 'react';
import VoiceCartPanel from '../components/VoiceCartPanel.jsx';
import OrderProgrammingModal from '../components/OrderProgrammingModal.jsx';
import OpenAccountsCorkboard from '../components/OpenAccountsCorkboard.jsx';
import CustomerIdentificationPanel from '../components/CustomerIdentificationPanel.jsx';
import TicketDeliveryPanel from '../components/TicketDeliveryPanel.jsx';

// PERF-01: Carga diferida de módulos pesados
const GestorDeCaja = lazy(() => import('../GestorDeCaja.jsx'));
const SelectorCategoriasPDF = lazy(() => import('../components/SelectorCategoriasPDF.jsx'));

export default function POSFlowOverlays({
  // Voz
  vozAbierta, voz, productos, onAplicarVoz, onCerrarVoz,
  // Pedido
  pedidoAbierto, setPedidoAbierto, lineas, ticketId, bloquePedido,
  onGuardarPedido, politicaPagoPedido,
  // PDF
  selectorPDFAbierto, setSelectorPDFAbierto, categorias, exportandoPDF, onExportarPDF,
  // Pizarrón
  pizarronAbierto, setPizarronAbierto, terminalEfectiva, turnoCaja,
  coloresPorTerminal, refrescarSenal, onRecuperar, refrescarConteoCuentas,
  // Cliente
  clienteAbierto, setClienteAbierto, onIdentificado,
  // Entrega (con cálculo de pctCubierto)
  entregaAbierta, ticket, cliente, onOmitir,
  // Gestor de caja
  cajaAbierta, setCajaAbierta, usuarioId, currentUser, onCajaHabilitada,
  onCajaDeshabilitada, refrescarTurnoCaja,
}) {
  return (
    <>
      {/* Panel de IA — Voz */}
      {vozAbierta ? (
        <VoiceCartPanel
          grabando={voz.grabando}
          transcribiendo={voz.transcribiendo}
          texto={voz.texto}
          propuesta={voz.propuesta}
          disponible={voz.disponible}
          error={voz.error}
          fase={voz.fase}
          nivel={voz.nivel}
          productos={productos}
          onToggleRecording={voz.alternar}
          onEditLine={voz.editarLinea}
          onRemoveLine={voz.quitarLinea}
          onToggleConfirm={voz.alternarConfirmacion}
          onApply={async () => { await onAplicarVoz(voz.propuesta?.lineas); voz.reset(); onCerrarVoz(); }}
          onCancel={() => { voz.reset(); onCerrarVoz(); }}
        />
      ) : null}

      {/* Programación de pedido */}
      {pedidoAbierto ? (
        <OrderProgrammingModal
          lineas={lineas}
          numeroCuenta={ticketId || null}
          datosIniciales={bloquePedido}
          onGuardar={onGuardarPedido}
          onCerrar={() => setPedidoAbierto(false)}
          porcentajePagoMinimo={politicaPagoPedido}
        />
      ) : null}

      {/* Selector de categorías para PDF */}
      {selectorPDFAbierto ? (
        <Suspense fallback={null}>
          <SelectorCategoriasPDF
            categorias={categorias}
            exportando={exportandoPDF}
            onExportar={onExportarPDF}
            onCerrar={() => setSelectorPDFAbierto(false)}
          />
        </Suspense>
      ) : null}

      {/* Pizarrón de cuentas abiertas */}
      {pizarronAbierto ? (
        <div
          className="fixed inset-0 z-50 bg-fondo-profundo/80 flex items-center justify-center p-4"
          role="dialog" aria-modal="true" aria-label="Cuentas abiertas"
        >
          <OpenAccountsCorkboard
            terminalId={terminalEfectiva}
            cajaHabilitada={Boolean(turnoCaja)}
            coloresPorTerminal={coloresPorTerminal}
            refrescarSenal={refrescarSenal}
            onRecuperar={onRecuperar}
            onCerrar={() => { setPizarronAbierto(false); refrescarConteoCuentas(); }}
          />
        </div>
      ) : null}

      {/* Identificación del cliente */}
      {clienteAbierto ? (
        <CustomerIdentificationPanel
          items={lineas.map((l) => ({ product_id: l.product_id, quantity: l.quantity }))}
          onIdentificado={onIdentificado}
          onCerrar={() => setClienteAbierto(false)}
        />
      ) : null}

      {/* Panel de entrega del ticket (con cálculo de pctCubierto) */}
      {entregaAbierta && ticket ? (() => {
        const totalTicket = Number(ticket.total) || 0;
        let pagado = 0;
        if (ticket.payment_details) {
          const pagos = Array.isArray(ticket.payment_details.pagos)
            ? ticket.payment_details.pagos
            : ticket.payment_details.metodo ? [ticket.payment_details] : [];
          pagado = pagos.reduce((sum, p) => sum + (Number(p.monto ?? p.recibido) || 0), 0);
        }
        const pctCubierto = totalTicket > 0 ? Math.min(Math.round((pagado / totalTicket) * 100), 100) : 100;
        return (
          <TicketDeliveryPanel
            ticket={{ ...ticket, payment_covered_pct: pctCubierto }}
            cliente={cliente}
            onOmitir={onOmitir}
          />
        );
      })() : null}

      {/* Gestor de Caja (F4.5.2) */}
      {cajaAbierta ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog" aria-modal="true" aria-label="Gestor de caja"
        >
          <div className="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <Suspense fallback={<div className="p-8 text-center text-white/40 font-bold">Cargando caja…</div>}>
              <GestorDeCaja
                terminalId={terminalEfectiva}
                usuarioId={usuarioId}
                usuarioNombre={currentUser?.name || null}
                onCajaHabilitada={onCajaHabilitada}
                onCajaDeshabilitada={onCajaDeshabilitada}
                onCerrar={() => { setCajaAbierta(false); refrescarTurnoCaja(); }}
              />
            </Suspense>
          </div>
        </div>
      ) : null}
    </>
  );
}
