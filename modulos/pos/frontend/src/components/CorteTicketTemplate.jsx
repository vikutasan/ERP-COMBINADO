/**
 * `CorteTicketTemplate` — interfaz 24 del registro de la superficie (Impresión).
 *
 * Plantilla de impresión del CORTE DE CAJA (flujo E.5). Réplica estética del
 * ticket de corte del POS viejo:
 *   - Fondo crema (#fdfbf7) con texto negro, fuente mono.
 *   - Borde zigzag en la parte superior (SVG), igual que `SalesReceipt`.
 *   - Encabezado "R DE RICO" + "Corte de Caja".
 *   - Bloque de identidad: terminal, cajero, apertura y cierre.
 *   - Bloque de arqueo: esperado, contado y DIFERENCIA (descuadre).
 *   - Bloque de desglose por método: efectivo, crédito, débito.
 *   - Bloque de movimientos (entradas / salidas) del turno.
 *   - Footer con firma y leyenda.
 *
 * DECISIÓN DE DISEÑO (Plan de Fase 4 §8.4.2 + Fase 6 §7.2):
 *   Esta plantilla SOLO RENDERIZA el corte. NO imprime. El disparador de
 *   impresión (`iframe.contentWindow.print()`, compatible con
 *   `--kiosk-printing`) es F6.2, que consume `generarCorteHTML()` de
 *   `ticketGenerator.js` (F6.0). Sigue el patrón de `SalesReceipt.jsx`.
 *
 * CONTRATO DE SUPERFICIE (interfaz 24, H-1):
 *   contenedor_raiz = "w-[80mm] font-mono" · paleta = ("#fdfbf7",) ·
 *   exenta_responsiva = True.
 *
 * R-01: `w-full max-w-[420px]` es fluido (no ancho fijo). Exenta de R-04 por
 * ser plantilla de impresión (no interactiva).
 *
 * @see PLAN_DE_ABORDAJE_FASE_4_POR_PARTES.md §8 (Sub-fase 4.4)
 * @see PLAN_DE_ABORDAJE_FASE_6_POR_PARTES.md §7 (Sub-fase 6.1)
 * @see SalesReceipt.jsx (patrón estético)
 */

import React from 'react';

/** Formatea un valor como moneda mexicana (mismo formato que el resto del POS). */
function formatearPrecio(valor) {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return '$0.00';
  return `$${numero.toFixed(2)}`;
}

/** Formatea un instante ISO a fecha/hora local legible. */
function formatearFecha(instante) {
  if (!instante) return '—';
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Calcula el descuadre del corte: contado − esperado.
 * Un valor negativo significa faltante; positivo, sobrante.
 * @param {number|string} esperado
 * @param {number|string} contado
 * @returns {number}
 */
export function calcularDescuadre(esperado, contado) {
  return Number(contado || 0) - Number(esperado || 0);
}

/** Una fila etiqueta/valor del corte. */
function Fila({ etiqueta, valor, testid, resaltar = false }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-[11px] uppercase tracking-wider text-fondo-profundo/60">
        {etiqueta}
      </span>
      <span
        className={`font-black ${resaltar ? 'text-lg' : 'text-sm'}`}
        data-testid={testid}
      >
        {valor}
      </span>
    </div>
  );
}

export default function CorteTicketTemplate({
  terminalId,
  cajero,
  abiertaEn,
  cerradaEn,
  esperado,
  contado,
  credito,
  debito,
  movimientos = [],
  // DEUDA-BUG08 (Obs. 4) — ¿quién cuadra la caja? El corte impreso separa lo
  // que esta caja vendió por sí misma (`ventasPropias`) de lo que cobró por
  // cuentas de OTRAS terminales (`ventasAjenas`). El total no cambia; el
  // desglose le dice al cajero cuánto de su caja no nació en su terminal.
  ventasPropias = 0,
  ventasAjenas = 0,
  numTransaccionesAjenas = 0,
}) {
  const descuadre = calcularDescuadre(esperado, contado);
  const cuadra = descuadre === 0;

  return (
    <article className="w-full max-w-[420px] flex flex-col bg-crema-ticket text-fondo-profundo shadow-2xl relative border border-fondo-profundo/10 font-mono">
      {/* Borde zigzag superior (como el ticket viejo) */}
      <div
        className="absolute top-[-14px] left-0 right-0 w-full overflow-hidden"
        style={{ height: '14px' }}
      >
        <svg
          viewBox="0 0 420 14"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full"
        >
          <path
            d="M0,14 L10,0 L20,14 L30,0 L40,14 L50,0 L60,14 L70,0 L80,14 L90,0 L100,14 L110,0 L120,14 L130,0 L140,14 L150,0 L160,14 L170,0 L180,14 L190,0 L200,14 L210,0 L220,14 L230,0 L240,14 L250,0 L260,14 L270,0 L280,14 L290,0 L300,14 L310,0 L320,14 L330,0 L340,14 L350,0 L360,14 L370,0 L380,14 L390,0 L400,14 L410,0 L420,14 Z"
            fill="rgb(var(--crema-ticket))"
          />
        </svg>
      </div>

      {/* Encabezado: R DE RICO — Corte de Caja */}
      <header className="px-6 pt-6 pb-3 border-b-[1.5px] border-dashed border-fondo-profundo/30 flex justify-between items-start">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-fondo-profundo/10 rounded-full flex items-center justify-center text-2xl">
            🧾
          </div>
          <div className="flex flex-col justify-center pt-1">
            <h2 className="text-base font-black uppercase tracking-widest leading-none text-fondo-profundo">
              R DE RICO
            </h2>
            <h3 className="text-[11px] font-bold text-fondo-profundo/50 uppercase tracking-widest mt-1">
              Corte de Caja
            </h3>
          </div>
        </div>
        <div className="flex flex-col items-end justify-center text-xs text-fondo-profundo/50 pt-1">
          <p className="leading-none mb-1 font-black">Term {terminalId || '01'}</p>
          <p className="leading-none">{formatearFecha(cerradaEn)}</p>
        </div>
      </header>

      {/* Identidad del turno */}
      <section className="px-6 py-3 border-b border-dashed border-fondo-profundo/20 flex flex-col gap-1">
        <Fila etiqueta="Cajero" valor={cajero || '—'} testid="cajero" />
        <Fila etiqueta="Apertura" valor={formatearFecha(abiertaEn)} testid="apertura" />
        <Fila etiqueta="Cierre" valor={formatearFecha(cerradaEn)} testid="cierre" />
      </section>

      {/* Arqueo: esperado, contado y diferencia */}
      <section className="px-6 py-3 border-b border-dashed border-fondo-profundo/20 flex flex-col gap-2">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-fondo-profundo/40">
          Arqueo
        </h4>
        <Fila etiqueta="Esperado" valor={formatearPrecio(esperado)} testid="esperado" />
        <Fila etiqueta="Contado" valor={formatearPrecio(contado)} testid="contado" />
        <div className="flex justify-between items-baseline border-t-2 border-fondo-profundo/20 pt-2 mt-1">
          <span className="text-[11px] font-black uppercase tracking-wider">
            Diferencia
          </span>
          <span
            className={`font-black text-xl ${cuadra ? 'text-fondo-profundo' : 'text-peligro'}`}
            data-testid="diferencia"
          >
            {formatearPrecio(descuadre)}
          </span>
        </div>
        <p
          className={`text-[10px] font-black uppercase tracking-widest text-right ${
            cuadra ? 'text-fondo-profundo/50' : 'text-peligro'
          }`}
          data-testid="estado-cuadre"
        >
          {cuadra ? '✓ Caja cuadrada' : descuadre < 0 ? '✗ Faltante' : '✗ Sobrante'}
        </p>
      </section>

      {/* Desglose por método */}
      <section className="px-6 py-3 border-b border-dashed border-fondo-profundo/20 flex flex-col gap-1">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-fondo-profundo/40">
          Desglose por método
        </h4>
        <Fila etiqueta="Efectivo" valor={formatearPrecio(contado)} testid="efectivo" />
        <Fila etiqueta="Crédito" valor={formatearPrecio(credito)} testid="credito" />
        <Fila etiqueta="Débito" valor={formatearPrecio(debito)} testid="debito" />
        {/* DEUDA-BUG08 (Obs. 4): solo aparece si esta caja cobró cuentas ajenas. */}
        {Number(ventasAjenas) > 0 && (
          <Fila
            etiqueta={`De otras terminales (${numTransaccionesAjenas})`}
            valor={formatearPrecio(ventasAjenas)}
            testid="ventas-ajenas"
          />
        )}
      </section>

      {/* Movimientos del turno */}
      <section className="px-6 py-3 border-b border-dashed border-fondo-profundo/20 flex flex-col gap-1">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-fondo-profundo/40">
          Movimientos
        </h4>
        {movimientos.length === 0 ? (
          <p className="text-[11px] text-fondo-profundo/40 uppercase">
            Sin movimientos.
          </p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="movimientos">
            {movimientos.map((m, i) => (
              <li key={`${m.tipo}-${i}`} className="flex justify-between text-[11px]">
                <span className="uppercase">
                  {m.tipo === 'ENTRADA' ? '↑' : '↓'} {m.motivo || m.tipo}
                </span>
                <span className="font-bold">{formatearPrecio(m.monto)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Footer: firma y leyenda */}
      <footer className="px-6 py-4 flex flex-col gap-4">
        <div className="flex flex-col items-center gap-1 pt-4">
          <div className="w-3/4 border-t border-fondo-profundo/40" />
          <span className="text-[10px] uppercase tracking-widest text-fondo-profundo/50">
            Firma del cajero
          </span>
        </div>
        <p className="text-[9px] text-center uppercase tracking-wider text-fondo-profundo/40">
          Documento interno · No es comprobante fiscal
        </p>
      </footer>
    </article>
  );
}
