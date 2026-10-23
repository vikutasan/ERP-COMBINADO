/**
 * App — Raíz del POS nuevo.
 *
 * Flujo de navegación:
 *   / → TerminalSelector → elegir terminal
 *   /pos → RetailVisionPOS (Fase 3)
 *
 * SIN LOGIN PROPIO: cuando el POS se integre al ERP, recibirá
 * currentUser como prop desde el App.jsx del ERP (que ya tiene login).
 * Mientras tanto, usamos un usuario demo hardcodeado.
 *
 * TODO(integración): reemplazar el usuario demo por prop del ERP.
 */

import React, { useState, Suspense, lazy, Component } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import TerminalSelector from './components/TerminalSelector.jsx';
import { useTheme } from './hooks/useTheme.js';

/** ErrorBoundary — captura errores de render para evitar pantalla totalmente en blanco. */
class POSErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', background: 'rgb(10 10 10)',
          color: 'rgb(253 251 247)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: '2rem', gap: '1rem',
        }}>
          <span style={{ fontSize: '3rem' }}>🚧</span>
          <h2 style={{ fontWeight: 900, fontSize: '1.5rem' }}>Error al cargar el POS</h2>
          <pre style={{
            background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '0.5rem',
            fontSize: '0.75rem', maxWidth: '600px', overflowX: 'auto', textAlign: 'left',
          }}>
            {this.state.error?.message}
            {'\n'}
            {this.state.error?.stack?.split('\n').slice(0, 6).join('\n')}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); this.props.onBack?.(); }}
            style={{
              padding: '0.5rem 1.5rem', background: 'rgb(193 215 46)', color: 'rgb(var(--fondo-profundo))',
              border: 'none', borderRadius: '0.5rem', fontWeight: 700, cursor: 'pointer',
            }}
          >
            ← Volver al selector
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const RetailVisionPOS = lazy(() => import('./RetailVisionPOS.jsx').catch(() => ({
  default: () => (
    // Fallback si el chunk de RetailVisionPOS no carga (red o build roto).
    // Usa clases Tailwind semánticas para que el tema afecte este estado.
    <div className="bg-fondo-profundo text-crema-ticket min-h-screen flex flex-col
                    items-center justify-center gap-4">
      <span style={{ fontSize: '4rem' }}>&#x1F6A7;</span>
      <h2 className="font-black text-2xl">POS en construcción</h2>
      <p className="opacity-50 text-sm">Fase 3</p>
    </div>
  ),
})));

// MS-01 — Pantalla de cocina (ruta /cocina).
const PantallaCocina = lazy(() => import('./components/PantallaCocina.jsx'));
// MS-02 — Pantalla de reparto (ruta /reparto).
const PantallaReparto = lazy(() => import('./components/PantallaReparto.jsx'));
// MS-03 — Dashboard central de sucursales (ruta /sucursales).
const DashboardSucursales = lazy(() => import('./components/DashboardSucursales.jsx'));

export default function App() {
  // F7.1 — cablea el motor de temas: resuelve y aplica el tema al montar.
  // El hook escribe las CSS vars en el contenedor raíz del POS (no en :root).
  useTheme();

  // TODO(integración): recibir como prop del ERP en vez de hardcodear.
  const [currentUser] = useState({
    id: 1,
    name: 'Victor',
    role: 'ADMIN',
    permissions: { access_any_terminal: 'full', access_terminal_manager: 'full' },
  });

  const [selectedTerminal, setSelectedTerminal] = useState(null);
  const navigate = useNavigate();

  function handleTerminalSelected(terminalId) {
    setSelectedTerminal(terminalId);
    navigate('/pos');
  }

  function handleBackToTerminals() {
    setSelectedTerminal(null);
    navigate('/');
  }

  return (
    <Suspense fallback={
      // Fallback de Suspense mientras carga el chunk.
      // Clases Tailwind semánticas: responde al tema sin hex hardcodeados.
      <div className="bg-fondo-profundo text-crema-ticket min-h-screen
                      flex items-center justify-center">
        <p className="opacity-40 font-bold uppercase tracking-widest text-xs">Cargando...</p>
      </div>
    }>
      <Routes>
        <Route path="/" element={
          <TerminalSelector
            currentUser={currentUser}
            onTerminalSelected={handleTerminalSelected}
          />
        } />
        <Route path="/pos" element={
          <POSErrorBoundary onBack={handleBackToTerminals}>
            {selectedTerminal
              ? <RetailVisionPOS
                  terminalId={selectedTerminal}
                  currentUser={currentUser}
                  onBackToTerminals={handleBackToTerminals}
                />
              : <TerminalSelector
                  currentUser={currentUser}
                  onTerminalSelected={handleTerminalSelected}
                />}
          </POSErrorBoundary>
        } />
          {/* MS-01 — Pantalla de cocina: ruta independiente, sin sesión de terminal. */}
          <Route
            path="/cocina"
            element={
              <PantallaCocina
                onVolver={() => navigate('/')}
              />
            }
          />
          {/* MS-02 — Pantalla de reparto: control de repartidores. */}
          <Route
            path="/reparto"
            element={
              <PantallaReparto
                onVolver={() => navigate('/')}
              />
            }
          />
          {/* MS-03 — Dashboard central de ventas por sucursal. */}
          <Route
            path="/sucursales"
            element={
              <DashboardSucursales
                onVolver={() => navigate('/')}
              />
            }
          />
      </Routes>
    </Suspense>
  );
}
