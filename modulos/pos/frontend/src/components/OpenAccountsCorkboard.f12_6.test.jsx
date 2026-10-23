/**
 * Puerta de FASE 12.6 — PARIDAD DE PRESENTACIÓN del pizarrón.
 *
 * @paridad: components/OpenAccountsCorkboard.f12_6.test.jsx
 * @operacion: El pizarrón muestra tipo de pedido, cliente, entrega, capturista y hora
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ VERIFICA
 * ─────────────────────────────────────────────────────────────────────────────
 * La 14ª lección de §10.6: el inventario de componentes no ve la PARIDAD DE
 * PRESENTACIÓN. F5.3 probó que el pizarrón FUNCIONA (8 criterios); F12.6 prueba
 * que el pizarrón SE PARECE al del viejo POS: estética (corcho + post-it + pin +
 * rotación) Y datos completos (terminal, tipo de pedido, cliente, teléfono,
 * capturista, hora).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOS CRITERIOS
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. El corcho usa los tokens de madera (`madera-panel`, `madera-veta`).
 *   2. Cada post-it lleva un pin (el círculo rojo que lo sujeta).
 *   3. La rotación es DETERMINISTA (estable entre renders, no `Math.random`).
 *   4. El color del post-it depende de la terminal (mapa heredado).
 *   5. Se muestra el tipo de pedido, el cliente y la entrega (paridad con el
 *      viejo POS: badge "PEDIDO TENTATIVO" + línea "🚗 DOMICILIO"/"🏪 PICK UP";
 *      el teléfono NO se muestra, igual que el viejo POS).
 *   6. Se muestra el capturista (nombre resuelto, no UUID).
 *   7. Se muestra la hora formateada a partir del instante UTC (RN-78).
 *   8. Un `reason` desconocido no rompe: cae a un mensaje genérico.
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

import OpenAccountsCorkboard from './OpenAccountsCorkboard.jsx';
// Deuda 1 (11 Oct 2026): las compuertas anclan a la FUENTE ÚNICA de tokens
// vigentes, no a strings hardcodeados. Cuando el diseño cambia, se toca
// `tokensVigentes.js` (un solo archivo) y estas compuertas se re-anclan solas.
import { TOKENS_PIZARRON } from '../theme/tokensVigentes.js';

afterEach(() => {
  cleanup();
});

/**
 * Una cuenta de ejemplo con la proyección COMPLETA del contrato 23 (F12.6).
 * Los 12 campos escalares que el backend expone.
 */
function cuentaCompleta(extra = {}) {
  return {
    id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    account_num: 'T-0042',
    status: 'OPEN',
    total: '150.00',
    version: 3,
    terminal_id: 'T6',
    captured_by_name: 'María López',
    customer_name: 'Juan Pérez',
    customer_phone: '5512345678',
    order_type: 'PEDIDO',
    delivery_type: 'DOMICILIO',
    created_at: '2026-10-01T13:45:00Z',
    ...extra,
  };
}

/** Servicio doble que devuelve una lista de cuentas. */
function servicioCon(cuentas) {
  return {
    listarCuentasAbiertas: vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: { cuentas },
    })),
  };
}

/** Servicio doble que falla con un `reason`. */
function servicioQueFalla(reason) {
  return {
    listarCuentasAbiertas: vi.fn(async () => ({
      outcome: 'error',
      reason,
      data: null,
    })),
  };
}

// ---------------------------------------------------------------------------
// 1. El corcho usa los tokens de madera
// ---------------------------------------------------------------------------

describe('F12.6 — criterio 1: el corcho usa los tokens de madera', () => {
  it('el contenedor del corcho usa madera-panel y madera-veta', async () => {
    const { container } = render(
      <OpenAccountsCorkboard
        terminalId="T6"
        servicioCuentas={servicioCon([cuentaCompleta()])}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')).toBeTruthy();
    });

    // FIX_UI_PARIDAD (11 Oct 2026) — Gemini restauró la estética del POS viejo:
    // el marco del corcho pasó de los tokens `bg-madera-panel border-madera-veta`
    // a `bg-black border-[#3d2b1f]` (madera oscura tostada) + una textura de
    // corcho superpuesta (`#bc8a5f` con `opacity-80`). El INTENTO del criterio
    // sigue siendo el mismo: el tablero es un marco de madera oscura con corcho.
    // Los tokens se leen de la FUENTE ÚNICA (`tokensVigentes.js`), no hardcodeados.
    const corcho = container.querySelector(`.${TOKENS_PIZARRON.tableroFondo}`);
    expect(corcho).toBeTruthy();
    expect(corcho.className).toContain(TOKENS_PIZARRON.tableroBorde);
    // La textura de corcho sigue presente. TS-01 — FD-02: el componente emite
    // `rgb(var(--corcho))` (token), NO el hex resuelto. jsdom no resuelve la
    // var CSS, así que se afirma el token tal cual se emite.
    expect(container.innerHTML).toContain(TOKENS_PIZARRON.corchoHex);
  });
});

// ---------------------------------------------------------------------------
// 2. Cada post-it lleva un pin
// ---------------------------------------------------------------------------

describe('F12.6 — criterio 2: cada post-it lleva un pin', () => {
  it('cada tarjeta tiene un pin (círculo rojo) que la sujeta al corcho', async () => {
    const cuentas = [
      cuentaCompleta({ id: 'id-1', account_num: 'T-0001' }),
      cuentaCompleta({ id: 'id-2', account_num: 'T-0002' }),
    ];
    const { container } = render(
      <OpenAccountsCorkboard terminalId="T6" servicioCuentas={servicioCon(cuentas)} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-id-1')).toBeTruthy();
    });

    const pines = container.querySelectorAll('li span[aria-hidden="true"]');
    expect(pines.length).toBe(2);
    expect(pines[0].className).toContain('bg-red-600');
  });
});

// ---------------------------------------------------------------------------
// 3. La rotación es determinista
// ---------------------------------------------------------------------------

describe('F12.6 — criterio 3: la rotación es determinista', () => {
  it('la misma cuenta conserva su rotación entre renders (no Math.random)', async () => {
    const cuentas = [cuentaCompleta({ id: 'id-1', account_num: 'T-0001' })];

    const primero = render(
      <OpenAccountsCorkboard terminalId="T6" servicioCuentas={servicioCon(cuentas)} />
    );
    await waitFor(() => {
      expect(screen.getByTestId('folio-id-1')).toBeTruthy();
    });
    const rotacionPrimera = primero.container.querySelector('li').className;
    cleanup();

    const segundo = render(
      <OpenAccountsCorkboard terminalId="T6" servicioCuentas={servicioCon(cuentas)} />
    );
    await waitFor(() => {
      expect(screen.getByTestId('folio-id-1')).toBeTruthy();
    });
    const rotacionSegunda = segundo.container.querySelector('li').className;

    // La clase de rotación debe ser idéntica: es función del índice, no del azar.
    const extraerRotacion = (clase) =>
      clase.split(' ').find((c) => /^-?rotate-\d$/.test(c));
    expect(extraerRotacion(rotacionPrimera)).toBe(extraerRotacion(rotacionSegunda));
    expect(extraerRotacion(rotacionPrimera)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. El color del post-it depende de la terminal
// ---------------------------------------------------------------------------

describe('F12.6 — criterio 4: el color del post-it depende de la terminal', () => {
  // BUG-02 (9 Oct 2026): el mapa de colores usa el vocabulario REAL del nuevo
  // POS (`TERM-0X`, ver useTerminals.js F7.7d), no los ids viejos (`T6`).
  // FASE 13.3 (9 Oct 2026): el mapa ya NO es una constante local; el pizarrón
  // recibe `coloresPorTerminal` como prop (lo construye RetailVisionPOS desde
  // la config de terminales). El test lo pasa explícitamente.
  it('la terminal TERM-06 pinta el post-it con el color configurado', async () => {
    const { container } = render(
      <OpenAccountsCorkboard
        terminalId="TERM-06"
        servicioCuentas={servicioCon([cuentaCompleta({ terminal_id: 'TERM-06' })])}
        coloresPorTerminal={{ 'TERM-06': 'bg-yellow-300' }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')).toBeTruthy();
    });

    const postIt = container.querySelector('li');
    expect(postIt.className).toContain('bg-yellow-300');
  });

  it('la terminal CAJA pinta el post-it con el color configurado', async () => {
    const { container } = render(
      <OpenAccountsCorkboard
        terminalId="CAJA"
        servicioCuentas={servicioCon([cuentaCompleta({ terminal_id: 'CAJA' })])}
        coloresPorTerminal={{ CAJA: 'bg-orange-300' }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')).toBeTruthy();
    });

    const postIt = container.querySelector('li');
    expect(postIt.className).toContain('bg-orange-300');
  });

  it('una terminal sin color configurado cae al amarillo por defecto', async () => {
    const { container } = render(
      <OpenAccountsCorkboard
        terminalId="TERM-06"
        servicioCuentas={servicioCon([cuentaCompleta({ terminal_id: 'TERM-06' })])}
        coloresPorTerminal={{}}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')).toBeTruthy();
    });

    const postIt = container.querySelector('li');
    expect(postIt.className).toContain('bg-yellow-100');
  });
});

// ---------------------------------------------------------------------------
// 5. Tipo de pedido, cliente y teléfono
// ---------------------------------------------------------------------------

describe('F12.6 — criterio 5: tipo de pedido, cliente y entrega', () => {
  it('muestra el badge TENTATIVO, el cliente y la entrega (sin teléfono)', async () => {
    render(
      <OpenAccountsCorkboard
        terminalId="T6"
        servicioCuentas={servicioCon([cuentaCompleta()])}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')).toBeTruthy();
    });

    // PARIDAD con el viejo POS: badge exacto "PEDIDO TENTATIVO".
    expect(screen.getByText(/PEDIDO TENTATIVO/)).toBeTruthy();
    expect(screen.getByText(/Juan Pérez/)).toBeTruthy();
    // Línea de entrega con emoji (DOMICILIO → 🚗 DOMICILIO).
    expect(screen.getByText(/🚗 DOMICILIO/)).toBeTruthy();
    // El viejo POS NO mostraba el teléfono: no debe aparecer.
    expect(screen.queryByText(/5512345678/)).toBeNull();
  });

  it('mapea PICKUP a la etiqueta "🏪 PICK UP"', async () => {
    render(
      <OpenAccountsCorkboard
        terminalId="T6"
        servicioCuentas={servicioCon([
          cuentaCompleta({ delivery_type: 'PICKUP' }),
        ])}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')).toBeTruthy();
    });

    expect(screen.getByText(/🏪 PICK UP/)).toBeTruthy();
  });

  it('una venta directa NO muestra el bloque de pedido', async () => {
    render(
      <OpenAccountsCorkboard
        terminalId="T6"
        servicioCuentas={servicioCon([
          cuentaCompleta({
            order_type: 'VENTA_DIRECTA',
            customer_name: null,
            customer_phone: null,
            delivery_type: null,
          }),
        ])}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')).toBeTruthy();
    });

    expect(screen.queryByText(/PEDIDO/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. El capturista (nombre resuelto)
// ---------------------------------------------------------------------------

describe('F12.6 — criterio 6: el capturista viaja como nombre resuelto', () => {
  it('muestra el nombre del capturista, no un UUID', async () => {
    render(
      <OpenAccountsCorkboard
        terminalId="T6"
        servicioCuentas={servicioCon([cuentaCompleta()])}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')).toBeTruthy();
    });

    expect(screen.getByText(/María López/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 7. La hora formateada (RN-78)
// ---------------------------------------------------------------------------

describe('F12.6 — criterio 7: la hora se formatea desde el instante UTC', () => {
  it('muestra una hora HH:MM derivada de created_at', async () => {
    render(
      <OpenAccountsCorkboard
        terminalId="T6"
        servicioCuentas={servicioCon([
          cuentaCompleta({ created_at: '2026-10-01T13:45:00Z' }),
        ])}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')).toBeTruthy();
    });

    // El formato es HH:MM (dos dígitos, dos dígitos), sin importar la zona.
    expect(screen.getByText(/🕒 \d{2}:\d{2}/)).toBeTruthy();
  });

  it('un created_at ausente no rompe la tarjeta', async () => {
    render(
      <OpenAccountsCorkboard
        terminalId="T6"
        servicioCuentas={servicioCon([cuentaCompleta({ created_at: null })])}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')).toBeTruthy();
    });

    expect(screen.getByText(/🕒 —/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 8. Un reason desconocido no rompe
// ---------------------------------------------------------------------------

describe('F12.6 — criterio 8: un reason desconocido se muestra verbatim', () => {
  it('un reason no mapeado se muestra tal cual (no se traga el diagnóstico)', async () => {
    render(
      <OpenAccountsCorkboard
        terminalId="T6"
        servicioCuentas={servicioQueFalla('red caída')}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    // El mensaje crudo del error debe llegar al cajero: esconderlo tras un
    // texto genérico le quitaría el diagnóstico para reportar la falla.
    expect(screen.getByRole('alert').textContent).toContain('red caída');
  });

  it('un reason vacío lo normaliza el hook a error_desconocido', async () => {
    render(
      <OpenAccountsCorkboard
        terminalId="T6"
        servicioCuentas={servicioQueFalla('')}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    // El hook hace `setError(r.reason || 'error_desconocido')`: un reason
    // vacío nunca llega al componente como cadena vacía.
    expect(screen.getByRole('alert').textContent).toContain(
      'error_desconocido',
    );
  });
});
