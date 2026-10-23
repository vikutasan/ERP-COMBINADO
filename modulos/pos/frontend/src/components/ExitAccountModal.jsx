/**
 * `ExitAccountModal` — salvaguarda de salida con cuenta abierta (FASE 9.0.1).
 *
 * PROBLEMA (UX heredada del viejo POS, §6.8):
 *   En el viejo POS, si el operador intentaba salir (cambiar de estación /
 *   volver al selector) con una cuenta abierta, aparecía un modal con 3
 *   caminos explícitos. En el nuevo POS, el botón "Cambiar Estación" del
 *   header NO estaba cableado: salir con una cuenta abierta no ofrecía
 *   ninguna salvaguarda y la cuenta podía perderse en silencio.
 *
 * SOLUCIÓN:
 *   Un overlay de confirmación con TRES acciones (no dos, por eso no se
 *   reutiliza `OverlayConfirmar`):
 *
 *     1. "📌 Enviar al Pizarrón y salir" — deja la cuenta abierta (ya está
 *        persistida por la persistencia atómica por ítem, contratos 18–20)
 *        y sale. Es la acción NO destructiva.
 *     2. "🚪 Salir sin enviar — perder cuenta" — acción DESTRUCTIVA
 *        (color `peligro`). Descarta la cuenta y sale.
 *     3. "Cancelar — quedarme" — cierra el modal y NO sale.
 *
 * REGLAS RESPETADAS:
 *   - R-04: cada botón respeta el target táctil ≥ 44×44px (`min-h-tactil`).
 *   - R-01: contenedor `fixed inset-0` fluido; sin anchos absolutos.
 *   - Prohibición #2 / Regla 19: el modal NO se auto-oculta; solo lo cierra
 *     una acción explícita del operador.
 *   - Tokens del tema (`bg-fondo-panel`, `text-crema-ticket`, `bg-acento`,
 *     `bg-peligro`); NINGÚN color hardcodeado.
 *   - `role="dialog"` + `aria-modal="true"`.
 *
 * @param {object} props
 * @param {boolean} props.visible - ¿se muestra el modal?
 * @param {number} [props.cantidadItems=0] - ítems en la cuenta (para el mensaje).
 * @param {() => void} props.onEnviarYSalir - deja la cuenta abierta y sale.
 * @param {() => void} props.onSalirSinEnviar - descarta la cuenta y sale.
 * @param {() => void} props.onCancelar - cierra el modal sin salir.
 */

import React from 'react';

export default function ExitAccountModal({
  visible,
  cantidadItems = 0,
  onEnviarYSalir,
  onSalirSinEnviar,
  onCancelar,
}) {
  if (!visible) return null;

  const plural = cantidadItems === 1 ? 'ítem' : 'ítems';

  return (
    <div className="fixed inset-0 z-50 bg-fondo-profundo/80 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cuenta sin enviar"
        className="w-full max-w-[420px] bg-fondo-panel text-crema-ticket rounded-canon40 p-6 flex flex-col gap-4 text-center"
      >
        <h2 className="text-xl font-bold">⚠️ Cuenta sin enviar</h2>
        <p className="text-sm text-crema-ticket/80">
          Tienes una cuenta abierta con <strong>{cantidadItems}</strong> {plural}.
          ¿Qué quieres hacer antes de salir?
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onEnviarYSalir}
            className="w-full min-h-tactil rounded-canon35 bg-acento text-fondo-profundo font-bold"
          >
            📌 Enviar al Pizarrón y salir
          </button>
          <button
            type="button"
            onClick={onSalirSinEnviar}
            className="w-full min-h-tactil rounded-canon35 bg-peligro text-crema-ticket font-bold"
          >
            🚪 Salir sin enviar — perder cuenta
          </button>
          <button
            type="button"
            onClick={onCancelar}
            className="w-full min-h-tactil rounded-canon35 bg-transparent text-crema-ticket border border-white/20 hover:border-acento/60 transition-colors"
          >
            Cancelar — quedarme
          </button>
        </div>
      </div>
    </div>
  );
}
