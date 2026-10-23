/**
 * `POSHeader` — interfaz 2 del registro de la superficie (Cabecera).
 *
 * Contenedor raíz declarado: `w-full flex items-center justify-between`.
 *   - MOSTRADOR (≥1024px): 3 zonas (terminal · estado · sesión/red).
 *   - COMPACTO (768–1023px): se oculta el texto de modo.
 *   - MÓVIL (<768px): se ocultan los textos secundarios; quedan los indicadores.
 *
 * Muestra:
 *   - IZQUIERDA: la terminal activa y el botón "Cambiar Estación".
 *   - CENTRO: el ESTADO DE LA CUENTA (NUEVA VENTA / COBRANDO / PAGADA) y el
 *     TIPO DE VENTA (canal: PANADERIA, etc.).
 *   - DERECHA: el estado de sesión y el INDICADOR DE RED (en línea / sin red).
 *
 * R-01: `w-full` en el contenedor raíz (fluido). R-04: el botón de terminal
 * respeta el target táctil de 44×44px.
 */

import React from 'react';

/** Etiquetas humanas del estado de la cuenta. */
const ETIQUETAS_ESTADO = Object.freeze({
  NUEVA_VENTA: 'Nueva Venta',
  COBRANDO: 'Cobrando…',
  PAGADA: 'Venta Cobrada',
});

/**
 * @param {object} props
 * @param {string} props.terminalId - terminal activa (p. ej. "TERM-01").
 * @param {string} [props.estado='NUEVA_VENTA'] - NUEVA_VENTA | COBRANDO | PAGADA.
 * @param {string} [props.tipoVenta] - canal de la venta (RN-13).
 * @param {boolean} [props.sesionAbierta=false] - ¿hay sesión de terminal activa?
 * @param {string} [props.estadoRed='good'] - semáforo de red: 'good'|'slow'|'down'.
 * @param {string} [props.etiquetaRed] - texto pre-formateado ("RED OK 9ms").
 * @param {string} [props.colorRed='green'] - color del semáforo.
 * @param {string} [props.modo] - modo de layout (R-03).
 * @param {() => void} [props.onCambiarEstacion] - abre el selector de terminal.
 * @param {() => void} [props.onAbrirVoz] - abre el panel de voz (F7.5).
 * @param {() => void} [props.onAbrirCliente] - abre el panel de identificación
 *   del cliente (F8.6). Es la UX heredada del viejo POS (§6.8): el botón vive
 *   en el header, la implementación se reescribe.
 * @param {boolean} [props.clienteIdentificado=false] - ¿hay un cliente ya
 *   identificado en la cuenta en curso? (F8.6). Si es `true`, el botón se
 *   resalta, igual que `pedidoProgramado`.
 * @param {boolean} [props.vozDisponible=true] - ¿está disponible el dictado por
 *   voz? (F7.6.1). Si es `false`, el botón de voz se deshabilita, igual que en
 *   el viejo POS (`#btn-dictado-voz` con `disabled={!voiceAvailable}`).
 *
 * NOTA (F7.6.1): el botón de VISIÓN se retiró del header. La visión es un MODO
 * DE VISTA que se conmuta desde la `CategoryBar` (UX heredada del viejo POS),
 * no un overlay que se abra desde aquí.
 */
export default function POSHeader({
  terminalId,
  estado = 'NUEVA_VENTA',
  // F12.19 — PARIDAD DE PRESENTACIÓN con el viejo POS (§6.8): el centro del
  // header mostraba `CTA {folio}` (no "NUEVA VENTA") en cuanto la cuenta tenía
  // folio, y un badge `📝 BORRADOR` mientras la cuenta estaba capturándose
  // (folio + líneas) y aún NO se había enviado al pizarrón (sin pedido).
  //   - `numeroCuenta`: el folio (`account_num`, RN-10) de la cuenta en curso.
  //   - `cartLength`: número de líneas del carrito (para el badge BORRADOR).
  numeroCuenta = null,
  cartLength = 0,
  tipoVenta,
  sesionAbierta = false,
  estadoRed = 'good',
  etiquetaRed = 'RED OK',
  colorRed = 'green',
  modo,
  onCambiarEstacion,
  onAbrirTema,
  onAbrirVoz,
  vozDisponible = true,
  onAbrirPedido,
  pedidoProgramado = false,
  // F12.1 — Selector VENTA DIRECTA / PEDIDO (UX heredada del viejo POS, §6.8).
  // El botón 📌 de programación SOLO aparece cuando el tipo es 'PEDIDO',
  // igual que en `apps/pos/components/POSHeader.jsx` (viejo POS).
  tipoPedido = 'VENTA_DIRECTA',
  onCambiarTipoPedido,
  onLimpiarPedido,
  onAbrirCliente,
  clienteIdentificado = false,
  onAbrirCaja,
  cajaAbierta = false,
  // F12.5 — Pizarrón de cuentas abiertas (F5.3). Punto de entrada al pizarrón:
  // sin este botón, el componente `OpenAccountsCorkboard` era inalcanzable
  // (13ª instancia de §10.6). Muestra el número de cuentas abiertas si se pasa.
  onAbrirPizarron,
  cuentasAbiertas = 0,
  // D1 — El turno de caja activo determina si el pizarrón muestra TOTALES o MÍAS.
  turnoCaja = null,
  // P1 — Guardia de empaque (Capa 1: badge pasivo).
  // `empaqueRequerido`: el pedido programado marcó "Vender Empaque" (packaging_type !== PROPIO).
  // `empaqueEnCarrito`: hay al menos un producto con nature === 'EMPAQUE' en el carrito.
  empaqueRequerido = false,
  empaqueEnCarrito = false,
}) {
  const etiquetaEstado = ETIQUETAS_ESTADO[estado] || ETIQUETAS_ESTADO.NUEVA_VENTA;
  // BUG-05 — CAJA NO es una terminal. Toda terminal es una caja en potencia, así
  //   que el encabezado siempre rotula `Terminal <id>`; el modo "ver todas las
  //   cuentas" lo gobierna el turno de caja abierto, no un id llamado `CAJA`.
  const nombreTerminal = `Terminal ${terminalId || '—'}`;

  // F12.19 — PARIDAD DE PRESENTACIÓN con el viejo POS (§6.8):
  //   - Si hay folio (`numeroCuenta`), el centro muestra `CTA {folio}` en vez
  //     de la etiqueta de estado. Es lo que el cajero ve al capturar.
  //   - El badge `📝 BORRADOR` aparece mientras la cuenta se está capturando
  //     (folio + al menos una línea) y aún NO se envió al pizarrón (sin pedido).
  //     Espejo exacto de `currentAccountNum && cartLength > 0 && !orderData`.
  const etiquetaCentro = numeroCuenta ? `CTA ${numeroCuenta}` : etiquetaEstado;
  const mostrarBorrador = Boolean(numeroCuenta) && cartLength > 0 && !pedidoProgramado;

  return (
    <header className="w-full flex items-center justify-between px-4 py-3 bg-fondo-profundo-alt border-b border-white/5 z-20">
      {/* IZQUIERDA: Terminal + indicador de red (sub-línea, como el viejo POS) */}
      <button
        type="button"
        onClick={onCambiarEstacion}
        className="min-h-tactil bg-fondo-profundo border border-white/5 px-6 py-2 rounded-xl flex items-center transition-all group shadow-2xl hover:bg-fondo-panel"
      >
        <div className="text-left">
          <p className="text-[18px] font-black uppercase text-crema-ticket tracking-widest leading-none mb-1">
            {nombreTerminal}
          </p>
          <p className="text-[14px] font-black text-acento uppercase tracking-tighter leading-none">
            Cambiar Estación
          </p>
          {/* Indicador de red con latencia — reubicado aquí desde el span suelto
              del header. Asocia visualmente la salud de la red con la terminal.
              Semáforo de 3 colores: verde (good), amarillo (slow), rojo (down). */}
          <p className={`text-[10px] md:text-xs font-black uppercase tracking-widest leading-none mt-1 flex items-center gap-1 ${
            colorRed === 'green' ? 'text-green-400'
            : colorRed === 'yellow' ? 'text-yellow-400'
            : 'text-red-500'
          }`}>
            <span
              aria-hidden="true"
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                colorRed === 'green' ? 'bg-green-400'
                : colorRed === 'yellow' ? 'bg-yellow-400'
                : 'bg-red-500 animate-pulse'
              }`}
            />
            {etiquetaRed}
          </p>
        </div>
      </button>

      {/* CENTRO: Estado de la cuenta + tipo de venta + selector Venta/Pedido */}
      <div className="flex items-center gap-3 flex-1 justify-center">
        {/* F8.6 — Cliente. Reubicado a la izquierda de NUEVA VENTA para jerarquía visual */}
        <button
          type="button"
          onClick={() => onAbrirCliente?.()}
          className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 ${
            clienteIdentificado
              ? 'bg-acento text-fondo-profundo shadow-lg'
              : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
          }`}
          title={clienteIdentificado ? 'Cliente identificado' : 'Identificar cliente'}
          aria-label="Identificar cliente"
        >
          <span aria-hidden="true" className="text-[12px] leading-none mt-0.5">👤</span>
          <span className="leading-none mt-0.5">Cliente</span>
        </button>

        <div className="bg-fondo-profundo border border-white/10 px-8 py-2 rounded-3xl shadow-2xl flex flex-col items-center">
          <span className="text-[7px] font-black uppercase text-crema-ticket tracking-[0.5em] mb-0.5">
            Estado de Transaccion
          </span>
          {/* F12.19 — `CTA {folio}` cuando hay cuenta; si no, la etiqueta de
              estado (Nueva Venta / Cobrando… / Venta Cobrada). */}
          <span className="text-3xl font-black uppercase tracking-tighter italic text-acento drop-shadow-[0_0_12px_rgba(193,215,46,0.4)]">
            {etiquetaCentro}
          </span>
          {/* F12.19 — Badge BORRADOR (paridad con el viejo POS): la cuenta se
              está capturando y aún NO se envió al pizarrón. */}
          {mostrarBorrador ? (
            <span className="text-[8px] font-black uppercase text-amber-400 tracking-widest mt-0.5">
              📝 Borrador
            </span>
          ) : null}
          {tipoVenta ? (
            <span className="hidden sm:inline text-[8px] font-black uppercase text-crema-ticket/50 tracking-[0.3em] mt-0.5">
              {tipoVenta}
            </span>
          ) : null}
          {/* F12.1 — Badge de pedido tentativo (UX heredada del viejo POS).
              P1 — Capa 1: si se marcó "Vender Empaque" pero no hay empaque en
              el carrito, el badge cambia a advertencia para recordar al cajero. */}
          {pedidoProgramado ? (
            empaqueRequerido && !empaqueEnCarrito ? (
              <span className="text-[8px] font-black uppercase text-peligro tracking-widest mt-0.5 animate-pulse">
                📦 ⚠️ Sin empaque
              </span>
            ) : (
              <span className="text-[8px] font-black uppercase text-acento tracking-widest mt-0.5">
                📦 Pedido tentativo
              </span>
            )
          ) : null}
        </div>

        {/* F12.1 — Selector VENTA DIRECTA / PEDIDO (UX heredada del viejo POS,
            §6.8). Gobierna la aparición del botón 📌 de programación. Al volver
            a VENTA DIRECTA se limpia el bloque de pedido ya capturado. */}
        {/* F12.1 — Selector VENTA DIRECTA / PEDIDO (UX heredada del viejo POS) */}
        <div className="flex bg-black/60 border border-white/10 rounded-2xl p-1 gap-1">
          <button
            type="button"
            id="btn-venta-directa"
            onClick={() => {
              onCambiarTipoPedido?.('VENTA_DIRECTA');
              onLimpiarPedido?.();
            }}
            aria-pressed={tipoPedido === 'VENTA_DIRECTA'}
            className={`min-h-tactil px-4 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
              tipoPedido === 'VENTA_DIRECTA'
                ? 'bg-acento text-black shadow-lg'
                : 'text-white/50 hover:text-white'
            }`}
          >
            Venta Directa
          </button>
          <button
            type="button"
            id="btn-pedido"
            onClick={() => onCambiarTipoPedido?.('PEDIDO')}
            aria-pressed={tipoPedido === 'PEDIDO'}
            className={`min-h-tactil px-4 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
              tipoPedido === 'PEDIDO'
                ? 'bg-orange-500 text-white shadow-lg'
                : 'text-white/50 hover:text-white'
            }`}
          >
            📦 Pedido
          </button>
        </div>
        
        {/* F7.5.6 — Programar pedido (puente POS → Pedidos). Movido aquí para coincidir 
            con la UX heredada del viejo POS. Se resalta cuando ya hay un pedido programado. */}
        {tipoPedido === 'PEDIDO' ? (
          <button
            type="button"
            id="btn-programacion-pedido"
            onClick={() => onAbrirPedido?.()}
            className={`min-h-tactil px-5 rounded-2xl flex items-center justify-center transition-all shadow-lg border ${
              pedidoProgramado
                ? 'bg-acento-calido text-black border-acento-calido'
                : 'bg-fondo-profundo border-acento-calido/40 text-acento-calido hover:bg-acento-calido/10'
            }`}
            title={pedidoProgramado ? 'Pedido programado' : 'Programar pedido'}
            aria-label="Programar pedido"
          >
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center leading-none">
                <span className="text-[12px] font-black uppercase tracking-widest">Programación</span>
                <span className="text-[8px] font-black uppercase tracking-[0.3em] opacity-80 mt-0.5">del pedido</span>
              </div>
              <span aria-hidden="true" className="text-[16px] drop-shadow-md">📅</span>
            </div>
          </button>
        ) : null}
      </div>

      {/* DERECHA: Acciones de IA (F7.5/F7.6) + Sesión + Red + Modo */}
      <div className="flex items-center gap-2">
        {/* ── DERECHA: Voz → Caja → Pizarrón ──────────────────────────────
            Orden y estilo heredados del viejo POS (§6.8): cada botón es un
            rectángulo con TÍTULO GRANDE arriba + ESTADO/ACCIÓN abajo en acento.
            El viejo POS usaba este patrón en los 3 botones; el nuevo lo adopta
            para mantener coherencia visual. */}

        {/* VOZ — dictado por voz al carrito (F7.5.2) */}
        <button
          type="button"
          id="btn-dictado-voz"
          onClick={() => onAbrirVoz?.()}
          disabled={!vozDisponible}
          className={`min-h-tactil border rounded-xl px-3 md:px-5 py-2 flex items-center transition-all shadow-xl ${
            vozDisponible
              ? 'bg-fondo-profundo border-acento/40 hover:bg-acento/20 hover:border-acento'
              : 'bg-fondo-profundo/40 border-white/5 cursor-not-allowed opacity-40'
          }`}
          title={vozDisponible ? 'Dictar productos por voz' : 'Dictado por voz no disponible'}
          aria-label="Dictado por voz"
        >
          <div className="text-left">
            <p className="hidden md:block text-[18px] font-black uppercase text-crema-ticket tracking-widest leading-none mb-1">
              Voz
            </p>
            <p className={`text-xs md:text-[14px] font-black uppercase tracking-tighter leading-none ${
              vozDisponible ? 'text-acento' : 'text-acento/40'
            }`}>
              🎙️ <span className="hidden sm:inline">Dictar</span>
            </p>
          </div>
        </button>

        {/* CAJA — gestor de caja (F4.5.1).
            F12.8 — El estado "● Activa / ○ Habilitar" refleja el TURNO DE CAJA
            REAL (`turnoCaja`), no la visibilidad del overlay (`cajaAbierta`).
            Antes, abrir el gestor pintaba "● Activa" aunque no hubiera turno
            abierto: dos fuentes de verdad para el mismo concepto. El viejo POS
            usaba una sola (`isCashEnabled`); aquí se unifica en `turnoCaja`. */}
        <button
          type="button"
          onClick={() => onAbrirCaja?.()}
          className={`min-h-tactil border rounded-xl px-3 md:px-5 py-2 flex items-center transition-all shadow-xl ${
            turnoCaja
              ? 'bg-fondo-profundo border-acento/40 hover:bg-acento/20 hover:border-acento'
              : 'bg-fondo-profundo border-acento/40 hover:bg-acento/20 hover:border-acento'
          }`}
          title={turnoCaja ? 'Gestionar Caja (Activa)' : 'Habilitar como Caja'}
          aria-label="Gestor de caja"
        >
          <div className="text-left">
            <p className="hidden md:block text-[18px] font-black uppercase text-crema-ticket tracking-widest leading-none mb-1">
              Caja
            </p>
            <p className={`text-xs md:text-[14px] font-black uppercase tracking-tighter leading-none ${
              turnoCaja ? 'text-acento' : 'text-acento/60'
            }`}>
              {turnoCaja ? '● Activa' : '○ Habilitar'}
            </p>
          </div>
        </button>

        {/* PIZARRÓN — cuentas abiertas (F12.5) */}
        <button
          type="button"
          onClick={() => onAbrirPizarron?.()}
          className="min-h-tactil border rounded-xl px-3 md:px-5 py-2 flex items-center transition-all shadow-xl bg-madera-oscura-panel border-orange-900/40 hover:bg-madera-oscura hover:border-orange-500/50"
          title="Pizarrón de cuentas abiertas"
          aria-label="Pizarrón de cuentas abiertas"
        >
          <div className="text-left">
            <p className="hidden md:block text-[18px] font-black uppercase text-crema-ticket tracking-widest leading-none mb-1">
              Pizarrón
            </p>
            <p className="text-xs md:text-[14px] font-black text-orange-500 uppercase tracking-tighter leading-none">
              {cuentasAbiertas} {turnoCaja ? 'totales' : 'mías'}
            </p>
          </div>
        </button>

      </div>
    </header>
  );
}
