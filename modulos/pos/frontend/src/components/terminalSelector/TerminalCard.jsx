/**
 * TerminalCard — FD-09: tarjeta individual de terminal en el selector.
 *
 * Renderiza una terminal con sus 3 estados (libre / mía / ocupada),
 * el indicador de red y el indicador de caja habilitada.
 *
 * FIX "habilitar caja" (paridad con el viejo POS §6.8): `cajaHabilitada`
 * es independiente del candado y se muestra aunque la terminal esté libre.
 */

import { getCardStyle, getBadge } from './terminalStyles.js';

/**
 * @param {{
 *   t: object,              — datos de la terminal
 *   state: 'free'|'mine'|'occupied',
 *   net: {color: string, label: string},
 *   badge: object|null,
 *   cajaHabilitada: boolean,
 *   locking: boolean,
 *   currentUser: object|null,
 *   info: object|null,      — statuses[t.id]
 *   onSelect: Function,
 * }} props
 */
export default function TerminalCard({
  t, state, net, badge, cajaHabilitada, locking, currentUser, info, onSelect,
}) {
  return (
    <button
      key={t.id}
      onClick={() => onSelect(t.id)}
      disabled={locking || state === 'occupied'}
      style={getCardStyle(state)}
    >
      {/* Badge — esquina superior derecha */}
      {badge && (
        <div style={{
          position: 'absolute', top: '0.75rem', right: '0.75rem',
          background: badge.bg, color: badge.color,
          fontSize: '0.55rem', fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: '0.08em', padding: '0.25rem 0.6rem',
          borderRadius: '0.5rem',
        }}>
          {badge.text}
        </div>
      )}

      {/* Icono — diferente por estado */}
      <div style={{ fontSize: '3.5rem', marginTop: badge ? '0.5rem' : 0 }}>
        {state === 'mine' ? '🔑' : state === 'occupied' ? '🔒' : (t.icon || '🖥️')}
      </div>

      {/* Info por estado */}
      {state === 'free' && (
        <>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'white' }}>{t.name}</span>
          <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase',
                         letterSpacing: '0.15em', opacity: 0.3, color: 'white' }}>
            Punto de Venta
          </span>
        </>
      )}

      {state === 'mine' && (
        <>
          <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase',
                         letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)' }}>
            Sesión Activa
          </span>
          <span style={{ fontSize: '1rem', fontWeight: 900, color: 'white' }}>
            {currentUser?.name || 'Usuario'}
          </span>
        </>
      )}

      {state === 'occupied' && (
        <>
          <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase',
                         letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)' }}>
            En uso por
          </span>
          <span style={{ fontSize: '0.95rem', fontWeight: 900, color: 'white' }}>
            {info?.occupier_name || 'Otro usuario'}
          </span>
        </>
      )}

      {/* Indicador de red */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: net.color }} />
        <span style={{ fontSize: '0.55rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)',
                       textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {net.label}
        </span>
      </div>

      {/* FIX "habilitar caja" — indicador de caja habilitada (paridad §6.8) */}
      {cajaHabilitada && (
        <div
          data-testid={`caja-habilitada-${t.id}`}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.35rem',
            marginTop: '0.35rem', padding: '0.2rem 0.6rem',
            background: 'rgba(22,163,74,0.15)',
            border: '1px solid rgba(22,163,74,0.5)',
            borderRadius: '0.5rem',
          }}
        >
          <span style={{ fontSize: '0.6rem', color: 'rgb(var(--estado-en-linea))' }}>●</span>
          <span style={{ fontSize: '0.55rem', fontWeight: 900, color: 'rgb(var(--estado-en-linea))',
                         textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Caja habilitada
          </span>
        </div>
      )}
    </button>
  );
}
