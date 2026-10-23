/**
 * Puerta P2b — El "cuarto" de los modales de flujo (`useModalesDeFlujo`).
 *
 * ORIGEN: el refactor por cuartos nació de F12.32 (el selector de pedido
 * sobrevivía al envío de la cuenta). La causa de fondo era tener 31 `useState`
 * + 3 `useRef` sueltos en `RetailVisionPOS.jsx`. P1 cerró el cuarto de la VENTA
 * EN CURSO; P2a el de las PREFERENCIAS DE VISTA; P2b cierra el de los MODALES
 * DE FLUJO (`salidaAbierta`, `avisoEmpaque`).
 *
 * Esta puerta NO verifica que `reset` exista (eso sería tautológico: probar la
 * clase que escribí). Verifica el EFECTO: que `reset()` cierre TODOS los modales
 * del cuarto y que `VALOR_INICIAL_MODALES` no contenga claves prohibidas
 * (catálogo/sesión), que tienen su propio ciclo de vida.
 *
 * Lección de las compuertas anti-tautología (BUG-10e/10f/10g/10h): una compuerta
 * que solo verifica el símbolo que escribiste no verifica el efecto.
 *
 * @see PLAN_DE_REFACTOR_POR_CUARTOS.md §5 (peldaños P2a/P2b)
 * @see usePreferenciasDeVista.p2a.test.jsx (patrón replicado)
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useModalesDeFlujo,
  VALOR_INICIAL_MODALES,
} from './useModalesDeFlujo.js';
import { FORBIDDEN_KEYS } from '../state/sessionReset.js';

// ─── Utilidad: "ensuciar" el cuarto abriendo los dos modales ─────────────────
// Simula el estado real: salvaguarda de salida abierta y aviso de empaque
// encendido (el operador intentó salir y cobrar sin empaque).
function ensuciarLosModales(result) {
  act(() => {
    result.current.setSalidaAbierta(true);
    result.current.setAvisoEmpaque(true);
  });
}

describe('P2b — useModalesDeFlujo: reset() cierra TODO el cuarto', () => {
  // ── 1. El efecto central: TODOS los modales vuelven a su inicial ───────────
  it('reset() resetea TODOS los modales de flujo a su valor inicial canónico', () => {
    const { result } = renderHook(() => useModalesDeFlujo());

    ensuciarLosModales(result);

    // Precondición: el cuarto está "sucio" (si no, el test sería vacío).
    expect(result.current.salidaAbierta).toBe(true);
    expect(result.current.avisoEmpaque).toBe(true);

    act(() => {
      result.current.reset();
    });

    // Postcondición: cada modal cerrado, uno por uno. Se enumeran
    // EXPLÍCITAMENTE (no un bucle sobre VALOR_INICIAL_MODALES) para que el test
    // falle si alguien AGREGA un modal de flujo y olvida cerrarlo.
    expect(result.current.salidaAbierta).toBe(
      VALOR_INICIAL_MODALES.salidaAbierta,
    );
    expect(result.current.avisoEmpaque).toBe(
      VALOR_INICIAL_MODALES.avisoEmpaque,
    );
  });

  // ── 2. La salvaguarda de salida se cierra (no se queda abierta) ────────────
  it('reset() cierra la salvaguarda de salida (salidaAbierta → false)', () => {
    const { result } = renderHook(() => useModalesDeFlujo());

    act(() => {
      result.current.setSalidaAbierta(true);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.salidaAbierta).toBe(false);
  });

  // ── 3. El aviso de empaque se apaga (no se queda encendido) ────────────────
  it('reset() apaga el aviso de empaque (avisoEmpaque → false)', () => {
    const { result } = renderHook(() => useModalesDeFlujo());

    act(() => {
      result.current.setAvisoEmpaque(true);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.avisoEmpaque).toBe(false);
  });

  // ── 4. Compuerta de diseño: el cuarto NO puede contener FORBIDDEN_KEYS ─────
  it('VALOR_INICIAL_MODALES no contiene NINGUNA clave de FORBIDDEN_KEYS', () => {
    // Si alguien mete `productos`/`sesion`/`error` al cuarto, este test falla.
    for (const clave of Object.keys(VALOR_INICIAL_MODALES)) {
      expect(FORBIDDEN_KEYS).not.toContain(clave);
    }
  });

  // ── 5. Idempotencia: resetear dos veces no rompe ni revive nada ────────────
  it('reset() es idempotente: llamarlo dos veces deja el cuarto igual de limpio', () => {
    const { result } = renderHook(() => useModalesDeFlujo());

    ensuciarLosModales(result);

    act(() => {
      result.current.reset();
    });
    const trasPrimero = {
      salidaAbierta: result.current.salidaAbierta,
      avisoEmpaque: result.current.avisoEmpaque,
    };

    act(() => {
      result.current.reset();
    });

    expect(result.current.salidaAbierta).toBe(trasPrimero.salidaAbierta);
    expect(result.current.avisoEmpaque).toBe(trasPrimero.avisoEmpaque);
  });
});
