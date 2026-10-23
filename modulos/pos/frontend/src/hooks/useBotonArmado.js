/**
 * useBotonArmado — guardia determinista contra el "ghost click" táctil (F12.29 v6).
 *
 * ── El problema ──────────────────────────────────────────────────────────────
 * En un dispositivo táctil, un toque sobre un botón genera la cadena de
 * compatibilidad COMPLETA: `pointerdown → mousedown → mouseup → click`. Cuando
 * el `onClick` de ese botón provoca un cambio de estado que REEMPLAZA el botón
 * por OTRO en la misma posición de pantalla, el `click` sintetizado puede caer
 * sobre el botón NUEVO y activarlo sin que el cajero lo haya tocado.
 *
 * ── Por qué v5 falló en hardware ────────────────────────────────────────────
 * v5 usaba UN SOLO `armadoRef` compartido entre TODOS los botones armados.
 * Un `pointerdown` sobre el botón A armaba el ref. Tras el re-render, si el
 * navegador emitía un `pointerdown` sintetizado sobre el botón B (misma
 * posición, nuevo elemento DOM), el handler `onPointerDown` de React re-armaba
 * el MISMO ref. El `click` sintetizado posterior encontraba el ref armado y
 * disparaba el handler del botón B.
 *
 * En jsdom esto no se manifestaba porque `tocar()` emite `pointerdown` + `click`
 * sobre UN SOLO botón; jsdom NO sintetiza la cadena de compatibilidad táctil.
 *
 * ── La solución v6 — PER-ELEMENT con WeakSet ────────────────────────────────
 * v5 usaba UN SOLO `armadoRef` compartido entre TODOS los botones: un
 * `pointerdown` sobre el botón A armaba el ref, y el `click` sintetizado que
 * caía sobre el botón B pasaba la guardia porque el ref YA estaba armado.
 *
 * v6 corrige ese defecto: cada `onPointerDown` registra el ELEMENTO DOM
 * (`e.currentTarget`) en un `WeakSet`. El `onClick` solo dispara si el MISMO
 * elemento DOM está en el set. Tras un re-render que reemplaza el botón A por
 * el botón B, B es un NUEVO nodo DOM que NO está en el set, así que el `click`
 * sintetizado no lo activa.
 *
 * ── Alcance de esta guardia (IMPORTANTE) ────────────────────────────────────
 * Esta guardia es DEFENSA EN PROFUNDIDAD contra ghost clicks reales. NO es la
 * corrección primaria del F12.29: la causa raíz real era que el `useEffect` de
 * carga de `GestorDeCaja.jsx` tenía `onCajaHabilitada` en sus dependencias, y
 * como el padre pasa una lambda inline, cada re-render del padre re-ejecutaba
 * el efecto, llamaba `setEstado(ESTADOS.ABIERTO)` y DESMONTABA el modal. Esa
 * causa se corrige en `GestorDeCaja.jsx` con el patrón "latest ref".
 *
 * ── Uso ──────────────────────────────────────────────────────────────────────
 * ```jsx
 * const armar = useBotonArmado();
 * <button {...armar(() => setConfirmandoCierre(false))}>Volver</button>
 * ```
 *
 * @returns {(onClick: (e: Event) => void) => {
 *   onPointerDown: (e: Event) => void,
 *   onClick: (e: Event) => void,
 * }} función que arma las props del botón.
 *
 * @see FICHA_F12_29_MODAL_CIERRE_GHOST_CLICK.md
 */

import { useCallback, useRef } from 'react';

export function useBotonArmado() {
  // `WeakSet` de nodos DOM: cada `pointerdown` registra su `currentTarget`.
  // Al ser un `WeakSet`, las entradas se limpian solas cuando el nodo DOM es
  // recolectado (tras un desmontaje). No hay leak de memoria.
  const armadoSet = useRef(new WeakSet());

  const armar = useCallback(
    (onClick) => ({
      onPointerDown: (e) => {
        // Registra el nodo DOM específico. Si el botón fue reemplazado por
        // un re-render, el nodo nuevo NO está en el set.
        armadoSet.current.add(e.currentTarget);
      },
      onClick: (e) => {
        // Solo dispara si ESTE nodo DOM fue armado por un `pointerdown` propio.
        if (!armadoSet.current.has(e.currentTarget)) return;
        armadoSet.current.delete(e.currentTarget);
        if (typeof onClick === 'function') onClick(e);
      },
    }),
    [],
  );

  return armar;
}

export default useBotonArmado;
