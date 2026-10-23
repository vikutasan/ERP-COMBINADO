/**
 * `KitchenScreen` — Pantalla de Cocina (MS-01).
 *
 * Muestra la cola de pedidos pendientes en tiempo real (polling 5s).
 * Los botones avanzan el estado: RECIBIDO → EN PREPARACIÓN → LISTO.
 *
 * Diseño táctil: botones grandes (min-h-tactil), tarjetas con código de color
 * por estado y por canal (PANADERIA, HELADERIA, REPARTO).
 *
 * @param {object} props
 * @param {string} [props.canal]          - Filtrar por canal (null = todos)
 * @param {Function} [props.onVolver]     - Callback al pulsar "← Volver"
 */

import { useMemo } from 'react';
import { useKitchenQueue } from '../hooks/useKitchenQueue.js';

// Colores semánticos por estado de cocina
const COLOR_ESTADO = {
  RECIBIDO: {
    fondo: 'rgba(234, 88, 12, 0.12)',
    borde: '#ea580c',
    badge: '#ea580c',
    texto: '#fff7ed',
    etiqueta: 'RECIBIDO',
  },
  EN_PREP: {
    fondo: 'rgba(234, 179, 8, 0.12)',
    borde: '#eab308',
    badge: '#eab308',
    texto: '#fefce8',
    etiqueta: 'EN PREPARACIÓN',
  },
  LISTO: {
    fondo: 'rgba(34, 197, 94, 0.12)',
    borde: '#22c55e',
    badge: '#22c55e',
    texto: '#f0fdf4',
    etiqueta: 'LISTO',
  },
};

// Colores por canal
const COLOR_CANAL = {
  PANADERIA: '#c8a46e',
  HELADERIA: '#67e8f9',
  REPARTO: '#a78bfa',
};

function BadgeEstado({ estado }) {
  const c = COLOR_ESTADO[estado] ?? COLOR_ESTADO.RECIBIDO;
  return (
    <span
      style={{
        background: c.badge,
        color: '#000',
        padding: '2px 10px',
        borderRadius: '999px',
        fontSize: '0.65rem',
        fontWeight: 800,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      {c.etiqueta}
    </span>
  );
}

function BadgeCanal({ canal }) {
  const color = COLOR_CANAL[canal] ?? '#94a3b8';
  return (
    <span
      style={{
        background: `${color}22`,
        color,
        border: `1px solid ${color}55`,
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '0.6rem',
        fontWeight: 700,
        letterSpacing: '0.06em',
      }}
    >
      {canal}
    </span>
  );
}

function TicketCard({ ticket, onAvanzar, cargandoId }) {
  const c = COLOR_ESTADO[ticket.kitchen_status] ?? COLOR_ESTADO.RECIBIDO;
  const esCargando = cargandoId === ticket.id;
  const siguienteEstado = ticket.kitchen_status === 'RECIBIDO' ? 'EN_PREP' : 'LISTO';
  const etiquetaBoton = ticket.kitchen_status === 'RECIBIDO' ? 'Iniciar prep.' : 'Marcar listo';
  const colorBoton = ticket.kitchen_status === 'RECIBIDO' ? '#eab308' : '#22c55e';

  // Tiempo en cola
  const minutosEnCola = useMemo(() => {
    const diff = Date.now() - new Date(ticket.created_at).getTime();
    return Math.floor(diff / 60000);
  }, [ticket.created_at]);

  return (
    <div
      style={{
        background: c.fondo,
        border: `2px solid ${c.borde}`,
        borderRadius: '12px',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        position: 'relative',
        transition: 'border-color 0.2s, background 0.2s',
      }}
    >
      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontWeight: 900, fontSize: '1.1rem', color: c.borde }}>
            {ticket.account_num}
          </span>
          <BadgeCanal canal={ticket.channel} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <BadgeEstado estado={ticket.kitchen_status} />
          <span style={{ fontSize: '0.65rem', opacity: 0.5, whiteSpace: 'nowrap' }}>
            {minutosEnCola === 0 ? 'Ahora' : `${minutosEnCola} min`}
          </span>
        </div>
      </div>

      {/* Cliente */}
      {ticket.customer_name && (
        <p style={{ fontSize: '0.8rem', color: c.texto, opacity: 0.75, margin: 0 }}>
          👤 {ticket.customer_name}
        </p>
      )}

      {/* Líneas */}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {(ticket.lineas ?? []).map((linea, i) => (
          <li
            key={i}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.9rem',
              color: c.texto,
              padding: '4px 8px',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: '6px',
            }}
          >
            <span>{linea.name}</span>
            <span style={{ fontWeight: 700, opacity: 0.85 }}>× {linea.quantity}</span>
          </li>
        ))}
      </ul>

      {/* Notas */}
      {ticket.notas && (
        <p style={{
          margin: 0, fontSize: '0.78rem', opacity: 0.65,
          background: 'rgba(255,255,255,0.06)',
          borderRadius: '6px', padding: '6px 10px',
          borderLeft: `3px solid ${c.borde}`,
          color: c.texto,
        }}>
          📝 {ticket.notas}
        </p>
      )}

      {/* Botón de avance */}
      <button
        id={`kitchen-avanzar-${ticket.id}`}
        disabled={esCargando}
        onClick={() => onAvanzar(ticket.id, siguienteEstado)}
        style={{
          background: esCargando ? 'rgba(255,255,255,0.1)' : colorBoton,
          color: esCargando ? 'rgba(255,255,255,0.4)' : '#000',
          border: 'none',
          borderRadius: '8px',
          padding: '10px 0',
          fontWeight: 800,
          fontSize: '0.85rem',
          cursor: esCargando ? 'wait' : 'pointer',
          transition: 'background 0.15s, transform 0.1s',
          minHeight: '44px',
          letterSpacing: '0.04em',
        }}
        onMouseDown={(e) => { if (!esCargando) e.currentTarget.style.transform = 'scale(0.97)'; }}
        onMouseUp={(e) => { e.currentTarget.style.transform = ''; }}
      >
        {esCargando ? '…' : etiquetaBoton}
      </button>
    </div>
  );
}

export default function KitchenScreen({ canal = null, onVolver }) {
  const { tickets, total, cargando, error, actualizando, avanzarEstado, refrescar } =
    useKitchenQueue({ canal, intervalo: 5000 });

  // Separar por estado para mostrar columnas EN_PREP primero, luego RECIBIDO.
  const enPrep = tickets.filter((t) => t.kitchen_status === 'EN_PREP');
  const recibidos = tickets.filter((t) => t.kitchen_status === 'RECIBIDO');

  return (
    <div
      id="kitchen-screen"
      style={{
        minHeight: '100vh',
        background: 'rgb(8 8 8)',
        color: '#f8f5f0',
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <header style={{
        padding: '0.75rem 1.25rem',
        background: 'rgba(255,255,255,0.04)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.4rem' }}>🍳</span>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 900, letterSpacing: '-0.02em' }}>
              Pantalla de Cocina
            </h1>
            {canal && (
              <p style={{ margin: 0, fontSize: '0.7rem', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Canal: {canal}
              </p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Contador */}
          <div style={{
            background: total > 0 ? 'rgba(234, 88, 12, 0.2)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${total > 0 ? '#ea580c' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: '999px',
            padding: '4px 14px',
            fontSize: '0.8rem',
            fontWeight: 700,
            color: total > 0 ? '#ea580c' : 'rgba(255,255,255,0.5)',
          }}>
            {cargando && total === 0 ? '…' : `${total} pendiente${total !== 1 ? 's' : ''}`}
          </div>

          {/* Refresco manual */}
          <button
            id="kitchen-refrescar"
            onClick={refrescar}
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.7)',
              borderRadius: '8px',
              padding: '6px 12px',
              fontSize: '0.78rem',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            title="Refrescar ahora"
          >
            ↺ Actualizar
          </button>

          {/* Volver */}
          {onVolver && (
            <button
              id="kitchen-volver"
              onClick={onVolver}
              style={{
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.15)',
                color: 'rgba(255,255,255,0.6)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '0.78rem',
                cursor: 'pointer',
              }}
            >
              ← Volver
            </button>
          )}
        </div>
      </header>

      {/* Error de red */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.15)',
          borderBottom: '1px solid rgba(239,68,68,0.3)',
          color: '#fca5a5',
          padding: '8px 20px',
          fontSize: '0.8rem',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          ⚠️ Sin conexión con el servidor — los datos pueden estar desactualizados. ({error})
        </div>
      )}

      {/* Cuerpo */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
        {cargando && total === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: '4rem', opacity: 0.35 }}>
            <p style={{ fontSize: '2rem', margin: 0 }}>⏳</p>
            <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>Cargando cola…</p>
          </div>
        ) : total === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: '5rem', opacity: 0.3 }}>
            <p style={{ fontSize: '3rem', margin: 0 }}>✅</p>
            <p style={{ fontSize: '1rem', marginTop: '0.75rem', fontWeight: 700 }}>Sin pedidos pendientes</p>
            <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>La cola está vacía — actualizando cada 5s</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {/* EN_PREP primero (ya empezados — más urgentes) */}
            {enPrep.map((t) => (
              <TicketCard
                key={t.id}
                ticket={t}
                onAvanzar={avanzarEstado}
                cargandoId={actualizando}
              />
            ))}
            {/* RECIBIDO después */}
            {recibidos.map((t) => (
              <TicketCard
                key={t.id}
                ticket={t}
                onAvanzar={avanzarEstado}
                cargandoId={actualizando}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer: indicador de polling */}
      <footer style={{
        padding: '6px 20px',
        background: 'rgba(255,255,255,0.03)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        justifyContent: 'flex-end',
        fontSize: '0.65rem',
        opacity: 0.35,
        letterSpacing: '0.04em',
      }}>
        Actualizando cada 5s · {new Date().toLocaleTimeString('es-MX')}
      </footer>
    </div>
  );
}
