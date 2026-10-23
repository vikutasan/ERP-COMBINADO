/**
 * `RetailVisionPOS` — Orquestador raíz del POS. (FD-01 + FD-10 refactor)
 *
 * Esta pantalla delega TODA la lógica de negocio en hooks especializados y
 * TODA la presentación en componentes hijos. Su responsabilidad es:
 *   1. Cablear hooks entre sí (pasar deps).
 *   2. Pasar props a los componentes de presentación.
 *   3. Renderizar el layout.
 *
 * NO contiene lógica de negocio inline. Cada callback vive en `usePOSHandlers`.
 * FD-10: el JSX del return se delega a:
 *   - POSMainContent    — cuerpo principal (categorías + catálogo/cámara + ticket desktop)
 *   - POSMobileTicket   — barra inferior + drawer en móvil
 *   - POSFlowOverlays   — overlays secundarios (voz, pedido, PDF, pizarrón, cliente, entrega, caja)
 *
 * @param {object} props
 * @param {string} [props.terminalId] - Terminal elegida en el selector.
 * @param {object} [props.currentUser] - Usuario del ERP.
 * @param {Function} [props.onBackToTerminals] - Volver al selector.
 */

import { useCallback, useMemo, useState } from 'react';
import { CONFIG } from '../../shared/config.js';
import { useModo } from './hooks/useModo.js';
import { useCart } from './hooks/useCart.js';
import { useTicketActions } from './hooks/useTicketActions.js';
import { useTerminalLocking } from './hooks/useTerminalLocking.js';
import { useBarcodeScanner } from './hooks/useBarcodeScanner.js';
import { useNetworkHealth } from './hooks/useNetworkHealth.js';
import { useBeforeUnload } from './hooks/useBeforeUnload.js';
import { useContextoDeVenta } from './hooks/useContextoDeVenta.js';
import { usePreferenciasDeVista } from './hooks/usePreferenciasDeVista.js';
import { useModalesDeFlujo } from './hooks/useModalesDeFlujo.js';
import { useTheme } from './hooks/useTheme.js';
import { useVoiceCart } from './hooks/useVoiceCart.js';
import { useVision } from './hooks/useVision.js';
import { useCatalogo } from './hooks/useCatalogo.js';
import { useColoresTerminal } from './hooks/useColoresTerminal.js';
import { useTurnoCaja } from './hooks/useTurnoCaja.js';
import { useCuentasAbiertas } from './hooks/useCuentasAbiertas.js';
import { usePOSHandlers } from './hooks/usePOSHandlers.js';
import { useColaCocina } from './hooks/useColaCocina.js';
import { useKitchenNotifications } from './hooks/useKitchenNotifications.js';

import POSHeader from './components/POSHeader.jsx';
import CheckoutScreen from './components/CheckoutScreen.jsx';
import { OverlayExito, OverlayError, OfflineBanner } from './components/POSOverlays.jsx';
import ExitAccountModal from './components/ExitAccountModal.jsx';
import { AvisoCaja, AvisoPedidoSinProgramar, AvisoEmpaque } from './components/POSAlerts.jsx';
import POSMainContent from './posLayout/POSMainContent.jsx';
import POSMobileTicket from './posLayout/POSMobileTicket.jsx';
import POSFlowOverlays from './posLayout/POSFlowOverlays.jsx';
import { KitchenToast } from './components/KitchenToast.jsx';

export default function RetailVisionPOS({ terminalId, currentUser, onBackToTerminals }) {
  const terminalEfectiva = terminalId || CONFIG.TERMINAL_ID;
  const usuarioId = currentUser?.id ?? null;

  // ── Layout y red ────────────────────────────────────────────────────────────
  const { modo, esMovil } = useModo();
  const red = useNetworkHealth({ url: `${CONFIG.API_BASE_URL}/health` });

  // ── Estado local de la pantalla (overlays simples) ──────────────────────────
  const [categoriaActiva, setCategoriaActiva] = useState(null);
  const [error, setError] = useState(null);
  const [banner, setBanner] = useState(null);
  const [pedidoAbierto, setPedidoAbierto] = useState(false);
  const [cajaAbierta, setCajaAbierta] = useState(false);
  const [avisoCaja, setAvisoCaja] = useState(false);
  const [selectorPDFAbierto, setSelectorPDFAbierto] = useState(false);
  const [exportandoPDF, setExportandoPDF] = useState(false);
  const [pizarronAbierto, setPizarronAbierto] = useState(false);
  const [refrescarSenal, setRefrescarSenal] = useState(0);
  // ── Notificaciones de cocina (MS-01 Paso 5) ──────────────────────────────────
  const [kitchenToasts, setKitchenToasts] = useState([]);
  const cerrarToast = useCallback(
    (id) => setKitchenToasts((prev) => prev.filter((t) => t.id !== id)),
    []
  );

  // ── Cuartos del estado de venta (P1 / P2a / P2b) ────────────────────────────
  const venta = useContextoDeVenta();
  const {
    ticketId, setTicketId, tipoPedido, setTipoPedido,
    bloquePedido, setBloquePedido, avisoPedidoSinProgramar, setAvisoPedidoSinProgramar,
    cliente, setCliente, checkoutAbierto, setCheckoutAbierto,
    ticketAbierto, setTicketAbierto, clienteAbierto, setClienteAbierto,
    entregaAbierta, setEntregaAbierta, ticketIdRef, enviarCuentaRef, productosRef,
  } = venta;

  const { vozAbierta, setVozAbierta, viewMode, setViewMode } = usePreferenciasDeVista();
  const { salidaAbierta, setSalidaAbierta, avisoEmpaque, setAvisoEmpaque } = useModalesDeFlujo();

  // ── Hooks del POS ────────────────────────────────────────────────────────────
  const carrito = useCart({ ticketId, version: 0 });
  const acciones = useTicketActions({ terminalId: terminalEfectiva, channel: CONFIG.CANAL });
  const locking = useTerminalLocking({ terminalId: terminalEfectiva, usuarioId });
  const { cargando, categorias, productos, sesion, politicaPagoPedido } = useCatalogo({ terminalId: terminalEfectiva });
  const { coloresPorTerminal } = useColoresTerminal();
  const { turnoCaja, setTurnoCaja, refrescarTurnoCaja } = useTurnoCaja({ terminalId: terminalEfectiva });
  const { cuentasAbiertas, refrescarConteoCuentas } = useCuentasAbiertas({ terminalId: terminalEfectiva });
  const tema = useTheme();
  const voz = useVoiceCart(productos);
  const vision = useVision(productos);

  // Cola de cocina compartida entre PantallaCocina y las notificaciones del POS.
  const colaCocina = useColaCocina({ activo: true });
  useKitchenNotifications({
    tickets: colaCocina.tickets,
    activo: true,
    onListo: useCallback((ticket) => {
      const etiqueta = ticket.mesa
        ? `Mesa ${ticket.mesa}`
        : ticket.orden_numero
        ? `Orden #${ticket.orden_numero}`
        : `Ticket ${ticket.id.slice(0, 6)}`;
      const toastId = `kitchen-${ticket.id}-${Date.now()}`;
      setKitchenToasts((prev) => [
        ...prev,
        { id: toastId, mensaje: `${etiqueta} — listo para servir`, timestamp: Date.now() },
      ]);
    }, []),
  });

  productosRef.current = productos;

  // ── Protección al cerrar pestaña (B1) ───────────────────────────────────────
  useBeforeUnload({
    url: `${CONFIG.API_BASE_URL}/pos/tickets/emergency-save`, confirmar: true,
    activo: carrito.lineas.length > 0,
    obtenerPayload: () => {
      const idTicket = ticketIdRef.current;
      if (!idTicket || carrito.lineas.length === 0) return null;
      return { ticket_id: idTicket, terminal_id: terminalEfectiva,
        items: carrito.lineas.map((l) => ({ item_id: l.item_id, product_id: l.product_id, quantity: l.quantity })),
        emergency_save: true };
    },
  });
  useBeforeUnload({
    url: `${CONFIG.API_BASE_URL}/pos/terminals/${terminalEfectiva}/unlock`, activo: locking.esDueno,
    obtenerPayload: () => (usuarioId == null ? null : { occupier_id: String(usuarioId) }),
  });

  // ── Handlers de negocio (FD-01) ──────────────────────────────────────────────
  const h = usePOSHandlers({
    carrito, ticketId, ticketIdRef, enviarCuentaRef, setTicketId,
    tipoPedido, setTipoPedido, bloquePedido, setBloquePedido,
    avisoPedidoSinProgramar, setAvisoPedidoSinProgramar,
    cliente, venta, setCliente, setCheckoutAbierto, setAvisoEmpaque,
    setSalidaAbierta, setPedidoAbierto, setEntregaAbierta,
    acciones, productos, productosRef,
    turnoCaja, setTurnoCaja, politicaPagoPedido,
    refrescarConteoCuentas, setRefrescarSenal, setPizarronAbierto,
    terminalEfectiva, setBanner, setError,
    setExportandoPDF, setSelectorPDFAbierto, setCajaAbierta, setAvisoCaja,
    onBackToTerminals,
  });

  // enviarCuentaAlPizarron cierra el ciclo de enviarCuentaRef
  const enviarCuentaAlPizarron = useMemo(() => {
    const fn = async (forzarVentaDirecta = false) => {
      if (carrito.lineas.length === 0) return;
      setError(null); setBanner(null);
      if (!forzarVentaDirecta && tipoPedido === 'PEDIDO' && !bloquePedido) {
        setAvisoPedidoSinProgramar({ accion: 'ENVIAR' }); return;
      }
      const idTicket = await h.asegurarTicket();
      if (!idTicket) return;
      const limpieza = await carrito.clearCart();
      if (limpieza.outcome !== 'ok') {
        setError(limpieza.reason === 'items_no_persistidos'
          ? 'No se pudo enviar: hay productos sin guardar en el servidor. Verifique la conexión WiFi.'
          : 'No se pudo enviar la cuenta al pizarrón. Intente de nuevo.'); return;
      }
      const clienteEnCurso = cliente;
      venta.cerrar(); setCliente(clienteEnCurso);
      await refrescarConteoCuentas(); setRefrescarSenal((n) => n + 1);
      setBanner({ tipo: 'ok', mensaje: 'Cuenta enviada al pizarrón' });
    };
    enviarCuentaRef.current = fn; return fn;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrito, tipoPedido, bloquePedido, cliente, venta, h.asegurarTicket, refrescarConteoCuentas]);

  useBarcodeScanner({ alEscanear: h.alEscanear });

  // ── Valores derivados ────────────────────────────────────────────────────────
  const total = carrito.total;
  const estadoCuenta = acciones.ticket
    ? acciones.ticket.status === 'PAID' ? 'PAGADA' : 'NUEVA_VENTA'
    : acciones.enviando ? 'COBRANDO' : 'NUEVA_VENTA';

  const productosVisibles = useMemo(
    () => categoriaActiva === null ? productos : productos.filter((p) => p.category_id === categoriaActiva),
    [productos, categoriaActiva],
  );

  const receiptProps = {
    lineas: carrito.lineas, total: carrito.total,
    onIncrementar: h.incrementar, onDecrementar: h.decrementar,
    onQuitar: h.quitar, onCambiarCantidad: h.cambiarCantidad,
    onCobrar: h.abrirCheckoutConGuardia,
    onEnviarCuenta: () => enviarCuentaAlPizarron(),
    enviandoCuenta: acciones.enviando, cobrando: acciones.enviando,
    terminalId: terminalEfectiva, banner, cajaHabilitada: Boolean(turnoCaja),
    sinRed: red.botonBloqueado,
  };

  // ── JSX ──────────────────────────────────────────────────────────────────────
  return (
    <div className="w-full h-screen flex flex-col text-crema-ticket" style={{ backgroundColor: 'rgb(var(--madera))' }}>
      <POSHeader
        terminalId={terminalEfectiva} estado={estadoCuenta}
        numeroCuenta={acciones.ticket?.account_num || null} cartLength={carrito.lineas.length}
        tipoVenta={CONFIG.CANAL} sesionAbierta={Boolean(sesion)}
        estadoRed={red.estado} etiquetaRed={red.etiqueta} colorRed={red.color} modo={modo}
        onCambiarEstacion={h.intentarSalir} onAbrirVoz={() => setVozAbierta(true)}
        vozDisponible={voz.disponible} onAbrirPedido={() => setPedidoAbierto(true)}
        pedidoProgramado={Boolean(bloquePedido)} tipoPedido={tipoPedido}
        onCambiarTipoPedido={setTipoPedido} onLimpiarPedido={() => setBloquePedido(null)}
        onAbrirCliente={() => setClienteAbierto(true)} clienteIdentificado={Boolean(cliente)}
        onAbrirCaja={() => setCajaAbierta(true)} cajaAbierta={cajaAbierta}
        onAbrirPizarron={() => setPizarronAbierto(true)} cuentasAbiertas={cuentasAbiertas}
        turnoCaja={turnoCaja} empaqueRequerido={h.empaqueRequerido} empaqueEnCarrito={h.empaqueEnCarrito}
      />

      {error ? <div className="w-full bg-peligro/20 text-peligro px-4 py-2 text-sm">{error}</div> : null}

      <POSMainContent
        categorias={categorias} categoriaActiva={categoriaActiva} setCategoriaActiva={setCategoriaActiva}
        viewMode={viewMode} setViewMode={setViewMode}
        cargando={cargando} productosVisibles={productosVisibles}
        vision={vision} onAplicarVision={h.aplicarVision}
        onAbrirSelectorPDF={() => setSelectorPDFAbierto(true)}
        onAgregarProducto={h.agregarProducto}
        receiptProps={receiptProps}
      />

      <POSMobileTicket
        esMovil={esMovil} ticketAbierto={ticketAbierto} setTicketAbierto={setTicketAbierto}
        lineas={carrito.lineas} total={total} receiptProps={receiptProps}
        onAbrirCheckout={h.abrirCheckoutConGuardia}
        onEnviarCuenta={enviarCuentaAlPizarron}
      />

      {checkoutAbierto ? (
        <CheckoutScreen total={total} onConfirmar={h.confirmarCobro}
          onCancelar={() => setCheckoutAbierto(false)} procesando={acciones.enviando}
          error={error} orderData={bloquePedido} lineas={carrito.lineas}
          montoMinimo={bloquePedido && tipoPedido === 'PEDIDO' && politicaPagoPedido < 100
            ? total * (politicaPagoPedido / 100) : undefined}
        />
      ) : null}

      <OfflineBanner visible={red.bannerVisible} />
      <OverlayExito
        ticket={!entregaAbierta && acciones.ticket?.status === 'PAID' ? acciones.ticket : null}
        onNuevaVenta={() => { setError(null); setBanner(null); acciones.limpiarTicket(); }}
      />
      <OverlayError mensaje={error} onCerrar={() => setError(null)} />
      <ExitAccountModal visible={salidaAbierta} cantidadItems={carrito.lineas.length}
        onEnviarYSalir={h.salirEnviandoAlPizarron} onSalirSinEnviar={h.salirSinEnviar}
        onCancelar={() => setSalidaAbierta(false)}
      />

      <POSFlowOverlays
        vozAbierta={vozAbierta} voz={voz} productos={productos}
        onAplicarVoz={h.aplicarVoz} onCerrarVoz={() => setVozAbierta(false)}
        pedidoAbierto={pedidoAbierto} setPedidoAbierto={setPedidoAbierto}
        lineas={carrito.lineas} ticketId={ticketId} bloquePedido={bloquePedido}
        onGuardarPedido={h.guardarPedido} politicaPagoPedido={politicaPagoPedido}
        selectorPDFAbierto={selectorPDFAbierto} setSelectorPDFAbierto={setSelectorPDFAbierto}
        categorias={categorias} exportandoPDF={exportandoPDF} onExportarPDF={h.exportarCartaPDF}
        pizarronAbierto={pizarronAbierto} setPizarronAbierto={setPizarronAbierto}
        terminalEfectiva={terminalEfectiva} turnoCaja={turnoCaja}
        coloresPorTerminal={coloresPorTerminal} refrescarSenal={refrescarSenal}
        onRecuperar={h.recuperarCuentaAlCarrito} refrescarConteoCuentas={refrescarConteoCuentas}
        clienteAbierto={clienteAbierto} setClienteAbierto={setClienteAbierto}
        onIdentificado={(id) => { setCliente(id); setClienteAbierto(false); }}
        entregaAbierta={entregaAbierta} ticket={acciones.ticket} cliente={cliente}
        onOmitir={() => { setEntregaAbierta(false); acciones.limpiarTicket(); }}
        cajaAbierta={cajaAbierta} setCajaAbierta={setCajaAbierta}
        usuarioId={usuarioId} currentUser={currentUser}
        onCajaHabilitada={(id) => setTurnoCaja({ cash_session_id: id })}
        onCajaDeshabilitada={() => setTurnoCaja(null)}
        refrescarTurnoCaja={refrescarTurnoCaja}
      />

      {/* Alertas de flujo */}
      <AvisoCaja visible={avisoCaja}
        onAbrirCaja={() => { setAvisoCaja(false); setCajaAbierta(true); }}
        onCancelar={() => setAvisoCaja(false)}
      />
      <AvisoPedidoSinProgramar visible={Boolean(avisoPedidoSinProgramar)}
        onProgramarAhora={h.manejarProgramarDesdeAviso}
        onEnviarComoVentaDirecta={h.manejarEnviarComoVentaDirecta}
      />
      <AvisoEmpaque visible={avisoEmpaque}
        onVolver={() => setAvisoEmpaque(false)}
        onCobrarSinEmpaque={() => { setAvisoEmpaque(false); setCheckoutAbierto(true); }}
      />
      <KitchenToast toasts={kitchenToasts} onCerrar={cerrarToast} />
    </div>
  );
}
