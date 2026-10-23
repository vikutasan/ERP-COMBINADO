/**
 * Tests del theme-engine — Fase 1.
 *
 * Verifica las 6 funciones del motor + la paleta canónica actual.
 * Se ejecuta con: node packages/theme-engine/theme-engine.test.js
 *
 * 28 Sep 2026.
 */

import {
  luminancia,
  contraste,
  validarContraste,
  aplicarTema,
  normalizarACanalesRGB,
  mapearACatalogo,
  crearTemaDesdeTokens,
  PALETA_CANONICA,
  CATALOGO_FUENTES,
} from './index.js';

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

function assertCerca(valor, esperado, margen, mensaje) {
  if (Math.abs(valor - esperado) > margen) {
    throw new Error(`${mensaje}: esperado ~${esperado}, obtenido ${valor}`);
  }
}

// ─── GRUPO 1: normalizarACanalesRGB ────────────────────────────────────────────

console.log('\n📐 normalizarACanalesRGB');

test('convierte #c1d72e a canales RGB', () => {
  assert(normalizarACanalesRGB('#c1d72e') === '193 215 46', 'Debe ser 193 215 46');
});

test('convierte #0a0a0a a canales RGB', () => {
  assert(normalizarACanalesRGB('#0a0a0a') === '10 10 10', 'Debe ser 10 10 10');
});

test('convierte #fdfbf7 a canales RGB', () => {
  assert(normalizarACanalesRGB('#fdfbf7') === '253 251 247', 'Debe ser 253 251 247');
});

test('convierte #ef4444 a canales RGB', () => {
  assert(normalizarACanalesRGB('#ef4444') === '239 68 68', 'Debe ser 239 68 68');
});

test('acepta hex sin # (ef4444)', () => {
  assert(normalizarACanalesRGB('ef4444') === '239 68 68', 'Debe aceptar sin #');
});

test('expande formato corto #f00 → 255 0 0', () => {
  assert(normalizarACanalesRGB('#f00') === '255 0 0', 'Debe expandir #f00');
});

test('ignora canal alfa (#c1d72eff → 193 215 46)', () => {
  assert(normalizarACanalesRGB('#c1d72eff') === '193 215 46', 'Debe ignorar alfa');
});

test('lanza error con hex inválido', () => {
  let lanzo = false;
  try { normalizarACanalesRGB('xyz'); } catch { lanzo = true; }
  assert(lanzo, 'Debe lanzar error con hex inválido');
});

// ─── GRUPO 2: luminancia y contraste ───────────────────────────────────────────

console.log('\n🔆 luminancia y contraste');

test('blanco tiene luminancia ~1', () => {
  assertCerca(luminancia('255 255 255'), 1.0, 0.01, 'Luminancia del blanco');
});

test('negro tiene luminancia ~0', () => {
  assertCerca(luminancia('0 0 0'), 0.0, 0.01, 'Luminancia del negro');
});

test('contraste blanco/negro = 21:1', () => {
  assertCerca(contraste('255 255 255', '0 0 0'), 21, 0.1, 'Contraste B/N');
});

test('contraste de un color consigo mismo = 1:1', () => {
  assertCerca(contraste('193 215 46', '193 215 46'), 1, 0.01, 'Contraste consigo mismo');
});

// ─── GRUPO 3: validarContraste con la paleta canónica ──────────────────────────

console.log('\n🎨 validarContraste (paleta canónica)');

test('la paleta canónica pasa WCAG AA completa', () => {
  const resultado = validarContraste(PALETA_CANONICA);
  assert(resultado.valido, `No pasó: ${resultado.problemas.join('; ')}`);
});

test('devuelve 5 pares de contraste', () => {
  const resultado = validarContraste(PALETA_CANONICA);
  assert(resultado.resultados.length === 5, `Esperado 5 pares, obtenido ${resultado.resultados.length}`);
});

test('texto/fondo-profundo ≥ 4.5:1', () => {
  const resultado = validarContraste(PALETA_CANONICA);
  const par = resultado.resultados.find(r => r.par === 'texto/fondo-profundo');
  assert(par.ratio >= 4.5, `Ratio: ${par.ratio.toFixed(2)}`);
});

test('acento/fondo-profundo ≥ 3:1', () => {
  const resultado = validarContraste(PALETA_CANONICA);
  const par = resultado.resultados.find(r => r.par === 'acento/fondo-profundo');
  assert(par.ratio >= 3, `Ratio: ${par.ratio.toFixed(2)}`);
});

test('peligro distinguible del acento', () => {
  const resultado = validarContraste(PALETA_CANONICA);
  const par = resultado.resultados.find(r => r.par === 'peligro/acento');
  assert(par.pasa, `Ratio: ${par.ratio.toFixed(2)} (mínimo 1.5)`);
});

test('detecta tema con contraste insuficiente', () => {
  const temaRoto = {
    acento: '50 50 50',        // gris oscuro sobre negro = poco contraste
    fondoProfundo: '40 40 40', // casi igual
    fondoProfundoAlt: '30 30 30',
    fondoPanel: '45 45 45',
    cremaTicket: '60 60 60',   // gris oscuro sobre gris oscuro
    peligro: '55 55 55',
  };
  const resultado = validarContraste(temaRoto);
  assert(!resultado.valido, 'Debería fallar el contraste');
  assert(resultado.problemas.length > 0, 'Debería tener problemas');
});

// ─── GRUPO 4: mapearACatalogo ──────────────────────────────────────────────────

console.log('\n🔤 mapearACatalogo');

test('coincidencia exacta: "Inter" → Inter, confianza 100', () => {
  const r = mapearACatalogo('Inter');
  assert(r.nombre === 'Inter', `Nombre: ${r.nombre}`);
  assert(r.confianza === 100, `Confianza: ${r.confianza}`);
});

test('coincidencia case-insensitive: "montserrat" → Montserrat', () => {
  const r = mapearACatalogo('montserrat');
  assert(r.nombre === 'Montserrat', `Nombre: ${r.nombre}`);
  assert(r.confianza === 100, `Confianza: ${r.confianza}`);
});

test('coincidencia parcial: "Poppi" → Poppins, confianza 80', () => {
  const r = mapearACatalogo('Poppi');
  assert(r.nombre === 'Poppins', `Nombre: ${r.nombre}`);
  assert(r.confianza === 80, `Confianza: ${r.confianza}`);
});

test('sin coincidencia: "Comic Sans" → Inter (default), confianza 0', () => {
  const r = mapearACatalogo('Comic Sans');
  assert(r.nombre === 'Inter', `Nombre: ${r.nombre}`);
  assert(r.confianza === 0, `Confianza: ${r.confianza}`);
});

test('null → Inter (default), confianza 0', () => {
  const r = mapearACatalogo(null);
  assert(r.nombre === 'Inter', `Nombre: ${r.nombre}`);
  assert(r.confianza === 0, `Confianza: ${r.confianza}`);
});

// ─── GRUPO 5: crearTemaDesdeTokens ─────────────────────────────────────────────

console.log('\n🏗️  crearTemaDesdeTokens');

test('convierte tokens hex a canales RGB', () => {
  const tema = crearTemaDesdeTokens({
    acento: '#7a8b3c',
    fondoProfundo: '#1c1613',
    fondoProfundoAlt: '#2a211c',
    fondoPanel: '#2a211c',
    cremaTicket: '#f5efe3',
    peligro: '#c0392b',
  }, 'Cálido');
  assert(tema.nombre === 'Cálido', 'Nombre incorrecto');
  assert(tema.acento === '122 139 60', `Acento: ${tema.acento}`);
  assert(tema.cremaTicket === '245 239 227', `Crema: ${tema.cremaTicket}`);
});

test('acepta tokens que ya son canales RGB', () => {
  const tema = crearTemaDesdeTokens({
    acento: '193 215 46',
    fondoProfundo: '10 10 10',
    fondoProfundoAlt: '8 8 8',
    fondoPanel: '26 26 26',
    cremaTicket: '253 251 247',
    peligro: '239 68 68',
  });
  assert(tema.acento === '193 215 46', `Acento: ${tema.acento}`);
});

test('rellena tokens faltantes con canónica', () => {
  const tema = crearTemaDesdeTokens({ acento: '#ff0000' });
  assert(tema.acento === '255 0 0', `Acento: ${tema.acento}`);
  assert(tema.fondoProfundo === '10 10 10', 'Fondo debería ser canónico');
  assert(tema.peligro === '239 68 68', 'Peligro debería ser canónico');
});

test('acepta nombres con snake_case (del backend)', () => {
  const tema = crearTemaDesdeTokens({
    acento: '#c1d72e',
    fondo_profundo: '#0a0a0a',
    fondo_profundo_alt: '#080808',
    fondo_panel: '#1a1a1a',
    crema_ticket: '#fdfbf7',
    peligro: '#ef4444',
  });
  assert(tema.fondoProfundo === '10 10 10', `Fondo: ${tema.fondoProfundo}`);
  assert(tema.cremaTicket === '253 251 247', `Crema: ${tema.cremaTicket}`);
});

// ─── GRUPO 6: PALETA_CANONICA ──────────────────────────────────────────────────

console.log('\n📋 PALETA_CANONICA');

test('tiene los 6 tokens', () => {
  const claves = Object.keys(PALETA_CANONICA);
  assert(claves.length === 6, `Esperado 6, obtenido ${claves.length}`);
  assert(claves.includes('acento'), 'Falta acento');
  assert(claves.includes('fondoProfundo'), 'Falta fondoProfundo');
  assert(claves.includes('fondoProfundoAlt'), 'Falta fondoProfundoAlt');
  assert(claves.includes('fondoPanel'), 'Falta fondoPanel');
  assert(claves.includes('cremaTicket'), 'Falta cremaTicket');
  assert(claves.includes('peligro'), 'Falta peligro');
});

test('los valores son canales RGB (3 números separados por espacio)', () => {
  const patron = /^\d{1,3} \d{1,3} \d{1,3}$/;
  for (const [clave, valor] of Object.entries(PALETA_CANONICA)) {
    assert(patron.test(valor), `${clave}: "${valor}" no es canales RGB`);
  }
});

// ─── GRUPO 7: CATALOGO_FUENTES ─────────────────────────────────────────────────

console.log('\n📚 CATALOGO_FUENTES');

test('tiene exactamente 5 fuentes', () => {
  assert(CATALOGO_FUENTES.length === 5, `Esperado 5, obtenido ${CATALOGO_FUENTES.length}`);
});

test('la primera fuente es Inter (default)', () => {
  assert(CATALOGO_FUENTES[0].nombre === 'Inter', `Primera: ${CATALOGO_FUENTES[0].nombre}`);
});

test('todas tienen nombre, familia y carácter', () => {
  for (const f of CATALOGO_FUENTES) {
    assert(f.nombre, 'Falta nombre');
    assert(f.familia, 'Falta familia');
    assert(f.caracter, 'Falta carácter');
  }
});

// ─── RESULTADO ─────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log(`  RESULTADO: ${pasaron}/${total} tests pasaron.`);
if (pasaron === total) {
  console.log('  ✅ FASE 1 — theme-engine VERIFICADO.');
} else {
  console.log(`  ❌ ${total - pasaron} test(s) fallaron.`);
  process.exit(1);
}
console.log('═'.repeat(50) + '\n');
