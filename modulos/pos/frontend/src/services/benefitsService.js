/**
 * Servicio de beneficios del cliente — FASE 8.1 (contrato 26).
 *
 * Responsabilidad: exponer la operación de consulta de beneficios envuelta en
 * el contrato `{ outcome, reason, data }`. NUNCA lanza: un fallo de red o un
 * 4xx/5xx del API se traduce a `{ outcome:'error', reason }`.
 *
 * Por qué existe esta capa y no se llama al cliente directo:
 *   - DT-07 (degradación elegante): si el CRM no responde, la venta NO se
 *     bloquea. El servicio devuelve `reason: 'crm_no_disponible'` y el POS
 *     cobra a precio de lista. Un `throw` aquí obligaría a cada llamador a
 *     envolver en try/catch y podría tumbar el cobro por un módulo ajeno.
 *   - El hook (F8.3 useCustomerIdentification) decide con `esOk(resultado)` y
 *     muestra `resultado.reason` en el panel, sin try/catch.
 *
 * Endpoint consumido (contrato 26, proveedor CRM):
 *   POST /crm/benefits/for-ticket
 *     entrada: { telefono, items:[{product_id, qty, unit_price}] }
 *     salida:  { customer_id, nombre, nivel, descuentos, puntos_a_ganar,
 *                puntos_disponibles, puede_canjear }
 *
 * Nota de diseño (DT-02): el dinero viaja como String en el cable. Este
 * servicio NO coerciona los precios — eso lo hace la frontera que arma el
 * carrito (igual que `ProductCard.jsx` con `Number()`). Aquí solo se envuelve
 * la operación; la forma de la respuesta se respeta tal cual la define el
 * contrato.
 *
 * Nota de frontera (A-02): el POS consume el contrato, NUNCA lee la tabla
 * `customers` ni `loyalty_ledger`. Este servicio no conoce ninguna tabla.
 *
 * @see PLAN_DE_ABORDAJE_FASE_8_POR_PARTES.md §3.2 (Sub-fase 8.1)
 * @see FICHA_F8_0_CONTRATOS_Y_REGLAS_CRM.md (el contrato que consume)
 */

import * as cliente from '../api/client.js';
import { aOutcome, fallo } from '../utils/outcome.js';
import { withRetries } from '../utils/withRetries.js';

/**
 * Traduce un error del cliente a un `reason` legible para el cajero.
 *
 * El 503 es el caso clave de DT-07: el CRM no está disponible, pero la venta
 * continúa. Se traduce a `crm_no_disponible` para que el panel lo muestre sin
 * alarmar (no es un error del cajero, es un módulo ausente).
 *
 * @param {Error} err
 * @returns {string}
 */
function motivo(err) {
  if (err && err.name === 'ApiError') {
    if (err.codigo === 0) return 'sin_conexion';
    if (err.codigo === 404) return 'telefono_invalido';
    if (err.codigo === 422) return 'datos_invalidos';
    if (err.codigo === 503) return 'crm_no_disponible';
    return err.message || `error_${err.codigo}`;
  }
  return (err && err.message) || 'error_desconocido';
}

/**
 * POST /crm/benefits/for-ticket — los beneficios de un cliente (contrato 26).
 *
 * Es una lectura determinista para el mismo carrito y el mismo día, así que se
 * reintenta con backoff centralizado (3 intentos, 1s/2s/3s) porque un parpadeo
 * de red no debe costarle al cliente sus puntos.
 *
 * Degradación (DT-07): si el CRM está caído (503) o la red falla, devuelve
 * `{ outcome:'error', reason:'crm_no_disponible' | 'sin_conexion' }`. El POS
 * cobra a precio de lista. NUNCA lanza.
 *
 * @param {{telefono: string, items: Array<{product_id: string, qty: number, unit_price: string}>}} consulta
 * @returns {Promise<{outcome: string, reason: string|null, data: object|null}>}
 */
export function obtenerBeneficios(consulta) {
  const telefono =
    consulta && typeof consulta.telefono === 'string' ? consulta.telefono.trim() : '';

  // Guarda local: sin teléfono no hay a quién preguntar. No se llama al cliente
  // con un teléfono vacío (evita un 404 inútil y un viaje de red).
  if (!telefono) {
    return Promise.resolve(fallo('telefono_requerido', null));
  }

  const items = Array.isArray(consulta.items) ? consulta.items : [];
  const cuerpo = { telefono, items };

  return aOutcome(
    () => withRetries(() => cliente.getBeneficiosParaTicket(cuerpo)),
    motivo
  );
}

export default {
  obtenerBeneficios,
};
