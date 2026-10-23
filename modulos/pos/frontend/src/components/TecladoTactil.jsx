/**
 * `TecladoTactil` — teclado en pantalla (numérico o alfabético) para el Gestor
 * de Caja.
 *
 * FASE 10.6.1 — Paridad de operación del Gestor de Caja.
 * FIX-BUG17 — El teclado admite DOS modos: `numerico` (dinero) y `alfabetico`
 * (texto libre, p. ej. el "Motivo" de un movimiento). El viejo POS solo tenía
 * teclado numérico; el motivo se capturaba con el teclado del sistema. En un
 * kiosco táctil eso es impracticable, así que se añade el modo alfabético.
 *
 * El viejo POS definió este teclado por una NECESIDAD OPERATIVA REAL: el POS
 * corre en pantallas táctiles (kiosco), donde el teclado nativo del sistema es
 * lento, impreciso con dedos y puede estar deshabilitado. La operación se
 * reproduce; la implementación se reescribe con el sistema de diseño canónico
 * (§6.8: la integración se hereda, la implementación se reescribe).
 *
 * Este componente es PURO: no conoce la máquina de foco ni los formularios.
 * Solo muestra el valor en pantalla y emite cada tecla pulsada hacia arriba.
 * La decisión de qué hacer con cada tecla vive en el contenedor
 * (`GestorDeCaja`), igual que en el viejo POS.
 *
 * Teclas emitidas (modo numérico):
 *   - `'0'`..`'9'` y `'.'` → dígitos y punto decimal.
 *   - `'←'`               → borrar el último carácter.
 *   - `'C'`               → limpiar todo.
 *   - `'ENTER'`           → confirmar / avanzar el foco.
 *
 * Teclas emitidas (modo alfabético):
 *   - `'A'`..`'Z'` (más `'Ñ'`) y `' '` → letras y espacio, en orden alfabético.
 *   - `'←'`               → borrar el último carácter.
 *   - `'LIMPIAR'`         → limpiar todo.
 *   - `'ENTER'`           → confirmar / avanzar el foco.
 *
 * @see PLAN_DE_ABORDAJE_F10_6_PARIDAD_DE_OPERACION_DE_CAJA.md §5 (F10.6.1)
 */

import React from 'react';

/** Las 12 teclas del bloque numérico, en orden de lectura. */
const TECLAS_NUMERICAS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, '.', 0, '←']);

/**
 * Las 26 letras del alfabeto en orden ALFABÉTICO (A→Z), más el espacio. Se
 * emiten como mayúsculas; el contenedor decide si normaliza.
 *
 * FIX-BUG17 — El orden es alfabético (A, B, C, …), NO QWERTY: en un kiosco
 * táctil el operador busca la letra por su lugar en el alfabeto, no por la
 * memoria muscular de un teclado físico. Se lee de izquierda a derecha y de
 * arriba hacia abajo, en una rejilla de 3 columnas.
 */
const TECLAS_ALFABETICAS = Object.freeze([
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I',
  'J', 'K', 'L', 'M', 'N', 'Ñ', 'O', 'P', 'Q',
  'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', ' ',
]);

/**
 * @param {object} props
 * @param {string} props.valor        Valor actual del campo enfocado ('' si ninguno).
 * @param {(tecla: string) => void} props.onTecla  Callback al pulsar una tecla.
 * @param {boolean} [props.activo]    Si hay un campo enfocado (habilita el teclado).
 * @param {string} [props.etiqueta]   Texto del campo enfocado (ej. "Fondo inicial").
 * @param {'numerico'|'alfabetico'} [props.tipo]  Modo del teclado (default: numerico).
 */
export default function TecladoTactil({
  valor = '',
  onTecla,
  activo = false,
  etiqueta = '',
  tipo = 'numerico',
}) {
  const esAlfabetico = tipo === 'alfabetico';
  const teclas = esAlfabetico ? TECLAS_ALFABETICAS : TECLAS_NUMERICAS;
  const mostrar = activo
    ? String(valor || '') || (esAlfabetico ? '' : '0.00')
    : '---';

  return (
    <section
      aria-label="Teclado táctil"
      data-testid="teclado-tactil"
      data-tipo={tipo}
      className="bg-fondo-panel rounded-canon50 p-6 flex flex-col gap-4"
    >
      <h2 className="text-xl font-bold text-crema-ticket">
        {esAlfabetico ? 'Teclado alfabético' : 'Teclado táctil'}
      </h2>

      {/* Display "Valor en Pantalla" — refleja el campo enfocado. */}
      <div className="rounded-canon35 bg-fondo-profundo border border-white/10 py-4 text-center">
        <p className="text-[10px] font-black uppercase tracking-widest text-crema-ticket/40 mb-1">
          {activo && etiqueta ? etiqueta : 'Valor en pantalla'}
        </p>
        <p
          className="text-3xl font-black font-mono tracking-tighter text-acento"
          data-testid="teclado-display"
        >
          {mostrar}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {teclas.map((tecla) => (
          <button
            key={tecla}
            type="button"
            onClick={() => onTecla(String(tecla))}
            disabled={!activo}
            aria-label={tecla === ' ' ? 'Tecla espacio' : `Tecla ${tecla}`}
            className="min-h-tactil rounded-canon35 bg-fondo-profundo text-crema-ticket border border-white/10 font-bold text-lg hover:border-acento/60 disabled:opacity-40"
          >
            {tecla === ' ' ? '␣' : tecla}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onTecla('LIMPIAR')}
          disabled={!activo}
          aria-label="Tecla limpiar"
          className="min-h-tactil rounded-canon35 bg-peligro/20 text-peligro border border-peligro/40 font-bold text-lg disabled:opacity-40"
        >
          C
        </button>
        <button
          type="button"
          onClick={() => onTecla('ENTER')}
          disabled={!activo}
          aria-label="Tecla ENTER"
          className="col-span-2 min-h-tactil rounded-canon35 bg-acento text-fondo-profundo font-black uppercase tracking-wider disabled:opacity-40"
        >
          ENTER / CONTINUAR
        </button>
      </div>
    </section>
  );
}
