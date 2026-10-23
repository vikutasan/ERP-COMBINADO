/**
 * `SalesReceipt` — interfaz 14 del registro de la superficie (Panel).
 *
 * Réplica estética del POS viejo:
 *   - Fondo crema (#fdfbf7) con texto negro, fuente mono.
 *   - Borde zigzag en la parte superior (SVG).
 *   - Encabezado con "R DE RICO" en font-black uppercase + "Ticket de Venta".
 *   - Líneas con cantidad grande (3xl) + nombre uppercase + importe.
 *   - Ticket vacío: "★ El ticket esta vacio ★" con borde dashed.
 *   - Footer con total + botón COBRAR verde.
 *
 * FASE 3.4 añade:
 *   - BANNER DE ESTADO: aviso persistente (fijo, no auto-ocultable) cuando hay
 *     un error de persistencia o ítems no verificados (Regla 19 / prohibición #2).
 *
 * F12.23 — PARIDAD DE UX DE CANTIDAD (rescate del viejo POS):
 *   El viejo POS (`apps/pos/components/SalesReceipt.jsx:9-38, 203-241`) NO usaba
 *   botones −/+. La cantidad era un NÚMERO CLICABLE: al pulsarlo se abría un
 *   TECLADO NUMÉRICO en pantalla para teclear la cantidad exacta (útil para
 *   cantidades grandes sin dar muchos taps). El nuevo POS había sustituido eso
 *   por botones −/+ laterales, que son lentos para cantidades grandes.
 *
 *   Aquí se restaura la operación heredada: la cantidad es un botón que abre el
 *   modal `TecladoNumerico` (ya existente, F9.0.2). Al confirmar se emite
 *   `onCambiarCantidad(linea, nuevaCantidad)`; con 0 se quita la línea.
 *   Es la 24ª instancia de §10.6 (de adentro hacia afuera): el teclado existía
 *   pero estaba cableado SOLO al cobro; su operación de edición de cantidad se
 *   perdió en la traducción.
 *
 * R-01: `w-full max-w-[420px]` es fluido. R-04: botones ≥ 44px.
 */

import React, { useState } from 'react';

import TecladoNumerico from './TecladoNumerico.jsx';

/** Formatea un precio numérico como moneda mexicana. */
function formatearPrecio(valor) {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return '$0.00';
  return `$${numero.toFixed(2)}`;
}

/**
 * Calcula el total del ticket sumando subtotales (RN-16).
 *
 * DT-02 regla 6: el dinero NO se suma en el frontend. Esta función SOLO se usa
 * como FALLBACK en modo puramente local (sin ticket en el servidor). Cuando hay
 * un ticket, el total viene del BACKEND y se pasa por la prop `total`.
 */
export function calcularTotal(lineas) {
  // DT-02-FALLBACK-LOCAL: única suma de dinero permitida en el frontend, y SOLO
  // en modo puramente local (sin ticket en el servidor). El guard E-09-FE la
  // tolera por el marcador explícito.
  return lineas.reduce((acc, l) => acc + Number(l.unit_price) * l.quantity, 0); // DT-02-FALLBACK-LOCAL
}

export default function SalesReceipt({
  lineas,
  // DT-02 regla 6: el total del ticket viene del BACKEND (`carrito.total`,
  // `Numeric(12,2)`). Si se provee, se usa tal cual; `calcularTotal` solo es el
  // fallback de modo local (sin ticket en el servidor).
  total: totalBackend = null,
  onIncrementar,
  onDecrementar,
  onQuitar,
  // F12.23 — PARIDAD DE UX DE CANTIDAD (§6.8): el viejo POS editaba la cantidad
  // con un TECLADO NUMÉRICO en pantalla, no con botones −/+. `onCambiarCantidad`
  // recibe la línea y la cantidad EXACTA tecleada; con 0 se quita la línea.
  // Se conservan `onIncrementar`/`onDecrementar` por retrocompatibilidad de las
  // compuertas existentes, pero la UI ya NO los usa.
  onCambiarCantidad,
  onCobrar,
  // F12.9 — Paridad de operación con el viejo POS (§6.8): el viejo POS tenía
  // DOS botones distintos, no uno:
  //   1. COBRAR          → `handleCheckout()`   — gateado por `cashEnabled`.
  //   2. ENVIAR CUENTA   → `handleHoldAccount()` — NO gateado por `cashEnabled`.
  // El nuevo POS los había CONFLACIONADO en un solo botón, de modo que el gate
  // de caja (F12.8) bloqueaba también el envío al pizarrón. Eso rompía el flujo
  // real: una terminal SIN caja debe poder enviar la cuenta al pizarrón. Aquí
  // se restauran los dos botones con sus gates independientes (16ª instancia
  // de §10.6 — el inventario de componentes no ve la paridad de operación).
  onEnviarCuenta,
  enviandoCuenta = false,
  cobrando,
  terminalId,
  banner,
  // F12.8 — El COBRO solo se habilita cuando la terminal está habilitada como
  // caja (turno abierto). El backend sigue siendo la autoridad final (RN-49).
  cajaHabilitada = false,
  // F12.14 — REGLA 13: sin conexión, el botón ENVIAR CUENTA se bloquea. El viejo
  // POS bloqueaba este botón con `hasUnsavedItems` (derivado de `lastSaveStatus`)
  // y el título "Verifique la conexión WiFi". El nuevo POS ya expone la señal
  // equivalente (`useNetworkHealth().botonBloqueado` = `!enLinea`); aquí se
  // cablea al botón. Es la 23ª instancia de §10.6 (de adentro hacia afuera).
  sinRed = false,
}) {
  // DT-02 regla 6: el total viene del BACKEND cuando hay ticket. `calcularTotal`
  // solo se usa como fallback en modo puramente local (sin ticket en servidor).
  const total = totalBackend !== null ? Number(totalBackend) : calcularTotal(lineas);
  const vacio = lineas.length === 0;
  // El botón COBRAR se bloquea si el ticket está vacío, si ya se está cobrando
  // o si la caja NO está habilitada (F12.8).
  const cobroBloqueado = vacio || cobrando || !cajaHabilitada;
  // F12.9 — El botón ENVIAR CUENTA NO depende de la caja: solo exige que haya
  // líneas y que no haya un envío en curso. Es el camino válido sin caja.
  // F12.14 — REGLA 13: además se bloquea si NO hay red (no se puede persistir).
  const envioBloqueado = vacio || enviandoCuenta || sinRed;

  // F12.23 — Estado del modal de edición de cantidad (teclado numérico).
  // `lineaEditando` es la línea cuyo número se está tecleando; `cantidadTexto`
  // es la captura en curso (string, como en el viejo POS). El modal es local al
  // componente: no toca el carrito hasta que se confirma con OK.
  const [lineaEditando, setLineaEditando] = useState(null);
  const [cantidadTexto, setCantidadTexto] = useState('');

  /** Abre el teclado numérico con la cantidad actual de la línea precargada. */
  function abrirTecladoCantidad(linea) {
    setLineaEditando(linea);
    setCantidadTexto(String(linea.quantity ?? 1));
  }

  /** Cierra el teclado sin aplicar cambios. */
  function cancelarTecladoCantidad() {
    setLineaEditando(null);
    setCantidadTexto('');
  }

  /**
   * Confirma la cantidad tecleada. Reglas heredadas del viejo POS
   * (`SalesReceipt.jsx:24-33`):
   *   - Cantidad > 0 → `onCambiarCantidad(linea, n)`.
   *   - Cantidad === 0 → se quita la línea (`onQuitar`).
   *   - Captura vacía o inválida → se cancela (no se aplica nada).
   */
  function confirmarTecladoCantidad() {
    if (!lineaEditando) return;
    const nueva = parseInt(cantidadTexto, 10);
    if (Number.isNaN(nueva)) {
      cancelarTecladoCantidad();
      return;
    }
    if (nueva === 0) {
      onQuitar(lineaEditando);
    } else if (onCambiarCantidad) {
      onCambiarCantidad(lineaEditando, nueva);
    }
    cancelarTecladoCantidad();
  }

  return (
    <aside className="w-full max-w-[420px] flex flex-col bg-crema-ticket text-fondo-profundo shadow-2xl relative border-l border-fondo-profundo/10 overflow-visible transition-all duration-500 font-mono z-50">

      {/* Borde zigzag superior (como el ticket viejo) */}
      <div className="absolute top-[-14px] left-0 right-0 w-full overflow-hidden" style={{ height: '14px' }}>
        <svg viewBox="0 0 420 14" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
          <path d="M0,14 L10,0 L20,14 L30,0 L40,14 L50,0 L60,14 L70,0 L80,14 L90,0 L100,14 L110,0 L120,14 L130,0 L140,14 L150,0 L160,14 L170,0 L180,14 L190,0 L200,14 L210,0 L220,14 L230,0 L240,14 L250,0 L260,14 L270,0 L280,14 L290,0 L300,14 L310,0 L320,14 L330,0 L340,14 L350,0 L360,14 L370,0 L380,14 L390,0 L400,14 L410,0 L420,14 Z" fill="rgb(var(--crema-ticket))" />
        </svg>
      </div>

      {/* BANNER DE ESTADO: persistente, no se auto-oculta (Regla 19) */}
      {banner ? (
        <div
          role="alert"
          className={`px-6 py-2 text-[11px] font-black uppercase tracking-wider border-b-2 ${
            banner.tipo === 'error'
              ? 'bg-peligro/15 text-peligro border-peligro/40'
              : 'bg-acento/20 text-fondo-profundo border-acento/50'
          }`}
        >
          {banner.mensaje}
        </div>
      ) : null}

      {/* Encabezado: R DE RICO — Ticket de Venta */}
      <header className="px-6 pt-6 pb-3 border-b-[1.5px] border-dashed border-fondo-profundo/30 flex justify-between items-start -mt-0">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-fondo-profundo/10 rounded-full flex items-center justify-center text-2xl">🏪</div>
          <div className="flex flex-col justify-center pt-1">
            <h2 className="text-base font-black uppercase tracking-widest leading-none text-fondo-profundo">R DE RICO</h2>
            <h3 className="text-[11px] font-bold text-fondo-profundo/50 uppercase tracking-widest mt-1">Ticket de Venta</h3>
          </div>
        </div>
        <div className="flex flex-col items-end justify-center text-xs text-fondo-profundo/50 pt-1">
          <p className="leading-none mb-1 font-black">Term {terminalId || '01'}</p>
          <p className="leading-none">{new Date().toLocaleDateString()}</p>
        </div>
      </header>

      {/* Encabezado de columnas */}
      <div className="flex justify-between text-xs text-fondo-profundo/60 font-black border-b-2 border-fondo-profundo/20 pb-2 pt-2 mb-1 uppercase tracking-wider px-6">
        <span>Cant. - Articulo</span>
        <span>Importe</span>
      </div>

      {/* Líneas del ticket */}
      <div className="flex-1 overflow-y-auto px-6 py-3">
        {vacio ? (
          <div className="h-full flex flex-col items-center justify-center text-fondo-profundo/40 space-y-4">
            <p className="font-mono text-xs uppercase text-center border-2 border-dashed border-fondo-profundo/20 p-4 w-full">
              ★ El ticket esta vacio ★
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {lineas.map((linea) => (
              <li key={linea.item_id || linea.product_id} className="flex justify-between items-start group">
                <div className="flex gap-3 w-3/4">
                  {/* F12.23 — EDICIÓN DE CANTIDAD: la cantidad es un BOTÓN que
                      abre el teclado numérico (paridad con el viejo POS). Se
                      eliminaron los botones −/+ laterales. Target táctil ≥44px. */}
                  <button
                    type="button"
                    aria-label={`Modificar cantidad de ${linea.name}`}
                    title="Modificar cantidad"
                    onClick={() => abrirTecladoCantidad(linea)}
                    className="min-h-tactil min-w-tactil flex items-center justify-center rounded-full bg-fondo-profundo/10 text-fondo-profundo font-black text-3xl leading-none hover:bg-fondo-profundo/20 hover:text-acento active:scale-95 transition-all px-2"
                  >
                    {linea.quantity}x
                  </button>
                  <div>
                    <p className="font-black text-lg uppercase leading-tight text-fondo-profundo/90">{linea.name}</p>
                    <p className="text-base text-fondo-profundo/50 uppercase">{formatearPrecio(linea.unit_price)} c/u</p>
                  </div>
                </div>
                <div className="text-right flex flex-col items-end">
                  <p className="font-black text-2xl">{formatearPrecio(Number(linea.unit_price) * linea.quantity)}</p>
                  <button
                    type="button"
                    onClick={() => onQuitar(linea)}
                    className="text-[9px] text-peligro font-bold uppercase opacity-0 group-hover:opacity-100 transition-opacity mt-1 hover:underline"
                  >
                    [ Quitar ]
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer: Total + DOS botones (F12.9 — paridad de operación con el viejo POS).
          El viejo POS separaba COBRAR (gateado por caja) de ENVIAR CUENTA (no
          gateado). Aquí se restauran ambos con sus gates independientes. */}
      <footer className="px-6 py-4 border-t-2 border-dashed border-fondo-profundo/30 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[9px] font-black uppercase text-fondo-profundo/40 tracking-widest">
              {cajaHabilitada ? 'Total a Pagar' : 'Caja no habilitada'}
            </span>
            <span className="text-xl font-black uppercase">COBRAR</span>
          </div>
          <span className="text-3xl font-black font-mono tracking-tight">{formatearPrecio(total)}</span>
        </div>

        {/* Botón 1 — COBRAR: gateado por caja (F12.8). Abre el modal de pago. */}
        <button
          type="button"
          disabled={cobroBloqueado}
          onClick={onCobrar}
          title={!cajaHabilitada ? 'Presione "🏦 CAJA" para habilitar el cobro' : ''}
          className={`w-full min-h-[60px] rounded-canon35 font-black text-xl uppercase tracking-widest transition-all shadow-xl active:scale-95 ${
            cajaHabilitada
              ? 'bg-acento text-fondo-profundo hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed'
              : 'bg-fondo-profundo/15 text-fondo-profundo/40 cursor-not-allowed'
          }`}
        >
          {cobrando ? '⏳ Cobrando…' : '💰 COBRAR'}
        </button>

        {/* Botón 2 — ENVIAR CUENTA: NO gateado por caja (F12.9). Es el camino
            válido cuando la terminal no tiene turno de caja abierto. La cuenta
            ya está persistida por ítem (contratos 18–20); enviarla solo la deja
            en el pizarrón y abre una cuenta nueva. */}
        <button
          type="button"
          disabled={envioBloqueado}
          onClick={onEnviarCuenta}
          title={
            sinRed
              ? '⛔ No se puede enviar: sin conexión. Verifique la red WiFi.'
              : vacio
                ? 'Agregue al menos un producto para enviar la cuenta'
                : ''
          }
          className={`w-full min-h-[60px] rounded-canon35 font-black text-lg uppercase tracking-widest transition-all shadow-xl active:scale-95 border-2 border-fondo-profundo ${
            envioBloqueado
              ? 'bg-fondo-profundo/10 text-fondo-profundo/40 cursor-not-allowed'
              : 'bg-crema-ticket text-fondo-profundo hover:bg-fondo-profundo hover:text-crema-ticket'
          }`}
        >
          {enviandoCuenta ? '⏳ Enviando…' : '📌 ENVIAR CUENTA'}
        </button>
      </footer>

      {/* F12.23 — MODAL DE EDICIÓN DE CANTIDAD (teclado numérico en pantalla).
          Paridad con el viejo POS (`SalesReceipt.jsx:203-241`): al pulsar la
          cantidad de una línea se abre este teclado para teclear la cantidad
          exacta. Reutiliza `TecladoNumerico` (F9.0.2) — el mismo componente que
          el cobro usa para el efectivo. Confirmar aplica; Cancelar descarta. */}
      {lineaEditando ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-fondo-profundo/80 backdrop-blur-md p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Modificar cantidad de ${lineaEditando.name}`}
        >
          <div className="bg-fondo-panel p-6 rounded-canon35 shadow-2xl border border-white/10 flex flex-col items-center w-full max-w-[360px]">
            <h3 className="text-crema-ticket text-lg font-black uppercase tracking-widest mb-1 text-center">
              Modificar Cantidad
            </h3>
            <p className="text-acento font-bold text-xl uppercase mb-4 text-center">
              {lineaEditando.name}
            </p>

            {/* Visor de la captura en curso */}
            <div className="w-full bg-crema-ticket text-fondo-profundo p-4 rounded-canon35 text-5xl font-black text-right shadow-inner min-h-[80px] flex items-center justify-end mb-4">
              {cantidadTexto || '0'}
            </div>

            {/* Teclado numérico reutilizado (F9.0.2) */}
            <div className="w-full mb-4">
              <TecladoNumerico valor={cantidadTexto} onCambiar={setCantidadTexto} />
            </div>

            {/* Acciones: Cancelar / OK */}
            <div className="grid grid-cols-2 gap-3 w-full">
              <button
                type="button"
                onClick={cancelarTecladoCantidad}
                className="min-h-tactil rounded-canon35 bg-fondo-profundo/40 text-crema-ticket font-black uppercase tracking-widest text-sm hover:bg-fondo-profundo/60 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarTecladoCantidad}
                className="min-h-tactil rounded-canon35 bg-acento text-fondo-profundo font-black uppercase tracking-widest text-sm hover:brightness-95 transition-all shadow-lg"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
