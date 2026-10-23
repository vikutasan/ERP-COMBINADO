/**
 * Smoke test FD-03 (2/3) — POSAlerts renderiza las 3 alertas.
 *
 * Verifica que el componente extraído por FD-01 renderiza correctamente
 * cada una de las 3 alertas según la prop `visible`, y que los callbacks
 * se disparan al hacer click en los botones.
 *
 * Sin mock de API: POSAlerts es puramente presentacional.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AvisoCaja, AvisoPedidoSinProgramar, AvisoEmpaque } from './components/POSAlerts.jsx';

afterEach(cleanup);

// ── AvisoCaja ────────────────────────────────────────────────────────────────
describe('FD-03 (2/3) — AvisoCaja (F4.5.3 / RN-49)', () => {
  it('visible=false → no monta el alertdialog', () => {
    render(<AvisoCaja visible={false} onAbrirCaja={vi.fn()} onCancelar={vi.fn()} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('visible=true → monta el alertdialog con título correcto', () => {
    render(<AvisoCaja visible={true} onAbrirCaja={vi.fn()} onCancelar={vi.fn()} />);
    expect(screen.getByRole('alertdialog', { name: 'Caja cerrada' })).toBeTruthy();
    expect(screen.getByText('Abre la caja antes de cobrar')).toBeTruthy();
  });

  it('clic "Abrir caja" dispara onAbrirCaja', () => {
    const onAbrirCaja = vi.fn();
    render(<AvisoCaja visible={true} onAbrirCaja={onAbrirCaja} onCancelar={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir caja' }));
    expect(onAbrirCaja).toHaveBeenCalledOnce();
  });

  it('clic "Cancelar" dispara onCancelar', () => {
    const onCancelar = vi.fn();
    render(<AvisoCaja visible={true} onAbrirCaja={vi.fn()} onCancelar={onCancelar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancelar).toHaveBeenCalledOnce();
  });
});

// ── AvisoPedidoSinProgramar ──────────────────────────────────────────────────
describe('FD-03 (2/3) — AvisoPedidoSinProgramar (F12.24)', () => {
  it('visible=false → no monta', () => {
    render(<AvisoPedidoSinProgramar visible={false} onProgramarAhora={vi.fn()} onEnviarComoVentaDirecta={vi.fn()} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('visible=true → monta con aria-label="Pedido sin programar"', () => {
    render(<AvisoPedidoSinProgramar visible={true} onProgramarAhora={vi.fn()} onEnviarComoVentaDirecta={vi.fn()} />);
    expect(screen.getByRole('alertdialog', { name: 'Pedido sin programar' })).toBeTruthy();
  });

  it('botón "Programar ahora" tiene id="btn-programar-ahora" (accesibilidad)', () => {
    render(<AvisoPedidoSinProgramar visible={true} onProgramarAhora={vi.fn()} onEnviarComoVentaDirecta={vi.fn()} />);
    expect(document.getElementById('btn-programar-ahora')).toBeTruthy();
  });

  it('botón "Enviar como Venta Directa" tiene id="btn-enviar-venta-directa"', () => {
    render(<AvisoPedidoSinProgramar visible={true} onProgramarAhora={vi.fn()} onEnviarComoVentaDirecta={vi.fn()} />);
    expect(document.getElementById('btn-enviar-venta-directa')).toBeTruthy();
  });

  it('clic "Programar ahora" dispara onProgramarAhora', () => {
    const onProgramar = vi.fn();
    render(<AvisoPedidoSinProgramar visible={true} onProgramarAhora={onProgramar} onEnviarComoVentaDirecta={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Programar ahora' }));
    expect(onProgramar).toHaveBeenCalledOnce();
  });

  it('clic "Enviar como Venta Directa" dispara onEnviarComoVentaDirecta', () => {
    const onVD = vi.fn();
    render(<AvisoPedidoSinProgramar visible={true} onProgramarAhora={vi.fn()} onEnviarComoVentaDirecta={onVD} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar como Venta Directa' }));
    expect(onVD).toHaveBeenCalledOnce();
  });
});

// ── AvisoEmpaque ─────────────────────────────────────────────────────────────
describe('FD-03 (2/3) — AvisoEmpaque (P1 Capa 2)', () => {
  it('visible=false → no monta', () => {
    render(<AvisoEmpaque visible={false} onVolver={vi.fn()} onCobrarSinEmpaque={vi.fn()} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('visible=true → monta con aria-label="Sin empaque en la cuenta"', () => {
    render(<AvisoEmpaque visible={true} onVolver={vi.fn()} onCobrarSinEmpaque={vi.fn()} />);
    expect(screen.getByRole('alertdialog', { name: 'Sin empaque en la cuenta' })).toBeTruthy();
    expect(screen.getByText('Sin empaque en la cuenta')).toBeTruthy();
  });

  it('clic "Volver y agregar empaque" dispara onVolver', () => {
    const onVolver = vi.fn();
    render(<AvisoEmpaque visible={true} onVolver={onVolver} onCobrarSinEmpaque={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Volver y agregar empaque' }));
    expect(onVolver).toHaveBeenCalledOnce();
  });

  it('clic "Cobrar sin empaque" dispara onCobrarSinEmpaque', () => {
    const onCobrar = vi.fn();
    render(<AvisoEmpaque visible={true} onVolver={vi.fn()} onCobrarSinEmpaque={onCobrar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cobrar sin empaque' }));
    expect(onCobrar).toHaveBeenCalledOnce();
  });
});
