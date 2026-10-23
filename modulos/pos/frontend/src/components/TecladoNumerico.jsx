/**
 * `TecladoNumerico` — teclado numérico táctil para la captura de efectivo.
 *
 * Rescate de UX del viejo POS (F9.0.2). El viejo POS tenía un teclado en
 * pantalla para capturar montos sin depender del teclado físico; en una
 * tablet de mostrador el teclado nativo tapa media pantalla y es lento.
 *
 * Este componente es PURO: no guarda estado propio. Recibe el valor actual
 * (`valor`) y emite el valor siguiente (`onCambiar`) aplicando la regla de
 * edición. Así el `CheckoutScreen` sigue siendo el único dueño del estado
 * `recibido` y el cálculo de cambio en vivo no se duplica.
 *
 * Reglas de edición (contrato del componente):
 *   - Dígito (0-9): se concatena al final del valor actual.
 *   - Punto decimal ('.'): solo se acepta si el valor aún no tiene punto.
 *   - Borrar ('C'): limpia el valor a cadena vacía.
 *
 * El teclado nativo (`<input type="number">`) NO se elimina: se conserva
 * como alternativa para quien prefiera teclear. Ambos escriben el mismo
 * estado `recibido`, por lo que son intercambiables.
 *
 * R-04: cada tecla respeta el target táctil de 44×44px (`min-h-tactil`).
 * La paleta usa `fondo-panel` (#1a1a1a) y el acento (#c1d72e).
 */

import React from 'react';

/** Teclas del teclado, en orden de lectura (fila por fila). */
export const TECLAS = Object.freeze([
  '1', '2', '3',
  '4', '5', '6',
  '7', '8', '9',
  '.', '0', 'C',
]);

/**
 * Aplica una tecla al valor actual y devuelve el valor siguiente.
 *
 * Función pura y exportada para poder probarla sin montar el componente.
 *
 * @param {string} valorActual - El valor capturado hasta ahora (p. ej. "150").
 * @param {string} tecla - La tecla pulsada ('0'-'9', '.' o 'C').
 * @returns {string} El valor siguiente.
 */
export function aplicarTecla(valorActual, tecla) {
  const actual = String(valorActual ?? '');

  if (tecla === 'C') return '';
  if (tecla === '.') {
    // Solo un punto decimal por captura.
    if (actual.includes('.')) return actual;
    // Un punto al inicio se interpreta como "0.".
    return actual === '' ? '0.' : `${actual}.`;
  }
  if (/^[0-9]$/.test(tecla)) {
    // Evita ceros a la izquierda sin sentido ("0" + "5" → "5").
    if (actual === '0') return tecla;
    return `${actual}${tecla}`;
  }
  return actual;
}

export default function TecladoNumerico({ valor = '', onCambiar, deshabilitado = false }) {
  return (
    <div
      className="grid grid-cols-3 gap-2"
      role="group"
      aria-label="Teclado numérico de efectivo"
    >
      {TECLAS.map((tecla) => {
        const esBorrar = tecla === 'C';
        return (
          <button
            key={tecla}
            type="button"
            disabled={deshabilitado}
            onClick={() => onCambiar(aplicarTecla(valor, tecla))}
            aria-label={esBorrar ? 'Borrar' : tecla}
            className={`min-h-tactil min-w-tactil rounded-canon35 border font-bold text-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              esBorrar
                ? 'bg-peligro/20 text-peligro border-peligro/40 hover:border-peligro'
                : 'bg-fondo-profundo text-crema-ticket border-white/10 hover:border-acento/60'
            }`}
          >
            {esBorrar ? 'C' : tecla}
          </button>
        );
      })}
    </div>
  );
}
