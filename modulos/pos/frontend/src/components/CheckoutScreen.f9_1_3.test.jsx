/**
 * Puerta de FASE 9.1.3 — UI de pagos mixtos (`CheckoutScreen`).
 *
 * Verifica los criterios del plan (§3.4):
 *   1. Agregar 2 pagos (efectivo + tarjeta) y ver el FALTANTE en vivo.
 *   2. Editar un abono antes de confirmar.
 *   3. Borrar un abono antes de confirmar.
 *   4. Confirmar habilitado SOLO cuando la suma cuadra.
 *   5. El caso de UN solo pago sigue funcionando idéntico (REGRESIÓN).
 *   6. Se conserva el `TecladoNumerico` de F9.0.2.
 *
 * @see PLAN_DE_ABORDAJE_FASE_9_1_PAGOS_MIXTOS.md §3.4
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

/**
 * Devuelve el input de captura del monto.
 *
 * FIX "cobro parcial": la captura es ÚNICA. En efectivo la etiqueta es
 * "Efectivo recibido"; en tarjeta/transferencia es "Monto a cobrar". El
 * teclado numérico y el input nativo escriben el MISMO campo.
 *
 * El helper es agnóstico al método: busca la etiqueta de efectivo y, si no
 * existe (porque el método cambió), cae a la de tarjeta/transferencia.
 */
function inputMonto() {
  return (
    screen.queryByLabelText('Efectivo recibido') ||
    screen.getByLabelText('Monto a cobrar')
  );
}

/** Devuelve el input de captura cuando el método NO es efectivo. */
function inputMontoNoEfectivo() {
  return screen.getByLabelText('Monto a cobrar');
}

/** Captura el input de monto y le escribe un valor. */
function escribirMonto(valor) {
  fireEvent.change(inputMonto(), { target: { value: String(valor) } });
}

/**
 * Selecciona un método de pago por su etiqueta visible.
 *
 * F9.1.5.0 — la tarjeta se desdobla en Débito y Crédito (sin QR). Los tests
 * históricos llaman `elegirMetodo('Tarjeta')`; se mapea a "Débito" para no
 * tocar cada llamada (el comportamiento verificado — cobro con tarjeta — es el
 * mismo: se envía `metodo: 'DEBITO'`).
 */
function elegirMetodo(etiqueta) {
  const visible = etiqueta === 'Tarjeta' ? 'Débito' : etiqueta;
  fireEvent.click(screen.getByText(visible));
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
// 1. Agregar pagos y ver el faltante
// ---------------------------------------------------------------------------

describe('F9.1.3 — agregar pagos y ver el faltante', () => {
  it('agrega un abono de efectivo y muestra el faltante', () => {
    montar(100);
    agregarAbono(40);
    // El abono aparece en la lista (se busca dentro de la lista para no
    // confundirlo con el botón de método "Efectivo").
    const lista = screen.getByLabelText('Abonos agregados');
    expect(lista.querySelectorAll('li')).toHaveLength(1);
    expect(lista.textContent).toContain('Efectivo');
    // El resumen muestra el faltante de $60.
    expect(screen.getByText('Faltante')).toBeTruthy();
    expect(screen.getByText('$60.00')).toBeTruthy();
  });

  it('agrega un segundo abono (tarjeta) y el faltante llega a cero', () => {
    montar(100);
    agregarAbono(40);
    elegirMetodo('Tarjeta');
    agregarAbono(60);
    // Dos abonos en la lista.
    const lista = screen.getByLabelText('Abonos agregados');
    expect(lista.querySelectorAll('li')).toHaveLength(2);
    // Faltante en cero.
    expect(screen.getByText('$0.00')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Editar un abono
// ---------------------------------------------------------------------------

describe('F9.1.3 — editar un abono', () => {
  it('edita el monto de un abono y recalcula el faltante', () => {
    montar(100);
    agregarAbono(40);
    fireEvent.click(screen.getByText('Editar'));
    // El formulario entra en modo edición.
    escribirMonto(100);
    fireEvent.click(screen.getByText('Guardar abono'));
    // Ya cuadra: el faltante es cero.
    expect(screen.getByText('$0.00')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. Borrar un abono
// ---------------------------------------------------------------------------

describe('F9.1.3 — borrar un abono', () => {
  it('borra un abono y vuelve a mostrar el faltante', () => {
    montar(100);
    agregarAbono(100);
    // Con un abono que cubre el total, el faltante es cero.
    expect(screen.getByText('$0.00')).toBeTruthy();
    fireEvent.click(screen.getByText('Borrar'));
    // Sin abonos, vuelve el mensaje de "sin abonos".
    expect(screen.getByText(/Sin abonos/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. Confirmar habilitado solo cuando cuadra
// ---------------------------------------------------------------------------

describe('F9.1.3 — confirmar solo cuando cuadra', () => {
  it('el botón está deshabilitado con faltante y se habilita al cuadrar', () => {
    montar(100);
    agregarAbono(40);
    const boton = screen.getByText('CONFIRMAR PAGO');
    expect(boton.disabled).toBe(true);
    agregarAbono(60);
    expect(screen.getByText('CONFIRMAR PAGO').disabled).toBe(false);
  });

  it('al confirmar con abonos envía la lista de abonos', () => {
    const { onConfirmar } = montar(100);
    agregarAbono(40);
    elegirMetodo('Tarjeta');
    agregarAbono(60);
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    const payload = onConfirmar.mock.calls[0][0];
    expect(Array.isArray(payload.abonos)).toBe(true);
    expect(payload.abonos).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Regresión: un solo pago
// ---------------------------------------------------------------------------

describe('F9.1.3 — regresión: un solo pago', () => {
  it('sin abonos, confirma el pago único con el método seleccionado', () => {
    const { onConfirmar } = montar(100);
    // Efectivo recibido = 100 (cubre el total).
    escribirMonto(100);
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    const payload = onConfirmar.mock.calls[0][0];
    expect(payload.metodo).toBe('EFECTIVO');
    expect(payload.recibido).toBe(100);
    expect(payload.abonos).toBeUndefined();
  });

  it('en efectivo con recibido menor al total, el botón está deshabilitado', () => {
    montar(100);
    escribirMonto(50);
    expect(screen.getByText('CONFIRMAR PAGO').disabled).toBe(true);
  });

  it('con tarjeta (sin abonos) se puede cobrar el total exacto', () => {
    const { onConfirmar } = montar(100);
    elegirMetodo('Tarjeta');
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    const payload = onConfirmar.mock.calls[0][0];
    expect(payload.metodo).toBe('DEBITO');
    expect(payload.recibido).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 6. Se conserva el TecladoNumerico (F9.0.2)
// ---------------------------------------------------------------------------

describe('F9.1.3 — se conserva el teclado numérico', () => {
  it('el teclado táctil sigue presente en el modo efectivo', () => {
    montar(100);
    // El teclado expone teclas numéricas (1..9) y el 0.
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 7. FIX "cobro parcial" — regresión de los dos defectos reportados
// ---------------------------------------------------------------------------

describe('FIX cobro parcial — D1: el abono parcial en efectivo es descubrible', () => {
  it('el botón "Agregar pago" está visible y habilitado tras capturar un monto', () => {
    montar(100);
    const boton = botonAgregarPago();
    // Sin monto capturado, el botón está deshabilitado (no hay nada que abonar).
    expect(boton.disabled).toBe(true);
    // Al capturar un monto parcial, se habilita.
    escribirMonto(40);
    expect(botonAgregarPago().disabled).toBe(false);
  });

  it('permite abonar un pago parcial en efectivo y muestra el faltante', () => {
    montar(100);
    // Abono parcial de $40 en efectivo (el resto queda pendiente).
    agregarAbono(40);
    const lista = screen.getByLabelText('Abonos agregados');
    expect(lista.querySelectorAll('li')).toHaveLength(1);
    expect(lista.textContent).toContain('Efectivo');
    expect(screen.getByText('$60.00')).toBeTruthy();
  });
});

describe('FIX cobro parcial — D2: el teclado NO desaparece al elegir tarjeta', () => {
  it('el teclado numérico sigue visible con el método Tarjeta', () => {
    montar(100);
    elegirMetodo('Tarjeta');
    // El teclado debe seguir montado (antes desaparecía con `esEfectivo`).
    expect(screen.getByRole('group', { name: 'Teclado numérico de efectivo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '7' })).toBeTruthy();
  });

  it('permite teclear el monto del abono con tarjeta usando el teclado', () => {
    montar(100);
    elegirMetodo('Tarjeta');
    // Teclea "60" con el teclado en pantalla.
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    fireEvent.click(screen.getByRole('button', { name: '0' }));
    // El input de captura (etiqueta "Monto a cobrar") refleja lo tecleado.
    expect(inputMontoNoEfectivo().value).toBe('60');
    // Y se puede agregar como abono de tarjeta.
    fireEvent.click(botonAgregarPago());
    const lista = screen.getByLabelText('Abonos agregados');
    expect(lista.querySelectorAll('li')).toHaveLength(1);
    // F9.1.5.0 — el abono de tarjeta se etiqueta "Débito".
    expect(lista.textContent).toContain('Débito');
  });

  it('permite un pago mixto: efectivo parcial + tarjeta parcial', () => {
    montar(100);
    // 1) Abono parcial en efectivo.
    agregarAbono(40);
    // 2) Cambia a tarjeta y abona el resto con el teclado.
    elegirMetodo('Tarjeta');
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    fireEvent.click(screen.getByRole('button', { name: '0' }));
    fireEvent.click(botonAgregarPago());
    // Dos abonos y el faltante en cero.
    const lista = screen.getByLabelText('Abonos agregados');
    expect(lista.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByText('$0.00')).toBeTruthy();
    expect(screen.getByText('CONFIRMAR PAGO').disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. FIX "confirmar pago no hace nada" — el motivo del bloqueo es visible
//    JUNTO al botón CONFIRMAR PAGO (no solo en la columna izquierda).
// ---------------------------------------------------------------------------

describe('FIX "confirmar pago no hace nada" — el bloqueo se explica junto al botón', () => {
  it('con abonos que NO cuadran, muestra el faltante junto al botón y lo deshabilita', () => {
    montar(100);
    agregarAbono(40);
    // El botón está deshabilitado (no se puede cobrar con faltante).
    expect(screen.getByText('CONFIRMAR PAGO').disabled).toBe(true);
    // Y el motivo aparece en un `role="status"` junto al botón (columna derecha).
    const avisos = screen.getAllByRole('status');
    const texto = avisos.map((n) => n.textContent).join(' ');
    expect(texto).toMatch(/Faltan/);
    expect(texto).toMatch(/\$60\.00/);
  });

  it('al cuadrar el total, el aviso desaparece y el botón se habilita', () => {
    montar(100);
    agregarAbono(40);
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    agregarAbono(60);
    // Ya no hay motivo de bloqueo: ningún `role="status"` con "Faltan".
    const avisos = screen.queryAllByRole('status');
    const texto = avisos.map((n) => n.textContent).join(' ');
    expect(texto).not.toMatch(/Faltan/);
    expect(screen.getByText('CONFIRMAR PAGO').disabled).toBe(false);
  });

  it('en efectivo sin abonos y con recibido insuficiente, explica el faltante junto al botón', () => {
    montar(100);
    escribirMonto(50);
    expect(screen.getByText('CONFIRMAR PAGO').disabled).toBe(true);
    const avisos = screen.getAllByRole('status');
    const texto = avisos.map((n) => n.textContent).join(' ');
    expect(texto).toMatch(/Faltan/);
    expect(texto).toMatch(/\$50\.00/);
  });

  it('mientras procesa, no muestra motivo de bloqueo (el botón dice "Procesando…")', () => {
    const onConfirmar = vi.fn();
    render(
      <CheckoutScreen
        total={100}
        onConfirmar={onConfirmar}
        onCancelar={vi.fn()}
        procesando={true}
        error={null}
      />
    );
    expect(screen.getByText('Procesando…')).toBeTruthy();
    const avisos = screen.queryAllByRole('status');
    const texto = avisos.map((n) => n.textContent).join(' ');
    expect(texto).not.toMatch(/Faltan/);
  });
});

// ---------------------------------------------------------------------------
// 9. FIX "suma_no_cuadra" — el vuelto (monto capturado > pendiente) NO rompe
//    el cobro. El abono aplica solo lo que falta y el excedente es cambio.
// ---------------------------------------------------------------------------

describe('FIX "suma_no_cuadra" — el vuelto no rompe el cobro', () => {
  it('con abonos: capturar MÁS que el pendiente aplica solo el pendiente y cuadra', () => {
    const { onConfirmar } = montar(100);
    // El cajero teclea $150 para un total de $100 (prueba del cambio).
    agregarAbono(150);
    // El abono aplicado es $100 (no $150): el faltante queda en cero.
    expect(screen.getByText('$0.00')).toBeTruthy();
    // El botón se habilita (antes quedaba muerto por `suma_no_cuadra`).
    expect(screen.getByText('CONFIRMAR PAGO').disabled).toBe(false);
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    const payload = onConfirmar.mock.calls[0][0];
    expect(payload.abonos).toHaveLength(1);
    // El abono aplica $100 y conserva los $150 recibidos (vuelto $50).
    expect(Number(payload.abonos[0].monto)).toBe(100);
    expect(Number(payload.abonos[0].recibido)).toBe(150);
  });

  it('con abonos: el vuelto se calcula como recibido − aplicado', () => {
    const { onConfirmar } = montar(100);
    agregarAbono(150);
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    const abono = onConfirmar.mock.calls[0][0].abonos[0];
    // El servicio canónico calcula el cambio al construir el payload.
    expect(Number(abono.monto)).toBe(100);
    expect(Number(abono.recibido)).toBe(150);
  });

  it('con abonos: un monto MENOR al pendiente se aplica tal cual (sin regresión)', () => {
    montar(100);
    agregarAbono(40);
    // Sigue faltando $60 (el abono parcial no se toca).
    expect(screen.getByText('$60.00')).toBeTruthy();
  });

  it('con abonos mixtos: efectivo con vuelto + tarjeta cuadran el total', () => {
    const { onConfirmar } = montar(100);
    // Efectivo $60 (aplica $60) y tarjeta $40 → cuadra exacto.
    agregarAbono(60);
    elegirMetodo('Tarjeta');
    agregarAbono(40);
    expect(screen.getByText('$0.00')).toBeTruthy();
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    const abonos = onConfirmar.mock.calls[0][0].abonos;
    expect(abonos).toHaveLength(2);
    const suma = abonos.reduce((acc, a) => acc + Number(a.monto), 0);
    expect(suma).toBe(100);
  });

  it('al editar un abono con vuelto, también aplica solo el pendiente', () => {
    const { onConfirmar } = montar(100);
    agregarAbono(40);
    // Edita el abono a $150 (más que el total): debe aplicar $100.
    fireEvent.click(screen.getByText('Editar'));
    escribirMonto(150);
    fireEvent.click(screen.getByText('Guardar abono'));
    expect(screen.getByText('$0.00')).toBeTruthy();
    expect(screen.getByText('CONFIRMAR PAGO').disabled).toBe(false);
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    const abono = onConfirmar.mock.calls[0][0].abonos[0];
    expect(Number(abono.monto)).toBe(100);
    expect(Number(abono.recibido)).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// 10. FIX "suma_no_cuadra" (3ª vuelta) — el PAGO ÚNICO (sin abonos) con vuelto
//     envía `monto` EXPLÍCITO = lo aplicado al total, no lo recibido.
//
//     Este es el path que el cajero usa de verdad: teclea el efectivo recibido
//     y pulsa CONFIRMAR PAGO sin agregar abonos. La sección 9 solo cubría el
//     path de abonos; aquí se blinda el path único, que era el que rompía con
//     `suma_no_cuadra` cuando el monto capturado superaba el total.
// ---------------------------------------------------------------------------

describe('FIX "suma_no_cuadra" (3ª vuelta) — pago único con vuelto', () => {
  it('efectivo con vuelto: monto = total, recibido = capturado, cambio = excedente', () => {
    const { onConfirmar } = montar(100);
    // El cajero teclea $150 para un total de $100 (prueba del cambio).
    escribirMonto(150);
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    const payload = onConfirmar.mock.calls[0][0];
    // El pago único NO usa `abonos`: manda la forma plana {metodo, monto, ...}.
    expect(payload.abonos).toBeUndefined();
    expect(payload.metodo).toBe('EFECTIVO');
    // `monto` es lo APLICADO al total (100), no lo recibido (150).
    expect(Number(payload.monto)).toBe(100);
    expect(Number(payload.recibido)).toBe(150);
    expect(Number(payload.cambio)).toBe(50);
  });

  it('efectivo exacto: monto = recibido = total y cambio 0', () => {
    const { onConfirmar } = montar(100);
    escribirMonto(100);
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    const payload = onConfirmar.mock.calls[0][0];
    expect(Number(payload.monto)).toBe(100);
    expect(Number(payload.recibido)).toBe(100);
    expect(Number(payload.cambio)).toBe(0);
  });

  it('tarjeta: monto = total, recibido = total y cambio 0 (sin captura)', () => {
    const { onConfirmar } = montar(100);
    elegirMetodo('Tarjeta');
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    const payload = onConfirmar.mock.calls[0][0];
    expect(payload.metodo).toBe('DEBITO');
    expect(Number(payload.monto)).toBe(100);
    expect(Number(payload.recibido)).toBe(100);
    expect(Number(payload.cambio)).toBe(0);
  });

  it('efectivo con vuelto: el botón se habilita (no queda muerto)', () => {
    montar(100);
    escribirMonto(150);
    // Con $150 capturados sobre $100, el cobro está permitido.
    expect(screen.getByText('CONFIRMAR PAGO').disabled).toBe(false);
  });

  it('efectivo insuficiente: el botón sigue bloqueado (sin regresión)', () => {
    montar(100);
    escribirMonto(40);
    // Con $40 sobre $100, falta cubrir el total: no se puede cobrar.
    expect(screen.getByText('CONFIRMAR PAGO').disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. FIX "suma_no_cuadra" (4ª VUELTA) — el TOTAL con error de coma flotante
//     (p. ej. `33.33 × 3 = 99.99000000000001`) NO debe romper el cobro.
//
//     CAUSA RAÍZ: `useCart.total` sumaba `unit_price × quantity` SIN redondear.
//     Ese total viajaba al `payment_details` y el backend compara con `Decimal`
//     EXACTO (RN-94, DT-02): `Decimal("99.99000000000001") != Decimal("99.99")`
//     → `suma_no_cuadra`. El path de abonos se salvaba porque `montoAplicado`
//     redondea el pendiente; el path de PAGO ÚNICO no redondeaba `monto`.
//     Ahora todo monto que cruza la frontera se redondea a 2 decimales.
// ---------------------------------------------------------------------------

describe('FIX "suma_no_cuadra" (4ª vuelta) — total con error de coma flotante', () => {
  // Total "sucio" tal como lo produce `33.33 × 3` en coma flotante.
  const TOTAL_FLOTANTE = 33.33 * 3; // 99.99000000000001

  it('el total flotante se redondea a 2 decimales en el resumen', () => {
    montar(TOTAL_FLOTANTE);
    // El resumen muestra $99.99 (no $99.99000000000001).
    expect(screen.getByText('$99.99')).toBeTruthy();
  });

  it('pago único en efectivo exacto: monto redondeado = 99.99 (no el float crudo)', () => {
    const { onConfirmar } = montar(TOTAL_FLOTANTE);
    escribirMonto(100); // el cliente entrega $100 por un total de $99.99
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    const payload = onConfirmar.mock.calls[0][0];
    // `monto` debe ser EXACTAMENTE 99.99 (2 decimales), no 99.99000000000001.
    expect(payload.monto).toBe(99.99);
    expect(payload.recibido).toBe(100);
    expect(payload.cambio).toBe(0.01);
  });

  it('pago único en efectivo con vuelto: monto redondeado y cambio exacto', () => {
    const { onConfirmar } = montar(TOTAL_FLOTANTE);
    escribirMonto(150);
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    const payload = onConfirmar.mock.calls[0][0];
    expect(payload.monto).toBe(99.99);
    expect(payload.recibido).toBe(150);
    expect(payload.cambio).toBe(50.01);
  });

  it('pago único con tarjeta: monto redondeado = 99.99', () => {
    const { onConfirmar } = montar(TOTAL_FLOTANTE);
    elegirMetodo('Tarjeta');
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    const payload = onConfirmar.mock.calls[0][0];
    expect(payload.monto).toBe(99.99);
    expect(payload.recibido).toBe(99.99);
    expect(payload.cambio).toBe(0);
  });

  it('con abonos: el monto aplicado se redondea a 2 decimales', () => {
    const { onConfirmar } = montar(TOTAL_FLOTANTE);
    // El cajero teclea $150: el abono aplica el pendiente redondeado (99.99).
    agregarAbono(150);
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    const abono = onConfirmar.mock.calls[0][0].abonos[0];
    expect(Number(abono.monto)).toBe(99.99);
    expect(Number(abono.recibido)).toBe(150);
  });

  it('con abonos: la suma de montos cuadra EXACTO el total redondeado', () => {
    const { onConfirmar } = montar(TOTAL_FLOTANTE);
    // Efectivo $50 + tarjeta $49.99 → 99.99 exacto.
    agregarAbono(50);
    elegirMetodo('Tarjeta');
    agregarAbono(49.99);
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    const abonos = onConfirmar.mock.calls[0][0].abonos;
    const suma = abonos.reduce((acc, a) => acc + Number(a.monto), 0);
    // Sin redondeo, la suma sería 99.99000000000001 y RN-94 la rechazaría.
    expect(Math.round(suma * 100) / 100).toBe(99.99);
  });
});

// ---------------------------------------------------------------------------
// 12. FIX "suma_no_cuadra" (6ª VUELTA) — el acotamiento al pendiente debe ser
//     UNIVERSAL (todos los métodos) y consistente entre ALTA y EDICIÓN.
//
//     CAUSA RAÍZ: `montoAplicado` solo acotaba EFECTIVO; TARJETA/TRANSFERENCIA
//     se registraban por el monto capturado tal cual. Un abono de tarjeta por
//     encima del pendiente (p. ej. $10 efectivo + $1000 tarjeta sobre un total
//     de $47) sumaba 1010 ≠ 47 → RN-94 → `suma_no_cuadra`. La EDICIÓN seguía
//     con la lógica vieja, reabriendo el bug por esa puerta.
// ---------------------------------------------------------------------------

describe('FIX "suma_no_cuadra" (6ª vuelta) — acotamiento universal al pendiente', () => {
  it('abono de TARJETA por encima del pendiente se acota al pendiente (no suma de más)', () => {
    const { onConfirmar } = montar(47);
    // Efectivo $10 (cubre parte) + tarjeta $1000 (excede el pendiente de $37).
    agregarAbono(10);
    elegirMetodo('Tarjeta');
    agregarAbono(1000);
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    const abonos = onConfirmar.mock.calls[0][0].abonos;
    const suma = abonos.reduce((acc, a) => acc + Number(a.monto), 0);
    // La tarjeta se acota a $37 → suma exacta 47 (antes: 1010 → suma_no_cuadra).
    expect(Math.round(suma * 100) / 100).toBe(47);
    expect(Number(abonos[1].monto)).toBe(37);
  });

  it('editar un abono de TARJETA a un monto mayor al pendiente lo acota (mismo criterio que el alta)', () => {
    const { onConfirmar } = montar(47);
    // Alta: efectivo $10 + tarjeta $37 (cuadra).
    agregarAbono(10);
    elegirMetodo('Tarjeta');
    agregarAbono(37);
    // Edición: se cambia la tarjeta a $1000 → debe acotarse al pendiente ($37).
    // Hay DOS abonos (efectivo $10 y tarjeta $37), cada uno con su botón "Editar";
    // se apunta al de la tarjeta por su aria-label para no caer en ambigüedad.
    fireEvent.click(screen.getByLabelText('Editar abono de $37.00'));
    escribirMonto(1000);
    fireEvent.click(screen.getByText('Guardar abono'));
    fireEvent.click(screen.getByText('CONFIRMAR PAGO'));
    const abonos = onConfirmar.mock.calls[0][0].abonos;
    const suma = abonos.reduce((acc, a) => acc + Number(a.monto), 0);
    expect(Math.round(suma * 100) / 100).toBe(47);
    expect(Number(abonos[1].monto)).toBe(37);
  });

  it('mixto efectivo+tarjeta con excedente en efectivo: el cambio refleja SOLO lo entregado', () => {
    montar(47);
    // Efectivo $50 (entrega $50, aplica $47) → cambio $3.
    agregarAbono(50);
    // El resumen muestra el cambio de $3 (no $0).
    expect(screen.getByText('$3.00')).toBeTruthy();
  });

  it('la lista muestra el desglose "Entregó … (Aplica: …)" cuando hay excedente en efectivo', () => {
    montar(47);
    agregarAbono(50);
    const lista = screen.getByLabelText('Abonos agregados');
    expect(lista.textContent).toContain('Entregó');
    expect(lista.textContent).toContain('Aplica');
  });
});
