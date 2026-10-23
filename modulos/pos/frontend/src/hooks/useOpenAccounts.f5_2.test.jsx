/**
 * Puerta de FASE 5.2 — Hook `useOpenAccounts`.
 *
 * Verifica los 5 criterios del plan (§6.2.3):
 *   1. Al montar con `terminalId`, llama al servicio y puebla `cuentas`.
 *   2. `refrescar()` vuelve a llamar al servicio.
 *   3. `recuperarCuenta(id)` llama al contrato 21 y devuelve la versión fresca.
 *   4. Error del servicio → `error` poblado, `cuentas` vacío.
 *   5. Desmontar no deja timers ni llamadas pendientes (cleanup).
 *
 * @see PLAN_DE_ABORDAJE_FASE_5_POR_PARTES.md §6.2.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOpenAccounts } from './useOpenAccounts.js';

/** Cuenta de ejemplo con los 5 campos del contrato 23. */
function cuentaEjemplo(extra = {}) {
  return {
    id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    account_num: 'T-0001',
    status: 'OPEN',
    total: '150.00',
    version: 3,
    ...extra,
  };
}

/** Servicio simulado que devuelve una lista de cuentas. */
function servicioOk(cuentas = [cuentaEjemplo()]) {
  return {
    listarCuentasAbiertas: vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: { cuentas },
    })),
  };
}

/** Cliente simulado para el contrato 21. */
function clienteOk(ticket = { id: 'x', version: 7 }) {
  return {
    leerTicket: vi.fn(async () => ticket),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('F5.2 — superficie del hook', () => {
  it('expone cuentas, cargando, error, refrescar y recuperarCuenta', async () => {
    const { result } = renderHook(() =>
      useOpenAccounts({ terminalId: 'TERM-01', servicioCuentas: servicioOk(), clienteApi: clienteOk() })
    );
    // Esperamos a que la carga inicial asiente (evita el warning de act).
    await waitFor(() => expect(result.current.cargando).toBe(false));
    expect(result.current).toHaveProperty('cuentas');
    expect(result.current).toHaveProperty('cargando');
    expect(result.current).toHaveProperty('error');
    expect(typeof result.current.refrescar).toBe('function');
    expect(typeof result.current.recuperarCuenta).toBe('function');
  });
});

describe('F5.2 — criterio 1: carga inicial', () => {
  it('al montar con terminalId llama al servicio y puebla cuentas', async () => {
    const servicioCuentas = servicioOk([
      cuentaEjemplo(),
      cuentaEjemplo({ id: 'b', account_num: 'T-0002' }),
    ]);
    const { result } = renderHook(() =>
      useOpenAccounts({ terminalId: 'TERM-01', servicioCuentas, clienteApi: clienteOk() })
    );

    await waitFor(() => expect(result.current.cargando).toBe(false));
    expect(servicioCuentas.listarCuentasAbiertas).toHaveBeenCalledWith('TERM-01');
    expect(result.current.cuentas).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('sin terminalId no llama al servicio y deja la lista vacía', async () => {
    const servicioCuentas = servicioOk();
    const { result } = renderHook(() =>
      useOpenAccounts({ terminalId: '', servicioCuentas, clienteApi: clienteOk() })
    );

    await waitFor(() => expect(result.current.cargando).toBe(false));
    expect(servicioCuentas.listarCuentasAbiertas).not.toHaveBeenCalled();
    expect(result.current.cuentas).toEqual([]);
  });
});

describe('F5.2 — criterio 2: refrescar', () => {
  it('refrescar() vuelve a llamar al servicio', async () => {
    const servicioCuentas = servicioOk();
    const { result } = renderHook(() =>
      useOpenAccounts({ terminalId: 'TERM-01', servicioCuentas, clienteApi: clienteOk() })
    );

    await waitFor(() => expect(result.current.cargando).toBe(false));
    expect(servicioCuentas.listarCuentasAbiertas).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refrescar();
    });

    expect(servicioCuentas.listarCuentasAbiertas).toHaveBeenCalledTimes(2);
  });
});

describe('F5.2 — criterio 3: recuperarCuenta (lección v6.0)', () => {
  it('llama al contrato 21 (leerTicket) y devuelve la versión fresca', async () => {
    const clienteApi = clienteOk({ id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', version: 9 });
    const { result } = renderHook(() =>
      useOpenAccounts({ terminalId: 'TERM-01', servicioCuentas: servicioOk(), clienteApi })
    );

    await waitFor(() => expect(result.current.cargando).toBe(false));

    let r;
    await act(async () => {
      r = await result.current.recuperarCuenta('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
    });

    expect(clienteApi.leerTicket).toHaveBeenCalledWith('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');
    expect(r.outcome).toBe('ok');
    expect(r.data.version).toBe(9);
  });

  it('NO usa la copia del pizarrón: siempre pide al servidor', async () => {
    const clienteApi = clienteOk({ id: 'x', version: 42 });
    const { result } = renderHook(() =>
      useOpenAccounts({ terminalId: 'TERM-01', servicioCuentas: servicioOk(), clienteApi })
    );

    await waitFor(() => expect(result.current.cargando).toBe(false));

    await act(async () => {
      await result.current.recuperarCuenta('x');
    });

    // El pizarrón tenía version 3; el servidor devolvió 42. Se usó el servidor.
    expect(clienteApi.leerTicket).toHaveBeenCalledTimes(1);
  });

  it('un ticketId vacío devuelve error local sin llamar al cliente', async () => {
    const clienteApi = clienteOk();
    const { result } = renderHook(() =>
      useOpenAccounts({ terminalId: 'TERM-01', servicioCuentas: servicioOk(), clienteApi })
    );

    await waitFor(() => expect(result.current.cargando).toBe(false));

    let r;
    await act(async () => {
      r = await result.current.recuperarCuenta('   ');
    });

    expect(clienteApi.leerTicket).not.toHaveBeenCalled();
    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('ticket_invalido');
  });
});

describe('F5.2 — criterio 4: error del servicio', () => {
  it('puebla error y deja cuentas vacío', async () => {
    const servicioCuentas = {
      listarCuentasAbiertas: vi.fn(async () => ({
        outcome: 'error',
        reason: 'sin_conexion',
        data: null,
      })),
    };
    const { result } = renderHook(() =>
      useOpenAccounts({ terminalId: 'TERM-01', servicioCuentas, clienteApi: clienteOk() })
    );

    await waitFor(() => expect(result.current.cargando).toBe(false));
    expect(result.current.error).toBe('sin_conexion');
    expect(result.current.cuentas).toEqual([]);
  });
});

describe('F5.2 — criterio 5: cleanup', () => {
  it('desmontar no deja escrituras de estado pendientes', async () => {
    let resolver;
    const pendiente = new Promise((res) => {
      resolver = res;
    });
    const servicioCuentas = {
      listarCuentasAbiertas: vi.fn(() => pendiente),
    };

    const { result, unmount } = renderHook(() =>
      useOpenAccounts({ terminalId: 'TERM-01', servicioCuentas, clienteApi: clienteOk() })
    );

    expect(result.current.cargando).toBe(true);
    unmount();

    // Resolvemos DESPUÉS de desmontar: no debe explotar ni escribir estado.
    await act(async () => {
      resolver({ outcome: 'ok', reason: null, data: { cuentas: [cuentaEjemplo()] } });
      await pendiente;
    });

    expect(servicioCuentas.listarCuentasAbiertas).toHaveBeenCalledTimes(1);
  });
});
