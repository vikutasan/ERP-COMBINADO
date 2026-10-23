/**
 * Tests de las utilidades transversales — FASE 3.1.
 *
 * Cubre las 3 utilidades puras (sin React ni DOM):
 *   - withRetries  (cicatriz v7.0.1 — asimetría)
 *   - outcome      (cicatriz v7.0.3 — cuentas perdidas)
 *   - sessionReset (Regla 19 — limpieza espejo)
 *
 * Se ejecuta con: node apps/pos/src/utils/utilidades.test.js
 *
 * 29 Sep 2026.
 */

import { withRetries, BACKOFF_POR_DEFECTO } from './withRetries.js';
import { ok, fallo, esOk, aOutcome } from './outcome.js';
import { buildResetPatch, aplicarReset, resetearSesion, VALOR_INICIAL } from '../state/sessionReset.js';

let total = 0;
let pasaron = 0;
const pendientes = [];

function test(nombre, fn) {
  total++;
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pendientes.push(
        r.then(
          () => { pasaron++; console.log(`  ✅ ${nombre}`); },
          (err) => { console.log(`  ❌ ${nombre}`); console.log(`     ${err.message}`); }
        )
      );
    } else {
      pasaron++;
      console.log(`  ✅ ${nombre}`);
    }
  } catch (err) {
    console.log(`  ❌ ${nombre}`);
    console.log(`     ${err.message}`);
  }
}

function assert(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

function assertIgual(a, b, mensaje) {
  if (a !== b) throw new Error(`${mensaje} (esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)})`);
}

console.log('\n🧱 Tests de utilidades transversales — FASE 3.1\n');

// ═══════════════════════════════════════════════════════════════════════════════
// withRetries — cicatriz v7.0.1
// ═══════════════════════════════════════════════════════════════════════════════

console.log('  ── withRetries ──');

test('withRetries reintenta 3 veces con backoff 1s/2s/3s', async () => {
  const esperas = [];
  let intentos = 0;
  const dormir = async (ms) => { esperas.push(ms); };

  let capturado = null;
  try {
    await withRetries(async () => {
      intentos++;
      throw new Error('falla persistente');
    }, { dormir });
  } catch (err) {
    capturado = err;
  }

  assertIgual(intentos, 3, 'debe intentar 3 veces');
  assert(capturado !== null, 'debe propagar el último error');
  // 3 intentos = 2 esperas (no se espera tras el último fallo)
  assertIgual(esperas.length, 2, 'debe haber 2 esperas');
  assertIgual(esperas[0], 1000, 'primera espera = 1s');
  assertIgual(esperas[1], 2000, 'segunda espera = 2s');
});

test('withRetries devuelve el resultado del primer intento exitoso', async () => {
  let intentos = 0;
  const dormir = async () => {};
  const resultado = await withRetries(async () => {
    intentos++;
    if (intentos < 2) throw new Error('falla transitoria');
    return 'éxito';
  }, { dormir });
  assertIgual(resultado, 'éxito', 'debe devolver el valor');
  assertIgual(intentos, 2, 'debe haber reintentado una vez');
});

test('withRetries es idempotente (2× = mismo estado)', async () => {
  const dormir = async () => {};
  const ejecutar = () => withRetries(async () => 'mismo', { dormir });
  const a = await ejecutar();
  const b = await ejecutar();
  assertIgual(a, b, 'dos ejecuciones deben dar el mismo resultado');
});

test('withRetries respeta debeReintentar=false (no reintenta)', async () => {
  let intentos = 0;
  const dormir = async () => {};
  let capturado = null;
  try {
    await withRetries(async () => {
      intentos++;
      throw new Error('no reintentable');
    }, { dormir, debeReintentar: () => false });
  } catch (err) {
    capturado = err;
  }
  assertIgual(intentos, 1, 'no debe reintentar');
  assert(capturado !== null, 'debe propagar el error');
});

test('withRetries valida sus argumentos', async () => {
  let lanzo = false;
  try { await withRetries(null); } catch { lanzo = true; }
  assert(lanzo, 'debe lanzar si fn no es función');

  lanzo = false;
  try { await withRetries(async () => {}, { intentos: 0 }); } catch { lanzo = true; }
  assert(lanzo, 'debe lanzar si intentos < 1');
});

test('BACKOFF_POR_DEFECTO es [1000,2000,3000]', () => {
  assertIgual(BACKOFF_POR_DEFECTO.join(','), '1000,2000,3000', 'backoff por defecto');
});

// ═══════════════════════════════════════════════════════════════════════════════
// outcome — cicatriz v7.0.3
// ═══════════════════════════════════════════════════════════════════════════════

console.log('  ── outcome ──');

test('ok() construye un éxito con reason=null', () => {
  const r = ok({ id: 1 });
  assertIgual(r.outcome, 'ok', 'outcome');
  assertIgual(r.reason, null, 'reason');
  assertIgual(r.data.id, 1, 'data');
});

test('fallo() construye un error con reason', () => {
  const r = fallo('sin_red');
  assertIgual(r.outcome, 'error', 'outcome');
  assertIgual(r.reason, 'sin_red', 'reason');
});

test('esOk() discrimina sin asumir excepción', () => {
  assert(esOk(ok()), 'ok() debe ser ok');
  assert(!esOk(fallo('x')), 'fallo() no debe ser ok');
  assert(!esOk(null), 'null no debe ser ok');
});

test('aOutcome() NUNCA lanza: convierte rechazo en error', async () => {
  const r = await aOutcome(Promise.reject(new Error('boom')));
  assertIgual(r.outcome, 'error', 'outcome');
  assertIgual(r.reason, 'boom', 'reason debe venir del mensaje');
});

test('aOutcome() envuelve éxito', async () => {
  const r = await aOutcome(Promise.resolve(42));
  assertIgual(r.outcome, 'ok', 'outcome');
  assertIgual(r.data, 42, 'data');
});

test('aOutcome() acepta una función y mapea el reason', async () => {
  const r = await aOutcome(
    () => { throw new Error('crudo'); },
    () => 'reason_mapeado'
  );
  assertIgual(r.reason, 'reason_mapeado', 'reason mapeado');
});

// ═══════════════════════════════════════════════════════════════════════════════
// sessionReset — Regla 19
// ═══════════════════════════════════════════════════════════════════════════════

console.log('  ── sessionReset ──');

test('buildResetPatch devuelve SIEMPRE las mismas claves', () => {
  const a = buildResetPatch({ carritoRef: {}, ticketRef: {} });
  const b = buildResetPatch({ folioRef: {} });
  const clavesA = Object.keys(a).sort().join(',');
  const clavesB = Object.keys(b).sort().join(',');
  assertIgual(clavesA, clavesB, 'las claves deben ser idénticas en toda rama');
});

test('buildResetPatch incluye todas las claves canónicas', () => {
  const patch = buildResetPatch();
  for (const clave of Object.keys(VALOR_INICIAL)) {
    assert(clave in patch, `falta la clave canónica ${clave}`);
  }
});

test('buildResetPatch limpia refs extra declarados por el llamador', () => {
  const patch = buildResetPatch({ refNuevo: { current: 5 } });
  assert('refNuevo' in patch, 'debe incluir el ref extra');
  assertIgual(patch.refNuevo, null, 'el ref extra debe quedar en null');
});

test('aplicarReset muta .current de refs de React', () => {
  const refs = {
    carritoRef: { current: [1, 2, 3] },
    ticketRef: { current: { id: 'T' } },
  };
  aplicarReset(refs, buildResetPatch(refs));
  assertIgual(refs.carritoRef.current, null, 'carritoRef.current');
  assertIgual(refs.ticketRef.current, null, 'ticketRef.current');
});

test('resetearSesion limpia EXACTAMENTE los mismos refs en toda rama', () => {
  const ramas = [
    { carritoRef: { current: [1] }, ticketRef: { current: { id: 'A' } } },
    { carritoRef: { current: [] }, ticketRef: { current: null } },
    { carritoRef: { current: null }, ticketRef: { current: { id: 'B' } } },
  ];
  const estados = ramas.map((refs) => {
    resetearSesion(refs);
    return JSON.stringify(refs);
  });
  const primero = estados[0];
  for (const e of estados) {
    assertIgual(e, primero, 'todas las ramas deben terminar idénticas');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTADO
// ═══════════════════════════════════════════════════════════════════════════════

await Promise.all(pendientes);

console.log('\n' + '═'.repeat(50));
console.log(`  RESULTADO: ${pasaron}/${total} tests de utilidades pasaron.`);
if (pasaron === total) {
  console.log('  ✅ UTILIDADES TRANSVERSALES — VERIFICADAS.');
} else {
  console.log(`  ❌ ${total - pasaron} test(s) fallaron.`);
  process.exit(1);
}
console.log('═'.repeat(50) + '\n');
