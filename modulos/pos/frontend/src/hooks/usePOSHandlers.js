/**
 * usePOSHandlers — Orquestador de callbacks de negocio del POS. (FD-01)
 *
 * Extrae del monolito `RetailVisionPOS.jsx` (~700 líneas de handlers) todos los
 * useCallback que implementan acciones de negocio:
 *   - Gestión del carrito: agregar, incrementar, decrementar, quitar, cambiarCantidad.
 *   - Persistencia: asegurarTicket, persistirLinea.
 *   - Cobro: confirmarCobro (con guardia de caja, política de pago, auto-heal 409).
 *   - Envío al pizarrón: enviarCuentaAlPizarron.
 *   - Recuperación de cuenta: recuperarCuentaAlCarrito.
 *   - Guardia de pedido: manejarProgramarDesdeAviso, manejarEnviarComoVentaDirecta.
 *   - Salida: intentarSalir, salirEnviandoAlPizarron, salirSinEnviar.
 *   - PDF: exportarCartaPDF.
 *   - Barcode: alEscanear.
 *
 * El componente raíz solo LLAMA a este hook, destructura los callbacks y los
 * pasa como props a los componentes de presentación.
 *
 * REGLA: Este hook NO tiene JSX. No importa React directamente (solo hooks).
 * REGLA: No muta estado que no le pertenezca. Escribe mediante los setters
 *        recibidos como parámetros.
 */

import { useCallback, useMemo } from 'react';
import { useApi } from '../context/ApiContext.jsx';
import { aOutcome, esOk } from '../utils/outcome.js';
import { construirBloquePedido } from './useOrderProgramming.js';
import { construirPaymentDetails } from '../services/checkoutService.js';
import { descargarCatalogoPDF } from '../components/CatalogoPDF.jsx';
import * as caja from '../services/cashService.js';
import { actualizarPedidoDelTicket } from '../services/ordersService.js';

/**
 * @param {object} params
 *
 * Deps del carrito
 * @param {object} params.carrito        — resultado de useCart
 *
 * Deps de la venta en curso
 * @param {string|null} params.ticketId
 * @param {object}      params.ticketIdRef
 * @param {object}      params.enviarCuentaRef
 * @param {Function}    params.setTicketId
 * @param {string}      params.tipoPedido
 * @param {Function}    params.setTipoPedido
 * @param {object|null} params.bloquePedido
 * @param {Function}    params.setBloquePedido
 * @param {object|null} params.avisoPedidoSinProgramar
 * @param {Function}    params.setAvisoPedidoSinProgramar
 * @param {object|null} params.cliente
 * @param {object}      params.venta           — useContextoDeVenta
 * @param {Function}    params.setCliente
 * @param {Function}    params.setCheckoutAbierto
 * @param {Function}    params.setAvisoEmpaque
 * @param {Function}    params.setSalidaAbierta
 * @param {Function}    params.setPedidoAbierto
 *
 * Deps del catálogo / acciones
 * @param {object}      params.acciones        — useTicketActions
 * @param {object[]}    params.productos
 * @param {object}      params.productosRef
 *
 * Deps de caja / pizarrón
 * @param {object|null} params.turnoCaja
 * @param {Function}    params.setTurnoCaja
 * @param {number}      params.politicaPagoPedido
 * @param {Function}    params.refrescarConteoCuentas
 * @param {Function}    params.setRefrescarSenal
 * @param {Function}    params.setPizarronAbierto
 *
 * Deps de estado de pantalla
 * @param {string}      params.terminalEfectiva
 * @param {Function}    params.setBanner
 * @param {Function}    params.setError
 * @param {Function}    params.setExportandoPDF
 * @param {Function}    params.setSelectorPDFAbierto
 * @param {Function}    params.setCajaAbierta
 * @param {Function}    params.setAvisoCaja
 *
 * Navegación
 * @param {Function}    params.onBackToTerminals
 */
export function usePOSHandlers({
  // Carrito
  carrito,
  // Contexto de venta
  ticketId,
  ticketIdRef,
  enviarCuentaRef,
  setTicketId,
  tipoPedido,
  setTipoPedido,
  bloquePedido,
  setBloquePedido,
  avisoPedidoSinProgramar,
  setAvisoPedidoSinProgramar,
  cliente,
  venta,
  setCliente,
  setCheckoutAbierto,
  setAvisoEmpaque,
  setSalidaAbierta,
  setPedidoAbierto,
  // FD-01 regression fix: estaba en el monolito pero se perdió al extraer el hook.
  setEntregaAbierta,
  // Catálogo / acciones
  acciones,
  productos,
  productosRef,
  // Caja / pizarrón
  turnoCaja,
  setTurnoCaja,
  politicaPagoPedido,
  refrescarConteoCuentas,
  setRefrescarSenal,
  setPizarronAbierto,
  // Estado de pantalla
  terminalEfectiva,
  setBanner,
  setError,
  setExportandoPDF,
  setSelectorPDFAbierto,
  setCajaAbierta,
  setAvisoCaja,
  // Navegación
  onBackToTerminals,
}) {

  // FA-01 — cliente del API inyectado por contexto (nunca estático)
  const api = useApi();

  // ── Guardia de empaque (valores computados) ─────────────────────────────────
  const empaqueRequerido = Boolean(
    bloquePedido &&
    bloquePedido.packaging_type &&
    bloquePedido.packaging_type !== 'PROPIO',
  );
  const empaqueEnCarrito = (carrito.lineas || []).some(
    (l) => l.nature === 'EMPAQUE',
  );

  // ── Asegurar ticket OPEN (D-12) ─────────────────────────────────────────────
  const asegurarTicket = useCallback(
    async (bloque = null) => {
      if (ticketIdRef.current) return ticketIdRef.current;
      const creado = await acciones.crearTicket([], bloque);
      if (creado.reason === 'accion_en_curso') return null;
      if (creado.outcome !== 'ok' || !creado.data?.id) {
        setError(creado.reason || 'No se pudo abrir el ticket');
        return null;
      }
      setTicketId(creado.data.id);
      ticketIdRef.current = creado.data.id;
      return creado.data.id;
    },
    [acciones, setTicketId, setError],
  );

  // ── Persistencia verificada de línea (F12.28 / BUG-11) ─────────────────────
  const persistirLinea = useCallback(
    async (linea) => {
      const resultado = await carrito.anadirLinea(linea);
      if (resultado?.outcome === 'ok') return true;
      const itemId = resultado?.data?.item_id;
      if (itemId) await carrito.quitarLinea(itemId);
      setBanner({
        tipo: 'error',
        mensaje:
          'No se pudo guardar el producto en el servidor. ' +
          'Revisa la conexión e inténtalo de nuevo.',
      });
      return false;
    },
    [carrito, setBanner],
  );

  // ── Acciones del carrito ────────────────────────────────────────────────────
  const agregarProducto = useCallback(
    async (producto) => {
      const idTicket = await asegurarTicket();
      if (!idTicket) return;
      await persistirLinea({
        ticket_id: idTicket,
        product_id: producto.id,
        name: producto.name,
        quantity: 1,
        unit_price: Number(producto.price),
      });
    },
    [asegurarTicket, persistirLinea],
  );

  const incrementar = useCallback(
    (linea) => { carrito.cambiarCantidad(linea.item_id, linea.quantity + 1); },
    [carrito],
  );

  const decrementar = useCallback(
    (linea) => {
      if (linea.quantity <= 1) { carrito.quitarLinea(linea.item_id); return; }
      carrito.cambiarCantidad(linea.item_id, linea.quantity - 1);
    },
    [carrito],
  );

  const quitar = useCallback(
    (linea) => { carrito.quitarLinea(linea.item_id); },
    [carrito],
  );

  // F12.23 — Edición de cantidad por teclado numérico (§6.8).
  const cambiarCantidad = useCallback(
    (linea, nuevaCantidad) => {
      const n = Number(nuevaCantidad);
      if (!Number.isFinite(n) || n <= 0) {
        carrito.quitarLinea(linea.item_id);
        return;
      }
      carrito.cambiarCantidad(linea.item_id, n);
    },
    [carrito],
  );

  // ── Barcode (lector físico) ─────────────────────────────────────────────────
  const alEscanear = useCallback(
    async (codigo) => {
      const producto = productosRef.current.find(
        (p) => p.sku === codigo || p.barcode === codigo,
      );
      if (!producto) {
        setBanner({ tipo: 'error', mensaje: `Código no encontrado: ${codigo}` });
        return;
      }
      setBanner(null);
      const idTicket = await asegurarTicket();
      if (!idTicket) return;
      await persistirLinea({
        ticket_id: idTicket,
        product_id: producto.id,
        name: producto.name,
        quantity: 1,
        unit_price: Number(producto.price),
      });
    },
    [asegurarTicket, persistirLinea, setBanner],
  );

  // ── Abrir checkout con guardia de empaque (P1 Capa 2) ──────────────────────
  const abrirCheckoutConGuardia = useCallback(() => {
    if (empaqueRequerido && !empaqueEnCarrito) {
      setAvisoEmpaque(true);
      return;
    }
    setCheckoutAbierto(true);
  }, [empaqueRequerido, empaqueEnCarrito, setAvisoEmpaque, setCheckoutAbierto]);

  // ── Confirmar cobro (D-12 / F9.1.3 / F12.12 / F12.24) ─────────────────────
  const confirmarCobro = useCallback(
    async (pago, forzarVentaDirecta = false) => {
      setError(null);
      setBanner(null);

      // F12.24 — Guardia de intención (PEDIDO sin programar).
      if (!forzarVentaDirecta && tipoPedido === 'PEDIDO' && !bloquePedido) {
        setCheckoutAbierto(false);
        setAvisoPedidoSinProgramar({ accion: 'COBRAR', pago });
        return;
      }

      // F4.5.3 — Guarda de cobro (RN-49): relee el turno antes de avisar.
      let turnoVigente = turnoCaja;
      if (!turnoVigente) {
        const r = await caja.obtenerTurnoActivo(terminalEfectiva);
        if (r.outcome === 'ok' && r.data && r.data.cash_session_id) {
          turnoVigente = r.data;
          setTurnoCaja(r.data);
        }
      }
      if (!turnoVigente) {
        setCheckoutAbierto(false);
        setAvisoCaja(true);
        return;
      }

      // P5 — Guardia de política de pago para PEDIDOS.
      if (bloquePedido && tipoPedido === 'PEDIDO' && politicaPagoPedido > 0) {
        const totalCuenta = carrito.total || 0;
        const minimoRequerido = totalCuenta * (politicaPagoPedido / 100);
        const montoRecibido = Array.isArray(pago?.abonos)
          ? pago.abonos.reduce((sum, a) => sum + (Number(a.monto) || 0), 0)
          : Number(pago?.recibido) || 0;
        if (montoRecibido < minimoRequerido) {
          setError(
            `Para enviar este pedido a preparación se requiere al menos el ${politicaPagoPedido}% del total ($${minimoRequerido.toFixed(2)}). Monto recibido: $${montoRecibido.toFixed(2)}.`,
          );
          return;
        }
      }

      // Crear ticket si aún no existe (camino defensivo).
      if (!ticketIdRef.current) {
        const items = carrito.lineas.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
        }));
        const creado = await acciones.crearTicket(items);
        if (creado.reason === 'accion_en_curso') return;
        if (creado.outcome !== 'ok' || !creado.data?.id) {
          setError(creado.reason || 'Error al crear el ticket');
          return;
        }
        setTicketId(creado.data.id);
        ticketIdRef.current = creado.data.id;
      }

      // F9.1.3 — Construir payment_details (mixto o único).
      let paymentDetails;
      if (Array.isArray(pago?.abonos)) {
        const construido = construirPaymentDetails({ abonos: pago.abonos, total: carrito.total });
        if (construido.outcome !== 'ok') {
          setError(construido.reason || 'Los pagos no cuadran con el total');
          return;
        }
        paymentDetails = construido.data;
      } else {
        paymentDetails = { metodo: pago.metodo, recibido: pago.recibido, cambio: pago.cambio };
        if (pago.monto != null) paymentDetails.monto = pago.monto;
      }

      const pagado = await acciones.cobrar(paymentDetails, {
        ticketId: ticketIdRef.current,
        version: carrito.version,
        cashSessionId: turnoVigente.cash_session_id,
      });

      if (pagado.reason === 'accion_en_curso') return;

      // F12.12 — Auto-heal conflicto de versión (409).
      if (pagado.reason === 'version_conflict') {
        const fresco = await aOutcome(() => api.leerLineas(ticketIdRef.current));
        if (esOk(fresco)) {
          const datos = fresco.data || {};
          carrito.hidratarLineas(
            Array.isArray(datos.lineas) ? datos.lineas : [],
            datos.version,
            datos.total,
          );
          setBanner({ tipo: 'aviso', mensaje: '⚠️ ¡Atención! Otro vendedor modificó esta cuenta. Totales actualizados.' });
          setCheckoutAbierto(true);
        } else {
          setError('Otro vendedor modificó esta cuenta y no se pudo descargar la versión fresca. Reintenta.');
        }
        return;
      }

      if (pagado.outcome !== 'ok') {
        setError(pagado.reason || 'Error al cobrar el ticket');
        return;
      }

      // Cobro verificado: limpiar y abrir paso de entrega.
      await carrito.clearCart();
      const clienteParaEntrega = cliente;
      venta.cerrar();
      setCliente(clienteParaEntrega);
      setEntregaAbierta(true); // FD-01 regression fix
    },
    [
      acciones, carrito, turnoCaja, tipoPedido, bloquePedido,
      cliente, venta, politicaPagoPedido, terminalEfectiva,
      setError, setBanner, setCheckoutAbierto, setAvisoPedidoSinProgramar,
      setAvisoCaja, setTurnoCaja, setTicketId, setCliente, setEntregaAbierta,
    ],
  );

  // ── Diálogo "PEDIDO sin programar" (F12.24) ─────────────────────────────────
  const manejarProgramarDesdeAviso = useCallback(() => {
    setAvisoPedidoSinProgramar(null);
    setPedidoAbierto(true);
  }, [setAvisoPedidoSinProgramar, setPedidoAbierto]);

  const manejarEnviarComoVentaDirecta = useCallback(() => {
    const pendiente = avisoPedidoSinProgramar;
    setAvisoPedidoSinProgramar(null);
    setTipoPedido('VENTA_DIRECTA');
    if (pendiente?.accion === 'ENVIAR') {
      enviarCuentaRef.current?.(true);
    } else if (pendiente?.pago) {
      confirmarCobro(pendiente.pago, true);
    }
  }, [avisoPedidoSinProgramar, setAvisoPedidoSinProgramar, setTipoPedido, confirmarCobro, enviarCuentaRef]);

  // ── Guardar programación de pedido (F7.5.6 / F12.20) ───────────────────────
  const guardarPedido = useCallback(
    async (bloque) => {
      setPedidoAbierto(false);
      setBloquePedido(bloque);

      // (a) Ticket inexistente: nace CON el bloque.
      if (!ticketIdRef.current) {
        await asegurarTicket(bloque);
        return;
      }

      // (b) Ticket existente: persiste con contrato 31.
      if (!bloque || Object.keys(bloque).length === 0) return;

      const resultado = await actualizarPedidoDelTicket(ticketIdRef.current, {
        ...bloque,
        version: carrito.version,
      });

      if (!esOk(resultado)) {
        setBanner({
          tipo: 'error',
          mensaje:
            resultado.reason === 'version_conflict'
              ? 'La cuenta cambió en otra terminal. Vuelve a abrirla e inténtalo de nuevo.'
              : 'No se pudo guardar la programación del pedido.',
        });
        return;
      }

      const datos = resultado.data;
      if (datos && typeof datos.version === 'number') {
        const lineasParaHidratar =
          Array.isArray(datos.lineas) && datos.lineas.length > 0
            ? datos.lineas
            : carrito.lineas;
        carrito.hidratarLineas(lineasParaHidratar, datos.version, datos.total);
      }
    },
    [asegurarTicket, carrito, setBloquePedido, setPedidoAbierto, setBanner],
  );

  // ── Recuperar cuenta del pizarrón (F12.10 / F12.10b) ──────────────────────
  const recuperarCuentaAlCarrito = useCallback(
    async (cuenta, postit = null) => {
      if (!cuenta || !cuenta.id) return;

      const resultado = await aOutcome(() => api.leerLineas(cuenta.id));
      if (!esOk(resultado)) {
        setBanner({
          tipo: 'error',
          mensaje: `No se pudo recuperar la cuenta: ${resultado.reason || 'error'}`,
        });
        return;
      }

      const datos = resultado.data || {};
      const lineas = Array.isArray(datos.lineas) ? datos.lineas : [];

      // (a) Guardia de cuenta vacía (paridad con viejo POS).
      if (lineas.length === 0) {
        setBanner({ tipo: 'error', mensaje: '⚠️ Cuenta vacía.' });
        return;
      }

      carrito.hidratarLineas(lineas, datos.version, datos.total);
      setTicketId(cuenta.id);

      // (b) Contexto de pedido desde postit (contrato 23).
      const esPedido = postit && postit.order_type === 'PEDIDO';
      if (esPedido) {
        setTipoPedido('PEDIDO');
        setBloquePedido(
          construirBloquePedido({
            order_type: 'PEDIDO',
            delivery_type: postit.delivery_type,
            customer_name: postit.customer_name,
            customer_phone: postit.customer_phone,
            committed_at: postit.committed_at,
            packaging_type: postit.packaging_type,
            delivery_address: postit.delivery_address,
            order_notes: postit.order_notes,
          }),
        );
      } else {
        setTipoPedido('VENTA_DIRECTA');
        setBloquePedido(null);
      }

      setPizarronAbierto(false);
      setBanner({
        tipo: 'exito',
        mensaje: `Cuenta ${cuenta.account_num || ''} recuperada`.trim(),
      });
    },
    [carrito, setTicketId, setTipoPedido, setBloquePedido, setPizarronAbierto, setBanner],
  );

  // ── Exportar carta a PDF (F12.4) ────────────────────────────────────────────
  const exportarCartaPDF = useCallback(
    (categoriasSeleccionadas) => {
      setExportandoPDF(true);
      const resultado = descargarCatalogoPDF(categoriasSeleccionadas, productos);
      setExportandoPDF(false);
      setSelectorPDFAbierto(false);
      if (resultado.outcome !== 'ok') {
        setBanner({
          tipo: 'error',
          mensaje: `No se pudo generar la carta: ${resultado.reason || 'error'}`,
        });
      }
    },
    [productos, setExportandoPDF, setSelectorPDFAbierto, setBanner],
  );

  // ── Salvaguarda de salida (F9.0.1) ──────────────────────────────────────────
  const intentarSalir = useCallback(() => {
    if (carrito.lineas.length > 0) { setSalidaAbierta(true); return; }
    onBackToTerminals?.();
  }, [carrito.lineas.length, onBackToTerminals, setSalidaAbierta]);

  const salirEnviandoAlPizarron = useCallback(() => {
    setSalidaAbierta(false);
    onBackToTerminals?.();
  }, [onBackToTerminals, setSalidaAbierta]);

  const salirSinEnviar = useCallback(async () => {
    setSalidaAbierta(false);
    try { await carrito.clearCart(); } catch { /* salir igual */ }
    onBackToTerminals?.();
  }, [carrito, onBackToTerminals, setSalidaAbierta]);

  // ── Aplicar IA de voz al carrito (F7.5.2) ──────────────────────────────────
  const aplicarVoz = useCallback(
    async (lineasVoz) => {
      const validas = (lineasVoz || []).filter((l) => l.resuelto && l.producto);
      if (validas.length === 0) return;
      const idTicket = await asegurarTicket();
      if (!idTicket) return;
      validas.forEach((l) => {
        carrito.anadirLinea({
          ticket_id: idTicket,
          product_id: l.producto.id,
          name: l.producto.name,
          quantity: l.cantidad || 1,
          unit_price: Number(l.producto.price),
        });
      });
    },
    [asegurarTicket, carrito],
  );

  // ── Aplicar IA de visión al carrito (F7.6) ──────────────────────────────────
  const aplicarVision = useCallback(
    async (sugerencia) => {
      if (!sugerencia?.resuelto || !sugerencia.producto) return;
      const idTicket = await asegurarTicket();
      if (!idTicket) return;
      await persistirLinea({
        ticket_id: idTicket,
        product_id: sugerencia.producto.id,
        name: sugerencia.producto.name,
        quantity: 1,
        unit_price: Number(sugerencia.producto.price),
      });
    },
    [asegurarTicket, persistirLinea],
  );

  // ── Filtro por categoría (useMemo, derivado puro) ───────────────────────────
  // Se expone aquí para que el componente raíz no necesite importar useMemo.
  const productosVisibles = useMemo(() => {
    // categoriaActiva se pasa desde afuera al llamar al hook — se lee
    // del closure cuando el componente lo usa directamente. Esta función
    // se exporta vacía; el componente aplica su propio filtro.
    return null; // señal: el componente calcula su propio filtro.
  }, []);

  return {
    // Carrito
    agregarProducto,
    incrementar,
    decrementar,
    quitar,
    cambiarCantidad,
    // Persistencia
    asegurarTicket,
    persistirLinea,
    // Barcode
    alEscanear,
    // Checkout
    abrirCheckoutConGuardia,
    confirmarCobro,
    empaqueRequerido,
    empaqueEnCarrito,
    // Pedido
    guardarPedido,
    manejarProgramarDesdeAviso,
    manejarEnviarComoVentaDirecta,
    // Pizarrón
    enviarCuentaAlPizarron: null, // se asigna post-creación (ciclo enviarCuentaRef)
    recuperarCuentaAlCarrito,
    // Salida
    intentarSalir,
    salirEnviandoAlPizarron,
    salirSinEnviar,
    // PDF
    exportarCartaPDF,
    // IA
    aplicarVoz,
    aplicarVision,
  };
}
