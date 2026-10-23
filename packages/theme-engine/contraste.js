/**
 * Cálculo de contraste WCAG — packages/theme-engine/contraste.js
 *
 * Implementa el cálculo de luminancia relativa y ratio de contraste
 * según WCAG 2.1 (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio).
 *
 * Se usa en:
 * - validarContraste(): para verificar que un tema pasa AA.
 * - El Extractor de Estética Visual (Fase 1.5): para validar tokens extraídos.
 *
 * REGLA: texto/fondo ≥ 4.5:1 (AA normal), acento/fondo ≥ 3:1 (AA large/UI).
 *
 * Fase 1 — 28 Sep 2026.
 */

/**
 * Convierte un canal sRGB (0-255) a su valor lineal.
 * @param {number} canal - Valor 0-255.
 * @returns {number} Valor lineal 0-1.
 */
function linearizar(canal) {
  const s = canal / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * Calcula la luminancia relativa de un color dado como canales RGB.
 * @param {string} canalesRGB - Canales separados por espacio, ej: "193 215 46".
 * @returns {number} Luminancia relativa (0-1).
 */
export function luminancia(canalesRGB) {
  const [r, g, b] = canalesRGB
    .trim()
    .split(/\s+/)
    .map(Number);
  return 0.2126 * linearizar(r) + 0.7152 * linearizar(g) + 0.0722 * linearizar(b);
}

/**
 * Calcula el ratio de contraste entre dos colores (canales RGB).
 * @param {string} colorA - Canales RGB, ej: "253 251 247".
 * @param {string} colorB - Canales RGB, ej: "10 10 10".
 * @returns {number} Ratio de contraste (1-21).
 */
export function contraste(colorA, colorB) {
  const lumA = luminancia(colorA);
  const lumB = luminancia(colorB);
  const claro = Math.max(lumA, lumB);
  const oscuro = Math.min(lumA, lumB);
  return (claro + 0.05) / (oscuro + 0.05);
}

/**
 * Valida que un tema cumpla los requisitos mínimos de contraste WCAG AA.
 *
 * Reglas:
 * - texto (cremaTicket) / fondo (fondoProfundo) ≥ 4.5:1 (AA normal text).
 * - acento / fondo (fondoProfundo) ≥ 3:1 (AA large text / UI components).
 * - peligro y acento deben ser distinguibles (ratio ≥ 1.5:1).
 *
 * @param {object} tema - Objeto con los 6 tokens en canales RGB.
 * @param {string} tema.acento - Canales RGB del acento.
 * @param {string} tema.fondoProfundo - Canales RGB del fondo principal.
 * @param {string} tema.fondoPanel - Canales RGB del panel.
 * @param {string} tema.cremaTicket - Canales RGB del texto claro.
 * @param {string} tema.peligro - Canales RGB del color de peligro.
 * @returns {{ valido: boolean, resultados: Array, problemas: Array }}
 */
export function validarContraste(tema) {
  const resultados = [];
  const problemas = [];

  // 1. Texto sobre fondo profundo (≥ 4.5:1)
  const textoFondo = contraste(tema.cremaTicket, tema.fondoProfundo);
  resultados.push({
    par: 'texto/fondo-profundo',
    ratio: textoFondo,
    minimo: 4.5,
    pasa: textoFondo >= 4.5,
  });
  if (textoFondo < 4.5) {
    problemas.push(
      `texto sobre fondo-profundo: ${textoFondo.toFixed(2)}:1 (mínimo 4.5:1)`
    );
  }

  // 2. Texto sobre panel (≥ 4.5:1)
  const textoPanel = contraste(tema.cremaTicket, tema.fondoPanel);
  resultados.push({
    par: 'texto/fondo-panel',
    ratio: textoPanel,
    minimo: 4.5,
    pasa: textoPanel >= 4.5,
  });
  if (textoPanel < 4.5) {
    problemas.push(
      `texto sobre fondo-panel: ${textoPanel.toFixed(2)}:1 (mínimo 4.5:1)`
    );
  }

  // 3. Acento sobre fondo profundo (≥ 3:1 — AA for UI components)
  const acentoFondo = contraste(tema.acento, tema.fondoProfundo);
  resultados.push({
    par: 'acento/fondo-profundo',
    ratio: acentoFondo,
    minimo: 3,
    pasa: acentoFondo >= 3,
  });
  if (acentoFondo < 3) {
    problemas.push(
      `acento sobre fondo-profundo: ${acentoFondo.toFixed(2)}:1 (mínimo 3:1)`
    );
  }

  // 4. Acento sobre panel (≥ 3:1)
  const acentoPanel = contraste(tema.acento, tema.fondoPanel);
  resultados.push({
    par: 'acento/fondo-panel',
    ratio: acentoPanel,
    minimo: 3,
    pasa: acentoPanel >= 3,
  });
  if (acentoPanel < 3) {
    problemas.push(
      `acento sobre fondo-panel: ${acentoPanel.toFixed(2)}:1 (mínimo 3:1)`
    );
  }

  // 5. Peligro distinguible del acento (≥ 1.5:1)
  const peligroAcento = contraste(tema.peligro, tema.acento);
  resultados.push({
    par: 'peligro/acento',
    ratio: peligroAcento,
    minimo: 1.5,
    pasa: peligroAcento >= 1.5,
  });
  if (peligroAcento < 1.5) {
    problemas.push(
      `peligro y acento son demasiado parecidos: ${peligroAcento.toFixed(2)}:1 (mínimo 1.5:1)`
    );
  }

  return {
    valido: problemas.length === 0,
    resultados,
    problemas,
  };
}
