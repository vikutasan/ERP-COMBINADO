/**
 * useCustomerIdentification — identificación del cliente al cobrar (F8.3).
 *
 * Gestiona el estado de la identificación por teléfono: el cliente identificado,
 * sus beneficios (contrato 26), el estado de carga y el error. Expone una acción
 * `identificar(telefono)` y una acción `limpiar()`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEGRADACIÓN DT-07 — el CRM caído NO bloquea la venta
 * ─────────────────────────────────────────────────────────────────────────────
 * Si el CRM no está disponible (503 → `crm_no_disponible`), el hook NO lanza ni
 * deja el POS en un estado roto: deja `cliente = null`, `beneficios = null` y
 * `error = 'crm_no_disponible'`. El cajero puede seguir cobrando a precio de
 * lista (RN-87). El panel (F8.4) muestra el aviso sin alarmar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROHIBICIÓN #3 — nada de leer estado en callbacks asíncronos
 * ─────────────────────────────────────────────────────────────────────────────
 * Los callbacks leen de `useRef`, nunca del estado cerrado por el closure. Si
 * `identificar` leyera el servicio del estado, una llamada disparada justo antes
 * de un cambio de servicio escribiría con la referencia vieja.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * H1 — dependencias primitivas
 * ─────────────────────────────────────────────────────────────────────────────
 * El hook NO dispara fetch al montar: la identificación es una acción explícita
 * del cajero (teclear el teléfono y pulsar buscar). Por eso no hay `useEffect`
 * de carga inicial y no hay riesgo de bucle.
 *
 * @see PLAN_DE_ABORDAJE_FASE_8_POR_PARTES.md §3.4 (Sub-fase 8.3)
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §5 (Prohibición #3, H1)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as servicio from '../services/benefitsService.js';
import { esOk } from '../utils/outcome.js';

/**
 * @param {object} [opciones]
 * @param {object} [opciones.servicioBeneficios] - inyectable para tests
 * @returns {{
 *   cliente: object|null,
 *   beneficios: object|null,
 *   cargando: boolean,
 *   error: string|null,
 *   identificar: (telefono: string, items?: Array<object>) => Promise<{outcome: string, reason: string|null, data: object|null}>,
 *   limpiar: () => void,
 * }}
 */
export function useCustomerIdentification(opciones = {}) {
  const { servicioBeneficios = servicio } = opciones;

  const [cliente, setCliente] = useState(null);
  const [beneficios, setBeneficios] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  // Refs: los callbacks asíncronos leen de aquí, no del estado cerrado.
  const servicioRef = useRef(servicioBeneficios);
  servicioRef.current = servicioBeneficios;

  // Guardia de desmontaje: evita escribir estado tras desmontar (cleanup).
  const vivoRef = useRef(true);
  useEffect(() => {
    vivoRef.current = true;
    return () => {
      vivoRef.current = false;
    };
  }, []);

  /**
   * Identifica al cliente por teléfono y trae sus beneficios (contrato 26).
   *
   * No lanza: el servicio ya devuelve `{outcome, reason, data}`. Devuelve el
   * mismo `outcome` para que el llamador (el panel) pueda decidir sin try/catch.
   *
   * @param {string} telefono
   * @param {Array<object>} [items] - el carrito actual, para que el CRM calcule
   * @returns {Promise<{outcome: string, reason: string|null, data: object|null}>}
   */
  const identificar = useCallback(async (telefono, items = []) => {
    const tel = typeof telefono === 'string' ? telefono.trim() : '';

    // Guarda local: sin teléfono no se llama al CRM. No es un error de red,
    // es una entrada incompleta; se devuelve un outcome inspeccionable.
    if (!tel) {
      if (vivoRef.current) {
        setCliente(null);
        setBeneficios(null);
        setError('telefono_requerido');
        setCargando(false);
      }
      return { outcome: 'error', reason: 'telefono_requerido', data: null };
    }

    if (vivoRef.current) {
      setCargando(true);
      setError(null);
    }

    const r = await servicioRef.current.obtenerBeneficios({ telefono: tel, items });
    if (!vivoRef.current) return r;

    if (esOk(r)) {
      const datos = r.data || {};
      // El contrato 26 devuelve `customer_id: null` si el cliente no existe.
      // Eso NO es un error: es un cliente nuevo. Se distingue de un fallo.
      if (datos.customer_id) {
        setCliente({
          customer_id: datos.customer_id,
          nombre: datos.nombre ?? null,
          nivel: datos.nivel ?? null,
        });
        setBeneficios(datos);
        setError(null);
      } else {
        setCliente(null);
        setBeneficios(null);
        setError(null);
      }
    } else {
      // Degradación DT-07: el CRM caído deja el POS operable, sin beneficios.
      setCliente(null);
      setBeneficios(null);
      setError(r.reason || 'error_desconocido');
    }
    setCargando(false);
    return r;
  }, []);

  /** Limpia la identificación: vuelve al estado inicial (sin cliente). */
  const limpiar = useCallback(() => {
    setCliente(null);
    setBeneficios(null);
    setError(null);
    setCargando(false);
  }, []);

  return { cliente, beneficios, cargando, error, identificar, limpiar };
}

export default useCustomerIdentification;
