/**
 * Tema default del módulo POS — apps/pos/src/theme/default.js
 *
 * FASE D — "R de Rico Classic"
 *
 * Réplica exacta de la estética del POS viejo de R de Rico:
 *
 * MUNDO OSCURO (pantalla principal, checkout, gestor de caja):
 *   - Fondo negro (#0d0d0d), paneles gris (#1a1a1a)
 *   - Acento verde lima (#c1d72e) — idéntico al viejo
 *   - Texto blanco/crema, peligro rojo
 *
 * MUNDO MADERA (secciones Grandeza, pizarrón, modales específicos):
 *   - fondoMadera (#DEB47C) — tono dominante de wood_bg.jpg
 *   - fondoMaderaPanel (#2d1e13) — encabezados madera oscura del header Grandeza
 *   - Los componentes que tenían wood_bg.jpg usan `bg-madera`
 *
 * El dueño aprueba (28 Sep 2026).
 */
export default {
  nombre: 'R de Rico Classic (default)',

  // ── LOS 6 TOKENS BASE (mundo oscuro) ──
  acento:           '193 215 46',   // #c1d72e — verde lima (IDÉNTICO al POS viejo)
  fondoProfundo:    '13 13 13',     // #0d0d0d — negro (como el POS viejo)
  fondoProfundoAlt: '8 8 8',        // #080808 — negro puro (scrollbar, bordes)
  fondoPanel:       '26 26 26',     // #1a1a1a — gris oscuro (paneles, tarjetas)
  cremaTicket:      '253 251 247',  // #fdfbf7 — blanco cálido (texto)
  peligro:          '239 68 68',    // #ef4444 — rojo (idéntico al viejo)

  // ── TOKENS EXTENDIDOS (mundo madera — secciones Grandeza/pizarrón) ──
  fondoMadera:      '222 180 124',  // #DEB47C — tono dominante de wood_bg.jpg
  fondoMaderaPanel: '45 30 19',     // #2d1e13 — encabezado madera oscura del header Grandeza
  maderaVeta:       '196 154 92',   // #C49A5C — veta del grano (bordes, separadores)
  // FD-02: naranja de encabezado (suíttulo, botón manager en TerminalSelector).
  acentoCalido:     '234 88 12',    // #ea580c — naranja cálido del mundo Grandeza

  // Los 3 radios (como el POS viejo: 50px modales, 25px botones).
  radioPequeno: '25px',
  radioMedio:   '35px',
  radioGrande:  '50px',

  // Las 2 tipografías.
  fuenteUI:     'Inter, system-ui, sans-serif',
  fuenteTicket: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

