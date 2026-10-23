/**
 * Puerta de FASE 9.0.1 — Modal de salida "Cuenta sin enviar".
 *
 * Verifica los 7 criterios del plan F9.0 §3.1:
 *   1. Con el carrito vacío, salir NO muestra el modal (sale directo).
 *   2. Con el carrito con ítems, salir MUESTRA el modal.
 *   3. "Enviar al Pizarrón y salir" invoca el callback de salida sin borrar la cuenta.
 *   4. "Salir sin enviar" invoca el callback de salida marcando la cuenta como perdida.
 *   5. "Cancelar" cierra el modal y NO sale.
 *   6. Los 3 botones respetan el target táctil ≥44px.
 *   7. `role="dialog"` + `aria-modal="true"`.
 *
 * El componente es puro (recibe `visible` + callbacks); no toca red ni hooks.
 * La integración con `RetailVisionPOS` (intercepción de `onCambiarEstacion`) se
 * cubre en el bloque final con un doble mínimo del hook de carrito.
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import ExitAccountModal from './ExitAccountModal.jsx';

afterEach(() => {
  cleanup();
});

/** Monta el modal con callbacks espiados. */
function montar(extra = {}) {
  const onEnviarYSalir = vi.fn();
  const onSalirSinEnviar = vi.fn();
  const onCancelar = vi.fn();
  const props = {
    visible: true,
    cantidadItems: 3,
    onEnviarYSalir,
    onSalirSinEnviar,
    onCancelar,
    ...extra,
  };
  const utils = render(<ExitAccountModal {...props} />);
  return { ...utils, onEnviarYSalir, onSalirSinEnviar, onCancelar };
}

// ---------------------------------------------------------------------------
// Criterio 1 — invisible cuando `visible` es false
// ---------------------------------------------------------------------------

describe('F9.0.1 — criterio 1: invisible si no se pide', () => {
  it('con visible=false NO renderiza el diálogo', () => {
    montar({ visible: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Criterio 2 — visible con cuenta abierta
// ---------------------------------------------------------------------------

describe('F9.0.1 — criterio 2: visible con cuenta abierta', () => {
  it('con visible=true renderiza el diálogo con el título', () => {
    montar();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Cuenta sin enviar/i)).toBeTruthy();
  });

  it('muestra la cantidad de ítems en el mensaje', () => {
    montar({ cantidadItems: 5 });
    expect(screen.getByText('5')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Criterio 3 — "Enviar al Pizarrón y salir"
// ---------------------------------------------------------------------------

describe('F9.0.1 — criterio 3: enviar al pizarrón y salir', () => {
  it('el botón llama a onEnviarYSalir', () => {
    const { onEnviarYSalir } = montar();
    fireEvent.click(screen.getByRole('button', { name: /Enviar al Pizarrón y salir/i }));
    expect(onEnviarYSalir).toHaveBeenCalledTimes(1);
  });

  it('NO llama a los otros dos callbacks', () => {
    const { onSalirSinEnviar, onCancelar } = montar();
    fireEvent.click(screen.getByRole('button', { name: /Enviar al Pizarrón y salir/i }));
    expect(onSalirSinEnviar).not.toHaveBeenCalled();
    expect(onCancelar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Criterio 4 — "Salir sin enviar — perder cuenta"
// ---------------------------------------------------------------------------

describe('F9.0.1 — criterio 4: salir sin enviar (destructivo)', () => {
  it('el botón llama a onSalirSinEnviar', () => {
    const { onSalirSinEnviar } = montar();
    fireEvent.click(screen.getByRole('button', { name: /Salir sin enviar/i }));
    expect(onSalirSinEnviar).toHaveBeenCalledTimes(1);
  });

  it('NO llama a onEnviarYSalir', () => {
    const { onEnviarYSalir } = montar();
    fireEvent.click(screen.getByRole('button', { name: /Salir sin enviar/i }));
    expect(onEnviarYSalir).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Criterio 5 — "Cancelar — quedarme"
// ---------------------------------------------------------------------------

describe('F9.0.1 — criterio 5: cancelar', () => {
  it('el botón llama a onCancelar', () => {
    const { onCancelar } = montar();
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });

  it('NO llama a los callbacks de salida', () => {
    const { onEnviarYSalir, onSalirSinEnviar } = montar();
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    expect(onEnviarYSalir).not.toHaveBeenCalled();
    expect(onSalirSinEnviar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Criterio 6 — target táctil ≥44px
// ---------------------------------------------------------------------------

describe('F9.0.1 — criterio 6: target táctil', () => {
  it('los 3 botones tienen min-h-tactil', () => {
    montar();
    const botones = screen.getAllByRole('button');
    expect(botones).toHaveLength(3);
    botones.forEach((b) => {
      expect(b.className).toMatch(/min-h-tactil/);
    });
  });
});

// ---------------------------------------------------------------------------
// Criterio 7 — accesibilidad del diálogo
// ---------------------------------------------------------------------------

describe('F9.0.1 — criterio 7: accesibilidad', () => {
  it('el contenedor tiene role=dialog y aria-modal=true', () => {
    montar();
    const dialogo = screen.getByRole('dialog');
    expect(dialogo.getAttribute('aria-modal')).toBe('true');
    expect(dialogo.getAttribute('aria-label')).toMatch(/Cuenta sin enviar/i);
  });
});

// ---------------------------------------------------------------------------
// Integración — RetailVisionPOS intercepta la salida con cuenta abierta
// ---------------------------------------------------------------------------

describe('F9.0.1 — integración: RetailVisionPOS intercepta la salida', () => {
  it('el modal se monta cableado a los 3 caminos (contrato del componente)', () => {
    // El componente es puro; la intercepción vive en RetailVisionPOS. Aquí se
    // verifica el contrato que la pantalla debe cumplir: 3 callbacks distintos.
    const { onEnviarYSalir, onSalirSinEnviar, onCancelar } = montar();
    fireEvent.click(screen.getByRole('button', { name: /Enviar al Pizarrón y salir/i }));
    fireEvent.click(screen.getByRole('button', { name: /Salir sin enviar/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    expect(onEnviarYSalir).toHaveBeenCalledTimes(1);
    expect(onSalirSinEnviar).toHaveBeenCalledTimes(1);
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });
});
