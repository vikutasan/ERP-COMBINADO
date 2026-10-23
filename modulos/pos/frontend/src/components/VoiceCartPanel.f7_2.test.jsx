/**
 * Puerta de FASE 7.2 — Voz: `VoiceCartPanel` (interfaz).
 *
 * Cubre los criterios 10–11 del gate (§7.4 del plan):
 *  10. Muestra la propuesta y exige confirmación explícita.
 *  11. Respeta R-03 (3 modos) y R-04 (target ≥44px).
 *
 * El panel es presentación pura: recibe estado y callbacks por props.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import VoiceCartPanel from './VoiceCartPanel.jsx';
import { POS_VOICE_INTENTS } from '../utils/voiceCartMapper.js';

afterEach(() => {
  cleanup();
});

const PRODUCTOS = [
  { id: 'SKU-001', name: 'Concha Vainilla', price: 12.5 },
  { id: 'SKU-002', name: 'Bolillo', price: 3.0 },
];

/** Propuesta de ejemplo (ya mapeada por el hook). */
function propuestaEjemplo(extra = {}) {
  return {
    intencion: POS_VOICE_INTENTS.AGREGAR_ITEM,
    confianza: 0.95,
    revisar: false,
    hay_no_resueltos: false,
    confirmado: false,
    texto_original: 'agrega 3 bolillos',
    lineas: [
      {
        sku_dictado: 'SKU-002',
        producto_id: 'SKU-002',
        nombre: 'Bolillo',
        precio: 3.0,
        cantidad: 3,
        unidad: 'pieza',
        resuelto: true,
        confirmado: false,
      },
    ],
    ...extra,
  };
}

/** Props base del panel. */
function propsBase(extra = {}) {
  return {
    grabando: false,
    transcribiendo: false,
    texto: '',
    propuesta: null,
    disponible: true,
    error: null,
    fase: 'inactivo',
    nivel: 0,
    productos: PRODUCTOS,
    onToggleRecording: vi.fn(),
    onEditLine: vi.fn(),
    onRemoveLine: vi.fn(),
    onToggleConfirm: vi.fn(),
    onApply: vi.fn(),
    onCancel: vi.fn(),
    ...extra,
  };
}

describe('F7.2 · VoiceCartPanel · criterio 10 — propuesta + confirmación explícita', () => {
  it('muestra la propuesta con sus líneas', () => {
    render(<VoiceCartPanel {...propsBase({ propuesta: propuestaEjemplo() })} />);
    // El encabezado de la propuesta lleva el emoji; el botón del pie no.
    expect(screen.getByText(/🛒 Agregar al carrito/i)).toBeTruthy();
    expect(screen.getByText(/Confianza 95%/i)).toBeTruthy();
    // El selector de producto muestra el producto resuelto.
    const selector = screen.getByLabelText(/Producto de la línea 1/i);
    expect(selector.value).toBe('SKU-002');
  });

  it('el botón "Agregar al carrito" está deshabilitado sin confirmación', () => {
    render(<VoiceCartPanel {...propsBase({ propuesta: propuestaEjemplo() })} />);
    const boton = screen.getByRole('button', { name: /Agregar al carrito/i });
    expect(boton.disabled).toBe(true);
  });

  it('el botón se habilita cuando la propuesta está confirmada', () => {
    render(
      <VoiceCartPanel {...propsBase({ propuesta: propuestaEjemplo({ confirmado: true }) })} />
    );
    const boton = screen.getByRole('button', { name: /Agregar al carrito/i });
    expect(boton.disabled).toBe(false);
  });

  it('el checkbox de confirmación dispara onToggleConfirm', () => {
    const onToggleConfirm = vi.fn();
    render(
      <VoiceCartPanel {...propsBase({ propuesta: propuestaEjemplo(), onToggleConfirm })} />
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleConfirm).toHaveBeenCalledTimes(1);
  });

  it('onApply solo se invoca desde el botón (no automáticamente)', () => {
    const onApply = vi.fn();
    render(
      <VoiceCartPanel
        {...propsBase({ propuesta: propuestaEjemplo({ confirmado: true }), onApply })}
      />
    );
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Agregar al carrito/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('muestra "No entendido" para una intención DESCONOCIDA y bloquea el aplicar', () => {
    render(
      <VoiceCartPanel
        {...propsBase({
          propuesta: propuestaEjemplo({
            intencion: POS_VOICE_INTENTS.DESCONOCIDA,
            lineas: [],
          }),
        })}
      />
    );
    expect(screen.getByText(/No entendido/i)).toBeTruthy();
    const boton = screen.getByRole('button', { name: /Agregar al carrito/i });
    expect(boton.disabled).toBe(true);
  });

  it('resalta en ámbar cuando `revisar` es true', () => {
    const { container } = render(
      <VoiceCartPanel {...propsBase({ propuesta: propuestaEjemplo({ revisar: true }) })} />
    );
    expect(container.querySelector('.border-amber-500\\/30')).toBeTruthy();
  });

  it('muestra el aviso de no disponibilidad cuando disponible=false', () => {
    render(<VoiceCartPanel {...propsBase({ disponible: false })} />);
    expect(screen.getByText(/Dictado por voz no disponible/i)).toBeTruthy();
  });

  it('muestra el texto transcrito', () => {
    render(<VoiceCartPanel {...propsBase({ texto: 'agrega 3 bolillos' })} />);
    expect(screen.getByText(/agrega 3 bolillos/)).toBeTruthy();
  });

  it('el botón de cerrar dispara onCancel', () => {
    const onCancel = vi.fn();
    render(<VoiceCartPanel {...propsBase({ onCancel })} />);
    fireEvent.click(screen.getByRole('button', { name: /Cerrar/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('F7.2 · VoiceCartPanel · criterio 11 — R-03 y R-04', () => {
  it('R-03: el contenedor raíz es un overlay fluido, sin ancho fijo en px', () => {
    const { container } = render(<VoiceCartPanel {...propsBase()} />);
    const raiz = container.firstChild;
    expect(raiz.className).toContain('fixed');
    expect(raiz.className).toContain('inset-0');
    // No hay anchos fijos en px (R-01/R-03): solo max-w-*.
    expect(raiz.className).not.toMatch(/w-\[\d+px\]/);
    const caja = container.querySelector('.max-w-2xl');
    expect(caja).toBeTruthy();
  });

  it('R-03: el cuerpo tiene scroll interno (max-h) para los 3 modos', () => {
    const { container } = render(<VoiceCartPanel {...propsBase()} />);
    expect(container.querySelector('.max-h-\\[70vh\\]')).toBeTruthy();
  });

  it('R-04: el botón de micrófono tiene min-h-tactil', () => {
    render(<VoiceCartPanel {...propsBase()} />);
    const mic = screen.getByRole('button', { name: /Iniciar dictado/i });
    expect(mic.className).toContain('min-h-tactil');
  });

  it('R-04: los botones del pie tienen min-h-tactil', () => {
    render(<VoiceCartPanel {...propsBase({ propuesta: propuestaEjemplo() })} />);
    const cancelar = screen.getByRole('button', { name: /^Cancelar$/i });
    const aplicar = screen.getByRole('button', { name: /Agregar al carrito/i });
    expect(cancelar.className).toContain('min-h-tactil');
    expect(aplicar.className).toContain('min-h-tactil');
  });

  it('R-04: el selector de producto y el input de cantidad tienen min-h-tactil', () => {
    render(<VoiceCartPanel {...propsBase({ propuesta: propuestaEjemplo() })} />);
    expect(screen.getByLabelText(/Producto de la línea 1/i).className).toContain('min-h-tactil');
    expect(screen.getByLabelText(/Cantidad de la línea 1/i).className).toContain('min-h-tactil');
  });

  it('R-04: el botón de quitar línea tiene min-h-tactil', () => {
    render(<VoiceCartPanel {...propsBase({ propuesta: propuestaEjemplo() })} />);
    expect(screen.getByRole('button', { name: /Quitar línea 1/i }).className).toContain(
      'min-h-tactil'
    );
  });
});
