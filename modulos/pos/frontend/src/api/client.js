/**
 * Cliente del API del POS nuevo — P2.5 + FASE 3.4 (atómico + locking).
 *
 * Habla con el API PROPIO del POS nuevo (`CONFIG.API_BASE_URL`), nunca con el
 * del ERP. Expone las operaciones del flujo E.1 (venta directa):
 *
 *   - `getCatalogo()`      → GET  /catalog/products-for-sale   (contrato 1)
 *   - `getSesionActiva()`  → GET  /pos/session-active          (contrato 9)
 *   - `crearVenta()`       → POST /pos/tickets                 (RN-14..RN-27)
 *   - `cobrarTicket()`     → POST /pos/tickets/{id}/pay        (RN-23, RN-62/63)
 *
 * FASE 3.4 añade las operaciones ATÓMICAS por ítem (contratos 18–22) y las de
 * candado de terminal (heartbeat OMEGA), que consumen los hooks de la Fase 3.3:
 *
 *   - `anadirItem()`       → POST   /pos/tickets/{id}/items          (contrato 18)
 *   - `cambiarCantidad()`  → PATCH  /pos/tickets/{id}/items/{item}   (contrato 19)
 *   - `quitarItem()`       → DELETE /pos/tickets/{id}/items/{item}   (contrato 20)
 *   - `leerTicket()`       → GET    /pos/tickets/{id}                (contrato 21)
 *   - `verificarEnvio()`   → POST   /pos/tickets/{id}/verify         (contrato 22)
 *   - `latir()`            → POST   /pos/terminals/{id}/heartbeat    (OMEGA)
 *   - `tomarLock()`        → POST   /pos/terminals/{id}/lock         (RN-03)
 *   - `liberarLock()`      → POST   /pos/terminals/{id}/unlock       (RN-05)
 *
 * Todas las respuestas se normalizan a `{ ok, data, error }` para que la UI no
 * tenga que envolver cada llamada en try/catch.
 */

import { CONFIG } from '../../../shared/config.js';

/** Error de API con el código HTTP y el mensaje del servidor. */
export class ApiError extends Error {
  constructor(mensaje, codigo, detalle) {
    super(mensaje);
    this.name = 'ApiError';
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

/**
 * Normaliza un id de usuario a string para la frontera HTTP.
 *
 * Los contratos de candado declaran `usuario_id` como `str` (Pydantic v2 rechaza
 * un número con 422). El usuario que entrega el ERP puede traer el id como número
 * (p. ej. `1`). Esta coerción vive AQUÍ, en la frontera del cliente, para que los
 * hooks no tengan que conocer el tipo exacto que exige el contrato.
 *
 * @param {string|number} usuarioId
 * @returns {string}
 */
function aIdTexto(usuarioId) {
  return usuarioId === null || usuarioId === undefined ? '' : String(usuarioId);
}

/**
 * Ejecuta una petición al API del POS nuevo.
 * @param {string} ruta  Ruta relativa (p. ej. `/catalog/products-for-sale`).
 * @param {object} [opciones]  Opciones de fetch (method, body, …).
 * @returns {Promise<object>}  El JSON de la respuesta.
 */
async function peticion(ruta, opciones = {}) {
  const url = `${CONFIG.API_BASE_URL}${ruta}`;
  const cabeceras = { 'Content-Type': 'application/json', ...(opciones.headers || {}) };

  let respuesta;
  try {
    respuesta = await fetch(url, { ...opciones, headers: cabeceras });
  } catch (causa) {
    throw new ApiError(
      `No se pudo contactar el API del POS nuevo en ${CONFIG.API_BASE_URL}`,
      0,
      causa
    );
  }

  const texto = await respuesta.text();
  let cuerpo = null;
  if (texto) {
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      cuerpo = { detalle: texto };
    }
  }

  if (!respuesta.ok) {
    const mensaje =
      (cuerpo && (cuerpo.detail || cuerpo.detalle || cuerpo.message)) ||
      `Error ${respuesta.status} del API del POS nuevo`;
    throw new ApiError(mensaje, respuesta.status, cuerpo);
  }

  return cuerpo;
}

/** GET /catalog/products-for-sale — contrato 1 (proyección de venta). */
export function getCatalogo(channel = CONFIG.CANAL) {
  const qs = new URLSearchParams({ channel });
  return peticion(`/catalog/products-for-sale?${qs.toString()}`);
}

/** GET /pos/session-active — contrato 9 (sesión de terminal activa). */
export function getSesionActiva(terminalId = CONFIG.TERMINAL_ID) {
  const qs = new URLSearchParams({ terminal_id: terminalId });
  return peticion(`/pos/session-active?${qs.toString()}`);
}

/**
 * POST /pos/tickets — crea el ticket con sus líneas (RN-14..RN-27).
 * @param {{terminal_id: string, channel: string, items: Array<{product_id: string, quantity: number}>}} cuerpo
 */
export function crearVenta(cuerpo) {
  return peticion('/pos/tickets', {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });
}

/**
 * POST /pos/tickets/{id}/pay — cobra el ticket (RN-23, RN-62/63).
 * @param {string} ticketId
 * @param {{payment_details: object, version: number}} cuerpo
 */
export function cobrarTicket(ticketId, cuerpo) {
  return peticion(`/pos/tickets/${ticketId}/pay`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 3.4 — Operaciones ATÓMICAS por ítem (contratos 18–22)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /pos/tickets/{id}/items — añade un ítem (contrato 18, IDEMPOTENTE).
 * Reenviar el mismo `item_id` es un NO-OP en el servidor.
 * @param {string} ticketId
 * @param {{item_id: string, product_id: string, quantity: number, version: number}} cuerpo
 */
export function anadirItem(ticketId, cuerpo) {
  return peticion(`/pos/tickets/${ticketId}/items`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });
}

/**
 * PATCH /pos/tickets/{id}/items/{item_id} — cambia la cantidad (contrato 19).
 * @param {string} ticketId
 * @param {string} itemId
 * @param {{quantity: number, version: number}} cuerpo
 */
export function cambiarCantidad(ticketId, itemId, cuerpo) {
  return peticion(`/pos/tickets/${ticketId}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(cuerpo),
  });
}

/**
 * DELETE /pos/tickets/{id}/items/{item_id} — quita un ítem (contrato 20).
 * @param {string} ticketId
 * @param {string} itemId
 * @param {{version: number}} cuerpo
 */
export function quitarItem(ticketId, itemId, cuerpo) {
  return peticion(`/pos/tickets/${ticketId}/items/${itemId}`, {
    method: 'DELETE',
    body: JSON.stringify(cuerpo),
  });
}

/** GET /pos/tickets/{id} — lectura ligera del ticket (contrato 21, 5 campos). */
export function leerTicket(ticketId) {
  return peticion(`/pos/tickets/${ticketId}`);
}

/**
 * GET /pos/tickets/{id}/items — lee las LÍNEAS del ticket (contrato 30, F12.10).
 * Cierra el hueco A-02 de la Regla 15: el contrato 21 no devuelve las líneas,
 * así que recuperar una cuenta del pizarrón no podía hidratar el carrito.
 * Devuelve `{ ticket_id, version, total, lineas }`.
 * @param {string} ticketId
 */
export function leerLineas(ticketId) {
  return peticion(`/pos/tickets/${ticketId}/items`);
}

/**
 * PATCH /pos/tickets/{id}/order — actualiza la programación de un ticket YA
 * creado (contrato 31, F12.20). Cierra el hueco A-02 del flujo REAL del POS
 * "productos primero, pedido después": el ticket nace VENTA_DIRECTA (contrato
 * 29) y LUEGO se programa como PEDIDO. Sin este contrato, `guardarPedido` no
 * podía persistir el bloque y el post-it del pizarrón no se distinguía de una
 * cuenta normal.
 *
 * Semántica PATCH: solo se aplican los campos PRESENTES en `cuerpo`. Un campo
 * ausente NO se toca; un campo presente con `null` limpia el valor.
 *
 * @param {string} ticketId
 * @param {{version: number} & Record<string, unknown>} cuerpo
 */
export function actualizarPedidoTicket(ticketId, cuerpo) {
  return peticion(`/pos/tickets/${ticketId}/order`, {
    method: 'PATCH',
    body: JSON.stringify(cuerpo),
  });
}

/**
 * POST /pos/tickets/{id}/verify — verificación post-envío (contrato 22).
 * Confirma en BD que el ticket y sus ítems existen antes de limpiar el carrito.
 *
 * BUG-07 — `cantidades` (opcional): las unidades de cada línea del carrito, en
 * el MISMO orden que `item_ids`. Necesarias porque RN-17 fusiona los productos
 * repetidos en una sola fila del servidor; la verificación correcta es por
 * UNIDADES, no por número de filas.
 * @param {string} ticketId
 * @param {{item_ids: string[], cantidades?: number[]}} cuerpo
 */
export function verificarEnvio(ticketId, cuerpo) {
  return peticion(`/pos/tickets/${ticketId}/verify`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 3.4 — Candado de terminal + heartbeat (OMEGA)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /pos/terminals/{id}/heartbeat — late mientras la pestaña vive (OMEGA).
 * @param {string} terminalId
 * @param {string} usuarioId
 */
export function latir(terminalId, usuarioId) {
  return peticion(`/pos/terminals/${terminalId}/heartbeat`, {
    method: 'POST',
    body: JSON.stringify({ usuario_id: aIdTexto(usuarioId) }),
  });
}

/**
 * POST /pos/terminals/{id}/lock — toma el candado exclusivo (RN-03).
 * @param {string} terminalId
 * @param {string} usuarioId
 */
export function tomarLock(terminalId, usuarioId) {
  return peticion(`/pos/terminals/${terminalId}/lock`, {
    method: 'POST',
    body: JSON.stringify({ usuario_id: aIdTexto(usuarioId) }),
  });
}

/**
 * POST /pos/terminals/{id}/unlock — libera el candado (RN-05).
 * @param {string} terminalId
 * @param {string} usuarioId
 */
export function liberarLock(terminalId, usuarioId) {
  return peticion(`/pos/terminals/${terminalId}/unlock`, {
    method: 'POST',
    body: JSON.stringify({ usuario_id: aIdTexto(usuarioId) }),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 4.2 — Caja (contratos 9–14)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /cash/active-session — turno de caja abierto (contrato 9).
 *
 * El endpoint EXIGE `terminal_id` (Query(...) en el router): sin él responde
 * 422 y el POS nunca sabría que la caja ya está habilitada (el botón se
 * quedaba en "○ Habilitar" y la guarda de cobro seguía activa). Se envía
 * siempre, con el mismo patrón que `getSesionActiva`.
 */
export function getSesionCajaActiva(terminalId = CONFIG.TERMINAL_ID) {
  const qs = new URLSearchParams({ terminal_id: terminalId });
  return peticion(`/cash/active-session?${qs.toString()}`);
}

/**
 * POST /cash/open-session — abre el turno de caja (contrato 10, RN-49/RN-50).
 * @param {{terminal_id: string, usuario_id: string, monto_inicial: number|string}} cuerpo
 */
export function abrirTurno(cuerpo) {
  return peticion('/cash/open-session', {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });
}

/**
 * POST /cash/movements — registra una entrada o salida (contrato 11, RN-51/RN-55).
 * @param {{cash_session_id: string, tipo: string, monto: number|string, motivo: string}} cuerpo
 */
export function registrarMovimiento(cuerpo) {
  return peticion('/cash/movements', {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });
}

/**
 * DELETE /cash/movements/{id} — elimina un movimiento del turno (contrato 29, RN-52).
 *
 * FASE 10.6.2 — paridad de operación. El viejo POS permitía borrar un
 * movimiento mal capturado mientras la caja estuviera abierta; el nuevo POS lo
 * había omitido. Solo funciona con la sesión ABIERTA (RN-52).
 *
 * @param {string} movementId
 */
export function eliminarMovimiento(movementId) {
  return peticion(`/cash/movements/${movementId}`, { method: 'DELETE' });
}

/** GET /cash/session-summary/{id} — resumen del turno (contrato 12, RN-53). */
export function getResumenTurno(cashSessionId) {
  return peticion(`/cash/session-summary/${cashSessionId}`);
}

/**
 * POST /cash/close-session — cierra el turno con los conteos (contrato 13, RN-54/RN-55).
 * @param {{cash_session_id: string, montos_fisicos: number|string, credito: number|string, debito: number|string}} cuerpo
 */
export function cerrarTurno(cuerpo) {
  return peticion('/cash/close-session', {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });
}

/** GET /cash/daily-report/{fecha} — reporte del día local (contrato 14, RN-59). */
export function getReporteDiario(fecha) {
  return peticion(`/cash/daily-report/${fecha}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 10.4 — Contexto diario post-corte (contrato 28, `pos.contexto_diario`)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PUT del contexto diario al módulo de Estadísticas (contrato 28).
 *
 * El POS NO es dueño de la tabla `daily_contexts`: la posee Estadísticas. El
 * POS solo la ALIMENTA tras el corte (clima, día atípico, notas).
 *
 * ── Estado: DEUDA ─────────────────────────────────────────────────────────────
 * El endpoint propio del POS nuevo (`PUT /pos/daily-context`) AÚN NO EXISTE.
 * Mientras no exista, se apunta al endpoint heredado del ERP
 * (`PUT /analytics/context`), que es el que consumía el viejo POS. Cuando el
 * POS nuevo exponga su endpoint, solo cambia la ruta aquí.
 *
 * @param {{target_date: string, is_atypical: boolean, weather_condition: string|null, notes: string|null}} cuerpo
 */
export function enviarContextoDiario(cuerpo) {
  return peticion('/analytics/context', {
    method: 'PUT',
    body: JSON.stringify(cuerpo),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 5.1 — Pizarrón de cuentas abiertas (contrato 23)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /pos/open-accounts — las cuentas OPEN (contrato 23).
 *
 * Si `terminalId` se omite o es vacío, devuelve TODAS las cuentas OPEN
 * (para modo CAJA, que necesita ver cuentas de todas las terminales).
 * Si se proporciona, filtra por esa terminal (RN-31).
 *
 * @param {string} [terminalId]
 */
export function listarCuentasAbiertas(terminalId) {
  const id = typeof terminalId === 'string' ? terminalId.trim() : '';
  if (id) {
    const qs = new URLSearchParams({ terminal_id: id });
    return peticion(`/pos/open-accounts?${qs.toString()}`);
  }
  return peticion('/pos/open-accounts');
}

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 13.2a — Auditoría y Control (contrato 5)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /pos/auditable-events — los eventos auditables del POS en un rango
 * (contrato 5, F13.1).
 *
 * Es una lectura de SOLO LECTURA que devuelve una PROYECCIÓN (O-23): nunca la
 * tabla `tickets` ni la fila cruda de `pos_audit_log`. Cada evento expone solo
 * 5 campos (`tipo`, `ticket_id`, `usuario_id`, `timestamp`, `detalle`).
 *
 * El backend exige AMBOS parámetros (`desde` y `hasta`, ISO-8601 UTC) y responde
 * 400 si `desde > hasta` (RN-77/RN-78). La validación local vive en el servicio
 * (`auditService.js`), no aquí: el cliente solo transporta.
 *
 * @param {string} desde  Inicio del rango (ISO-8601, UTC).
 * @param {string} hasta  Fin del rango (ISO-8601, UTC).
 */
export function listarEventosAuditables(desde, hasta) {
  const qs = new URLSearchParams({ desde, hasta });
  return peticion(`/pos/auditable-events?${qs.toString()}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 8.2 — Notificaciones (contrato 27)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /notifications/enqueue-ticket — encola el envío del ticket (contrato 27,
 * proveedor Notificaciones).
 *
 * Patrón Outbox (Regla de Oro #7): el POS solo ESCRIBE en la cola; el worker
 * envía después. La operación NUNCA falla por culpa del canal externo.
 * Idempotente por `evento_id`.
 *
 * @param {{evento_id: string, ticket_uuid: string, canales: string[],
 *          destinatario: {telefono?: string, email?: string}, payload: object}} cuerpo
 */
export function encolarTicket(cuerpo) {
  return peticion('/notifications/enqueue-ticket', {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 8.1 — Beneficios del cliente (contrato 26)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /crm/benefits/for-ticket — los beneficios de un cliente para un carrito
 * (contrato 26, proveedor CRM).
 *
 * El POS NO calcula descuentos: pregunta al CRM y el CRM decide. La respuesta
 * es una PROYECCIÓN (`customer_id`, `nombre`, `nivel`, `descuentos`,
 * `puntos_a_ganar`, `puntos_disponibles`, `puede_canjear`), no la tabla
 * `customers`.
 *
 * DT-02: `total` y `unit_price` viajan como String en el cable (dinero decimal).
 * El servicio los coerciona con `Number()` en la frontera.
 *
 * @param {{telefono: string, items: Array<{product_id: string, qty: number, unit_price: string}>}} cuerpo
 */
export function getBeneficiosParaTicket(cuerpo) {
  return peticion('/crm/benefits/for-ticket', {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 7.5.4 — Pedidos (contrato 16)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /orders/by-ticket/{ticket_id} — el pedido asociado a un ticket (contrato 16).
 *
 * Devuelve una PROYECCIÓN del pedido (10 campos), no la fila completa de
 * `orders`. El POS la usa para mostrar la programación de un pedido ya creado.
 * Un ticket sin pedido (venta directa) responde 404.
 *
 * @param {string} ticketId
 */
export function getPedidoDelTicket(ticketId) {
  return peticion(`/orders/by-ticket/${ticketId}`);
}

/**
 * P5 — Lee un setting individual del módulo Vista General (`system_settings`).
 *
 * Fail-safe: si la petición falla (sin conexión, setting no existe, etc.),
 * devuelve `null` en vez de lanzar. El consumidor aplica su default seguro.
 *
 * @param {string} key  Clave del setting (p. ej. `order_min_payment_pct`).
 * @returns {Promise<string|null>}  El valor del setting, o null si falla.
 */
export async function getSettingValue(key) {
  try {
    const data = await peticion(`/settings/${encodeURIComponent(key)}`);
    return data?.value ?? null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MS-01 — Cola de Cocina (contratos 28, 29, 30)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Contrato 28 — GET /orders/kitchen-queue
 * Devuelve los tickets activos en cocina (RECIBIDO y EN_PREP).
 * @param {string|null} canal  Filtra por canal (ej. 'PANADERIA', 'HELADERIA').
 */
export function getColaCocina(canal = null) {
  const qs = canal ? `?canal=${encodeURIComponent(canal)}` : '';
  return peticion(`/orders/kitchen-queue${qs}`);
}

/**
 * Contrato 29 — PATCH /orders/kitchen-queue/{kitchen_ticket_id}
 * Avanza el estado: RECIBIDO → EN_PREP → LISTO.
 * @param {string} kitchenTicketId  UUID del kitchen_ticket.
 * @param {'EN_PREP'|'LISTO'} nuevoEstado
 */
export function actualizarEstadoCocina(kitchenTicketId, nuevoEstado) {
  return peticion(`/orders/kitchen-queue/${kitchenTicketId}`, {
    method: 'PATCH',
    body: JSON.stringify({ kitchen_status: nuevoEstado }),
  });
}

/**
 * Contrato 30 — POST /orders/kitchen-queue
 * Encola un ticket en cocina (idempotente: si ya existe devuelve el existente).
 * @param {string} ticketId  UUID del ticket de POS.
 */
export function encolarEnCocina(ticketId) {
  return peticion(`/orders/kitchen-queue?ticket_id=${ticketId}`, {
    method: 'POST',
  });
}

export default {
  getCatalogo,
  getSesionActiva,
  crearVenta,
  cobrarTicket,
  anadirItem,
  cambiarCantidad,
  quitarItem,
  leerTicket,
  leerLineas,
  actualizarPedidoTicket,
  verificarEnvio,
  latir,
  tomarLock,
  liberarLock,
  getSesionCajaActiva,
  abrirTurno,
  registrarMovimiento,
  getResumenTurno,
  cerrarTurno,
  getReporteDiario,
  enviarContextoDiario,
  listarCuentasAbiertas,
  listarEventosAuditables,
  getPedidoDelTicket,
  getBeneficiosParaTicket,
  encolarTicket,
  getColaCocina,
  actualizarEstadoCocina,
  encolarEnCocina,
  getSettingValue,
  // MS-02 — Módulo de Reparto
  getDeliveryQueue,
  asignarRepartidor,
  avanzarEstadoReparto,
  ApiError,
};

// ---------------------------------------------------------------------------
// MS-02 — Módulo de Reparto (Contratos 31, 32, 33)
// ---------------------------------------------------------------------------

/**
 * Contrato 31 — GET /delivery
 * @param {string|null} [estado] Filtra por estado (null = activos ASIGNADO/EN_CAMINO).
 */
export async function getDeliveryQueue(estado = null) {
  const url = new URL(`${CONFIG.API_BASE_URL}/delivery`);
  if (estado) url.searchParams.set('estado', estado);
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new ApiError('Error al leer cola de reparto', resp.status);
  return resp.json();
}

/**
 * Contrato 32 — POST /delivery/assign
 * @param {{ order_id: string, repartidor_nombre: string, repartidor_telefono?: string, notas?: string }} body
 */
export async function asignarRepartidor(body) {
  const resp = await fetch(`${CONFIG.API_BASE_URL}/delivery/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new ApiError(err.detail ?? 'Error al asignar repartidor', resp.status, err);
  }
  return resp.json();
}

/**
 * Contrato 33 — PATCH /delivery/{id}
 * @param {string} assignmentId
 * @param {string} estado EN_CAMINO | ENTREGADO | NO_ENTREGADO
 * @param {string|null} [notas]
 */
export async function avanzarEstadoReparto(assignmentId, estado, notas = null) {
  const resp = await fetch(`${CONFIG.API_BASE_URL}/delivery/${assignmentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado, ...(notas ? { notas } : {}) }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new ApiError(err.detail ?? 'Error al avanzar estado de reparto', resp.status, err);
  }
  return resp.json();
}

/**
 * MS-03 — GET /sync/dashboard/sales
 * Métricas consolidadas de ventas por sucursal.
 */
export async function getSyncDashboardSales() {
  const resp = await fetch(`${CONFIG.API_BASE_URL}/sync/dashboard/sales`);
  if (!resp.ok) throw new ApiError('Error al leer dashboard de ventas', resp.status);
  return resp.json();
}

/**
 * MS-03 — GET /sync/conflicts
 * @param {string} [branchId]
 * @param {boolean} [resolved=false]
 */
export async function getSyncConflicts(branchId = null, resolved = false) {
  const url = new URL(`${CONFIG.API_BASE_URL}/sync/conflicts`);
  if (branchId) url.searchParams.set('branch_id', branchId);
  if (resolved !== null) url.searchParams.set('resolved', String(resolved));
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new ApiError('Error al listar conflictos de sync', resp.status);
  return resp.json();
}

/**
 * MS-03 — POST /sync/conflicts/{id}/resolve
 * @param {string} conflictId
 * @param {string} resolutionNotes
 */
export async function resolveSyncConflict(conflictId, resolutionNotes) {
  const resp = await fetch(`${CONFIG.API_BASE_URL}/sync/conflicts/${conflictId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolution_notes: resolutionNotes }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new ApiError(err.detail ?? 'Error al resolver conflicto', resp.status, err);
  }
  return resp.json();
}

/**
 * MS-03 — POST /sync/push
 * @param {{ branch_id: string, domain: string, records: Array<object>, schema_version?: string }} payload
 */
export async function pushSyncBatch(payload) {
  const resp = await fetch(`${CONFIG.API_BASE_URL}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new ApiError(err.detail ?? 'Error al enviar lote de sincronización', resp.status, err);
  }
  return resp.json();
}
