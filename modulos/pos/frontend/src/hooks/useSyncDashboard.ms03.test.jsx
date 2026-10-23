/**
 * Tests de useSyncDashboard -- MS-03.
 *
 * Cubre:
 *   ms03.h1 -- Carga inicial invoca endpoints de dashboard y conflictos.
 *   ms03.h2 -- Expone métricas de sucursales y gran total correctamente.
 *   ms03.h3 -- resolverConflicto llama a api.resolveSyncConflict y recarga datos.
 *   ms03.h4 -- Manejo de errores expone el mensaje.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import * as api from '../api/client.js';
import { useSyncDashboard } from './useSyncDashboard.js';

vi.mock('../api/client.js', () => ({
  getSyncDashboardSales: vi.fn(),
  getSyncConflicts: vi.fn(),
  resolveSyncConflict: vi.fn(),
}));

const flushPromises = () => act(async () => {});

const mockDashboard = {
  gran_total_ventas: 5500.0,
  gran_total_tickets: 42,
  sucursales_activas: 2,
  conflictos_pendientes: 1,
  sucursales: [
    {
      branch_id: 'SUC-01',
      branch_name: 'Sucursal Centro',
      status: 'ACTIVE',
      last_sync_at: '2026-10-21T18:00:00Z',
      total_ventas: 3500.0,
      total_tickets: 28,
      ticket_promedio: 125.0,
      total_conflicts: 0,
    },
    {
      branch_id: 'SUC-02',
      branch_name: 'Sucursal Norte',
      status: 'ACTIVE',
      last_sync_at: '2026-10-21T18:15:00Z',
      total_ventas: 2000.0,
      total_tickets: 14,
      ticket_promedio: 142.86,
      total_conflicts: 1,
    },
  ],
};

const mockConflictos = [
  {
    id: 'conf-1',
    branch_id: 'SUC-02',
    domain: 'ventas',
    record_uuid: 'uuid-123',
    conflict_reason: 'PAYLOAD_MISMATCH',
    resolved: false,
    created_at: '2026-10-21T18:10:00Z',
  },
];

function montar() {
  const captured = { current: null };
  function Sonda() {
    captured.current = useSyncDashboard(0);
    return null;
  }
  render(<Sonda />);
  return captured;
}

describe('useSyncDashboard (MS-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getSyncDashboardSales.mockResolvedValue(mockDashboard);
    api.getSyncConflicts.mockResolvedValue(mockConflictos);
    api.resolveSyncConflict.mockResolvedValue({ status: 'ok', resolved: true });
  });

  it('ms03.h1 -- Carga inicial invoca api.getSyncDashboardSales y api.getSyncConflicts', async () => {
    const hook = montar();
    await flushPromises();

    expect(api.getSyncDashboardSales).toHaveBeenCalledTimes(1);
    expect(api.getSyncConflicts).toHaveBeenCalledTimes(1);
    expect(hook.current.cargando).toBe(false);
  });

  it('ms03.h2 -- Expone métricas consolidadas y sucursales correctamente', async () => {
    const hook = montar();
    await flushPromises();

    expect(hook.current.dashboard.gran_total_ventas).toBe(5500.0);
    expect(hook.current.dashboard.sucursales.length).toBe(2);
    expect(hook.current.conflictos.length).toBe(1);
  });

  it('ms03.h3 -- resolverConflicto llama a la API y recarga los datos', async () => {
    const hook = montar();
    await flushPromises();

    await act(async () => {
      await hook.current.resolverConflicto('conf-1', 'Aprobado arqueo de caja');
    });

    expect(api.resolveSyncConflict).toHaveBeenCalledWith('conf-1', 'Aprobado arqueo de caja');
    // Debe haber vuelto a cargar datos (2 llamadas en total)
    expect(api.getSyncDashboardSales).toHaveBeenCalledTimes(2);
  });

  it('ms03.h4 -- Manejo de errores expone el mensaje', async () => {
    api.getSyncDashboardSales.mockRejectedValueOnce(new Error('Fallo de conexión'));

    const hook = montar();
    await flushPromises();

    expect(hook.current.error).toBe('Fallo de conexión');
  });
});
