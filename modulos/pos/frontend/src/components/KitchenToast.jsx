/**
 * KitchenToast -- MS-01 Paso 5.
 *
 * Banner temporal que aparece en el POS cuando un pedido de cocina llega
 * al estado LISTO. Se muestra en la parte superior de la pantalla durante
 * 6 segundos y luego desaparece automaticamente.
 *
 * El componente es PURO: recibe la lista de toasts activos y un callback
 * para cerrarlos. El estado lo maneja el hook useKitchenNotifications
 * a traves de RetailVisionPOS.
 *
 * Props:
 *   toasts: Array<{ id: string, mensaje: string, timestamp: number }>
 *   onCerrar: (id: string) => void
 */

import { useEffect } from 'react';

const DURACION_MS = 6_000;

function ToastItem({ toast, onCerrar }) {
  useEffect(() => {
    const t = setTimeout(() => onCerrar(toast.id), DURACION_MS);
    return () => clearTimeout(t);
  }, [toast.id, onCerrar]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Pedido listo: ${toast.mensaje}`}
      data-testid="kitchen-toast"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        background: 'linear-gradient(135deg, #14532d 0%, #166534 100%)',
        border: '1px solid rgba(74,222,128,0.4)',
        borderRadius: '14px',
        padding: '10px 16px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        fontSize: '14px',
        color: '#dcfce7',
        fontWeight: 600,
        minWidth: '260px',
        maxWidth: '400px',
        pointerEvents: 'auto',
        animation: 'kitchenToastIn 0.3s ease',
      }}
    >
      <span style={{ fontSize: '20px' }} aria-hidden="true">🍽️</span>
      <div style={{ flex: 1, lineHeight: 1.3 }}>
        <div style={{ color: '#86efac', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Pedido LISTO
        </div>
        <div>{toast.mensaje}</div>
      </div>
      <button
        type="button"
        onClick={() => onCerrar(toast.id)}
        aria-label="Cerrar notificacion"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#86efac',
          fontSize: '18px',
          lineHeight: 1,
          padding: '2px 4px',
          borderRadius: '6px',
        }}
      >
        ×
      </button>
    </div>
  );
}

export function KitchenToast({ toasts = [], onCerrar }) {
  if (!toasts.length) return null;

  return (
    <>
      <style>{`
        @keyframes kitchenToastIn {
          from { opacity: 0; transform: translateY(-12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <div
        aria-label="Notificaciones de cocina"
        style={{
          position: 'fixed',
          top: '72px',
          right: '16px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onCerrar={onCerrar} />
        ))}
      </div>
    </>
  );
}
