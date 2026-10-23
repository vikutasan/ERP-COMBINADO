/**
 * `ThemeSelector` — selector visual de tema del POS (F7.1).
 *
 * Es la UI que el operador toca para cambiar el tema del módulo. NO resuelve ni
 * aplica el tema: eso es de `useTheme` (que a su vez llama al motor compartido).
 *
 * REGLAS (del plan §6.2):
 * - Se muestra SOLO si `ofreceSelector` es true (el contrato lo declara).
 * - Lista los temas permitidos por `TEMA_DEL_MODULO` (default, nocturno, minimal).
 * - R-03: visible en los 3 modos (MOSTRADOR / COMPACTO / MÓVIL).
 * - R-04: cada opción es un target táctil ≥44px (`min-h-tactil`).
 * - R-01: contenedor raíz fluido (`w-full`), sin ancho fijo.
 *
 * @see apps/pos/src/hooks/useTheme.js
 * @see PLAN_DE_ABORDAJE_FASE_7_POR_PARTES.md §6
 */

import React from 'react';

/** Etiquetas humanas de cada tema (el nombre técnico no se muestra al operador). */
const ETIQUETAS_TEMA = Object.freeze({
  default: 'Clásico',
  nocturno: 'Nocturno',
  minimal: 'Minimal',
});

/** Icono de cada tema (ayuda visual, no decorativo). */
const ICONOS_TEMA = Object.freeze({
  default: '🌙',
  nocturno: '🌌',
  minimal: '◻️',
});

/**
 * @param {object} props
 * @param {string} props.tema - tema activo (nombre técnico).
 * @param {string[]} props.temas - temas permitidos por el contrato.
 * @param {boolean} [props.ofreceSelector=true] - si es false, no se renderiza.
 * @param {(nombre: string) => void} props.onCambiarTema - cambia el tema.
 */
export default function ThemeSelector({
  tema,
  temaActivo,
  temas = [],
  ofreceSelector = true,
  onCambiarTema,
  onCambiar,
}) {
  const activoActual = tema ?? temaActivo;
  const handlerCambio = onCambiarTema ?? onCambiar;

  // El contrato manda: si el módulo no ofrece selector, no hay UI.
  if (!ofreceSelector) return null;

  return (
    <div
      className="w-full flex items-center justify-center gap-2"
      role="group"
      aria-label="Selector de tema"
    >
      {temas.map((nombre) => {
        const activo = nombre === activoActual;
        return (
          <button
            key={nombre}
            type="button"
            onClick={() => handlerCambio?.(nombre)}
            aria-pressed={activo}
            title={`Tema ${ETIQUETAS_TEMA[nombre] || nombre}`}
            className={`min-h-tactil px-4 py-2.5 rounded-xl flex items-center gap-2 text-[11px] font-black uppercase tracking-widest transition-all border cursor-pointer ${
              activo
                ? 'bg-acento text-fondo-profundo border-acento shadow-lg scale-105'
                : 'bg-fondo-profundo text-crema-ticket/70 border-white/10 hover:bg-fondo-panel hover:text-white'
            }`}
          >
            <span aria-hidden="true">{ICONOS_TEMA[nombre] || '🎨'}</span>
            <span>{ETIQUETAS_TEMA[nombre] || nombre}</span>
          </button>
        );
      })}
    </div>
  );
}
