/**
 * useBarcodeScanner — lector de código de barras.
 *
 * Un lector de código de barras "teclea" el código muy rápido y termina con
 * Enter. Este hook escucha el teclado global, acumula caracteres y, al recibir
 * Enter, entrega el código completo. Distingue el lector de un humano por la
 * VELOCIDAD entre teclas (un humano no teclea 10 caracteres en <50 ms).
 *
 * Reglas duras:
 *   - Prohibición #3: el callback se guarda en `useRef`; el listener NO se
 *     re-registra en cada render ni lee estado cerrado.
 *   - H1: `useEffect` deps = primitivos.
 *
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §5 (reglas arquitectónicas)
 * @see PLAN_DE_ABORDAJE_FASE_3_POR_PARTES.md §4 FASE 3.3
 */

import { useEffect, useRef, useState } from 'react';

/** Máximo de ms entre teclas para considerarlas del lector. */
export const UMBRAL_LECTOR_MS = 50;

/** Longitud mínima de un código válido. */
export const LONGITUD_MINIMA = 3;

/**
 * F12.31 — ¿El evento de teclado nace dentro de un campo editable?
 *
 * El lector de código de barras es un listener GLOBAL de `window`. Sin esta
 * guardia, TODO lo que el operador teclea —incluido el teléfono o el correo en
 * el modal "Entrega del ticket"— entra al buffer del lector. Si el operador
 * teclea rápido (o pulsa Enter), el hook dispara `alEscanear` con basura, el POS
 * busca un producto inexistente y muestra un banner de error, robando el foco y
 * dejando el campo aparentemente "muerto".
 *
 * Un lector de código de barras NUNCA escribe dentro de un input: emite el
 * código al vacío. Por eso, si el foco está en un campo editable, el evento NO
 * es del lector y debe ignorarse por completo.
 *
 * @param {EventTarget|null} objetivo
 * @returns {boolean}
 */
export function esObjetivoEditable(objetivo) {
  if (!objetivo || typeof objetivo !== 'object') return false;
  const etiqueta = String(objetivo.tagName || '').toUpperCase();
  if (etiqueta === 'INPUT' || etiqueta === 'TEXTAREA' || etiqueta === 'SELECT') {
    return true;
  }
  // `contenteditable` (incluye `contenteditable="true"` y el valor vacío).
  if (objetivo.isContentEditable === true) return true;
  return false;
}

/**
 * @param {object} [opciones]
 * @param {(codigo: string) => void} [opciones.alEscanear] - callback con el código
 * @param {boolean} [opciones.activo=true]
 * @param {number} [opciones.umbralMs=50] - velocidad máxima entre teclas
 * @param {number} [opciones.longitudMinima=3]
 * @returns {{ ultimoCodigo: string|null, escaneando: boolean }}
 */
export function useBarcodeScanner(opciones = {}) {
  const {
    alEscanear = null,
    activo = true,
    umbralMs = UMBRAL_LECTOR_MS,
    longitudMinima = LONGITUD_MINIMA,
  } = opciones;

  const [ultimoCodigo, setUltimoCodigo] = useState(null);
  const [escaneando, setEscaneando] = useState(false);

  // El callback vive en un ref: el listener no se re-registra (prohibición #3).
  const alEscanearRef = useRef(alEscanear);
  alEscanearRef.current = alEscanear;

  // Buffer y marca de tiempo del último carácter (refs, no estado).
  const bufferRef = useRef('');
  const ultimaTeclaRef = useRef(0);

  useEffect(() => {
    if (!activo || typeof window === 'undefined') return undefined;

    function alTeclear(evento) {
      // F12.31 — Si el foco está en un campo editable (teléfono/correo del
      // modal "Entrega del ticket", buscador, etc.), el evento NO es del lector:
      // se ignora por completo. Sin esto, el lector "come" lo que el operador
      // teclea y dispara `alEscanear` con basura.
      if (esObjetivoEditable(evento.target)) return;

      const ahora = Date.now();
      const delta = ahora - ultimaTeclaRef.current;
      ultimaTeclaRef.current = ahora;

      // Enter: cierra el código si es válido.
      if (evento.key === 'Enter') {
        const codigo = bufferRef.current;
        bufferRef.current = '';
        if (codigo.length >= longitudMinima) {
          setUltimoCodigo(codigo);
          setEscaneando(false);
          if (typeof alEscanearRef.current === 'function') alEscanearRef.current(codigo);
        }
        return;
      }

      // Solo caracteres imprimibles de un solo símbolo.
      if (evento.key.length !== 1) return;

      // Si pasó demasiado tiempo, el buffer anterior era de un humano: se reinicia.
      if (delta > umbralMs) {
        bufferRef.current = '';
      }

      bufferRef.current += evento.key;
      setEscaneando(true);
    }

    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [activo, umbralMs, longitudMinima]);

  return { ultimoCodigo, escaneando };
}

export default useBarcodeScanner;
