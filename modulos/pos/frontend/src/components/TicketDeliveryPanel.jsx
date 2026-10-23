/**
 * `TicketDeliveryPanel` — paso post-cobro de entrega del ticket (FASE 8.5).
 *
 * Aparece DESPUÉS de que `cobrar()` resolvió. NO es un paso dentro de
 * `CheckoutScreen` (que es el modal de PAGO y se cierra al cobrar): es un
 * overlay del screen, hermano de `OverlayExito`, con el mismo patrón visual.
 *
 * Ofrece cuatro acciones:
 *   - 🖨️ Imprimir  — SIEMPRE disponible (RN-87). Es el comportamiento por defecto.
 *   - 📱 WhatsApp  — adicional; encola el ticket por el contrato #27.
 *   - ✉️ Email     — adicional; encola el ticket por el contrato #27.
 *   - Cerrar       — ÚNICA salida del paso. Cierra el ciclo post-cobro.
 *
 * FIX-BUG15 — Imprimir y enviar YA NO cierran el panel. Antes, en cuanto el
 * operador imprimía o encolaba un envío, el screen limpiaba el ticket y el paso
 * se cerraba: no podía imprimir Y ADEMÁS mandar por WhatsApp/Email. Ahora el
 * panel permanece abierto tras cada acción (con su aviso de resultado) y solo
 * sale por el botón "Cerrar". El operador decide cuántas acciones tomar.
 *
 * Reglas que gobiernan este componente:
 *   - RN-87: el ticket impreso siempre está disponible. Imprimir NUNCA se
 *     deshabilita, aunque Notificaciones esté caído.
 *   - RN-86: el envío es Outbox. Se ENCOLA en la transacción del ticket; el
 *     worker envía después. Un fallo de la cola NO revierte el cobro.
 *   - RN-92: el cajero elige el canal cada vez, pero el sistema PRECARGA el
 *     contacto desde el CRM. Si el cliente está identificado, teléfono/correo
 *     vienen ya puestos y no se vuelven a teclear.
 *   - DT-07 (degradación): si Notificaciones está caído (503) o la red falla,
 *     se muestra el motivo y el POS sigue funcionando. La venta ya está cobrada.
 *   - A-02 (frontera): el POS consume el contrato #27, NUNCA escribe en
 *     `notification_outbox` ni conoce el worker.
 *
 * @see PLAN_DE_ABORDAJE_FASE_8_POR_PARTES.md §3.6 (Sub-fase 8.5)
 * @see notificationsService.js (el contrato #27 que consume)
 * @see printService.js (la impresión, F6.1)
 * @see ticketGenerator.js (el HTML del ticket, F6.0)
 */

import React, { useCallback, useRef, useState } from 'react';

import { encolarTicket } from '../services/notificationsService.js';
import { imprimirTicket } from '../services/printService.js';
import { generarTicketHTML, combinarCopiasPedido } from '../utils/ticketGenerator.js';

/** Formatea un precio numérico como moneda mexicana. */
function formatearPrecio(valor) {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return '$0.00';
  return `$${numero.toFixed(2)}`;
}

/**
 * Traduce un `reason` del servicio de notificaciones a un mensaje legible.
 *
 * No se alarman los casos de degradación: la venta YA se cobró. El mensaje
 * explica qué pasó sin sugerir que algo se perdió.
 *
 * @param {string|null} reason
 * @returns {string}
 */
function mensajeDeEnvio(reason) {
  switch (reason) {
    case 'cola_no_disponible':
      return 'El envío quedó pendiente: el servicio de mensajes no está disponible. El ticket impreso sigue siendo válido.';
    case 'sin_conexion':
      return 'El envío quedó pendiente: no hay conexión. El ticket impreso sigue siendo válido.';
    case 'destinatario_incompleto':
      return 'Falta el dato de contacto para ese canal. Revísalo e inténtalo de nuevo.';
    case 'evento_id_requerido':
      return 'No se pudo preparar el envío (falta el identificador del ticket).';
    default:
      return 'No se pudo encolar el envío. El ticket impreso sigue siendo válido.';
  }
}

/**
 * Panel de entrega del ticket tras el cobro.
 *
 * @param {object} props
 * @param {object} props.ticket - El ticket cobrado (folio, total, líneas).
 * @param {object|null} [props.cliente] - Cliente identificado (CRM), o null.
 *   Se usa para PRECARGAR el contacto (RN-92): `{ telefono, email }`.
 * @param {string} [props.eventoId] - Clave de idempotencia del encolado (RN-86).
 *   Si no se provee, se deriva del folio del ticket.
 * @param {Function} [props.onImprimir] - Callback tras imprimir (opcional).
 * @param {Function} [props.onEnviado] - Callback tras encolar con éxito.
 * @param {Function} [props.onOmitir] - Callback al omitir / cerrar el paso.
 * @param {Function} [props.servicioNotificaciones] - Inyectable (tests).
 * @param {Function} [props.servicioImpresion] - Inyectable (tests).
 * @param {Function} [props.generadorTicket] - Inyectable (tests).
 * @param {Function} [props.generadorDobleCopia] - Inyectable (tests). F12.2.
 */
export default function TicketDeliveryPanel({
  ticket,
  cliente = null,
  eventoId = null,
  onImprimir,
  onEnviado,
  onOmitir,
  servicioNotificaciones = encolarTicket,
  servicioImpresion = imprimirTicket,
  generadorTicket = generarTicketHTML,
  generadorDobleCopia = combinarCopiasPedido,
}) {
  // Precarga del contacto desde el CRM (RN-92). Si el cliente está
  // identificado, el teléfono/correo vienen ya puestos.
  const [telefono, setTelefono] = useState(cliente?.telefono ?? '');
  const [email, setEmail] = useState(cliente?.email ?? '');
  const [enviando, setEnviando] = useState(null); // 'WHATSAPP' | 'EMAIL' | null
  const [aviso, setAviso] = useState(null); // { tipo, texto } | null

  // PROHIBICIÓN #3: los callbacks leen de refs, nunca del estado cerrado por
  // el closure. Tras un `await`, el estado del render anterior está obsoleto.
  const ticketRef = useRef(ticket);
  ticketRef.current = ticket;
  const onImprimirRef = useRef(onImprimir);
  onImprimirRef.current = onImprimir;
  const onEnviadoRef = useRef(onEnviado);
  onEnviadoRef.current = onEnviado;
  const onOmitirRef = useRef(onOmitir);
  onOmitirRef.current = onOmitir;

  /** Deriva la clave de idempotencia del encolado (RN-86). */
  const claveEvento = useCallback(() => {
    if (eventoId) return eventoId;
    const folio = ticketRef.current?.account_num ?? ticketRef.current?.folio ?? '';
    return folio ? `ticket:${folio}` : '';
  }, [eventoId]);

  /**
   * Imprime el ticket. SIEMPRE disponible (RN-87).
   *
   * F12.2 — Hereda la operación del viejo POS (§6.8): un PEDIDO se imprime
   * DOBLE (copia CLIENTE para recoger + copia COMERCIO como respaldo físico
   * por si cae el sistema) en un solo trabajo de impresión; una VENTA DIRECTA
   * se imprime en copia única. El disparador es `order_type === 'PEDIDO'`,
   * igual que en `apps/pos/hooks/useTicketActions.js:89` (viejo POS).
   */
  const manejarImprimir = useCallback(() => {
    const actual = ticketRef.current;
    if (!actual) return;
    const html =
      actual.order_type === 'PEDIDO'
        ? generadorDobleCopia(actual)
        : generadorTicket(actual);
    const resultado = servicioImpresion(html);
    if (resultado && resultado.outcome === 'ok') {
      setAviso({ tipo: 'ok', texto: 'Ticket enviado a la impresora.' });
    } else {
      setAviso({
        tipo: 'error',
        texto: 'No se pudo imprimir. Revisa la impresora e inténtalo de nuevo.',
      });
    }
    onImprimirRef.current?.(resultado);
  }, [generadorTicket, generadorDobleCopia, servicioImpresion]);

  /**
   * Encola el envío por el canal pedido (contrato #27).
   *
   * @param {'WHATSAPP'|'EMAIL'} canal
   */
  const manejarEnviar = useCallback(
    async (canal) => {
      const actual = ticketRef.current;
      if (!actual) return;

      const destinatario =
        canal === 'WHATSAPP' ? { telefono: telefono.trim() } : { email: email.trim() };

      // Guarda local: sin el dato del canal no se llama al contrato (422).
      const dato = canal === 'WHATSAPP' ? destinatario.telefono : destinatario.email;
      if (!dato) {
        setAviso({
          tipo: 'error',
          texto:
            canal === 'WHATSAPP'
              ? 'Escribe un teléfono para enviar por WhatsApp.'
              : 'Escribe un correo para enviar por email.',
        });
        return;
      }

      setEnviando(canal);
      setAviso(null);

      const resultado = await servicioNotificaciones({
        evento_id: claveEvento(),
        ticket_uuid: actual.id ?? actual.ticket_uuid ?? null,
        canales: [canal],
        destinatario,
        payload: {
          folio: actual.account_num ?? actual.folio ?? null,
          total: String(actual.total ?? ''),
          items: Array.isArray(actual.lineas) ? actual.lineas : [],
          fecha: actual.created_at ?? actual.fecha ?? null,
        },
      });

      setEnviando(null);

      if (resultado && resultado.outcome === 'ok') {
        setAviso({
          tipo: 'ok',
          texto:
            canal === 'WHATSAPP'
              ? 'Ticket encolado para WhatsApp.'
              : 'Ticket encolado para email.',
        });
        onEnviadoRef.current?.(canal, resultado);
      } else {
        // Degradación (DT-07): la venta YA se cobró. Solo se informa.
        setAviso({ tipo: 'error', texto: mensajeDeEnvio(resultado?.reason) });
      }
    },
    [claveEvento, email, telefono, servicioNotificaciones]
  );

  /**
   * Cierra el paso. Es la ÚNICA salida del panel (FIX-BUG15): imprimir y enviar
   * ya no cierran, así que el operador sale explícitamente con este botón.
   */
  const manejarCerrar = useCallback(() => {
    onOmitirRef.current?.();
  }, []);

  if (!ticket) return null;

  const folio = ticket.account_num ?? ticket.folio ?? '—';
  const total = formatearPrecio(ticket.total);

  return (
    <div className="fixed inset-0 z-50 bg-fondo-profundo/80 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Entrega del ticket"
        className="w-full max-w-[440px] bg-crema-ticket text-fondo-profundo rounded-canon40 p-6 flex flex-col gap-4"
      >
        <header className="flex flex-col gap-1 text-center">
          <h2 className="text-2xl font-bold">🧾 Entrega del ticket</h2>
          <p className="text-sm">
            Folio <strong>{folio}</strong>
          </p>
          <p className="text-2xl font-bold text-acento">{total}</p>
        </header>

        {cliente && (cliente.nombre || cliente.customer_id) ? (
          <p className="text-xs text-center text-fondo-profundo/70">
            Cliente: <strong>{cliente.nombre ?? cliente.customer_id}</strong>
          </p>
        ) : null}

        {/* 🖨️ Imprimir — SIEMPRE disponible (RN-87). */}
        <button
          type="button"
          id="btn-imprimir"
          onClick={manejarImprimir}
          className="w-full min-h-tactil rounded-canon35 bg-acento text-fondo-profundo font-bold transition-transform duration-75 active:scale-95 active:brightness-90"
        >
          🖨️ Imprimir
        </button>

        {/* 📱 WhatsApp — adicional. Precarga el teléfono del CRM (RN-92). */}
        <div className="flex flex-col gap-2">
          <label htmlFor="input-telefono-entrega" className="text-sm font-semibold">
            📱 WhatsApp
          </label>
          <input
            id="input-telefono-entrega"
            type="tel"
            inputMode="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="Teléfono del cliente"
            className="w-full min-h-tactil rounded-canon35 border border-fondo-profundo/20 bg-white px-3 text-fondo-profundo placeholder-fondo-profundo/40 focus:outline-none focus:ring-2 focus:ring-acento"
          />
          <button
            type="button"
            id="btn-whatsapp"
            onClick={() => manejarEnviar('WHATSAPP')}
            disabled={enviando !== null}
            className="w-full min-h-tactil rounded-canon35 bg-fondo-profundo text-crema-ticket font-bold transition-transform duration-75 active:scale-95 active:brightness-90 disabled:opacity-50 disabled:active:scale-100 disabled:active:brightness-100"
          >
            {enviando === 'WHATSAPP' ? 'Enviando…' : '📱 Enviar por WhatsApp'}
          </button>
        </div>

        {/* ✉️ Email — adicional. Precarga el correo del CRM (RN-92). */}
        <div className="flex flex-col gap-2">
          <label htmlFor="input-email-entrega" className="text-sm font-semibold">
            ✉️ Email
          </label>
          <input
            id="input-email-entrega"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Correo del cliente"
            className="w-full min-h-tactil rounded-canon35 border border-fondo-profundo/20 bg-white px-3 text-fondo-profundo placeholder-fondo-profundo/40 focus:outline-none focus:ring-2 focus:ring-acento"
          />
          <button
            type="button"
            id="btn-email"
            onClick={() => manejarEnviar('EMAIL')}
            disabled={enviando !== null}
            className="w-full min-h-tactil rounded-canon35 bg-fondo-profundo text-crema-ticket font-bold transition-transform duration-75 active:scale-95 active:brightness-90 disabled:opacity-50 disabled:active:scale-100 disabled:active:brightness-100"
          >
            {enviando === 'EMAIL' ? 'Enviando…' : '✉️ Enviar por email'}
          </button>
        </div>

        {aviso ? (
          <p
            role="status"
            className={
              aviso.tipo === 'ok'
                ? 'text-sm text-center text-acento'
                : 'text-sm text-center text-red-700'
            }
          >
            {aviso.texto}
          </p>
        ) : null}

        {/* Cerrar — ÚNICA salida del paso (FIX-BUG15). El id `btn-omitir` se
            conserva por compatibilidad con la puerta F8.5 y el screen. */}
        <button
          type="button"
          id="btn-omitir"
          onClick={manejarCerrar}
          className="w-full min-h-tactil rounded-canon35 border border-fondo-profundo/30 text-fondo-profundo font-semibold transition-transform duration-75 active:scale-95 active:brightness-90"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
