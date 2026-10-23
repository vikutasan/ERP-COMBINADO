/**
 * Puerta de FASE 7.2 — Voz: `useVoiceCart` (hook).
 *
 * @paridad: hooks/useVoiceCart.f7_2.test.jsx
 * @operacion: El carrito por voz agrega productos por nombre
 *
 * Cubre los criterios 6–9 del gate (§7.4 del plan):
 *   6. Llama al contrato `ia.transcribir_voz` (POST /ai/voice/transcribe).
 *   7. Llama al contrato `ia.interpretar_intencion` (POST /ai/voice/parse-intent).
 *   8. Expone `disponible=false` si el contrato devuelve 503.
 *   9. NUNCA modifica el carrito (solo produce `propuesta`).
 *
 * Se mockea `fetch` para observar las rutas exactas de los contratos y forzar
 * la degradación 503. Se mockean `MediaRecorder` y `getUserMedia` para poder
 * ejercitar el pipeline sin hardware de audio.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVoiceCart, MSG_IA_NO_DISPONIBLE } from './useVoiceCart.js';
import { POS_VOICE_INTENTS } from '../utils/voiceCartMapper.js';

const CATALOGO = [
  { id: 'SKU-001', name: 'Concha Vainilla', price: 12.5 },
  { id: 'SKU-002', name: 'Bolillo', price: 3.0 },
];

/** Respuesta del contrato 25 (NLU) para un dictado válido. */
const RESPUESTA_NLU_OK = {
  intent: 'AGREGAR_ITEM',
  entidades: { items: [{ sku: 'SKU-002', cantidad: 3 }] },
  confianza: 0.95,
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

/** Simula un MediaRecorder que emite un chunk y dispara `onstop` al detener. */
function instalarMediaRecorder() {
  class MediaRecorderFalso {
    constructor(stream) {
      this.stream = stream;
      this.state = 'inactive';
      this.mimeType = 'audio/webm';
      this.ondataavailable = null;
      this.onstop = null;
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      if (this.ondataavailable) {
        this.ondataavailable({ data: new Blob(['audio'], { type: 'audio/webm' }) });
      }
      if (this.onstop) this.onstop();
    }
  }
  global.MediaRecorder = MediaRecorderFalso;
  global.navigator.mediaDevices = {
    getUserMedia: vi.fn(async () => ({
      getTracks: () => [{ stop: vi.fn() }],
    })),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  delete global.fetch;
  delete global.MediaRecorder;
});

describe('F7.2 · useVoiceCart · criterio 6 — contrato ia.transcribir_voz', () => {
  it('llama a POST /ai/voice/transcribe (contrato 24)', async () => {
    instalarMediaRecorder();
    const llamadas = instalarFetch({
      '/ai/voice/transcribe': { status: 200, body: { texto: 'agrega 3 bolillos' } },
      '/ai/voice/parse-intent': { status: 200, body: RESPUESTA_NLU_OK },
    });

    const { result } = renderHook(() => useVoiceCart(CATALOGO));

    await act(async () => {
      await result.current.iniciar();
    });
    await act(async () => {
      result.current.detener();
    });

    await waitFor(() => {
      expect(llamadas.some((l) => l.ruta === '/ai/voice/transcribe')).toBe(true);
    });
    const llamada = llamadas.find((l) => l.ruta === '/ai/voice/transcribe');
    expect(llamada.opciones.method).toBe('POST');
    const cuerpo = JSON.parse(llamada.opciones.body);
    expect(cuerpo).toHaveProperty('audio_base64');
    expect(cuerpo.idioma).toBe('es-MX');
  });
});

describe('F7.2 · useVoiceCart · criterio 7 — contrato ia.interpretar_intencion', () => {
  it('llama a POST /ai/voice/parse-intent (contrato 25) tras transcribir', async () => {
    instalarMediaRecorder();
    const llamadas = instalarFetch({
      '/ai/voice/transcribe': { status: 200, body: { texto: 'agrega 3 bolillos' } },
      '/ai/voice/parse-intent': { status: 200, body: RESPUESTA_NLU_OK },
    });

    const { result } = renderHook(() => useVoiceCart(CATALOGO));

    await act(async () => {
      await result.current.iniciar();
    });
    await act(async () => {
      result.current.detener();
    });

    await waitFor(() => {
      expect(llamadas.some((l) => l.ruta === '/ai/voice/parse-intent')).toBe(true);
    });
    const llamada = llamadas.find((l) => l.ruta === '/ai/voice/parse-intent');
    const cuerpo = JSON.parse(llamada.opciones.body);
    expect(cuerpo.texto).toBe('agrega 3 bolillos');
    expect(cuerpo.contexto).toHaveProperty('modulo', 'pos');
  });

  it('produce una propuesta con las líneas resueltas', async () => {
    instalarMediaRecorder();
    instalarFetch({
      '/ai/voice/transcribe': { status: 200, body: { texto: 'agrega 3 bolillos' } },
      '/ai/voice/parse-intent': { status: 200, body: RESPUESTA_NLU_OK },
    });

    const { result } = renderHook(() => useVoiceCart(CATALOGO));

    await act(async () => {
      await result.current.iniciar();
    });
    await act(async () => {
      result.current.detener();
    });

    await waitFor(() => {
      expect(result.current.propuesta).not.toBeNull();
    });
    expect(result.current.propuesta.intencion).toBe(POS_VOICE_INTENTS.AGREGAR_ITEM);
    expect(result.current.propuesta.lineas[0].producto_id).toBe('SKU-002');
    expect(result.current.propuesta.lineas[0].cantidad).toBe(3);
  });
});

describe('F7.2 · useVoiceCart · criterio 8 — degradación 503', () => {
  it('expone disponible=false si el contrato de transcripción devuelve 503', async () => {
    instalarMediaRecorder();
    instalarFetch({
      '/ai/voice/transcribe': { status: 503, body: { detail: 'IA_NO_DISPONIBLE' } },
    });

    const { result } = renderHook(() => useVoiceCart(CATALOGO));

    await act(async () => {
      await result.current.iniciar();
    });
    await act(async () => {
      result.current.detener();
    });

    await waitFor(() => {
      expect(result.current.disponible).toBe(false);
    });
    expect(result.current.error).toBe(MSG_IA_NO_DISPONIBLE);
  });

  it('expone disponible=false si el contrato NLU devuelve 503', async () => {
    instalarMediaRecorder();
    instalarFetch({
      '/ai/voice/transcribe': { status: 200, body: { texto: 'agrega 3 bolillos' } },
      '/ai/voice/parse-intent': { status: 503, body: { detail: 'IA_NO_DISPONIBLE' } },
    });

    const { result } = renderHook(() => useVoiceCart(CATALOGO));

    await act(async () => {
      await result.current.iniciar();
    });
    await act(async () => {
      result.current.detener();
    });

    await waitFor(() => {
      expect(result.current.disponible).toBe(false);
    });
  });

  it('expone disponible=false si el navegador no soporta audio', async () => {
    // Sin MediaRecorder ni getUserMedia.
    const { result } = renderHook(() => useVoiceCart(CATALOGO));

    await act(async () => {
      await result.current.iniciar();
    });

    expect(result.current.disponible).toBe(false);
    expect(result.current.grabando).toBe(false);
  });
});

describe('F7.2 · useVoiceCart · criterio 9 — NUNCA toca el carrito', () => {
  it('el hook no expone ninguna acción que mute el carrito', () => {
    const { result } = renderHook(() => useVoiceCart(CATALOGO));
    const claves = Object.keys(result.current);
    // No hay `addToCart`, `anadirLinea`, `clearCart`, etc.
    expect(claves).not.toContain('addToCart');
    expect(claves).not.toContain('anadirLinea');
    expect(claves).not.toContain('clearCart');
    expect(claves).not.toContain('aplicar');
    // Solo produce `propuesta` + acciones de edición de la propuesta.
    expect(claves).toContain('propuesta');
    expect(claves).toContain('editarLinea');
    expect(claves).toContain('quitarLinea');
    expect(claves).toContain('alternarConfirmacion');
  });

  it('editarLinea solo muta la propuesta, nunca un carrito externo', async () => {
    instalarMediaRecorder();
    instalarFetch({
      '/ai/voice/transcribe': { status: 200, body: { texto: 'agrega 3 bolillos' } },
      '/ai/voice/parse-intent': { status: 200, body: RESPUESTA_NLU_OK },
    });

    const { result } = renderHook(() => useVoiceCart(CATALOGO));

    await act(async () => {
      await result.current.iniciar();
    });
    await act(async () => {
      result.current.detener();
    });
    await waitFor(() => {
      expect(result.current.propuesta).not.toBeNull();
    });

    act(() => {
      result.current.editarLinea(0, 'cantidad', 7);
    });
    expect(result.current.propuesta.lineas[0].cantidad).toBe(7);
    // La propuesta sigue sin confirmar: el operador decide.
    expect(result.current.propuesta.confirmado).toBe(false);
  });

  it('alternarConfirmacion marca la propuesta como confirmada sin aplicarla', async () => {
    instalarMediaRecorder();
    instalarFetch({
      '/ai/voice/transcribe': { status: 200, body: { texto: 'agrega 3 bolillos' } },
      '/ai/voice/parse-intent': { status: 200, body: RESPUESTA_NLU_OK },
    });

    const { result } = renderHook(() => useVoiceCart(CATALOGO));

    await act(async () => {
      await result.current.iniciar();
    });
    await act(async () => {
      result.current.detener();
    });
    await waitFor(() => {
      expect(result.current.propuesta).not.toBeNull();
    });

    act(() => {
      result.current.alternarConfirmacion();
    });
    expect(result.current.propuesta.confirmado).toBe(true);
  });
});
