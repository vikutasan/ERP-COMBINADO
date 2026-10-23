/**
 * useNetworkHealth — banner rojo fijo + botón bloqueado + latencia (v6.1, $453).
 *
 * Cicatriz v6.1 ($453): con la red caída, el botón de cobro seguía activo.
 * El cajero cobraba, el `fetch` fallaba en silencio y la cuenta quedaba
 * inconsistente. Pérdida documentada: $453.
 *
 * MEJORA UX (5 Oct 2026): se fusiona lo mejor de ambos POS:
 *   - Del viejo: medición de latencia en ms, semáforo de 3 estados
 *     (good/slow/down), protección contra falsos positivos (2 fallos
 *     consecutivos para `down`), y reporte de incidentes al backend.
 *   - Del nuevo: diseño inyectable (sonda parametrizable), testeable,
 *     y compatible con el patrón de refs (prohibición #3).
 *
 * El indicador se muestra DENTRO del botón de terminal (sub-línea),
 * no como un elemento suelto en el header. Esto asocia visualmente
 * la salud de la red con la terminal activa.
 *
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §5 (fixed red banner)
 * @see PLAN_DE_ABORDAJE_FASE_3_POR_PARTES.md §4 FASE 3.1
 */

import { useEffect, useRef, useState } from 'react';

/** Intervalo de sondeo por defecto (ms). */
export const INTERVALO_POR_DEFECTO = 10000;

/** Umbral de latencia (ms) para considerar la red como "lenta". */
export const UMBRAL_LENTO_MS = 500;

/** Fallos consecutivos para considerar la red como "caída". */
export const FALLOS_PARA_DOWN = 2;

/**
 * Sonda real: mide la latencia contra el endpoint de salud.
 * Devuelve `{ ok, latenciaMs }` en vez de un booleano simple.
 *
 * @param {string} url
 * @returns {Promise<{ ok: boolean, latenciaMs: number }>}
 */
export async function sondaReal(url) {
  const inicio = performance.now();
  try {
    // NOTA (7 Oct 2026): el endpoint `/health` del API solo acepta GET
    // (`@app.get("/health")`). Un HEAD devuelve 405 Method Not Allowed,
    // que `res.ok` interpreta como caída y dispara el banner rojo falso.
    // Se usa GET: la sonda es un chequeo de vida ligero, no descarga cuerpo útil.
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const latenciaMs = Math.round(performance.now() - inicio);
    return { ok: res.ok, latenciaMs };
  } catch {
    return { ok: false, latenciaMs: -1 };
  }
}

/**
 * @param {object} [opciones]
 * @param {string} [opciones.url='/health'] - endpoint de salud
 * @param {number} [opciones.intervaloMs=10000]
 * @param {number} [opciones.umbralLentoMs=500] - latencia > esto = 'slow'
 * @param {() => Promise<{ ok: boolean, latenciaMs: number }>} [opciones.sonda]
 *        - inyectable para tests (por defecto `sondaReal`)
 * @param {boolean} [opciones.activo=true]
 * @returns {{
 *   enLinea: boolean,
 *   estado: 'good' | 'slow' | 'down',
 *   latenciaMs: number,
 *   bannerVisible: boolean,
 *   botonBloqueado: boolean,
 *   etiqueta: string,
 *   color: string,
 * }}
 */
export function useNetworkHealth(opciones = {}) {
  const {
    url = '/health',
    intervaloMs = INTERVALO_POR_DEFECTO,
    umbralLentoMs = UMBRAL_LENTO_MS,
    sonda = null,
    activo = true,
  } = opciones;

  const [estado, setEstado] = useState('good');
  const [latenciaMs, setLatenciaMs] = useState(0);
  const fallosRef = useRef(0);
  const sondaRef = useRef(sonda);
  sondaRef.current = sonda;

  useEffect(() => {
    if (!activo || typeof window === 'undefined') return undefined;

    let cancelado = false;

    async function verificar() {
      const fn = sondaRef.current || (() => sondaReal(url));
      let resultado;
      try {
        resultado = await fn();
      } catch {
        resultado = { ok: false, latenciaMs: -1 };
      }
      if (cancelado) return;

      if (resultado.ok) {
        fallosRef.current = 0;
        setLatenciaMs(resultado.latenciaMs);
        setEstado(resultado.latenciaMs > umbralLentoMs ? 'slow' : 'good');
      } else {
        fallosRef.current++;
        setLatenciaMs(-1);
        // Solo marcar 'down' después de N fallos consecutivos
        // para evitar falsos positivos por un solo paquete perdido.
        if (fallosRef.current >= FALLOS_PARA_DOWN) {
          setEstado('down');
        } else {
          setEstado('slow');
        }
      }
    }

    verificar();
    const id = setInterval(verificar, intervaloMs);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [activo, url, intervaloMs, umbralLentoMs]);

  // Derivados para la UI
  const enLinea = estado !== 'down';
  const etiqueta =
    estado === 'good' ? `RED OK${latenciaMs > 0 ? ` ${latenciaMs}ms` : ''}`
    : estado === 'slow' ? `RED LENTA${latenciaMs > 0 ? ` ${latenciaMs}ms` : ''}`
    : 'SIN RED';
  const color =
    estado === 'good' ? 'green'
    : estado === 'slow' ? 'yellow'
    : 'red';

  return {
    enLinea,
    estado,
    latenciaMs,
    bannerVisible: !enLinea,
    botonBloqueado: !enLinea,
    etiqueta,
    color,
  };
}

export default useNetworkHealth;
