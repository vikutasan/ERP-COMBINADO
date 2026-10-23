/**
 * Helpers de interacción táctil para los tests (F12.29 v5).
 *
 * ── Por qué existen ──────────────────────────────────────────────────────────
 * Los botones del Gestor de Caja que pueden recibir un "ghost click" se arman
 * con `useBotonArmado`: su `onClick` solo dispara si va precedido de un
 * `pointerdown` SOBRE EL PROPIO botón. Un `fireEvent.click` aislado NO emite
 * `pointerdown`, así que —correctamente— NO dispara el botón.
 *
 * Los tests que quieren simular un TOQUE REAL deben usar `tocar(elemento)`,
 * que emite `pointerdown` + `click`, la secuencia que produce un dedo/ratón.
 *
 * Los tests que quieren simular un GHOST CLICK deben usar `ghostClick(elemento)`,
 * que emite solo `click` (sin `pointerdown` previo).
 *
 * @see apps/pos/src/hooks/useBotonArmado.js
 * @see FICHA_F12_29_MODAL_CIERRE_GHOST_CLICK.md
 */

import { fireEvent } from '@testing-library/react';

/**
 * Simula un TOQUE REAL: `pointerdown` (arma el botón) seguido de `click`
 * (dispara el handler). Es la secuencia que produce un dedo o un ratón.
 *
 * @param {Element} elemento — el botón a tocar.
 */
export function tocar(elemento) {
  fireEvent.pointerDown(elemento);
  fireEvent.click(elemento);
}

/**
 * Simula un GHOST CLICK: solo `click`, sin `pointerdown` previo sobre el botón.
 * Es lo que el navegador sintetiza cuando el `pointerdown` cayó sobre OTRO
 * elemento (el botón anterior, ya desmontado). Un botón armado lo ignora.
 *
 * @param {Element} elemento — el botón que recibe el click sintetizado.
 */
export function ghostClick(elemento) {
  fireEvent.click(elemento);
}
