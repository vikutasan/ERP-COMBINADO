/**
 * Extractor de Estética Visual — apps/pos/src/admin/ExtractorEstetica.jsx
 *
 * Pantalla de administración que permite subir una imagen de referencia
 * (Pinterest, Dribbble, captura propia) y extraer los 11 tokens de estética
 * visual usando IA.
 *
 * Ubicación temporal: vive aquí (§0.3) mientras el módulo de IA no exista.
 * Solo es accesible con rol de administrador. El cajero NUNCA la ve.
 *
 * Fase 1.5 — 28 Sep 2026.
 */

import React, { useState, useRef, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ── Componente: Dropzone ────────────────────────────────────────────────────

function Dropzone({ onArchivo, archivo, cargando }) {
  const inputRef = useRef(null);
  const [arrastrando, setArrastrando] = useState(false);

  const manejarDrop = useCallback((e) => {
    e.preventDefault();
    setArrastrando(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) onArchivo(file);
  }, [onArchivo]);

  const manejarClick = () => inputRef.current?.click();

  return (
    <div
      onDrop={manejarDrop}
      onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
      onDragLeave={() => setArrastrando(false)}
      onClick={manejarClick}
      className={`
        flex flex-col items-center justify-center gap-3 p-6
        border border-dashed rounded-canon35 cursor-pointer transition-colors
        min-h-[200px]
        ${arrastrando
          ? 'border-acento bg-acento/10'
          : archivo
            ? 'border-acento/40 bg-fondo-panel'
            : 'border-crema-ticket/20 bg-fondo-panel hover:border-acento/60'
        }
        ${cargando ? 'opacity-50 pointer-events-none' : ''}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onArchivo(file);
        }}
      />

      {archivo ? (
        <>
          <img
            src={URL.createObjectURL(archivo)}
            alt="Referencia"
            className="max-h-[300px] rounded-canon35 object-contain"
          />
          <span className="text-crema-ticket/60 text-sm">
            {archivo.name} ({(archivo.size / 1024).toFixed(0)} KB) — clic para cambiar
          </span>
        </>
      ) : (
        <>
          <span className="text-4xl">📷</span>
          <span className="text-crema-ticket/70 text-lg">
            Arrastra una imagen aquí
          </span>
          <span className="text-crema-ticket/50 text-sm">
            o haz clic para seleccionar (JPG/PNG, ≤5 MB)
          </span>
        </>
      )}
    </div>
  );
}


// ── Componente: MuestraColor ────────────────────────────────────────────────

function MuestraColor({ nombre, token }) {
  if (!token) return null;
  return (
    <div className="flex items-center gap-3 py-2">
      <div
        className="w-8 h-8 rounded-canon35 border border-crema-ticket/20 shrink-0"
        style={{ backgroundColor: token.hex }}
        title={token.hex}
      />
      <div className="flex-1 min-w-0">
        <span className="text-crema-ticket text-sm font-semibold">{nombre}</span>
        <span className="text-crema-ticket/50 text-xs ml-2">{token.hex}</span>
      </div>
      <div className="text-xs shrink-0">
        <span className={token.confianza >= 70 ? 'text-acento' : 'text-peligro'}>
          {token.confianza}%
        </span>
      </div>
    </div>
  );
}


// ── Componente: ResultadoContraste ──────────────────────────────────────────

function ResultadoContraste({ contraste }) {
  if (!contraste) return null;
  return (
    <div className="bg-fondo-panel rounded-canon35 p-4">
      <h3 className="text-crema-ticket font-semibold text-sm mb-3">
        Contraste WCAG AA
      </h3>
      {contraste.resultados?.map((r) => (
        <div key={r.par} className="flex items-center justify-between py-1 text-sm">
          <span className="text-crema-ticket/70">{r.par}</span>
          <span className={r.pasa ? 'text-acento' : 'text-peligro'}>
            {r.ratio}:1 {r.pasa ? '✅' : '⚠️'}
          </span>
        </div>
      ))}
    </div>
  );
}


// ── Componente: Principal ───────────────────────────────────────────────────

export default function ExtractorEstetica({ onVolver }) {
  const [archivo, setArchivo] = useState(null);
  const [moduloDestino, setModuloDestino] = useState('pos');
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);
  const [nombreTema, setNombreTema] = useState('');
  const [asignadoComo, setAsignadoComo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  // ── Extraer ──
  const extraer = async () => {
    if (!archivo) return;
    setCargando(true);
    setError(null);
    setResultado(null);
    setGuardado(false);

    try {
      const formData = new FormData();
      formData.append('imagen', archivo);
      formData.append('modulo_destino', moduloDestino);

      const res = await fetch(`${API}/ia/extraer-estetica`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${res.status}`);
      }

      const data = await res.json();
      setResultado(data);

      // Sugerir nombre basado en adjetivos
      const adj = data.extras?.adjetivos;
      if (adj?.length > 0) {
        setNombreTema(adj[0].charAt(0).toUpperCase() + adj[0].slice(1));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };

  // ── Guardar ──
  const guardar = async () => {
    if (!resultado || !nombreTema.trim()) return;
    setGuardando(true);

    try {
      const tokens = {};
      for (const [k, v] of Object.entries(resultado.tokens)) {
        tokens[k] = v.valor;
      }

      const res = await fetch(`${API}/ia/guardar-tema`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: nombreTema.trim(),
          modulo_destino: moduloDestino,
          tokens,
          forma: resultado.forma,
          tipografia: resultado.tipografia,
          extras: resultado.extras,
          asignado_como: asignadoComo,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Error ${res.status}`);
      }

      setGuardado(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-fondo-profundo overflow-y-auto">

      {/* ── Header ── */}
      <div className="flex items-center gap-4 p-4 border-b border-crema-ticket/10">
        {onVolver && (
          <button
            onClick={onVolver}
            className="text-crema-ticket/60 hover:text-crema-ticket transition-colors text-sm"
          >
            ← Volver
          </button>
        )}
        <h1 className="text-crema-ticket text-xl font-bold">
          🎨 Extractor de Estética Visual
        </h1>
        <span className="text-crema-ticket/40 text-xs ml-auto">Fase 1.5 — Módulo IA</span>
      </div>

      <div className="flex-1 p-4 max-w-[900px] mx-auto w-full flex flex-col gap-4">

        {/* ── Selector de módulo ── */}
        <div className="flex items-center gap-3">
          <label className="text-crema-ticket/70 text-sm">Módulo destino:</label>
          <select
            value={moduloDestino}
            onChange={(e) => setModuloDestino(e.target.value)}
            className="bg-fondo-panel text-crema-ticket rounded-canon35 px-4 py-2 text-sm
                       border border-crema-ticket/20 outline-none focus:border-acento"
          >
            <option value="pos">POS</option>
            <option value="estadisticas">Estadísticas</option>
            <option value="almacenes">Almacenes</option>
            <option value="heladeria">Heladería</option>
            <option value="vista_general">Vista General</option>
          </select>
        </div>

        {/* ── Dropzone ── */}
        <Dropzone
          onArchivo={setArchivo}
          archivo={archivo}
          cargando={cargando}
        />

        {/* ── Botón extraer ── */}
        <button
          onClick={extraer}
          disabled={!archivo || cargando}
          className="bg-acento text-fondo-profundo font-bold py-3 px-5
                     rounded-canon35 min-h-tactil transition-colors
                     hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed
                     text-lg"
        >
          {cargando ? '⏳ Extrayendo...' : '🎨 Extraer estética'}
        </button>

        {/* ── Error ── */}
        {error && (
          <div className="bg-peligro/20 text-peligro rounded-canon35 p-4 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* ── Resultado ── */}
        {resultado && (
          <div className="flex flex-col gap-4">
            <div className="border-t border-crema-ticket/10 pt-4">
              <h2 className="text-crema-ticket font-bold text-lg mb-4">
                Resultado de la extracción
              </h2>
            </div>

            {/* Colores */}
            <div className="bg-fondo-panel rounded-canon35 p-4">
              <h3 className="text-crema-ticket font-semibold text-sm mb-2">Colores</h3>
              <MuestraColor nombre="Acento" token={resultado.tokens.acento} />
              <MuestraColor nombre="Fondo profundo" token={resultado.tokens.fondo_profundo} />
              <MuestraColor nombre="Fondo alt" token={resultado.tokens.fondo_profundo_alt} />
              <MuestraColor nombre="Panel" token={resultado.tokens.fondo_panel} />
              <MuestraColor nombre="Crema ticket" token={resultado.tokens.crema_ticket} />
              <MuestraColor nombre="Peligro" token={resultado.tokens.peligro} />
            </div>

            {/* Forma y tipografía */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-fondo-panel rounded-canon35 p-4">
                <h3 className="text-crema-ticket font-semibold text-sm mb-2">Forma</h3>
                <div className="text-crema-ticket/70 text-sm space-y-1">
                  <div>Radios: {resultado.forma?.radio_pequeno} / {resultado.forma?.radio_medio} / {resultado.forma?.radio_grande}</div>
                  <div>Densidad: {resultado.extras?.densidad}</div>
                </div>
              </div>
              <div className="bg-fondo-panel rounded-canon35 p-4">
                <h3 className="text-crema-ticket font-semibold text-sm mb-2">Tipografía</h3>
                <div className="text-crema-ticket/70 text-sm space-y-1">
                  <div>UI: {resultado.tipografia?.fuente_ui?.sugerida} ({resultado.tipografia?.fuente_ui?.confianza}%)</div>
                  <div>Ticket: {resultado.tipografia?.fuente_ticket?.sugerida}</div>
                </div>
              </div>
            </div>

            {/* Contraste */}
            <ResultadoContraste contraste={resultado.contraste} />

            {/* Sensación */}
            {resultado.extras?.adjetivos && (
              <div className="bg-fondo-panel rounded-canon35 p-4">
                <h3 className="text-crema-ticket font-semibold text-sm mb-2">Sensación</h3>
                <div className="text-crema-ticket/70 text-sm">
                  {resultado.extras.adjetivos.join(' • ')}
                </div>
              </div>
            )}

            {/* Advertencias */}
            {resultado.advertencias?.length > 0 && (
              <div className="flex flex-col gap-2">
                {resultado.advertencias.map((adv, i) => (
                  <div key={i} className="text-peligro/80 text-sm flex gap-2">
                    <span>⚠️</span>
                    <span>{adv.mensaje}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ── Guardar ── */}
            <div className="border-t border-crema-ticket/10 pt-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <label className="text-crema-ticket/70 text-sm shrink-0">Nombre del tema:</label>
                <input
                  type="text"
                  value={nombreTema}
                  onChange={(e) => setNombreTema(e.target.value)}
                  placeholder="Ej: Panadería Cálida"
                  className="flex-1 bg-fondo-panel text-crema-ticket rounded-canon35
                             px-4 py-2 text-sm border border-crema-ticket/20
                             outline-none focus:border-acento"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-crema-ticket/70 text-sm">Inyectar como:</label>
                {[
                  { valor: 'default', texto: `Default del ${moduloDestino.toUpperCase()}` },
                  { valor: 'opcion_1', texto: `Opción 1 del ${moduloDestino.toUpperCase()}` },
                  { valor: 'opcion_2', texto: `Opción 2 del ${moduloDestino.toUpperCase()}` },
                  { valor: null, texto: 'Guardar sin asignar (biblioteca)' },
                ].map((op) => (
                  <label
                    key={op.valor ?? 'null'}
                    className="flex items-center gap-2 text-crema-ticket/70 text-sm cursor-pointer
                               hover:text-crema-ticket transition-colors"
                  >
                    <input
                      type="radio"
                      name="asignar"
                      checked={asignadoComo === op.valor}
                      onChange={() => setAsignadoComo(op.valor)}
                      className="accent-acento"
                    />
                    {op.texto}
                  </label>
                ))}
              </div>

              <div className="flex gap-3 mt-2">
                <button
                  onClick={guardar}
                  disabled={!nombreTema.trim() || guardando || guardado || !resultado.contraste?.valido}
                  className="flex-1 bg-acento text-fondo-profundo font-bold py-3 px-5
                             rounded-canon35 min-h-tactil transition-colors
                             hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {guardado ? '✅ Guardado' : guardando ? '⏳ Guardando...' : '💾 Guardar e inyectar'}
                </button>
              </div>

              {!resultado.contraste?.valido && (
                <div className="text-peligro text-sm">
                  ⚠️ El tema no pasa contraste WCAG AA. Ajusta los colores antes de guardar.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
