/**
 * Puerta de FASE 8.5 — `TicketDeliveryPanel` (paso post-cobro de entrega).
 *
 * 8 criterios:
 *   1. Renderiza el overlay con los 4 controles (imprimir/whatsapp/email/cerrar).
 *   2. Imprimir SIEMPRE está disponible y llama al servicio de impresión (RN-87).
 *   3. WhatsApp encola por el contrato #27 con el canal correcto (RN-86).
 *   4. Email encola por el contrato #27 con el canal correcto (RN-86).
 *   5. Precarga el contacto desde el CRM sin volver a teclear (RN-92).
 *   6. Degradación: si la cola está caída (503), avisa y NO revierte (DT-07).
 *   7. Guarda local: sin el dato del canal no se llama al contrato.
 *   8. "Cerrar" es la ÚNICA salida: cierra el paso sin enviar nada. FIX-BUG15:
 *      imprimir y enviar NO cierran el panel (el operador puede hacer varias
 *      acciones y sale explícitamente con "Cerrar").
 *
 * El componente es inyectable: recibe `servicioNotificaciones`,
 * `servicioImpresion` y `generadorTicket` como props, así que la puerta NO
 * mockea módulos: pasa dobles por props. Eso prueba la costura real.
 */

import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TicketDeliveryPanel from './TicketDeliveryPanel.jsx';

afterEach(cleanup);

/** Un ticket cobrado de ejemplo. */
function ticketEjemplo(extra = {}) {
  return {
    id: 'ticket-uuid-1',
    account_num: 'A-000123',
    total: '150.00',
    status: 'PAID',
    lineas: [{ product_id: 'p1', qty: 2, unit_price: '75.00' }],
    ...extra,
  };
}

/** Un servicio de notificaciones que responde OK. */
function servicioOk() {
  return vi.fn(async () => ({
    outcome: 'ok',
    reason: null,
    data: { encolado: true, mensajes: [{ canal: 'WHATSAPP', estado: 'PENDIENTE' }] },
  }));
}

/** Un servicio de notificaciones que degrada (cola caída). */
function servicioCaido(reason = 'cola_no_disponible') {
  return vi.fn(async () => ({ outcome: 'error', reason, data: null }));
}

/** Un servicio de impresión que responde OK. */
function impresionOk() {
  return vi.fn(() => ({ outcome: 'ok', reason: null }));
}

/** Un generador de ticket que devuelve un HTML mínimo. */
function generadorFalso() {
  return vi.fn(() => '<html><body>ticket</body></html>');
}

/** Monta el panel con dobles por defecto. */
function montar(props = {}) {
  const servicioNotificaciones = props.servicioNotificaciones ?? servicioOk();
  const servicioImpresion = props.servicioImpresion ?? impresionOk();
  const generadorTicket = props.generadorTicket ?? generadorFalso();
  const onOmitir = props.onOmitir ?? vi.fn();
  const onEnviado = props.onEnviado ?? vi.fn();
  const onImprimir = props.onImprimir ?? vi.fn();

  const ticket = Object.prototype.hasOwnProperty.call(props, 'ticket')
    ? props.ticket
    : ticketEjemplo();

  const utilidades = render(
    <TicketDeliveryPanel
      ticket={ticket}
      cliente={props.cliente ?? null}
      eventoId={props.eventoId ?? null}
      onOmitir={onOmitir}
      onEnviado={onEnviado}
      onImprimir={onImprimir}
      servicioNotificaciones={servicioNotificaciones}
      servicioImpresion={servicioImpresion}
      generadorTicket={generadorTicket}
    />
  );

  return {
    ...utilidades,
    servicioNotificaciones,
    servicioImpresion,
    generadorTicket,
    onOmitir,
    onEnviado,
    onImprimir,
  };
}

describe('F8.5 — TicketDeliveryPanel', () => {
  // ── Criterio 1 ────────────────────────────────────────────────────────────
  it('criterio1: renderiza el overlay con los 4 controles', () => {
    montar();
    expect(screen.getByRole('dialog', { name: 'Entrega del ticket' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Imprimir/ })).toBeTruthy();
    expect(document.getElementById('btn-whatsapp')).toBeTruthy();
    expect(document.getElementById('btn-email')).toBeTruthy();
    // FIX-BUG15: el botón de salida se rotula "Cerrar" (id `btn-omitir`).
    expect(screen.getByRole('button', { name: /^Cerrar$/ })).toBeTruthy();
  });

  it('criterio1: muestra el folio y el total del ticket', () => {
    montar();
    expect(screen.getByText('A-000123')).toBeTruthy();
    expect(screen.getByText('$150.00')).toBeTruthy();
  });

  it('criterio1: sin ticket no renderiza nada', () => {
    const { container } = montar({ ticket: null });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  // ── Criterio 2 — RN-87 ────────────────────────────────────────────────────
  it('criterio2: imprimir llama al servicio de impresión con el HTML generado', () => {
    const { servicioImpresion, generadorTicket } = montar();
    fireEvent.click(document.getElementById('btn-imprimir'));
    expect(generadorTicket).toHaveBeenCalledTimes(1);
    expect(servicioImpresion).toHaveBeenCalledWith('<html><body>ticket</body></html>');
  });

  it('criterio2: imprimir está disponible aunque el cliente no esté identificado', () => {
    montar({ cliente: null });
    const boton = document.getElementById('btn-imprimir');
    expect(boton.disabled).toBe(false);
  });

  it('criterio2: imprimir avisa cuando la impresión falla', () => {
    const servicioImpresion = vi.fn(() => ({ outcome: 'error', reason: 'documento_no_disponible' }));
    montar({ servicioImpresion });
    fireEvent.click(document.getElementById('btn-imprimir'));
    expect(screen.getByRole('status').textContent).toMatch(/No se pudo imprimir/);
  });

  // ── Criterio 3 — RN-86 (WhatsApp) ─────────────────────────────────────────
  it('criterio3: WhatsApp encola con el canal WHATSAPP y el teléfono', async () => {
    const { servicioNotificaciones } = montar();
    fireEvent.change(document.getElementById('input-telefono-entrega'), {
      target: { value: '5512345678' },
    });
    fireEvent.click(document.getElementById('btn-whatsapp'));

    await waitFor(() => expect(servicioNotificaciones).toHaveBeenCalledTimes(1));
    const solicitud = servicioNotificaciones.mock.calls[0][0];
    expect(solicitud.canales).toEqual(['WHATSAPP']);
    expect(solicitud.destinatario).toEqual({ telefono: '5512345678' });
    expect(solicitud.evento_id).toBe('ticket:A-000123');
    expect(solicitud.ticket_uuid).toBe('ticket-uuid-1');
  });

  it('criterio3: WhatsApp avisa cuando el encolado tiene éxito', async () => {
    montar();
    fireEvent.change(document.getElementById('input-telefono-entrega'), {
      target: { value: '5512345678' },
    });
    fireEvent.click(document.getElementById('btn-whatsapp'));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/encolado para WhatsApp/)
    );
  });

  // ── Criterio 4 — RN-86 (Email) ────────────────────────────────────────────
  it('criterio4: Email encola con el canal EMAIL y el correo', async () => {
    const { servicioNotificaciones } = montar();
    fireEvent.change(document.getElementById('input-email-entrega'), {
      target: { value: 'cliente@correo.mx' },
    });
    fireEvent.click(document.getElementById('btn-email'));

    await waitFor(() => expect(servicioNotificaciones).toHaveBeenCalledTimes(1));
    const solicitud = servicioNotificaciones.mock.calls[0][0];
    expect(solicitud.canales).toEqual(['EMAIL']);
    expect(solicitud.destinatario).toEqual({ email: 'cliente@correo.mx' });
  });

  it('criterio4: el payload es una proyección del ticket, no la tabla', async () => {
    const { servicioNotificaciones } = montar();
    fireEvent.change(document.getElementById('input-email-entrega'), {
      target: { value: 'cliente@correo.mx' },
    });
    fireEvent.click(document.getElementById('btn-email'));

    await waitFor(() => expect(servicioNotificaciones).toHaveBeenCalledTimes(1));
    const { payload } = servicioNotificaciones.mock.calls[0][0];
    expect(payload.folio).toBe('A-000123');
    expect(payload.total).toBe('150.00');
    expect(Array.isArray(payload.items)).toBe(true);
  });

  // ── Criterio 5 — RN-92 (precarga) ─────────────────────────────────────────
  it('criterio5: precarga el teléfono del cliente identificado', () => {
    montar({ cliente: { customer_id: 'c1', nombre: 'Ana', telefono: '5599887766' } });
    expect(document.getElementById('input-telefono-entrega').value).toBe('5599887766');
  });

  it('criterio5: precarga el correo del cliente identificado', () => {
    montar({ cliente: { customer_id: 'c1', nombre: 'Ana', email: 'ana@correo.mx' } });
    expect(document.getElementById('input-email-entrega').value).toBe('ana@correo.mx');
  });

  it('criterio5: muestra el nombre del cliente identificado', () => {
    montar({ cliente: { customer_id: 'c1', nombre: 'Ana' } });
    expect(screen.getByText('Ana')).toBeTruthy();
  });

  // ── Criterio 6 — DT-07 (degradación) ──────────────────────────────────────
  it('criterio6: si la cola está caída, avisa sin revertir el cobro', async () => {
    const { servicioNotificaciones } = montar({ servicioNotificaciones: servicioCaido() });
    fireEvent.change(document.getElementById('input-telefono-entrega'), {
      target: { value: '5512345678' },
    });
    fireEvent.click(document.getElementById('btn-whatsapp'));

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/quedó pendiente/)
    );
    expect(servicioNotificaciones).toHaveBeenCalledTimes(1);
    // El panel sigue montado: la venta no se revierte.
    expect(screen.getByRole('dialog', { name: 'Entrega del ticket' })).toBeTruthy();
  });

  it('criterio6: imprimir sigue disponible tras un fallo de la cola', async () => {
    montar({ servicioNotificaciones: servicioCaido() });
    fireEvent.change(document.getElementById('input-telefono-entrega'), {
      target: { value: '5512345678' },
    });
    fireEvent.click(document.getElementById('btn-whatsapp'));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(document.getElementById('btn-imprimir').disabled).toBe(false);
  });

  // ── Criterio 7 — guarda local ─────────────────────────────────────────────
  it('criterio7: sin teléfono no se llama al contrato', () => {
    const { servicioNotificaciones } = montar();
    fireEvent.click(document.getElementById('btn-whatsapp'));
    expect(servicioNotificaciones).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/Escribe un teléfono/);
  });

  it('criterio7: sin correo no se llama al contrato', () => {
    const { servicioNotificaciones } = montar();
    fireEvent.click(document.getElementById('btn-email'));
    expect(servicioNotificaciones).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/Escribe un correo/);
  });

  // ── Criterio 8 — "Cerrar" es la única salida (FIX-BUG15) ──────────────────
  it('criterio8: "Cerrar" llama a onOmitir sin enviar nada', () => {
    const { onOmitir, servicioNotificaciones } = montar();
    fireEvent.click(screen.getByRole('button', { name: /^Cerrar$/ }));
    expect(onOmitir).toHaveBeenCalledTimes(1);
    expect(servicioNotificaciones).not.toHaveBeenCalled();
  });

  it('criterio8: "Cerrar" no imprime', () => {
    const { servicioImpresion } = montar();
    fireEvent.click(screen.getByRole('button', { name: /^Cerrar$/ }));
    expect(servicioImpresion).not.toHaveBeenCalled();
  });

  // FIX-BUG15 — Imprimir y enviar NO cierran el panel: el operador puede hacer
  // varias acciones (p. ej. imprimir Y mandar por WhatsApp) y sale con "Cerrar".
  it('criterio8: imprimir NO cierra el panel (onOmitir no se llama)', () => {
    const { onOmitir, servicioImpresion } = montar();
    fireEvent.click(document.getElementById('btn-imprimir'));
    expect(servicioImpresion).toHaveBeenCalledTimes(1);
    expect(onOmitir).not.toHaveBeenCalled();
    // El panel sigue montado tras imprimir.
    expect(screen.getByRole('dialog', { name: 'Entrega del ticket' })).toBeTruthy();
  });

  it('criterio8: enviar por WhatsApp NO cierra el panel (onOmitir no se llama)', async () => {
    const { onOmitir, servicioNotificaciones } = montar();
    fireEvent.change(document.getElementById('input-telefono-entrega'), {
      target: { value: '5512345678' },
    });
    fireEvent.click(document.getElementById('btn-whatsapp'));
    await waitFor(() => expect(servicioNotificaciones).toHaveBeenCalledTimes(1));
    expect(onOmitir).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Entrega del ticket' })).toBeTruthy();
  });

  it('criterio8: tras imprimir se puede enviar por WhatsApp y luego cerrar', async () => {
    const { onOmitir, servicioImpresion, servicioNotificaciones } = montar();
    // 1) Imprimir — el panel permanece abierto.
    fireEvent.click(document.getElementById('btn-imprimir'));
    expect(servicioImpresion).toHaveBeenCalledTimes(1);
    expect(onOmitir).not.toHaveBeenCalled();
    // 2) Enviar por WhatsApp — el panel sigue abierto.
    fireEvent.change(document.getElementById('input-telefono-entrega'), {
      target: { value: '5512345678' },
    });
    fireEvent.click(document.getElementById('btn-whatsapp'));
    await waitFor(() => expect(servicioNotificaciones).toHaveBeenCalledTimes(1));
    expect(onOmitir).not.toHaveBeenCalled();
    // 3) Cerrar — ahora sí sale.
    fireEvent.click(screen.getByRole('button', { name: /^Cerrar$/ }));
    expect(onOmitir).toHaveBeenCalledTimes(1);
  });

  // ── Criterio 9 — contraste de los campos de contacto (BUG-13) ──────────────
  // El panel es CLARO (`bg-crema-ticket`). Los inputs usaban `bg-fondo-panel`
  // (gris oscuro #1a1a1a) con `text-fondo-profundo` (casi negro #0a0a0a): texto
  // oscuro sobre fondo oscuro → el teléfono/correo eran INVISIBLES y parecía
  // que el campo "no hacía nada". Esta puerta verifica el EFECTO (fondo claro +
  // texto oscuro), no la mera existencia del símbolo.
  it('criterio9: el input de WhatsApp tiene fondo claro y texto oscuro (no oscuro-sobre-oscuro)', () => {
    montar();
    const input = document.getElementById('input-telefono-entrega');
    expect(input.className).toContain('bg-white');
    expect(input.className).toContain('text-fondo-profundo');
    // La regresión exacta: el fondo oscuro del panel NO debe volver.
    expect(input.className).not.toContain('bg-fondo-panel');
  });

  it('criterio9: el input de email tiene fondo claro y texto oscuro (no oscuro-sobre-oscuro)', () => {
    montar();
    const input = document.getElementById('input-email-entrega');
    expect(input.className).toContain('bg-white');
    expect(input.className).toContain('text-fondo-profundo');
    expect(input.className).not.toContain('bg-fondo-panel');
  });

  it('criterio9: los campos declaran un color de placeholder visible', () => {
    montar();
    expect(document.getElementById('input-telefono-entrega').className).toContain(
      'placeholder-fondo-profundo/40'
    );
    expect(document.getElementById('input-email-entrega').className).toContain(
      'placeholder-fondo-profundo/40'
    );
  });
});
