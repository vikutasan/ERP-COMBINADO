/**
 * tokensVigentes.js — FUENTE ÚNICA de los tokens de diseño que las compuertas
 * anclan. Cierra la Deuda 1 ("el trabajo estético vive fuera del ciclo de
 * compuertas").
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA QUE RESUELVE
 * ────────────────────────────────────────────────────────────────────────────
 * Las compuertas de UI (f5_3, f12_6) leían el FUENTE del componente y buscaban
 * un string de clase/color HARDCODEADO (p. ej. `border-madera-veta`). Cuando
 * Gemini restauró la estética del POS viejo (`e986c06`) y cambió los tokens a
 * `border-[#3d2b1f]` / `bg-black` / `#bc8a5f`, 5 compuertas se pusieron rojas
 * aunque el INVARIANTE (el tablero es un marco oscuro con corcho) seguía vivo.
 *
 * La compuerta medía el TOKEN, no la INTENCIÓN. Este archivo separa ambos:
 *
 *   - INVARIANTE: la intención de diseño que NO cambia con el rediseño
 *     (p. ej. "el tablero tiene un tope de alto acotado al viewport").
 *     Se prueba por COMPORTAMIENTO/ROL, no por clase.
 *
 *   - TOKEN: la clase/color concreto que materializa el invariante HOY.
 *     Cambia con el rediseño. Vive AQUÍ, en un solo lugar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CÓMO SE USA
 * ────────────────────────────────────────────────────────────────────────────
 * Las compuertas importan de aquí en vez de hardcodear el string:
 *
 *   import { TOKENS_PIZARRON } from '../theme/tokensVigentes.js';
 *   expect(lineaTablero).toContain(TOKENS_PIZARRON.tableroBorde);
 *
 * Cuando Gemini (o cualquiera) rediseña, **toca UN solo archivo** (este) y
 * todas las compuertas se re-anclan solas. Eso convierte "actualizar 5
 * compuertas a mano" en "actualizar 1 constante".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * REGLA DE ORO
 * ────────────────────────────────────────────────────────────────────────────
 * Si un rediseño cambia un token, se actualiza AQUÍ **en el mismo commit** que
 * el rediseño. Si el rediseño además rompe un INVARIANTE, la compuerta DEBE
 * fallar (eso es correcto: el invariante murió de verdad).
 *
 * Referencia: cierre de las 3 deudas estructurales (11 Oct 2026).
 */

/**
 * Tokens vigentes del Pizarrón de Cuentas Abiertas (OpenAccountsCorkboard).
 *
 * Restauración estética de Gemini (`e986c06`, 10 Oct 2026): el tablero pasó de
 * los tokens de madera (`bg-madera-panel border-madera-veta`) a un marco oscuro
 * tostado (`bg-black border-[#3d2b1f]`) con una textura de corcho superpuesta
 * (`#bc8a5f` con `opacity-80`).
 */
export const TOKENS_PIZARRON = Object.freeze({
  /** Clase del contenedor raíz (ancho fluido R-01). */
  raizAncho: 'max-w-[1100px]',

  /** Clase de borde del tablero (el marco de madera oscura). FD-02: token nameéd. */
  tableroBorde: 'border-madera-oscura',

  /** Clase de fondo del tablero (madera oscura tostada). */
  tableroFondo: 'bg-black',

  /** Clase del tope de alto del tablero (invariante BUG-10g). */
  tableroTopeAlto: 'max-h-[calc(100vh-2rem)]',

  /** Clase de proporción del tablero (paridad con el POS viejo). */
  tableroAspecto: 'aspect-[16/9]',

  /** Clase del wrapper con scroll (invariante BUG-10h). */
  wrapperScroll: 'overflow-y-scroll',

  /** Clase del scrollbar estilizado (invariante BUG-10h). */
  wrapperScrollbar: 'custom-scrollbar',

  /**
   * Color de la textura de corcho. OJO: jsdom normaliza el CSS var a rgb(...)
   * en el atributo `style`, así que las compuertas deben afirmar el RGB.
   * FD-02: se usa rgb(var(--corcho)) en vez del hex literal.
   */
  corchoHex: 'rgb(var(--corcho))',
  corchoRgb: 'rgb(188, 138, 95)',

  /** Nombre accesible del post-it (invariante de accesibilidad). */
  postItEtiqueta: 'Ver Cuenta',
});

/**
 * Tokens vigentes del ticket de venta (SalesReceipt).
 * Se declaran aquí para que futuras compuertas de UI tengan un ancla única.
 */
export const TOKENS_TICKET = Object.freeze({
  /** Clase del contenedor raíz (ancho fluido R-01). */
  raizAncho: 'max-w-[1100px]',
});

/**
 * Tokens vigentes del selector de color de post-it (TerminalSelector, F13.3).
 *
 * FD-02: el borde de selección pasó del hex literal `#ea580c` al token
 * `--acento-calido`. jsdom NO resuelve `rgb(var(--x))` a un RGB concreto en el
 * atributo `style`, así que la compuerta debe afirmar el token tal cual se
 * emite, no el RGB resuelto.
 */
export const TOKENS_TERMINAL = Object.freeze({
  /** Borde del color seleccionado (2px, token naranja). */
  colorSeleccionadoBorde: 'rgb(var(--acento-calido))',
});

/**
 * Todos los grupos de tokens, indexados por nombre. Útil para un guard que
 * verifique que cada token declarado sigue existiendo en el fuente.
 */
export const TOKENS_VIGENTES = Object.freeze({
  pizarron: TOKENS_PIZARRON,
  ticket: TOKENS_TICKET,
  terminal: TOKENS_TERMINAL,
});
