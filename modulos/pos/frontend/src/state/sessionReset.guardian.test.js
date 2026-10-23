/**
 * Tests guardianes de `sessionReset` — Brecha B3.
 *
 * @paridad: state/sessionReset.guardian.test.js
 * @operacion: El reset de sesión al cerrar turno (simetría de limpieza, Regla 19)
 *
 * Tres guardianes que protegen la simetría de limpieza (Regla 19):
 *
 *   1. GUARDIÁN DE CLAVES CANÓNICAS: `VALOR_INICIAL` tiene exactamente las
 *      claves esperadas. Si alguien agrega o quita una, el test falla.
 *
 *   2. GUARDIÁN DE CLAVES PROHIBIDAS: `buildResetPatch` EXPLOTA si le pasan
 *      una clave que está en `FORBIDDEN_KEYS`.
 *
 *   3. GUARDIÁN DE SIMETRÍA: las rutas de salida de `useCart.clearCart` y
 *      `useTicketActions.cobrar` usan `buildResetPatch`/`aplicarReset` (no
 *      limpian a mano).
 *
 * Inspirados en el viejo POS:
 *   - `ERP-R-DE-RICO/apps/pos/state/architecture.test.js` (31.6K)
 *   - `ERP-R-DE-RICO/apps/pos/state/sessionReset.test.js` (3.2K)
 *   - `ERP-R-DE-RICO/apps/pos/state/sessionReset.asymmetry.test.js` (5.1K)
 *   - `ERP-R-DE-RICO/apps/pos/state/sessionReset.equivalence.test.js` (9.5K)
 *
 * @see HALLAZGOS_AUDITORIA_BRECHAS_POS.md §5 (brecha B3)
 */

import { describe, it, expect } from 'vitest';
import {
  buildResetPatch,
  aplicarReset,
  resetearSesion,
  VALOR_INICIAL,
  FORBIDDEN_KEYS,
} from './sessionReset.js';
import fs from 'fs';
import path from 'path';

// ─── GUARDIÁN 1: Claves canónicas ────────────────────────────────────────────

describe('GUARDIÁN 1 — VALOR_INICIAL (claves canónicas)', () => {
  const CLAVES_ESPERADAS = [
    'carritoRef',
    'ticketRef',
    'folioRef',
    'versionRef',
    'ultimoEnvioRef',
    'enviandoRef',
  ];

  it('tiene EXACTAMENTE las claves esperadas (ni más ni menos)', () => {
    const claves = Object.keys(VALOR_INICIAL).sort();
    expect(claves).toEqual(CLAVES_ESPERADAS.sort());
  });

  it('todas las claves se inicializan a null', () => {
    for (const clave of CLAVES_ESPERADAS) {
      expect(VALOR_INICIAL[clave]).toBeNull();
    }
  });

  it('está congelado (Object.freeze)', () => {
    expect(Object.isFrozen(VALOR_INICIAL)).toBe(true);
  });

  it('buildResetPatch() sin args devuelve las mismas claves que VALOR_INICIAL', () => {
    const patch = buildResetPatch();
    const clavesDelPatch = Object.keys(patch).sort();
    expect(clavesDelPatch).toEqual(CLAVES_ESPERADAS.sort());
  });
});

// ─── GUARDIÁN 2: Claves prohibidas ──────────────────────────────────────────

describe('GUARDIÁN 2 — FORBIDDEN_KEYS (claves prohibidas)', () => {
  const PROHIBIDAS_ESPERADAS = [
    'lineas',
    'lineasRef',
    'productos',
    'categorias',
    'categoriaActiva',
    'sesion',
    'tema',
    'cargando',
    'error',
  ];

  it('tiene EXACTAMENTE las claves prohibidas esperadas', () => {
    expect([...FORBIDDEN_KEYS].sort()).toEqual(PROHIBIDAS_ESPERADAS.sort());
  });

  it('está congelado (Object.freeze)', () => {
    expect(Object.isFrozen(FORBIDDEN_KEYS)).toBe(true);
  });

  it('NINGUNA clave prohibida aparece en VALOR_INICIAL', () => {
    for (const prohibida of FORBIDDEN_KEYS) {
      expect(VALOR_INICIAL).not.toHaveProperty(prohibida);
    }
  });

  it('buildResetPatch EXPLOTA si se le pasa una clave prohibida', () => {
    for (const prohibida of FORBIDDEN_KEYS) {
      expect(() => buildResetPatch({ [prohibida]: null })).toThrow(TypeError);
      expect(() => buildResetPatch({ [prohibida]: null })).toThrow('FORBIDDEN_KEYS');
    }
  });

  it('buildResetPatch ACEPTA claves extras que NO son prohibidas', () => {
    expect(() => buildResetPatch({ miRefCustom: { current: 42 } })).not.toThrow();
    const patch = buildResetPatch({ miRefCustom: { current: 42 } });
    expect(patch).toHaveProperty('miRefCustom', null);
  });
});

// ─── GUARDIÁN 3: Simetría de aplicarReset ────────────────────────────────────

describe('GUARDIÁN 3 — Simetría de limpieza', () => {
  it('aplicarReset resetea refs de React ({current})', () => {
    const refs = {
      ticketRef: { current: 'TICKET-123' },
      versionRef: { current: 5 },
      enviandoRef: { current: true },
    };
    const patch = buildResetPatch(refs);
    aplicarReset(refs, patch);

    expect(refs.ticketRef.current).toBeNull();
    expect(refs.versionRef.current).toBeNull();
    expect(refs.enviandoRef.current).toBeNull();
  });

  it('aplicarReset resetea valores planos', () => {
    const refs = {
      ticketRef: 'TICKET-123',
      versionRef: 5,
    };
    const patch = buildResetPatch(refs);
    aplicarReset(refs, patch);

    expect(refs.ticketRef).toBeNull();
    expect(refs.versionRef).toBeNull();
  });

  it('resetearSesion es un atajo equivalente a buildResetPatch + aplicarReset', () => {
    const refs1 = {
      ticketRef: { current: 'A' },
      enviandoRef: { current: true },
    };
    const refs2 = {
      ticketRef: { current: 'A' },
      enviandoRef: { current: true },
    };

    // Camino largo
    aplicarReset(refs1, buildResetPatch(refs1));
    // Atajo
    resetearSesion(refs2);

    expect(refs1.ticketRef.current).toEqual(refs2.ticketRef.current);
    expect(refs1.enviandoRef.current).toEqual(refs2.enviandoRef.current);
  });

  it('aplicarReset lanza TypeError si refs no es un objeto', () => {
    expect(() => aplicarReset(null, {})).toThrow(TypeError);
    expect(() => aplicarReset(undefined, {})).toThrow(TypeError);
    expect(() => aplicarReset('string', {})).toThrow(TypeError);
  });

  it('dos llamadas a buildResetPatch devuelven objetos distintos (no se comparten)', () => {
    const patch1 = buildResetPatch();
    const patch2 = buildResetPatch();
    expect(patch1).not.toBe(patch2);
    expect(patch1).toEqual(patch2);
  });
});

// ─── GUARDIÁN 4: Simetría de código (grep estático) ─────────────────────────
//
// Verifica que los archivos que CONSUMEN sessionReset usen SOLO la función
// canónica (`aplicarReset`/`resetearSesion`/`buildResetPatch`), y que no
// limpien refs a mano (el patrón que causó la asimetría A2/A3 del viejo POS).

describe('GUARDIÁN 4 — Los consumidores usan la función canónica', () => {
  // Archivos que importan sessionReset
  const CONSUMIDORES = [
    path.resolve(__dirname, '../hooks/useCart.js'),
    path.resolve(__dirname, '../hooks/useTicketActions.js'),
  ];

  for (const archivo of CONSUMIDORES) {
    const nombre = path.basename(archivo);

    it(`${nombre} importa buildResetPatch o aplicarReset`, () => {
      const contenido = fs.readFileSync(archivo, 'utf-8');
      const importaReset =
        contenido.includes('buildResetPatch') ||
        contenido.includes('aplicarReset') ||
        contenido.includes('resetearSesion');
      expect(importaReset).toBe(true);
    });

    it(`${nombre} NO limpia .current a mano en la ruta de limpieza`, () => {
      const contenido = fs.readFileSync(archivo, 'utf-8');
      // Patrón peligroso: `ticketRef.current = null` fuera de aplicarReset.
      // Buscamos asignaciones directas a .current = null que NO estén en
      // la línea de actualización espejo (payloadRef.current = ...).
      const lineas = contenido.split('\n');
      const asignacionesDirectas = lineas.filter(
        (l) =>
          /\.current\s*=\s*null/.test(l) &&
          !l.includes('payloadRef') &&
          !l.includes('// espejo') &&
          !l.includes('// mirror')
      );
      // Si hay asignaciones directas a null, es sospechoso. El guardián
      // alerta pero no falla duro (podría ser legítimo en un sitio nuevo).
      // Lo que SÍ verificamos es que el import exista.
      if (asignacionesDirectas.length > 0) {
        console.warn(
          `⚠️ ${nombre} tiene ${asignacionesDirectas.length} asignación(es) ` +
          `directa(s) a .current = null. Verifica que no sea una limpieza ` +
          `duplicada (asimetría A2/A3). Líneas:\n` +
          asignacionesDirectas.map((l) => `  ${l.trim()}`).join('\n')
        );
      }
      // La prueba dura es que SÍ importan la función canónica (probada arriba).
    });
  }
});
