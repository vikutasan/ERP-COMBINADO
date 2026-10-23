/**
 * voiceCartMapper — FASE 7.2 (Voz). Portado del POS viejo (v24/v25 VOZ-POS).
 *
 * Mapper de intenciones de voz → propuestas de carrito. Es LÓGICA PURA: no
 * toca red, ni DOM, ni el carrito. Por eso se porta CON su test (A-01: cada
 * regla con su test).
 *
 * REGLA DE ORO (H-5): la IA PROPONE, el operador CONFIRMA.
 *   - Ninguna propuesta nace confirmada.
 *   - Si el SKU/nombre no se resuelve contra el catálogo, `resuelto: false`
 *     y la UI obliga a elegir manualmente.
 *   - Si la confianza es baja, `revisar: true` (resaltado ámbar).
 *
 * ALLOWLIST (H-6): en el POS el dictado sirve ÚNICAMENTE para agregar
 * productos a la cuenta. Cobrar, cancelar y quitar por voz están PROHIBIDOS:
 * son acciones destructivas o fiscales y exigen un toque explícito. Cualquier
 * intención fuera de la allowlist se degrada a `DESCONOCIDA`.
 *
 * El LLM NUNCA ejecuta acciones: solo devuelve JSON que este mapper valida.
 *
 * @see PLAN_DE_ABORDAJE_FASE_7_POR_PARTES.md §7
 */

/**
 * Umbral de confianza por debajo del cual la propuesta se marca para revisión
 * visual. La IA propone; el humano confirma.
 */
export const VOICE_CART_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Intenciones de venta soportadas por el POS.
 * Las de almacén (registrar_entrada, contar_stock) NO se ejecutan aquí.
 */
export const POS_VOICE_INTENTS = Object.freeze({
  AGREGAR_ITEM: 'AGREGAR_ITEM',
  QUITAR_ITEM: 'QUITAR_ITEM',
  COBRAR: 'COBRAR',
  CANCELAR: 'CANCELAR',
  DESCONOCIDA: 'DESCONOCIDA',
});

/**
 * Allowlist de intenciones que el POS acepta por voz.
 *
 * DECISIÓN DE DISEÑO (acordada con el negocio): en el POS el dictado por voz
 * sirve ÚNICAMENTE para capturar/agregar productos a la cuenta. No se dictan
 * cobros, cancelaciones ni bajas: esas acciones son destructivas o fiscales y
 * deben pasar siempre por un toque explícito del operador.
 *
 * Cualquier intención fuera de esta lista se degrada a DESCONOCIDA, de modo
 * que la UI muestre "no entendido" en lugar de ofrecer una acción peligrosa.
 */
export const POS_ALLOWED_INTENTS = Object.freeze(
  new Set([POS_VOICE_INTENTS.AGREGAR_ITEM])
);

/**
 * Normaliza un texto para comparar nombres de producto de forma tolerante
 * (minúsculas, sin acentos, sin signos).
 * @param {string} texto
 * @returns {string}
 */
export const normalizar = (texto) =>
  String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Resuelve un SKU/nombre dictado contra el catálogo de productos del POS.
 *
 * Estrategia en cascada (de más estricta a más laxa):
 *   1. Coincidencia exacta por `id` (SKU).
 *   2. Coincidencia exacta por `name` normalizado.
 *   3. El nombre del producto CONTIENE lo dictado (ej. "concha" → "CONCHA VAINILLA").
 *   4. Lo dictado CONTIENE el nombre del producto.
 *
 * @param {string} skuRaw
 * @param {Array<{id: string, name: string, price: number}>} productos
 * @returns {object|null} El producto encontrado o null.
 */
export const resolverProductoPorVoz = (skuRaw, productos = []) => {
  const catalogo = Array.isArray(productos) ? productos : [];
  const crudo = String(skuRaw || '').trim();
  if (!crudo) return null;

  // 1. SKU exacto
  const porId = catalogo.find((p) => String(p.id) === crudo);
  if (porId) return porId;

  const objetivo = normalizar(crudo);
  if (!objetivo) return null;

  // 2. Nombre exacto normalizado
  const porNombre = catalogo.find((p) => normalizar(p.name) === objetivo);
  if (porNombre) return porNombre;

  // 3. El nombre del producto contiene lo dictado
  const contiene = catalogo.find((p) => normalizar(p.name).includes(objetivo));
  if (contiene) return contiene;

  // 4. Lo dictado contiene el nombre del producto
  const contenido = catalogo.find((p) => {
    const n = normalizar(p.name);
    return n.length > 2 && objetivo.includes(n);
  });
  if (contenido) return contenido;

  return null;
};

/**
 * Convierte la respuesta del contrato 25 (`ia.interpretar_intencion`) en una
 * propuesta editable de carrito para el operador.
 *
 * Contrato de entrada (contrato 25, salida declarada):
 *   { intent, entidades, confianza }
 * Se aceptan además los alias del motor viejo (`intencion`, `items`, `sku`,
 * `cantidad`, `unidad`, `texto_original`) para no romper con el Centro de IA.
 *
 * @param {object} intent
 * @param {Array<{id: string, name: string, price: number}>} productos
 * @returns {object} Propuesta con `lineas` editables.
 */
export const mapVoiceIntentToCartProposal = (intent, productos = []) => {
  const data = intent || {};
  const catalogo = Array.isArray(productos) ? productos : [];
  const confianza = Number(data.confianza ?? 0);

  // Normalizar la intención al vocabulario del POS. El contrato 25 devuelve
  // `intent`; el motor viejo devolvía `intencion`. Se aceptan ambos.
  const intencionCruda = String(data.intent ?? data.intencion ?? '').toUpperCase();
  const intencionNormalizada =
    POS_VOICE_INTENTS[intencionCruda] || POS_VOICE_INTENTS.DESCONOCIDA;
  // El POS SOLO acepta AGREGAR_ITEM por voz. Cualquier otra intención (cobrar,
  // cancelar, quitar) se degrada a DESCONOCIDA para que la UI no ofrezca una
  // acción destructiva/fiscal por dictado.
  const intencion = POS_ALLOWED_INTENTS.has(intencionNormalizada)
    ? intencionNormalizada
    : POS_VOICE_INTENTS.DESCONOCIDA;

  // Construir la lista de items: usar `entidades.items` / `items` si vienen;
  // si no, el campo plano (`entidades.sku` / `sku`).
  const entidades = data.entidades && typeof data.entidades === 'object' ? data.entidades : {};
  let itemsCrudos = Array.isArray(entidades.items)
    ? entidades.items
    : Array.isArray(data.items)
      ? data.items
      : [];
  const skuPlano = entidades.sku ?? data.sku;
  if (itemsCrudos.length === 0 && skuPlano) {
    itemsCrudos = [
      {
        sku: skuPlano,
        cantidad: entidades.cantidad ?? data.cantidad,
        unidad: entidades.unidad ?? data.unidad,
      },
    ];
  }

  const lineas = itemsCrudos
    .map((it) => {
      const skuRaw = it?.sku ?? '';
      const match = resolverProductoPorVoz(skuRaw, catalogo);
      const cantidad = Number(it?.cantidad ?? 0);
      return {
        // Identidad de la línea (para edición en UI)
        sku_dictado: skuRaw,
        producto_id: match ? match.id : null,
        nombre: match ? match.name : String(skuRaw || ''),
        precio: match ? Number(match.price || 0) : 0,
        cantidad: cantidad > 0 ? cantidad : 1,
        unidad: it?.unidad || 'pieza',
        resuelto: Boolean(match),
        // Regla human-in-the-loop: nada entra confirmado por defecto.
        confirmado: false,
      };
    })
    // Descartar líneas completamente vacías (sin SKU ni producto).
    .filter((l) => l.sku_dictado || l.producto_id);

  const hayNoResueltos = lineas.some((l) => !l.resuelto);

  return {
    intencion,
    lineas,
    confianza,
    texto_original: data.texto_original || '',
    // La UI resalta en ámbar si la confianza es baja o hay líneas sin resolver.
    revisar: confianza < VOICE_CART_CONFIDENCE_THRESHOLD || hayNoResueltos,
    hay_no_resueltos: hayNoResueltos,
    // Regla human-in-the-loop: la propuesta completa nace sin confirmar.
    confirmado: false,
  };
};

/**
 * Valida que la propuesta pueda aplicarse al carrito.
 * @param {object} proposal
 * @returns {{ok: boolean, error: string|null}}
 */
export const validateVoiceCartProposal = (proposal) => {
  if (!proposal) {
    return { ok: false, error: 'No hay dictado que aplicar al carrito' };
  }
  if (proposal.intencion === POS_VOICE_INTENTS.DESCONOCIDA) {
    return {
      ok: false,
      error:
        'Por voz solo puedo agregar productos a la cuenta. Intenta de nuevo o captura manualmente.',
    };
  }
  // El POS solo acepta AGREGAR_ITEM. Cualquier otra intención ya fue degradada
  // a DESCONOCIDA en el mapper; este guard es defensa en profundidad.
  if (!POS_ALLOWED_INTENTS.has(proposal.intencion)) {
    return {
      ok: false,
      error:
        'Por voz solo puedo agregar productos a la cuenta. Usa los botones para otras acciones.',
    };
  }
  const lineas = Array.isArray(proposal.lineas) ? proposal.lineas : [];
  if (lineas.length === 0) {
    return { ok: false, error: 'El dictado no contiene productos reconocibles' };
  }
  const sinResolver = lineas.filter((l) => !l.resuelto);
  if (sinResolver.length > 0) {
    return {
      ok: false,
      error: `Selecciona el producto correcto: la IA no reconoció "${sinResolver[0].sku_dictado}"`,
    };
  }
  const invalidas = lineas.filter((l) => !(Number(l.cantidad) > 0));
  if (invalidas.length > 0) {
    return { ok: false, error: 'Todas las cantidades deben ser mayores a cero' };
  }
  if (!proposal.confirmado) {
    return { ok: false, error: 'Confirma el dictado antes de aplicarlo (la IA solo propone)' };
  }
  return { ok: true, error: null };
};

/**
 * Convierte las líneas confirmadas en productos listos para `addToCart`.
 * @param {object} proposal
 * @returns {Array<{id: string, name: string, price: number, quantity: number}>}
 */
export const buildCartItemsFromProposal = (proposal) => {
  const lineas = Array.isArray(proposal?.lineas) ? proposal.lineas : [];
  return lineas
    .filter((l) => l.resuelto && Number(l.cantidad) > 0)
    .map((l) => ({
      id: l.producto_id,
      name: l.nombre,
      price: Number(l.precio || 0),
      quantity: Number(l.cantidad),
    }));
};

export default {
  VOICE_CART_CONFIDENCE_THRESHOLD,
  POS_VOICE_INTENTS,
  POS_ALLOWED_INTENTS,
  normalizar,
  resolverProductoPorVoz,
  mapVoiceIntentToCartProposal,
  validateVoiceCartProposal,
  buildCartItemsFromProposal,
};
