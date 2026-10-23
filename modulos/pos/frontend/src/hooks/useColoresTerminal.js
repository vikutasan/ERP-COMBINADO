/**
 * useColoresTerminal — carga y construye el mapa de colores por terminal.
 *
 * Extraído de `RetailVisionPOS.jsx` (FS2-03). Consume el contrato
 * `/pos/terminals/config` y construye el mapa `{ [terminal_id]: token }`
 * que el pizarrón de cuentas abiertas usa para pintar cada post-it.
 *
 * Fallo silencioso: si el API no responde, el pizarrón usa el color por
 * defecto (`COLOR_SIN_ASIGNAR` = amarillo). Esta decisión es intencional:
 * el color de post-it es presentacional, no funcional.
 *
 * FIX \"los post-its salen amarillos\" (10 Oct 2026): `fetchTerminalConfig`
 * devuelve `{ terminals, orden }` (no una lista suelta). La lectura se
 * centraliza en `construirColoresPorTerminal`, que tolera ambos formatos.
 *
 * @returns {{ coloresPorTerminal: Record<string, string> }}
 */

import { useState, useEffect } from 'react';
import {
  fetchTerminalConfig,
  construirColoresPorTerminal,
} from '../services/terminalService.js';

export function useColoresTerminal() {
  const [coloresPorTerminal, setColoresPorTerminal] = useState({});

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const config = await fetchTerminalConfig();
        if (!activo) return;
        // FIX \"los post-its salen amarillos\" (10 Oct 2026): `fetchTerminalConfig`
        // devuelve `{ terminals, orden }` (no una lista suelta). Antes se iteraba
        // el objeto con `for...of`, lo que lanzaba `TypeError` y el `catch` lo
        // silenciaba: el mapa quedaba vacío y TODOS los post-its caían al
        // amarillo por defecto. La lectura se centraliza en
        // `construirColoresPorTerminal`, que tolera ambos formatos.
        setColoresPorTerminal(construirColoresPorTerminal(config));
      } catch {
        // Sin color configurado: el pizarrón usa el amarillo por defecto.
      }
    })();
    return () => { activo = false; };
  }, []);

  return { coloresPorTerminal };
}
