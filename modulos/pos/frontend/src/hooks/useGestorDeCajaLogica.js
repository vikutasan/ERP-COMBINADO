/**
 * useGestorDeCajaLogica — FD-06: lógica pura del GestorDeCaja.
 *
 * Extrae los callbacks de caja, el teclado táctil y los datos derivados
 * del monolito GestorDeCaja.jsx a un hook dedicado.
 *
 * Recibe el estado del `useGestorDeCajaState` y el servicio de caja;
 * devuelve los callbacks listos para el JSX.
 *
 * Reglas respetadas:
 *   - PROHIBICIÓN #3: los callbacks async leen de `valoresRef.current`,
 *     nunca de cierres sobre el estado de React.
 *   - F12.29 v6: los callbacks del padre se leen de los refs que expone
 *     `useGestorDeCajaState`; no aparecen en arreglos de dependencias.
 *   - Sin timers ni auto-guardado (prohibición #1).
 *   - Contrato `{outcome, reason}`: sin try/catch; se decide con `esOk()`.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { esOk } from '../utils/outcome.js';
import { imprimirCorte } from '../services/printService.js';
import { generarCorteHTML } from '../utils/ticketGenerator.js';
import { useBotonArmado } from './useBotonArmado.js';
import { ESTADOS } from './useGestorDeCajaState.js';

/** Traduce un `reason` del servicio a un mensaje humano. */
const MENSAJES = Object.freeze({
  sin_conexion:          'No hay conexión con el servidor de caja.',
  ya_hay_turno_abierto:  'Ya hay un turno de caja abierto en esta terminal.',
  turno_no_encontrado:   'El turno de caja ya no existe.',
  datos_invalidos:       'Los datos capturados no son válidos.',
  error_desconocido:     'Ocurrió un error inesperado.',
});

function mensajeDe(reason) {
  if (!reason) return MENSAJES.error_desconocido;
  return MENSAJES[reason] || reason;
}

/**
 * @param {object} st  — objeto devuelto por useGestorDeCajaState
 * @param {string} terminalId
 * @param {string} usuarioId
 * @param {string|null} usuarioNombre
 * @param {object} servicio   — cashService (inyectable en tests)
 * @param {object} servicioContexto — dailyContextService
 */
export function useGestorDeCajaLogica(st, { terminalId, usuarioId, usuarioNombre, servicio, servicioContexto }) {

  const armar = useBotonArmado();

  // ── Teclado táctil ──────────────────────────────────────────────────────────

  /**
   * Aplica una tecla al campo activo (modo numérico: dinero).
   * Un solo punto decimal, máximo dos decimales, sin ceros a la izquierda.
   */
  const aplicarTecla = useCallback((actual, tecla) => {
    const texto = String(actual ?? '');
    if (tecla === 'LIMPIAR') return '';
    if (tecla === '←') return texto.slice(0, -1);
    if (tecla === '.') {
      if (texto.includes('.')) return texto;
      return texto === '' ? '0.' : `${texto}.`;
    }
    const punto = texto.indexOf('.');
    if (punto >= 0 && texto.length - punto > 2) return texto;
    if (texto === '0') return tecla;
    return `${texto}${tecla}`;
  }, []);

  /** Aplica una tecla al campo activo (modo alfabético: texto libre). */
  const aplicarTeclaTexto = useCallback((actual, tecla) => {
    const texto = String(actual ?? '');
    if (tecla === 'LIMPIAR') return '';
    if (tecla === '←') return texto.slice(0, -1);
    return `${texto}${tecla}`;
  }, []);

  /** Maneja una tecla del teclado táctil (máquina de foco). */
  const alPulsarTecla = useCallback(
    (tecla) => {
      if (!st.campoActivo) return;
      const campo = st.CAMPOS[st.campoActivo];
      if (!campo) return;

      if (tecla === 'ENTER') {
        const orden = st.ORDEN_POR_ESTADO[st.estado] || [];
        const i = orden.indexOf(st.campoActivo);
        st.setCampoActivo(orden[i + 1] || null);
        return;
      }

      const actual = st.valoresRef.current[st.campoActivo];
      const aplicar = campo.tipo === 'alfabetico' ? aplicarTeclaTexto : aplicarTecla;
      campo.set(aplicar(actual, tecla));
    },
    [st.campoActivo, st.CAMPOS, st.ORDEN_POR_ESTADO, st.estado, st.setCampoActivo,
     st.valoresRef, aplicarTecla, aplicarTeclaTexto],
  );

  // ── Carga inicial del turno ─────────────────────────────────────────────────

  /**
   * Carga el turno activo al montar (una sola vez, sin timers).
   * F12.29 v6 — onCajaHabilitada se lee del REF, NO aparece en los deps.
   */
  useEffect(() => {
    let vigente = true;

    async function cargar() {
      const r = await servicio.obtenerTurnoActivo(terminalId);
      if (!vigente) return;
      if (!esOk(r)) {
        st.setError(mensajeDe(r.reason));
        return;
      }
      if (r.data && r.data.cash_session_id) {
        st.setTurno(r.data);
        st.setEstado(ESTADOS.ABIERTO);
        st.onCajaHabilitadaRef.current?.(r.data.cash_session_id);
      } else {
        st.setEstado(ESTADOS.SIN_TURNO);
      }
    }

    cargar();
    return () => { vigente = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onCajaHabilitada
  // se lee del ref (v6); incluirla aquí RE-EJECUTABA el efecto en cada
  // re-render del padre y RESETEABA el estado a ABIERTO (causa raíz F12.29).
  }, [servicio, terminalId]); // eslint-disable-line

  // ── Refresco del resumen ────────────────────────────────────────────────────

  const refrescarResumen = useCallback(async () => {
    if (!st.turno) return;
    const r = await servicio.obtenerResumen(st.turno.cash_session_id);
    if (esOk(r)) {
      st.setResumen(r.data);
      st.setMovimientos((r.data && r.data.movimientos) || []);
    } else {
      st.setError(mensajeDe(r.reason));
    }
  }, [servicio, st.turno, st.setResumen, st.setMovimientos, st.setError]);

  useEffect(() => {
    if (st.estado === ESTADOS.ABIERTO && st.turno) refrescarResumen();
  }, [st.estado, st.turno, refrescarResumen]);

  // ── Apertura de turno ───────────────────────────────────────────────────────

  /** B2 — Paso 1: valida el fondo y pide confirmación. */
  const alPedirConfirmacionFondo = useCallback(() => {
    const monto = Number(st.fondoInicial);
    if (Number.isNaN(monto) || monto < 0) {
      st.setError('Ingrese un monto válido para el fondo inicial.');
      return;
    }
    st.setError(null);
    st.setConfirmandoFondo(true);
  }, [st.fondoInicial, st.setError, st.setConfirmandoFondo]);

  /** B2 — Paso 2: abre el turno con el fondo confirmado (RN-49, RN-50). */
  const alAbrirTurno = useCallback(async () => {
    st.setConfirmandoFondo(false);
    st.setError(null);
    st.setOcupado(true);
    const r = await servicio.abrirTurno({
      terminal_id:    terminalId,
      usuario_id:     usuarioId,
      monto_inicial:  Number(st.valoresRef.current.fondoInicial) || 0,
      // FASE 10.5 — paridad de datos: el viejo POS persistía el nombre del cajero.
      usuario_nombre: usuarioNombre || undefined,
    });
    st.setOcupado(false);

    if (!esOk(r)) {
      // FIX "habilitar caja" — recuperación del 409 (RN-49).
      if (r.reason === 'ya_hay_turno_abierto') {
        const activo = await servicio.obtenerTurnoActivo(terminalId);
        if (esOk(activo) && activo.data && activo.data.cash_session_id) {
          st.setTurno(activo.data);
          st.setEstado(ESTADOS.ABIERTO);
          st.onCajaHabilitadaRef.current?.(activo.data.cash_session_id);
          return;
        }
      }
      st.setError(mensajeDe(r.reason));
      return;
    }
    st.setTurno(r.data);
    st.setEstado(ESTADOS.ABIERTO);
    st.onCajaHabilitadaRef.current?.(r.data.cash_session_id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ref pattern (v6).
  }, [servicio, terminalId, usuarioId, usuarioNombre,
      st.setConfirmandoFondo, st.setError, st.setOcupado,
      st.setTurno, st.setEstado, st.valoresRef, st.onCajaHabilitadaRef]);

  // ── Movimientos ─────────────────────────────────────────────────────────────

  /** Registra una entrada o salida de efectivo (RN-51, RN-55). */
  const alRegistrarMovimiento = useCallback(async () => {
    st.setError(null);
    st.setOcupado(true);
    const r = await servicio.registrarMovimiento({
      cash_session_id: st.turno.cash_session_id,
      tipo:   st.tipoMov,
      monto:  Number(st.valoresRef.current.montoMov) || 0,
      motivo: st.valoresRef.current.motivoMov,
    });
    st.setOcupado(false);

    if (!esOk(r)) {
      st.setError(mensajeDe(r.reason));
      return;
    }
    st.setMontoMov('');
    st.setMotivoMov('');
    await refrescarResumen();
  }, [servicio, st.turno, st.tipoMov, st.valoresRef,
      st.setError, st.setOcupado, st.setMontoMov, st.setMotivoMov, refrescarResumen]);

  /** Elimina un movimiento mal capturado (RN-52, FASE 10.6.2). */
  const alEliminarMovimiento = useCallback(async (movementId) => {
    st.setError(null);
    st.setOcupado(true);
    const r = await servicio.eliminarMovimiento(movementId);
    st.setOcupado(false);

    if (!esOk(r)) {
      st.setError(mensajeDe(r.reason));
      return;
    }
    await refrescarResumen();
  }, [servicio, st.setError, st.setOcupado, refrescarResumen]);

  /** FIX-BUG17 — Paso 1: pide confirmación antes de borrar. */
  const alPedirEliminarMovimiento = useCallback((movimiento) => {
    st.setError(null);
    st.setMovimientoAEliminar(movimiento);
  }, [st.setError, st.setMovimientoAEliminar]);

  /** FIX-BUG17 — Paso 2: confirma y borra el movimiento. */
  const alConfirmarEliminarMovimiento = useCallback(async () => {
    const pendiente = st.movimientoAEliminar;
    st.setMovimientoAEliminar(null);
    if (!pendiente?.movement_id) return;
    await alEliminarMovimiento(pendiente.movement_id);
  }, [st.movimientoAEliminar, st.setMovimientoAEliminar, alEliminarMovimiento]);

  // ── Cierre de turno ─────────────────────────────────────────────────────────

  /** B3 — Paso 1: pide confirmación antes de cerrar. */
  const alPedirConfirmacionCierre = useCallback(() => {
    st.setError(null);
    st.setConfirmandoCierre(true);
  }, [st.setError, st.setConfirmandoCierre]);

  /** B3 — Paso 2: cierra el turno con los conteos confirmados (RN-54, RN-55). */
  const alCerrarTurno = useCallback(async () => {
    st.setConfirmandoCierre(false);
    st.setError(null);
    st.setOcupado(true);
    const r = await servicio.cerrarTurno({
      cash_session_id: st.turno.cash_session_id,
      montos_fisicos:  Number(st.valoresRef.current.conteoEfectivo) || 0,
      credito:         Number(st.valoresRef.current.conteoCredito)  || 0,
      debito:          Number(st.valoresRef.current.conteoDebito)   || 0,
    });
    st.setOcupado(false);

    if (!esOk(r)) {
      st.setError(mensajeDe(r.reason));
      return;
    }
    st.setDiferencia(r.data);
    st.onCajaDeshabilitadaRef.current?.();
    // FASE 10.4 — el corte ya quedó cerrado; el contexto es NO crítico.
    st.setMostrarContexto(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ref pattern (v6).
  }, [servicio, st.turno, st.valoresRef,
      st.setConfirmandoCierre, st.setError, st.setOcupado,
      st.setDiferencia, st.setMostrarContexto, st.onCajaDeshabilitadaRef]);

  /** Cierra el modal de contexto diario (guardado u omitido). */
  const alCerrarContexto = useCallback((registrado = false) => {
    st.setMostrarContexto(false);
    if (registrado) st.setContextoRegistrado(true);
  }, [st.setMostrarContexto, st.setContextoRegistrado]);

  // ── F12.26 — Scroll automático al bloque "Imprimir corte" ──────────────────
  useEffect(() => {
    if (!st.diferencia) return;
    st.refImprimirCorte.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [st.diferencia, st.refImprimirCorte]);

  // ── Datos derivados ─────────────────────────────────────────────────────────

  const esperado = useMemo(() => Number(st.resumen?.esperado ?? 0), [st.resumen]);
  const capturado = Number(st.valoresRef.current?.conteoEfectivo) || 0;
  const descuadreEnVivo = capturado - esperado;

  // FASE 10.5 — desglose que el viejo POS mostraba al cajero.
  const desglose = useMemo(
    () => ({
      fondo_inicial:       Number(st.resumen?.fondo_inicial        ?? 0),
      total_entradas:      Number(st.resumen?.total_entradas       ?? 0),
      total_salidas:       Number(st.resumen?.total_salidas        ?? 0),
      total_credito:       Number(st.resumen?.total_credito        ?? 0),
      total_debito:        Number(st.resumen?.total_debito         ?? 0),
      total_transferencia: Number(st.resumen?.total_transferencia  ?? 0),
      total_ventas:        Number(st.resumen?.total_ventas         ?? 0),
      num_transacciones:   Number(st.resumen?.num_transacciones    ?? 0),
      ventas_propias:      Number(st.resumen?.ventas_propias       ?? 0),
      ventas_ajenas:       Number(st.resumen?.ventas_ajenas        ?? 0),
      num_transacciones_ajenas: Number(st.resumen?.num_transacciones_ajenas ?? 0),
    }),
    [st.resumen],
  );

  // FIX-BUG17 — Movimientos agrupados por tipo para el corte legible de un vistazo.
  const movimientosAgrupados = useMemo(() => {
    const entradas = [];
    const salidas  = [];
    st.movimientos.forEach((m, i) => {
      const item = { ...m, indiceGlobal: i };
      if (m.tipo === 'ENTRADA') entradas.push(item);
      else salidas.push(item);
    });
    return { entradas, salidas };
  }, [st.movimientos]);

  // FIX-BUG17 — Sugerencias de motivo filtradas por tipo activo.
  const sugerenciasMotivo = useMemo(() => {
    const conteo   = new Map();
    const ultimoUso = new Map();
    const delMismoTipo = st.movimientos.filter((m) => m.tipo === st.tipoMov);
    delMismoTipo.forEach((m, i) => {
      const motivo = String(m.motivo || '').trim();
      if (!motivo) return;
      const clave = motivo.toLowerCase();
      conteo.set(clave, (conteo.get(clave) || 0) + 1);
      ultimoUso.set(clave, i);
    });
    return [...conteo.entries()]
      .map(([clave, veces]) => ({
        motivo:   delMismoTipo.find((m) => String(m.motivo || '').trim().toLowerCase() === clave)?.motivo,
        veces,
        ultimoUso: ultimoUso.get(clave) ?? 0,
      }))
      .sort((a, b) => b.veces - a.veces || b.ultimoUso - a.ultimoUso)
      .slice(0, 6)
      .map((s) => s.motivo)
      .filter(Boolean);
  }, [st.movimientos, st.tipoMov]);

  // ── Impresión del corte (FASE 10.6.4) ──────────────────────────────────────

  const alImprimirCorte = useCallback(() => {
    const datos = {
      terminalId,
      cajero:       st.turno?.usuario_nombre || usuarioNombre || '—',
      abiertaEn:    st.turno?.abierta_en || null,
      cerradaEn:    new Date().toISOString(),
      esperado,
      contado:      Number(st.valoresRef.current.conteoEfectivo) || 0,
      credito:      Number(st.valoresRef.current.conteoCredito)  || 0,
      debito:       Number(st.valoresRef.current.conteoDebito)   || 0,
      creditoSistema:       desglose.total_credito,
      debitoSistema:        desglose.total_debito,
      transferenciaSistema: desglose.total_transferencia,
      fondoInicial:         desglose.fondo_inicial,
      totalEntradas:        desglose.total_entradas,
      totalSalidas:         desglose.total_salidas,
      totalVentas:          desglose.total_ventas,
      numTransacciones:     desglose.num_transacciones,
      movimientos:          st.movimientos,
      cuentasCobradas:      st.resumen?.tickets || [],
      ventasAjenas:         desglose.ventas_ajenas,
      numTransaccionesAjenas: desglose.num_transacciones_ajenas,
    };
    imprimirCorte(generarCorteHTML(datos));
  }, [terminalId, usuarioNombre, st.turno, st.movimientos, st.resumen,
      st.valoresRef, esperado, desglose]);

  return {
    // Teclado
    alPulsarTecla,
    armar,
    // Apertura
    alPedirConfirmacionFondo,
    alAbrirTurno,
    // Movimientos
    alRegistrarMovimiento,
    alPedirEliminarMovimiento,
    alConfirmarEliminarMovimiento,
    // Cierre
    alPedirConfirmacionCierre,
    alCerrarTurno,
    alCerrarContexto,
    // Datos derivados
    esperado,
    capturado,
    descuadreEnVivo,
    desglose,
    movimientosAgrupados,
    sugerenciasMotivo,
    // Impresión
    alImprimirCorte,
  };
}
