/**
 * `CustomerIdentificationPanel` — identificación del cliente al cobrar (F8.4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UX HEREDADA DEL VIEJO POS (§6.8 del Plan Maestro)
 * ─────────────────────────────────────────────────────────────────────────────
 * "Cuando un componente ya existe en el viejo POS, su INTEGRACIÓN se hereda;
 *  solo su IMPLEMENTACIÓN se reescribe."
 *
 * La UX heredada es: un botón en el header abre un panel donde el cajero teclea
 * el teléfono del cliente, pulsa buscar, y ve los beneficios que el CRM devuelve
 * (nivel, puntos, descuentos). Si el cliente no existe, se ofrece registrarlo.
 *
 * Lo que se reescribe (implementación, no UX):
 *   - Los tokens de diseño son los del POS nuevo (`bg-fondo-panel`,
 *     `text-crema-ticket`, `rounded-canon40`, `min-h-tactil`, `bg-acento`).
 *   - Los datos vienen del contrato 26 (vía el hook F8.3), NO de una consulta
 *     directa a la tabla `customers` (A-02: prohibido leer tablas ajenas).
 *   - El POS NO calcula descuentos: solo MUESTRA lo que el CRM devuelve.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SRP
 * ─────────────────────────────────────────────────────────────────────────────
 * Solo captura el teléfono y muestra los beneficios. NO cobra, NO modifica el
 * carrito, NO escribe en la red (eso lo hace el hook/servicio). Devuelve el
 * cliente identificado a quien lo monta vía `onIdentificado`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEGRADACIÓN DT-07
 * ─────────────────────────────────────────────────────────────────────────────
 * Si el CRM está caído, el panel muestra un aviso y permite cerrar. El cajero
 * sigue cobrando a precio de lista (RN-87). El panel NUNCA bloquea la venta.
 *
 * @see PLAN_DE_ABORDAJE_FASE_8_POR_PARTES.md §3.5 (Sub-fase 8.4)
 * @see PLAN_MAESTRO_DEFINITIVO_POS.md §6.8 (UX heredada)
 */

import React, { useState } from 'react';
import { useCustomerIdentification } from '../hooks/useCustomerIdentification.js';

/** Formatea un número como precio en pesos. */
function formatearPrecio(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '$0.00';
  return numero.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  });
}

/** Traduce un `reason` del servicio a un mensaje legible para el cajero. */
function mensajeDeError(reason) {
  switch (reason) {
    case 'crm_no_disponible':
      return 'El módulo de clientes no está disponible. Puedes cobrar a precio de lista.';
    case 'sin_conexion':
      return 'Sin conexión con el servidor. Puedes cobrar a precio de lista.';
    case 'telefono_invalido':
      return 'El teléfono no es válido. Verifícalo e intenta de nuevo.';
    case 'telefono_requerido':
      return 'Escribe el teléfono del cliente para buscarlo.';
    case 'datos_invalidos':
      return 'Los datos enviados no son válidos. Intenta de nuevo.';
    default:
      return 'No se pudo consultar al cliente. Puedes cobrar a precio de lista.';
  }
}

/**
 * @param {object} props
 * @param {Array<object>} [props.items] - el carrito actual (para que el CRM calcule)
 * @param {object} [props.servicioBeneficios] - inyectable para tests
 * @param {(cliente: object|null, beneficios: object|null) => void} [props.onIdentificado]
 * @param {() => void} props.onCerrar - cierra el panel
 */
export default function CustomerIdentificationPanel({
  items = [],
  servicioBeneficios,
  onIdentificado,
  onCerrar,
}) {
  const [telefono, setTelefono] = useState('');
  const { cliente, beneficios, cargando, error, identificar, limpiar } =
    useCustomerIdentification({ servicioBeneficios });

  async function manejarBuscar() {
    // PROHIBICIÓN #3: NO leer `cliente`/`beneficios` del estado cerrado por el
    // closure. Tras el `await`, esas variables siguen siendo las del render
    // anterior (null). Se derivan del `data` que devuelve `identificar`.
    const r = await identificar(telefono, items);
    if (r && r.outcome === 'ok' && r.data && r.data.customer_id) {
      const clienteIdentificado = {
        customer_id: r.data.customer_id,
        nombre: r.data.nombre ?? null,
        nivel: r.data.nivel ?? null,
      };
      onIdentificado?.(clienteIdentificado, r.data);
    }
  }

  function manejarLimpiar() {
    setTelefono('');
    limpiar();
  }

  const hayCliente = Boolean(cliente);

  return (
    <div className="fixed inset-0 z-50 bg-fondo-profundo/85 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Identificación del cliente"
        className="w-full max-w-[520px] max-h-[90vh] bg-fondo-panel text-crema-ticket rounded-canon40 flex flex-col"
      >
        {/* Encabezado */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-white/5">
          <div>
            <h2 className="text-2xl font-bold uppercase tracking-tight">
              Identificación del <span className="text-acento">Cliente</span>
            </h2>
            <p className="text-[10px] font-bold text-acento/60 uppercase tracking-widest mt-1">
              Busca por teléfono para aplicar beneficios
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="min-h-tactil min-w-tactil rounded-full bg-white/5 hover:bg-white/10 text-crema-ticket/60 hover:text-crema-ticket transition-all"
          >
            ✕
          </button>
        </div>

        {/* Cuerpo */}
        <div className="p-6 flex flex-col gap-4 overflow-y-auto">
          {/* Captura del teléfono */}
          <label className="block">
            <span className="text-[11px] font-bold uppercase text-crema-ticket/60 tracking-widest pl-2">
              Teléfono del cliente
            </span>
            <div className="flex gap-2 mt-1">
              <input
                id="input-telefono-cliente"
                type="tel"
                inputMode="tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') manejarBuscar();
                }}
                placeholder="5512345678"
                className="flex-1 min-h-tactil bg-fondo-profundo/40 border border-white/10 rounded-canon35 px-4 text-crema-ticket font-bold outline-none focus:border-acento transition-colors placeholder-crema-ticket/20"
              />
              <button
                id="btn-buscar-cliente"
                type="button"
                onClick={manejarBuscar}
                disabled={cargando}
                className="min-h-tactil px-6 rounded-canon35 bg-acento text-fondo-profundo text-xs font-bold uppercase tracking-widest disabled:opacity-40 transition-all"
              >
                {cargando ? 'Buscando…' : 'Buscar'}
              </button>
            </div>
          </label>

          {/* Estado: cargando */}
          {cargando ? (
            <p className="text-sm text-crema-ticket/60 text-center py-4">
              Consultando al CRM…
            </p>
          ) : null}

          {/* Estado: error (degradación DT-07) */}
          {!cargando && error ? (
            <div
              role="alert"
              className="rounded-canon35 bg-red-500/10 border border-red-500/30 p-4"
            >
              <p className="text-sm text-red-300 leading-relaxed">
                {mensajeDeError(error)}
              </p>
            </div>
          ) : null}

          {/* Estado: identificado con beneficios */}
          {!cargando && hayCliente ? (
            <div className="rounded-canon35 bg-fondo-profundo/40 border border-white/10 p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-bold text-crema-ticket">
                    {cliente.nombre || 'Cliente'}
                  </p>
                  {cliente.nivel ? (
                    <p className="text-[10px] font-bold text-acento uppercase tracking-widest">
                      Nivel {cliente.nivel}
                    </p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-acento">
                    {beneficios?.puntos_disponibles ?? 0}
                  </p>
                  <p className="text-[10px] font-bold text-crema-ticket/50 uppercase tracking-widest">
                    Puntos
                  </p>
                </div>
              </div>

              {/* Descuentos que el CRM devuelve (el POS NO los calcula) */}
              {Array.isArray(beneficios?.descuentos) && beneficios.descuentos.length > 0 ? (
                <ul className="flex flex-col gap-1 border-t border-white/5 pt-3">
                  {beneficios.descuentos.map((d, i) => (
                    <li
                      key={`${d.tipo}-${i}`}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-crema-ticket/70">
                        {d.motivo || d.tipo}
                      </span>
                      <span className="font-bold text-acento">
                        {d.tipo === 'porcentaje'
                          ? `${d.valor}%`
                          : formatearPrecio(d.valor)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-crema-ticket/50 border-t border-white/5 pt-3">
                  Sin descuentos aplicables en esta compra.
                </p>
              )}

              {beneficios?.puntos_a_ganar ? (
                <p className="text-xs text-crema-ticket/60">
                  Ganará{' '}
                  <strong className="text-acento">
                    {beneficios.puntos_a_ganar}
                  </strong>{' '}
                  puntos con esta compra.
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Estado: buscado pero sin cliente (cliente nuevo) */}
          {!cargando && !error && !hayCliente && telefono.trim() !== '' ? (
            <p className="text-sm text-crema-ticket/60 text-center py-2">
              No se encontró un cliente con ese teléfono.
            </p>
          ) : null}
        </div>

        {/* Pie */}
        <div className="p-6 pt-4 border-t border-white/5 flex gap-3">
          {hayCliente ? (
            <button
              type="button"
              onClick={manejarLimpiar}
              className="min-h-tactil px-5 rounded-canon35 bg-white/5 hover:bg-white/10 text-crema-ticket/70 text-xs font-bold uppercase tracking-widest transition-all"
            >
              Quitar cliente
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCerrar}
            className="flex-1 min-h-tactil rounded-canon35 bg-acento text-fondo-profundo text-xs font-bold uppercase tracking-widest transition-all"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
}
