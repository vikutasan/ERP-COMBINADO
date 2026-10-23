/**
 * useOrderProgramming — estado de la programación de un pedido (F7.5.4).
 *
 * Expone la lectura del pedido asociado a un ticket (contrato 16) y el estado
 * de la programación que el POS envía al CREAR el ticket (los 9 campos
 * `order_*` del contrato 3). Es la pieza que conecta el modal de programación
 * (F7.5.5) con el backend del puente POS → Pedidos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Qué NO hace este hook
 * ─────────────────────────────────────────────────────────────────────────────
 * NO escribe el pedido: la ESCRITURA (contrato 15) es la proyección interna que
 * el backend hace en la MISMA transacción del ticket. El POS solo:
 *   1. Al CREAR el ticket, adjunta los campos `order_*` (los arma el modal).
 *   2. Al LEER un pedido ya creado, usa `cargarPedido(ticketId)` (contrato 16).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROHIBICIÓN #3 — nada de leer estado en callbacks asíncronos
 * ─────────────────────────────────────────────────────────────────────────────
 * Los callbacks leen de `useRef`, nunca del estado cerrado por el closure.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * H1 — dependencias primitivas
 * ─────────────────────────────────────────────────────────────────────────────
 * El `useEffect` depende de `ticketId` (string primitivo), no de un objeto
 * recreado en cada render. Así no entra en un bucle de fetch infinito.
 *
 * @see PLAN_DE_ABORDAJE_F7_5_INTEGRACION.md §F7.5.4
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §5 (Prohibición #3, H1)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as servicio from '../services/ordersService.js';
import { esOk } from '../utils/outcome.js';

/**
 * Los tipos de pedido válidos (contrato 3, campo `order_type`).
 * `VENTA_DIRECTA` es el default: no genera pedido.
 */
export const TIPOS_PEDIDO = Object.freeze({
  VENTA_DIRECTA: 'VENTA_DIRECTA',
  PEDIDO: 'PEDIDO',
});

/**
 * Los tipos de entrega válidos (contrato 15, campo `delivery_type`).
 */
export const TIPOS_ENTREGA = Object.freeze({
  PICKUP: 'PICKUP',
  DELIVERY: 'DELIVERY',
});

/**
 * Los tipos de empaque válidos (contrato 15, campo `packaging_type`).
 */
export const TIPOS_EMPAQUE = Object.freeze({
  PROPIO: 'PROPIO',
  CAJA: 'CAJA',
  BOLSA: 'BOLSA',
});

/**
 * Construye el bloque `order_*` que se adjunta al crear el ticket (contrato 3).
 *
 * Es una función PURA: no toca red ni estado. El modal (F7.5.5) la usa para
 * armar el cuerpo del POST /pos/tickets. Si el formulario está vacío o el tipo
 * es `VENTA_DIRECTA`, devuelve `{}` (el backend aplica sus defaults).
 *
 * @param {object} formulario
 * @returns {object} el bloque `order_*` listo para el POST
 */
export function construirBloquePedido(formulario = {}) {
  const tipo = formulario.order_type || TIPOS_PEDIDO.VENTA_DIRECTA;
  if (tipo === TIPOS_PEDIDO.VENTA_DIRECTA) {
    return {};
  }
  const bloque = {
    order_type: tipo,
    order_status: formulario.order_status || 'PROGRAMADO PARA SER PREPARADO',
    delivery_type: formulario.delivery_type || TIPOS_ENTREGA.PICKUP,
    packaging_type: formulario.packaging_type || TIPOS_EMPAQUE.PROPIO,
  };
  // Los campos opcionales solo se envían si traen valor (no se mandan nulls).
  if (formulario.customer_name) bloque.customer_name = formulario.customer_name;
  if (formulario.customer_phone) bloque.customer_phone = formulario.customer_phone;
  if (formulario.committed_at) bloque.committed_at = formulario.committed_at;
  if (formulario.delivery_address) bloque.delivery_address = formulario.delivery_address;
  if (formulario.order_notes) bloque.order_notes = formulario.order_notes;
  return bloque;
}

/**
 * @param {object} [opciones]
 * @param {string} [opciones.ticketId] - ticket cuyo pedido se lee (opcional)
 * @param {object} [opciones.servicioPedidos] - inyectable para tests
 * @returns {{
 *   pedido: object|null,
 *   cargando: boolean,
 *   error: string|null,
 *   cargarPedido: (ticketId: string) => Promise<{outcome: string, reason: string|null, data: object|null}>,
 *   limpiar: () => void,
 * }}
 */
export function useOrderProgramming(opciones = {}) {
  const { ticketId = '', servicioPedidos = servicio } = opciones;

  const [pedido, setPedido] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  // Refs: los callbacks asíncronos leen de aquí, no del estado cerrado.
  const servicioRef = useRef(servicioPedidos);
  servicioRef.current = servicioPedidos;

  // Guardia de desmontaje: evita escribir estado tras desmontar (cleanup).
  const vivoRef = useRef(true);
  useEffect(() => {
    vivoRef.current = true;
    return () => {
      vivoRef.current = false;
    };
  }, []);

  /**
   * Lee el pedido de un ticket (contrato 16). No lanza: el servicio ya
   * devuelve `{outcome, reason}`. Un 404 se traduce a `reason='sin_pedido'`.
   */
  const cargarPedido = useCallback(async (id) => {
    const limpio = typeof id === 'string' ? id.trim() : '';
    if (!limpio) {
      return { outcome: 'error', reason: 'ticket_invalido', data: null };
    }

    setCargando(true);
    const r = await servicioRef.current.obtenerPedidoDelTicket(limpio);
    if (!vivoRef.current) return r;

    if (esOk(r)) {
      setPedido(r.data ?? null);
      setError(null);
    } else {
      setPedido(null);
      setError(r.reason || 'error_desconocido');
    }
    setCargando(false);
    return r;
  }, []);

  /** Limpia el estado (al cerrar el modal o cambiar de ticket). */
  const limpiar = useCallback(() => {
    setPedido(null);
    setError(null);
    setCargando(false);
  }, []);

  // Carga inicial y recarga al cambiar de ticket (H1: dep primitiva).
  useEffect(() => {
    if (ticketId) {
      cargarPedido(ticketId);
    } else {
      limpiar();
    }
  }, [ticketId, cargarPedido, limpiar]);

  return { pedido, cargando, error, cargarPedido, limpiar };
}

export default useOrderProgramming;
