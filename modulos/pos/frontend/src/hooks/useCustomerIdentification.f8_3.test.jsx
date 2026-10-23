/**
 * Puerta de FASE 8.3 — Hook `useCustomerIdentification`.
 *
 * @paridad: hooks/useCustomerIdentification.f8_3.test.jsx
 * @operacion: La identificación de cliente en el ticket
 *
 * @paridad: hooks/useCustomerIdentification.f8_3.test.jsx
 * @operacion: La identificación de cliente en el ticket
 *
 * Verifica los 6 criterios del plan (§3.4):
 *   1. Superficie: expone cliente, beneficios, cargando, error, identificar, limpiar.
 *   2. Identificar OK: llama al servicio con el teléfono y puebla cliente + beneficios.
 *   3. Degradación DT-07: un fallo del CRM deja `error` poblado y NO bloquea.
 *   4. Limpiar: vuelve al estado inicial.
 *   5. Teléfono vacío: NO llama al servicio y devuelve `telefono_requerido`.
 *   6. Inyectable: usa el servicio inyectado, no el real.
 *
 * @see PLAN_DE_ABORDAJE_FASE_8_POR_PARTES.md §3.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCustomerIdentification } from './useCustomerIdentification.js';

/** Beneficios de ejemplo con los campos del contrato 26. */
function beneficiosEjemplo(extra = {}) {
  return {
    customer_id: 'c-1',
    nombre: 'Ana',
    nivel: 'Oro',
    descuentos: [{ tipo: 'porcentaje', valor: '10', aplica_a: 'total', motivo: 'nivel' }],
    puntos_a_ganar: 12,
    puntos_disponibles: 340,
    puede_canjear: true,
    ...extra,
  };
}

/** Servicio simulado que devuelve beneficios. */
function servicioOk(datos = beneficiosEjemplo()) {
  return {
    obtenerBeneficios: vi.fn(async () => ({ outcome: 'ok', reason: null, data: datos })),
  };
}

/** Servicio simulado que falla con un reason. */
function servicioFallo(reason = 'crm_no_disponible') {
  return {
    obtenerBeneficios: vi.fn(async () => ({ outcome: 'error', reason, data: null })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('F8.3 — superficie del hook', () => {
  it('expone cliente, beneficios, cargando, error, identificar y limpiar', () => {
    const { result } = renderHook(() =>
      useCustomerIdentification({ servicioBeneficios: servicioOk() })
    );

    expect(result.current).toHaveProperty('cliente');
    expect(result.current).toHaveProperty('beneficios');
    expect(result.current).toHaveProperty('cargando');
    expect(result.current).toHaveProperty('error');
    expect(typeof result.current.identificar).toBe('function');
    expect(typeof result.current.limpiar).toBe('function');
  });

  it('arranca sin cliente, sin beneficios, sin cargar y sin error', () => {
    const { result } = renderHook(() =>
      useCustomerIdentification({ servicioBeneficios: servicioOk() })
    );

    expect(result.current.cliente).toBeNull();
    expect(result.current.beneficios).toBeNull();
    expect(result.current.cargando).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe('F8.3 — criterio 2: identificar OK', () => {
  it('llama al servicio con el teléfono y puebla cliente + beneficios', async () => {
    const servicioBeneficios = servicioOk();
    const { result } = renderHook(() =>
      useCustomerIdentification({ servicioBeneficios })
    );

    await act(async () => {
      await result.current.identificar('5512345678');
    });

    expect(servicioBeneficios.obtenerBeneficios).toHaveBeenCalledWith({
      telefono: '5512345678',
      items: [],
    });
    expect(result.current.cliente.customer_id).toBe('c-1');
    expect(result.current.cliente.nombre).toBe('Ana');
    expect(result.current.beneficios.puntos_disponibles).toBe(340);
    expect(result.current.error).toBeNull();
    expect(result.current.cargando).toBe(false);
  });

  it('recorta espacios del teléfono antes de llamar', async () => {
    const servicioBeneficios = servicioOk();
    const { result } = renderHook(() =>
      useCustomerIdentification({ servicioBeneficios })
    );

    await act(async () => {
      await result.current.identificar('  5512345678  ');
    });

    expect(servicioBeneficios.obtenerBeneficios).toHaveBeenCalledWith({
      telefono: '5512345678',
      items: [],
    });
  });

  it('pasa los items del carrito al servicio', async () => {
    const servicioBeneficios = servicioOk();
    const { result } = renderHook(() =>
      useCustomerIdentification({ servicioBeneficios })
    );

    const items = [{ product_id: 'p-1', qty: 2, unit_price: '35.00' }];
    await act(async () => {
      await result.current.identificar('5512345678', items);
    });

    expect(servicioBeneficios.obtenerBeneficios).toHaveBeenCalledWith({
      telefono: '5512345678',
      items,
    });
  });

  it('un cliente inexistente (customer_id null) NO es error: queda sin cliente', async () => {
    const servicioBeneficios = servicioOk({
      customer_id: null,
      nombre: null,
      nivel: null,
      descuentos: [],
      puntos_a_ganar: 0,
      puntos_disponibles: 0,
      puede_canjear: false,
    });
    const { result } = renderHook(() =>
      useCustomerIdentification({ servicioBeneficios })
    );

    await act(async () => {
      await result.current.identificar('5512345678');
    });

    expect(result.current.cliente).toBeNull();
    expect(result.current.beneficios).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

describe('F8.3 — criterio 3: degradación DT-07 (CRM caído no bloquea)', () => {
  it('un fallo del CRM deja error poblado y cliente nulo', async () => {
    const { result } = renderHook(() =>
      useCustomerIdentification({ servicioBeneficios: servicioFallo('crm_no_disponible') })
    );

    await act(async () => {
      await result.current.identificar('5512345678');
    });

    expect(result.current.error).toBe('crm_no_disponible');
    expect(result.current.cliente).toBeNull();
    expect(result.current.beneficios).toBeNull();
    expect(result.current.cargando).toBe(false);
  });

  it('devuelve el outcome del servicio para que el panel decida', async () => {
    const { result } = renderHook(() =>
      useCustomerIdentification({ servicioBeneficios: servicioFallo('sin_conexion') })
    );

    let r;
    await act(async () => {
      r = await result.current.identificar('5512345678');
    });

    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('sin_conexion');
  });
});

describe('F8.3 — criterio 4: limpiar', () => {
  it('limpiar() vuelve al estado inicial', async () => {
    const { result } = renderHook(() =>
      useCustomerIdentification({ servicioBeneficios: servicioOk() })
    );

    await act(async () => {
      await result.current.identificar('5512345678');
    });
    expect(result.current.cliente).not.toBeNull();

    act(() => {
      result.current.limpiar();
    });

    expect(result.current.cliente).toBeNull();
    expect(result.current.beneficios).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.cargando).toBe(false);
  });

  it('limpiar() también borra un error previo', async () => {
    const { result } = renderHook(() =>
      useCustomerIdentification({ servicioBeneficios: servicioFallo('crm_no_disponible') })
    );

    await act(async () => {
      await result.current.identificar('5512345678');
    });
    expect(result.current.error).toBe('crm_no_disponible');

    act(() => {
      result.current.limpiar();
    });

    expect(result.current.error).toBeNull();
  });
});

describe('F8.3 — criterio 5: teléfono vacío (guarda local)', () => {
  it('sin teléfono NO llama al servicio y devuelve telefono_requerido', async () => {
    const servicioBeneficios = servicioOk();
    const { result } = renderHook(() =>
      useCustomerIdentification({ servicioBeneficios })
    );

    let r;
    await act(async () => {
      r = await result.current.identificar('');
    });

    expect(servicioBeneficios.obtenerBeneficios).not.toHaveBeenCalled();
    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('telefono_requerido');
    expect(result.current.error).toBe('telefono_requerido');
  });

  it('un teléfono solo con espacios se trata como vacío', async () => {
    const servicioBeneficios = servicioOk();
    const { result } = renderHook(() =>
      useCustomerIdentification({ servicioBeneficios })
    );

    await act(async () => {
      await result.current.identificar('   ');
    });

    expect(servicioBeneficios.obtenerBeneficios).not.toHaveBeenCalled();
    expect(result.current.error).toBe('telefono_requerido');
  });

  it('un teléfono no-string se trata como vacío', async () => {
    const servicioBeneficios = servicioOk();
    const { result } = renderHook(() =>
      useCustomerIdentification({ servicioBeneficios })
    );

    await act(async () => {
      await result.current.identificar(12345);
    });

    expect(servicioBeneficios.obtenerBeneficios).not.toHaveBeenCalled();
    expect(result.current.error).toBe('telefono_requerido');
  });
});

describe('F8.3 — criterio 6: inyectable', () => {
  it('usa el servicio inyectado, no el real', async () => {
    const servicioBeneficios = servicioOk();
    const { result } = renderHook(() =>
      useCustomerIdentification({ servicioBeneficios })
    );

    await act(async () => {
      await result.current.identificar('5512345678');
    });

    expect(servicioBeneficios.obtenerBeneficios).toHaveBeenCalledTimes(1);
  });

  it('sin servicio inyectado usa el real (no lanza al montar)', () => {
    const { result } = renderHook(() => useCustomerIdentification());
    expect(result.current.cliente).toBeNull();
    expect(typeof result.current.identificar).toBe('function');
  });
});
