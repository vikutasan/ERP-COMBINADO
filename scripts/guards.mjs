#!/usr/bin/env node
/**
 * guards.mjs — Los greps de estándares (§7.4 del Prompt del Arquitecto + A-04).
 *
 * Un estándar que no se ejecuta es una opinión. Estos greps convierten los
 * estándares en PUERTAS DE MÁQUINA. Se activan en F0, no después.
 *
 * Referencia:
 *   ../PLANOS-ARQUITECTONICOS-DEL-NUEVO-POS/06-prompt-del-arquitecto/PROMPT_DEL_ARQUITECTO_DEL_NUEVO_POS.md §7.4
 *   ../PLANOS-ARQUITECTONICOS-DEL-NUEVO-POS/05-plan-de-construccion/PLAN_DE_CONSTRUCCION_DEL_NUEVO_POS.md §6.2 (A-04)
 *
 * Greps (9 en total):
 *   F0 (5): E-05 except...pass · E-15 console.log · E-15 TODO sin "TODO:" ·
 *           E-09 Float en models.py · E-10 DateTime() en models.py
 *   F4 (1): A-04 except...pass acotado a la ruta crítica (guards/)
 *   F5 (1): R-01 ancho fijo (w-[...px]) en el contenedor raíz de la superficie
 *   F12 (1): E-09-FE suma de dinero en el frontend (DT-02 regla 6)
 *   R3 (1): N-01 nomenclatura `product.id` con punto (trampa latente RN-17)
 *
 * El número de greps se verifica por máquina en `guards-coverage.mjs` (R1):
 * si se agrega un grep aquí sin cablearlo en CI, la puerta FALLA.
 *
 * Regla: si un grep encuentra 1+ coincidencia, la puerta FALLA (exit 1).
 * En F0 el repo está vacío de código, así que los 5 greps deben dar 0 coincidencias.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Carpetas que se escanean (la obra). docs/ y scripts/ quedan fuera.
const SCAN_DIRS = ['apps', 'packages'];

// Extensiones de código que se escanean.
const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py']);

// Carpetas que NUNCA se escanean: artefactos de build y dependencias.
// (D-7) `dist/` es un artefacto generado por Vite; no es código fuente.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.vite']);

// (D-7) Los archivos de test son HERRAMIENTAS, no la obra: sus reporteros
// usan `console.log` legítimamente para imprimir el resultado de la puerta.
const TEST_FILE_RE = /\.test\.(js|jsx|ts|tsx|mjs|cjs)$/;

/**
 * Recorre un directorio recursivamente y devuelve las rutas de archivos de código.
 */
function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc; // El directorio no existe todavía (F0: esqueleto vacío).
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, acc);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      const ext = dot >= 0 ? entry.name.slice(dot) : '';
      if (CODE_EXT.has(ext)) acc.push(full);
    }
  }
  return acc;
}

/**
 * Recolecta todos los archivos de código de la obra.
 */
function collectFiles() {
  const files = [];
  for (const d of SCAN_DIRS) {
    walk(join(ROOT, d), files);
  }
  return files;
}

/**
 * Definición de los 5 greps. Cada uno declara:
 *   - id:      el estándar (E-05, E-15, E-09, E-10)
 *   - label:   descripción humana
 *   - test:    (linea, archivo) => boolean
 *   - onlyModels: si solo aplica a models.py (E-09, E-10)
 */
export const GREPS = [
  {
    id: 'E-05',
    label: 'Silencios en ruta crítica (except ... pass)',
    onlyModels: false,
    test: (line) => /except[^\n]*:\s*pass\b/.test(line) || /except\s+.*:\s*pass\b/.test(line),
  },
  {
    // A-04 (F4): la ruta crítica (guards/) NO puede silenciar excepciones.
    // Es el mismo patrón que E-05, pero acotado a la ruta crítica para que
    // el estándar quede trazable a la deuda A-04 del Plan §6.2.
    id: 'A-04',
    label: 'Silencios en la ruta crítica de guardianes (guards/ except ... pass)',
    onlyModels: false,
    onlyPath: 'guards/',
    test: (line) => /except[^\n]*:\s*pass\b/.test(line) || /except\s+.*:\s*pass\b/.test(line),
  },
  {
    // (D-7) Los archivos de test son herramientas: sus reporteros imprimen el
    // resultado de la puerta con `console.log`. Se excluyen del grep.
    id: 'E-15',
    label: 'Logs olvidados (console.log)',
    onlyModels: false,
    skipTests: true,
    test: (line) => /console\.log\s*\(/.test(line),
  },
  {
    // (D-7) Un TODO está "declarado" si usa `TODO:` o `TODO(scope)`.
    // Se exige que `TODO` esté en MAYÚSCULAS como marcador de código y que NO
    // sea la palabra española "todo" en prosa (p. ej. "TODO monto que cruza la
    // frontera..."). El marcador de código va seguido de `:` o `(`.
    id: 'E-15',
    label: 'TODOs sin formato declarado (TODO sin "TODO:" ni "TODO(...)")',
    onlyModels: false,
    test: (line) => /\bTODO\b/.test(line) && !/\bTODO[:(]/.test(line) && !/\bTODO\s+[a-záéíóúñ]/.test(line),
  },
  {
    // R-01 (F5): la superficie NO puede tener anchos absolutos en píxeles.
    // Se prohíbe `w-[<n>px]` pero se permite `max-w-[...]` y `min-w-[...]`
    // (fluidos / tablas con scroll). Acotado a la superficie del POS.
    id: 'R-01',
    label: 'Ancho fijo en la superficie (w-[...px] sin max-/min-)',
    onlyModels: false,
    onlyPath: 'apps/pos/',
    test: (line) => /(?<!max-)(?<!min-)\bw-\[\d+px\]/.test(line),
  },
  {
    id: 'E-09',
    label: 'Dinero en Float (Float en models.py)',
    onlyModels: true,
    test: (line) => /\bFloat\b/.test(line),
  },
  {
    // E-09-FE (F12) — DT-02 regla 6: "El dinero no se suma en el frontend.
    // Los totales vienen del backend. El frontend solo formatea."
    //
    // El guard E-09 original solo miraba `Float` en `models.py` (backend) y
    // era CIEGO a la suma de dinero en el frontend. Este grep cierra ese punto
    // ciego: detecta un `reduce` que acumula sobre el precio de una LÍNEA
    // (`unit_price` / `price`), que es exactamente cómo se derivaba el total
    // del ticket en el frontend antes del fix arquitectónico.
    //
    // NO marca la suma de PAGOS (`monto`): validar que los pagos del usuario
    // cuadran con el total del backend es un espejo UX de RN-94, no una
    // derivación del total del ticket. Por eso el patrón exige `unit_price`
    // o `price`, no `monto`.
    //
    // Acotado a la superficie del POS y excluye tests (que sí pueden sumar
    // para construir fixtures).
    id: 'E-09-FE',
    label: 'Suma de dinero en el frontend (reduce sobre unit_price/price) — DT-02 regla 6',
    onlyModels: false,
    onlyPath: 'apps/pos/',
    skipTests: true,
    test: (line) =>
      /\.reduce\s*\(/.test(line) &&
      /\b(unit_price|price)\b/.test(line) &&
      // Escape hatch EXPLÍCITO y auditable: el único fallback local permitido
      // (modo sin servidor) se marca con `DT-02-FALLBACK-LOCAL`. Cualquier otra
      // suma de líneas en el frontend sigue fallando la puerta.
      !/DT-02-FALLBACK-LOCAL/.test(line),
  },
  {
    // N-01 (R3) — CONTRATO DE NOMENCLATURA `product_id` / `item_id`.
    //
    // RN-17 (fusión por producto) se implementa en el nuevo POS sobre el campo
    // `product_id` (snake_case, contrato de la API). El POS VIEJO fusionaba por
    // `product.id` (acceso a propiedad de objeto). Ambos funcionan, pero la
    // discrepancia de nomenclatura es una TRAMPA LATENTE: alguien que copie un
    // fragmento del viejo POS (`product.id`) al nuevo introduce un `undefined`
    // silencioso que rompe la fusión sin que ningún test lo note.
    //
    // Este grep prohíbe el acceso `product.id` (con PUNTO) en la superficie del
    // POS. La forma canónica es `product_id` (guion bajo). Se permite
    // `product.id` SOLO si la línea lleva el escape hatch auditable
    // `N-01-LEGACY` (p. ej. un comentario que documenta una lectura del viejo).
    //
    // Acotado a la superficie del POS y excluye tests (que pueden citar el viejo).
    id: 'N-01',
    label: 'Nomenclatura legacy `product.id` con punto (usar `product_id`) — contrato RN-17',
    onlyModels: false,
    onlyPath: 'apps/pos/',
    skipTests: true,
    test: (line) =>
      /\bproduct\.id\b/.test(line) &&
      // Escape hatch EXPLÍCITO y auditable: documentar una lectura del viejo POS.
      !/N-01-LEGACY/.test(line),
  },
  {
    id: 'E-10',
    label: 'Tiempo naive (DateTime() en models.py)',
    onlyModels: true,
    test: (line) => /DateTime\(\s*\)/.test(line),
  },
  {
    // FD-02 — ANTI-HEX (modo RATCHET).
    //
    // Los colores deben viajar como tokens CSS (rgb(var(--x))), no como
    // literales hex en el código de componentes.
    //
    // MODO RATCHET: no falla si ya hay hex (deuda histórica). Solo falla si el
    // número de violaciones CRECE por encima del umbral. Bajar `umbralMax` en
    // cada sprint de limpieza de estilos para apretar el ratchet.
    //
    // Umbral inicial (14 Oct 2026, commit FD-02): 130 (real: ~122 + margen 8).
    // Sprint 2 (14 Oct 2026, FS2-06): bajado a 90 (real: 89 tras migración de TerminalSelector).
    // EXCEPCIONES: líneas con `HEX-OK` o líneas de comentario puro se excluyen.
    id: 'FD-02',
    label: 'Color hex hardcodeado [RATCHET max=90] (usar rgb(var(--token)))',
    onlyModels: false,
    onlyPath: 'apps/pos/',
    skipTests: true,
    umbralMax: 90,
    test: (line) => {
      const stripped = line.trimStart();
      if (stripped.startsWith('//') || stripped.startsWith('*')) return false;
      return /#[0-9a-fA-F]{3,8}\b/.test(line) && !/HEX-OK/.test(line);
    },
  },
];


/**
 * Ejecuta un grep sobre los archivos recolectados.
 */
function runGrep(grep, files) {
  const hits = [];
  for (const file of files) {
    if (grep.onlyModels && !file.endsWith('models.py')) continue;
    if (grep.skipTests && TEST_FILE_RE.test(file)) continue;
    if (grep.onlyPath && !relative(ROOT, file).replace(/\\/g, '/').includes(grep.onlyPath)) continue;
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (grep.test(lines[i])) {
        hits.push({ file: relative(ROOT, file), line: i + 1, text: lines[i].trim() });
      }
    }
  }
  return hits;
}

function main() {
  const files = collectFiles();
  console.log('=== GUARDIANES DE ESTÁNDARES (F0 + F4/A-04) ===');
  console.log(`Archivos de código escaneados: ${files.length}`);
  console.log('');

  let failed = false;

  for (const grep of GREPS) {
    const hits = runGrep(grep, files);
    const isRatchet = typeof grep.umbralMax === 'number';
    const exceedsThreshold = isRatchet ? hits.length > grep.umbralMax : hits.length > 0;
    const status = hits.length === 0 ? 'OK  ' : exceedsThreshold ? 'FAIL' : 'WARN';

    if (isRatchet) {
      console.log(`[${status}] ${grep.id} — ${grep.label} → ${hits.length}/${grep.umbralMax} (${exceedsThreshold ? 'CRECIÓ' : 'bajo umbral'})`);
    } else {
      console.log(`[${status}] ${grep.id} — ${grep.label} → ${hits.length} coincidencia(s)`);
    }

    if (exceedsThreshold) {
      failed = true;
      for (const h of hits.slice(0, 10)) {
        console.log(`         ${h.file}:${h.line}  ${h.text}`);
      }
      if (hits.length > 10) {
        console.log(`         ... y ${hits.length - 10} más`);
      }
    } else if (!isRatchet && hits.length > 0) {
      failed = true;
      for (const h of hits.slice(0, 10)) {
        console.log(`         ${h.file}:${h.line}  ${h.text}`);
      }
      if (hits.length > 10) {
        console.log(`         ... y ${hits.length - 10} más`);
      }
    }
  }

  console.log('');
  if (failed) {
    console.error('PUERTA F0 EN ROJO: hay violaciones de estándares.');
    process.exit(1);
  }
  console.log('PUERTA F0 EN VERDE: los greps de estándares están activos y limpios.');
  console.log('PUERTA F4/A-04 EN VERDE: 0 silencios en la ruta crítica (guards/).');
  console.log('PUERTA F5/R-01 EN VERDE: 0 anchos fijos en la superficie (apps/pos/).');
  console.log('PUERTA F12/E-09-FE EN VERDE: 0 sumas de dinero en el frontend (DT-02 regla 6).');
  console.log('PUERTA R3/N-01 EN VERDE: 0 usos de `product.id` con punto (contrato RN-17).');
  console.log('PUERTA FD-02 EN VERDE: hex hardcodeados bajo el umbral del ratchet.');
}

// Solo ejecuta la puerta cuando se invoca como script (no al importarlo desde
// `guards-coverage.mjs`, que necesita leer `GREPS` sin correr los greps).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
