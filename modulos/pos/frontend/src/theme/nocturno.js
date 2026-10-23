/**
 * Tema "Nocturno" (Opción 2) del módulo POS — apps/pos/src/theme/nocturno.js
 *
 * Variante estética curada provista inicialmente por el autor del software (Slot 2).
 * El dueño del negocio puede conservarla o personalizarla mediante el Centro de IA.
 * Paleta azul profundo con acento ámbar cálido.
 */
export default {
  nombre: 'Nocturno',

  acento:           '240 165 0',    // #f0a500 — ámbar cálido
  fondoProfundo:    '13 27 42',     // #0d1b2a — azul noche
  fondoProfundoAlt: '27 42 58',     // #1b2a3a — azul panel
  fondoPanel:       '27 42 58',     // #1b2a3a — azul panel
  cremaTicket:      '242 246 250',  // #f2f6fa — blanco frío
  peligro:          '230 57 70',    // #e63946 — rojo coral
  // FD-02: en Nocturno el acento cálido es el mismo ámbar del acento principal.
  acentoCalido:     '240 165 0',    // #f0a500 — ámbar (coherente con la paleta nocturna)

  // ── TOKENS EXTENDIDOS (mundo madera adaptado a la noche) ──
  fondoMadera:      '13 27 42',     // #0d1b2a — azul noche para landing y pizarrón nocturno
  fondoMaderaPanel: '19 38 59',     // #13263b — azul noche panel
  maderaVeta:       '35 55 78',     // #23374e — azul medianoche veta

  radioPequeno: '35px',
  radioMedio:   '40px',
  radioGrande:  '50px',

  fuenteUI:     'Inter, system-ui, sans-serif',
  fuenteTicket: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};
