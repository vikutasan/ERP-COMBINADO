/**
 * useCheckout — estado de los pagos mixtos en el cobro (FASE 9.1.2).
 *
 * Responsabilidad: mantener la lista de abonos que el cajero va agregando,
 * exponer el resumen en vivo (abonado / faltante / cambio) y decidir si ya se
 * puede cobrar. NO habla con la red: eso lo hace el componente con el servicio
 * de cobro (`checkoutService.construirPaymentDetails`) y `useTicketActions`.
 *
 * Por qué un hook y no estado dentro del componente:
 *   - La lógica de "¿ya cuadra?" es la misma que la del backend (RN-94). Aquí
 *     se calcula en vivo para que el botón de cobro se habilite/deshabilite
 *     sin esperar al servidor.
 *   - Es inyectable: los tests montan el hook con `renderHook` y verifican
 *     agregar/editar/borrar sin tocar la red.
 *
 * Reglas duras que este hook respeta:
 *   - Prohibición #3: los callbacks leen de `useRef`, nunca de estado cerrado.
 *   - El hook NUNCA lanza: toda operación devuelve un valor inspeccionable.
 *   - DT-02 (Dinero): los montos se manejan como números en memoria y se
 *     serializan a String SOLO al construir el payload (lo hace el servicio).
 *
 * @see PLAN_DE_ABORDAJE_FASE_9_1_PAGOS_MIXTOS.md §3.3 (Sub-fase 9.1.2)
 * @see ../services/checkoutService.js
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { resumenDePagos } from '../services/checkoutService.js';

/** Genera un id estable para un abono (para editar/borrar por id). */
export function nuevoAbonoId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `abono-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {object} [opciones]
 * @param {number|string} [opciones.total] - el total del ticket a cubrir.
 * @param {string} [opciones.cajero] - nombre del cajero (se adjunta al payload).
 * @returns {object} estado y acciones de los pagos mixtos
 */
export function useCheckout(opciones = {}) {
  const { total = 0, cajero = null } = opciones;

  const [abonos, setAbonos] = useState([]);

  // Refs espejo: los callbacks leen SIEMPRE de aquí (prohibición #3).
  const abonosRef = useRef(abonos);
  const totalRef = useRef(total);
  const cajeroRef = useRef(cajero);

  abonosRef.current = abonos;
  totalRef.current = total;
  cajeroRef.current = cajero;

  /** Resumen en vivo: abonado, faltante, cambio y si ya cuadra. */
  const resumen = useMemo(() => resumenDePagos(abonos, total), [abonos, total]);

  /**
   * Agrega un abono. Devuelve el abono creado (con su id) o `null` si el
   * método/monto no son válidos. Nunca lanza.
   *
   * @param {{metodo: string, monto: number|string, recibido?: number|string}} abono
   * @returns {object|null}
   */
  const agregarPago = useCallback((abono) => {
    const metodo = String((abono && abono.metodo) ?? '').trim().toUpperCase();
    const monto = Number(abono && abono.monto);
    if (!metodo || !Number.isFinite(monto) || monto <= 0) {
      return null;
    }
    const nuevo = {
      id: nuevoAbonoId(),
      metodo,
      monto,
      recibido:
        metodo === 'EFECTIVO' && Number.isFinite(Number(abono.recibido))
          ? Number(abono.recibido)
          : null,
    };
    setAbonos((prev) => [...prev, nuevo]);
    return nuevo;
  }, []);

  /**
   * Edita un abono existente por id. Devuelve `true` si lo encontró y aplicó.
   *
   * @param {string} id
   * @param {{metodo?: string, monto?: number|string, recibido?: number|string}} cambios
   * @returns {boolean}
   */
  const editarPago = useCallback((id, cambios = {}) => {
    const actuales = abonosRef.current;
    const existe = actuales.some((a) => a.id === id);
    if (!existe) return false;

    setAbonos((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const metodo = cambios.metodo
          ? String(cambios.metodo).trim().toUpperCase()
          : a.metodo;
        const monto =
          cambios.monto !== undefined && Number.isFinite(Number(cambios.monto))
            ? Number(cambios.monto)
            : a.monto;
        const recibido =
          metodo === 'EFECTIVO'
            ? cambios.recibido !== undefined && Number.isFinite(Number(cambios.recibido))
              ? Number(cambios.recibido)
              : a.recibido
            : null;
        return { ...a, metodo, monto, recibido };
      })
    );
    return true;
  }, []);

  /**
   * Borra un abono por id. Devuelve `true` si lo encontró y quitó.
   *
   * @param {string} id
   * @returns {boolean}
   */
  const borrarPago = useCallback((id) => {
    const existe = abonosRef.current.some((a) => a.id === id);
    if (!existe) return false;
    setAbonos((prev) => prev.filter((a) => a.id !== id));
    return true;
  }, []);

  /** Vacía la lista de abonos (tras un cobro exitoso o al cancelar). */
  const limpiarPagos = useCallback(() => {
    setAbonos([]);
  }, []);

  /**
   * Construye el `payment_details` canónico con el servicio. Devuelve el
   * contrato `{outcome, reason, data}` (nunca lanza).
   *
   * @returns {{outcome: string, reason: string|null, data: object|null}}
   */
  const construirPayload = useCallback(async () => {
    const { construirPaymentDetails } = await import('../services/checkoutService.js');
    return construirPaymentDetails({
      abonos: abonosRef.current,
      total: totalRef.current,
      cajero: cajeroRef.current,
    });
  }, []);

  return {
    abonos,
    resumen,
    puedeCobrar: resumen.cuadra && abonos.length > 0,
    cambio: resumen.cambio,
    faltante: resumen.faltante,
    agregarPago,
    editarPago,
    borrarPago,
    limpiarPagos,
    construirPayload,
  };
}

export default useCheckout;
