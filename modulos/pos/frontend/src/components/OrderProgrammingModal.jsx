/**
 * `OrderProgrammingModal` — programación del pedido (F7.5.5).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UX HEREDADA DEL VIEJO POS (§6.8 del Plan Maestro)
 * ─────────────────────────────────────────────────────────────────────────────
 * "Cuando un componente ya existe en el viejo POS, su INTEGRACIÓN se hereda;
 *  solo su IMPLEMENTACIÓN se reescribe."
 *
 * La UX heredada de `apps/pos/components/ProgramacionPedidoModal.jsx` es:
 *   1. Selector de tipo de entrega: PICKUP (🏪) | DOMICILIO (🚗).
 *   2. Aviso de "fecha más próxima posible" calculada por el sistema.
 *   3. Fecha y hora compromiso (`datetime-local`, con `min` = la más próxima).
 *   4. Nombre + teléfono del cliente (obligatorios).
 *   5. Empaque: PROPIO (🛍️) | VENTA (📦).
 *   6. Dirección de entrega (solo si DOMICILIO).
 *   7. Notas adicionales (opcional).
 *   8. Botón "Guardar Pedido Tentativo" (deshabilitado hasta completar).
 *   9. Pantalla de confirmación ("Pedido Tentativo Registrado").
 *
 * Lo que se reescribe (implementación, no UX):
 *   - Los tokens de diseño son los del POS nuevo (`bg-fondo-panel`,
 *     `text-crema-ticket`, `rounded-canon40`, `min-h-tactil`, `bg-acento`).
 *   - El payload que devuelve `onGuardar` es el bloque `order_*` del contrato 3
 *     (lo arma `construirBloquePedido`), NO el payload del viejo POS.
 *   - No agrega empaques al carrito (eso es responsabilidad del POS, no del
 *     modal): el modal solo captura los datos del pedido.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SRP
 * ─────────────────────────────────────────────────────────────────────────────
 * Solo captura los datos del pedido. NO cobra, NO modifica el carrito, NO
 * escribe en la red. Devuelve el bloque `order_*` a quien lo monta.
 *
 * @see PLAN_DE_ABORDAJE_F7_5_INTEGRACION.md §F7.5.5
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §6.8 (UX heredada)
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  TIPOS_ENTREGA,
  TIPOS_EMPAQUE,
  construirBloquePedido,
} from '../hooks/useOrderProgramming.js';

/** Horas de anticipación por defecto si el producto no declara su plazo. */
const HORAS_ANTICIPACION_POR_DEFECTO = 4;

/**
 * Calcula el tiempo máximo de anticipación entre los ítems del carrito (horas).
 * Heredado del viejo POS (`calcMaxLeadTime`): si hay varios plazos, gana el
 * más largo. Si el carrito está vacío, aplica el default.
 *
 * @param {Array<object>} lineas
 * @returns {number} horas de anticipación
 */
export function calcularAnticipacionMaxima(lineas = []) {
  const max = lineas.reduce((acc, linea) => {
    const horas =
      linea?.technical_sheet?.order_lead_time_hours ??
      linea?.order_lead_time_hours ??
      HORAS_ANTICIPACION_POR_DEFECTO;
    return Math.max(acc, Number(horas) || 0);
  }, 0);
  return max || HORAS_ANTICIPACION_POR_DEFECTO;
}

/** Convierte un `Date` a string `datetime-local` (ISO sin zona). */
export function aIsoLocal(fecha) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(
    fecha.getDate(),
  )}T${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;
}

/** Formatea un `Date` a una cadena legible en español. */
export function formatearFechaHora(fecha) {
  return fecha.toLocaleString('es-MX', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Botón de opción (segmento) reutilizable para los selectores. */
function OpcionSegmento({ activo, onClick, children, acento = 'acento' }) {
  const claseActivo =
    acento === 'verde'
      ? 'bg-acento text-fondo-profundo shadow-lg'
      : 'bg-acento text-fondo-profundo shadow-lg';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`min-h-tactil px-5 rounded-canon35 text-xs font-bold uppercase tracking-widest transition-all ${
        activo ? claseActivo : 'text-crema-ticket/50 hover:text-crema-ticket'
      }`}
    >
      {children}
    </button>
  );
}

/** Campo de texto etiquetado. */
function Campo({ etiqueta, id, valor, onChange, tipo = 'text', placeholder = '' }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase text-crema-ticket/60 tracking-widest pl-2">
        {etiqueta}
      </span>
      <input
        id={id}
        type={tipo}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-1 min-h-tactil bg-fondo-profundo/40 border border-white/10 rounded-canon35 px-4 text-crema-ticket font-bold outline-none focus:border-acento transition-colors placeholder-crema-ticket/20"
      />
    </label>
  );
}

/**
 * @param {object} props
 * @param {Array<object>} [props.lineas] - líneas del carrito (para el plazo)
 * @param {string} [props.numeroCuenta] - folio/CTA en curso (solo informativo)
 * @param {object} [props.datosIniciales] - pedido ya existente (contrato 16)
 * @param {(bloque: object) => void} props.onGuardar - recibe el bloque `order_*`
 * @param {() => void} props.onCerrar - cierra sin guardar
 */
export default function OrderProgrammingModal({
  lineas = [],
  numeroCuenta = '',
  datosIniciales = null,
  onGuardar,
  onCerrar,
  // P5 — Porcentaje mínimo de pago para enviar el pedido a preparación.
  // Se lee desde Vista General; default 100 si no se proporciona.
  porcentajePagoMinimo = 100,
}) {
  const [tipoEntrega, setTipoEntrega] = useState(
    datosIniciales?.delivery_type || TIPOS_ENTREGA.PICKUP,
  );
  const [empaque, setEmpaque] = useState(
    datosIniciales?.packaging_type || TIPOS_EMPAQUE.PROPIO,
  );
  const [formulario, setFormulario] = useState({
    customer_name: datosIniciales?.customer_name || '',
    customer_phone: datosIniciales?.customer_phone || '',
    committed_at: datosIniciales?.committed_at
      ? aIsoLocal(new Date(datosIniciales.committed_at))
      : '',
    delivery_address: datosIniciales?.delivery_address || '',
    // BUG-04 — el bloque `order_*` (contrato 3) nombra las notas `order_notes`,
    // no `notes`. Leer `notes` dejaba el campo vacío al reabrir el modal sobre
    // un pedido recuperado del pizarrón. Se acepta `notes` como respaldo por
    // compatibilidad con cualquier consumidor que use el nombre corto.
    order_notes: datosIniciales?.order_notes || datosIniciales?.notes || '',
  });
  const [guardando, setGuardando] = useState(false);
  const [confirmado, setConfirmado] = useState(false);

  // Fecha más próxima posible = ahora + el plazo más largo del carrito.
  const fechaMasProxima = useMemo(() => {
    const horas = calcularAnticipacionMaxima(lineas);
    return new Date(Date.now() + horas * 60 * 60 * 1000);
  }, [lineas]);

  // Pre-llena la fecha compromiso con la más próxima SOLO si no hay una previa.
  useEffect(() => {
    if (!datosIniciales?.committed_at) {
      setFormulario((prev) =>
        prev.committed_at ? prev : { ...prev, committed_at: aIsoLocal(fechaMasProxima) },
      );
    }
  }, [fechaMasProxima, datosIniciales]);

  const puedeGuardar =
    formulario.customer_name.trim() !== '' &&
    formulario.customer_phone.trim() !== '' &&
    formulario.committed_at !== '' &&
    // H1-FIX: la dirección es OBLIGATORIA si el tipo de entrega es DOMICILIO.
    // Un pedido a domicilio sin dirección no se puede preparar ni entregar.
    (tipoEntrega !== TIPOS_ENTREGA.DELIVERY ||
      formulario.delivery_address.trim() !== '');

  function actualizar(campo, valor) {
    setFormulario((prev) => ({ ...prev, [campo]: valor }));
  }

  function manejarGuardar() {
    if (!puedeGuardar || guardando) return;
    setGuardando(true);
    const bloque = construirBloquePedido({
      order_type: 'PEDIDO',
      order_status: 'PROGRAMADO PARA SER PREPARADO',
      delivery_type: tipoEntrega,
      packaging_type: empaque,
      customer_name: formulario.customer_name.trim(),
      customer_phone: formulario.customer_phone.trim(),
      committed_at: formulario.committed_at
        ? new Date(formulario.committed_at).toISOString()
        : null,
      delivery_address:
        tipoEntrega === TIPOS_ENTREGA.DELIVERY
          ? formulario.delivery_address.trim()
          : null,
      order_notes: formulario.order_notes.trim() || null,
    });
    setConfirmado(true);
    // Breve pausa para que el cajero vea la confirmación antes de continuar.
    setTimeout(() => onGuardar?.(bloque), 1200);
  }

  if (confirmado) {
    return (
      <div className="fixed inset-0 z-50 bg-fondo-profundo/85 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pedido tentativo registrado"
          className="w-full max-w-[420px] bg-fondo-panel text-crema-ticket rounded-canon40 p-8 flex flex-col gap-3 text-center"
        >
          <div className="text-6xl">📦</div>
          <h2 className="text-xl font-bold text-acento uppercase tracking-tight">
            Pedido Tentativo Registrado
          </h2>
          <p className="text-sm text-crema-ticket/70 leading-relaxed">
            El sistema procesará el pedido{' '}
            <strong className="text-acento">
              {porcentajePagoMinimo >= 100
                ? 'solo cuando el pago sea recibido al 100%.'
                : `cuando se cubra al menos el ${porcentajePagoMinimo}% del total.`}
            </strong>
            <br />
            <br />
            El cajero podrá confirmar los detalles con el cliente antes de cobrar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-fondo-profundo/85 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Programación del pedido"
        className="w-full max-w-[640px] max-h-[90vh] bg-fondo-panel text-crema-ticket rounded-canon40 flex flex-col"
      >
        {/* Encabezado */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-white/5">
          <div>
            <h2 className="text-2xl font-bold uppercase tracking-tight">
              Programación del <span className="text-acento">Pedido</span>
            </h2>
            {numeroCuenta ? (
              <p className="text-[10px] font-bold text-acento/60 uppercase tracking-widest mt-1">
                CTA #{String(numeroCuenta).slice(-3)} • {lineas.length} artículo(s)
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="min-h-tactil min-w-tactil rounded-full bg-white/5 hover:bg-white/10 text-crema-ticket/60 hover:text-crema-ticket transition-all"
          >
            ✕
          </button>
        </div>

        {/* Contenido scrollable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Tipo de entrega */}
          <div>
            <p className="text-[11px] font-bold uppercase text-crema-ticket/60 tracking-widest mb-2">
              Tipo de Entrega
            </p>
            <div className="flex bg-fondo-profundo/40 border border-white/10 rounded-canon35 p-1 gap-1 w-fit">
              <OpcionSegmento
                activo={tipoEntrega === TIPOS_ENTREGA.PICKUP}
                onClick={() => setTipoEntrega(TIPOS_ENTREGA.PICKUP)}
              >
                🏪 Pick Up
              </OpcionSegmento>
              <OpcionSegmento
                activo={tipoEntrega === TIPOS_ENTREGA.DELIVERY}
                onClick={() => setTipoEntrega(TIPOS_ENTREGA.DELIVERY)}
              >
                🚗 Domicilio
              </OpcionSegmento>
            </div>
          </div>

          {/* Fecha más próxima posible */}
          <div className="bg-acento/10 border border-acento/20 rounded-canon35 px-5 py-3 flex items-center gap-3">
            <span className="text-lg flex-shrink-0">🕒</span>
            <div>
              <p className="text-[10px] font-bold text-acento/70 uppercase tracking-widest">
                Fecha más próxima posible (cálculo del sistema)
              </p>
              <p className="text-sm font-bold text-acento">
                {formatearFechaHora(fechaMasProxima)}
              </p>
            </div>
          </div>

          {/* Fecha y hora compromiso */}
          <label className="block">
            <span className="text-[11px] font-bold uppercase text-crema-ticket/60 tracking-widest pl-2">
              📅 Fecha y Hora Compromiso de Entrega
            </span>
            <input
              id="input-committed-at"
              type="datetime-local"
              value={formulario.committed_at}
              onChange={(e) => actualizar('committed_at', e.target.value)}
              min={aIsoLocal(fechaMasProxima)}
              className="w-full mt-1 min-h-tactil bg-fondo-profundo/40 border border-white/10 rounded-canon35 px-4 text-crema-ticket font-bold outline-none focus:border-acento transition-colors"
            />
          </label>

          {/* Datos del cliente */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Campo
              etiqueta="Nombre del Cliente"
              id="input-customer-name"
              valor={formulario.customer_name}
              onChange={(v) => actualizar('customer_name', v)}
              placeholder="Ej: María García"
            />
            <Campo
              etiqueta="Teléfono"
              id="input-customer-phone"
              valor={formulario.customer_phone}
              onChange={(v) => actualizar('customer_phone', v)}
              tipo="tel"
              placeholder="Ej: 312 123 4567"
            />
          </div>

          {/* Empaque */}
          <div>
            <p className="text-[11px] font-bold uppercase text-crema-ticket/60 tracking-widest mb-2">
              📦 Empaque
            </p>
            <div className="flex bg-fondo-profundo/40 border border-white/10 rounded-canon35 p-1 gap-1 w-fit">
              <OpcionSegmento
                activo={empaque === TIPOS_EMPAQUE.PROPIO}
                onClick={() => setEmpaque(TIPOS_EMPAQUE.PROPIO)}
              >
                🛍️ Empaque Propio del Cliente
              </OpcionSegmento>
              <OpcionSegmento
                activo={empaque !== TIPOS_EMPAQUE.PROPIO}
                onClick={() => setEmpaque(TIPOS_EMPAQUE.CAJA)}
              >
                📦 Vender Empaque
              </OpcionSegmento>
            </div>
          </div>

          {/* Dirección de entrega (solo domicilio) */}
          {tipoEntrega === TIPOS_ENTREGA.DELIVERY ? (
            <label className="block">
              <span className="text-[11px] font-bold uppercase text-crema-ticket/60 tracking-widest pl-2">
                📍 Dirección de Entrega{' '}
                <span className="text-red-400">*</span>
              </span>
              <textarea
                id="input-delivery-address"
                value={formulario.delivery_address}
                onChange={(e) => actualizar('delivery_address', e.target.value)}
                placeholder="Calle, número, colonia, referencias..."
                rows={3}
                className={`w-full mt-1 bg-fondo-profundo/40 border rounded-canon35 px-4 py-3 text-crema-ticket font-bold outline-none focus:border-acento transition-colors placeholder-crema-ticket/20 resize-none ${
                  formulario.delivery_address.trim() === ''
                    ? 'border-red-400/50 focus:border-red-400'
                    : 'border-white/10'
                }`}
              />
              {formulario.delivery_address.trim() === '' && (
                <p className="text-[10px] text-red-400 mt-1 pl-2">
                  La dirección es obligatoria para entregas a domicilio
                </p>
              )}
            </label>
          ) : null}

          {/* Notas */}
          <Campo
            etiqueta="Notas adicionales (opcional)"
            id="input-notes"
            valor={formulario.order_notes}
            onChange={(v) => actualizar('order_notes', v)}
            placeholder="Ej: Sin azúcar, entregar antes de las 10am..."
          />
        </div>

        {/* Pie con el botón Guardar */}
        <div className="p-6 pt-4 border-t border-white/5">
          <button
            type="button"
            id="btn-guardar-pedido"
            onClick={manejarGuardar}
            disabled={!puedeGuardar || guardando}
            className={`w-full min-h-tactil rounded-canon35 font-bold uppercase tracking-widest transition-all ${
              puedeGuardar
                ? 'bg-acento text-fondo-profundo hover:opacity-90 active:scale-95'
                : 'bg-white/5 text-crema-ticket/20 cursor-not-allowed'
            }`}
          >
            {guardando ? 'Guardando...' : '📌 Guardar Pedido Tentativo'}
          </button>
          {!puedeGuardar ? (
            <p className="text-center text-[10px] text-crema-ticket/30 mt-2 uppercase tracking-widest">
              {tipoEntrega === TIPOS_ENTREGA.DELIVERY && formulario.delivery_address.trim() === ''
                ? 'Completa nombre, teléfono, fecha de entrega y dirección para continuar'
                : 'Completa nombre, teléfono y fecha de entrega para continuar'}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
