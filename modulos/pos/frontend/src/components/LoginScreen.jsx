/**
 * LoginScreen — Pantalla de login por PIN.
 *
 * Portada del POS viejo: apps/auth/LoginUI.jsx
 * Estética: fondo madera oscurecido, logo, teclado numérico visual,
 * campo de PIN enmascarado, botón "ENTRAR AL SISTEMA".
 *
 * ⚠️ NOTA DE MIGRACIÓN:
 * Esta pantalla existe porque el POS nuevo corre como app SEPARADA
 * (puerto 5100) y no comparte el routing ni el bundle del ERP viejo.
 * El endpoint de autenticación ES EL MISMO del ERP: POST /security/employees/validate-pin.
 *
 * CUANDO el POS nuevo se integre como módulo del ERP:
 *   1. Eliminar este archivo (LoginScreen.jsx)
 *   2. Eliminar services/securityService.js
 *   3. Eliminar hooks/useAuth.js
 *   4. Usar el LoginUI.jsx compartido del ERP (apps/auth/LoginUI.jsx)
 *   5. Recibir currentUser como prop desde el App.jsx del ERP
 *
 * @see useAuth en hooks/useAuth.js
 * @see Fase 2 del PLAN_MAESTRO_DEFINITIVO_POS.md
 */

import React, { useState } from 'react';

const KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, '←'];

const s = {
  page: {
    minHeight: '100vh',
    background: 'rgb(var(--madera, 222 180 124))',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '1rem', position: 'relative',
  },
  overlay: {
    position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)',
  },
  container: {
    maxWidth: '420px', width: '100%', position: 'relative', zIndex: 10,
  },
  branding: {
    textAlign: 'center', marginBottom: '1.5rem',
  },
  brandTitle: {
    fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 900,
    textTransform: 'uppercase', fontStyle: 'italic', letterSpacing: '-0.03em',
    color: 'rgb(var(--acento-calido))', marginBottom: '0.25rem',
  },
  brandSub: {
    fontSize: '0.55rem', fontWeight: 800, color: 'rgba(255,255,255,0.3)',
    letterSpacing: '0.4em', textTransform: 'uppercase',
  },
  card: {
    background: 'rgba(17, 17, 17, 0.8)', border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '50px', padding: '2rem', position: 'relative', overflow: 'hidden',
    boxShadow: '0 25px 50px rgba(0,0,0,0.3)',
  },
  glow1: {
    position: 'absolute', top: '-80px', left: '-80px', width: '160px', height: '160px',
    background: 'rgba(234, 88, 12, 0.08)', borderRadius: '50%',
  },
  glow2: {
    position: 'absolute', bottom: '-80px', right: '-80px', width: '160px', height: '160px',
    background: 'rgba(193, 215, 46, 0.08)', borderRadius: '50%',
  },
  formTitle: {
    fontSize: '1rem', fontWeight: 900, textTransform: 'uppercase',
    letterSpacing: '-0.02em', fontStyle: 'italic', color: '#fff',
    textAlign: 'center', marginBottom: '0.25rem',
  },
  formSub: {
    fontSize: '0.55rem', fontWeight: 700, color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase', letterSpacing: '0.3em', textAlign: 'center',
    marginBottom: '1.5rem',
  },
  pinInput: {
    width: '100%', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '1.5rem', padding: '1rem', outline: 'none',
    fontWeight: 900, fontSize: '1.5rem', textAlign: 'center',
    letterSpacing: '0.8em', color: '#fff',
    boxSizing: 'border-box',
  },
  pinInputError: {
    borderColor: 'rgba(239, 68, 68, 0.5)',
  },
  errorMsg: {
    fontSize: '0.55rem', fontWeight: 900, color: 'rgb(var(--peligro))',
    textTransform: 'uppercase', textAlign: 'center', letterSpacing: '0.2em',
    marginTop: '0.5rem',
  },
  keypadGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.625rem',
    maxWidth: '260px', margin: '1.25rem auto 0',
  },
  submitBtn: {
    width: '100%', padding: '1rem', borderRadius: '1.5rem', border: 'none',
    fontWeight: 900, fontSize: '0.65rem', textTransform: 'uppercase',
    letterSpacing: '0.2em', cursor: 'pointer', marginTop: '1.25rem',
    transition: 'all 0.3s ease',
  },
  footer: {
    marginTop: '1.5rem', textAlign: 'center', fontSize: '0.5rem',
    fontWeight: 700, color: 'rgba(255,255,255,0.25)',
    textTransform: 'uppercase', letterSpacing: '0.3em',
  },
};

function getKeyStyle(val) {
  const base = {
    height: '48px', borderRadius: '1rem', display: 'flex',
    alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
    fontWeight: 900, cursor: 'pointer', border: 'none',
    transition: 'all 0.15s ease', userSelect: 'none',
  };
  if (val === 'C') return { ...base, background: 'rgba(239,68,68,0.1)', color: 'rgb(var(--peligro))' };
  if (val === '←') return { ...base, background: 'rgba(234,88,12,0.1)', color: 'rgb(var(--acento-calido))' };
  return { ...base, background: 'rgba(255,255,255,0.05)', color: '#fff' };
}

export default function LoginScreen({ onLogin, terminalId }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);

  function handleKeypad(val) {
    setError(null);
    const v = val.toString();
    if (v === 'C') { setPin(''); return; }
    if (v === '←') { setPin(p => p.slice(0, -1)); return; }
    if (pin.length < 8) setPin(p => p + v);
  }

  async function handleSubmit(e) {
    if (e) e.preventDefault();
    if (!pin) return;
    setError(null);
    setProcessing(true);
    try {
      await onLogin(pin);
    } catch {
      setError('Clave de acceso incorrecta');
      setPin('');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div style={s.page}>
      <div style={s.overlay} />
      <div style={s.container}>

        {/* Branding */}
        <div style={s.branding}>
          <h1 style={s.brandTitle}>R de Rico</h1>
          <p style={s.brandSub}>Evolutive Digital Ecosystem</p>
        </div>

        {/* Card */}
        <div style={s.card}>
          <div style={s.glow1} />
          <div style={s.glow2} />

          <form onSubmit={handleSubmit} style={{ position: 'relative', zIndex: 10 }}>
            <h2 style={s.formTitle}>Bienvenido</h2>
            <p style={s.formSub}>Ingrese su clave de acceso</p>

            {/* PIN input */}
            <input type="password" placeholder="••••••" value={pin}
                   onChange={e => setPin(e.target.value)}
                   style={{ ...s.pinInput, ...(error ? s.pinInputError : {}) }}
                   autoFocus />
            {error && <p style={s.errorMsg}>{error}</p>}

            {/* Numpad */}
            <div style={s.keypadGrid}>
              {KEYS.map(val => (
                <button key={val} type="button" onClick={() => handleKeypad(val)}
                        style={getKeyStyle(val)}>
                  {val}
                </button>
              ))}
            </div>

            {/* Submit */}
            <button type="submit" disabled={processing || !pin}
                    style={{
                      ...s.submitBtn,
                      background: processing ? '#1f2937' : 'rgb(var(--acento))',
                      color: processing ? '#6b7280' : 'rgb(var(--fondo-profundo))',
                    }}>
              {processing ? 'Validando...' : 'Entrar al Sistema'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div style={s.footer}>
          {terminalId ? `Terminal ${terminalId}` : 'Punto de Venta'}
        </div>
      </div>
    </div>
  );
}
