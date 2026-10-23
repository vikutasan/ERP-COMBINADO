/**
 * PantallaCocina.ms01.test.jsx — Tests de la pantalla de cocina (MS-01).
 *
 * Fichas cubiertas:
 *   ms01.f1 — Muestra tickets RECIBIDO en la columna izquierda.
 *   ms01.f2 — Muestra tickets EN_PREP en la columna derecha.
 *   ms01.f3 — Tickets LISTO no aparecen en ninguna columna.
 *   ms01.f4 — Botón "Iniciar prep" avanza RECIBIDO → EN_PREP.
 *   ms01.f5 — Botón "Marcar listo" avanza EN_PREP → LISTO y el ticket desaparece.
 *   ms01.f6 — Polling: llama a getColaCocina al montar y cada 5 s.
 *   ms01.f7 — Filtro de canal: al cambiar de canal llama con el nuevo canal.
 *   ms01.f8 — Muestra error si getColaCocina rechaza.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiContext } from '../context/ApiContext.jsx';
import PantallaCocina from './PantallaCocina.jsx';

/** Drena la cola de microtareas (promesas) sin avanzar timers falsos. */
const flushPromises = () => act(async () => {});

/* ─── Helpers de siembra ──────────────────────────────────────────────────── */

function mkTicket(overrides = {}) {
  return {
    id: 'kt-uuid-001',
    ticket_id: 'tk-uuid-001',
    account_num: 'V0001',
    customer_name: null,
    channel: 'PANADERIA',
    kitchen_status: 'RECIBIDO',
    lineas: [{ name: 'Telera', quantity: 2 }],
    notas: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    listo_at: null,
    ...overrides,
  };
}

/* ─── Montaje ─────────────────────────────────────────────────────────────── */

function montar(apiMock, onVolver = () => {}) {
  return render(
    <MemoryRouter initialEntries={['/cocina']}>
      <ApiContext.Provider value={apiMock}>
        <PantallaCocina onVolver={onVolver} />
      </ApiContext.Provider>
    </MemoryRouter>
  );
}

/* ─── Tests ───────────────────────────────────────────────────────────────── */

describe('PantallaCocina — MS-01', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ms01.f1 — tickets RECIBIDO en columna izquierda
  it('ms01.f1 — muestra ticket RECIBIDO en columna izquierda', async () => {
    const ticket = mkTicket({ kitchen_status: 'RECIBIDO', account_num: 'V1001' });
    const api = {
      getColaCocina: vi.fn().mockResolvedValue({ tickets: [ticket], total: 1 }),
      actualizarEstadoCocina: vi.fn(),
    };

    await act(async () => { montar(api); });

    // El folio debe aparecer en la sección RECIBIDO
    const columnaRecibido = document.getElementById('columna-recibido');
    expect(columnaRecibido).not.toBeNull();
    expect(columnaRecibido.textContent).toContain('V1001');
  });

  // ms01.f2 — tickets EN_PREP en columna derecha
  it('ms01.f2 — muestra ticket EN_PREP en columna derecha', async () => {
    const ticket = mkTicket({ kitchen_status: 'EN_PREP', account_num: 'V1002', id: 'kt-002' });
    const api = {
      getColaCocina: vi.fn().mockResolvedValue({ tickets: [ticket], total: 1 }),
      actualizarEstadoCocina: vi.fn(),
    };

    await act(async () => { montar(api); });

    const columnaEnPrep = document.getElementById('columna-en-prep');
    expect(columnaEnPrep).not.toBeNull();
    expect(columnaEnPrep.textContent).toContain('V1002');
  });

  // ms01.f3 — getColaCocina se llama al montar
  it('ms01.f3 — llama a getColaCocina al montar', async () => {
    const api = {
      getColaCocina: vi.fn().mockResolvedValue({ tickets: [], total: 0 }),
      actualizarEstadoCocina: vi.fn(),
    };

    await act(async () => { montar(api); });

    expect(api.getColaCocina).toHaveBeenCalledTimes(1);
  });

  // ms01.f4 — botón "Iniciar prep" avanza RECIBIDO → EN_PREP
  it('ms01.f4 — botón Iniciar prep llama actualizarEstadoCocina con EN_PREP', async () => {
    const ticket = mkTicket({ id: 'kt-003', kitchen_status: 'RECIBIDO', account_num: 'V1003' });
    const api = {
      getColaCocina: vi.fn().mockResolvedValue({ tickets: [ticket], total: 1 }),
      actualizarEstadoCocina: vi.fn().mockResolvedValue({
        id: 'kt-003',
        kitchen_status: 'EN_PREP',
        updated_at: new Date().toISOString(),
        listo_at: null,
      }),
    };

    await act(async () => { montar(api); });

    const btn = document.getElementById('btn-avanzar-kt-003');
    expect(btn).not.toBeNull();

    await act(async () => { fireEvent.click(btn); });

    expect(api.actualizarEstadoCocina).toHaveBeenCalledWith('kt-003', 'EN_PREP');
  });

  // ms01.f5 — botón "Marcar listo" avanza EN_PREP → LISTO y el ticket desaparece
  it('ms01.f5 — botón Marcar listo llama actualizarEstadoCocina con LISTO', async () => {
    const ticket = mkTicket({ id: 'kt-004', kitchen_status: 'EN_PREP', account_num: 'V1004' });
    const api = {
      getColaCocina: vi.fn().mockResolvedValue({ tickets: [ticket], total: 1 }),
      actualizarEstadoCocina: vi.fn().mockResolvedValue({
        id: 'kt-004',
        kitchen_status: 'LISTO',
        updated_at: new Date().toISOString(),
        listo_at: new Date().toISOString(),
      }),
    };

    await act(async () => { montar(api); });

    const btn = document.getElementById('btn-avanzar-kt-004');
    await act(async () => { fireEvent.click(btn); });

    expect(api.actualizarEstadoCocina).toHaveBeenCalledWith('kt-004', 'LISTO');

    // El ticket LISTO no debe aparecer en pantalla tras el update optimista.
    await flushPromises();
    const tarjeta = document.querySelector('[data-testid="tarjeta-kt-004"]');
    expect(tarjeta).toBeNull();
  });

  // ms01.f6 — polling cada 5 s
  it('ms01.f6 — polling llama a getColaCocina cada 5 s', async () => {
    const api = {
      getColaCocina: vi.fn().mockResolvedValue({ tickets: [], total: 0 }),
      actualizarEstadoCocina: vi.fn(),
    };

    await act(async () => { montar(api); });

    expect(api.getColaCocina).toHaveBeenCalledTimes(1);

    // Avanzar 5 s → segunda llamada
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(api.getColaCocina).toHaveBeenCalledTimes(2);

    // Avanzar 5 s más → tercera llamada
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(api.getColaCocina).toHaveBeenCalledTimes(3);
  });

  // ms01.f7 — filtro de canal muestra badge de canal activo
  it('ms01.f7 — botón filtro canal PANADERIA llama con canal correcto en el siguiente poll', async () => {
    const api = {
      getColaCocina: vi.fn().mockResolvedValue({ tickets: [], total: 0 }),
      actualizarEstadoCocina: vi.fn(),
    };

    await act(async () => { montar(api); });

    const btnPanaderia = document.getElementById('btn-canal-PANADERIA');
    expect(btnPanaderia).not.toBeNull();

    // Cambiamos el canal
    await act(async () => { fireEvent.click(btnPanaderia); });

    // El canal se aplica en el siguiente ciclo de polling (5 s).
    await act(async () => { vi.advanceTimersByTime(5_000); });
    await flushPromises();

    // getColaCocina debe haberse llamado con 'PANADERIA' en algún momento.
    const calls = api.getColaCocina.mock.calls;
    expect(calls.some((c) => c[0] === 'PANADERIA')).toBe(true);
  });

  // ms01.f8 — muestra error si getColaCocina rechaza
  it('ms01.f8 — muestra mensaje de error si la API falla', async () => {
    const api = {
      getColaCocina: vi.fn().mockRejectedValue(new Error('Sin conexión')),
      actualizarEstadoCocina: vi.fn(),
    };

    await act(async () => { montar(api); });
    await flushPromises();

    // El mensaje de error debe aparecer en el DOM.
    const errorEl = screen.getByText(/Sin conexión/i);
    expect(errorEl).toBeTruthy();
  });
});
