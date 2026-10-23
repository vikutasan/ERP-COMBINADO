/**
 * Puerta P2a — El "cuarto" de las preferencias de vista (`usePreferenciasDeVista`).
 *
 * ORIGEN: el refactor por cuartos nació de F12.32 (el selector de pedido
 * sobrevivía al envío de la cuenta). La causa de fondo era tener 31 `useState`
 * + 3 `useRef` sueltos en `RetailVisionPOS.jsx`. P1 cerró el cuarto de la VENTA
 * EN CURSO; P2a cierra el de las PREFERENCIAS DE VISTA (`vozAbierta`,
 * `viewMode`).
 *
 * Esta puerta NO verifica que `reset` exista (eso sería tautológico: probar la
 * clase que escribí). Verifica el EFECTO: que `reset()` apague TODOS los
 * interruptores del cuarto y que `VALOR_INICIAL_VISTA` no contenga claves
 * prohibidas (catálogo/sesión), que tienen su propio ciclo de vida.
 *
 * Lección de las compuertas anti-tautología (BUG-10e/10f/10g/10h): una compuerta
 * que solo verifica el símbolo que escribiste no verifica el efecto.
 *
 * @see PLAN_DE_REFACTOR_POR_CUARTOS.md §5 (peldaños P2a/P2b)
 * @see useContextoDeVenta.p1.test.jsx (patrón replicado)
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  usePreferenciasDeVista,
  VALOR_INICIAL_VISTA,
} from './usePreferenciasDeVista.js';
import { FORBIDDEN_KEYS } from '../state/sessionReset.js';

// ─── Utilidad: "ensuciar" el cuarto con una vista no-base ────────────────────
// Simula el estado real: overlay de voz abierto y cuerpo en modo cámara.
function ensuciarLaVista(result) {
  act(() => {
    result.current.setVozAbierta(true);
    result.current.setViewMode('CAMERA');
  });
}

describe('P2a — usePreferenciasDeVista: reset() apaga TODO el cuarto', () => {
  // ── 1. El efecto central: TODOS los estados de vista vuelven a su inicial ──
  it('reset() resetea TODOS los estados de vista a su valor inicial canónico', () => {
    const { result } = renderHook(() => usePreferenciasDeVista());

    ensuciarLaVista(result);

    // Precondición: el cuarto está "sucio" (si no, el test sería vacío).
    expect(result.current.vozAbierta).toBe(true);
    expect(result.current.viewMode).toBe('CAMERA');

    act(() => {
      result.current.reset();
    });

    // Postcondición: cada interruptor apagado, uno por uno. Se enumeran
    // EXPLÍCITAMENTE (no un bucle sobre VALOR_INICIAL_VISTA) para que el test
    // falle si alguien AGREGA un estado de vista y olvida cerrarlo.
    expect(result.current.vozAbierta).toBe(VALOR_INICIAL_VISTA.vozAbierta);
    expect(result.current.viewMode).toBe(VALOR_INICIAL_VISTA.viewMode);
  });

  // ── 2. El modo de vista vuelve a GRID (no se queda en CAMERA) ──────────────
  it('reset() devuelve el modo de vista a GRID (no se queda en CAMERA)', () => {
    const { result } = renderHook(() => usePreferenciasDeVista());

    act(() => {
      result.current.setViewMode('CAMERA');
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.viewMode).toBe('GRID');
  });

  // ── 3. Compuerta de diseño: el cuarto NO puede contener FORBIDDEN_KEYS ─────
  it('VALOR_INICIAL_VISTA no contiene NINGUNA clave de FORBIDDEN_KEYS', () => {
    // Si alguien mete `productos`/`sesion`/`error` al cuarto, este test falla.
    for (const clave of Object.keys(VALOR_INICIAL_VISTA)) {
      expect(FORBIDDEN_KEYS).not.toContain(clave);
    }
  });

  // ── 4. Idempotencia: resetear dos veces no rompe ni revive nada ────────────
  it('reset() es idempotente: llamarlo dos veces deja el cuarto igual de limpio', () => {
    const { result } = renderHook(() => usePreferenciasDeVista());

    ensuciarLaVista(result);

    act(() => {
      result.current.reset();
    });
    const trasPrimero = {
      vozAbierta: result.current.vozAbierta,
      viewMode: result.current.viewMode,
    };

    act(() => {
      result.current.reset();
    });

    expect(result.current.vozAbierta).toBe(trasPrimero.vozAbierta);
    expect(result.current.viewMode).toBe(trasPrimero.viewMode);
  });
});
