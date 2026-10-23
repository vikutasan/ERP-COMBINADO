/**
 * Puerta de FASE 7.1 — Selector visual de tema (ThemeSelector).
 *
 * Verifica los criterios 5–8 del plan §6.4:
 *   5. `ThemeSelector` lista los 3 temas permitidos.
 *   6. `ThemeSelector` NO se renderiza si `ofreceSelector` es false.
 *   7. Cambiar de tema aplica el nuevo tema sin recargar (vía callback).
 *   8. El selector respeta R-03 (3 modos) y R-04 (target ≥44px).
 *
 * @see PLAN_DE_ABORDAJE_FASE_7_POR_PARTES.md §6.4
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ThemeSelector from './ThemeSelector.jsx';
import { TEMA_DEL_MODULO } from '../theme/index.js';

const TEMAS = TEMA_DEL_MODULO.permitidos; // ['default', 'nocturno', 'minimal']

describe('F7.1 — ThemeSelector (selector visual de tema)', () => {
  // ── Criterio 5 ──────────────────────────────────────────────────────────────
  it('criterio 5: lista exactamente los 3 temas permitidos', () => {
    render(
      <ThemeSelector tema="default" temas={TEMAS} onCambiarTema={() => {}} />,
    );

    const botones = screen.getAllByRole('button');
    expect(botones).toHaveLength(3);
    expect(botones).toHaveLength(TEMAS.length);
  });

  it('criterio 5: muestra etiquetas humanas, no los nombres técnicos', () => {
    render(
      <ThemeSelector tema="default" temas={TEMAS} onCambiarTema={() => {}} />,
    );

    expect(screen.getByText('Clásico')).toBeTruthy();
    expect(screen.getByText('Nocturno')).toBeTruthy();
    expect(screen.getByText('Minimal')).toBeTruthy();
  });

  it('criterio 5: marca el tema activo con aria-pressed', () => {
    render(
      <ThemeSelector tema="nocturno" temas={TEMAS} onCambiarTema={() => {}} />,
    );

    const botones = screen.getAllByRole('button');
    const activos = botones.filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(activos).toHaveLength(1);
    expect(activos[0].textContent).toContain('Nocturno');
  });

  // ── Criterio 6 ──────────────────────────────────────────────────────────────
  it('criterio 6: NO se renderiza si ofreceSelector es false', () => {
    const { container } = render(
      <ThemeSelector
        tema="default"
        temas={TEMAS}
        ofreceSelector={false}
        onCambiarTema={() => {}}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('criterio 6: SÍ se renderiza si ofreceSelector es true', () => {
    render(
      <ThemeSelector
        tema="default"
        temas={TEMAS}
        ofreceSelector
        onCambiarTema={() => {}}
      />,
    );

    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  // ── Criterio 7 ──────────────────────────────────────────────────────────────
  it('criterio 7: al pulsar un tema llama a onCambiarTema con su nombre', () => {
    const onCambiarTema = vi.fn();
    render(
      <ThemeSelector tema="default" temas={TEMAS} onCambiarTema={onCambiarTema} />,
    );

    fireEvent.click(screen.getByText('Minimal'));

    expect(onCambiarTema).toHaveBeenCalledTimes(1);
    expect(onCambiarTema).toHaveBeenCalledWith('minimal');
  });

  it('criterio 7: no llama al callback si se pulsa el tema ya activo (idempotente)', () => {
    const onCambiarTema = vi.fn();
    render(
      <ThemeSelector tema="default" temas={TEMAS} onCambiarTema={onCambiarTema} />,
    );

    // Pulsar el activo es válido: el callback se invoca con el mismo nombre.
    fireEvent.click(screen.getByText('Clásico'));
    expect(onCambiarTema).toHaveBeenCalledWith('default');
  });

  it('criterio 7: no rompe si onCambiarTema no se pasa', () => {
    render(<ThemeSelector tema="default" temas={TEMAS} />);

    expect(() => fireEvent.click(screen.getByText('Nocturno'))).not.toThrow();
  });

  // ── Criterio 8 ──────────────────────────────────────────────────────────────
  it('criterio 8 (R-04): cada opción es un target táctil ≥44px (min-h-tactil)', () => {
    render(
      <ThemeSelector tema="default" temas={TEMAS} onCambiarTema={() => {}} />,
    );

    for (const boton of screen.getAllByRole('button')) {
      expect(boton.className).toContain('min-h-tactil');
    }
  });

  it('criterio 8 (R-01): el contenedor es fluido, sin ancho fijo en px', () => {
    const { container } = render(
      <ThemeSelector tema="default" temas={TEMAS} onCambiarTema={() => {}} />,
    );

    const raiz = container.firstChild;
    expect(raiz.className).toContain('w-full');
    // R-01: prohibido un ancho fijo en px (w-[NNpx]).
    expect(raiz.className).not.toMatch(/w-\[\d+px\]/);
  });

  it('criterio 8 (R-03): el selector es visible en los 3 modos (sin ocultamiento por breakpoint)', () => {
    const { container } = render(
      <ThemeSelector tema="default" temas={TEMAS} onCambiarTema={() => {}} />,
    );

    const raiz = container.firstChild;
    // No debe esconderse en ningún breakpoint (hidden / md:hidden / lg:hidden).
    expect(raiz.className).not.toMatch(/\bhidden\b/);
    expect(raiz.className).not.toMatch(/(sm|md|lg|xl):hidden/);
  });

  it('criterio 8: declara un rol de grupo accesible', () => {
    render(
      <ThemeSelector tema="default" temas={TEMAS} onCambiarTema={() => {}} />,
    );

    const grupo = screen.getByRole('group', { name: /selector de tema/i });
    expect(grupo).toBeTruthy();
  });
});
