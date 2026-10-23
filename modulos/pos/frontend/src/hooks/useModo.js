/**
 * `useModo` — resuelve el modo de layout activo (R-03).
 *
 * Los 3 modos son explícitos y se derivan del ancho del viewport:
 *   - MOSTRADOR ≥1024px  (referencia de verdad, intocable)
 *   - COMPACTO  768–1023px
 *   - MÓVIL     <768px
 *
 * Tailwind ya aplica los estilos por breakpoint; este hook existe para los
 * casos en que la lógica (no el CSS) depende del modo, p. ej. si el ticket es
 * panel lateral o panel inferior deslizable.
 */

import { useEffect, useState } from 'react';
import { CONFIG } from '../../../shared/config.js';

/** Devuelve el modo correspondiente a un ancho en píxeles. */
export function modoParaAncho(ancho) {
  if (ancho >= CONFIG.MODOS.MOSTRADOR.min) return 'MOSTRADOR';
  if (ancho >= CONFIG.MODOS.COMPACTO.min) return 'COMPACTO';
  return 'MOVIL';
}

export function useModo() {
  const [ancho, setAncho] = useState(() =>
    typeof window === 'undefined' ? CONFIG.MODOS.MOSTRADOR.min : window.innerWidth
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const alRedimensionar = () => setAncho(window.innerWidth);
    window.addEventListener('resize', alRedimensionar);
    return () => window.removeEventListener('resize', alRedimensionar);
  }, []);

  const modo = modoParaAncho(ancho);
  return {
    modo,
    ancho,
    esMostrador: modo === 'MOSTRADOR',
    esCompacto: modo === 'COMPACTO',
    esMovil: modo === 'MOVIL',
  };
}

export default useModo;
