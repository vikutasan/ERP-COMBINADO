/**
 * printService — el disparador ÚNICO de impresión térmica — FASE 6.2.
 *
 * Responsabilidad: tomar un documento HTML ya generado (por F6.0,
 * `ticketGenerator.js`) y enviarlo a la impresora térmica del equipo.
 * NO genera HTML: eso es responsabilidad de F6.0. Aquí solo se imprime.
 *
 * Por qué existe un solo servicio para ticket y corte (§4 del plan):
 *   - El POS viejo tenía DOS copias del mismo patrón `iframe.print()`
 *     (una en `useTicketActions.js` para el ticket, otra en
 *     `GestorDeCaja.jsx` para el corte). Dos copias = dos lugares donde
 *     arreglar el mismo bug. Aquí se unifica en una sola función.
 *
 * Patrón portado del POS viejo (D-4), con DOS mejoras:
 *   1. El HTML es autosuficiente (F6.0): trae su propio `<style>` y CERO
 *      CDNs. El POS viejo inyectaba una hoja de estilos remota dentro del
 *      iframe (D-6): si no había internet, el corte salía sin estilos.
 *      Aquí ya no se inyecta nada externo.
 *   2. El patrón `iframe.contentWindow.print()` se PRESERVA tal cual
 *      (D-7): es el que respeta la bandera `--kiosk-printing` que el
 *      personal ya tiene configurada para impresión silenciosa. Imprimir
 *      desde la ventana principal rompería esa impresión silenciosa.
 *
 * Contrato `{outcome, reason}`: `imprimirTicket` e `imprimirCorte` NUNCA
 * lanzan. Un fallo (documento no disponible, iframe bloqueado) se traduce
 * a `{outcome: 'error', reason}`.
 *
 * Inyectable para tests: el servicio recibe `documento` (por defecto
 * `document`) para poder testear sin navegador real.
 *
 * @see PLAN_DE_ABORDAJE_FASE_6_POR_PARTES.md §8 (Sub-fase 6.2)
 * @see ticketGenerator.js (F6.0 — quien genera el HTML que aquí se imprime)
 */

import { ok, fallo } from '../utils/outcome.js';

/** Milisegundos de espera antes de disparar `print()` — igual que el viejo POS (500ms).
 * Con --kiosk-printing, dar tiempo al iframe a renderizarse completamente antes de imprimir.
 */
const ESPERA_ANTES_DE_IMPRIMIR = 500;

/** Milisegundos de espera antes de remover el iframe — igual que el viejo POS (1000ms). */
const ESPERA_ANTES_DE_REMOVER = 1000;

/**
 * Crea el `<iframe>` oculto, escribe el HTML y dispara la impresión.
 *
 * Este es el corazón del servicio: el patrón exacto del POS viejo, pero
 * parametrizado con el `documento` inyectable y con el HTML ya completo
 * (no se inyecta ningún CDN).
 *
 * @param {string} html - Documento HTML autosuficiente (de F6.0).
 * @param {Document} documento - El `document` donde crear el iframe.
 * @returns {{outcome: string, reason: string|null}} Contrato `{outcome, reason}`.
 */
function imprimirHTML(html, documento) {
  // Criterio 2: si el documento no está disponible, fallar limpiamente.
  if (!documento || typeof documento.createElement !== 'function') {
    return fallo('documento_no_disponible');
  }
  if (typeof html !== 'string' || html.trim() === '') {
    return fallo('html_vacio');
  }

  let iframe = null;
  try {
    iframe = documento.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    documento.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    // El HTML de F6.0 ya es un documento completo (<html><head><style>…).
    // No se inyecta ningún CDN (mejora sobre el POS viejo, D-6).
    doc.write(html);
    doc.close();

    // Criterio 7: se imprime desde el iframe, NO desde la ventana principal.
    // Es lo que respeta `--kiosk-printing` (impresión silenciosa, D-7).
    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } finally {
        // Criterio 3: el iframe se remueve del DOM tras imprimir.
        setTimeout(() => {
          try {
            if (documento.body.contains(iframe)) {
              documento.body.removeChild(iframe);
            }
          } catch {
            /* el iframe ya no está: nada que limpiar */
          }
        }, ESPERA_ANTES_DE_REMOVER);
      }
    }, ESPERA_ANTES_DE_IMPRIMIR);

    return ok();
  } catch (err) {
    // Criterio 5: nunca lanzar. Si algo falló a mitad de camino, limpiar.
    try {
      if (iframe && documento.body.contains(iframe)) {
        documento.body.removeChild(iframe);
      }
    } catch {
      /* limpieza best-effort */
    }
    return fallo((err && err.message) || 'error_de_impresion');
  }
}

/**
 * Resuelve el `document` a usar.
 *
 * Regla: si el llamador PROPORCIONA `opciones.documento` (aunque sea `null`),
 * se respeta tal cual — no se cae al `document` global. Esto hace el servicio
 * testeable (criterio 2: "documento no disponible") y evita sorpresas: quien
 * inyecta un documento, manda. Solo si NO se proporciona la clave se usa el
 * `document` global del navegador.
 *
 * @param {{documento?: Document}} opciones
 * @returns {Document|null}
 */
function resolverDocumento(opciones) {
  if (Object.prototype.hasOwnProperty.call(opciones, 'documento')) {
    return opciones.documento ?? null;
  }
  return typeof document !== 'undefined' ? document : null;
}

/**
 * Imprime un ticket de venta.
 *
 * @param {string} html - HTML del ticket (de `generarTicketHTML`, F6.0).
 * @param {{documento?: Document}} [opciones] - `documento` inyectable (tests).
 * @returns {{outcome: string, reason: string|null}}
 */
export function imprimirTicket(html, opciones = {}) {
  const documento = resolverDocumento(opciones);
  return imprimirHTML(html, documento);
}

/**
 * Imprime un corte de caja.
 *
 * Usa el HTML del corte (de `generarCorteHTML`, F6.0), NO el del ticket.
 * Comparte el mismo motor que `imprimirTicket` (§4: un solo servicio).
 *
 * @param {string} html - HTML del corte (de `generarCorteHTML`, F6.0).
 * @param {{documento?: Document}} [opciones] - `documento` inyectable (tests).
 * @returns {{outcome: string, reason: string|null}}
 */
export function imprimirCorte(html, opciones = {}) {
  const documento = resolverDocumento(opciones);
  return imprimirHTML(html, documento);
}

export default {
  imprimirTicket,
  imprimirCorte,
};
