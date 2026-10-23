/**
 * useTerminals — Hook de gestión de terminales.
 *
 * Responsabilidad: toda la lógica de negocio del selector de terminales.
 * - Polling del estado de terminales (cada 15s)
 * - Selección y lock de terminal
 * - Gestión (agregar, editar, eliminar, guardar)
 *
 * NO contiene JSX (eso va en el componente).
 * NO contiene fetch directo (eso va en el servicio).
 *
 * @see FICHA 12 de ESPECIFICACION_DE_INTERFACES_POS.md
 * @see resolveCardState en utils/terminalCardState.js
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  fetchTerminalStatuses,
  lockTerminal,
  unlockTerminal,
  fetchTerminalConfig,
  saveTerminalConfig,
  abrirSesionTerminal,
} from '../services/terminalService.js';
import { resolveCardState, resolveNetStatus } from '../utils/terminalCardState.js';

const POLL_INTERVAL_MS = 15_000;

/** Clave de `localStorage` donde se persiste la preferencia de orden visual. */
export const CLAVE_ORDEN_TERMINALES = 'pos.ordenTerminales';

/** Orden por defecto: de izquierda a derecha (el orden canónico del array). */
export const ORDEN_IZQ_DER = 'izq-der';

/** Orden invertido: de derecha a izquierda (solo afecta al despliegue visual). */
export const ORDEN_DER_IZQ = 'der-izq';

/**
 * Lee la preferencia de orden desde `localStorage`.
 * Devuelve `ORDEN_IZQ_DER` si el valor falta, es inválido o el acceso falla.
 */
export function leerOrdenGuardado() {
  try {
    const valor = localStorage.getItem(CLAVE_ORDEN_TERMINALES);
    return valor === ORDEN_DER_IZQ ? ORDEN_DER_IZQ : ORDEN_IZQ_DER;
  } catch {
    return ORDEN_IZQ_DER;
  }
}

// F7.7d — UNIFICACIÓN DE LOS DOS ESPACIOS DE ID.
//   El fallback del frontend debe hablar el MISMO vocabulario que el API y que
//   la semilla (`TERM-01..TERM-06`). Antes decía `T1..T6`, así que si el API no
//   respondía, el selector emitía un id que ninguna sesión/ticket reconocía.
const DEFAULT_TERMINALS = [
  { id: 'TERM-01', name: 'Terminal 1', icon: '🖥️' },
  { id: 'TERM-02', name: 'Terminal 2', icon: '🖥️' },
  { id: 'TERM-03', name: 'Terminal 3', icon: '🖥️' },
  { id: 'TERM-04', name: 'Terminal 4', icon: '🖥️' },
  { id: 'TERM-05', name: 'Terminal 5', icon: '🖥️' },
  { id: 'TERM-06', name: 'Terminal 6', icon: '🖥️' },
];

/**
 * @param {object} currentUser - { id, name, role, permissions }
 * @returns {object} Estado y acciones del selector de terminales
 */
export function useTerminals(currentUser) {
  const [terminals, setTerminals] = useState(DEFAULT_TERMINALS);
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [locking, setLocking] = useState(false);
  const [ordenTerminales, setOrdenTerminales] = useState(leerOrdenGuardado);
  const pollRef = useRef(null);

  // Orden de despliegue derivado. NUNCA muta `terminals`: trabaja sobre una copia.
  const terminalesDesplegadas = useMemo(
    () => (ordenTerminales === ORDEN_DER_IZQ ? [...terminals].reverse() : terminals),
    [terminals, ordenTerminales]
  );

  // Persistir la preferencia de orden (best effort: nunca rompe la UI).
  //
  // DEUDA-BUG08 Obs-1 (persistencia del orden): la preferencia se guarda en DOS
  // sitios. `localStorage` es la caché local (respuesta instantánea al montar,
  // antes de que el API conteste) y el backend (`terminal_config.json`) es la
  // fuente de verdad compartida entre navegadores/terminales. El backend manda:
  // al montar, si responde con un orden, éste sobreescribe la caché local.
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_ORDEN_TERMINALES, ordenTerminales);
    } catch {
      // Silencioso: si localStorage no está disponible, la preferencia es de sesión.
    }
  }, [ordenTerminales]);

  // Alternar el orden de despliegue (izq-der <-> der-izq) y persistirlo en el
  // backend para que sobreviva entre navegadores. El cambio local es inmediato
  // (optimista); si el guardado remoto falla, la UI ya refleja el nuevo orden y
  // la caché local lo conserva hasta la próxima sincronización.
  const invertirOrden = useCallback(() => {
    setOrdenTerminales(prev => {
      const nuevo = prev === ORDEN_IZQ_DER ? ORDEN_DER_IZQ : ORDEN_IZQ_DER;
      // Best effort: no se espera la respuesta ni se bloquea la UI.
      saveTerminalConfig(terminals, nuevo).catch(() => {});
      return nuevo;
    });
  }, [terminals]);

  // Cargar configuración y estado al montar
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const [config, statusMap] = await Promise.all([
          fetchTerminalConfig().catch(() => ({ terminals: DEFAULT_TERMINALS, orden: null })),
          fetchTerminalStatuses().catch(() => ({})),
        ]);
        if (cancelled) return;
        // El servicio normaliza AMBOS formatos (lista legada o `{terminals, orden}`)
        // a `{ terminals, orden }`. Se tolera también una lista cruda por si un
        // mock/consumidor antiguo la entrega directamente.
        const lista = Array.isArray(config) ? config : (config?.terminals ?? DEFAULT_TERMINALS);
        const orden = Array.isArray(config) ? null : (config?.orden ?? null);
        setTerminals(lista);
        // El backend es la fuente de verdad del orden: si responde con uno válido,
        // sobreescribe la caché local (que ya sirvió para el primer render).
        if (orden === ORDEN_DER_IZQ || orden === ORDEN_IZQ_DER) {
          setOrdenTerminales(orden);
        }
        setStatuses(statusMap);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // Polling del estado
  useEffect(() => {
    async function poll() {
      try {
        const statusMap = await fetchTerminalStatuses();
        setStatuses(statusMap);
      } catch {
        // Silencioso en polling: no bloquear la UI por un fallo de red
      }
    }

    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, []);

  // Resolver estado de una tarjeta
  const getCardState = useCallback(
    (terminalId) => resolveCardState(statuses[terminalId], currentUser?.id),
    [statuses, currentUser?.id]
  );

  // Resolver estado de red
  const getNetStatus = useCallback(
    (terminalId) => resolveNetStatus(statuses[terminalId]),
    [statuses]
  );

  // FIX "habilitar caja" (paridad con el viejo POS §6.8) — ¿la terminal tiene un
  // turno de caja ABIERTO? Es un estado INDEPENDIENTE del candado: una terminal
  // puede estar libre (sin candado) pero con la caja habilitada, o al revés. El
  // landing lo pinta como un badge aparte. El backend lo expone en
  // `/pos/terminals/status` como `caja_habilitada`.
  const getCajaHabilitada = useCallback(
    (terminalId) => Boolean(statuses[terminalId]?.caja_habilitada),
    [statuses]
  );

  // Seleccionar terminal (tomar lock + abrir la sesión de terminal)
  //
  // BUG-01 (paridad con el viejo POS): el viejo POS abre la `TerminalSession`
  // al seleccionar la terminal. El nuevo POS solo tomaba el candado, así que
  // cualquier terminal sin sesión previa fallaba con RN-24 al primer ticket
  // ("La sesión de la terminal no está activa"). Aquí, tras el lock, se abre
  // (o reutiliza) la sesión con un endpoint idempotente.
  const selectTerminal = useCallback(async (terminalId) => {
    if (!currentUser?.id) return { success: false, message: 'Sin usuario' };
    setLocking(true);
    try {
      const result = await lockTerminal(terminalId, currentUser.id);
      if (result.success) {
        // Abrir la sesión de terminal (idempotente). Si falla, NO se bloquea la
        // selección: el candado ya está tomado y el error se reporta aparte.
        try {
          await abrirSesionTerminal(terminalId);
        } catch (errSesion) {
          return { success: false, message: errSesion.message };
        }
        // Refresh statuses after lock
        const statusMap = await fetchTerminalStatuses().catch(() => statuses);
        setStatuses(statusMap);
      }
      return result;
    } catch (err) {
      return { success: false, message: err.message };
    } finally {
      setLocking(false);
    }
  }, [currentUser?.id, statuses]);

  // Liberar terminal
  const releaseTerminal = useCallback(async (terminalId) => {
    if (!currentUser?.id) return;
    try {
      await unlockTerminal(terminalId, currentUser.id);
      const statusMap = await fetchTerminalStatuses().catch(() => statuses);
      setStatuses(statusMap);
    } catch {
      // Best effort
    }
  }, [currentUser?.id, statuses]);

  // --- Gestión de terminales ---

  // BUG-05 — El id de una terminal nueva debe hablar el MISMO vocabulario que el
  //   API y la semilla (`TERM-0N`). Antes generaba `T1`, `T2`…, así que al
  //   guardar el gestor se persistían ids que ninguna sesión/ticket reconocía y
  //   `terminal_config.json` quedaba corrupto. Se calcula el siguiente número
  //   libre a partir de los ids `TERM-0N` existentes (ignorando cualquier id
  //   legado que no siga el patrón).
  const addTerminal = useCallback((position = 'end') => {
    setTerminals(prev => {
      const nums = prev
        .map(t => /^TERM-(\d+)$/.exec(t.id))
        .filter(Boolean)
        .map(m => parseInt(m[1], 10));
      const nextNum = (nums.length > 0 ? Math.max(...nums) : 0) + 1;
      const newT = {
        id: `TERM-${String(nextNum).padStart(2, '0')}`,
        name: `Terminal ${nextNum}`,
        icon: '🖥️',
      };
      return position === 'start' ? [newT, ...prev] : [...prev, newT];
    });
  }, []);

  const updateTerminal = useCallback((terminalId, updates) => {
    setTerminals(prev =>
      prev.map(t => t.id === terminalId ? { ...t, ...updates } : t)
    );
  }, []);

  const removeTerminal = useCallback((terminalId) => {
    const status = statuses[terminalId];
    if (status?.occupier_id) {
      return { success: false, reason: 'occupied', message: `Terminal ocupada por ${status.occupier_name}` };
    }
    setTerminals(prev => prev.filter(t => t.id !== terminalId));
    return { success: true };
  }, [statuses]);

  const saveConfig = useCallback(async () => {
    try {
      // Se persiste la lista de terminales JUNTO con la preferencia de orden
      // vigente, para que el gestor no pierda el orden al guardar cambios.
      const result = await saveTerminalConfig(terminals, ordenTerminales);
      return result;
    } catch (err) {
      return { success: false, message: err.message };
    }
  }, [terminals, ordenTerminales]);

  return {
    // Estado
    terminals,
    statuses,
    loading,
    error,
    locking,
    // Orden de despliegue (F6.5)
    ordenTerminales,
    terminalesDesplegadas,
    invertirOrden,
    // Resolución
    getCardState,
    getNetStatus,
    getCajaHabilitada,
    // Acciones de selección
    selectTerminal,
    releaseTerminal,
    // Acciones de gestión
    addTerminal,
    updateTerminal,
    removeTerminal,
    saveConfig,
  };
}
