/**
 * Servicio de contexto diario — FASE 10.4 (contrato 28, `pos.contexto_diario`).
 *
 * Responsabilidad: capturar el contexto del día tras el corte de caja (clima,
 * día atípico, notas) y enviarlo al módulo de Estadísticas, que es el DUEÑO de
 * la tabla `daily_contexts`. El POS NO es dueño de esa tabla: solo la alimenta.
 *
 * ── Por qué este servicio es "fire-and-forget" ────────────────────────────────
 * El contexto diario NO bloquea la venta ni el cierre del turno. Si el módulo
 * de Estadísticas no responde, el cajero puede omitirlo y el corte se cierra
 * igual. Por eso el servicio NUNCA lanza: devuelve `{outcome, reason, data}` y
 * el componente decide si muestra el acuse o simplemente lo ignora.
 *
 * ── Estado: DEUDA (contrato 28) ───────────────────────────────────────────────
 * El endpoint `PUT /pos/daily-context` AÚN NO EXISTE en el API del POS nuevo.
 * El contrato 28 lo declara como "Deuda" (F10.4). Mientras no exista, este
 * servicio apunta al endpoint heredado del ERP (`PUT /analytics/context`), que
 * es el que el viejo POS consumía. Cuando el POS nuevo exponga su propio
 * endpoint, solo cambia la ruta en `cliente.enviarContextoDiario`.
 *
 * ── Herencia (§6.8) ───────────────────────────────────────────────────────────
 * La INTEGRACIÓN se hereda del viejo POS (`handleSaveDailyContext` en
 * `apps/pos/components/GestorDeCaja.jsx`): se dispara al cerrar el turno, con
 * los 6 climas canónicos, el flag "atípico" y las notas opcionales. La
 * IMPLEMENTACIÓN se reescribe con el contrato `{outcome, reason, data}`.
 *
 * @see PLAN_DE_ABORDAJE_F10_4_CONTEXTO_DIARIO.md §5 (diseño técnico)
 * @see registry.py contrato 28 (`pos.contexto_diario`)
 */

import * as cliente from '../api/client.js';
import { aOutcome } from '../utils/outcome.js';

/**
 * Los 6 climas canónicos del contexto diario (heredados del viejo POS).
 * El valor viaja al backend; el emoji es solo presentación.
 */
export const CLIMAS = Object.freeze([
  { valor: 'SOLEADO', emoji: '☀️', etiqueta: 'Soleado' },
  { valor: 'NUBLADO', emoji: '🌤️', etiqueta: 'Nublado' },
  { valor: 'LLUVIA', emoji: '🌧️', etiqueta: 'Lluvia' },
  { valor: 'TORMENTA', emoji: '⛈️', etiqueta: 'Tormenta' },
  { valor: 'MUCHO_CALOR', emoji: '🥵', etiqueta: 'Mucho calor' },
  { valor: 'FRIO', emoji: '❄️', etiqueta: 'Frío' },
]);

/**
 * Devuelve la fecha local del negocio en formato `YYYY-MM-DD`.
 *
 * Usa `America/Mexico_City` (Regla 4.6 + V20): el "día de negocio" es el día
 * local, no el UTC. El incidente del desfase UTC vs México CST (Ago 2026) es
 * la cicatriz que obliga a fijar la zona explícitamente.
 *
 * @param {Date} [ahora=new Date()]
 * @returns {string} `YYYY-MM-DD` en hora de México.
 */
export function fechaLocalDeNegocio(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

/**
 * Traduce un error del cliente a un `reason` legible.
 * @param {Error} err
 * @returns {string}
 */
function motivo(err) {
  if (err && err.name === 'ApiError') {
    if (err.codigo === 0) return 'sin_conexion';
    if (err.codigo === 404) return 'contexto_no_soportado';
    if (err.codigo === 422) return 'datos_invalidos';
    if (err.codigo === 503) return 'estadisticas_no_disponible';
    return err.message || `error_${err.codigo}`;
  }
  return (err && err.message) || 'error_desconocido';
}

/**
 * Normaliza el borrador del modal a la forma canónica del contrato 28.
 *
 * @param {{clima?: string|null, atipico?: boolean, notas?: string}} borrador
 * @param {string} [fecha] - `YYYY-MM-DD`; por defecto, el día local de hoy.
 * @returns {{target_date: string, is_atypical: boolean, weather_condition: string|null, notes: string|null}}
 */
export function normalizarContexto(borrador = {}, fecha = fechaLocalDeNegocio()) {
  const notas = typeof borrador.notas === 'string' ? borrador.notas.trim() : '';
  return {
    target_date: fecha,
    is_atypical: Boolean(borrador.atipico),
    weather_condition: borrador.clima || null,
    notes: notas || null,
  };
}

/**
 * PUT del contexto diario al módulo de Estadísticas (contrato 28).
 *
 * NUNCA lanza: devuelve `{outcome, reason, data}`. El llamador decide si el
 * fallo es visible (el contexto es opcional, no bloquea el corte).
 *
 * @param {{clima?: string|null, atipico?: boolean, notas?: string}} borrador
 * @param {string} [fecha] - `YYYY-MM-DD`; por defecto, el día local de hoy.
 * @returns {Promise<{outcome: string, reason: string|null, data: object|null}>}
 */
export function enviarContextoDiario(borrador, fecha = fechaLocalDeNegocio()) {
  const cuerpo = normalizarContexto(borrador, fecha);
  return aOutcome(() => cliente.enviarContextoDiario(cuerpo), motivo);
}

export default {
  CLIMAS,
  fechaLocalDeNegocio,
  normalizarContexto,
  enviarContextoDiario,
};
