/**
 * useVision — FASE 7.3 (Visión cenital).
 *
 * Hook de visión asistiva para el POS. Encapsula el pipeline:
 *   1. `getUserMedia` abre la cámara cenital (nativo del navegador).
 *   2. Cada INTERVALO_CAPTURA_MS se dibuja el frame en un canvas y se
 *      codifica a base64 (JPEG).
 *   3. Contrato 17 `vision.reconocer_producto` (POST /vision/predict) →
 *      detecciones `{sku, nombre, confianza, bbox}`.
 *   4. Se descartan las detecciones con confianza < umbral (RN-72).
 *   5. Se resuelven contra el catálogo POS por SKU (RN-73).
 *
 * FRONTERA POR CONTRATOS (corrige H-3): el hook consume el contrato 17
 * declarado en F7.0, NO Gemini ni ninguna dependencia de nube. El proveedor
 * es el Centro de IA (DT-07); el POS nunca importa `@google/generative-ai`.
 *
 * VISIÓN ASISTIVA (RN-74): la visión SUGIERE, nunca bloquea la venta manual.
 * Este hook NUNCA toca el carrito. Solo produce `sugerencias` que la UI
 * muestra para que el operador decida.
 *
 * FLUJO PERSISTENTE (DT-08): el visor cenital permanece abierto durante la
 * venta (modo "escáner de charola"). El operador coloca los productos y el
 * sistema los reconoce sin apuntar. El hook NO se cierra por producto.
 *
 * UMBRAL CONFIGURABLE (DT-08): el umbral 0.35 es la calibración del montaje
 * cenital con iluminación controlada. Se lee de `VISION_CONFIG`, no se
 * hardcodea.
 *
 * DEGRADACIÓN ELEGANTE: si el contrato devuelve 503 `IA_NO_DISPONIBLE` o hay
 * un fallo de red, el hook expone `disponible=false` y el POS sigue en modo
 * manual. Nunca se propaga un 500 al POS.
 *
 * @param {Array<{id: string, sku?: string, name: string, price: number}>} productos Catálogo POS.
 * @param {object} [opciones]
 * @param {object} [opciones.config] Configuración de visión (inyectable para tests).
 * @returns {object} Estado y acciones de la visión.
 * @see PLAN_DE_ABORDAJE_FASE_7_POR_PARTES.md §8
 * @see DIRECTRICES_TRANSVERSALES_DEL_ERP.md §6.7 (DT-08)
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { CONFIG } from '../../../shared/config.js';
import { VISION_CONFIG } from '../config/vision.js';

/** Mensaje único de degradación cuando el motor de visión no está disponible. */
export const MSG_IA_NO_DISPONIBLE =
  'Visión no disponible (Centro de IA apagado). Captura manualmente.';

/**
 * Llama al contrato 17 por su ruta declarada.
 *
 * Devuelve SIEMPRE `{ ok, status, data }` y NUNCA lanza: un fallo de red se
 * traduce a `{ ok:false, status:0 }`. Esto materializa la política inviolable
 * del Centro de IA ("cualquier fallo del motor → 503 IA_NO_DISPONIBLE; nunca
 * se propaga un 500 al POS").
 *
 * @param {string} ruta Ruta del contrato (p. ej. `/vision/predict`).
 * @param {object} cuerpo
 * @returns {Promise<{ok: boolean, status: number, data: object|null}>}
 */
async function llamarContrato(ruta, cuerpo) {
  try {
    const res = await fetch(`${CONFIG.API_BASE_URL}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, data: null };
    }
    const data = await res.json();
    return { ok: true, status: res.status, data };
  } catch {
    // Fallo de red: se trata como motor no disponible (503 lógico).
    return { ok: false, status: 0, data: null };
  }
}

/**
 * Resuelve una detección contra el catálogo POS por SKU (RN-73).
 *
 * El contrato 17 etiqueta por SKU; el catálogo POS puede exponer el SKU en
 * `sku` o, en su defecto, en `id`. Se compara como texto para tolerar
 * diferencias de tipo (número vs string).
 *
 * @param {{sku?: string, nombre?: string}} deteccion
 * @param {Array<object>} productos
 * @returns {object|null} El producto del catálogo o `null` si no se resuelve.
 */
export function resolverPorSku(deteccion, productos = []) {
  if (!deteccion) return null;
  const sku = deteccion.sku != null ? String(deteccion.sku) : '';
  if (!sku) return null;
  return (
    (productos || []).find(
      (p) => String(p.sku ?? p.id ?? '') === sku
    ) || null
  );
}

/**
 * Filtra y resuelve las detecciones crudas del contrato 17.
 *
 * - Descarta las que no alcanzan el umbral (RN-72).
 * - Resuelve cada una contra el catálogo por SKU (RN-73).
 * - Conserva la confianza y el bbox para que la UI los muestre.
 *
 * @param {Array<object>} detecciones Detecciones crudas del contrato.
 * @param {Array<object>} productos Catálogo POS.
 * @param {number} umbral Umbral de confianza (DT-08).
 * @returns {Array<object>} Sugerencias resueltas.
 */
export function filtrarYResolver(detecciones = [], productos = [], umbral = 0.35) {
  return (detecciones || [])
    .filter((d) => Number(d?.confianza ?? 0) >= umbral)
    .map((d) => {
      const producto = resolverPorSku(d, productos);
      return {
        sku: d.sku != null ? String(d.sku) : '',
        nombre: d.nombre || (producto ? producto.name : ''),
        confianza: Number(d.confianza ?? 0),
        bbox: d.bbox || null,
        producto_id: producto ? producto.id : null,
        resuelto: Boolean(producto),
      };
    });
}

export function useVision(productos = [], opciones = {}) {
  const { config = VISION_CONFIG } = opciones;
  const umbral = config?.umbralConfianza ?? VISION_CONFIG.umbralConfianza;
  const modoCaptura = config?.modoCaptura ?? VISION_CONFIG.modoCaptura;
  const topK = config?.topK ?? VISION_CONFIG.topK;
  const intervaloCapturaMs =
    config?.intervaloCapturaMs ?? VISION_CONFIG.intervaloCapturaMs;

  // El visor arranca CERRADO; el operador lo abre cuando quiere (DT-08).
  const [activo, setActivo] = useState(false);
  const [analizando, setAnalizando] = useState(false);
  const [sugerencias, setSugerencias] = useState([]);
  const [disponible, setDisponible] = useState(true);
  const [error, setError] = useState(null);
  const [modeloVersion, setModeloVersion] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  // Ref para leer el catálogo más reciente sin re-crear los callbacks.
  const productosRef = useRef(productos);
  productosRef.current = productos;
  // Evita solapar dos análisis si el anterior aún no responde.
  const analizandoRef = useRef(false);

  /**
   * Libera TODOS los recursos de cámara (stream + intervalo).
   * Idempotente: se puede llamar varias veces sin efectos secundarios.
   */
  const limpiarCamara = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  /**
   * Analiza el frame actual del video contra el contrato 17.
   * No lanza: cualquier fallo se traduce a degradación elegante.
   */
  const analizarFrame = useCallback(async () => {
    if (analizandoRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    analizandoRef.current = true;
    setAnalizando(true);
    try {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frameBase64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1] || '';

      const r = await llamarContrato('/vision/predict', {
        frame_base64: frameBase64,
        channel: CONFIG.CANAL,
        top_k: topK,
        // DT-08: el contrato distingue `cenital` de `manual`.
        modo_captura: modoCaptura,
      });

      if (!r.ok) {
        if (r.status === 503 || r.status === 0) {
          setDisponible(false);
          setError(MSG_IA_NO_DISPONIBLE);
        } else {
          setError('No se pudo analizar la imagen. Captura manualmente.');
        }
        return;
      }

      setDisponible(true);
      setError(null);
      setModeloVersion(r.data?.modelo_version ?? null);
      // RN-72 (umbral) + RN-73 (resolución por SKU).
      setSugerencias(
        filtrarYResolver(r.data?.detecciones || [], productosRef.current, umbral)
      );
    } catch {
      // Cualquier excepción inesperada degrada, no rompe el POS.
      setError('No se pudo analizar la imagen. Captura manualmente.');
    } finally {
      analizandoRef.current = false;
      setAnalizando(false);
    }
  }, [modoCaptura, topK, umbral]);

  /**
   * Abre la cámara cenital y arranca el bucle de captura persistente.
   * Si el navegador no soporta `getUserMedia` o el permiso se deniega,
   * degrada a `disponible=false` sin romper el POS.
   */
  const iniciar = useCallback(async () => {
    setError(null);
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setDisponible(false);
      setError('Este dispositivo no tiene cámara disponible.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setActivo(true);
      // Bucle persistente: el visor NO se cierra por producto (DT-08).
      intervalRef.current = setInterval(analizarFrame, intervaloCapturaMs);
    } catch {
      setDisponible(false);
      setError('No se pudo abrir la cámara. Revisa el permiso o captura manualmente.');
    }
  }, [analizarFrame, intervaloCapturaMs]);

  /** Cierra la cámara y detiene el bucle. */
  const detener = useCallback(() => {
    limpiarCamara();
    setActivo(false);
    setAnalizando(false);
    setSugerencias([]);
  }, [limpiarCamara]);

  /** Alterna el visor (abrir/cerrar). */
  const alternar = useCallback(() => {
    if (activo) {
      detener();
    } else {
      iniciar();
    }
  }, [activo, iniciar, detener]);

  /** Limpia las sugerencias actuales sin cerrar el visor. */
  const limpiarSugerencias = useCallback(() => setSugerencias([]), []);

  // Al desmontar, liberar la cámara (no dejar el LED encendido).
  useEffect(() => () => limpiarCamara(), [limpiarCamara]);

  return {
    // Estado
    activo,
    analizando,
    sugerencias,
    disponible,
    error,
    modeloVersion,
    // Configuración efectiva (para que la UI muestre el umbral vigente).
    umbral,
    modoCaptura,
    // Refs para montar <video> y <canvas> en el visor.
    videoRef,
    canvasRef,
    // Acciones
    iniciar,
    detener,
    alternar,
    analizarFrame,
    limpiarSugerencias,
  };
}

export default useVision;
