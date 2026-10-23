/**
 * TerminalSelector — Pantalla de selección de terminal.
 *
 * FICHA 12 de ESPECIFICACION_DE_INTERFACES_POS.md:
 * Landing page del POS. Estética igualada al POS viejo:
 *   - Fondo madera (--madera)
 *   - Tarjetas oscuras con esquinas redondeadas
 *   - 3 estados: libre (🖥️), mía (🔑 dorada), ocupada (🔒 roja)
 *
 * FD-09: orquestador puro. El estado y los handlers se mantienen aquí;
 * el JSX se delega a:
 *   - TerminalCard          — tarjeta individual con 3 estados
 *   - TerminalManagerPanel  — panel de administración completo
 *
 * @see useTerminals en hooks/useTerminals.js
 */

import { useState } from 'react';
import { useTerminals } from '../hooks/useTerminals.js';
import { useTheme } from '../hooks/useTheme.js';
import ThemeSelector from './ThemeSelector.jsx';
import TerminalCard from './terminalSelector/TerminalCard.jsx';
import TerminalManagerPanel from './terminalSelector/TerminalManagerPanel.jsx';
import { styles, getBadge, toastBg } from './terminalSelector/terminalStyles.js';

export default function TerminalSelector({ currentUser, onTerminalSelected }) {
  const {
    terminals, statuses, loading, locking,
    getCardState, getNetStatus, getCajaHabilitada, selectTerminal,
    addTerminal, updateTerminal, removeTerminal, saveConfig,
    ordenTerminales, terminalesDesplegadas, invertirOrden,
  } = useTerminals(currentUser);

  const [showManager,    setShowManager]    = useState(false);
  const [showTheme,      setShowTheme]      = useState(false);
  const [editingId,      setEditingId]      = useState(null);
  const [editName,       setEditName]       = useState('');
  const [editIcon,       setEditIcon]       = useState('');
  const [editColor,      setEditColor]      = useState(null);
  const [toast,          setToast]          = useState(null);
  const [confirmDelete,  setConfirmDelete]  = useState(null);

  const tema = useTheme();
  const canManage = currentUser?.role === 'ADMIN'
    || currentUser?.permissions?.access_terminal_manager === 'full';

  // ── Helpers ────────────────────────────────────────────────────────────────

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSelect(terminalId) {
    const state = getCardState(terminalId);
    if (state === 'occupied') { showToast('Terminal ocupada por otro usuario', 'error'); return; }
    if (state === 'mine')     { onTerminalSelected?.(terminalId); return; }
    const result = await selectTerminal(terminalId);
    if (result.success) {
      onTerminalSelected?.(terminalId);
    } else {
      showToast(result.message || 'No se pudo tomar la terminal', 'error');
    }
  }

  function startEdit(t) {
    setEditingId(t.id); setEditName(t.name); setEditIcon(t.icon); setEditColor(t.color ?? null);
  }
  function cancelEdit() {
    setEditingId(null); setEditName(''); setEditIcon(''); setEditColor(null);
  }
  function applyEdit() {
    updateTerminal(editingId, { name: editName, icon: editIcon, color: editColor });
    cancelEdit();
  }

  async function copyUrl(tid) {
    const url = `http://${window.location.hostname}:${window.location.port}/?terminal=${tid}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement('textarea');
        ta.value = url; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
      }
      showToast(`✅ URL copiada: ${url}`, 'success');
    } catch { showToast(`No se pudo copiar. URL: ${url}`, 'error'); }
  }

  function handleRemove(tid) {
    const result = removeTerminal(tid);
    if (!result.success) { showToast(result.message, 'error'); return; }
    setConfirmDelete(null);
  }

  // BUG-05 — propaga el mensaje real del backend (no el hardcodeado).
  async function handleSave() {
    const result = await saveConfig();
    if (result.success) {
      showToast('✅ Configuración guardada', 'success');
    } else {
      showToast(`❌ ${result.message || 'Error al guardar'}`, 'error');
    }
  }

  // ── Vistas ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ ...styles.page, justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🖥️</div>
          <p style={{ opacity: 0.4, fontWeight: 700, textTransform: 'uppercase',
                      letterSpacing: '0.3em', fontSize: '0.8rem', color: 'white' }}>
            Cargando terminales...
          </p>
        </div>
      </div>
    );
  }

  if (showManager) {
    return (
      <TerminalManagerPanel
        terminalesDesplegadas={terminalesDesplegadas}
        terminals={terminals}
        ordenTerminales={ordenTerminales}
        invertirOrden={invertirOrden}
        editingId={editingId}
        editName={editName}
        editIcon={editIcon}
        editColor={editColor}
        setEditName={setEditName}
        setEditIcon={setEditIcon}
        setEditColor={setEditColor}
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
        toast={toast}
        onApplyEdit={applyEdit}
        onCancelEdit={cancelEdit}
        onStartEdit={startEdit}
        onCopyUrl={copyUrl}
        onRemove={handleRemove}
        onAddTerminal={addTerminal}
        onSave={handleSave}
        onClose={() => setShowManager(false)}
      />
    );
  }

  /* ═══ SELECTOR PRINCIPAL — estética del POS viejo ═══ */
  return (
    <div style={styles.page}>
      {/* Rincón de configuración — top right */}
      <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem',
                    display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <button
          onClick={() => setShowTheme(prev => !prev)}
          style={{ background: 'rgba(30, 30, 30, 0.85)', color: 'white',
                   border: '2px solid rgba(255,255,255,0.1)', borderRadius: '1rem',
                   padding: '0.75rem 1.25rem', fontWeight: 800, fontSize: '0.75rem',
                   textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
                   display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.3s ease' }}
          title="Cambiar tema visual"
          aria-label="Cambiar tema"
        >
          🎨 Tema
        </button>
        {canManage && (
          <button onClick={() => setShowManager(true)} style={styles.managerBtn}>
            ⚙️ Gestor de Terminales
          </button>
        )}
      </div>

      {/* Overlay del selector de tema */}
      {showTheme && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 50,
                   display: 'flex', alignItems: 'center', justifyContent: 'center',
                   background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowTheme(false); }}
        >
          <div style={{ background: 'rgba(30, 30, 30, 0.95)', border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '1.5rem', padding: '1.5rem', maxWidth: '420px', width: '90%',
                        boxShadow: '0 25px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'white' }}>
                🎨 Tema Visual
              </span>
              <button
                type="button"
                onClick={() => setShowTheme(false)}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: '1.2rem', cursor: 'pointer', padding: '0.2rem' }}
                title="Cerrar"
              >
                ✕
              </button>
            </div>
            <ThemeSelector
              tema={tema.tema}
              temaActivo={tema.tema}
              temas={tema.temas}
              onCambiarTema={(id) => { tema.cambiarTema(id); setShowTheme(false); }}
              onCambiar={(id) => { tema.cambiarTema(id); setShowTheme(false); }}
              onCerrar={() => setShowTheme(false)}
            />
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <h1 style={styles.title}>
          Selecciona tu <span style={styles.titleFaded}>Terminal</span>
        </h1>
      </div>

      {/* Grid de terminales */}
      <div style={styles.grid}>
        {terminalesDesplegadas.map(t => (
          <TerminalCard
            key={t.id}
            t={t}
            state={getCardState(t.id)}
            net={getNetStatus(t.id)}
            badge={getBadge(getCardState(t.id))}
            cajaHabilitada={getCajaHabilitada(t.id)}
            locking={locking}
            currentUser={currentUser}
            info={statuses[t.id]}
            onSelect={handleSelect}
          />
        ))}
      </div>

      {/* Toast */}
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
