/**
 * Tema "Minimal" (Opción 3 inicial) del módulo POS — apps/pos/src/theme/minimal.js
 *
 * Propuesta alternativa curada (Slot 3) con grises neutros y radios compactos (12px).
 * Representa el lienzo personalizable que el negocio puede reemplazar con estéticas
 * extraídas mediante la herramienta de IA (desde capturas de Pinterest/Dribbble).
 */
export default {
  nombre: 'Minimal',

  acento:           '163 198 20',   // #a3c614 — lima cítrica
  fondoProfundo:    '17 17 17',     // #111111 — negro neutro
  fondoProfundoAlt: '28 28 28',     // #1c1c1c — gris oscuro
  fondoPanel:       '28 28 28',     // #1c1c1c — gris oscuro
  cremaTicket:      '250 250 250',  // #fafafa — blanco puro
  peligro:          '214 69 69',    // #d64545 — rojo tomate
  // FD-02: naranja suave para el mundo madera en el tema Minimal.
  acentoCalido:     '217 119 6',    // #d97706 — ámbar-naranja (menos saturado que el default)

  // ── TOKENS EXTENDIDOS (mundo madera adaptado a grafito industrial) ──
  fondoMadera:      '24 24 27',     // #18181b — zinc 900 grafito para landing y pizarrón
  fondoMaderaPanel: '39 39 42',     // #27272a — zinc 800 panel
  maderaVeta:       '63 63 70',     // #3f3f46 — zinc 700 separador

  radioPequeno: '12px',
  radioMedio:   '16px',
  radioGrande:  '20px',

  fuenteUI:     'Inter, system-ui, sans-serif',
  fuenteTicket: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};
