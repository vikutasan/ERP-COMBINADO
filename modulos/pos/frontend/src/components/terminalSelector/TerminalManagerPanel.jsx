/**
 * TerminalManagerPanel — FD-09: panel de gestión de terminales (admin).
 *
 * Extrae la rama `showManager === true` del monolito TerminalSelector.jsx.
 * Solo se monta cuando el usuario tiene permisos ADMIN y abre el gestor.
 *
 * Contiene:
 *   - Selector de orden de despliegue (F6.5)
 *   - Grid de tarjetas editables (nombre, icono, color post-it)
 *   - FASE 13.3 — Selector de color sin repeticiones
 *   - B-01 (F10.2) — Copiar URL de acceso directo (UX heredada §6.8)
 *   - Modal de confirmación de borrado
 *   - BUG-05 — toast local para feedback de "Guardar cambios"
 */

import { PALETA_POST_ITS, etiquetaDeColor } from '../../constants/paletaPostIts.js';
import { PRESET_ICONS, styles, getCardStyle, toastBg } from './terminalStyles.js';

/**
 * @param {{
 *   terminalesDesplegadas: Array,
 *   terminals: Array,
 *   ordenTerminales: string,
 *   invertirOrden: Function,
 *   editingId: string|null,
 *   editName: string,
 *   editIcon: string,
 *   editColor: string|null,
 *   setEditName: Function,
 *   setEditIcon: Function,
 *   setEditColor: Function,
 *   confirmDelete: string|null,
 *   setConfirmDelete: Function,
 *   toast: {msg:string,type:string}|null,
 *   onApplyEdit: Function,
 *   onCancelEdit: Function,
 *   onStartEdit: Function,
 *   onCopyUrl: Function,
 *   onRemove: Function,
 *   onAddTerminal: Function,
 *   onSave: Function,
 *   onClose: Function,
 * }} props
 */
export default function TerminalManagerPanel({
  terminalesDesplegadas, terminals, ordenTerminales, invertirOrden,
  editingId, editName, editIcon, editColor,
  setEditName, setEditIcon, setEditColor,
  confirmDelete, setConfirmDelete,
  toast,
  onApplyEdit, onCancelEdit, onStartEdit, onCopyUrl,
  onRemove, onAddTerminal, onSave, onClose,
}) {
  function colorEnUso(token, exceptoId) {
    return terminals.some(t => t.id !== exceptoId && t.color === token);
  }

  return (
    <div style={{ ...styles.page }}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <p style={styles.subtitle}>Administración</p>
        <h2 style={{ ...styles.title, fontSize: 'clamp(1.8rem, 4vw, 3rem)' }}>
          Gestor de <span style={styles.titleFaded}>Terminales</span>
        </h2>
      </div>

      {/* Selector de orden (F6.5) */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                    gap: '0.5rem', marginBottom: '1.5rem' }}>
        <span style={{ fontSize: '0.6rem', fontWeight: 900, textTransform: 'uppercase',
                       letterSpacing: '0.2em', opacity: 0.4, color: 'white' }}>
          Orden de terminales
        </span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            data-testid="orden-izq-der"
            onClick={() => { if (ordenTerminales !== 'izq-der') invertirOrden(); }}
            style={{
              background: ordenTerminales === 'izq-der' ? 'rgb(var(--acento-calido))' : 'rgba(255,255,255,0.05)',
              color: 'white', border: 'none', borderRadius: '1rem',
              padding: '0.5rem 1.25rem', fontWeight: 800, fontSize: '0.7rem',
              textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
              opacity: ordenTerminales === 'izq-der' ? 1 : 0.5,
            }}
          >
            ➡️ Izquierda a derecha
          </button>
          <button
            data-testid="orden-der-izq"
            onClick={() => { if (ordenTerminales !== 'der-izq') invertirOrden(); }}
            style={{
              background: ordenTerminales === 'der-izq' ? 'rgb(var(--acento-calido))' : 'rgba(255,255,255,0.05)',
              color: 'white', border: 'none', borderRadius: '1rem',
              padding: '0.5rem 1.25rem', fontWeight: 800, fontSize: '0.7rem',
              textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
              opacity: ordenTerminales === 'der-izq' ? 1 : 0.5,
            }}
          >
            ⬅️ Derecha a izquierda
          </button>
        </div>
      </div>

      {/* Grid de tarjetas editables */}
      <div style={styles.grid}>
        {terminalesDesplegadas.map(t => {
          const isEditing = editingId === t.id;
          return (
            <div key={t.id} style={{
              ...getCardStyle('free'),
              ...(isEditing ? { border: '2px solid rgb(var(--acento-calido))' } : {}),
            }}>
              <div style={{ width: 64, height: 64, display: 'flex', alignItems: 'center',
                            justifyContent: 'center', background: 'rgba(255,255,255,0.05)',
                            borderRadius: '1rem', fontSize: '2.5rem' }}>
                {isEditing ? (editIcon || '🖥️') : (t.icon || '🖥️')}
              </div>

              {isEditing ? (
                <>
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    style={{ width: '100%', background: 'rgba(0,0,0,0.4)',
                             border: '1px solid rgba(255,255,255,0.1)',
                             borderRadius: '0.75rem', padding: '0.5rem',
                             textAlign: 'center', color: 'white', fontSize: '0.8rem' }}
                  />
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                    {PRESET_ICONS.map(p => (
                      <button
                        key={p.value}
                        onClick={() => setEditIcon(p.value)}
                        style={{ fontSize: '1.5rem', padding: '0.25rem', borderRadius: '0.5rem',
                                 background: editIcon === p.value ? 'rgba(234,88,12,0.3)' : 'transparent',
                                 border: 'none', cursor: 'pointer',
                                 transform: editIcon === p.value ? 'scale(1.2)' : 'scale(1)' }}
                      >
                        {p.value}
                      </button>
                    ))}
                  </div>

                  {/* FASE 13.3 — Selector de color del post-it (sin repeticiones) */}
                  <div
                    data-testid={`paleta-color-${t.id}`}
                    style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}
                  >
                    <span style={{ fontSize: '0.55rem', fontWeight: 900, textTransform: 'uppercase',
                                   letterSpacing: '0.15em', opacity: 0.4, color: 'white', textAlign: 'center' }}>
                      Color del post-it
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', justifyContent: 'center' }}>
                      {/* Opción "sin color" */}
                      <button
                        type="button"
                        data-testid={`color-${t.id}-ninguno`}
                        title="Sin color (amarillo por defecto)"
                        onClick={() => setEditColor(null)}
                        style={{
                          width: 26, height: 26, borderRadius: '0.4rem',
                          border: editColor === null
                            ? '2px solid rgb(var(--acento-calido))'
                            : '1px solid rgba(255,255,255,0.2)',
                          background: 'rgba(255,255,255,0.05)', color: 'white',
                          fontSize: '0.6rem', cursor: 'pointer', lineHeight: 1,
                        }}
                      >
                        ∅
                      </button>
                      {PALETA_POST_ITS.map(token => {
                        const enUso = colorEnUso(token, t.id);
                        const seleccionado = editColor === token;
                        return (
                          <button
                            key={token}
                            type="button"
                            data-testid={`color-${t.id}-${token}`}
                            title={enUso ? `${etiquetaDeColor(token)} (en uso)` : etiquetaDeColor(token)}
                            disabled={enUso}
                            onClick={() => { if (!enUso) setEditColor(token); }}
                            style={{
                              width: 26, height: 26, borderRadius: '0.4rem',
                              border: seleccionado
                                ? '2px solid rgb(var(--acento-calido))'
                                : '1px solid rgba(255,255,255,0.2)',
                              cursor: enUso ? 'not-allowed' : 'pointer',
                              opacity: enUso ? 0.2 : 1,
                              transform: seleccionado ? 'scale(1.15)' : 'scale(1)',
                              padding: 0,
                            }}
                            className={token}
                          />
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                    <button
                      onClick={onApplyEdit}
                      style={{ flex: 1, background: 'rgb(var(--feedback-exito))', color: 'white',
                               border: 'none', borderRadius: '0.75rem', padding: '0.5rem',
                               fontWeight: 700, cursor: 'pointer' }}
                    >✓</button>
                    <button
                      onClick={onCancelEdit}
                      style={{ flex: 1, background: 'rgba(255,255,255,0.1)', color: 'white',
                               border: 'none', borderRadius: '0.75rem', padding: '0.5rem',
                               fontWeight: 700, cursor: 'pointer' }}
                    >✗</button>
                  </div>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'white' }}>{t.name}</span>
                  <span style={{ fontSize: '0.6rem', opacity: 0.3, fontFamily: 'monospace' }}>{t.id}</span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => onStartEdit(t)}
                      title="Editar"
                      style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.05)', color: 'white',
                               border: 'none', borderRadius: '0.75rem', padding: '0.4rem 0.75rem', cursor: 'pointer' }}
                    >✏️</button>
                    {/* B-01 (F10.2) — Copiar URL de acceso directo (UX heredada §6.8) */}
                    <button
                      onClick={() => onCopyUrl(t.id)}
                      data-testid={`copiar-url-${t.id}`}
                      title="Copiar URL"
                      style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.05)', color: 'white',
                               border: 'none', borderRadius: '0.75rem', padding: '0.4rem 0.75rem', cursor: 'pointer' }}
                    >📋</button>
                    <button
                      onClick={() => setConfirmDelete(t.id)}
                      title="Eliminar"
                      style={{ fontSize: '0.75rem', background: 'rgba(153,27,27,0.2)',
                               color: 'rgb(var(--feedback-error-text))',
                               border: 'none', borderRadius: '0.75rem', padding: '0.4rem 0.75rem', cursor: 'pointer' }}
                    >🗑️</button>
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Añadir terminal */}
        <button
          onClick={() => onAddTerminal('end')}
          style={{ ...getCardStyle('free'), border: '2px dashed rgba(255,255,255,0.1)', background: 'transparent' }}
        >
          <span style={{ fontSize: '2.5rem' }}>+</span>
          <span style={{ fontSize: '0.6rem', fontWeight: 900, textTransform: 'uppercase',
                         letterSpacing: '0.15em', opacity: 0.3 }}>Agregar</span>
        </button>
      </div>

      <div style={{ display: 'flex', gap: '1rem' }}>
        <button
          onClick={onSave}
          style={{ background: 'rgb(var(--feedback-exito))', color: 'white', border: 'none',
                   borderRadius: '1rem', padding: '0.75rem 2rem', fontWeight: 800,
                   fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' }}
        >
          💾 Guardar cambios
        </button>
        <button
          onClick={onClose}
          style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none',
                   borderRadius: '1rem', padding: '0.75rem 2rem', fontWeight: 800,
                   fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer' }}
        >
          ← Volver
        </button>
      </div>

      {/* Modal de confirmación de borrado */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: 'rgb(var(--feedback-neutro))', border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '1.5rem', padding: '2rem', maxWidth: '24rem', textAlign: 'center' }}>
            <p style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem', color: 'white' }}>
              ¿Eliminar {confirmDelete}?
            </p>
            <p style={{ opacity: 0.5, fontSize: '0.85rem', marginBottom: '1.5rem', color: 'white' }}>
              Esta acción no se puede deshacer.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => onRemove(confirmDelete)}
                style={{ flex: 1, background: 'rgb(var(--feedback-error))', color: 'white', border: 'none',
                         borderRadius: '1rem', padding: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
              >Eliminar</button>
              <button
                onClick={() => setConfirmDelete(null)}
                style={{ flex: 1, background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none',
                         borderRadius: '1rem', padding: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
              >Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* BUG-05 — toast local del gestor */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '2rem', left: '50%', transform: 'translateX(-50%)',
          padding: '0.75rem 1.5rem', borderRadius: '1rem', fontSize: '0.85rem', fontWeight: 700,
          zIndex: 50, color: 'white', background: toastBg(toast.type),
          boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
