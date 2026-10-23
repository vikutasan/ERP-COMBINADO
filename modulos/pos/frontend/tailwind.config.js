/**
 * Tailwind del POS nuevo — P2.1 / P2.6 / Fase 0.
 *
 * La paleta canónica viene de `PALETA_CANONICA` en
 * `apps/api/superficie/registry.py` (Documento 7 §2.1). Aquí se materializa como
 * tokens de Tailwind para que las interfaces la usen por nombre y no por hex
 * suelto. Los radios canónicos (Documento 7 §2.3) también se declaran.
 *
 * FASE 0 (28 Sep 2026): los tokens de color ahora apuntan a variables CSS
 * (`var(--x)`) en vez de hex compilado. Esto permite cambiar el tema en
 * runtime sin recompilar. Los valores se declaran como canales RGB en
 * `index.css` (:root). Las opacidades de Tailwind (`bg-acento/40`,
 * `text-crema-ticket/50`) siguen funcionando gracias al patrón
 * `rgb(var(--x) / <alpha-value>)`.
 *
 * Los 3 modos (R-03) son explícitos: MÓVIL es la base, `md:` es COMPACTO
 * (768–1023px) y `lg:` es MOSTRADOR (≥1024px). No se inventan breakpoints.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta canónica (PALETA_CANONICA).
        // Fase 0: tokens → var(--x) para theming en runtime.
        // Los valores de cada variable se declaran en index.css como canales RGB.
        acento:              'rgb(var(--acento) / <alpha-value>)',
        'fondo-profundo':    'rgb(var(--fondo-profundo) / <alpha-value>)',
        'fondo-profundo-alt':'rgb(var(--fondo-profundo-alt) / <alpha-value>)',
        'fondo-panel':       'rgb(var(--fondo-panel) / <alpha-value>)',
        'crema-ticket':      'rgb(var(--crema-ticket) / <alpha-value>)',
        peligro:             'rgb(var(--peligro) / <alpha-value>)',

        // Tokens extendidos — mundo madera (secciones Grandeza/pizarrón del POS viejo).
        madera:              'rgb(var(--madera) / <alpha-value>)',
        'madera-panel':      'rgb(var(--madera-panel) / <alpha-value>)',
        'madera-veta':       'rgb(var(--madera-veta) / <alpha-value>)',

        // FD-02: naranja del encabezado Grandeza (unifica #FF8C00 y #ea580c).
        'acento-calido':       'rgb(var(--acento-calido) / <alpha-value>)',

        // FD-02: mundo madera oscura (antes bg-[#3d2b1f], bg-[#2d1e13], etc.).
        'madera-oscura':       'rgb(var(--madera-oscura) / <alpha-value>)',
        'madera-oscura-panel': 'rgb(var(--madera-oscura-panel) / <alpha-value>)',
        'madera-oscura-text':  'rgb(var(--madera-oscura-text) / <alpha-value>)',
        corcho:                'rgb(var(--corcho) / <alpha-value>)',

        // FD-02: estados de red de terminal (antes hex en terminalCardState.js).
        'estado-disponible':   'rgb(var(--estado-disponible) / <alpha-value>)',
        'estado-en-linea':     'rgb(var(--estado-en-linea) / <alpha-value>)',
        'estado-inactiva':     'rgb(var(--estado-inactiva) / <alpha-value>)',
        'estado-expirada':     'rgb(var(--estado-expirada) / <alpha-value>)',

        // FD-02: feedback / toasts (antes hex en TerminalSelector.jsx).
        'feedback-exito':      'rgb(var(--feedback-exito) / <alpha-value>)',
        'feedback-error':      'rgb(var(--feedback-error) / <alpha-value>)',
        'feedback-neutro':     'rgb(var(--feedback-neutro) / <alpha-value>)',
        'feedback-error-bg':   'rgb(var(--feedback-error-bg) / <alpha-value>)',
        'feedback-error-text': 'rgb(var(--feedback-error-text) / <alpha-value>)',
      },
      borderRadius: {
        // Radios canónicos (RADIOS_CANONICOS).
        canon35: '35px',
        canon40: '40px',
        canon50: '50px',
      },
      fontFamily: {
        // Tipografía que escala (R-02): se usan tamaños relativos, no px fijos.
        pos: ['Inter', 'system-ui', 'sans-serif'],
        ticket: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      minHeight: {
        // R-04: target táctil mínimo de 44×44px.
        tactil: '44px',
      },
      minWidth: {
        tactil: '44px',
      },
    },
  },
  plugins: [],
};
