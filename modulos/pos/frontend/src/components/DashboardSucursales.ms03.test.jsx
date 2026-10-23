/**
 * Tests del componente DashboardSucursales -- MS-03.
 *
 * Cubre:
 *   ms03.c1 -- Renderiza KPIs globales y título.
 *   ms03.c2 -- Renderiza tarjetas de sucursal con métricas.
 *   ms03.c3 -- Renderiza conflictos y abre modal al hacer clic en Resolver.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import * as api from '../api/client.js';
import DashboardSucursales from './DashboardSucursales.jsx';

vi.mock('../api/client.js', () => ({
  getSyncDashboardSales: vi.fn(),
  getSyncConflicts: vi.fn(),
  resolveSyncConflict: vi.fn(),
}));

const flushPromises = () => act(async () => {});

const mockDashboard = {
  gran_total_ventas: 7200.0,
  gran_total_tickets: 50,
  sucursales_activas: 2,
  conflictos_pendientes: 1,
  sucursales: [
    {
      branch_id: 'SUC-01',
      branch_name: 'Sucursal Centro',
      status: 'ACTIVE',
      last_sync_at: '2026-10-21T18:00:00Z',
      total_ventas: 4200.0,
      total_tickets: 30,
      ticket_promedio: 140.0,
      total_conflicts: 0,
    },
    {
      branch_id: 'SUC-02',
      branch_name: 'Sucursal Norte',
      status: 'ACTIVE',
      last_sync_at: '2026-10-21T18:15:00Z',
      total_ventas: 3000.0,
      total_tickets: 20,
      ticket_promedio: 150.0,
      total_conflicts: 1,
    },
  ],
};

const mockConflictos = [
  {
    id: 'conf-99',
    branch_id: 'SUC-02',
    domain: 'ventas',
    record_uuid: 'uuid-999',
    conflict_reason: 'PAYLOAD_MISMATCH',
    resolved: false,
    created_at: '2026-10-21T18:10:00Z',
  },
];

describe('DashboardSucursales (MS-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getSyncDashboardSales.mockResolvedValue(mockDashboard);
    api.getSyncConflicts.mockResolvedValue(mockConflictos);
    api.resolveSyncConflict.mockResolvedValue({ status: 'ok', resolved: true });
  });

  it('ms03.c1 -- Renderiza KPIs globales y título', async () => {
    render(<DashboardSucursales onVolver={vi.fn()} />);
    await flushPromises();

    expect(screen.getByTestId('dashboard-sucursales')).not.toBeNull();
    expect(screen.getByText(/Panel Central de Sucursales/i)).not.toBeNull();
    expect(screen.getByText('$7,200.00')).not.toBeNull();
    expect(screen.getByText('50')).not.toBeNull();
  });

  it('ms03.c2 -- Renderiza tarjetas de sucursal con datos', async () => {
    render(<DashboardSucursales onVolver={vi.fn()} />);
    await flushPromises();

    expect(screen.getByTestId('tarjeta-sucursal-SUC-01')).not.toBeNull();
    expect(screen.getByTestId('tarjeta-sucursal-SUC-02')).not.toBeNull();
    expect(screen.getByText('Sucursal Centro')).not.toBeNull();
    expect(screen.getByText('Sucursal Norte')).not.toBeNull();
  });

  it('ms03.c3 -- Renderiza conflictos y abre modal de resolución', async () => {
    render(<DashboardSucursales onVolver={vi.fn()} />);
    await flushPromises();

    expect(screen.getByTestId('conflicto-item-conf-99')).not.toBeNull();
    const btnResolver = screen.getByRole('button', { name: /Resolver/i });
    fireEvent.click(btnResolver);

    // Modal debe ser visible
    expect(screen.getByText(/Resolver Conflicto de Sincronización/i)).not.toBeNull();
    expect(screen.getByPlaceholderText(/causa del ajuste/i)).not.toBeNull();
  });
});
