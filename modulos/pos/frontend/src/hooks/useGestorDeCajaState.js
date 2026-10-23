/**
 * useGestorDeCajaState — FD-06: estado puro del GestorDeCaja.
 *
 * Extrae TODOS los useState, useRef y el reset de estado (alNuevoTurno) del
 * monolito GestorDeCaja.jsx (1,548 líneas) a un hook dedicado.
 *
 * Reglas respetadas:
 *   - PROHIBICIÓN #3: los callbacks async del hook de lógica leerán del
 *     `valoresRef` que este hook expone, nunca de cierres sobre el estado.
 *   - F12.29 v6: `onCajaHabilitada` y `onCajaDeshabilitada` se almacenan en
 *     refs que se actualizan en cada render, pero NO aparecen en arreglos de
 *     dependencias de useEffect/useCallback (causa raíz del bug F12.29).
 *
 * @param {{ onCajaHabilitada?: Function, onCajaDeshabilitada?: Function }} props
 */

import { useCallback, useMemo, useRef, useState } from 'react';

/** Los 3 estados de la pantalla de caja. */
export const ESTADOS = Object.freeze({
  SIN_TURNO: 'sin_turno',
  ABIERTO:   'abierto',
  CIERRE:    'cierre',
});

export function useGestorDeCajaState({ onCajaHabilitada, onCajaDeshabilitada } = {}) {

  // ── Estado de la sesión de caja ─────────────────────────────────────────────
  const [estado, setEstado]         = useState(ESTADOS.SIN_TURNO);
  const [turno, setTurno]           = useState(null);
  const [resumen, setResumen]       = useState(null);
  const [movimientos, setMovimientos] = useState([]);
  const [error, setError]           = useState(null);
  const [ocupado, setOcupado]       = useState(false);

  // ── Contexto diario post-corte (FASE 10.4 — no crítico) ─────────────────────
  const [mostrarContexto, setMostrarContexto]       = useState(false);
  const [contextoRegistrado, setContextoRegistrado] = useState(false);

  // ── Formulario de apertura ──────────────────────────────────────────────────
  const [fondoInicial, setFondoInicial]         = useState('');
  // B2 — Confirmación de 2 pasos al abrir turno
  const [confirmandoFondo, setConfirmandoFondo] = useState(false);

  // ── Formulario de movimiento ────────────────────────────────────────────────
  // B1 — Default SALIDA: en una panadería las salidas son más frecuentes.
  const [tipoMov, setTipoMov]   = useState('SALIDA');
  const [montoMov, setMontoMov] = useState('');
  const [motivoMov, setMotivoMov] = useState('');

  // ── Formulario de cierre ────────────────────────────────────────────────────
  const [conteoEfectivo, setConteoEfectivo] = useState('');
  const [conteoCredito, setConteoCredito]   = useState('');
  const [conteoDebito, setConteoDebito]     = useState('');
  const [diferencia, setDiferencia]         = useState(null);
  // B3 — Confirmación de 2 pasos al cerrar turno (acción irreversible)
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);

  // ── Modal de eliminación de movimiento ─────────────────────────────────────
  // FIX-BUG17: guarda el movimiento pendiente de borrar (null = sin modal)
  const [movimientoAEliminar, setMovimientoAEliminar] = useState(null);

  // ── Máquina de foco del teclado táctil (FASE 10.6.1) ───────────────────────
  const [campoActivo, setCampoActivo] = useState(null);

  // ── Refs ────────────────────────────────────────────────────────────────────
  // PROHIBICIÓN #3 — los callbacks async leen del ref, no del closure de React.
  const valoresRef = useRef({});

  // F12.26 — ref del bloque "Imprimir corte" para el scroll automático
  const refImprimirCorte = useRef(null);

  // F12.29 v6 — "latest ref" para onCajaHabilitada / onCajaDeshabilitada.
  // Un re-render del padre NO re-ejecuta los useEffect que las consumen.
  const onCajaHabilitadaRef    = useRef(onCajaHabilitada);
  const onCajaDeshabilitadaRef = useRef(onCajaDeshabilitada);
  // Mantener los refs siempre frescos (antes de que cualquier callback los lea):
  onCajaHabilitadaRef.current    = onCajaHabilitada;
  onCajaDeshabilitadaRef.current = onCajaDeshabilitada;

  // Espejo de campos editables para PROHIBICIÓN #3 (se actualiza en cada render):
  valoresRef.current = {
    fondoInicial,
    montoMov,
    motivoMov,
    conteoEfectivo,
    conteoCredito,
    conteoDebito,
  };

  // ── B4: reset completo al iniciar nuevo turno ───────────────────────────────
  const alNuevoTurno = useCallback(() => {
    setEstado(ESTADOS.SIN_TURNO);
    setTurno(null);
    setResumen(null);
    setMovimientos([]);
    setFondoInicial('');
    setTipoMov('SALIDA');
    setMontoMov('');
    setMotivoMov('');
    setConteoEfectivo('');
    setConteoCredito('');
    setConteoDebito('');
    setDiferencia(null);
    setConfirmandoFondo(false);
    setConfirmandoCierre(false);
    setMostrarContexto(false);
    setContextoRegistrado(false);
    setError(null);
    setCampoActivo(null);
  }, []);

  // ── Descriptores de campos para el teclado táctil ──────────────────────────
  const CAMPOS = useMemo(
    () => ({
      fondoInicial:   { etiqueta: 'Fondo inicial',          set: setFondoInicial,   tipo: 'numerico'   },
      montoMov:       { etiqueta: 'Monto del movimiento',   set: setMontoMov,       tipo: 'numerico'   },
      motivoMov:      { etiqueta: 'Motivo del movimiento',  set: setMotivoMov,      tipo: 'alfabetico' },
      conteoEfectivo: { etiqueta: 'Efectivo contado',       set: setConteoEfectivo, tipo: 'numerico'   },
      conteoCredito:  { etiqueta: 'Crédito contado',        set: setConteoCredito,  tipo: 'numerico'   },
      conteoDebito:   { etiqueta: 'Débito contado',         set: setConteoDebito,   tipo: 'numerico'   },
    }),
    [],
  );

  // ── Orden de tabulación por estado (ENTER avanza al siguiente campo) ────────
  const ORDEN_POR_ESTADO = useMemo(
    () => ({
      [ESTADOS.SIN_TURNO]: ['fondoInicial'],
      [ESTADOS.ABIERTO]:   ['montoMov', 'motivoMov'],
      [ESTADOS.CIERRE]:    ['conteoEfectivo', 'conteoCredito', 'conteoDebito'],
    }),
    [],
  );

  return {
    // Estado de la sesión
    estado, setEstado,
    turno, setTurno,
    resumen, setResumen,
    movimientos, setMovimientos,
    error, setError,
    ocupado, setOcupado,
    // Contexto diario
    mostrarContexto, setMostrarContexto,
    contextoRegistrado, setContextoRegistrado,
    // Apertura
    fondoInicial, setFondoInicial,
    confirmandoFondo, setConfirmandoFondo,
    // Movimiento
    tipoMov, setTipoMov,
    montoMov, setMontoMov,
    motivoMov, setMotivoMov,
    // Cierre
    conteoEfectivo, setConteoEfectivo,
    conteoCredito, setConteoCredito,
    conteoDebito, setConteoDebito,
    diferencia, setDiferencia,
    confirmandoCierre, setConfirmandoCierre,
    // Eliminación de movimiento
    movimientoAEliminar, setMovimientoAEliminar,
    // Teclado táctil
    campoActivo, setCampoActivo,
    // Refs
    valoresRef,
    refImprimirCorte,
    onCajaHabilitadaRef,
    onCajaDeshabilitadaRef,
    // Constantes derivadas
    CAMPOS,
    ORDEN_POR_ESTADO,
    // Acciones de estado
    alNuevoTurno,
  };
}
