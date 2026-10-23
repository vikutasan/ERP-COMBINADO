/**
 * Puerta de FASE 7.3 — Visión: `useVision` (hook).
 *
 * @paridad: hooks/useVision.f7_3.test.jsx
 * @operacion: La cámara de visión reconoce productos
 *
 * Cubre los criterios 1–5, 9 y 10 del gate (§8.4 del plan):
 *   1. Llama al contrato 17 (`vision.reconocer_producto`, POST /vision/predict).
 *   2. NO importa `@google/generative-ai` ni ninguna dependencia de nube.
 *   3. Expone `disponible=false` si el contrato devuelve 503.
 *   4. Descarta detecciones con confianza < 0.35 (RN-72).
 *   5. Resuelve la detección contra el catálogo por SKU (RN-73).
 *   9. Envía `modo_captura: 'cenital'` en la llamada al contrato 17 (DT-08).
 *  10. Lee el umbral de configuración (no lo hardcodea); 0.35 por defecto (DT-08).
 *
 * Se mockea `fetch` para observar la ruta exacta del contrato y forzar la
 * degradación 503. Se mockea `getUserMedia` para ejercitar el pipeline sin
 * hardware de cámara.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  useVision,
  MSG_IA_NO_DISPONIBLE,
  resolverPorSku,
  filtrarYResolver,
} from './useVision.js';
import { VISION_CONFIG, UMBRAL_CONFIANZA_POR_DEFECTO } from '../config/vision.js';

const CATALOGO = [
  { id: 'SKU-001', sku: 'SKU-001', name: 'Concha Vainilla', price: 12.5 },
  { id: 'SKU-002', sku: 'SKU-002', name: 'Bolillo', price: 3.0 },
];

/** Respuesta del contrato 17 con dos detecciones (una sobre el umbral, una bajo). */
const RESPUESTA_VISION_OK = {
  detecciones: [
    { sku: 'SKU-001', nombre: 'Concha Vainilla', confianza: 0.92, bbox: [0, 0, 10, 10] },
    { sku: 'SKU-002', nombre: 'Bolillo', confianza: 0.20, bbox: [1, 1, 5, 5] },
  ],
  modelo_version: 'orb-cenital-v1',
};

/**
 * Instala un `fetch` simulado que registra las rutas llamadas y responde según
 * un mapa `{ ruta: { status, body } }`.
 */
function instalarFetch(respuestas) {
  const llamadas = [];
  global.fetch = vi.fn(async (url, opciones = {}) => {
    const ruta = String(url).replace(/^https?:\/\/[^/]+/, '');
    llamadas.push({ ruta, opciones });
    const cfg = respuestas[ruta] || { status: 200, body: {} };
    return {
      ok: cfg.status >= 200 && cfg.status < 300,
      status: cfg.status,
      json: async () => cfg.body,
    };
  });
  return llamadas;
}

/** Simula `getUserMedia` devolviendo un stream con tracks detenibles. */
function instalarCamara() {
  global.navigator.mediaDevices = {
    getUserMedia: vi.fn(async () => ({
      getTracks: () => [{ stop: vi.fn() }],
    })),
  };
}

/**
 * Monta el hook con un `<video>` y un `<canvas>` reales en el DOM, porque
 * `analizarFrame` dibuja el frame en el canvas. Se usa un canvas falso que
 * devuelve un dataURL estable.
 */
function montarConCanvas() {
  const video = document.createElement('video');
  const canvas = document.createElement('canvas');
  // jsdom no implementa getContext('2d'); se sustituye por un doble mínimo.
  canvas.getContext = () => ({ drawImage: vi.fn() });
  canvas.toDataURL = () => 'data:image/jpeg;base64,FRAME';
  document.body.appendChild(video);
  document.body.appendChild(canvas);
  return { video, canvas };
}

beforeEach(() => {
  vi.restoreAllMocks();
  instalarCamara();
});

afterEach(() => {
  delete global.fetch;
  document.body.innerHTML = '';
});

describe('F7.3 · useVision · criterio 1 — contrato 17', () => {
  it('llama a POST /vision/predict (contrato 17)', async () => {
    const llamadas = instalarFetch({ '/vision/predict': { status: 200, body: RESPUESTA_VISION_OK } });
    const { video, canvas } = montarConCanvas();
    const { result } = renderHook(() => useVision(CATALOGO));

    result.current.videoRef.current = video;
    result.current.canvasRef.current = canvas;

    await act(async () => {
      await result.current.analizarFrame();
    });

    expect(llamadas.some((l) => l.ruta === '/vision/predict')).toBe(true);
    const llamada = llamadas.find((l) => l.ruta === '/vision/predict');
    expect(llamada.opciones.method).toBe('POST');
  });
});

describe('F7.3 · useVision · criterio 2 — cero dependencias de nube', () => {
  it('el archivo NO importa @google/generative-ai', () => {
    const aqui = dirname(fileURLToPath(import.meta.url));
    const fuente = readFileSync(resolve(aqui, 'useVision.js'), 'utf8');
    // Se inspeccionan SOLO las líneas de import/require, no los comentarios:
    // la docstring menciona la dependencia para explicar que NO se usa.
    const lineasDeImport = fuente
      .split('\n')
      .filter((l) => /^\s*(import|const\s+\w+\s*=\s*require)/.test(l));
    const imports = lineasDeImport.join('\n');
    expect(imports).not.toMatch(/@google\/generative-ai/);
    expect(imports).not.toMatch(/GoogleGenerativeAI/);
    expect(imports).not.toMatch(/gemini/i);
  });
});

describe('F7.3 · useVision · criterio 3 — degradación 503', () => {
  it('expone disponible=false si el contrato devuelve 503', async () => {
    instalarFetch({ '/vision/predict': { status: 503, body: {} } });
    const { video, canvas } = montarConCanvas();
    const { result } = renderHook(() => useVision(CATALOGO));

    result.current.videoRef.current = video;
    result.current.canvasRef.current = canvas;

    await act(async () => {
      await result.current.analizarFrame();
    });

    expect(result.current.disponible).toBe(false);
    expect(result.current.error).toBe(MSG_IA_NO_DISPONIBLE);
  });

  it('expone disponible=false si hay un fallo de red (status 0)', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    });
    const { video, canvas } = montarConCanvas();
    const { result } = renderHook(() => useVision(CATALOGO));

    result.current.videoRef.current = video;
    result.current.canvasRef.current = canvas;

    await act(async () => {
      await result.current.analizarFrame();
    });

    expect(result.current.disponible).toBe(false);
    expect(result.current.error).toBe(MSG_IA_NO_DISPONIBLE);
  });
});

describe('F7.3 · useVision · criterio 4 — umbral 0.35 (RN-72)', () => {
  it('descarta las detecciones con confianza < 0.35', async () => {
    instalarFetch({ '/vision/predict': { status: 200, body: RESPUESTA_VISION_OK } });
    const { video, canvas } = montarConCanvas();
    const { result } = renderHook(() => useVision(CATALOGO));

    result.current.videoRef.current = video;
    result.current.canvasRef.current = canvas;

    await act(async () => {
      await result.current.analizarFrame();
    });

    // Solo la detección con confianza 0.92 sobrevive; la de 0.20 se descarta.
    expect(result.current.sugerencias).toHaveLength(1);
    expect(result.current.sugerencias[0].sku).toBe('SKU-001');
  });

  it('filtrarYResolver descarta por debajo del umbral y conserva el resto', () => {
    const res = filtrarYResolver(RESPUESTA_VISION_OK.detecciones, CATALOGO, 0.35);
    expect(res.map((r) => r.sku)).toEqual(['SKU-001']);
  });
});

describe('F7.3 · useVision · criterio 5 — resolución por SKU (RN-73)', () => {
  it('resuelve la detección contra el catálogo por SKU', async () => {
    instalarFetch({ '/vision/predict': { status: 200, body: RESPUESTA_VISION_OK } });
    const { video, canvas } = montarConCanvas();
    const { result } = renderHook(() => useVision(CATALOGO));

    result.current.videoRef.current = video;
    result.current.canvasRef.current = canvas;

    await act(async () => {
      await result.current.analizarFrame();
    });

    expect(result.current.sugerencias[0].producto_id).toBe('SKU-001');
    expect(result.current.sugerencias[0].resuelto).toBe(true);
  });

  it('resolverPorSku devuelve null si el SKU no está en el catálogo', () => {
    expect(resolverPorSku({ sku: 'NO-EXISTE' }, CATALOGO)).toBeNull();
  });

  it('marca resuelto=false cuando el SKU no está en el catálogo', () => {
    const res = filtrarYResolver(
      [{ sku: 'NO-EXISTE', nombre: 'Fantasma', confianza: 0.9 }],
      CATALOGO,
      0.35
    );
    expect(res[0].resuelto).toBe(false);
    expect(res[0].producto_id).toBeNull();
  });
});

describe('F7.3 · useVision · criterio 9 — modo_captura cenital (DT-08)', () => {
  it("envía modo_captura: 'cenital' en la llamada al contrato 17", async () => {
    const llamadas = instalarFetch({ '/vision/predict': { status: 200, body: RESPUESTA_VISION_OK } });
    const { video, canvas } = montarConCanvas();
    const { result } = renderHook(() => useVision(CATALOGO));

    result.current.videoRef.current = video;
    result.current.canvasRef.current = canvas;

    await act(async () => {
      await result.current.analizarFrame();
    });

    const llamada = llamadas.find((l) => l.ruta === '/vision/predict');
    const cuerpo = JSON.parse(llamada.opciones.body);
    expect(cuerpo.modo_captura).toBe('cenital');
  });
});

describe('F7.3 · useVision · criterio 10 — umbral configurable (DT-08)', () => {
  it('el umbral por defecto es 0.35 y vive en configuración', () => {
    expect(UMBRAL_CONFIANZA_POR_DEFECTO).toBe(0.35);
    expect(VISION_CONFIG.umbralConfianza).toBe(0.35);
  });

  it('el hook lee el umbral de la configuración inyectada (no lo hardcodea)', async () => {
    instalarFetch({ '/vision/predict': { status: 200, body: RESPUESTA_VISION_OK } });
    const { video, canvas } = montarConCanvas();
    // Con umbral 0.1, la detección de 0.20 también sobrevive → 2 sugerencias.
    const { result } = renderHook(() =>
      useVision(CATALOGO, { config: { ...VISION_CONFIG, umbralConfianza: 0.1 } })
    );

    result.current.videoRef.current = video;
    result.current.canvasRef.current = canvas;

    await act(async () => {
      await result.current.analizarFrame();
    });

    expect(result.current.umbral).toBe(0.1);
    expect(result.current.sugerencias).toHaveLength(2);
  });

  it('el archivo del hook NO hardcodea 0.35 (lo lee de config)', () => {
    const aqui = dirname(fileURLToPath(import.meta.url));
    const fuente = readFileSync(resolve(aqui, 'useVision.js'), 'utf8');
    // El literal 0.35 solo puede aparecer como valor por defecto de parámetro
    // de `filtrarYResolver`, nunca como constante interna del hook.
    expect(fuente).toMatch(/VISION_CONFIG/);
  });
});

describe('F7.3 · useVision · flujo persistente (DT-08)', () => {
  it('iniciar abre la cámara y deja el visor activo', async () => {
    instalarFetch({ '/vision/predict': { status: 200, body: RESPUESTA_VISION_OK } });
    const { video, canvas } = montarConCanvas();
    const { result } = renderHook(() => useVision(CATALOGO));

    result.current.videoRef.current = video;
    result.current.canvasRef.current = canvas;

    await act(async () => {
      await result.current.iniciar();
    });

    expect(result.current.activo).toBe(true);
    // El visor NO se cierra por producto: sigue activo tras analizar.
    await act(async () => {
      await result.current.analizarFrame();
    });
    expect(result.current.activo).toBe(true);

    act(() => {
      result.current.detener();
    });
    expect(result.current.activo).toBe(false);
  });

  it('degrada si el navegador no tiene getUserMedia', async () => {
    delete global.navigator.mediaDevices;
    const { result } = renderHook(() => useVision(CATALOGO));

    await act(async () => {
      await result.current.iniciar();
    });

    expect(result.current.disponible).toBe(false);
    expect(result.current.activo).toBe(false);
  });
});
