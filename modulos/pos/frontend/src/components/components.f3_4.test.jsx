/**
 * Puerta de FASE 3.4 — Interfaz real (componentes).
 *
 * Verifica que los 5 componentes de la interfaz del POS existen, renderizan y
 * cumplen su contrato visible:
 *
 *   1. `POSHeader`      — estado de cuenta, tipo de venta, indicador de red.
 *   2. `SalesReceipt`   — edición de cantidad (teclado numérico, F12.23), banner
 *                         de estado, total.
 *   3. `CheckoutScreen` — efectivo/tarjeta, cambio, validación, error.
 *   4. `POSOverlays`    — OverlayExito / OverlayError / OverlayConfirmar.
 *   5. `RetailVisionPOS`— orquestador de hooks (no monolito).
 *
 * Reglas que se comprueban aquí (no en el backend):
 *   - R-01: los contenedores raíz son fluidos (`w-full`), sin ancho fijo.
 *   - R-04: los controles táctiles usan `min-h-tactil` / `min-w-tactil`.
 *   - Prohibición #2: el banner de estado es persistente (`role="alert"`).
 *   - Regla 19: el error de cobro NO cierra el modal (se muestra inline).
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

import POSHeader from './POSHeader.jsx';
import SalesReceipt, { calcularTotal } from './SalesReceipt.jsx';
import CheckoutScreen from './CheckoutScreen.jsx';
import { OverlayExito, OverlayError, OverlayConfirmar } from './POSOverlays.jsx';

afterEach(() => {
  cleanup();
});

/** Una línea de ticket de ejemplo. */
function lineaEjemplo(extra = {}) {
  return {
    item_id: 'item-1',
    product_id: 'prod-1',
    name: 'Concha de Vainilla',
    unit_price: 18.5,
    quantity: 2,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 1. POSHeader
// ---------------------------------------------------------------------------

describe('POSHeader — cabecera (estado, tipo de venta, red)', () => {
  it('renderiza la terminal activa y el botón "Cambiar Estación"', () => {
    render(<POSHeader terminalId="TERM-01" />);
    expect(screen.getByText('Terminal TERM-01')).toBeTruthy();
    expect(screen.getByText('Cambiar Estación')).toBeTruthy();
  });

  it('muestra el estado de la cuenta por defecto (Nueva Venta)', () => {
    render(<POSHeader terminalId="TERM-01" />);
    expect(screen.getByText('Nueva Venta')).toBeTruthy();
  });

  it('traduce los 3 estados de la cuenta a etiquetas humanas', () => {
    const { rerender } = render(<POSHeader terminalId="TERM-01" estado="COBRANDO" />);
    expect(screen.getByText('Cobrando…')).toBeTruthy();

    rerender(<POSHeader terminalId="TERM-01" estado="PAGADA" />);
    expect(screen.getByText('Venta Cobrada')).toBeTruthy();
  });

  it('muestra el tipo de venta (canal) cuando se le pasa', () => {
    render(<POSHeader terminalId="TERM-01" tipoVenta="PANADERIA" />);
    expect(screen.getByText('PANADERIA')).toBeTruthy();
  });

  it('refleja el indicador de red: etiqueta y semáforo (good vs down)', () => {
    // El contrato real del nuevo POS es `estadoRed`/`etiquetaRed`/`colorRed`
    // (semáforo de 3 colores), NO un booleano `enLinea`. La etiqueta la
    // pre-formatea el orquestador ("RED OK 9ms"); el header solo la pinta.
    const { rerender } = render(
      <POSHeader terminalId="TERM-01" estadoRed="good" etiquetaRed="RED OK" colorRed="green" />,
    );
    expect(screen.getByText('RED OK')).toBeTruthy();

    rerender(
      <POSHeader terminalId="TERM-01" estadoRed="down" etiquetaRed="SIN RED" colorRed="red" />,
    );
    expect(screen.getByText('SIN RED')).toBeTruthy();
  });

  it('refleja el estado de la caja: turno activo vs habilitar (F12.8)', () => {
    // El header no pinta un texto de "sesión"; pinta el estado del TURNO DE
    // CAJA real (`turnoCaja`), que es la única fuente de verdad (F12.8).
    const { rerender } = render(<POSHeader terminalId="TERM-01" turnoCaja={{ id: 'c1' }} />);
    expect(screen.getByText('● Activa')).toBeTruthy();

    rerender(<POSHeader terminalId="TERM-01" turnoCaja={null} />);
    expect(screen.getByText('○ Habilitar')).toBeTruthy();
  });

  it('dispara onCambiarEstacion al pulsar el botón de terminal', () => {
    const onCambiarEstacion = vi.fn();
    render(<POSHeader terminalId="TERM-01" onCambiarEstacion={onCambiarEstacion} />);
    fireEvent.click(screen.getByText('Cambiar Estación'));
    expect(onCambiarEstacion).toHaveBeenCalledTimes(1);
  });

  it('R-01: el contenedor raíz es fluido (w-full) y sin ancho fijo', () => {
    const { container } = render(<POSHeader terminalId="TERM-01" />);
    const header = container.querySelector('header');
    expect(header.className).toContain('w-full');
    expect(header.className).not.toMatch(/w-\[\d+px\]/);
  });
});

// ---------------------------------------------------------------------------
// 2. SalesReceipt
// ---------------------------------------------------------------------------

describe('SalesReceipt — ticket (cantidad, banner, total)', () => {
  it('muestra el ticket vacío cuando no hay líneas', () => {
    render(<SalesReceipt lineas={[]} />);
    expect(screen.getByText(/El ticket esta vacio/)).toBeTruthy();
  });

  it('renderiza las líneas con nombre, cantidad e importe', () => {
    render(<SalesReceipt lineas={[lineaEjemplo()]} />);
    expect(screen.getByText('Concha de Vainilla')).toBeTruthy();
    expect(screen.getByText('2x')).toBeTruthy();
    // 18.50 * 2 = 37.00
    expect(screen.getAllByText('$37.00').length).toBeGreaterThanOrEqual(1);
  });

  // F12.23 — PARIDAD DE UX DE CANTIDAD (§6.8): el viejo POS editaba la cantidad
  // con un TECLADO NUMÉRICO en pantalla, no con botones −/+. La cantidad ahora
  // es un BOTÓN que abre ese teclado. Se actualizó esta compuerta de F3.4 para
  // reflejar la operación heredada (antes exigía los botones −/+ laterales).
  it('F12.23: la cantidad es un botón que abre el teclado numérico', () => {
    const onCambiarCantidad = vi.fn();
    render(
      <SalesReceipt
        lineas={[lineaEjemplo()]}
        onCambiarCantidad={onCambiarCantidad}
      />,
    );

    // Pulsar la cantidad abre el modal (role="dialog").
    fireEvent.click(screen.getByLabelText('Modificar cantidad de Concha de Vainilla'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Modificar Cantidad')).toBeTruthy();

    // Teclear "5" y confirmar con OK → onCambiarCantidad(linea, 5).
    // Se acota al teclado (role="group") porque el visor también muestra "5".
    // La línea de ejemplo tiene quantity: 2, así que primero se limpia con "C".
    const teclado = screen.getByRole('group', { name: /Teclado numérico/ });
    fireEvent.click(within(teclado).getByRole('button', { name: 'Borrar' }));
    fireEvent.click(within(teclado).getByRole('button', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onCambiarCantidad).toHaveBeenCalledTimes(1);
    expect(onCambiarCantidad.mock.calls[0][1]).toBe(5);
  });

  it('F12.23: el botón de cantidad respeta el target táctil (R-04)', () => {
    render(<SalesReceipt lineas={[lineaEjemplo()]} onCambiarCantidad={() => {}} />);
    const botonCantidad = screen.getByLabelText('Modificar cantidad de Concha de Vainilla');
    expect(botonCantidad.className).toContain('min-h-tactil');
    expect(botonCantidad.className).toContain('min-w-tactil');
  });

  it('F3.4: muestra el banner de estado persistente (role="alert")', () => {
    render(
      <SalesReceipt
        lineas={[lineaEjemplo()]}
        banner={{ tipo: 'error', mensaje: 'No se pudo guardar la línea' }}
      />,
    );
    const alerta = screen.getByRole('alert');
    expect(alerta.textContent).toContain('No se pudo guardar la línea');
  });

  it('no muestra banner cuando no se le pasa', () => {
    render(<SalesReceipt lineas={[lineaEjemplo()]} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('deshabilita COBRAR cuando el ticket está vacío', () => {
    render(<SalesReceipt lineas={[]} onCobrar={() => {}} />);
    const boton = screen.getByRole('button', { name: /ENVIAR CUENTA/ });
    expect(boton.disabled).toBe(true);
  });

  it('dispara onCobrar al pulsar COBRAR cuando hay líneas y caja habilitada', () => {
    // F12.9 — COBRAR y ENVIAR CUENTA son DOS operaciones distintas (16ª
    // instancia de §10.6). El botón COBRAR dispara `onCobrar`, pero solo
    // cuando la caja está habilitada (F12.8): sin turno, el botón va disabled.
    const onCobrar = vi.fn();
    render(
      <SalesReceipt lineas={[lineaEjemplo()]} onCobrar={onCobrar} cajaHabilitada />,
    );
    fireEvent.click(screen.getByRole('button', { name: /COBRAR/ }));
    expect(onCobrar).toHaveBeenCalledTimes(1);
  });

  it('dispara onEnviarCuenta al pulsar ENVIAR CUENTA (F12.9)', () => {
    // F12.9 — ENVIAR CUENTA NO dispara `onCobrar`; dispara `onEnviarCuenta`.
    // Esta es la operación que el viejo POS permitía SIN caja habilitada.
    const onCobrar = vi.fn();
    const onEnviarCuenta = vi.fn();
    render(
      <SalesReceipt
        lineas={[lineaEjemplo()]}
        onCobrar={onCobrar}
        onEnviarCuenta={onEnviarCuenta}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ENVIAR CUENTA/ }));
    expect(onEnviarCuenta).toHaveBeenCalledTimes(1);
    expect(onCobrar).not.toHaveBeenCalled();
  });

  it('calcularTotal suma unit_price × quantity (RN-16)', () => {
    const total = calcularTotal([
      lineaEjemplo({ unit_price: 10, quantity: 3 }),
      lineaEjemplo({ item_id: 'item-2', unit_price: 5.5, quantity: 2 }),
    ]);
    expect(total).toBe(41);
  });
});

// ---------------------------------------------------------------------------
// 3. CheckoutScreen
// ---------------------------------------------------------------------------

describe('CheckoutScreen — cobro (efectivo, tarjeta, cambio, validación)', () => {
  it('renderiza los 4 métodos de pago y el total', () => {
    render(<CheckoutScreen total={100} onConfirmar={() => {}} onCancelar={() => {}} />);
    // F9.1.5.0 — la tarjeta se desdobla en Débito y Crédito (sin QR), como el
    // viejo POS. Cuatro métodos de primer nivel.
    expect(screen.getByText('Efectivo')).toBeTruthy();
    expect(screen.getByText('Débito')).toBeTruthy();
    expect(screen.getByText('Crédito')).toBeTruthy();
    expect(screen.getByText('Transferencia')).toBeTruthy();
    expect(screen.getByText('$100.00')).toBeTruthy();
  });

  it('F3.4: ofrece botones rápidos de billetes ($50/$100/$200/$500)', () => {
    render(<CheckoutScreen total={100} onConfirmar={() => {}} onCancelar={() => {}} />);
    expect(screen.getByText('$50')).toBeTruthy();
    expect(screen.getByText('$100')).toBeTruthy();
    expect(screen.getByText('$200')).toBeTruthy();
    expect(screen.getByText('$500')).toBeTruthy();
  });

  it('F3.4: valida que el efectivo recibido cubra el total', () => {
    render(<CheckoutScreen total={100} onConfirmar={() => {}} onCancelar={() => {}} />);
    const boton = screen.getByRole('button', { name: /CONFIRMAR PAGO/ });
    // Sin capturar efectivo, no se puede cobrar.
    expect(boton.disabled).toBe(true);
    expect(screen.getByText('Captura el efectivo recibido.')).toBeTruthy();
  });

  it('F3.4: muestra el faltante cuando el efectivo es insuficiente', () => {
    render(<CheckoutScreen total={100} onConfirmar={() => {}} onCancelar={() => {}} />);
    // Se localiza por etiqueta: el input de "Monto del abono" (F9.1.3)
    // comparte el placeholder `0.00`.
    const input = screen.getByLabelText('Efectivo recibido');
    fireEvent.change(input, { target: { value: '40' } });
    // FIX "confirmar pago no hace nada" (7 Oct 2026): el faltante ahora se
    // muestra DOS veces — el mensaje de validación de la columna izquierda
    // ("Faltan $60.00 para cubrir el mínimo ($100.00).") y el motivo junto al
    // botón ("Faltan $60.00 para poder cobrar."). Se afirma sobre el texto
    // completo del mensaje de validación para no colisionar con el nuevo.
    expect(
      screen.getByText('Faltan $60.00 para cubrir el mínimo ($100.00).'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /CONFIRMAR PAGO/ }).disabled).toBe(true);
  });

  it('F3.4: calcula el cambio en vivo y habilita el cobro', () => {
    const onConfirmar = vi.fn();
    render(<CheckoutScreen total={100} onConfirmar={onConfirmar} onCancelar={() => {}} />);
    fireEvent.click(screen.getByText('$200'));
    // Cambio = 200 - 100 = 100. El total también es $100.00, así que hay 2
    // nodos con ese texto: el total y el cambio.
    expect(screen.getAllByText('$100.00').length).toBe(2);
    const boton = screen.getByRole('button', { name: /CONFIRMAR PAGO/ });
    expect(boton.disabled).toBe(false);
    fireEvent.click(boton);
    // 3ª vuelta (7 Oct 2026): el pago único envía `monto` EXPLÍCITO = lo que se
    // aplica al total (min(recibido, total) = 100), no lo recibido (200).
    expect(onConfirmar).toHaveBeenCalledWith({
      metodo: 'EFECTIVO',
      monto: 100,
      recibido: 200,
      cambio: 100,
    });
  });

  it('F3.4: con tarjeta cobra el total exacto sin capturar efectivo', () => {
    const onConfirmar = vi.fn();
    render(<CheckoutScreen total={100} onConfirmar={onConfirmar} onCancelar={() => {}} />);
    // F9.1.5.0 — "Débito" es un método de primer nivel (ya no hay "Tarjeta").
    fireEvent.click(screen.getByText('Débito'));
    const boton = screen.getByRole('button', { name: /CONFIRMAR PAGO/ });
    expect(boton.disabled).toBe(false);
    fireEvent.click(boton);
    // RN-57 solo acepta EFECTIVO/CREDITO/DEBITO/TRANSFERENCIA.
    // 3ª vuelta (7 Oct 2026): el pago único envía `monto` EXPLÍCITO = total.
    expect(onConfirmar).toHaveBeenCalledWith({
      metodo: 'DEBITO',
      monto: 100,
      recibido: 100,
      cambio: 0,
    });
  });

  it('F3.4: muestra el error de cobro inline sin cerrar el modal (Regla 19)', () => {
    render(
      <CheckoutScreen
        total={100}
        onConfirmar={() => {}}
        onCancelar={() => {}}
        error="No se pudo confirmar el pago"
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('No se pudo confirmar el pago');
    // El modal sigue montado.
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('deshabilita las acciones mientras procesa', () => {
    render(<CheckoutScreen total={100} onConfirmar={() => {}} onCancelar={() => {}} procesando />);
    expect(screen.getByRole('button', { name: /Procesando/ }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Cancelar/ }).disabled).toBe(true);
  });

  it('dispara onCancelar', () => {
    const onCancelar = vi.fn();
    render(<CheckoutScreen total={100} onConfirmar={() => {}} onCancelar={onCancelar} />);
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/ }));
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 4. POSOverlays
// ---------------------------------------------------------------------------

describe('POSOverlays — modales de confirmación', () => {
  it('OverlayExito muestra folio, total y "Nueva venta"', () => {
    const onNuevaVenta = vi.fn();
    render(
      <OverlayExito
        ticket={{ account_num: 'A-0001', total: 37, status: 'PAID' }}
        onNuevaVenta={onNuevaVenta}
      />,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('A-0001')).toBeTruthy();
    expect(screen.getByText('$37.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Nueva venta/ }));
    expect(onNuevaVenta).toHaveBeenCalledTimes(1);
  });

  it('OverlayExito no renderiza nada sin ticket', () => {
    const { container } = render(<OverlayExito ticket={null} onNuevaVenta={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('OverlayError muestra el motivo y permite reintentar/cerrar', () => {
    const onReintentar = vi.fn();
    const onCerrar = vi.fn();
    render(<OverlayError mensaje="Fallo de red" onReintentar={onReintentar} onCerrar={onCerrar} />);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Fallo de red')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    fireEvent.click(screen.getByRole('button', { name: /Cerrar/ }));
    expect(onReintentar).toHaveBeenCalledTimes(1);
    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  it('OverlayError no renderiza nada sin mensaje', () => {
    const { container } = render(<OverlayError mensaje={null} onCerrar={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('OverlayConfirmar muestra título, mensaje y 2 acciones', () => {
    const onConfirmar = vi.fn();
    const onCancelar = vi.fn();
    render(
      <OverlayConfirmar
        titulo="¿Cancelar la venta?"
        mensaje="Se perderán las líneas capturadas."
        etiquetaConfirmar="Sí, cancelar"
        onConfirmar={onConfirmar}
        onCancelar={onCancelar}
      />,
    );
    expect(screen.getByText('¿Cancelar la venta?')).toBeTruthy();
    expect(screen.getByText('Se perderán las líneas capturadas.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Sí, cancelar/ }));
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/ }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });

  it('OverlayConfirmar no renderiza nada sin título', () => {
    const { container } = render(<OverlayConfirmar titulo={null} onConfirmar={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
