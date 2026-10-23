#!/usr/bin/env node
/**
 * verificar-puertos.mjs — guard de puertos del ERP COMBINADO.
 *
 * Lee `modulos.json` y falla (exit 1) si:
 *   - dos módulos comparten puerto de frontend
 *   - dos módulos comparten puerto de API
 *   - dos módulos comparten puerto de PostgreSQL
 *   - un puerto cae fuera de los rangos reservados
 *   - un frontend usa un puerto impar del rango 5200-5241
 *   - una API usa un puerto par del rango 5200-5241
 *   - un módulo pisa un puerto de producción (5000/5001/5433) o de NUEVO-ERP
 *     (5100/5101/5432)
 *
 * Uso:
 *   node scripts/verificar-puertos.mjs
 *   node scripts/verificar-puertos.mjs --verbose
 *
 * Salida:
 *   exit 0 → sin conflictos
 *   exit 1 → al menos un conflicto
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(__dirname, '..');
const RUTA_REGISTRO = resolve(RAIZ, 'modulos.json');

const VERBOSE = process.argv.includes('--verbose');

/** Rangos reservados. */
const RANGO_FRONTEND_API = { min: 5200, max: 5241 };
const RANGO_POSTGRES = { min: 5440, max: 5456 };

/** Puertos de otros proyectos que JAMÁS se pueden usar. */
const PUERTOS_AJENOS = new Map([
  [5000, 'ERP-R-DE-RICO frontend (PRODUCCIÓN)'],
  [5001, 'ERP-R-DE-RICO API (PRODUCCIÓN)'],
  [5433, 'ERP-R-DE-RICO PostgreSQL (PRODUCCIÓN)'],
  [5100, 'NUEVO-ERP frontend (desarrollo)'],
  [5101, 'NUEVO-ERP API (desarrollo)'],
  [5432, 'NUEVO-ERP PostgreSQL (desarrollo)'],
]);

/** Extrae el puerto numérico de una URL tipo http://localhost:5210. */
function puertoDe(url) {
  if (typeof url !== 'string') return null;
  const m = /:(\d{2,5})(?:\/|$)/.exec(url);
  return m ? Number(m[1]) : null;
}

function enRango(puerto, rango) {
  return puerto >= rango.min && puerto <= rango.max;
}

function main() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' VERIFICADOR DE PUERTOS — ERP COMBINADO');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`Registro: ${RUTA_REGISTRO}`);

  let registro;
  try {
    registro = JSON.parse(readFileSync(RUTA_REGISTRO, 'utf8'));
  } catch (error) {
    console.error(`❌ No se pudo leer modulos.json: ${error.message}`);
    process.exit(1);
  }

  const modulos = Array.isArray(registro.modulos) ? registro.modulos : [];
  if (modulos.length === 0) {
    console.error('❌ modulos.json no declara ningún módulo.');
    process.exit(1);
  }

  console.log(`Módulos declarados: ${modulos.length}`);
  console.log('');

  const errores = [];
  const usados = {
    frontend: new Map(),
    api: new Map(),
    postgres: new Map(),
  };

  for (const mod of modulos) {
    const id = mod.id ?? '(sin id)';
    const nombre = mod.nombre ?? id;

    const pFront = puertoDe(mod.frontend);
    const pApi = puertoDe(mod.api);

    // ── Frontend ────────────────────────────────────────────────────────────
    if (pFront === null) {
      errores.push(`${nombre}: no se pudo leer el puerto de frontend (${mod.frontend})`);
    } else {
      if (PUERTOS_AJENOS.has(pFront)) {
        errores.push(`${nombre}: frontend ${pFront} pisa ${PUERTOS_AJENOS.get(pFront)}`);
      }
      if (!enRango(pFront, RANGO_FRONTEND_API)) {
        errores.push(
          `${nombre}: frontend ${pFront} fuera del rango ${RANGO_FRONTEND_API.min}-${RANGO_FRONTEND_API.max}`,
        );
      }
      if (pFront % 2 !== 0) {
        errores.push(`${nombre}: frontend ${pFront} debe ser PAR (los impares son APIs)`);
      }
      if (usados.frontend.has(pFront)) {
        errores.push(
          `${nombre}: frontend ${pFront} ya lo usa ${usados.frontend.get(pFront)}`,
        );
      } else {
        usados.frontend.set(pFront, nombre);
      }
    }

    // ── API ─────────────────────────────────────────────────────────────────
    if (pApi === null) {
      errores.push(`${nombre}: no se pudo leer el puerto de API (${mod.api})`);
    } else {
      if (PUERTOS_AJENOS.has(pApi)) {
        errores.push(`${nombre}: API ${pApi} pisa ${PUERTOS_AJENOS.get(pApi)}`);
      }
      if (!enRango(pApi, RANGO_FRONTEND_API)) {
        errores.push(
          `${nombre}: API ${pApi} fuera del rango ${RANGO_FRONTEND_API.min}-${RANGO_FRONTEND_API.max}`,
        );
      }
      if (pApi % 2 === 0) {
        errores.push(`${nombre}: API ${pApi} debe ser IMPAR (los pares son frontends)`);
      }
      if (usados.api.has(pApi)) {
        errores.push(`${nombre}: API ${pApi} ya la usa ${usados.api.get(pApi)}`);
      } else {
        usados.api.set(pApi, nombre);
      }
    }

    // ── Frontend vs API del mismo rango ─────────────────────────────────────
    if (pFront !== null && pApi !== null && pFront === pApi) {
      errores.push(`${nombre}: frontend y API comparten el puerto ${pFront}`);
    }

    // ── PostgreSQL ──────────────────────────────────────────────────────────
    const pDb = mod.db_port ?? null;
    if (pDb !== null) {
      if (PUERTOS_AJENOS.has(pDb)) {
        errores.push(`${nombre}: PostgreSQL ${pDb} pisa ${PUERTOS_AJENOS.get(pDb)}`);
      }
      if (!enRango(pDb, RANGO_POSTGRES)) {
        errores.push(
          `${nombre}: PostgreSQL ${pDb} fuera del rango ${RANGO_POSTGRES.min}-${RANGO_POSTGRES.max}`,
        );
      }
      if (usados.postgres.has(pDb)) {
        errores.push(
          `${nombre}: PostgreSQL ${pDb} ya lo usa ${usados.postgres.get(pDb)}`,
        );
      } else {
        usados.postgres.set(pDb, nombre);
      }
    }

    if (VERBOSE) {
      console.log(
        `  ${String(mod.orden ?? '?').padStart(2)}. ${nombre.padEnd(28)} ` +
          `front ${String(pFront ?? '—').padStart(4)}  ` +
          `api ${String(pApi ?? '—').padStart(4)}  ` +
          `db ${String(pDb ?? '—').padStart(4)}  ` +
          `[${mod.estado ?? 'sin estado'}]`,
      );
    }
  }

  console.log('');

  if (errores.length === 0) {
    console.log(`✅ Sin conflictos. ${modulos.length} módulos, ${usados.frontend.size} frontends, ` +
      `${usados.api.size} APIs, ${usados.postgres.size} bases.`);
    console.log(`   Rango frontends/APIs: ${RANGO_FRONTEND_API.min}-${RANGO_FRONTEND_API.max}`);
    console.log(`   Rango PostgreSQL    : ${RANGO_POSTGRES.min}-${RANGO_POSTGRES.max}`);
    console.log('══════════════════════════════════════════════════════════════');
    process.exit(0);
  }

  console.error(`❌ ${errores.length} conflicto(s) de puertos:`);
  console.error('');
  for (const e of errores) console.error(`  • ${e}`);
  console.error('');
  console.error('──────────────────────────────────────────────────────────────');
  console.error(' Corregir modulos.json antes de commitear.');
  console.error('──────────────────────────────────────────────────────────────');
  process.exit(1);
}

main();
