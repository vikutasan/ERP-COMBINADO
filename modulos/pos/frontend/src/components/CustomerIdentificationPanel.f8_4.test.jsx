/**
 * Puerta de FASE 8.4 — Panel de identificación del cliente.
 *
 * Verifica los 7 criterios del plan (§3.5):
 *   1. Superficie: es un diálogo con `aria-label="Identificación del cliente"`,
 *      el input `#input-telefono-cliente` y el botón `#btn-buscar-cliente`.
 *   2. Buscar OK: teclear el teléfono y pulsar Buscar llama al servicio con el
 *      teléfono y los items, y muestra los beneficios que el CRM devuelve.
 *   3. El POS NO calcula: muestra los descuentos tal cual los devuelve el CRM
 *      (RN-83: el POS solo muestra, no recalcula).
 *   4. Cliente nuevo: si el CRM no encuentra al cliente, se avisa y NO se
 *      identifica a nadie (RN-82: el cliente es opcional, no bloquea).
 *   5. Degradación DT-07: si el CRM está caído, se muestra un aviso y el panel
 *      sigue permitiendo cerrar (RN-87: el fallo del CRM no tumba el POS).
 *   6. Cerrar: el botón `aria-label="Cerrar"` invoca `onCerrar`.
 *   7. Inyectable: usa el servicio inyectado, no el real (no toca la red).
 *
 * El componente consume `useCustomerIdentification`; aquí se inyecta un doble
 * del servicio para no tocar la red.
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 *
 * @see PLAN_DE_ABORDAJE_FASE_8_POR_PARTES.md §3.5
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §6.8 (UX heredada)
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import CustomerIdentificationPanel from './CustomerIdentificationPanel.jsx';

afterEach(() => {
  cleanup();
});

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

/** Servicio doble que devuelve beneficios. */
function servicioOk(datos = beneficiosEjemplo()) {
  return {
    obtenerBeneficios: vi.fn(async () => ({ outcome: 'ok', reason: null, data: datos })),
  };
}

/** Servicio doble que devuelve "cliente no encontrado" (customer_id null). */
function servicioSinCliente() {
  return {
    obtenerBeneficios: vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: { customer_id: null },
    })),
  };
}

/** Servicio doble que falla con un `reason`. */
function servicioQueFalla(reason = 'crm_no_disponible') {
  return {
    obtenerBeneficios: vi.fn(async () => ({ outcome: 'error', reason, data: null })),
  };
}

/** Monta el panel con el servicio inyectado. */
function montar(servicioBeneficios, props = {}) {
  return render(
    <CustomerIdentificationPanel
      items={[{ product_id: 'p-1', quantity: 2 }]}
      servicioBeneficios={servicioBeneficios}
      onIdentificado={props.onIdentificado}
      onCerrar={props.onCerrar || (() => {})}
    />
  );
}

/** Teclea un teléfono y pulsa Buscar. */
async function buscar(telefono) {
  fireEvent.change(screen.getByLabelText(/teléfono del cliente/i), {
    target: { value: telefono },
  });
  fireEvent.click(screen.getByRole('button', { name: /buscar/i }));
}

describe('F8.4 — criterio 1: superficie del panel', () => {
  it('es un diálogo con el aria-label del plan', () => {
    montar(servicioOk());
    const dialogo = screen.getByRole('dialog', { name: 'Identificación del cliente' });
    expect(dialogo).toBeTruthy();
    expect(dialogo.getAttribute('aria-modal')).toBe('true');
  });

  it('tiene el input de teléfono y el botón de buscar con sus ids', () => {
    montar(servicioOk());
    expect(document.querySelector('#input-telefono-cliente')).toBeTruthy();
    expect(document.querySelector('#btn-buscar-cliente')).toBeTruthy();
  });

  it('arranca sin beneficios visibles', () => {
    montar(servicioOk());
    expect(screen.queryByText(/puntos/i)).toBeNull();
  });
});

describe('F8.4 — criterio 2: buscar identifica al cliente', () => {
  it('llama al servicio con el teléfono y los items del carrito', async () => {
    const servicioBeneficios = servicioOk();
    montar(servicioBeneficios);

    await buscar('5512345678');

    await waitFor(() => {
      expect(servicioBeneficios.obtenerBeneficios).toHaveBeenCalledWith({
        telefono: '5512345678',
        items: [{ product_id: 'p-1', quantity: 2 }],
      });
    });
  });

  it('muestra el nombre y el nivel del cliente identificado', async () => {
    montar(servicioOk());

    await buscar('5512345678');

    await waitFor(() => {
      expect(screen.getByText('Ana')).toBeTruthy();
      expect(screen.getByText(/nivel oro/i)).toBeTruthy();
    });
  });

  it('muestra los puntos disponibles que devuelve el CRM', async () => {
    montar(servicioOk());

    await buscar('5512345678');

    await waitFor(() => {
      expect(screen.getByText('340')).toBeTruthy();
    });
  });

  it('notifica al padre con el cliente y los beneficios (onIdentificado)', async () => {
    const onIdentificado = vi.fn();
    montar(servicioOk(), { onIdentificado });

    await buscar('5512345678');

    await waitFor(() => {
      expect(onIdentificado).toHaveBeenCalledTimes(1);
    });
    const [cliente, beneficios] = onIdentificado.mock.calls[0];
    expect(cliente.customer_id).toBe('c-1');
    expect(beneficios.puntos_disponibles).toBe(340);
  });
});

describe('F8.4 — criterio 3: el POS solo muestra, no calcula (RN-83)', () => {
  it('muestra el descuento tal cual lo devuelve el CRM', async () => {
    montar(servicioOk());

    await buscar('5512345678');

    await waitFor(() => {
      expect(screen.getByText('10%')).toBeTruthy();
    });
  });

  it('muestra el aviso de "sin descuentos" cuando el CRM no devuelve ninguno', async () => {
    montar(servicioOk(beneficiosEjemplo({ descuentos: [] })));

    await buscar('5512345678');

    await waitFor(() => {
      expect(screen.getByText(/sin descuentos aplicables/i)).toBeTruthy();
    });
  });
});

describe('F8.4 — criterio 4: cliente nuevo no bloquea (RN-82)', () => {
  it('avisa que no se encontró al cliente', async () => {
    montar(servicioSinCliente());

    await buscar('5500000000');

    await waitFor(() => {
      expect(screen.getByText(/no se encontró un cliente/i)).toBeTruthy();
    });
  });

  it('NO llama a onIdentificado cuando no hay cliente', async () => {
    const onIdentificado = vi.fn();
    montar(servicioSinCliente(), { onIdentificado });

    await buscar('5500000000');

    await waitFor(() => {
      expect(screen.getByText(/no se encontró un cliente/i)).toBeTruthy();
    });
    expect(onIdentificado).not.toHaveBeenCalled();
  });
});

describe('F8.4 — criterio 5: degradación DT-07 (RN-87)', () => {
  it('muestra un aviso cuando el CRM está caído', async () => {
    montar(servicioQueFalla('crm_no_disponible'));

    await buscar('5512345678');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText(/no está disponible/i)).toBeTruthy();
    });
  });

  it('el aviso recuerda que se puede cobrar a precio de lista', async () => {
    montar(servicioQueFalla('crm_no_disponible'));

    await buscar('5512345678');

    await waitFor(() => {
      expect(screen.getByText(/precio de lista/i)).toBeTruthy();
    });
  });

  it('el panel sigue permitiendo cerrar aunque el CRM falle', async () => {
    const onCerrar = vi.fn();
    montar(servicioQueFalla('crm_no_disponible'), { onCerrar });

    await buscar('5512345678');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });
});

describe('F8.4 — criterio 6: cerrar', () => {
  it('el botón "Cerrar" invoca onCerrar', () => {
    const onCerrar = vi.fn();
    montar(servicioOk(), { onCerrar });

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  it('el botón "Listo" del pie también invoca onCerrar', () => {
    const onCerrar = vi.fn();
    montar(servicioOk(), { onCerrar });

    fireEvent.click(screen.getByRole('button', { name: /listo/i }));

    expect(onCerrar).toHaveBeenCalledTimes(1);
  });
});

describe('F8.4 — criterio 7: inyectable', () => {
  it('usa el servicio inyectado y no el real', async () => {
    const servicioBeneficios = servicioOk();
    montar(servicioBeneficios);

    await buscar('5512345678');

    await waitFor(() => {
      expect(servicioBeneficios.obtenerBeneficios).toHaveBeenCalledTimes(1);
    });
  });

  it('no llama al servicio si el teléfono está vacío', async () => {
    const servicioBeneficios = servicioOk();
    montar(servicioBeneficios);

    fireEvent.click(screen.getByRole('button', { name: /buscar/i }));

    await waitFor(() => {
      expect(screen.getByText(/escribe el teléfono/i)).toBeTruthy();
    });
    expect(servicioBeneficios.obtenerBeneficios).not.toHaveBeenCalled();
  });
});
