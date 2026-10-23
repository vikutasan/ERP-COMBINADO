/**
 * `TicketTemplate` — interfaz 23 del registro de la superficie (Impresión).
 *
 * Plantilla de impresión del TICKET DE VENTA (flujo E.1). Réplica estética del
 * ticket de venta del POS viejo:
 *   - Fondo crema (#fdfbf7) con texto negro, fuente mono.
 *   - Borde zigzag en la parte superior (SVG), igual que `SalesReceipt`.
 *   - Encabezado "R DE RICO" + "Ticket de Venta".
 *   - Bloque de identidad: número de cuenta, fecha y terminal.
 *   - Bloque de líneas: cantidad, nombre, precio unitario e importe.
 *   - Bloque de total y conteo de artículos.
 *   - Footer con leyenda de aclaración y agradecimiento.
 *
 * DECISIÓN DE DISEÑO (Plan de Fase 6 §7.2):
 *   Esta plantilla SOLO RENDERIZA el ticket. NO imprime. El disparador de
 *   impresión (`iframe.contentWindow.print()`, compatible con
 *   `--kiosk-printing`) es F6.2. Sigue el patrón de `CorteTicketTemplate.jsx`.
 *
 * CONTRATO DE SUPERFICIE (interfaz 23, H-1):
 *   contenedor_raiz = "w-[58mm] font-mono" · paleta = ("#fdfbf7",) ·
 *   exenta_responsiva = True.
 *
 * R-01: `w-[58mm]` es ancho FÍSICO de papel (mm, no px) → el guard no dispara
 * (H-2). Exenta de R-04 por ser plantilla de impresión (no interactiva).
 *
 * @see PLAN_DE_ABORDAJE_FASE_6_POR_PARTES.md §7 (Sub-fase 6.1)
 * @see CorteTicketTemplate.jsx (patrón estructural)
 * @see ticketGenerator.js (F6.0 — el string térmico equivalente)
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
 * Suma la cantidad total de artículos del ticket.
 * @param {Array<Object>} lineas
 * @returns {number}
 */
export function totalArticulos(lineas) {
  if (!Array.isArray(lineas) || lineas.length === 0) return 0;
  return lineas.reduce((acc, l) => acc + Number(l.cantidad ?? l.quantity ?? 1), 0);
}

/** Una línea de producto: cantidad, nombre, precio unitario e importe. */
function Linea({ linea, indice }) {
  const nombre = linea.nombre || linea.name || 'Artículo';
  const cantidad = Number(linea.cantidad ?? linea.quantity ?? 1);
  const precio = Number(linea.precio_unitario ?? linea.unit_price ?? linea.price ?? 0);
  return (
    <li
      className="flex justify-between items-baseline gap-2"
      data-testid={`linea-${indice}`}
    >
      <span className="text-[11px] font-black w-6 shrink-0">{cantidad}x</span>
      <span className="flex-1 min-w-0">
        <span className="block truncate uppercase">{nombre}</span>
        <span className="block text-[10px] text-fondo-profundo/50">
          {formatearPrecio(precio)} c/u
        </span>
      </span>
      <span className="text-[11px] font-black whitespace-nowrap">
        {formatearPrecio(precio * cantidad)}
      </span>
    </li>
  );
}

export default function TicketTemplate({
  accountNum,
  total,
  terminalId,
  createdAt,
  lineas,
}) {
  // Blindaje: `lineas` puede llegar `null`/`undefined`/no-array desde la red.
  // El default `= []` solo cubre `undefined`, no `null` (defecto detectado por
  // el gate F6.1, criterio 7). Se normaliza aquí, no en el render.
  const filas = Array.isArray(lineas) ? lineas : [];
  const articulos = totalArticulos(filas);

  return (
    <article className="w-[58mm] flex flex-col bg-crema-ticket text-fondo-profundo shadow-2xl relative border border-fondo-profundo/10 font-mono">
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

      {/* Encabezado: R DE RICO — Ticket de Venta */}
      <header className="px-4 pt-6 pb-3 border-b-[1.5px] border-dashed border-fondo-profundo/30 flex flex-col items-center gap-1">
        <div className="w-10 h-10 bg-fondo-profundo/10 rounded-full flex items-center justify-center text-xl">
          🥖
        </div>
        <h2 className="text-sm font-black uppercase tracking-widest leading-none text-fondo-profundo">
          R DE RICO
        </h2>
        <h3 className="text-[10px] font-bold text-fondo-profundo/50 uppercase tracking-widest">
          Ticket de Venta
        </h3>
      </header>

      {/* Identidad: cuenta, fecha y terminal */}
      <section className="px-4 py-2 border-b border-dashed border-fondo-profundo/20 flex flex-col items-center gap-0.5">
        <p className="text-[11px] font-black uppercase" data-testid="cuenta">
          CTA: {accountNum || '---'}
        </p>
        <p className="text-[10px] text-fondo-profundo/60" data-testid="fecha">
          {formatearFecha(createdAt)}
        </p>
        <p className="text-[9px] text-fondo-profundo/40 uppercase">
          Terminal {terminalId || 'T1'}
        </p>
      </section>

      {/* Líneas del ticket */}
      <section className="px-4 py-2 border-b border-dashed border-fondo-profundo/20">
        {filas.length === 0 ? (
          <p
            className="text-[11px] text-center text-fondo-profundo/40 uppercase"
            data-testid="ticket-vacio"
          >
            Ticket vacío
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5" data-testid="lineas">
            {filas.map((linea, i) => (
              <Linea key={`${linea.nombre || linea.name || 'item'}-${i}`} linea={linea} indice={i} />
            ))}
          </ul>
        )}
      </section>

      {/* Total y conteo de artículos */}
      <section className="px-4 py-2 border-b border-dashed border-fondo-profundo/20 flex flex-col gap-1">
        <div className="flex justify-between items-baseline">
          <span className="text-[10px] uppercase tracking-wider text-fondo-profundo/60">
            Total de artículos
          </span>
          <span className="text-[11px] font-black" data-testid="articulos">
            {articulos}
          </span>
        </div>
        <div className="flex justify-between items-baseline border-t-2 border-fondo-profundo/20 pt-1.5 mt-0.5">
          <span className="text-[11px] font-black uppercase tracking-wider">Total</span>
          <span className="font-black text-lg" data-testid="total">
            {formatearPrecio(total)}
          </span>
        </div>
      </section>

      {/* Footer: leyenda y agradecimiento */}
      <footer className="px-4 py-3 flex flex-col gap-1">
        <p className="text-[8px] text-center uppercase tracking-wider text-fondo-profundo/40">
          Cuenta con 3 días a partir de la fecha de compra para realizar cualquier aclaración
        </p>
        <p className="text-[9px] text-center font-bold uppercase tracking-wider text-fondo-profundo/60">
          ¡¡¡Gracias por su compra, disfrute su pan!!!
        </p>
      </footer>
    </article>
  );
}
