/**
 * `useTheme` — cablea el motor de temas compartido al módulo POS (F7.1).
 *
 * El motor (`packages/theme-engine/`) ya existía desde Fase 1, pero **nadie lo
 * llamaba** (hallazgo H-1 del plan de Fase 7). Este hook es el cable que faltaba:
 * resuelve el tema con `resolverTema`, lo aplica con `aplicarTema` y persiste la
 * elección del operador en `localStorage`.
 *
 * REGLAS (del plan §6.2):
 * - El motor NO se toca. Este hook solo lo LLAMA.
 * - La elección se guarda en `localStorage` (clave `pos.tema`), igual que
 *   `pos.ordenTerminales` (F6.5).
 * - `resolverTema(modulo, eleccion, identidad)` se llama con `TEMA_DEL_MODULO`,
 *   la elección guardada e `identidad=null` (Vista General aún no existe — DT-06).
 * - `aplicarTema(tema, contenedor)` se aplica al contenedor raíz del POS, NO a
 *   `:root` (evita contaminación cruzada entre módulos).
 * - Si un tema no carga, `resolverTema` ya cae al default del módulo. El hook no
 *   duplica esa defensa.
 * - Si `localStorage` tiene un tema inválido, se cae al default (no rompe).
 *
 * @see packages/theme-engine/index.js
 * @see apps/pos/src/theme/index.js (TEMA_DEL_MODULO)
 * @see PLAN_DE_ABORDAJE_FASE_7_POR_PARTES.md §6
 */

import { useCallback, useEffect, useState } from 'react';
import { aplicarTema, resolverTema } from '@nuevo-pos/theme-engine';
import { TEMA_DEL_MODULO } from '../theme/index.js';

/** Clave de `localStorage` donde se persiste la elección de tema. */
export const CLAVE_TEMA = 'pos.tema';

/**
 * Lee la elección de tema desde `localStorage`.
 * Devuelve `null` si falta, es inválida o el acceso falla — el motor decidirá
 * el default en ese caso.
 */
export function leerTemaGuardado() {
  try {
    const valor = localStorage.getItem(CLAVE_TEMA);
    if (!valor) return null;
    return TEMA_DEL_MODULO.permitidos.includes(valor) ? valor : null;
  } catch {
    return null;
  }
}

/**
 * Persiste la elección de tema. Un fallo de `localStorage` (modo privado, cuota)
 * no debe romper la UI: se ignora silenciosamente.
 */
function guardarTema(nombre) {
  try {
    localStorage.setItem(CLAVE_TEMA, nombre);
  } catch {
    /* Sin persistencia: el tema sigue aplicado en memoria. */
  }
}

/**
 * @param {object} [opciones]
 * @param {HTMLElement|null} [opciones.contenedor] - Dónde escribir las CSS vars.
 *   Por defecto `document.documentElement` (el motor decide si es null).
 * @returns {{
 *   tema: string,
 *   temas: string[],
 *   ofreceSelector: boolean,
 *   cargando: boolean,
 *   cambiarTema: (nombre: string) => void,
 * }}
 */
export function useTheme(opciones = {}) {
  const { contenedor = null } = opciones;

  const [tema, setTema] = useState(() => leerTemaGuardado() || TEMA_DEL_MODULO.default);
  const [cargando, setCargando] = useState(true);

  // Aplica el tema cada vez que cambia. `resolverTema` es asíncrono (carga lazy
  // del tema), así que se protege contra desmontaje con un flag.
  //
  // DEFENSA (plan §6.2): si el motor falla, el hook NO propaga la excepción.
  // El POS sigue usable con el tema que ya esté aplicado; `cargando` se apaga
  // igual para no dejar la UI colgada. Un fallo de tema jamás bloquea una venta.
  useEffect(() => {
    let vigente = true;

    (async () => {
      try {
        const resuelto = await resolverTema(TEMA_DEL_MODULO, tema, null);
        if (!vigente) return;
        aplicarTema(resuelto, contenedor || document.documentElement);
      } catch {
        /* El motor falló: se conserva el tema actual. No se propaga. */
      } finally {
        if (vigente) setCargando(false);
      }
    })();

    return () => {
      vigente = false;
    };
  }, [tema, contenedor]);

  const cambiarTema = useCallback((nombre) => {
    if (!TEMA_DEL_MODULO.permitidos.includes(nombre)) return;
    guardarTema(nombre);
    setTema(nombre);
  }, []);

  return {
    tema,
    temas: TEMA_DEL_MODULO.permitidos,
    ofreceSelector: TEMA_DEL_MODULO.ofreceSelector,
    cargando,
    cambiarTema,
  };
}

export default useTheme;
