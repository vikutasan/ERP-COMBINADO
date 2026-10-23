/**
 * Puerta de FASE 9.1.5 — Layout de cobro heredado del viejo POS.
 *
 * Verifica los 11 criterios de la ficha (§5). Monta el componente REAL
 * (`CheckoutScreen` + `useCheckout`), sin mocks de dinero, para blindar que la
 * corrección de layout NO tocó la lógica de dinero.
 *
 *   1. Existen 4 métodos: Efectivo, Débito, Crédito, Transferencia.
 *   2. NO existe un botón QR (criterio negativo).
 *   3. Elegir "Débito" envía `metodo: 'DEBITO'` al confirmar.
 *   4. Elegir "Crédito" envía `metodo: 'CREDITO'` al confirmar.
 *   5. Transferencia sigue disponible y envía `TRANSFERENCIA`.
 *   6. El botón "Agregar pago" está a la DERECHA del teclado.
 *   7. El botón "Agregar pago" es grande (target táctil ≥ 44px).
 *   8. Al abonar, el pago aparece en el panel DERECHO.
 *   9. NO hay resumen duplicado de abonos en la izquierda.
 *  10. El resumen de totales (abonado/faltante/cambio) vive en la derecha.
 *  11. La lógica de dinero se conserva (acotamiento + redondeo).
 *
 * @see FICHA_F9_1_5_LAYOUT_COBRO_HEREDADO.md §5
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import CheckoutScreen from './CheckoutScreen.jsx';

afterEach(() => {
  cleanup();
});

/** Monta el checkout con un total y espías de confirmación/cancelación. */
function montar(total = 100) {
  const onConfirmar = vi.fn();
  const onCancelar = vi.fn();
  render(
    <CheckoutScreen
      total={total}
      onConfirmar={onConfirmar}
      onCancelar={onCancelar}
      procesando={false}
      error={null}
    />
  );
  return { onConfirmar, onCancelar };
}

/** Devuelve el input de captura del monto (etiqueta según el método). */
function inputMonto() {
  return (
    screen.queryByLabelText('Efectivo recibido') ||
    screen.getByLabelText('Monto a cobrar')
  );
}

/** Captura el input de monto y le escribe un valor. */
function escribirMonto(valor) {
  fireEvent.change(inputMonto(), { target: { value: String(valor) } });
}

/** Selecciona un método de pago por su etiqueta visible. */
function elegirMetodo(etiqueta) {
  fireEvent.click(screen.getByText(etiqueta));
}

/** Localiza el botón "Agregar pago" (su etiqueta incluye el método). */
function botonAgregarPago() {
  return screen.getByRole('button', { name: /Agregar pago/ });
}

/** Agrega un abono con el método ya seleccionado. */
function agregarAbono(monto) {
  escribirMonto(monto);
  fireEvent.click(botonAgregarPago());
}

// ---------------------------------------------------------------------------
// 1. Los 4 métodos de primer nivel (sin QR)
// ---------------------------------------------------------------------------

describe('F9.1.5 — criterio 1: los 4 métodos de pago', () => {
  it('renderiza Efectivo, Débito, Crédito y Transferencia', () => {
    montar(100);
    expect(screen.getByText('Efectivo')).toBeTruthy();
    expect(screen.getByText('Débito')).toBeTruthy();
    expect(screen.getByText('Crédito')).toBeTruthy();
    expect(screen.getByText('Transferencia')).toBeTruthy();
  });

  it('NO existe el método "Tarjeta" como botón de primer nivel', () => {
    montar(100);
    expect(screen.queryByText('Tarjeta')).toBeNull();
  });
});

describe('F9.1.5 — criterio 2: NO existe QR (criterio negativo)', () => {
  it('no renderiza ningún botón QR', () => {
    montar(100);
    expect(screen.queryByText('QR')).toBeNull();
    expect(screen.queryByText(/QR/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3-5. El método elegido viaja al payload de confirmación
// ---------------------------------------------------------------------------

describe('F9.1.5 — criterios 3-5: el método elegido viaja al payload', () => {
  it('criterio 3: "Débito" envía metodo: DEBITO', () => {
    const { onConfirmar } = montar(100);
    elegirMetodo('Débito');
    fireEvent.click(screen.getByRole('button', { name: /CONFIRMAR PAGO/ }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    expect(onConfirmar.mock.calls[0][0].metodo).toBe('DEBITO');
  });

  it('criterio 4: "Crédito" envía metodo: CREDITO', () => {
    const { onConfirmar } = montar(100);
    elegirMetodo('Crédito');
    fireEvent.click(screen.getByRole('button', { name: /CONFIRMAR PAGO/ }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    expect(onConfirmar.mock.calls[0][0].metodo).toBe('CREDITO');
  });

  it('criterio 5: "Transferencia" sigue disponible y envía TRANSFERENCIA', () => {
    const { onConfirmar } = montar(100);
    elegirMetodo('Transferencia');
    fireEvent.click(screen.getByRole('button', { name: /CONFIRMAR PAGO/ }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    expect(onConfirmar.mock.calls[0][0].metodo).toBe('TRANSFERENCIA');
  });
});

// ---------------------------------------------------------------------------
// 6-7. Ergonomía del botón "Agregar pago"
// ---------------------------------------------------------------------------

describe('F9.1.5 — criterios 6-7: ergonomía del botón "Agregar pago"', () => {
  it('criterio 6: el botón está a la DERECHA del teclado (mismo contenedor flex)', () => {
    montar(100);
    const boton = botonAgregarPago();
    // El botón comparte padre con el contenedor del teclado y va DESPUÉS.
    const fila = boton.parentElement;
    expect(fila.className).toContain('flex');
    const hijos = Array.from(fila.children);
    const indiceBoton = hijos.indexOf(boton);
    expect(indiceBoton).toBeGreaterThan(0);
    // El hermano anterior es el contenedor del teclado (flex-grow).
    const contenedorTeclado = hijos[indiceBoton - 1];
    expect(contenedorTeclado.className).toContain('flex-grow');
  });

  it('criterio 7: el botón es grande (target táctil ≥ 44px)', () => {
    montar(100);
    const boton = botonAgregarPago();
    expect(boton.className).toContain('min-h-tactil');
    expect(boton.className).toContain('w-24');
  });
});

// ---------------------------------------------------------------------------
// 8-10. Los pagos y el resumen viven en el panel DERECHO
// ---------------------------------------------------------------------------

describe('F9.1.5 — criterios 8-10: pagos y resumen en el panel derecho', () => {
  it('criterio 8: al abonar, el pago aparece en el panel DERECHO', () => {
    montar(100);
    agregarAbono(40);
    const lista = screen.getByLabelText('Abonos agregados');
    // La lista de abonos vive en la columna lateral (lg:w-1/3), no en la
    // columna principal de captura.
    const columnaDerecha = lista.closest('.lg\\:w-1\\/3');
    expect(columnaDerecha).toBeTruthy();
    expect(lista.querySelectorAll('li')).toHaveLength(1);
    expect(lista.textContent).toContain('Efectivo');
  });

  it('criterio 9: NO hay resumen duplicado de abonos en la izquierda', () => {
    montar(100);
    agregarAbono(40);
    // Solo existe UNA lista de abonos en todo el documento.
    const listas = screen.getAllByLabelText('Abonos agregados');
    expect(listas).toHaveLength(1);
    // La columna principal (captura) NO contiene la lista de abonos.
    const columnaPrincipal = screen
      .getByRole('dialog')
      .querySelector('.flex-1');
    expect(columnaPrincipal.querySelector('[aria-label="Abonos agregados"]')).toBeNull();
  });

  it('criterio 10: el resumen de totales vive en la derecha', () => {
    montar(100);
    agregarAbono(40);
    const abonado = screen.getByText('Abonado');
    const faltante = screen.getByText('Faltante');
    const columnaDerecha = abonado.closest('.lg\\:w-1\\/3');
    expect(columnaDerecha).toBeTruthy();
    expect(columnaDerecha.contains(faltante)).toBe(true);
    // El faltante de $60 se muestra en el resumen derecho.
    expect(screen.getByText('$60.00')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 11. La lógica de dinero se conserva (regresión)
// ---------------------------------------------------------------------------

describe('F9.1.5 — criterio 11: la lógica de dinero se conserva', () => {
  it('acota un abono MAYOR al pendiente (no cobra de más)', () => {
    montar(100);
    // El cliente entrega $150 sobre un total de $100: se aplica $100.
    agregarAbono(150);
    const lista = screen.getByLabelText('Abonos agregados');
    expect(lista.textContent).toContain('$100.00');
    // El faltante llega a cero (cuadra).
    expect(screen.getByText('$0.00')).toBeTruthy();
  });

  it('redondea el total con error de coma flotante (DT-02)', () => {
    const { onConfirmar } = montar(99.99000000000001);
    elegirMetodo('Débito');
    fireEvent.click(screen.getByRole('button', { name: /CONFIRMAR PAGO/ }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    // El monto cruza la frontera redondeado a 2 decimales.
    expect(onConfirmar.mock.calls[0][0].monto).toBe(99.99);
  });

  it('el pago único en efectivo calcula el cambio correctamente', () => {
    const { onConfirmar } = montar(100);
    escribirMonto(150);
    fireEvent.click(screen.getByRole('button', { name: /CONFIRMAR PAGO/ }));
    const payload = onConfirmar.mock.calls[0][0];
    expect(payload.metodo).toBe('EFECTIVO');
    expect(payload.monto).toBe(100);
    expect(payload.recibido).toBe(150);
    expect(payload.cambio).toBe(50);
  });
});
