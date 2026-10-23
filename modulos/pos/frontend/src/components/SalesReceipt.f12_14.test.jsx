/**
 * Compuerta de FASE 12.14 — REGLA 13: sin conexión, el botón ENVIAR CUENTA se
 * bloquea.
 *
 * QUÉ PRUEBA ESTA COMPUERTA
 * -------------------------
 * El viejo POS (`apps/pos/components/SalesReceipt.jsx:156-158`) bloqueaba el
 * botón ENVIAR CUENTA con `hasUnsavedItems` (derivado de `lastSaveStatus`):
 *
 *   <button
 *     onClick={handleHoldAccount}
 *     disabled={isSendingToPizarron || cart.length === 0 || hasUnsavedItems}
 *     title={hasUnsavedItems
 *       ? '⛔ No se puede enviar: hay productos sin guardar en el servidor. Verifique la conexión WiFi.'
 *       : ''}
 *   >
 *
 * El nuevo POS ya exponía la señal equivalente —`useNetworkHealth().botonBloqueado`
 * (= `!enLinea`)— pero estaba HUÉRFANA: se calculaba y nadie la consumía. El botón
 * ENVIAR CUENTA solo se bloqueaba por ticket vacío o envío en curso, NO por falta
 * de red. Es la 23ª instancia de §10.6: el hook existe y pasa su test, pero su
 * OPERACIÓN (bloquear el envío sin conexión) se perdió en la traducción.
 *
 * Esta compuerta fija las invariantes de la operación heredada:
 *   1. Sin red (`sinRed`), el botón ENVIAR CUENTA está DESHABILITADO.
 *   2. Sin red, el `title` guía a verificar la red WiFi.
 *   3. Sin red, pulsar el botón NO dispara `onEnviarCuenta`.
 *   4. Con red, el botón está HABILITADO (si hay líneas).
 *   5. Con red y líneas, `onEnviarCuenta` se dispara.
 *   6. Un ticket vacío sigue bloqueando el envío aunque haya red.
 *   7. Un envío en curso sigue bloqueando el botón.
 *   8. El gate de red es INDEPENDIENTE del gate de caja (F12.8/F12.9): sin caja
 *      pero con red, el envío sigue permitido.
 *
 * §6.8 — la INTEGRACIÓN se hereda; solo la IMPLEMENTACIÓN se reescribe.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import SalesReceipt from './SalesReceipt.jsx';

const LINEA = {
  item_id: 'ITEM-1',
  product_id: 'PROD-1',
  name: 'Concha',
  unit_price: 12.5,
  quantity: 2,
};

function montar(props = {}) {
  const base = {
    lineas: [LINEA],
    onIncrementar: vi.fn(),
    onDecrementar: vi.fn(),
    onQuitar: vi.fn(),
    onCobrar: vi.fn(),
    onEnviarCuenta: vi.fn(),
    enviandoCuenta: false,
    cobrando: false,
    terminalId: 'TERM-01',
    banner: null,
    cajaHabilitada: false,
    sinRed: false,
  };
  return render(<SalesReceipt {...base} {...props} />);
}

function botonEnviar() {
  return screen.getByRole('button', { name: /ENVIAR CUENTA|Enviando/ });
}

describe('F12.14 — sin red el botón ENVIAR CUENTA está bloqueado', () => {
  it('el botón ENVIAR CUENTA está deshabilitado', () => {
    montar({ sinRed: true });
    expect(botonEnviar().disabled).toBe(true);
  });

  it('el title guía a verificar la red WiFi', () => {
    montar({ sinRed: true });
    expect(botonEnviar().getAttribute('title')).toContain('Verifique la red WiFi');
  });

  it('pulsar el botón NO dispara onEnviarCuenta', () => {
    const onEnviarCuenta = vi.fn();
    montar({ sinRed: true, onEnviarCuenta });
    fireEvent.click(botonEnviar());
    expect(onEnviarCuenta).not.toHaveBeenCalled();
  });
});

describe('F12.14 — con red el botón ENVIAR CUENTA procede', () => {
  it('el botón está habilitado', () => {
    montar({ sinRed: false });
    expect(botonEnviar().disabled).toBe(false);
  });

  it('pulsar el botón dispara onEnviarCuenta', () => {
    const onEnviarCuenta = vi.fn();
    montar({ sinRed: false, onEnviarCuenta });
    fireEvent.click(botonEnviar());
    expect(onEnviarCuenta).toHaveBeenCalledTimes(1);
  });

  it('sin caja pero con red, el envío sigue permitido (gate independiente)', () => {
    const onEnviarCuenta = vi.fn();
    montar({ sinRed: false, cajaHabilitada: false, onEnviarCuenta });
    expect(botonEnviar().disabled).toBe(false);
    fireEvent.click(botonEnviar());
    expect(onEnviarCuenta).toHaveBeenCalledTimes(1);
  });
});

describe('F12.14 — los gates preexistentes siguen vigentes', () => {
  it('un ticket vacío bloquea el envío aunque haya red', () => {
    montar({ sinRed: false, lineas: [] });
    expect(botonEnviar().disabled).toBe(true);
  });

  it('un envío en curso bloquea el botón', () => {
    montar({ sinRed: false, enviandoCuenta: true });
    expect(botonEnviar().disabled).toBe(true);
  });
});
