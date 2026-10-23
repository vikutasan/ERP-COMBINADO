/**
 * CatalogoPDF — FASE 6.3 (Entregable B: carta/catálogo en PDF).
 *
 * Genera un PDF tipo carta con el logo, el nombre del negocio, la fecha y las
 * categorías seleccionadas con sus productos (nombre + precio). Es el documento
 * que el dueño envía por correo a su proveedor de impresiones.
 *
 * Decisiones (plan v2.1 §9.2):
 *  - Se usa jsPDF (única dependencia nueva de la Fase 6).
 *  - El generador NO toca el DOM ni React: recibe datos y devuelve un resultado.
 *  - Contrato `{outcome, reason}`: nunca lanza, siempre devuelve.
 *  - Si no hay categorías seleccionadas → `fallo('sin_categorias')`.
 *  - Una categoría sin productos NO rompe la generación (se omite su bloque).
 *  - El PDF es multipágina: cuando el cursor llega al pie, se agrega una página.
 *
 * Prohibiciones respetadas:
 *  - E-05: ningún `catch` silencioso; todo error se traduce a un `reason`.
 *  - E-15: sin `console.log`.
 *  - R-01: este archivo no declara anchos fijos en `px` (no aplica: no es UI).
 */

import { jsPDF } from 'jspdf';
import { ok, fallo } from '../utils/outcome.js';

/** Nombre del negocio que encabeza la carta. */
export const NOMBRE_NEGOCIO = 'R de Rico';

/** Márgenes y geometría de la página (unidades: milímetros). */
const MARGEN = 14;
const ANCHO_PAGINA = 210;
const ALTO_PAGINA = 297;
const ANCHO_UTIL = ANCHO_PAGINA - MARGEN * 2;
const ALTO_PIE = 18;
const ALTO_FILA = 9;
const ALTO_TITULO_CATEGORIA = 14;

/** Paleta del documento (coincide con la paleta canónica del POS). */
const COLOR_ACENTO = [176, 42, 55];
const COLOR_TEXTO = [33, 33, 33];

/**
 * Formatea un valor monetario como MXN.
 * Replica el patrón de `CheckoutScreen.formatearPrecio` para que la carta y el
 * ticket hablen el mismo idioma.
 *
 * @param {number|string} valor
 * @returns {string}
 */
export function formatearPrecio(valor) {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return '$0.00';
  return numero.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  });
}

/**
 * Formatea la fecha que se imprime bajo el nombre del negocio.
 *
 * @param {Date} [instante]
 * @returns {string}
 */
export function formatearFecha(instante = new Date()) {
  const fecha = instante instanceof Date ? instante : new Date(instante);
  if (Number.isNaN(fecha.getTime())) return '';
  return fecha.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Normaliza la entrada a una lista de categorías con sus productos.
 *
 * Acepta dos formas:
 *  - `[{ id, name, productos: [...] }]` (categoría ya hidratada).
 *  - `[{ id, name }]` + un segundo argumento `productos` global.
 *
 * @param {Array<object>} categorias
 * @param {Array<object>} [productos]
 * @returns {Array<{id: string, name: string, productos: Array<object>}>}
 */
export function normalizarCategorias(categorias, productos = []) {
  if (!Array.isArray(categorias)) return [];
  return categorias.map((categoria) => {
    const propias = Array.isArray(categoria?.productos)
      ? categoria.productos
      : productos.filter((p) => p?.category_id === categoria?.id);
    return {
      id: categoria?.id ?? '',
      name: categoria?.name ?? 'Sin nombre',
      productos: Array.isArray(propias) ? propias : [],
    };
  });
}

/**
 * Dibuja el encabezado de la carta (nombre + fecha).
 *
 * @param {jsPDF} doc
 * @returns {number} la coordenada Y donde continúa el contenido.
 */
function dibujarEncabezado(doc) {
  doc.setFillColor(...COLOR_ACENTO);
  doc.rect(0, 0, ANCHO_PAGINA, 26, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(NOMBRE_NEGOCIO, MARGEN, 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Carta de productos', MARGEN, 20);

  doc.setFontSize(9);
  doc.text(formatearFecha(), ANCHO_PAGINA - MARGEN, 20, { align: 'right' });

  doc.setTextColor(...COLOR_TEXTO);
  return 36;
}

/**
 * Dibuja el título de una categoría.
 *
 * @param {jsPDF} doc
 * @param {string} nombre
 * @param {number} y
 * @returns {number} la nueva coordenada Y.
 */
function dibujarTituloCategoria(doc, nombre, y) {
  doc.setFillColor(245, 240, 232);
  doc.rect(MARGEN, y - 5, ANCHO_UTIL, 9, 'F');

  doc.setTextColor(...COLOR_ACENTO);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(String(nombre).toUpperCase(), MARGEN + 2, y + 1);

  doc.setTextColor(...COLOR_TEXTO);
  return y + ALTO_TITULO_CATEGORIA;
}

/**
 * Dibuja una fila de producto (nombre a la izquierda, precio a la derecha).
 *
 * @param {jsPDF} doc
 * @param {object} producto
 * @param {number} y
 * @returns {number} la nueva coordenada Y.
 */
function dibujarProducto(doc, producto, y) {
  const nombre = String(producto?.name ?? 'Producto');
  const precio = formatearPrecio(producto?.price);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...COLOR_TEXTO);
  doc.text(nombre, MARGEN + 2, y);

  doc.setFont('helvetica', 'bold');
  doc.text(precio, ANCHO_PAGINA - MARGEN - 2, y, { align: 'right' });

  doc.setDrawColor(230, 230, 230);
  doc.line(MARGEN, y + 2.5, ANCHO_PAGINA - MARGEN, y + 2.5);

  return y + ALTO_FILA;
}

/**
 * Genera el PDF del catálogo y lo devuelve como documento jsPDF.
 *
 * @param {Array<object>} categorias categorías seleccionadas (con o sin productos).
 * @param {Array<object>} [productos] catálogo completo, para hidratar por `category_id`.
 * @returns {{outcome: string, reason?: string, data?: {doc: jsPDF, paginas: number}}}
 */
export function generarCatalogoPDF(categorias, productos = []) {
  try {
    const normalizadas = normalizarCategorias(categorias, productos);

    if (normalizadas.length === 0) {
      return fallo('sin_categorias');
    }

    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    let y = dibujarEncabezado(doc);
    let paginas = 1;

    for (const categoria of normalizadas) {
      if (y + ALTO_TITULO_CATEGORIA > ALTO_PAGINA - ALTO_PIE) {
        doc.addPage();
        paginas += 1;
        y = MARGEN + 6;
      }

      y = dibujarTituloCategoria(doc, categoria.name, y);

      for (const producto of categoria.productos) {
        if (y + ALTO_FILA > ALTO_PAGINA - ALTO_PIE) {
          doc.addPage();
          paginas += 1;
          y = MARGEN + 6;
        }
        y = dibujarProducto(doc, producto, y);
      }

      y += 4;
    }

    return ok({ doc, paginas });
  } catch (err) {
    return fallo(err?.message || 'error_al_generar_pdf');
  }
}

/**
 * Genera el PDF y dispara la descarga en el navegador.
 *
 * @param {Array<object>} categorias
 * @param {Array<object>} [productos]
 * @param {string} [nombreArchivo]
 * @returns {{outcome: string, reason?: string, data?: {paginas: number}}}
 */
export function descargarCatalogoPDF(
  categorias,
  productos = [],
  nombreArchivo = 'carta-r-de-rico.pdf',
) {
  const resultado = generarCatalogoPDF(categorias, productos);
  if (resultado.outcome !== 'ok') {
    return fallo(resultado.reason);
  }

  try {
    resultado.data.doc.save(nombreArchivo);
    return ok({ paginas: resultado.data.paginas });
  } catch (err) {
    return fallo(err?.message || 'error_al_descargar_pdf');
  }
}

export default { generarCatalogoPDF, descargarCatalogoPDF, normalizarCategorias };
