/**
 * Puerta de FASE 7.3 — Visión: `VisionVisor` (componente).
 *
 * Cubre los criterios 6–8 y 11 del gate (§8.4 del plan):
 *   6. Sugiere productos pero NO los agrega al carrito automáticamente (RN-74).
 *   7. Muestra "IA no disponible" si el contrato falla.
 *   8. Respeta R-03 (3 modos) y R-04 (target ≥44px).
 *  11. Mantiene el visor abierto entre detecciones (flujo persistente) (DT-08).
 *
 * Es un test de presentación: se pasan props y se observa el DOM. Cero lógica
 * de negocio (esa vive en `useVision`).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VisionVisor from './VisionVisor.jsx';

/** Sugerencia resuelta de ejemplo. */
function sugerenciaEjemplo(extra = {}) {
  return {
    sku: 'SKU-001',
    nombre: 'Concha Vainilla',
    confianza: 0.92,
    bbox: [0, 0, 10, 10],
    producto_id: 'SKU-001',
    resuelto: true,
    ...extra,
  };
}

/** Props base del visor. */
function propsBase(extra = {}) {
  return {
    activo: true,
    analizando: false,
    sugerencias: [],
    disponible: true,
    error: null,
    umbral: 0.35,
    videoRef: { current: null },
    canvasRef: { current: null },
    onToggle: vi.fn(),
    onAgregar: vi.fn(),
    onLimpiar: vi.fn(),
    onCerrar: vi.fn(),
    ...extra,
  };
}

describe('F7.3 · VisionVisor · criterio 6 — sugiere, no agrega (RN-74)', () => {
  it('muestra las sugerencias con su botón Agregar', () => {
    render(<VisionVisor {...propsBase({ sugerencias: [sugerenciaEjemplo()] })} />);
    expect(screen.getByText('Concha Vainilla')).toBeTruthy();
    expect(screen.getByText(/➕ Agregar/)).toBeTruthy();
  });

  it('NO agrega al carrito automáticamente al renderizar', () => {
    const onAgregar = vi.fn();
    render(
      <VisionVisor {...propsBase({ sugerencias: [sugerenciaEjemplo()], onAgregar })} />
    );
    // Sin interacción del operador, el callback NUNCA se dispara.
    expect(onAgregar).not.toHaveBeenCalled();
  });

  it('solo agrega cuando el operador pulsa Agregar', () => {
    const onAgregar = vi.fn();
    render(
      <VisionVisor {...propsBase({ sugerencias: [sugerenciaEjemplo()], onAgregar })} />
    );
    fireEvent.click(screen.getByText(/➕ Agregar/));
    expect(onAgregar).toHaveBeenCalledTimes(1);
    expect(onAgregar.mock.calls[0][0].sku).toBe('SKU-001');
  });

  it('deshabilita Agregar si la sugerencia no está en el catálogo', () => {
    const onAgregar = vi.fn();
    render(
      <VisionVisor
        {...propsBase({
          sugerencias: [sugerenciaEjemplo({ resuelto: false, producto_id: null })],
          onAgregar,
        })}
      />
    );
    const boton = screen.getByText(/➕ Agregar/).closest('button');
    expect(boton.disabled).toBe(true);
    fireEvent.click(boton);
    expect(onAgregar).not.toHaveBeenCalled();
  });
});

describe('F7.3 · VisionVisor · criterio 7 — IA no disponible', () => {
  it('muestra "IA no disponible" si el contrato falla', () => {
    render(<VisionVisor {...propsBase({ disponible: false })} />);
    // El aviso ámbar es el mensaje de degradación (el indicador de estado
    // también dice "IA no disponible", por eso se usa getAllByText).
    expect(screen.getAllByText(/IA no disponible/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Usa la captura manual/i)).toBeTruthy();
  });

  it('no muestra el aviso cuando la IA está disponible', () => {
    render(<VisionVisor {...propsBase({ disponible: true })} />);
    expect(screen.queryByText(/Usa la captura manual/i)).toBeNull();
  });
});

describe('F7.3 · VisionVisor · criterio 8 — R-03 y R-04', () => {
  it('el contenedor es un overlay responsivo (R-03): sin ancho fijo en px', () => {
    const { container } = render(<VisionVisor {...propsBase()} />);
    const overlay = container.firstChild;
    expect(overlay.className).toMatch(/fixed/);
    expect(overlay.className).toMatch(/inset-0/);
    // El panel interno usa max-w-* (no w-[NNNpx]).
    const panel = overlay.firstChild;
    expect(panel.className).toMatch(/max-w-3xl/);
    expect(panel.className).not.toMatch(/w-\[\d+px\]/);
  });

  it('los controles interactivos tienen min-h-tactil (R-04, ≥44px)', () => {
    render(<VisionVisor {...propsBase({ sugerencias: [sugerenciaEjemplo()] })} />);
    const botones = screen.getAllByRole('button');
    expect(botones.length).toBeGreaterThan(0);
    botones.forEach((b) => {
      expect(b.className).toMatch(/min-h-tactil/);
    });
  });
});

describe('F7.3 · VisionVisor · criterio 11 — flujo persistente (DT-08)', () => {
  it('mantiene el visor abierto entre detecciones (no se cierra por producto)', () => {
    const { rerender } = render(
      <VisionVisor {...propsBase({ activo: true, sugerencias: [] })} />
    );
    // Llega una detección: el visor sigue montado y activo.
    rerender(<VisionVisor {...propsBase({ activo: true, sugerencias: [sugerenciaEjemplo()] })} />);
    expect(screen.getByText('Concha Vainilla')).toBeTruthy();
    // El diálogo sigue presente (no se cerró al detectar).
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('el visor solo se cierra por acción explícita del operador', () => {
    const onCerrar = vi.fn();
    render(<VisionVisor {...propsBase({ onCerrar })} />);
    fireEvent.click(screen.getByLabelText('Cerrar'));
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  it('muestra el botón Iniciar visión cuando el visor está cerrado', () => {
    render(<VisionVisor {...propsBase({ activo: false })} />);
    expect(screen.getByText(/Iniciar visión/i)).toBeTruthy();
  });
});
