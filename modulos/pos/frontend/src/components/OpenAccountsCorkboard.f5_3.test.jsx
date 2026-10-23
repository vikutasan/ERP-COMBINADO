/**
 * Puerta de FASE 5.3 — Pizarrón de cuentas abiertas (interfaz 13).
 *
 * @paridad: components/OpenAccountsCorkboard.f5_3.test.jsx
 * @operacion: El pizarrón muestra el folio CORTO (`#` + últimos 3 dígitos)
 *
 * @paridad: components/OpenAccountsCorkboard.f5_3.test.jsx
 * @operacion: El pizarrón muestra el folio CORTO (# + últimos 3 dígitos); la tarjeta entera es clickeable; scroll lateral interno
 *
 * Verifica los 8 criterios de la sub-fase 5.3:
 *   1. Renderiza una tarjeta (post-it) por cuenta.
 *   2. Muestra el folio corto (`#` + últimos 3 dígitos) y el total formateado.
 *   3. El post-it (la propia tarjeta) llama a `recuperarCuenta` con el `id` correcto.
 *   4. Estado vacío: "No hay cuentas pendientes en el pizarrón".
 *   5. Estado de carga: indicador visible.
 *   6. Estado de error: mensaje visible.
 *   7. Contenedor raíz fluido (`w-full`) y sin ancho fijo (R-01).
 *   8. Cada tarjeta tiene `min-h-tactil` (R-04).
 *
 * NOTA DE PARIDAD (F12.6/F12.9): el pizarrón del viejo POS muestra el folio
 * CORTO (`#001` vía `slice(-3)`) y la tarjeta entera es el elemento clickeable
 * (no existe un botón "Recuperar" separado). Esta compuerta se alineó a esa
 * presentación real tras el rewrite de F12.6.
 *
 * El componente consume `useOpenAccounts`; aquí se inyectan dobles del servicio
 * y del cliente para no tocar la red.
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import OpenAccountsCorkboard from './OpenAccountsCorkboard.jsx';
// Deuda 1 (11 Oct 2026): las compuertas anclan a la FUENTE ÚNICA de tokens
// vigentes, no a strings hardcodeados. Cuando el diseño cambia, se toca
// `tokensVigentes.js` (un solo archivo) y estas compuertas se re-anclan solas.
import { TOKENS_PIZARRON } from '../theme/tokensVigentes.js';

afterEach(() => {
  cleanup();
});

/** Una cuenta de ejemplo (proyección ligera, contrato 23). */
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

/** Cliente doble que devuelve un ticket fresco (contrato 21). */
function clienteCon(ticket) {
  return {
    leerTicket: vi.fn(async () => ticket),
  };
}

// ---------------------------------------------------------------------------
// 1. Una tarjeta por cuenta
// ---------------------------------------------------------------------------

describe('F5.3 — criterio 1: una tarjeta por cuenta', () => {
  it('renderiza una tarjeta por cada cuenta abierta', async () => {
    const cuentas = [
      cuentaEjemplo({ id: 'id-1', account_num: 'T-0001' }),
      cuentaEjemplo({ id: 'id-2', account_num: 'T-0002' }),
      cuentaEjemplo({ id: 'id-3', account_num: 'T-0003' }),
    ];
    render(
      <OpenAccountsCorkboard terminalId="TERM-01" servicioCuentas={servicioCon(cuentas)} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-id-1')).toBeTruthy();
    });
    expect(screen.getByTestId('folio-id-2')).toBeTruthy();
    expect(screen.getByTestId('folio-id-3')).toBeTruthy();
    // Cada post-it es un elemento clickeable (role="button").
    expect(screen.getAllByRole('button', { name: /Ver Cuenta/i })).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 2. Folio y total formateado
// ---------------------------------------------------------------------------

describe('F5.3 — criterio 2: folio y total formateado', () => {
  it('muestra el folio corto y el total en formato de moneda', async () => {
    const cuentas = [cuentaEjemplo({ id: 'id-1', account_num: 'T-0042', total: '150.00' })];
    render(
      <OpenAccountsCorkboard terminalId="TERM-01" servicioCuentas={servicioCon(cuentas)} />
    );

    await waitFor(() => {
      // El viejo POS muestra el folio CORTO: `#` + últimos 3 dígitos.
      expect(screen.getByTestId('folio-id-1').textContent).toBe('#042');
    });
    // $150.00 en es-MX.
    expect(screen.getByTestId('total-id-1').textContent).toContain('150.00');
  });
});

// ---------------------------------------------------------------------------
// 3. El botón "Recuperar" llama con el id correcto
// ---------------------------------------------------------------------------

describe('F5.3 — criterio 3: recuperar con el id correcto', () => {
  it('llama a recuperarCuenta con el id de la cuenta tocada', async () => {
    const cuentas = [
      cuentaEjemplo({ id: 'id-1', account_num: 'T-0001' }),
      cuentaEjemplo({ id: 'id-2', account_num: 'T-0002' }),
    ];
    const clienteApi = clienteCon({ id: 'id-2', version: 9 });
    const onRecuperar = vi.fn();

    render(
      <OpenAccountsCorkboard
        terminalId="TERM-01"
        servicioCuentas={servicioCon(cuentas)}
        clienteApi={clienteApi}
        onRecuperar={onRecuperar}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-id-2')).toBeTruthy();
    });

    // El post-it entero es el elemento clickeable (role="button").
    const postIts = screen.getAllByRole('button', { name: /Ver Cuenta/i });
    fireEvent.click(postIts[1]);

    await waitFor(() => {
      expect(clienteApi.leerTicket).toHaveBeenCalledWith('id-2');
    });
    // F12.10b — `onRecuperar` recibe DOS argumentos: (1) el ticket fresco del
    // contrato 21 y (2) la cuenta rica del pizarrón (contrato 23), que es la
    // ÚNICA que trae `order_type`/`delivery_type`/cliente para restaurar el
    // contexto de un PEDIDO. El segundo argumento es la cuenta tocada.
    expect(onRecuperar).toHaveBeenCalledWith(
      { id: 'id-2', version: 9 },
      expect.objectContaining({ id: 'id-2', account_num: 'T-0002' }),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Estado vacío
// ---------------------------------------------------------------------------

describe('F5.3 — criterio 4: estado vacío', () => {
  it('muestra "No hay cuentas pendientes en el pizarrón" cuando la lista está vacía', async () => {
    render(
      <OpenAccountsCorkboard terminalId="TERM-01" servicioCuentas={servicioCon([])} />
    );

    await waitFor(() => {
      expect(
        screen.getByText('No hay cuentas pendientes en el pizarrón'),
      ).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Estado de carga
// ---------------------------------------------------------------------------

describe('F5.3 — criterio 5: estado de carga', () => {
  it('muestra el indicador de carga mientras la lectura está en vuelo', () => {
    // Un servicio que nunca resuelve mantiene el estado de carga.
    const servicioLento = {
      listarCuentasAbiertas: vi.fn(() => new Promise(() => {})),
    };
    render(
      <OpenAccountsCorkboard terminalId="TERM-01" servicioCuentas={servicioLento} />
    );

    expect(screen.getByText('Cargando cuentas…')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 6. Estado de error
// ---------------------------------------------------------------------------

describe('F5.3 — criterio 6: estado de error', () => {
  it('muestra un banner persistente con el mensaje del fallo', async () => {
    render(
      <OpenAccountsCorkboard
        terminalId="TERM-01"
        servicioCuentas={servicioQueFalla('sin_conexion')}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(screen.getByRole('alert').textContent).toContain('No hay conexión');
  });
});

// ---------------------------------------------------------------------------
// 7. Contenedor raíz fluido (R-01)
// ---------------------------------------------------------------------------

describe('F5.3 — criterio 7: contenedor raíz fluido (R-01)', () => {
  it('el contenedor raíz usa w-full y no un ancho fijo', async () => {
    const { container } = render(
      <OpenAccountsCorkboard terminalId="TERM-01" servicioCuentas={servicioCon([])} />
    );

    // Esperar a que la lectura asíncrona se asiente antes de medir el DOM,
    // para no disparar un `act(...)` warning por un setState fuera de act.
    await waitFor(() => {
      expect(
        screen.getByText('No hay cuentas pendientes en el pizarrón'),
      ).toBeTruthy();
    });

    const raiz = container.firstChild;
    expect(raiz.className).toContain('w-full');
    expect(raiz.className).toContain(TOKENS_PIZARRON.raizAncho);
    // No debe haber un ancho fijo en píxeles sin un `max-` que lo acote.
    expect(raiz.className).not.toMatch(/(^|\s)w-\[\d+px\]/);
  });
});

// ---------------------------------------------------------------------------
// 8. Táctil ≥ 44px (R-04)
// ---------------------------------------------------------------------------

describe('F5.3 — criterio 8: táctil (R-04)', () => {
  it('cada tarjeta de cuenta es un cuadrado grande (área táctil ≥ 44px)', async () => {
    const cuentas = [cuentaEjemplo({ id: 'id-1' })];
    const { container } = render(
      <OpenAccountsCorkboard terminalId="TERM-01" servicioCuentas={servicioCon(cuentas)} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-id-1')).toBeTruthy();
    });

    const tarjetas = container.querySelectorAll('li');
    expect(tarjetas.length).toBe(1);
    // BUG-10c: el post-it es `aspect-square` (alto = ancho de columna), muy
    // por encima del mínimo táctil de 44px. Antes se usaba `min-h-tactil`,
    // que estiraba el post-it y dejaba un hueco vacío enorme.
    expect(tarjetas[0].className).toContain('aspect-square');
  });
});

// ---------------------------------------------------------------------------
// 9. Scroll lateral con muchas cuentas (BUG-10, paridad con el POS viejo)
// ---------------------------------------------------------------------------

describe('BUG-10 — scroll lateral del pizarrón', () => {
  it('el tablero acota su altura y el wrapper del grid es el contenedor con scroll', async () => {
    // Muchas cuentas: el grid debe poder desbordar y desplazarse.
    const cuentas = Array.from({ length: 12 }, (_, i) =>
      cuentaEjemplo({ id: `id-${i}`, account_num: `T-000${i}` }),
    );
    const { container } = render(
      <OpenAccountsCorkboard terminalId="TERM-01" servicioCuentas={servicioCon(cuentas)} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-id-0')).toBeTruthy();
    });

    // El tablero (hijo directo de la raíz) tiene ALTURA DEFINIDA y recorta el
    // desborde; el scroll vive DENTRO, no en el modal exterior.
    //
    // BUG-10e (paridad con el POS viejo): DEBE ser `aspect-[16/9]` — la altura
    // se DERIVA del ancho (acotado por `max-w-[1100px]`). NO `max-h-[85vh]`
    // (un máximo no acota a los hijos flex: el wrapper crecía sin límite y la
    // barra nunca aparecía) ni `h-[85vh]` (que sumado a los paddings anidados
    // del wrapper y del modal desborda el viewport y el navegador recorta los
    // post-its "mordidos").
    //
    // BUG-10g: `aspect-[16/9]` SOLO NO BASTA. Fija el alto a partir del ANCHO
    // (1100px → ~619px); en una ventana BAJA (p. ej. 1366×600) `619px + 2rem`
    // > `100vh` y el tablero desborda el modal `items-center` (sin scroll),
    // recortando los post-its. Por eso DEBE llevar además un TOPE DURO de alto
    // al viewport: `max-h-[calc(100vh-2rem)]` (2rem = el `p-4` del modal).
    const tablero = container.firstChild.firstChild;
    expect(tablero.className).toContain(TOKENS_PIZARRON.tableroAspecto);
    expect(tablero.className).toContain(TOKENS_PIZARRON.tableroTopeAlto);
    expect(tablero.className).not.toContain('max-h-[85vh]');
    expect(tablero.className).not.toContain('h-[85vh]');
    expect(tablero.className).toContain('overflow-hidden');
    expect(tablero.className).toContain('flex-col');

    // El WRAPPER del grid es el contenedor con scroll y la barra estilizada.
    // (No el `<ul>`: si el grid llevara `flex-1`, sus filas se comprimirían y
    // los post-its `aspect-square` se encimarían — el bug que este fix cierra.)
    // BUG-10d: además necesita `min-h-0`; sin él, un hijo flex no puede
    // encogerse por debajo de su contenido y el scroll no desplaza.
    // BUG-10h: `overflow-y-scroll` (no `auto`) para que el carril de la barra
    // esté SIEMPRE reservado y la barra no dependa del modo overlay de Windows.
    const wrapper = container.querySelector('ul').parentElement;
    expect(wrapper.className).toContain(TOKENS_PIZARRON.wrapperScroll);
    expect(wrapper.className).not.toContain('overflow-y-auto');
    expect(wrapper.className).toContain(TOKENS_PIZARRON.wrapperScrollbar);
    expect(wrapper.className).toContain('flex-1');
    expect(wrapper.className).toContain('min-h-0');

    // El grid NO debe estirarse (`flex-1`) ni desplazarse: alto automático.
    const grid = container.querySelector('ul');
    expect(grid.className).toContain('content-start');
    expect(grid.className).not.toContain('flex-1');
    expect(grid.className).not.toContain('overflow-y-auto');
  });
});

// ---------------------------------------------------------------------------
// 10. Post-it cuadrado, sin alto fijo (BUG-10c, paridad con el POS viejo)
// ---------------------------------------------------------------------------

describe('BUG-10c — el post-it es cuadrado, no una caja de alto fijo', () => {
  it('cada post-it usa `aspect-square` y NO un `min-h` fijo', async () => {
    const cuentas = [
      // Un PEDIDO con poco texto: antes quedaba estirado por `min-h` y el
      // total se iba al fondo, dejando un hueco vacío enorme en medio.
      cuentaEjemplo({
        id: 'pedido-1',
        account_num: 'T-0001',
        order_type: 'PEDIDO',
        customer_name: 'Ana',
        delivery_type: 'PICKUP',
      }),
    ];
    const { container } = render(
      <OpenAccountsCorkboard terminalId="TERM-01" servicioCuentas={servicioCon(cuentas)} />
    );

    await waitFor(() => {
      expect(screen.getByTestId('folio-pedido-1')).toBeTruthy();
    });

    const postIt = container.querySelector('ul > li');
    // Cuadrado: alto = ancho de columna (como el POS viejo).
    expect(postIt.className).toContain('aspect-square');
    // Sin alto mínimo fijo: eso era lo que estiraba el post-it.
    expect(postIt.className).not.toContain('min-h-[11rem]');
    expect(postIt.className).not.toContain('min-h-[13rem]');
  });
});

// ---------------------------------------------------------------------------
// 11. El modal padre NO captura el scroll (BUG-10e)
// ---------------------------------------------------------------------------
//
// POR QUÉ ESTA COMPUERTA ES DISTINTA (y por qué la anterior no servía)
// ---------------------------------------------------------------------------
// La compuerta previa de BUG-10e mockeaba `clientHeight`/`scrollHeight` con
// valores HARDCODEADOS (800/1200) y luego afirmaba `1200 > 800`. Esa aserción
// es verdadera por construcción: pasa aunque el CSS esté roto. Se comprobó
// revirtiendo el fix del modal y viendo que el test seguía verde.
//
// Esta compuerta ataca la CAUSA RAÍZ real: el modal que monta el pizarrón en
// `RetailVisionPOS.jsx` tenía `overflow-y-auto` + `items-start`, lo que hacía
// que el SCROLL viviera en el overlay (el ancestro) en vez de en el wrapper
// interno del tablero. Con eso, la barra lateral del pizarrón nunca aparecía
// y el contenido se recortaba ("mordido"). El POS viejo usa un modal de
// centrado puro (`items-center`, SIN `overflow-y-auto`).
//
// La compuerta lee el FUENTE de `RetailVisionPOS.jsx` (no el DOM: jsdom no
// calcula layout) y exige que el contenedor del diálogo NO tenga
// `overflow-y-auto`. Si alguien reintroduce esa clase, el test FALLA.
//
// Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.

describe('BUG-10e — el modal padre NO captura el scroll del pizarrón', () => {
  it('el contenedor del diálogo no usa `overflow-y-auto` (el scroll vive en el tablero)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');

    const aqui = dirname(fileURLToPath(import.meta.url));
    // FD-10: el modal del pizarrón se delegó a posLayout/POSFlowOverlays.jsx
    const ruta = resolve(aqui, '..', 'posLayout', 'POSFlowOverlays.jsx');
    const fuente = readFileSync(ruta, 'utf8');

    // Aísla el bloque del modal del pizarrón: desde `pizarronAbierto ? (` hasta
    // el cierre del `<div>` del diálogo (el `>` que precede a `<OpenAccountsCorkboard`).
    const inicio = fuente.indexOf('pizarronAbierto ? (');
    expect(inicio).toBeGreaterThan(-1);

    const fin = fuente.indexOf('<OpenAccountsCorkboard', inicio);
    expect(fin).toBeGreaterThan(inicio);

    const bloqueModal = fuente.slice(inicio, fin);

    // El contenedor del diálogo NO debe capturar el scroll.
    expect(bloqueModal).not.toContain('overflow-y-auto');

    // Debe ser de centrado puro, como el POS viejo.
    expect(bloqueModal).toContain('items-center');
    expect(bloqueModal).toContain('justify-center');
    expect(bloqueModal).toContain('role="dialog"');
  });

  it('el tablero SÍ es el dueño del scroll (altura definida + wrapper con overflow)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');

    const aqui = dirname(fileURLToPath(import.meta.url));
    const ruta = resolve(aqui, 'OpenAccountsCorkboard.jsx');
    const fuente = readFileSync(ruta, 'utf8');

    // Aísla la línea del `className` del TABLERO (no los comentarios: el
    // comentario del fix menciona `max-h-[85vh]` y `h-[85vh]` a propósito,
    // para explicar por qué se descartaron; eso no debe hacer fallar la
    // compuerta).
    // FIX_UI_PARIDAD (11 Oct 2026) — Gemini restauró la estética del POS viejo:
    // el tablero pasó de los tokens `border-madera-veta bg-madera-panel` a
    // `border-[#3d2b1f] bg-black` + una textura de corcho superpuesta. La
    // compuerta se ancla ahora al token de borde vigente, que se lee de la
    // FUENTE ÚNICA (`tokensVigentes.js`), no hardcodeado aquí.
    const lineaTablero = fuente
      .split('\n')
      .find((l) => l.includes('className=') && l.includes(TOKENS_PIZARRON.tableroBorde));
    expect(lineaTablero).toBeTruthy();

    // Altura DEFINIDA y ACOTADA por el ancho (`aspect-[16/9]`, como el POS
    // viejo) MÁS un TOPE DURO al viewport (`max-h-[calc(100vh-2rem)]`).
    // BUG-10g: el `aspect` solo NO basta — fija el alto desde el ancho
    // (1100px → ~619px) y en una ventana BAJA (1366×600) `619px + 2rem` >
    // `100vh`, así que el tablero desborda el modal `items-center` (sin
    // scroll) y recorta los post-its. El `max-h` es el tope que lo evita.
    // NO `max-h-[85vh]` (un máximo no acota a los hijos flex) ni `h-[85vh]`
    // (que sumado a los paddings anidados desborda el viewport).
    expect(lineaTablero).toContain(TOKENS_PIZARRON.tableroAspecto);
    expect(lineaTablero).toContain(TOKENS_PIZARRON.tableroTopeAlto);
    expect(lineaTablero).not.toContain('max-h-[85vh]');
    expect(lineaTablero).not.toContain('h-[85vh]');

    // El wrapper de scroll con `min-h-0` (sin él, un hijo flex no se encoge).
    // BUG-10h: `overflow-y-scroll` fuerza el carril SIEMPRE visible.
    const lineaWrapper = fuente
      .split('\n')
      .find((l) => l.includes('className=') && l.includes(TOKENS_PIZARRON.wrapperScrollbar));
    expect(lineaWrapper).toBeTruthy();
    expect(lineaWrapper).toContain('min-h-0');
    expect(lineaWrapper).toContain(TOKENS_PIZARRON.wrapperScroll);
    expect(lineaWrapper).not.toContain('overflow-y-auto');
    expect(lineaWrapper).toContain('flex-1');

    // BUG-10h — la barra debe verse SIEMPRE, no solo al hacer scroll. Se exige
    // el carril estable y las propiedades estándar de color (no solo las
    // `::-webkit-scrollbar`, que en modo overlay quedan invisibles).
    expect(fuente).toContain('scrollbar-gutter: stable');
    expect(fuente).toContain('scrollbar-width: thin');
    expect(fuente).toContain('scrollbar-color:');
  });
});
