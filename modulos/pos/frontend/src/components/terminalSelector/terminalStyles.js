/**
 * terminalStyles.js — FD-09: constantes y helpers de estilo compartidos
 * por TerminalCard y TerminalManagerPanel.
 *
 * Extraídos del monolito TerminalSelector.jsx (líneas 20-138).
 */

export const PRESET_ICONS = [
  { label: 'Monitor',    value: '🖥️' },
  { label: 'Laptop',     value: '💻' },
  { label: 'Tablet',     value: '📱' },
  { label: 'Impresora',  value: '🖨️' },
  { label: 'Servidor',   value: '🖧'  },
  { label: 'Caja',       value: '💰' },
];

/* ─── Estilos inline (no dependen de Tailwind para funcionar) ─── */
export const styles = {
  page: {
    minHeight: '100vh',
    background: 'rgb(var(--madera, 222 180 124))',
    color: 'rgb(var(--crema-ticket, 253 251 247))',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    position: 'relative',
    transition: 'background 0.3s ease, color 0.3s ease',
  },
  subtitle: {
    color: 'rgb(var(--acento-calido))',
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: '0.5em',
    fontSize: '0.7rem',
    marginBottom: '0.5rem',
  },
  title: {
    fontSize: 'clamp(2rem, 5vw, 3.5rem)',
    fontWeight: 900,
    textTransform: 'uppercase',
    fontStyle: 'italic',
    letterSpacing: '-0.03em',
    color: 'white',
    marginBottom: '0.25rem',
    textShadow: '0 2px 10px rgba(0,0,0,0.2)',
  },
  titleFaded: {
    color: 'white',
    opacity: 1,
    textShadow: '0 2px 10px rgba(0,0,0,0.2)',
  },
  greeting: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: '0.875rem',
    marginBottom: '2.5rem',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '1.25rem',
    maxWidth: '1100px',
    width: '100%',
    marginBottom: '2rem',
  },
  managerBtn: {
    background: 'rgb(var(--acento-calido))',
    color: 'white',
    border: 'none',
    borderRadius: '1rem',
    padding: '0.75rem 1.5rem',
    fontWeight: 800,
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    cursor: 'pointer',
  },
};

/* ─── Estilos de tarjeta por estado ─── */
export function getCardStyle(state) {
  const base = {
    background: 'rgba(30, 30, 30, 0.85)',
    borderRadius: '35px',
    border: '2px solid transparent',
    padding: '1.5rem 1rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
    cursor: 'pointer',
    transition: 'all 0.4s ease',
    minHeight: '200px',
    justifyContent: 'center',
    position: 'relative',
  };
  if (state === 'free')
    return { ...base, border: '2px solid rgba(255,255,255,0.08)' };
  if (state === 'mine')
    return { ...base, border: '2px solid rgb(var(--acento-calido) / 0.5)', background: 'rgba(40, 30, 20, 0.9)' };
  // occupied
  return { ...base, border: '2px solid rgba(127, 29, 29, 0.5)', background: 'rgba(50, 20, 20, 0.85)', cursor: 'not-allowed', opacity: 0.85 };
}

export function getBadge(state) {
  if (state === 'free') return null;
  if (state === 'mine')
    return { text: 'TU SESIÓN', bg: 'rgb(var(--acento-calido))', color: 'white' };
  return { text: 'OCUPADA', bg: 'rgb(var(--feedback-error-bg))', color: 'rgb(var(--feedback-error-text))' };
}

/** Estilo del toast por tipo. */
export function toastBg(type) {
  if (type === 'error')   return 'rgb(var(--feedback-error))';
  if (type === 'success') return 'rgb(var(--feedback-exito))';
  return 'rgb(var(--feedback-neutro))';
}
