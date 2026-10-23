#!/usr/bin/env node
/**
 * guard-produccion.mjs — REGLA 0 + REGLA 1 del ERP COMBINADO.
 *
 * Falla (exit 1) si algún archivo de ERP-COMBINADO/ importa código del ERP de
 * producción. Es la compuerta que impide repetir el Incidente #2, donde un
 * refactor cruzado congeló todas las terminales.
 *
 * Qué busca: construcciones reales de importación (ESM, dinámica, CommonJS y
 * Python) cuya ruta apunte al árbol de producción.
 *
 * Qué NO busca (a propósito):
 *   - menciones en documentación (.md) — son citas, no código
 *   - menciones dentro de comentarios — se eliminan antes de escanear
 *   - este mismo archivo — se excluye explícitamente
 *
 * Uso:
 *   node scripts/guard-produccion.mjs
 *   node scripts/guard-produccion.mjs --verbose
 *
 * Salida:
 *   exit 0 → árbol limpio
 *   exit 1 → al menos una violación
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(__dirname, '..');

/** Este mismo archivo se excluye: su documentación cita la ruta prohibida. */
const ARCHIVO_PROPIO = fileURLToPath(import.meta.url);

const VERBOSE = process.argv.includes('--verbose');

/** Extensiones de código que se inspeccionan. */
const EXTENSIONES = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx',
  '.py', '.json', '.html', '.css',
]);

/** Directorios que se ignoran por completo. */
const IGNORAR_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  '.pytest_cache', '.venv', 'venv', '.mypy_cache', '.ruff_cache',
  'coverage', 'htmlcov', '.vite',
]);

/**
 * Patrones de violación. Cada uno captura la ruta de producción dentro de una
 * construcción de importación real, no una mención suelta.
 */
const PATRONES = [
  {
    id: 'G-01',
    descripcion: 'import ESM desde ERP-R-DE-RICO/apps/',
    regex: /(?:^|\s)(?:import|export)\s[^;\n]*?from\s*['"`][^'"`]*ERP-R-DE-RICO[\\/]+apps[\\/]/m,
  },
  {
    id: 'G-02',
    descripcion: 'import() dinámico desde ERP-R-DE-RICO/apps/',
    regex: /import\s*\(\s*['"`][^'"`]*ERP-R-DE-RICO[\\/]+apps[\\/]/m,
  },
  {
    id: 'G-03',
    descripcion: 'require() desde ERP-R-DE-RICO/apps/',
    regex: /require\s*\(\s*['"`][^'"`]*ERP-R-DE-RICO[\\/]+apps[\\/]/m,
  },
  {
    id: 'G-04',
    descripcion: 'import de Python desde ERP-R-DE-RICO/apps/',
    regex: /^\s*(?:from|import)\s+[^\n]*ERP-R-DE-RICO[\\/.]apps[\\/.]/m,
  },
  {
    id: 'G-05',
    descripcion: 'ruta de producción en un src/href de HTML',
    regex: /(?:src|href)\s*=\s*['"`][^'"`]*ERP-R-DE-RICO[\\/]+apps[\\/]/m,
  },
];

/** Recorre el árbol y devuelve la lista de archivos inspeccionables. */
function listarArchivos(dir, acumulado = []) {
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acumulado;
  }

  for (const entrada of entradas) {
    const rutaCompleta = join(dir, entrada.name);

    if (entrada.isDirectory()) {
      if (IGNORAR_DIRS.has(entrada.name)) continue;
      listarArchivos(rutaCompleta, acumulado);
      continue;
    }

    if (!entrada.isFile()) continue;

    const punto = entrada.name.lastIndexOf('.');
    if (punto === -1) continue;
    const ext = entrada.name.slice(punto).toLowerCase();
    if (!EXTENSIONES.has(ext)) continue;

    acumulado.push(rutaCompleta);
  }

  return acumulado;
}

/**
 * Reemplaza el contenido de los comentarios por espacios, conservando los
 * saltos de línea para que los números de línea sigan siendo exactos.
 *
 * Sin esto, la documentación de este mismo guard (que cita la ruta prohibida
 * como ejemplo) se reportaría a sí misma como violación.
 */
function neutralizarComentarios(codigo, ext) {
  const esPython = ext === '.py';
  let salida = '';
  let i = 0;
  const n = codigo.length;

  while (i < n) {
    const c = codigo[i];
    const siguiente = codigo[i + 1];

    // Comentario de línea: // en JS, # en Python.
    if ((!esPython && c === '/' && siguiente === '/') || (esPython && c === '#')) {
      while (i < n && codigo[i] !== '\n') {
        salida += ' ';
        i += 1;
      }
      continue;
    }

    // Comentario de bloque: /* ... */ (solo JS).
    if (!esPython && c === '/' && siguiente === '*') {
      salida += '  ';
      i += 2;
      while (i < n && !(codigo[i] === '*' && codigo[i + 1] === '/')) {
        salida += codigo[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < n) {
        salida += '  ';
        i += 2;
      }
      continue;
    }

    salida += c;
    i += 1;
  }

  return salida;
}

/** Devuelve el número de línea (1-indexado) de la primera coincidencia. */
function lineaDe(contenido, indice) {
  let linea = 1;
  for (let i = 0; i < indice && i < contenido.length; i += 1) {
    if (contenido[i] === '\n') linea += 1;
  }
  return linea;
}

function main() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' GUARD DE PRODUCCIÓN — REGLA 0 + REGLA 1');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`Raíz inspeccionada: ${RAIZ}`);

  const archivos = listarArchivos(RAIZ);
  console.log(`Archivos de código encontrados: ${archivos.length}`);

  const violaciones = [];

  for (const archivo of archivos) {
    // El propio guard cita la ruta prohibida en su documentación.
    if (archivo === ARCHIVO_PROPIO) continue;

    let contenido;
    try {
      contenido = readFileSync(archivo, 'utf8');
    } catch {
      continue;
    }

    // Atajo: si el archivo no menciona la ruta, no hay nada que revisar.
    if (!contenido.includes('ERP-R-DE-RICO')) continue;

    const punto = archivo.lastIndexOf('.');
    const ext = punto === -1 ? '' : archivo.slice(punto).toLowerCase();

    // Se escanea el código sin comentarios, pero se reporta sobre el original
    // para que los números de línea coincidan con lo que ve el humano.
    const escaneable = neutralizarComentarios(contenido, ext);

    for (const patron of PATRONES) {
      const coincidencia = patron.regex.exec(escaneable);
      if (!coincidencia) continue;

      violaciones.push({
        id: patron.id,
        descripcion: patron.descripcion,
        archivo: relative(RAIZ, archivo).split(sep).join('/'),
        linea: lineaDe(escaneable, coincidencia.index),
        fragmento: contenido
          .slice(coincidencia.index, coincidencia.index + 160)
          .split('\n')[0]
          .trim(),
      });
    }
  }

  console.log('');

  if (violaciones.length === 0) {
    console.log('✅ Sin violaciones. Ningún archivo importa del ERP de producción.');
    console.log('   REGLA 0: producción intocable.');
    console.log('   REGLA 1: los módulos son standalone.');
    console.log('══════════════════════════════════════════════════════════════');
    process.exit(0);
  }

  console.error(`❌ ${violaciones.length} violación(es) encontrada(s):`);
  console.error('');

  for (const v of violaciones) {
    console.error(`  [${v.id}] ${v.descripcion}`);
    console.error(`        archivo: ${v.archivo}:${v.linea}`);
    console.error(`        código : ${v.fragmento}`);
    console.error('');
  }

  console.error('──────────────────────────────────────────────────────────────');
  console.error(' REGLA 0: ERP-R-DE-RICO es producción en vivo. NO SE TOCA.');
  console.error(' REGLA 1: ningún módulo importa código del ERP viejo.');
  console.error(' Corregir antes de commitear. No hay excepciones.');
  console.error('──────────────────────────────────────────────────────────────');
  process.exit(1);
}

main();
