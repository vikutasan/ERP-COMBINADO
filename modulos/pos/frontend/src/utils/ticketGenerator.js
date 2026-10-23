/**
 * `ticketGenerator` — generador de HTML térmico autosuficiente (FASE 6.0).
 *
 * Porta el patrón del POS viejo (`apps/pos/utils/ticketGenerator.js`, 266 líneas)
 * y lo UNIFICA: tanto el ticket de venta como el corte de caja se generan como
 * strings HTML autosuficientes (con su `<style>` embebido, sin CDN, sin DOM).
 *
 * DECISIÓN ARQUITECTÓNICA (Plan de Fase 6 §4, corrige D-6):
 *   El POS viejo imprimía el ticket con un string HTML pero el corte tomando
 *   `innerHTML` de un componente React + Tailwind por CDN. Esa asimetría es un
 *   DEFECTO (el corte se imprimía sin estilos si no había internet). El POS
 *   nuevo NO copia el defecto: ambos documentos son strings puros.
 *
 * PRINCIPIOS:
 *   - Funciones PURAS: reciben datos, devuelven un string. Testeables sin navegador.
 *   - CERO dependencias externas: ningún `http://` ni `https://` (autosuficiencia).
 *   - CERO DOM: no usan `document` ni `window`.
 *   - Ninguna función supera 20 líneas ni 3 niveles de anidación (E-16).
 *
 * @see PLAN_DE_ABORDAJE_FASE_6_POR_PARTES.md §6 (Sub-fase 6.0)
 * @see apps/pos/utils/ticketGenerator.js (POS viejo — referencia portada)
 */

/** Ancho físico del rollo térmico. Es ancho de PAPEL, no responsivo (exento R-01). */
const ANCHO_TERMICO = '80mm';

/** Formatea un valor como moneda con 2 decimales. Nunca lanza. */
function moneda(valor) {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return '$0.00';
  return `$${numero.toFixed(2)}`;
}

/** Formatea un instante ISO a fecha/hora local legible. Nunca lanza. */
function fechaHora(instante) {
  const fecha = instante ? new Date(instante) : new Date();
  if (Number.isNaN(fecha.getTime())) return '—';
  const dia = fecha.toLocaleDateString('es-MX');
  const hora = fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  return `${dia} ${hora}`;
}

/**
 * Hoja de estilo embebida compartida por ambos documentos.
 * Autosuficiente: no referencia ninguna CDN ni fuente externa.
 */
function estilosTermicos() {
  return `
    @page { size: ${ANCHO_TERMICO} auto; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      font-family: 'Courier New', Courier, monospace;
      width: 76mm; padding: 0mm 1mm; font-size: 8pt; line-height: 1.15;
      color: #000; background: #fff; font-weight: bold;
    }
    .line { border-top: 1px dashed #000; margin: 2px 0; }
    .row { display: flex; justify-content: space-between; align-items: center; }
    .col { display: flex; flex-direction: column; }
    .bold { font-weight: bold; }
    .upper { text-transform: uppercase; }
    .center { text-align: center; }
    .small { font-size: 7pt; }
    .xsmall { font-size: 6.5pt; }
    table { width: 100%; border-collapse: collapse; font-size: 8pt; font-weight: bold; }
    td { padding: 1px 0; vertical-align: top; }
    .audit { font-size: 7pt; text-transform: uppercase; margin-top: 3px; padding-top: 2px; border-top: 1px dashed #000; }
    /* F12.2 — doble copia del ticket de PEDIDO: la térmica corta entre copias. */
    .ticket-copy { page-break-after: always; }
    .ticket-copy:last-child { page-break-after: auto; }
  `;
}

/** Envuelve un cuerpo HTML en un documento térmico completo y autosuficiente. */
function documentoTermico(cuerpo) {
  return `<html><head><meta charset="UTF-8"><style>${estilosTermicos()}</style></head><body>${cuerpo}</body></html>`;
}

/** Encabezado común: logo + nombre del negocio. */
function encabezadoNegocio() {
  return `
    <div class="row center" style="justify-content: center; gap: 6px; margin-bottom: 2px;">
      <img src="/assets/logo.png" alt="Logo" style="width: 32px; height: 32px; object-fit: contain; image-rendering: pixelated;" />
      <div class="bold upper" style="font-size: 12pt; letter-spacing: 0.5px;">R DE RICO</div>
    </div>
  `;
}

/** Una línea de producto del ticket (cantidad, nombre, precio unitario, importe). */
function lineaProducto(linea) {
  const nombre = linea.nombre || linea.name || 'Artículo';
  const cantidad = Number(linea.cantidad ?? linea.quantity ?? 1);
  const precio = Number(linea.precio_unitario ?? linea.unit_price ?? linea.price ?? 0);
  return `
    <tr>
      <td style="width: 28px;">${cantidad}x</td>
      <td style="max-width: 44mm;">
        <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nombre}</div>
        <div>${moneda(precio)} c/u</div>
      </td>
      <td style="text-align: right; white-space: nowrap;">${moneda(precio * cantidad)}</td>
    </tr>
  `;
}

/** Bloque de líneas del ticket, o un aviso si no hay ninguna. */
function bloqueLineas(lineas) {
  if (!lineas || lineas.length === 0) {
    return `<div class="center small" style="margin: 4px 0;">— sin líneas —</div>`;
  }
  const filas = lineas.map(lineaProducto).join('');
  return `<table style="margin: 2px 0;"><tbody>${filas}</tbody></table>`;
}

/** Suma la cantidad total de artículos del ticket. */
function totalArticulos(lineas) {
  if (!lineas || lineas.length === 0) return 0;
  return lineas.reduce((acc, l) => acc + Number(l.cantidad ?? l.quantity ?? 1), 0);
}

/**
 * Etiqueta legible de un método de pago (incluye el tipo de tarjeta).
 * Acepta las dos formas del contrato:
 *   - canónica: `{ metodo: 'TARJETA', tipo: 'DEBITO' }` → 'Tarjeta débito'
 *   - método directo: `{ metodo: 'DEBITO' }` → 'Débito'
 *     (CREDITO/DEBITO son métodos de primera clase en `checkoutService.js`).
 */
function etiquetaMetodoPago(pago) {
  const metodo = String(pago.metodo || '').toUpperCase();
  const tipo = String(pago.tipo || '').toUpperCase();
  if (metodo === 'TARJETA') {
    if (tipo === 'CREDITO') return 'Tarjeta crédito';
    if (tipo === 'DEBITO') return 'Tarjeta débito';
    return 'Tarjeta';
  }
  if (metodo === 'CREDITO') return 'Crédito';
  if (metodo === 'DEBITO') return 'Débito';
  if (metodo === 'EFECTIVO') return 'Efectivo';
  if (metodo === 'TRANSFERENCIA') return 'Transferencia';
  return metodo || 'Pago';
}

/**
 * Extrae la lista de pagos de un `payment_details` en cualquiera de sus formas:
 *   - canónica F9.1: `{ pagos: [ {metodo, monto, ...}, ... ] }`
 *   - vieja (un solo pago): `{ metodo, recibido, cambio }`
 * Devuelve `[]` si no hay nada que desglosar. Nunca lanza.
 */
function listaDePagos(paymentDetails) {
  if (!paymentDetails || typeof paymentDetails !== 'object') return [];
  if (Array.isArray(paymentDetails.pagos)) return paymentDetails.pagos;
  if (paymentDetails.metodo) return [paymentDetails];
  return [];
}

/**
 * Bloque de desglose de pagos del ticket (F9.1.4).
 *
 * Paridad con el viejo POS (`ticketGenerator.js:43-72`):
 *   - EFECTIVO: muestra Recibido / Abonado / Cambio en 3 líneas separadas.
 *   - Otros métodos (TARJETA, TRANSFERENCIA, etc.): una sola línea método + monto.
 * Devuelve '' si no hay pagos (ticket sin cobrar).
 */
function bloquePagos(paymentDetails) {
  const pagos = listaDePagos(paymentDetails);
  if (pagos.length === 0) return '';

  const filas = pagos.map((p) => {
    const metodo = String(p.metodo || '').toUpperCase();
    if (metodo === 'EFECTIVO') {
      const recibido = Number(p.recibido ?? p.monto ?? 0);
      const abonado  = Number(p.monto   ?? p.recibido ?? 0);
      const cambio   = Number(p.cambio  ?? 0);
      return `
        <div style="margin-bottom: 2px;">
          <div class="bold">${etiquetaMetodoPago(p)}</div>
          <div style="display: flex; justify-content: space-between; padding-left: 8px;">
            <span class="small upper">Recibido:</span><span class="bold">${moneda(recibido)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding-left: 8px;">
            <span class="small upper">Abonado:</span><span class="bold">${moneda(abonado)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding-left: 8px;">
            <span class="small upper">Cambio:</span><span class="bold">${moneda(cambio)}</span>
          </div>
        </div>`;
    }
    return filaPago(etiquetaMetodoPago(p), moneda(p.monto ?? p.recibido));
  }).join('');

  return `
    <div class="line"></div>
    <div class="small upper">Forma de pago</div>
    ${filas}
  `;
}

/** Una fila etiqueta/valor del desglose de pagos. */
function filaPago(etiqueta, valor) {
  return `<div class="row"><span class="small upper">${etiqueta}</span><span class="bold">${valor}</span></div>`;
}

/**
 * Formatea la fecha/hora de entrega programada de un pedido (es-MX, corta).
 * Nunca lanza: si el instante es inválido devuelve '---'.
 */
function fechaEntregaProgramada(instante) {
  if (!instante) return '---';
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) return '---';
  return fecha.toLocaleString('es-MX', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Una fila etiqueta/valor de la sección DATOS DEL PEDIDO. */
function filaPedido(etiqueta, valor) {
  return `<div class="row"><span class="small">${etiqueta}:</span> <span class="upper">${valor}</span></div>`;
}

/**
 * Sección "*** DATOS DEL PEDIDO ***" del ticket de un PEDIDO (F12.2).
 *
 * Porta FIELMENTE la sección del viejo POS (`apps/pos/utils/ticketGenerator.js:142-189`):
 * el recuadro con borde que imprime los datos operativos del pedido — quién lo
 * recoge, cuándo, con qué empaque, a qué dirección, con qué notas, y el estado
 * de pago.
 *
 * P5/Opción C — Estado de pago condicional:
 *   - Si el pago cubre el 100%: muestra simplemente "✅ PAGADO AL 100%".
 *   - Si el pago cubre < 100%: muestra el desglose de porcentaje cubierto,
 *     monto pagado, porcentaje restante y monto pendiente.
 *   El porcentaje se lee de `ticket.payment_covered_pct` (default 100).
 *
 * Devuelve '' si el ticket NO es un PEDIDO (venta directa).
 *
 * @param {Object} ticket - Datos del ticket (order_type, customer_name, ...).
 * @param {string|null} copyLabel - 'CLIENTE' | 'COMERCIO' | null.
 * @returns {string} HTML de la sección, o ''.
 */
function seccionDatosPedido(ticket, copyLabel) {
  if (ticket.order_type !== 'PEDIDO') return '';

  const esPickup = ticket.delivery_type === 'PICKUP';
  const tipo = esPickup ? '🏪 RECOLECCIÓN (PICKUP)' : '🚗 ENTREGA A DOMICILIO';
  const empaque =
    ticket.packaging_type === 'PROPIO' ? '🛍️ TRAE SU EMPAQUE' : '📦 EMPAQUE PAGADO';

  // P5/Opción C — Estado de pago condicional.
  const pctCubierto = Number(ticket.payment_covered_pct ?? 100);
  const totalNum = Number(ticket.total ?? 0);
  const estadoPago = bloqueEstadoPagoPedido(pctCubierto, totalNum, esPickup);

  const direccion = ticket.delivery_address
    ? `
      <div style="margin-top: 4px; padding-top: 2px; border-top: 1px dashed #000;">
        <div class="small bold">DIRECCIÓN:</div>
        <div class="xsmall upper" style="line-height: 1.2;">${ticket.delivery_address}</div>
      </div>`
    : '';

  const notas = ticket.notes || ticket.order_notes
    ? `
      <div style="margin-top: 4px; padding-top: 2px; border-top: 1px dashed #000;">
        <div class="small bold">NOTAS:</div>
        <div class="xsmall upper" style="line-height: 1.3;">${ticket.notes || ticket.order_notes}</div>
      </div>`
    : '';

  const rotuloCopia = copyLabel
    ? `
      <div class="center bold" style="font-size: 9pt; margin-top: 6px; border: 1.5px dashed #000; padding: 3px 0;">
        --- COPIA: ${copyLabel} ---
      </div>`
    : '';

  return `
    <div style="margin-top: 4px; border: 1.5px solid #000; padding: 4px; position: relative;">
      <div class="center bold upper" style="font-size: 9pt; margin-bottom: 4px; background: #000; color: #fff; padding: 2px 0;">
        *** DATOS DEL PEDIDO ***
      </div>
      ${filaPedido('CLIENTE', ticket.customer_name || '---')}
      ${filaPedido('TIPO', tipo)}
      <div class="row" style="margin-top: 2px;">
        <span class="small">ENTREGA:</span>
        <span class="upper">${fechaEntregaProgramada(ticket.committed_at)}</span>
      </div>
      <div class="row" style="margin-top: 2px;">
        <span class="small">EMPAQUE:</span>
        <span class="upper">${empaque}</span>
      </div>
      ${direccion}
      ${notas}
      ${estadoPago}
      ${rotuloCopia}
    </div>
  `;
}

/**
 * P5/Opción C — Bloque de estado de pago del pedido.
 *
 * - Si el porcentaje cubierto es >= 100%: muestra "✅ PAGADO AL 100%" + estado
 *   de recolección/entrega (sin ruido de porcentajes).
 * - Si el porcentaje cubierto es < 100%: muestra un desglose claro con el
 *   porcentaje cubierto, monto pagado, porcentaje restante y monto pendiente.
 *
 * @param {number} pctCubierto - Porcentaje cubierto (0–100+).
 * @param {number} total - Monto total del ticket.
 * @param {boolean} esPickup - Si es pickup o domicilio.
 * @returns {string} HTML del bloque de estado de pago.
 */
function bloqueEstadoPagoPedido(pctCubierto, total, esPickup) {
  if (pctCubierto >= 100) {
    const estado = esPickup
      ? 'PAGADO AL 100% - PENDIENTE DE RECOLECCION'
      : 'PAGADO AL 100% - PENDIENTE DE ENTREGA';
    return `
      <div class="center bold upper" style="margin-top: 6px; font-size: 8.5pt; border-top: 1.5px solid #000; padding-top: 3px;">
        ${estado}
      </div>
    `;
  }

  // Pago parcial: desglose visible.
  const montoPagado = total * (pctCubierto / 100);
  const pctRestante = 100 - pctCubierto;
  const montoRestante = total - montoPagado;

  return `
    <div style="margin-top: 6px; border-top: 1.5px solid #000; padding-top: 3px;">
      <div class="center bold upper" style="font-size: 8.5pt; margin-bottom: 2px;">
        ⚠️ PAGO PARCIAL
      </div>
      <div class="row bold" style="font-size: 8pt;">
        <span>CUBIERTO (${pctCubierto}%):</span>
        <span>${moneda(montoPagado)}</span>
      </div>
      <div class="row bold" style="font-size: 9pt; margin-top: 1px;">
        <span>RESTANTE (${pctRestante}%):</span>
        <span>${moneda(montoRestante)}</span>
      </div>
      <div class="center bold upper" style="font-size: 8pt; margin-top: 3px; border-top: 1px dashed #000; padding-top: 2px;">
        ${esPickup ? 'COBRAR RESTANTE AL RECOGER' : 'COBRAR RESTANTE AL ENTREGAR'}
      </div>
    </div>
  `;
}

/**
 * Genera el HTML térmico de un ticket de venta o de pedido.
 *
 * F12.2 — Acepta `copyLabel` (como el viejo POS): cuando es 'CLIENTE' o
 * 'COMERCIO', estampa el rótulo `--- COPIA: … ---` dentro de la sección de
 * PEDIDO. Para venta directa se llama sin `copyLabel` (copia única).
 *
 * @param {Object} ticket - Datos del ticket (account_num, total, lineas, terminal_id, ...).
 * @param {string|null} [copyLabel] - 'CLIENTE' | 'COMERCIO' | null.
 * @returns {string} Documento HTML autosuficiente listo para imprimir.
 */
export function generarTicketHTML(ticket = {}, copyLabel = null) {
  const lineas = ticket.lineas || ticket.items || [];
  const cuenta = ticket.account_num || ticket.folio || '---';
  const terminal = ticket.terminal_id || 'T1';
  const capturo = ticket.captured_by_name || 'SISTEMA';
  const cobro = ticket.cashed_by_name || 'SISTEMA/AUTO';

  const cuerpo = `
    ${encabezadoNegocio()}
    <div class="col bold center" style="margin-bottom: 2px;">
      <div>CTA: ${cuenta}</div>
      <div style="margin-top: 1px;">${fechaHora(ticket.created_at)}</div>
    </div>
    <div class="line"></div>
    ${bloqueLineas(lineas)}
    <div class="line"></div>
    <div class="row bold" style="margin: 2px 0;">
      <span>TOTAL DE ARTICULOS:</span><span>${totalArticulos(lineas)}</span>
    </div>
    <div class="line"></div>
    <div class="row bold" style="font-size: 10pt; margin: 2px 0;">
      <span>TOTAL</span><span>${moneda(ticket.total)}</span>
    </div>
    ${bloquePagos(ticket.payment_details)}
    ${seccionDatosPedido(ticket, copyLabel)}
    <div class="audit">
      <div class="row bold"><span>CAPTURÓ:</span><span>${capturo}</span></div>
      <div class="row bold"><span>COBRÓ:</span><span>${cobro}</span></div>
      <div class="row xsmall"><span>Terminal:</span><span>${terminal}</span></div>
    </div>
    <div class="center xsmall" style="margin-top: 4px; padding-top: 2px; border-top: 1px solid #ccc;">
      Cuenta con 3 días a partir de la fecha de compra para realizar cualquier aclaración
    </div>
    <div class="center xsmall" style="margin-top: 2px;">¡¡¡Gracias por su compra, disfrute su pan!!!</div>
  `;
  return documentoTermico(cuerpo);
}

/**
 * Combina DOS copias del ticket de un PEDIDO en un solo documento (F12.2).
 *
 * Porta `combineOrderTicketsForPrint` del viejo POS
 * (`apps/pos/utils/ticketGenerator.js:217`): genera la copia CLIENTE (para
 * recoger el pedido) y la copia COMERCIO (respaldo físico por si cae el
 * sistema) y las une con `.ticket-copy { page-break-after: always; }` para que
 * la impresora térmica corte entre ambas.
 *
 * @param {Object} ticket - Datos del ticket de PEDIDO.
 * @returns {string} Documento HTML autosuficiente con las dos copias.
 */
export function combinarCopiasPedido(ticket = {}) {
  const clienteHTML = generarTicketHTML(ticket, 'CLIENTE');
  const comercioHTML = generarTicketHTML(ticket, 'COMERCIO');

  const extraerCuerpo = (html) => {
    const coincidencia = html.match(/<body>([\s\S]*)<\/body>/);
    return coincidencia ? coincidencia[1] : html;
  };

  const cuerpo = `
    <div class="ticket-copy">${extraerCuerpo(clienteHTML)}</div>
    <div class="ticket-copy">${extraerCuerpo(comercioHTML)}</div>
  `;
  return documentoTermico(cuerpo);
}

/** Una fila etiqueta/valor del corte. */
function filaCorte(etiqueta, valor) {
  return `<div class="row"><span class="small upper">${etiqueta}</span><span class="bold">${valor}</span></div>`;
}

/** Bloque de movimientos del turno agrupados por tipo (Entradas primero, Salidas después). */
function bloqueMovimientos(movimientos) {
  if (!movimientos || movimientos.length === 0) {
    return `<div class="small upper" style="margin: 2px 0;">Sin movimientos.</div>`;
  }
  const entradas = movimientos.filter((m) => m.tipo === 'ENTRADA');
  const salidas  = movimientos.filter((m) => m.tipo !== 'ENTRADA');
  const renderGrupo = (lista, signo) =>
    lista.map((m) => {
      const motivo = m.motivo || m.concepto || m.tipo || 'Movimiento';
      const hora   = m.created_at ? ` (${fechaHora(m.created_at).split(' ')[1] || ''})` : '';
      return `<div style="display:flex;justify-content:space-between;font-size:6.5pt;padding-left:4px;">
        <span>${signo} ${motivo}${hora}</span><span class="bold">${moneda(m.monto)}</span>
      </div>`;
    }).join('');
  return [
    entradas.length ? `<div class="bold small upper">Entradas (+):</div>${renderGrupo(entradas, '\u2191')}` : '',
    salidas.length  ? `<div class="bold small upper" style="margin-top:2px;">Salidas (-):</div>${renderGrupo(salidas, '\u2193')}` : '',
  ].filter(Boolean).join('');
}

/**
 * DEUDA-BUG08 (Obs. 4) — ¿quién cuadra la caja? Si esta caja cobró cuentas de
 * OTRAS terminales, el corte lo declara. Si no, no ensucia el ticket.
 */
function bloqueVentasAjenas(corte) {
  const ajenas = Number(corte.ventasAjenas || 0);
  if (ajenas <= 0) return '';
  const n = Number(corte.numTransaccionesAjenas || 0);
  return filaCorte(`De otras terminales (${n})`, moneda(ajenas));
}

/** Bloque de una fila de balance por método (Sistema vs Físico vs Diferencia). */
function filaBalance(metodo, sistema, fisico) {
  const dif = fisico - sistema;
  const difStr = (dif >= 0 ? '+' : '') + dif.toFixed(2);
  return `
    <div class="bold small upper" style="border-bottom: 1px dotted #000; margin-bottom: 1px;">-- ${metodo} --</div>
    <div class="row small"><span>Sistema: ${moneda(sistema)}</span><span>Físico: ${moneda(fisico)}</span></div>
    <div class="row bold small"><span>Diferencia:</span><span>$${difStr}</span></div>
  `;
}

/** Lista de cuentas cobradas en el turno. */
function bloqueCuentasCobradas(cuentas, numTransacciones) {
  if (!cuentas || cuentas.length === 0) {
    return `<div class="center xsmall" style="font-style:italic;">Sin tickets registrados</div>`;
  }
  const filas = cuentas.map((t) =>
    `<div class="row xsmall"><span>#${t.account_num || t.folio || '---'}</span><span class="bold">${moneda(t.total)}</span></div>`
  ).join('');
  return `
    <div class="bold small upper center" style="margin-bottom: 2px;">Cuentas cobradas (${numTransacciones})</div>
    ${filas}
  `;
}

/**
 * Genera el HTML térmico de un corte de caja con PARIDAD COMPLETA al viejo POS.
 *
 * Iguala la estructura de `CorteTicketTemplate.jsx`:
 *   1. Encabezado: Logo + R DE RICO + *** CORTE CAJA ***
 *   2. Metadatos: CORTE ID, TERMINAL, CAJERO, APERTURA, CIERRE
 *   3. Lista de cuentas cobradas (si se proporcionan)
 *   4. FLUJO DE EFECTIVO: Fondo Inicial + Entradas + Salidas con concepto
 *   5. VENTA TOTAL
 *   6. BALANCE FÍSICO por método: Sistema vs Físico vs Diferencia
 *   7. Firmas: CAJERO + GERENTE
 *   8. "--- Fin del Reporte de Corte ---"
 *
 * @param {Object} corte - Datos del corte.
 *   - terminalId, cajero, abiertaEn, cerradaEn
 *   - esperado, contado (efectivo físico)
 *   - credito, debito, transferencia (conteos físicos)
 *   - creditoSistema, debitoSistema, transferenciaSistema (valores del sistema)
 *   - fondoInicial, totalEntradas, totalSalidas, totalVentas
 *   - numTransacciones, movimientos[]
 *   - cuentasCobradas[] - lista de {account_num, total}
 *   - ventasAjenas, numTransaccionesAjenas
 * @returns {string} Documento HTML autosuficiente listo para imprimir.
 */
export function generarCorteHTML(corte = {}) {
  const esperado   = Number(corte.esperado  || 0);
  const contado    = Number(corte.contado   || 0);
  const credito    = Number(corte.credito   || 0);
  const debito     = Number(corte.debito    || 0);
  const transferencia = Number(corte.transferencia || 0);

  // Valores del sistema para el balance por método.
  const creditoSist = Number(corte.creditoSistema   ?? corte.credito   ?? 0);
  const debitoSist  = Number(corte.debitoSistema    ?? corte.debito    ?? 0);
  const transfSist  = Number(corte.transferenciaSistema ?? corte.transferencia ?? 0);

  const fondoInicial  = Number(corte.fondoInicial  || 0);
  const totalEntradas = Number(corte.totalEntradas || 0);
  const totalSalidas  = Number(corte.totalSalidas  || 0);
  const totalVentas   = Number(corte.totalVentas   || 0);
  const numTx         = Number(corte.numTransacciones || 0);

  const descuadre = contado - esperado;
  const cuadra    = Math.abs(descuadre) < 0.01;
  const estadoStr = cuadra ? '\u2713 Caja cuadrada' : descuadre < 0 ? '\u2717 Faltante' : '\u2717 Sobrante';

  const cuerpo = `
    ${encabezadoNegocio()}
    <div class="bold upper center" style="font-size: 7pt; letter-spacing: 0.5px; margin-bottom: 2px;">*** CORTE CAJA ***</div>
    <div class="line"></div>

    <div class="xsmall" style="margin-bottom: 2px;">
      ${filaCorte('TERMINAL:', corte.terminalId || '---')}
      ${filaCorte('CAJERO:', corte.cajero || '\u2014')}
      ${filaCorte('APERTURA:', fechaHora(corte.abiertaEn))}
      ${filaCorte('CIERRE:', fechaHora(corte.cerradaEn))}
    </div>
    <div class="line"></div>

    ${bloqueCuentasCobradas(corte.cuentasCobradas, numTx)}
    <div class="line"></div>

    <div class="bold small upper center" style="margin-bottom: 2px;">Flujo de Efectivo</div>
    ${filaCorte('Fondo inicial:', moneda(fondoInicial))}
    ${totalEntradas > 0 ? `<div class="bold small upper" style="margin-top:2px;">Entradas (+):</div>
      ${bloqueMovimientos((corte.movimientos || []).filter(m => m.tipo === 'ENTRADA'))}` : ''}
    ${totalSalidas > 0 ? `<div class="bold small upper" style="margin-top:2px;">Salidas (-):</div>
      ${bloqueMovimientos((corte.movimientos || []).filter(m => m.tipo !== 'ENTRADA'))}` : ''}
    <div class="line"></div>

    <div class="row bold" style="font-size: 10pt; margin: 2px 0;">
      <span>VENTA TOTAL:</span><span>${moneda(totalVentas)}</span>
    </div>
    ${bloqueVentasAjenas(corte)}
    <div class="line"></div>

    <div class="bold small upper center" style="margin-bottom: 2px;">Balance Físico (Esp. vs Real)</div>
    <div style="margin-bottom: 4px;">
      ${filaBalance('EFECTIVO', esperado, contado)}
    </div>
    <div style="margin-bottom: 4px;">
      ${filaBalance('T. CRÉDITO', creditoSist, credito)}
    </div>
    <div style="margin-bottom: 4px;">
      ${filaBalance('T. DÉBITO', debitoSist, debito)}
    </div>
    ${transfSist > 0 || transferencia > 0 ? `<div style="margin-bottom: 4px;">${filaBalance('TRANSFERENCIA', transfSist, transferencia)}</div>` : ''}
    <div class="center small upper" style="margin: 2px 0; font-size: 8pt;">${estadoStr}</div>
    <div class="line" style="margin-top: 8px;"></div>

    <div style="display: flex; justify-content: space-between; padding: 4px 2px 6px; text-align: center;">
      <div style="width: 47%; text-align: center;">
        <div class="xsmall upper" style="border-top: 1px solid #000; padding-top: 2px;">Firma Cajero</div>
        <div class="xsmall">${corte.cajero || ''}</div>
      </div>
      <div style="width: 47%; text-align: center;">
        <div class="xsmall upper" style="border-top: 1px solid #000; padding-top: 2px;">Firma Gerente</div>
        <div class="xsmall">Recibe</div>
      </div>
    </div>

    <div class="center xsmall upper" style="margin-top: 2px; font-style: italic;">--- Fin del Reporte de Corte ---</div>
    <div class="center xsmall upper" style="margin-top: 4px;">Documento interno · No es comprobante fiscal</div>
  `;
  return documentoTermico(cuerpo);
}

export default { generarTicketHTML, generarCorteHTML, combinarCopiasPedido };
