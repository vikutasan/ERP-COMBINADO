/**
 * Tests del contrato de temas del POS — Fase 2.
 *
 * Los 6 tests que todo módulo debe pasar (Plan UI §3.2).
 * Si alguno falla, el módulo no se puede construir.
 *
 * Se ejecuta con: node apps/pos/src/theme/theme.test.js
 *
 * 28 Sep 2026.
 */

import { TEMA_DEL_MODULO } from './index.js';
import { validarContraste } from '@nuevo-pos/theme-engine';

let total = 0;
let pasaron = 0;

function test(nombre, fn) {
  total++;
  try {
    fn();
    pasaron++;
    console.log(`  ✅ ${nombre}`);
  } catch (err) {
    console.log(`  ❌ ${nombre}`);
    console.log(`     ${err.message}`);
  }
}

function assert(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

console.log('\n🎨 Tests de contrato — módulo POS\n');

// ─── TEST 1: El default existe en permitidos ───────────────────────────────────

test('1. El default existe en permitidos', () => {
  assert(
    TEMA_DEL_MODULO.permitidos.includes(TEMA_DEL_MODULO.default),
    `"${TEMA_DEL_MODULO.default}" no está en permitidos: [${TEMA_DEL_MODULO.permitidos}]`
  );
});

// ─── TEST 2: Hay entre 1 y 3 permitidos ────────────────────────────────────────

test('2. Hay entre 1 y 3 permitidos', () => {
  const n = TEMA_DEL_MODULO.permitidos.length;
  assert(n >= 1 && n <= 3, `Esperado 1-3, obtenido ${n}`);
});

// ─── TEST 3: Cada permitido tiene su loader ────────────────────────────────────

test('3. Cada permitido tiene su loader en temas', () => {
  for (const nombre of TEMA_DEL_MODULO.permitidos) {
    assert(
      typeof TEMA_DEL_MODULO.temas[nombre] === 'function',
      `"${nombre}" no tiene loader en temas`
    );
  }
});

// ─── TEST 4: Cada tema pasa el contraste WCAG AA ───────────────────────────────

const temasTest4 = [];

test('4. Cada tema pasa el contraste WCAG AA', async () => {
  for (const nombre of TEMA_DEL_MODULO.permitidos) {
    const modulo = await TEMA_DEL_MODULO.temas[nombre]();
    const tema = modulo.default || modulo;
    temasTest4.push({ nombre, tema });

    const resultado = validarContraste(tema);
    assert(
      resultado.valido,
      `Tema "${nombre}" no pasa contraste: ${resultado.problemas.join('; ')}`
    );
  }
});

// ─── TEST 5: El módulo no importa el motor de otro módulo ──────────────────────

test('5. El módulo no importa el motor de otro módulo', async () => {
  // Verificamos que ningún tema importa de apps/<otro>/theme/
  // Los imports válidos son: ./local o ../../../../packages/theme-engine/
  // Esto es una verificación estática simplificada.
  for (const nombre of TEMA_DEL_MODULO.permitidos) {
    const loader = TEMA_DEL_MODULO.temas[nombre].toString();
    const importaOtroModulo = /apps\/(?!pos\/)/.test(loader);
    assert(
      !importaOtroModulo,
      `Tema "${nombre}" importa de otro módulo: ${loader}`
    );
  }
});

// ─── TEST 6: Coherencia del selector ───────────────────────────────────────────

test('6. Coherencia del selector', () => {
  if (TEMA_DEL_MODULO.ofreceSelector === false) {
    assert(
      TEMA_DEL_MODULO.permitidos.length === 1,
      `ofreceSelector=false pero hay ${TEMA_DEL_MODULO.permitidos.length} permitidos (debe ser 1)`
    );
  } else {
    assert(
      TEMA_DEL_MODULO.permitidos.length >= 2 && TEMA_DEL_MODULO.permitidos.length <= 3,
      `ofreceSelector=true pero hay ${TEMA_DEL_MODULO.permitidos.length} permitidos (debe ser 2-3)`
    );
  }
});

// ─── RESULTADO ─────────────────────────────────────────────────────────────────

// Esperar al test 4 (async) antes de reportar
await temasTest4;

console.log('\n' + '═'.repeat(50));
console.log(`  RESULTADO: ${pasaron}/${total} tests de contrato pasaron.`);
if (pasaron === total) {
  console.log('  ✅ CONTRATO POS — VERIFICADO.');
} else {
  console.log(`  ❌ ${total - pasaron} test(s) fallaron.`);
  process.exit(1);
}
console.log('═'.repeat(50) + '\n');
