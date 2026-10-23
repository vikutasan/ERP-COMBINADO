/**
 * SelectorCategoriasPDF — FASE 6.3 (Entregable B: selector de categorías).
 *
 * Modal que permite elegir QUÉ categorías entran en la carta PDF antes de
 * exportarla (ej: solo panadería, sin heladería). Todas vienen marcadas por
 * defecto; el dueño desmarca las que no quiere imprimir (categorías ocultas o
 * de prueba).
 *
 * Decisiones (plan v2.1 §9.2):
 *  - Lista de categorías con checkbox; todas marcadas al abrir.
 *  - El botón "Exportar" se deshabilita si no hay ninguna marcada.
 *  - Respeta R-03 (3 modos: claro/oscuro/alto contraste) usando la paleta
 *    canónica (`bg-fondo-profundo`, `bg-superficie`, `text-crema`, `bg-acento`).
 *  - Respeta R-04: todo control táctil mide al menos 44px (`min-h-tactil`).
 *  - No declara anchos fijos en `px` (R-01).
 *
 * Prohibiciones respetadas:
 *  - E-15: sin `console.log`.
 */

import { useState } from 'react';

/**
 * @param {object} props
 * @param {Array<{id: string, name: string}>} props.categorias
 * @param {(seleccionadas: Array<object>) => void} props.onExportar
 * @param {() => void} props.onCerrar
 * @param {boolean} [props.exportando]
 */
export default function SelectorCategoriasPDF({
  categorias = [],
  onExportar,
  onCerrar,
  exportando = false,
}) {
  const [marcadas, setMarcadas] = useState(() => new Set(categorias.map((c) => c.id)));

  function alternar(id) {
    setMarcadas((previas) => {
      const siguientes = new Set(previas);
      if (siguientes.has(id)) {
        siguientes.delete(id);
      } else {
        siguientes.add(id);
      }
      return siguientes;
    });
  }

  function alternarTodas() {
    setMarcadas((previas) => {
      if (previas.size === categorias.length) return new Set();
      return new Set(categorias.map((c) => c.id));
    });
  }

  const seleccionadas = categorias.filter((c) => marcadas.has(c.id));
  const todasMarcadas = categorias.length > 0 && marcadas.size === categorias.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Seleccionar categorías para la carta PDF"
    >
      <div className="w-full max-w-lg rounded-2xl bg-superficie p-5 shadow-2xl">
        <header className="mb-4">
          <h2 className="text-lg font-bold text-crema">Exportar carta a PDF</h2>
          <p className="mt-1 text-sm text-crema/70">
            Elige qué categorías quieres incluir en el documento.
          </p>
        </header>

        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-crema/70">
            {seleccionadas.length} de {categorias.length} seleccionadas
          </span>
          <button
            type="button"
            onClick={alternarTodas}
            className="min-h-tactil rounded-lg bg-white/5 px-3 text-sm text-crema hover:bg-white/10"
          >
            {todasMarcadas ? 'Quitar todas' : 'Marcar todas'}
          </button>
        </div>

        <ul className="mb-5 max-h-72 space-y-1 overflow-y-auto" data-testid="lista-categorias">
          {categorias.map((categoria) => (
            <li key={categoria.id}>
              <label className="flex min-h-tactil cursor-pointer items-center gap-3 rounded-lg px-3 hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={marcadas.has(categoria.id)}
                  onChange={() => alternar(categoria.id)}
                  className="h-5 w-5 accent-acento"
                  aria-label={categoria.name}
                />
                <span className="text-crema">{categoria.name}</span>
              </label>
            </li>
          ))}
        </ul>

        <footer className="flex gap-3">
          <button
            type="button"
            onClick={onCerrar}
            className="min-h-tactil flex-1 rounded-xl bg-white/5 px-4 font-semibold text-crema hover:bg-white/10"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onExportar(seleccionadas)}
            disabled={seleccionadas.length === 0 || exportando}
            className="min-h-tactil flex-1 rounded-xl bg-acento px-4 font-semibold text-white disabled:opacity-40"
          >
            {exportando ? 'Generando…' : 'Exportar PDF'}
          </button>
        </footer>
      </div>
    </div>
  );
}
