/**
 * Compuerta de CONTRATO — la paleta de post-its NO puede divergir entre el
 * frontend y el backend.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ BLINDA
 * ─────────────────────────────────────────────────────────────────────────────
 * `PALETA_POST_ITS` está declarada DOS veces, en dos lenguajes distintos:
 *
 *   - Frontend (fuente de verdad): `apps/pos/src/constants/paletaPostIts.js`
 *   - Backend  (espejo):           `apps/api/routers/terminals.py`
 *
 * El backend valida en `POST /pos/terminals/config` que cada color entrante
 * pertenezca a SU copia de la paleta. Si las dos listas se desincronizan, el
 * síntoma es confuso: el usuario VE un color en el selector del gestor, lo
 * elige, y el guardado responde **400 "no pertenece a la paleta"**. Un bug de
 * "el color que me ofreces no me dejas usarlo".
 *
 * Este test convierte esa fragilidad SILENCIOSA en una compuerta RUIDOSA: si
 * alguien agrega o quita un color en un lado y olvida el otro, este test falla
 * con un mensaje que dice exactamente qué color sobra o falta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ VIVE EN EL FRONTEND (y no en pytest)
 * ─────────────────────────────────────────────────────────────────────────────
 * El contenedor `api` monta SOLO `./apps/api:/app` (ver `docker-compose.yml`),
 * así que un test de pytest NO puede leer el archivo del frontend: no está
 * montado. Vitest corre en `apps/pos` con acceso completo al sistema de
 * archivos de Node, así que SÍ puede leer el `.py` del backend. Por eso la
 * compuerta vive aquí.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CÓMO SE EXTRAE LA PALETA DEL BACKEND
 * ─────────────────────────────────────────────────────────────────────────────
 * Se lee `terminals.py` como TEXTO y se aísla el bloque de la constante
 * `PALETA_POST_ITS: tuple[str, ...] = ( ... )`, del que se extraen todos los
 * literales `"bg-..."`. No se importa Python (imposible desde JS): se parsea el
 * texto, que es estable porque la constante es una tupla literal.
 *
 * 10 Oct 2026 — deuda (b) del ADR §7.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PALETA_POST_ITS } from './paletaPostIts.js';

// Vitest corre desde `apps/pos`, así que las rutas se resuelven desde el cwd.
const RAIZ_POS = process.cwd();

/** Ruta al router del backend que declara la copia espejo de la paleta. */
const RUTA_BACKEND = resolve(RAIZ_POS, '..', 'api', 'routers', 'terminals.py');

/**
 * Extrae los tokens `bg-...` de la constante `PALETA_POST_ITS` del backend.
 *
 * Aísla el bloque `PALETA_POST_ITS ... = ( ... )` y devuelve la lista de
 * literales de color en el ORDEN en que aparecen. Lanza si no encuentra el
 * bloque (señal de que la constante se renombró o se movió: la compuerta debe
 * fallar, no pasar en silencio).
 *
 * @param {string} fuente — el contenido de `terminals.py`.
 * @returns {string[]} los tokens de color del backend.
 */
function extraerPaletaDelBackend(fuente) {
  // Bloque: `PALETA_POST_ITS: tuple[str, ...] = (` … `)`.
  const bloque = fuente.match(
    /PALETA_POST_ITS\s*:\s*tuple\[str,\s*\.\.\.\]\s*=\s*\(([\s\S]*?)\)/,
  );
  if (!bloque) {
    throw new Error(
      'No se encontró la constante `PALETA_POST_ITS: tuple[str, ...] = (...)` ' +
        'en apps/api/routers/terminals.py. Si se renombró o movió, actualiza ' +
        'esta compuerta de contrato.',
    );
  }
  // Todos los literales de color dentro del bloque, en orden.
  return [...bloque[1].matchAll(/"(bg-[a-z]+-\d+)"/g)].map((m) => m[1]);
}

describe('Contrato de la paleta de post-its — frontend ↔ backend', () => {
  const fuenteBackend = readFileSync(RUTA_BACKEND, 'utf8');
  const paletaBackend = extraerPaletaDelBackend(fuenteBackend);

  it('el backend declara la misma CANTIDAD de colores que el frontend', () => {
    expect(paletaBackend.length).toBe(PALETA_POST_ITS.length);
  });

  it('el backend declara EXACTAMENTE los mismos colores, en el mismo orden', () => {
    // Comparación elemento a elemento: si difieren, el mensaje muestra ambos
    // arreglos completos, así que se ve de inmediato qué color sobra o falta.
    expect(paletaBackend).toEqual([...PALETA_POST_ITS]);
  });

  it('no hay colores duplicados en ninguno de los dos lados', () => {
    expect(new Set(PALETA_POST_ITS).size).toBe(PALETA_POST_ITS.length);
    expect(new Set(paletaBackend).size).toBe(paletaBackend.length);
  });

  it('la paleta tiene 21 tonos (el tamaño acordado con el diseño)', () => {
    expect(PALETA_POST_ITS.length).toBe(21);
  });
});
