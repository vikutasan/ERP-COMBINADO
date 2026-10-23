/**
 * useVoiceCart — FASE 7.2 (Voz).
 *
 * Hook de dictado por voz para el carrito del POS. Encapsula el pipeline:
 *   1. MediaRecorder captura audio del micrófono (manos libres / headset).
 *   2. Contrato 24 `ia.transcribir_voz`  → Whisper local → texto.
 *   3. Contrato 25 `ia.interpretar_intencion` → Ollama local → intención JSON.
 *   4. `mapVoiceIntentToCartProposal` → propuesta editable (NO aplicada aún).
 *
 * FRONTERA POR CONTRATOS (corrige H-2): el hook consume los contratos 24 y 25
 * declarados en F7.0, NO endpoints sueltos. El proveedor es el Centro de IA
 * (DT-07); el POS nunca importa torch/whisper/ollama.
 *
 * CAPTURA CONTINUA: al pulsar el botón una sola vez, el hook abre un
 * `AudioContext` + `AnalyserNode` y vigila el nivel RMS del micrófono:
 *   - Fase `esperando_voz`: aún no habla. Si no habla en ESPERA_VOZ_MS, aborta.
 *   - Fase `capturando`:    está hablando. Cada vez que el RMS supera el umbral
 *                           se reinicia el temporizador de silencio.
 *   - Auto-stop:            tras SILENCIO_MS sin voz, detiene y transcribe.
 *   - Red de seguridad:     MAX_GRABACION_MS corta la grabación pase lo que pase.
 *
 * REGLA DE ORO (H-5): la IA PROPONE, el operador CONFIRMA. Este hook NUNCA
 * toca el carrito. Solo produce una `propuesta` que la UI muestra para que el
 * operador la revise y confirme.
 *
 * DEGRADACIÓN ELEGANTE: si el navegador no soporta audio o el contrato devuelve
 * 503 `IA_NO_DISPONIBLE`, el hook expone `disponible=false` y el POS sigue
 * funcionando en modo manual. Nunca se propaga un 500 al POS.
 *
 * @param {Array<{id: string, name: string, price: number}>} productos Catálogo POS.
 * @param {object} [opciones]
 * @param {object} [opciones.cliente] Cliente del API (inyectable para tests).
 * @returns {object} Estado y acciones del dictado.
 * @see PLAN_DE_ABORDAJE_FASE_7_POR_PARTES.md §7
 */

import { useState, useRef, useCallback } from 'react';
import { CONFIG } from '../../../shared/config.js';
import {
  mapVoiceIntentToCartProposal,
  POS_VOICE_INTENTS,
} from '../utils/voiceCartMapper.js';
import { VOZ_CONFIG } from '../config/voz.js';

/** Mensaje único de degradación cuando el motor de IA no está disponible. */
export const MSG_IA_NO_DISPONIBLE =
  'Dictado por voz no disponible (IA local apagada). Captura manualmente.';

/**
 * Llama a un contrato del Centro de IA por su ruta declarada.
 *
 * Devuelve SIEMPRE `{ ok, status, data }` y NUNCA lanza: un fallo de red se
 * traduce a `{ ok:false, status:0 }`. Esto materializa la política inviolable
 * del Centro de IA ("cualquier fallo del motor → 503 IA_NO_DISPONIBLE; nunca
 * se propaga un 500 al POS").
 *
 * @param {string} ruta Ruta del contrato (p. ej. `/ai/voice/transcribe`).
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

export function useVoiceCart(productos = [], opciones = {}) {
  const { cliente = null } = opciones;

  const [grabando, setGrabando] = useState(false);
  const [transcribiendo, setTranscribiendo] = useState(false);
  const [texto, setTexto] = useState('');
  const [propuesta, setPropuesta] = useState(null);
  const [disponible, setDisponible] = useState(true);
  const [error, setError] = useState(null);
  // Fase de la captura continua para feedback visual en la UI.
  // 'inactivo' | 'esperando_voz' | 'capturando' | 'procesando'
  const [fase, setFase] = useState('inactivo');
  // Nivel de audio normalizado (0..1) para el medidor visual.
  const [nivel, setNivel] = useState(0);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  // Ref para leer el catálogo más reciente sin re-crear los callbacks.
  const productosRef = useRef(productos);
  productosRef.current = productos;

  // --- refs del monitoreo de silencio (Web Audio API) ---
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const monitorTimerRef = useRef(null);
  const maxTimerRef = useRef(null);
  const silencioAcumuladoRef = useRef(0);
  const vozAcumuladaRef = useRef(0);
  const habloRef = useRef(false);

  /**
   * Libera TODOS los recursos de audio (contexto, stream, timers).
   * Idempotente: se puede llamar varias veces sin efectos secundarios.
   */
  const limpiarAudio = useCallback(() => {
    if (monitorTimerRef.current) {
      clearInterval(monitorTimerRef.current);
      monitorTimerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {
        // El contexto ya estaba cerrado; ignorar.
      }
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    silencioAcumuladoRef.current = 0;
    vozAcumuladaRef.current = 0;
    habloRef.current = false;
    setNivel(0);
  }, []);

  const reset = useCallback(() => {
    limpiarAudio();
    setPropuesta(null);
    setTexto('');
    setGrabando(false);
    setTranscribiendo(false);
    setError(null);
    setFase('inactivo');
    audioChunksRef.current = [];
  }, [limpiarAudio]);

  /**
   * Envía el texto transcrito al NLU (contrato 25) y construye la propuesta.
   * @param {string} textoDictado
   */
  const interpretar = useCallback(async (textoDictado) => {
    const r = await llamarContrato('/ai/voice/parse-intent', {
      texto: textoDictado,
      contexto: {
        modulo: 'pos',
        skus_disponibles: (productosRef.current || []).map((p) => p.id).slice(0, 50),
      },
    });

    if (!r.ok) {
      if (r.status === 503 || r.status === 0) {
        setDisponible(false);
        setError(MSG_IA_NO_DISPONIBLE);
      } else {
        setError('No se pudo interpretar el dictado. Captura manualmente.');
      }
      return;
    }

    const nueva = mapVoiceIntentToCartProposal(r.data, productosRef.current);
    setPropuesta(nueva);
    if (nueva.intencion === POS_VOICE_INTENTS.DESCONOCIDA) {
      setError('La IA no entendió el dictado. Intenta de nuevo o captura manualmente.');
    } else if (nueva.hay_no_resueltos) {
      setError('La IA no reconoció algún producto. Selecciónalo manualmente.');
    } else if (nueva.revisar) {
      setError('Confianza baja: revisa los productos y cantidades antes de confirmar.');
    } else {
      setError(null);
    }
  }, []);

  /**
   * Transcribe el audio grabado (contrato 24) y dispara la interpretación.
   * @param {Blob} blob
   */
  const transcribir = useCallback(
    async (blob) => {
      setTranscribiendo(true);
      setFase('procesando');
      try {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        const r = await llamarContrato('/ai/voice/transcribe', {
          audio_base64: base64,
          formato: blob.type || 'audio/webm',
          idioma: 'es-MX',
        });

        if (!r.ok) {
          if (r.status === 503 || r.status === 0) {
            setDisponible(false);
            setError(MSG_IA_NO_DISPONIBLE);
          } else {
            setError('No se pudo procesar el audio. Captura manualmente.');
          }
          return;
        }

        const textoDictado = String(r.data?.texto || '').trim();
        if (!textoDictado) {
          setError('No se entendió el dictado. Intenta de nuevo o captura manualmente.');
          return;
        }
        setTexto(textoDictado);
        await interpretar(textoDictado);
      } catch {
        setError('No se pudo procesar el audio. Captura manualmente.');
      } finally {
        setTranscribiendo(false);
        setFase('inactivo');
      }
    },
    [interpretar]
  );

  /**
   * Detiene la grabación y libera el monitoreo de audio.
   * El `onstop` del MediaRecorder dispara la transcripción.
   */
  const detener = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    limpiarAudio();
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    setGrabando(false);
  }, [limpiarAudio]);

  /**
   * Inicia la grabación con MediaRecorder + captura continua.
   * Degrada a modo manual si el navegador no soporta audio o el permiso falla.
   */
  const iniciar = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setDisponible(false);
      setError('Dictado por voz no disponible en este dispositivo. Captura manualmente.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        // El stream y el AudioContext ya se liberaron en `detener`.
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        await transcribir(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setGrabando(true);
      setPropuesta(null);
      setTexto('');
      setError(null);
      setFase('esperando_voz');

      // --- monitoreo de silencio con Web Audio API ---
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        // Sin Web Audio no hay auto-stop: se comporta como captura manual.
        return;
      }
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      const buffer = new Uint8Array(analyser.fftSize);
      silencioAcumuladoRef.current = 0;
      vozAcumuladaRef.current = 0;
      habloRef.current = false;

      monitorTimerRef.current = setInterval(() => {
        const a = analyserRef.current;
        if (!a) return;
        a.getByteTimeDomainData(buffer);
        // RMS normalizado: 128 es el centro (silencio digital).
        let suma = 0;
        for (let i = 0; i < buffer.length; i += 1) {
          const v = (buffer[i] - 128) / 128;
          suma += v * v;
        }
        const rms = Math.sqrt(suma / buffer.length);
        setNivel(Math.min(1, rms * 4));
        const hayVoz = rms >= VOZ_CONFIG.UMBRAL_RMS;

        if (hayVoz) {
          habloRef.current = true;
          vozAcumuladaRef.current += VOZ_CONFIG.INTERVALO_MUESTREO_MS;
          silencioAcumuladoRef.current = 0;
          setFase('capturando');
          return;
        }

        // Silencio: acumular.
        silencioAcumuladoRef.current += VOZ_CONFIG.INTERVALO_MUESTREO_MS;

        // Caso A: nunca habló → abortar por timeout de espera.
        if (!habloRef.current && silencioAcumuladoRef.current >= VOZ_CONFIG.ESPERA_VOZ_MS) {
          setError('No se detectó voz. Intenta de nuevo o captura manualmente.');
          detener();
          return;
        }

        // Caso B: ya habló y lleva suficiente silencio → auto-stop.
        if (habloRef.current && silencioAcumuladoRef.current >= VOZ_CONFIG.SILENCIO_MS) {
          // Si habló muy poco, probablemente fue ruido: abortar sin transcribir.
          if (vozAcumuladaRef.current < VOZ_CONFIG.MIN_VOZ_MS) {
            setError('No se detectó voz. Intenta de nuevo o captura manualmente.');
            detener();
            return;
          }
          detener();
        }
      }, VOZ_CONFIG.INTERVALO_MUESTREO_MS);

      // Red de seguridad: cortar la grabación pase lo que pase.
      maxTimerRef.current = setTimeout(() => {
        detener();
      }, VOZ_CONFIG.MAX_GRABACION_MS);
    } catch {
      limpiarAudio();
      setDisponible(false);
      setError('No se pudo acceder al micrófono. Captura manualmente.');
    }
  }, [transcribir, detener, limpiarAudio]);

  /** Alterna grabación (un solo botón en la UI). */
  const alternar = useCallback(() => {
    if (grabando) {
      detener();
    } else {
      iniciar();
    }
  }, [grabando, iniciar, detener]);

  /**
   * Edita una línea de la propuesta (producto o cantidad).
   * @param {number} index
   * @param {string} field
   * @param {any} value
   */
  const editarLinea = useCallback((index, field, value) => {
    setPropuesta((prev) => {
      if (!prev) return prev;
      const lineas = prev.lineas.map((l, i) => {
        if (i !== index) return l;
        if (field === 'producto_id') {
          const match = (productosRef.current || []).find(
            (p) => String(p.id) === String(value)
          );
          return {
            ...l,
            producto_id: value,
            nombre: match ? match.name : l.nombre,
            precio: match ? Number(match.price || 0) : l.precio,
            resuelto: Boolean(match),
          };
        }
        if (field === 'cantidad') {
          return { ...l, cantidad: value };
        }
        return { ...l, [field]: value };
      });
      const hayNoResueltos = lineas.some((l) => !l.resuelto);
      return { ...prev, lineas, hay_no_resueltos: hayNoResueltos };
    });
  }, []);

  /**
   * Quita una línea de la propuesta.
   * @param {number} index
   */
  const quitarLinea = useCallback((index) => {
    setPropuesta((prev) => {
      if (!prev) return prev;
      const lineas = prev.lineas.filter((_, i) => i !== index);
      return { ...prev, lineas, hay_no_resueltos: lineas.some((l) => !l.resuelto) };
    });
  }, []);

  /** Marca/desmarca la propuesta como confirmada por el operador. */
  const alternarConfirmacion = useCallback(() => {
    setPropuesta((prev) => (prev ? { ...prev, confirmado: !prev.confirmado } : prev));
  }, []);

  return {
    // Estado
    grabando,
    transcribiendo,
    texto,
    propuesta,
    disponible,
    error,
    // Fase de la captura continua + nivel de audio (0..1) para que la UI
    // muestre "escuchando / capturando / procesando" y un medidor en vivo.
    fase,
    nivel,
    // Acciones
    iniciar,
    detener,
    alternar,
    reset,
    editarLinea,
    quitarLinea,
    alternarConfirmacion,
    // Cliente inyectado (para tests); `null` en producción.
    cliente,
  };
}

export default useVoiceCart;
