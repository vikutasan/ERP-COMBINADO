/**
 * Servicio de cobro — FASE 9.1.2 (pagos mixtos, frontera del POS).
 *
 * Responsabilidad: construir el `payment_details` CANÓNICO a partir de una
 * lista de abonos de la UI, y validar en la frontera que la suma cuadre el
 * total. Devuelve el contrato `{ outcome, reason, data }` y NUNCA lanza.
 *
 * Por qué existe esta capa (y no se arma el payload en el componente):
 *   - Defensa en profundidad: el backend valida RN-94/RN-95, pero la UI no
 *     debe poder siquiera CONSTRUIR un payload cuya suma no cuadre. El error
 *     se detecta antes de salir del navegador.
 *   - Cicatriz v7.0.3 (cuentas perdidas): una construcción de payload que
 *     lanzara dejaría el cobro en un estado ambiguo. Aquí siempre se devuelve
 *     un valor inspeccionable.
 *   - DT-02 (Dinero): el dinero viaja como String en el cable. Este servicio
 *     coacciona con `Number()` en la frontera y vuelve a serializar a String
 *     con 2 decimales, para no arrastrar errores de coma flotante al backend.
 *
 * Forma canónica producida (la que el backend ya entiende desde F9.1.0):
 *   {
 *     "pagos": [
 *       {"metodo": "EFECTIVO", "monto": "40.00", "recibido": "50.00", "cambio": "10.00"},
 *       {"metodo": "TARJETA",  "monto": "60.00", "tipo": "DEBITO"}
 *     ],
 *     "cajero": "Nombre"
 *   }
 *
 * @see PLAN_DE_ABORDAJE_FASE_9_1_PAGOS_MIXTOS.md §3.3 (Sub-fase 9.1.2)
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §5 (contrato {outcome, reason})
 */

import { ok, fallo } from '../utils/outcome.js';

/** Métodos válidos (espejo de RN-57; el backend es la autoridad final). */
export const METODOS_VALIDOS = Object.freeze([
  'EFECTIVO',
  'CREDITO',
  'DEBITO',
  'TRANSFERENCIA',
]);

/** Métodos que se agrupan bajo la etiqueta "TARJETA" en la UI. */
export const METODOS_TARJETA = Object.freeze(['CREDITO', 'DEBITO']);

/**
 * Redondea a 2 decimales y devuelve String (DT-02: el dinero viaja como String).
 * @param {number|string} valor
 * @returns {string}
 */
export function aMonto(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '0.00';
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * Normaliza el método a mayúsculas y valida que sea uno de los válidos.
 * @param {string} metodo
 * @returns {string|null} el método normalizado, o `null` si es inválido
 */
export function normalizarMetodo(metodo) {
  const m = String(metodo ?? '').trim().toUpperCase();
  return METODOS_VALIDOS.includes(m) ? m : null;
}

/**
 * Calcula el cambio de un abono en efectivo (RN-53: el cambio NO es pago).
 *
 * El abono real es `min(monto, pendiente)`; el cambio es lo que sobra del
 * `recibido`. Si el abono cubre todo el pendiente, el cambio es
 * `recibido − monto`; si no, el cambio es 0 (el efectivo se aplica completo).
 *
 * @param {number} monto - lo que se aplica al total
 * @param {number} recibido - lo que el cliente entrega en efectivo
 * @returns {number} el cambio (>= 0)
 */
export function calcularCambio(monto, recibido) {
  const m = Number(monto) || 0;
  const r = Number(recibido) || 0;
  const cambio = r - m;
  return cambio > 0 ? Math.round(cambio * 100) / 100 : 0;
}

/**
 * Construye el `payment_details` canónico a partir de una lista de abonos.
 *
 * @param {object} entrada
 * @param {Array<{metodo: string, monto: number|string, recibido?: number|string, tipo?: string}>} entrada.abonos
 * @param {number|string} entrada.total - el total del ticket
 * @param {string} [entrada.cajero] - nombre del cajero (opcional)
 * @returns {{outcome: string, reason: string|null, data: object|null}}
 *   - `ok` con `data = { pagos: [...], cajero? }` si la suma cuadra.
 *   - `error` con `reason` legible si algo no cuadra (nunca lanza).
 */
export function construirPaymentDetails({ abonos = [], total = 0, cajero = null } = {}) {
  if (!Array.isArray(abonos) || abonos.length === 0) {
    return fallo('sin_pagos', null);
  }

  const totalNum = Number(total);
  if (!Number.isFinite(totalNum) || totalNum <= 0) {
    return fallo('total_invalido', null);
  }

  const pagos = [];
  for (const abono of abonos) {
    const metodo = normalizarMetodo(abono && abono.metodo);
    if (!metodo) {
      return fallo('metodo_invalido', null);
    }
    // 4ª VUELTA (7 Oct 2026) — Se redondea el monto a 2 decimales ANTES de
    // sumar. `aMonto` ya devuelve String con 2 decimales, pero el `montoNum`
    // crudo puede traer error de coma flotante (p. ej. 99.99000000000001) que
    // se propagaría a `recibido`/`cambio`. Redondear aquí garantiza que la
    // suma de `pagos` sea EXACTA frente al `Decimal` del backend (RN-94).
    const montoNum = Math.round(Number(abono && abono.monto) * 100) / 100;
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      return fallo('monto_invalido', null);
    }

    const pago = { metodo, monto: aMonto(montoNum) };

    // Efectivo: se adjunta `recibido` y `cambio` (el cambio NO es pago).
    if (metodo === 'EFECTIVO') {
      const recibidoNum = Number(abono.recibido);
      const recibido = Number.isFinite(recibidoNum) && recibidoNum > 0 ? recibidoNum : montoNum;
      pago.recibido = aMonto(recibido);
      pago.cambio = aMonto(calcularCambio(montoNum, recibido));
    } else if (metodo === 'CREDITO' || metodo === 'DEBITO') {
      // Tarjeta: se conserva el `tipo` si viene (DEBITO/CREDITO).
      pago.tipo = metodo;
    }

    pagos.push(pago);
  }

  // RN-94 — PRE-CHECK de UX (espejo de la validación del backend).
  //
  // DT-02 regla 6: "El dinero no se suma en el frontend. Los totales vienen del
  // backend." Aquí NO se deriva el total del ticket: `totalNum` es el total que
  // el BACKEND reportó (contrato 21/30, `Numeric(12,2)`), y lo que se suma es la
  // ENTRADA del cajero (los abonos que tecleó), para avisarle ANTES de salir del
  // navegador si no cuadra. La autoridad final sigue siendo el backend (RN-94);
  // este pre-check solo evita un viaje de red inútil. NO es una fuente de verdad
  // del dinero y NO produce el total.
  const suma = pagos.reduce((acc, p) => acc + Number(p.monto), 0);
  const sumaRedondeada = Math.round(suma * 100) / 100;
  const totalRedondeado = Math.round(totalNum * 100) / 100;
  if (sumaRedondeada !== totalRedondeado) {
    return fallo('suma_no_cuadra', { suma: aMonto(sumaRedondeada), total: aMonto(totalRedondeado) });
  }

  const data = { pagos };
  if (typeof cajero === 'string' && cajero.trim()) {
    data.cajero = cajero.trim();
  }

  return ok(data);
}

/**
 * Calcula el resumen en vivo de un conjunto de abonos (para la UI).
 *
 * @param {Array<{monto: number|string}>} abonos
 * @param {number|string} total
 * @returns {{abonado: number, faltante: number, cambio: number, cuadra: boolean}}
 */
export function resumenDePagos(abonos = [], total = 0) {
  const totalNum = Number(total) || 0;
  const arr = Array.isArray(abonos) ? abonos : [];
  const abonado = arr.reduce((acc, a) => acc + (Number(a && a.monto) || 0), 0);
  const entregado = arr.reduce(
    (acc, a) =>
      acc +
      (Number(a && (a.recibido !== undefined && a.recibido !== null ? a.recibido : a.monto)) || 0),
    0
  );
  
  const abonadoRedondeado = Math.round(abonado * 100) / 100;
  const entregadoRedondeado = Math.round(entregado * 100) / 100;
  
  const faltante = Math.max(0, Math.round((totalNum - abonadoRedondeado) * 100) / 100);
  const cambio = Math.max(0, Math.round((entregadoRedondeado - totalNum) * 100) / 100);
  
  return {
    abonado: abonadoRedondeado,
    faltante,
    cambio,
    cuadra: faltante === 0,
  };
}

export default {
  METODOS_VALIDOS,
  METODOS_TARJETA,
  aMonto,
  normalizarMetodo,
  calcularCambio,
  construirPaymentDetails,
  resumenDePagos,
};
