/**
 * Motor de temas compartido — packages/theme-engine/index.js
 *
 * El motor tiene 5 funciones públicas. Es deliberadamente pequeño.
 * Vive en `packages/` porque es infraestructura compartida: ningún módulo
 * es su dueño, todos lo usan. Si Vista General se cae, el motor sigue
 * funcionando (ver PROPUESTA_APARIENCIA_POR_MODULO_V4.md §1.2).
 *
 * Funciones:
 *   1. aplicarTema(tema, contenedor)       — escribe canales RGB como CSS vars
 *   2. resolverTema(modulo, eleccion, id)  — decide qué tema aplicar
 *   3. normalizarACanalesRGB(hex)          — convierte hex a canales RGB
 *   4. mapearACatalogo(sugerida, catalogo) — mapea fuente al catálogo cerrado
 *   5. crearTemaDesdeTokens(tokens)        — construye objeto tema desde tokens
 *
 * Re-exports de contraste.js:
 *   - validarContraste, contraste, luminancia
 *
 * Regla de oro: un módulo NUNCA importa el motor de otro módulo.
 * Todos importan `packages/theme-engine/`.
 *
 * Fase 1 — 28 Sep 2026.
 */

// Re-export de contraste para que los consumidores importen todo desde aquí.
export { validarContraste, contraste, luminancia } from './contraste.js';

// ─── CONSTANTES ────────────────────────────────────────────────────────────────

/**
 * La paleta canónica como canales RGB. Es el PISO del sistema:
 * si un tema no define un token, se usa este valor.
 * Fuente: PALETA_CANONICA en apps/api/superficie/registry.py.
 */
export const PALETA_CANONICA = {
  acento:           '193 215 46',   // #c1d72e — verde lima
  fondoProfundo:    '10 10 10',     // #0a0a0a — casi negro
  fondoProfundoAlt: '8 8 8',       // #080808 — negro
  fondoPanel:       '26 26 26',     // #1a1a1a — gris oscuro
  cremaTicket:      '253 251 247',  // #fdfbf7 — blanco cálido
  peligro:          '239 68 68',    // #ef4444 — rojo
};

/**
 * Mapa de nombres de variable CSS ↔ nombres de propiedad del tema.
 * Esto asegura que los nombres sean consistentes en todo el sistema.
 */
const MAPA_VARIABLES = {
  '--acento':            'acento',
  '--fondo-profundo':    'fondoProfundo',
  '--fondo-profundo-alt':'fondoProfundoAlt',
  '--fondo-panel':       'fondoPanel',
  '--crema-ticket':      'cremaTicket',
  '--peligro':           'peligro',
  // Extendidos (opcionales — solo los temas que los definen los aplican).
  '--madera':            'fondoMadera',
  '--madera-panel':      'fondoMaderaPanel',
  '--madera-veta':       'maderaVeta',
};

/**
 * Catálogo cerrado de tipografías permitidas.
 * Solo estas 5 son válidas como fuente de UI.
 * Fuente: PROPUESTA_BRANDING_TRANSVERSAL §4.3.
 */
export const CATALOGO_FUENTES = [
  { nombre: 'Inter',       familia: 'Inter, system-ui, sans-serif',       caracter: 'neutra' },
  { nombre: 'Roboto',      familia: 'Roboto, system-ui, sans-serif',      caracter: 'clasica' },
  { nombre: 'Montserrat',  familia: 'Montserrat, system-ui, sans-serif',  caracter: 'geometrica' },
  { nombre: 'Nunito',      familia: 'Nunito, system-ui, sans-serif',      caracter: 'redondeada' },
  { nombre: 'Poppins',     familia: 'Poppins, system-ui, sans-serif',     caracter: 'moderna' },
];

// ─── FUNCIÓN 1: aplicarTema ────────────────────────────────────────────────────

/**
 * Escribe los canales RGB de un tema como variables CSS en un contenedor.
 *
 * Se aplica al contenedor del módulo (no a :root) para evitar
 * contaminación cruzada entre módulos.
 *
 * @param {object} tema - Objeto con los 6 tokens en canales RGB.
 * @param {HTMLElement} [contenedor=document.documentElement] - Elemento donde
 *   se escriben las variables. Por defecto :root.
 *
 * @example
 *   aplicarTema({
 *     acento: '193 215 46',
 *     fondoProfundo: '10 10 10',
 *     fondoProfundoAlt: '8 8 8',
 *     fondoPanel: '26 26 26',
 *     cremaTicket: '253 251 247',
 *     peligro: '239 68 68',
 *   });
 */
export function aplicarTema(tema, contenedor = document.documentElement) {
  for (const [variable, propiedad] of Object.entries(MAPA_VARIABLES)) {
    const valor = tema[propiedad];
    if (valor != null) {
      contenedor.style.setProperty(variable, valor);
    }
  }
}

// ─── FUNCIÓN 2: resolverTema ───────────────────────────────────────────────────

/**
 * Decide qué tema se aplica al final, siguiendo el orden de las 3 capas:
 *
 *   1. Tema del módulo (o su default si no hay elección del usuario).
 *   2. Identidad del negocio encima (logo, colores, tipografía de Vista General).
 *   3. Paleta canónica como piso (lo que falte, se toma de aquí).
 *
 * @param {object} modulo - El contrato TEMA_DEL_MODULO del módulo.
 * @param {string|null} eleccionDelUsuario - Nombre del tema elegido (o null).
 * @param {object|null} identidad - Objeto de identidad del negocio (o null).
 * @returns {Promise<object>} El tema resuelto, listo para aplicarTema().
 */
export async function resolverTema(modulo, eleccionDelUsuario = null, identidad = null) {
  // CAPA 1: tema del módulo (o su default si no hay elección)
  const nombreTema = elegirTemaValido(modulo, eleccionDelUsuario);
  const cargarTema = modulo.temas[nombreTema];

  let tema;
  try {
    const loaded = await cargarTema();
    tema = loaded.default || loaded;
  } catch {
    // Si el tema elegido no carga, caer al default del módulo.
    const defaultLoader = modulo.temas[modulo.default];
    const defaultLoaded = await defaultLoader();
    tema = defaultLoaded.default || defaultLoaded;
  }

  // CAPA 2: identidad del negocio encima (si existe)
  const conIdentidad = identidad ? fusionarIdentidad(tema, identidad) : tema;

  // CAPA 3: canónica como piso (lo que falte)
  return fusionarCanonica(conIdentidad);
}

/**
 * Elige un tema válido del contrato del módulo.
 * Si la elección no es válida, devuelve el default.
 */
function elegirTemaValido(modulo, eleccion) {
  if (eleccion && modulo.permitidos.includes(eleccion)) {
    return eleccion;
  }
  return modulo.default;
}

/**
 * Fusiona la identidad del negocio sobre un tema.
 * La identidad sobreescribe solo los tokens que define.
 */
function fusionarIdentidad(tema, identidad) {
  return { ...tema, ...identidad };
}

/**
 * Fusiona la paleta canónica como piso: lo que el tema no defina,
 * se toma de la canónica.
 */
function fusionarCanonica(tema) {
  const resultado = { ...PALETA_CANONICA };
  for (const [clave, valor] of Object.entries(tema)) {
    if (valor != null && valor !== '') {
      resultado[clave] = valor;
    }
  }
  return resultado;
}

// ─── FUNCIÓN 3: normalizarACanalesRGB ──────────────────────────────────────────

/**
 * Convierte un color hex a canales RGB separados por espacio.
 * Acepta formatos #RGB, #RRGGBB y #RRGGBBAA.
 *
 * @param {string} hex - Color en formato hex (con o sin #).
 * @returns {string} Canales RGB, ej: "193 215 46".
 * @throws {Error} Si el hex no es válido.
 *
 * @example
 *   normalizarACanalesRGB('#c1d72e')  // → "193 215 46"
 *   normalizarACanalesRGB('#0a0a0a')  // → "10 10 10"
 *   normalizarACanalesRGB('ef4444')   // → "239 68 68"
 */
export function normalizarACanalesRGB(hex) {
  let limpio = hex.replace(/^#/, '');

  // Expandir formato corto #RGB → RRGGBB
  if (limpio.length === 3) {
    limpio = limpio[0] + limpio[0] + limpio[1] + limpio[1] + limpio[2] + limpio[2];
  }

  // Ignorar canal alfa si existe (#RRGGBBAA → RRGGBB)
  if (limpio.length === 8) {
    limpio = limpio.slice(0, 6);
  }

  if (limpio.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(limpio)) {
    throw new Error(`Hex inválido: "${hex}". Esperado: #RRGGBB, #RGB o RRGGBB.`);
  }

  const r = parseInt(limpio.slice(0, 2), 16);
  const g = parseInt(limpio.slice(2, 4), 16);
  const b = parseInt(limpio.slice(4, 6), 16);

  return `${r} ${g} ${b}`;
}

// ─── FUNCIÓN 4: mapearACatalogo ────────────────────────────────────────────────

/**
 * Mapea una fuente sugerida (por la IA o por el usuario) al catálogo cerrado.
 * La comparación es case-insensitive y busca coincidencia parcial.
 *
 * Si no hay coincidencia, devuelve la fuente por defecto (Inter).
 *
 * @param {string} sugerida - Nombre de la fuente sugerida.
 * @param {Array} [catalogo=CATALOGO_FUENTES] - El catálogo de fuentes.
 * @returns {{ nombre: string, familia: string, confianza: number }}
 *
 * @example
 *   mapearACatalogo('Montserrat')  // → { nombre: 'Montserrat', familia: '...', confianza: 100 }
 *   mapearACatalogo('montserr')    // → { nombre: 'Montserrat', familia: '...', confianza: 80 }
 *   mapearACatalogo('Comic Sans')  // → { nombre: 'Inter', familia: '...', confianza: 0 }
 */
export function mapearACatalogo(sugerida, catalogo = CATALOGO_FUENTES) {
  if (!sugerida || typeof sugerida !== 'string') {
    return { ...catalogo[0], confianza: 0 };
  }

  const normalizada = sugerida.toLowerCase().trim();

  // 1. Coincidencia exacta (case-insensitive)
  const exacta = catalogo.find(f => f.nombre.toLowerCase() === normalizada);
  if (exacta) {
    return { ...exacta, confianza: 100 };
  }

  // 2. Coincidencia parcial (la sugerida contiene el nombre o viceversa)
  const parcial = catalogo.find(
    f =>
      normalizada.includes(f.nombre.toLowerCase()) ||
      f.nombre.toLowerCase().includes(normalizada)
  );
  if (parcial) {
    return { ...parcial, confianza: 80 };
  }

  // 3. Coincidencia por carácter (sans-serif → Inter, mono → ticket)
  const porFamilia = catalogo.find(f =>
    f.familia.toLowerCase().includes(normalizada)
  );
  if (porFamilia) {
    return { ...porFamilia, confianza: 50 };
  }

  // 4. Sin coincidencia → default (Inter)
  return { ...catalogo[0], confianza: 0 };
}

// ─── FUNCIÓN 5: crearTemaDesdeTokens ───────────────────────────────────────────

/**
 * Construye un objeto tema desde un mapa de tokens.
 * Útil para crear temas desde la extracción de IA o desde la UI.
 *
 * Los tokens pueden venir en hex (#c1d72e) o en canales RGB (193 215 46).
 * Si vienen en hex, se convierten automáticamente.
 *
 * @param {object} tokens - Los 6 tokens.
 * @param {string} [nombre='Sin nombre'] - Nombre del tema.
 * @returns {object} Tema normalizado con canales RGB.
 */
export function crearTemaDesdeTokens(tokens, nombre = 'Sin nombre') {
  const normalizar = (valor) => {
    if (!valor) return null;
    // Si parece hex (#... o ... con a-f), convertir
    if (/^#?[0-9a-fA-F]{3,8}$/.test(valor.trim())) {
      return normalizarACanalesRGB(valor);
    }
    // Si ya son canales RGB (ej: "193 215 46"), dejar como está
    return valor.trim();
  };

  return {
    nombre,
    acento:           normalizar(tokens.acento) ?? PALETA_CANONICA.acento,
    fondoProfundo:    normalizar(tokens.fondoProfundo ?? tokens.fondo_profundo) ?? PALETA_CANONICA.fondoProfundo,
    fondoProfundoAlt: normalizar(tokens.fondoProfundoAlt ?? tokens.fondo_profundo_alt) ?? PALETA_CANONICA.fondoProfundoAlt,
    fondoPanel:       normalizar(tokens.fondoPanel ?? tokens.fondo_panel) ?? PALETA_CANONICA.fondoPanel,
    cremaTicket:      normalizar(tokens.cremaTicket ?? tokens.crema_ticket) ?? PALETA_CANONICA.cremaTicket,
    peligro:          normalizar(tokens.peligro) ?? PALETA_CANONICA.peligro,
  };
}
