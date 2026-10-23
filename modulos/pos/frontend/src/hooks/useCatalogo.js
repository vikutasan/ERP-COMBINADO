/**
 * useCatalogo — carga inicial del catálogo + sesión activa + política de pago.
 *
 * Extraído de `RetailVisionPOS.jsx` (FS2-03). Antes todo este bloque vivía
 * en un `useEffect` del componente orquestador, mezclando la lógica de red
 * con la lógica de presentación. El hook encapsula las 3 llamadas paralelas
 * y expone el estado resultante.
 *
 * Reglas respetadas:
 *   - Fail-safe en política de pago: si `order_min_payment_pct` no existe o
 *     no es numérico, se mantiene el default (100).
 *   - No lanza: los errores de red se traducen a `error` (string legible).
 *   - El hook se limpia correctamente con el flag `activo` para evitar
 *     actualizaciones de estado tras desmontarse (prohibición #4).
 *
 * @param {object} opciones
 * @param {string} opciones.canal - Canal del POS (CONFIG.CANAL).
 * @param {string} opciones.terminalId - ID de la terminal activa.
 * @returns {{ cargando, categorias, productos, sesion, politicaPagoPedido, error }}
 */

import { useState, useEffect } from 'react';
import { useApi } from '../context/ApiContext.jsx';
import { CONFIG } from '../../../shared/config.js';

export function useCatalogo({ canal = CONFIG.CANAL, terminalId } = {}) {
  const api = useApi();

  const [cargando, setCargando] = useState(true);
  const [categorias, setCategorias] = useState([]);
  const [productos, setProductos] = useState([]);
  const [sesion, setSesion] = useState(null);
  const [politicaPagoPedido, setPoliticaPagoPedido] = useState(100);
  const [error, setError] = useState(null);

  useEffect(() => {
    let activo = true;
    (async () => {
      setCargando(true);
      setError(null);
      try {
        const [catalogo, sesionActiva] = await Promise.all([
          api.getCatalogo(canal),
          api.getSesionActiva(terminalId),
        ]);
        if (!activo) return;
        setCategorias(catalogo.categorias || []);
        setProductos(catalogo.productos || []);
        setSesion(sesionActiva || null);

        // P5 — Leer política de pago de pedidos (fail-safe: default 100%).
        // FA-01: getSettingValue también viene del contexto, no directo de client.js
        const pctRaw = await api.getSettingValue('order_min_payment_pct');
        if (activo && pctRaw !== null) {
          const pct = Number(pctRaw);
          if (!isNaN(pct) && pct >= 0 && pct <= 100) {
            setPoliticaPagoPedido(pct);
          }
        }
      } catch (causa) {
        if (activo) setError(causa.message || 'Error al cargar el catálogo');
      } finally {
        if (activo) setCargando(false);
      }
    })();
    return () => { activo = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canal, terminalId]);

  return { cargando, categorias, productos, sesion, politicaPagoPedido, error };
}
