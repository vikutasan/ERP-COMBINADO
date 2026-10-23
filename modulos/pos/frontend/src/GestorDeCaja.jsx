/**
 * `GestorDeCaja` - interfaz 9 del registro de la superficie (Pantalla).
 *
 * La pantalla de caja del POS nuevo (FASE 4.3). Cubre el flujo E.5 (corte de
 * caja) con TRES estados mutuamente excluyentes:
 *
 *   1. SIN TURNO  ? formulario de apertura (fondo inicial).
 *   2. ABIERTO    ? resumen en vivo (esperado vs contado), lista de movimientos,
 *                   alta de movimiento y bot�n de cierre.
 *   3. CIERRE     ? captura de conteos f�sicos (efectivo, cr�dito, d�bito) y
 *                   muestra la DIFERENCIA (descuadre) al confirmar.
 *
 * FD-06 (17 Oct 2026): estado y l�gica extra�dos a hooks especializados.
 *   - useGestorDeCajaState  - todo el useState + useRef + constantes derivadas
 *   - useGestorDeCajaLogica - callbacks, efectos, datos derivados, impresi�n
 *
 * Reglas de batalla respetadas:
 *   - Contrato `{outcome, reason}`: la pantalla NUNCA usa try/catch; decide con
 *     `esOk(resultado)` y muestra `resultado.reason` en el banner rojo.
 *   - Banner de error PERSISTENTE (no se auto-oculta) - Regla 19 / prohibici�n #2.
 *   - Sin timers ni auto-guardado (prohibici�n #1).
 *   - Sin estado le�do en callbacks async: se usa el valor devuelto por el
 *     servicio, no un cierre sobre el estado de React.
 *   - F12.29 v6: pattern "latest ref" para callbacks del padre.
 */

import React from 'react';
import * as caja from './services/cashService.js';
import * as contexto from './services/dailyContextService.js';
import DailyContextModal from './components/DailyContextModal.jsx';
import TecladoTactil from './components/TecladoTactil.jsx';
// FD-06 - hooks extra�dos del monolito (17 Oct 2026)
import { useGestorDeCajaState, ESTADOS } from './hooks/useGestorDeCajaState.js';
import { useGestorDeCajaLogica } from './hooks/useGestorDeCajaLogica.js';

/** Formatea un valor como moneda mexicana. */
function formatearPrecio(valor) {
  const numero = Number(valor);
  if (Number.isNaN(numero)) return '$0.00';
  return numero.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  });
}

/** Formatea la hora de un movimiento a hora local del negocio (FASE 10.6.3). */
function formatearHora(iso) {
  if (!iso) return '';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  return fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

/**
 * F12.26 - FEEDBACK T�CTIL. Clase compartida que se a�ade a TODOS los botones
 * del gestor para que el cajero perciba que el toque registr�.
 */
const FEEDBACK_TACTIL = 'transition-transform duration-100 active:scale-[0.97] active:brightness-90';

// ESTADOS se re-exporta desde useGestorDeCajaState para que los tests existentes
// que importaban de GestorDeCaja.jsx sigan funcionando sin cambios.
export { ESTADOS };

export default function GestorDeCaja({
  terminalId,
  usuarioId,
  usuarioNombre = null,
  servicio = caja,
  servicioContexto = contexto,
  onCerrar,
  onCajaHabilitada,
  onCajaDeshabilitada,
}) {
  // FD-06 - estado y l�gica delegados a hooks especializados
  const st = useGestorDeCajaState({ onCajaHabilitada, onCajaDeshabilitada });
  const lg = useGestorDeCajaLogica(st, { terminalId, usuarioId, usuarioNombre, servicio, servicioContexto });

  // Desestructurar para que el JSX original no cambie ni una coma
  const {
    estado, setEstado, turno, resumen, movimientos, error, ocupado,
    mostrarContexto, setMostrarContexto, contextoRegistrado,
    fondoInicial, setFondoInicial, confirmandoFondo, setConfirmandoFondo,
    tipoMov, setTipoMov, montoMov, setMontoMov, motivoMov, setMotivoMov,
    conteoEfectivo, setConteoEfectivo, conteoCredito, setConteoCredito,
    conteoDebito, setConteoDebito, diferencia,
    confirmandoCierre, setConfirmandoCierre,
    movimientoAEliminar, setMovimientoAEliminar,
    campoActivo, setCampoActivo,
    valoresRef, refImprimirCorte,
    CAMPOS, ORDEN_POR_ESTADO,
    alNuevoTurno,
  } = st;

  const {
    alPulsarTecla, armar,
    alPedirConfirmacionFondo, alAbrirTurno,
    alRegistrarMovimiento,
    alPedirEliminarMovimiento, alConfirmarEliminarMovimiento,
    alPedirConfirmacionCierre, alCerrarTurno,
    alCerrarContexto,
    esperado, capturado, descuadreEnVivo,
    desglose, movimientosAgrupados, sugerenciasMotivo,
    alImprimirCorte,
  } = lg;
  return (
    <div className="w-full max-w-[1100px] mx-auto p-4 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-crema-ticket">Gestor de Caja</h1>
        {onCerrar ? (
          <button
            type="button"
            onClick={onCerrar}
            className={`min-h-tactil px-4 rounded-canon35 bg-fondo-panel text-crema-ticket border border-white/10 hover:border-acento/60 ${FEEDBACK_TACTIL}`}
          >
            Volver al POS
          </button>
        ) : null}
      </header>

      {/* Banner de error PERSISTENTE (Regla 19 / prohibición #2) */}
      {error ? (
        <div
          role="alert"
          className="rounded-canon35 bg-peligro/20 text-peligro px-4 py-3 text-sm font-semibold"
        >
          {error}
        </div>
      ) : null}

      {/* �"?�"? ESTADO 1: SIN TURNO �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
      {estado === ESTADOS.SIN_TURNO ? (
        <section
          aria-label="Abrir turno de caja"
          className="bg-fondo-panel rounded-canon50 p-6 flex flex-col gap-4"
        >
          <h2 className="text-xl font-bold text-crema-ticket">Abrir turno</h2>
          <p className="text-sm text-crema-ticket/60">
            No hay un turno de caja abierto en esta terminal.
          </p>
          <label className="flex flex-col gap-2 text-sm text-crema-ticket">
            Fondo inicial
            <input
              type="text"
              inputMode="decimal"
              value={fondoInicial}
              onChange={(e) => setFondoInicial(e.target.value)}
              onFocus={() => setCampoActivo('fondoInicial')}
              aria-label="Fondo inicial"
              data-testid="campo-fondoInicial"
              className={`min-h-tactil rounded-canon35 bg-fondo-profundo text-crema-ticket border px-4 ${
                campoActivo === 'fondoInicial' ? 'border-acento' : 'border-white/10'
              }`}
            />
          </label>
          {/* B2 �?" Botón dispara confirmación, NO abre directamente */}
          <button
            type="button"
            onClick={alPedirConfirmacionFondo}
            disabled={ocupado}
            className={`min-h-tactil rounded-canon35 bg-acento text-fondo-profundo font-semibold px-4 disabled:opacity-50 ${FEEDBACK_TACTIL}`}
          >
            Abrir turno
          </button>

          {/* B2 �?" Modal de confirmación del fondo */}
          {confirmandoFondo ? (
            <div
              role="alertdialog"
              aria-label="Confirmar fondo inicial"
              className="rounded-canon35 bg-fondo-profundo border border-acento/40 p-4 flex flex-col gap-3"
            >
              <p className="text-crema-ticket font-semibold">
                ¿Confirmar fondo inicial de{' '}
                <strong className="text-acento">{formatearPrecio(Number(fondoInicial) || 0)}</strong>?
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmandoFondo(false)}
                  className={`min-h-tactil flex-1 rounded-canon35 bg-fondo-panel text-crema-ticket border border-white/10 px-4 ${FEEDBACK_TACTIL}`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={alAbrirTurno}
                  disabled={ocupado}
                  className={`min-h-tactil flex-1 rounded-canon35 bg-acento text-fondo-profundo font-semibold px-4 disabled:opacity-50 ${FEEDBACK_TACTIL}`}
                >
                  {ocupado ? 'Abriendo�?�' : 'Sí, abrir turno'}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* �"?�"? ESTADO 2: ABIERTO �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
      {estado === ESTADOS.ABIERTO ? (
        <div className="flex flex-col gap-4">
          {/* �"?�"? APARTADO A: MOVIMIENTOS (escritura) �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?
              FIX-BUG17 �?" El orden se invirtió: la CAPTURA va arriba y el
              BALANCE abajo. Antes el Balance ocupaba la columna izquierda y el
              formulario + teclado quedaban abajo, lejos del campo "Monto". El
              cajero captura entradas/salidas muchas veces por turno; el Balance
              es de consulta. La operación frecuente va primero (paridad de UX).

              El teclado táctil se monta INMEDIATAMENTE debajo del formulario
              (no al final del contenedor), para que quede junto al campo activo. */}
          <section
            aria-label="Movimientos del turno"
            className="bg-fondo-panel rounded-canon50 p-6 flex flex-col gap-3"
          >
            <h2 className="text-xl font-bold text-crema-ticket">Movimientos</h2>

            {/* FIX-BUG17 �?" Movimientos AGRUPADOS: Entradas con Entradas y
                Salidas con Salidas. Antes se listaban mezclados en orden
                cronológico y el cajero tenía que leer el ícono de cada renglón.
                El índice `indiceGlobal` de cada renglón es el GLOBAL en
                `movimientos`, así que los data-testid existentes no cambian. */}
            {movimientos.length === 0 ? (
              <p className="text-sm text-crema-ticket/50">Sin movimientos.</p>
            ) : (
              <div className="flex flex-col gap-3 text-sm text-crema-ticket">
                {/* �"?�"? Grupo ENTRADAS �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
                <div data-testid="grupo-entradas">
                  <h3 className="text-xs font-black uppercase tracking-wider text-acento/80 mb-1">
                    �?' Entradas ({movimientosAgrupados.entradas.length})
                  </h3>
                  {movimientosAgrupados.entradas.length === 0 ? (
                    <p className="text-crema-ticket/40 pl-1">Sin entradas.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {movimientosAgrupados.entradas.map((m) => (
                        <li
                          key={m.movement_id || `ENTRADA-${m.indiceGlobal}`}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="flex-1">{m.motivo || m.tipo}</span>
                          {/* FASE 10.6.3 �?" la hora del movimiento (paridad con el viejo POS). */}
                          <span
                            className="text-crema-ticket/60 tabular-nums"
                            data-testid={`hora-movimiento-${m.indiceGlobal}`}
                          >
                            {formatearHora(m.creado_en)}
                          </span>
                          <span className="font-semibold text-acento">
                            {formatearPrecio(m.monto)}
                          </span>
                          {/* FASE 10.6.2 �?" eliminar un movimiento mal capturado (RN-52).
                              FIX-BUG17 (feedback #3) �?" el �o. ya NO borra directo:
                              abre el modal de advertencia (borrado irreversible).
                              FIX-BUG17 (feedback #5) �?" el �o. era un tache ROJO dentro
                              de un círculo rojo translúcido: demasiado protagonismo.
                              Ahora es un �o. BLANCO discreto sobre un fondo neutro; el
                              rojo solo aparece al pasar el cursor / presionar, para
                              no perder la señal de acción destructiva. */}
                          <button
                            type="button"
                            onClick={() => alPedirEliminarMovimiento(m)}
                            disabled={ocupado || !m.movement_id}
                            aria-label={`Eliminar movimiento ${m.motivo || m.tipo}`}
                            data-testid={`eliminar-movimiento-${m.indiceGlobal}`}
                            className={`min-h-tactil min-w-tactil rounded-canon35 bg-white/5 text-crema-ticket/70 border border-white/10 font-bold hover:bg-peligro/20 hover:text-peligro hover:border-peligro/40 disabled:opacity-40 ${FEEDBACK_TACTIL}`}
                          >
                            �o.
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* �"?�"? Grupo SALIDAS �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
                <div data-testid="grupo-salidas">
                  <h3 className="text-xs font-black uppercase tracking-wider text-peligro/80 mb-1">
                    �?" Salidas ({movimientosAgrupados.salidas.length})
                  </h3>
                  {movimientosAgrupados.salidas.length === 0 ? (
                    <p className="text-crema-ticket/40 pl-1">Sin salidas.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {movimientosAgrupados.salidas.map((m) => (
                        <li
                          key={m.movement_id || `SALIDA-${m.indiceGlobal}`}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="flex-1">{m.motivo || m.tipo}</span>
                          {/* FASE 10.6.3 �?" la hora del movimiento (paridad con el viejo POS). */}
                          <span
                            className="text-crema-ticket/60 tabular-nums"
                            data-testid={`hora-movimiento-${m.indiceGlobal}`}
                          >
                            {formatearHora(m.creado_en)}
                          </span>
                          <span className="font-semibold text-peligro">
                            {formatearPrecio(m.monto)}
                          </span>
                          {/* FASE 10.6.2 �?" eliminar un movimiento mal capturado (RN-52).
                              FIX-BUG17 (feedback #3) �?" el �o. ya NO borra directo:
                              abre el modal de advertencia (borrado irreversible).
                              FIX-BUG17 (feedback #5) �?" el �o. era un tache ROJO dentro
                              de un círculo rojo translúcido: demasiado protagonismo.
                              Ahora es un �o. BLANCO discreto sobre un fondo neutro; el
                              rojo solo aparece al pasar el cursor / presionar, para
                              no perder la señal de acción destructiva. */}
                          <button
                            type="button"
                            onClick={() => alPedirEliminarMovimiento(m)}
                            disabled={ocupado || !m.movement_id}
                            aria-label={`Eliminar movimiento ${m.motivo || m.tipo}`}
                            data-testid={`eliminar-movimiento-${m.indiceGlobal}`}
                            className={`min-h-tactil min-w-tactil rounded-canon35 bg-white/5 text-crema-ticket/70 border border-white/10 font-bold hover:bg-peligro/20 hover:text-peligro hover:border-peligro/40 disabled:opacity-40 ${FEEDBACK_TACTIL}`}
                          >
                            �o.
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* FIX-BUG17 (feedback #3) �?" MODAL DE ADVERTENCIA AL BORRAR.
                Borrar un movimiento es IRREVERSIBLE (RN-52) y en pantalla táctil
                el �o. está junto al monto: un toque accidental borraba sin aviso.
                El modal muestra QU�? se va a borrar (tipo, motivo y monto) para
                que el cajero confirme. Cancelar cierra sin tocar el backend. */}
            {movimientoAEliminar ? (
              <div
                role="alertdialog"
                aria-label="Confirmar eliminación de movimiento"
                data-testid="confirmar-eliminar-movimiento"
                className="rounded-canon35 bg-fondo-profundo border border-peligro/40 p-4 flex flex-col gap-3"
              >
                <p className="text-crema-ticket font-semibold">
                  ¿Eliminar esta{' '}
                  {movimientoAEliminar.tipo === 'ENTRADA' ? 'entrada' : 'salida'}?
                </p>
                <p className="text-sm text-crema-ticket/70">
                  <span className="font-semibold text-crema-ticket">
                    {movimientoAEliminar.motivo || movimientoAEliminar.tipo}
                  </span>{' '}
                  · {formatearPrecio(movimientoAEliminar.monto)}
                </p>
                <p className="text-xs text-peligro/80">
                  Esta acción no se puede deshacer.
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setMovimientoAEliminar(null)}
                    className={`min-h-tactil flex-1 rounded-canon35 bg-fondo-panel text-crema-ticket border border-white/10 px-4 ${FEEDBACK_TACTIL}`}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={alConfirmarEliminarMovimiento}
                    disabled={ocupado}
                    data-testid="confirmar-eliminar-movimiento-si"
                    className={`min-h-tactil flex-1 rounded-canon35 bg-peligro text-crema-ticket font-semibold px-4 disabled:opacity-50 ${FEEDBACK_TACTIL}`}
                  >
                    {ocupado ? 'Eliminando�?�' : 'Sí, eliminar'}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTipoMov('ENTRADA')}
                  className={`min-h-tactil flex-1 rounded-canon35 border px-3 font-semibold ${FEEDBACK_TACTIL} ${
                    tipoMov === 'ENTRADA'
                      ? 'bg-acento text-fondo-profundo border-acento'
                      : 'bg-fondo-profundo text-crema-ticket border-white/10'
                  }`}
                >
                  Entrada
                </button>
                <button
                  type="button"
                  onClick={() => setTipoMov('SALIDA')}
                  className={`min-h-tactil flex-1 rounded-canon35 border px-3 font-semibold ${FEEDBACK_TACTIL} ${
                    tipoMov === 'SALIDA'
                      ? 'bg-acento text-fondo-profundo border-acento'
                      : 'bg-fondo-profundo text-crema-ticket border-white/10'
                  }`}
                >
                  Salida
                </button>
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={montoMov}
                onChange={(e) => setMontoMov(e.target.value)}
                onFocus={() => setCampoActivo('montoMov')}
                aria-label="Monto del movimiento"
                placeholder="Monto"
                data-testid="campo-montoMov"
                className={`min-h-tactil rounded-canon35 bg-fondo-profundo text-crema-ticket border px-4 ${
                  campoActivo === 'montoMov' ? 'border-acento' : 'border-white/10'
                }`}
              />
              <input
                type="text"
                value={motivoMov}
                onChange={(e) => setMotivoMov(e.target.value)}
                onFocus={() => setCampoActivo('motivoMov')}
                aria-label="Motivo del movimiento"
                placeholder="Motivo"
                data-testid="campo-motivoMov"
                className={`min-h-tactil rounded-canon35 bg-fondo-profundo text-crema-ticket border px-4 ${
                  campoActivo === 'motivoMov' ? 'border-acento' : 'border-white/10'
                }`}
              />
              {/* FIX-BUG17 �?" SUGERENCIAS DE MOTIVO. Al enfocar el Motivo se
                  ofrecen los motivos YA USADOS en este turno (los más frecuentes
                  primero). Un toque los escribe: en kiosco táctil teclear letra
                  por letra es lento y la mayoría de movimientos repiten motivo. */}
              {campoActivo === 'motivoMov' && sugerenciasMotivo.length > 0 ? (
                <div
                  aria-label="Sugerencias de motivo"
                  data-testid="sugerencias-motivo"
                  className="flex flex-wrap gap-2"
                >
                  {sugerenciasMotivo.map((sugerencia) => (
                    <button
                      key={sugerencia}
                      type="button"
                      onClick={() => setMotivoMov(sugerencia)}
                      className={`min-h-tactil rounded-canon35 bg-fondo-profundo text-crema-ticket border border-white/10 px-3 text-sm ${FEEDBACK_TACTIL}`}
                    >
                      {sugerencia}
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                onClick={alRegistrarMovimiento}
                disabled={ocupado}
                className={`min-h-tactil rounded-canon35 bg-acento text-fondo-profundo font-semibold px-4 disabled:opacity-50 ${FEEDBACK_TACTIL}`}
              >
                Registrar movimiento
              </button>
            </div>

            {/* FASE 10.6.1 / FIX-BUG17 �?" teclado táctil JUNTO al formulario.
                Se monta DENTRO de la sección de Movimientos, inmediatamente
                debajo del formulario, para que quede junto al campo activo (no
                al final del contenedor, lejos del campo). Solo se muestra
                cuando hay un campo enfocado: el cajero toca el campo y luego
                teclea. El teclado es puro; la máquina de foco vive arriba. El
                modo (numérico/alfabético) lo decide el campo activo. */}
            {campoActivo ? (
              <TecladoTactil
                valor={valoresRef.current[campoActivo] ?? ''}
                onTecla={alPulsarTecla}
                activo
                tipo={CAMPOS[campoActivo]?.tipo || 'numerico'}
                etiqueta={CAMPOS[campoActivo]?.etiqueta || ''}
              />
            ) : null}
          </section>

          {/* �"?�"? APARTADO B: BALANCE (solo lectura) �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?
              F12.25 �?" Paridad con el viejo POS (sección "�Y"S Balance").

              POR QU�? un apartado separado: el viejo POS presentaba un bloque
              "Balance" de SOLO LECTURA con la fotografía financiera del turno.
              El nuevo POS mezclaba este bloque con los controles de conteo
              ("esperado vs contado"), lo que generaba confusión: el cajero no
              distinguía qué era información y qué era interacción. Separar
              Balance (lectura) de Movimientos (escritura) es paridad de UX.

              FIX-BUG17 �?" El contenido del Balance NO cambió: solo se movió a un
              bloque de ancho completo al final. Todos los data-testid siguen
              intactos. */}
          <section
            aria-label="Resumen del turno"
            className="bg-fondo-panel rounded-canon50 p-6 flex flex-col gap-3"
          >
            {/* El h2 visible dice "Balance" (paridad con el viejo POS).
                El texto "Resumen del turno" se conserva como subtítulo porque
                el test f10_5 lo busca con getByText('Resumen del turno'). */}
            <div>
              <h2 className="text-xl font-bold text-crema-ticket flex items-center gap-2">
                <span className="text-base">�Y"S</span> Balance
              </h2>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-crema-ticket/40 mt-0.5">
                Resumen del turno
              </p>
            </div>

            {/* �"?�"? Desglose principal �?" estructura heredada del viejo POS �"?�"?
                Orden: Fondo �?' Entradas (verde) �?' Salidas (rojo) �?' separador �?'
                Efectivo Esperado �?' Crédito �?' Débito �?' separador �?'
                Total Ventas �?' Transacciones. Todos de solo lectura. */}
            <dl className="flex flex-col gap-1 text-sm text-crema-ticket">
              <div className="flex justify-between py-1.5">
                <dt className="text-crema-ticket/60">Fondo inicial</dt>
                <dd className="font-semibold tabular-nums" data-testid="desglose-fondo">
                  {formatearPrecio(desglose.fondo_inicial)}
                </dd>
              </div>
              <div className="flex justify-between py-1.5">
                <dt className="text-acento/80">Entradas</dt>
                <dd className="font-semibold tabular-nums text-acento" data-testid="desglose-entradas">
                  {formatearPrecio(desglose.total_entradas)}
                </dd>
              </div>
              <div className="flex justify-between py-1.5">
                <dt className="text-peligro/80">Salidas</dt>
                <dd className="font-semibold tabular-nums text-peligro" data-testid="desglose-salidas">
                  {formatearPrecio(desglose.total_salidas)}
                </dd>
              </div>

              {/* �"?�"? Separador: métodos de pago �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
              <div className="border-t border-white/10 mt-1 pt-2 flex flex-col gap-1">
                <div className="flex justify-between py-1.5">
                  <dt className="text-crema-ticket/60 font-semibold">�Y'� Efectivo esperado</dt>
                  <dd className="font-bold tabular-nums" data-testid="esperado">
                    {formatearPrecio(esperado)}
                  </dd>
                </div>
                <div className="flex justify-between py-1.5">
                  <dt className="text-crema-ticket/60">Ventas en efectivo</dt>
                  <dd className="font-semibold tabular-nums" data-testid="desglose-efectivo">
                    {formatearPrecio(
                      desglose.total_ventas -
                        desglose.total_credito -
                        desglose.total_debito -
                        desglose.total_transferencia,
                    )}
                  </dd>
                </div>
                <div className="flex justify-between py-1.5">
                  <dt className="text-crema-ticket/60">�Y'� Tarjeta Crédito</dt>
                  <dd className="font-semibold tabular-nums" data-testid="desglose-credito">
                    {formatearPrecio(desglose.total_credito)}
                  </dd>
                </div>
                <div className="flex justify-between py-1.5">
                  <dt className="text-crema-ticket/60">�Y'� Tarjeta Débito</dt>
                  <dd className="font-semibold tabular-nums" data-testid="desglose-debito">
                    {formatearPrecio(desglose.total_debito)}
                  </dd>
                </div>
                {/* FIX-BUG17 �?" RN-57: la transferencia es el cuarto método de
                    pago. Sumaba al total pero no se desglosaba, así que el
                    cajero no podía conciliar el corte. */}
                <div className="flex justify-between py-1.5">
                  <dt className="text-crema-ticket/60">�Y�� Transferencia</dt>
                  <dd className="font-semibold tabular-nums" data-testid="desglose-transferencia">
                    {formatearPrecio(desglose.total_transferencia)}
                  </dd>
                </div>
              </div>

              {/* �"?�"? Separador: totales �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
              <div className="border-t border-white/10 mt-1 pt-2 flex flex-col gap-1">
                <div className="flex justify-between py-1.5">
                  <dt className="text-crema-ticket/60 font-semibold">Total de ventas</dt>
                  <dd className="font-bold tabular-nums text-lg" data-testid="desglose-total-ventas">
                    {formatearPrecio(desglose.total_ventas)}
                  </dd>
                </div>
                <div className="flex justify-between py-1.5">
                  <dt className="text-crema-ticket/60">Transacciones</dt>
                  <dd className="font-bold tabular-nums text-lg" data-testid="desglose-transacciones">
                    {desglose.num_transacciones}
                  </dd>
                </div>
                {/* DEUDA-BUG08 (Obs. 4) �?" Solo aparece si esta caja cobró
                    cuentas de OTRAS terminales. Deja claro que ese dinero no
                    nació en esta terminal (RN-53: se cuenta donde se recibió). */}
                {desglose.ventas_ajenas > 0 && (
                  <div className="flex justify-between py-1.5">
                    <dt className="text-crema-ticket/60">
                      De otras terminales ({desglose.num_transacciones_ajenas})
                    </dt>
                    <dd className="font-semibold tabular-nums" data-testid="desglose-ventas-ajenas">
                      {formatearPrecio(desglose.ventas_ajenas)}
                    </dd>
                  </div>
                )}
              </div>
            </dl>

            {/* �"?�"? Conteo rápido (esperado vs contado) �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?
                Se conserva para que el cajero pueda ver el descuadre en vivo
                ANTES de entrar al flujo de cierre formal. Los data-testid
                "contado" y "diferencia" siguen intactos. */}
            <div
              aria-label="Desglose del turno"
              className="border-t border-white/10 pt-3 flex flex-col gap-2 text-sm text-crema-ticket"
            >
              <h3 className="font-semibold text-crema-ticket/80">Desglose del turno</h3>
              <dl className="flex flex-col gap-1">
                <div className="flex justify-between">
                  <dt className="text-crema-ticket/60">Contado</dt>
                  <dd className="font-bold tabular-nums" data-testid="contado">
                    {formatearPrecio(capturado)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-crema-ticket/60">Diferencia</dt>
                  <dd
                    className={`font-bold tabular-nums ${descuadreEnVivo === 0 ? 'text-acento' : 'text-peligro'}`}
                    data-testid="diferencia"
                  >
                    {formatearPrecio(descuadreEnVivo)}
                  </dd>
                </div>
              </dl>
            </div>

            {/* F12.29 v6 �?" Botón "Cerrar turno" (ABIERTO �?' CIERRE).
                Se arma con `useBotonArmado`: solo dispara si el gesto anterior
                terminó y el toque empezó sobre ESTE botón. El `click`
                sintetizado de un toque previo no puede dispararlo. */}
            <button
              type="button"
              {...armar(() => setEstado(ESTADOS.CIERRE))}
              className={`min-h-tactil rounded-canon35 bg-acento text-fondo-profundo font-semibold px-4 ${FEEDBACK_TACTIL}`}
            >
              Cerrar turno
            </button>
          </section>
        </div>
      ) : null}

      {/* �"?�"? ESTADO 3: CIERRE �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"? */}
      {estado === ESTADOS.CIERRE ? (
        <section
          aria-label="Cerrar turno de caja"
          className="bg-fondo-panel rounded-canon50 p-6 flex flex-col gap-4"
        >
          <h2 className="text-xl font-bold text-crema-ticket">Arqueo y cierre</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-2 text-sm text-crema-ticket">
              Efectivo contado
              <input
                type="text"
                inputMode="decimal"
                value={conteoEfectivo}
                onChange={(e) => setConteoEfectivo(e.target.value)}
                onFocus={() => setCampoActivo('conteoEfectivo')}
                aria-label="Efectivo contado"
                data-testid="campo-conteoEfectivo"
                className={`min-h-tactil rounded-canon35 bg-fondo-profundo text-crema-ticket border px-4 ${
                  campoActivo === 'conteoEfectivo' ? 'border-acento' : 'border-white/10'
                }`}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-crema-ticket">
              Crédito
              <input
                type="text"
                inputMode="decimal"
                value={conteoCredito}
                onChange={(e) => setConteoCredito(e.target.value)}
                onFocus={() => setCampoActivo('conteoCredito')}
                aria-label="Crédito contado"
                data-testid="campo-conteoCredito"
                className={`min-h-tactil rounded-canon35 bg-fondo-profundo text-crema-ticket border px-4 ${
                  campoActivo === 'conteoCredito' ? 'border-acento' : 'border-white/10'
                }`}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm text-crema-ticket">
              Débito
              <input
                type="text"
                inputMode="decimal"
                value={conteoDebito}
                onChange={(e) => setConteoDebito(e.target.value)}
                onFocus={() => setCampoActivo('conteoDebito')}
                aria-label="Débito contado"
                data-testid="campo-conteoDebito"
                className={`min-h-tactil rounded-canon35 bg-fondo-profundo text-crema-ticket border px-4 ${
                  campoActivo === 'conteoDebito' ? 'border-acento' : 'border-white/10'
                }`}
              />
            </label>
          </div>

          <div className="flex justify-between text-crema-ticket">
            <span className="text-crema-ticket/60">Esperado</span>
            <span className="font-bold">{formatearPrecio(esperado)}</span>
          </div>
          <div className="flex justify-between text-crema-ticket">
            <span className="text-crema-ticket/60">Diferencia</span>
            <span
              className={`font-bold ${descuadreEnVivo === 0 ? 'text-acento' : 'text-peligro'}`}
              data-testid="descuadre"
            >
              {formatearPrecio(descuadreEnVivo)}
            </span>
          </div>

          {diferencia ? (
            <div
              ref={refImprimirCorte}
              role="status"
              className="rounded-canon35 bg-acento/20 text-crema-ticket px-4 py-3 text-sm flex flex-col gap-2"
            >
              <span>
                Turno cerrado. Diferencia final:{' '}
                <strong data-testid="diferencia-final">
                  {formatearPrecio(diferencia.diferencia)}
                </strong>
              </span>
              {/* FASE 10.6.4 �?" imprimir el corte (paridad con el viejo POS). */}
              <button
                type="button"
                onClick={alImprimirCorte}
                data-testid="imprimir-corte"
                className={`self-start min-h-tactil rounded-canon35 bg-acento text-fondo-profundo font-semibold px-4 ${FEEDBACK_TACTIL}`}
              >
                Imprimir corte
              </button>
              {/* FASE 10.4 �?" contexto diario post-corte (no crítico). */}
              {contextoRegistrado ? (
                <span data-testid="contexto-registrado" className="text-crema-ticket/70">
                  �o. Contexto del día registrado.
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setMostrarContexto(true)}
                  className={`self-start min-h-tactil rounded-canon35 bg-fondo-profundo text-crema-ticket border border-white/10 px-4 ${FEEDBACK_TACTIL}`}
                >
                  Registrar contexto del día
                </button>
              )}
            </div>
          ) : null}

          <div className="flex gap-3">
            {!diferencia ? (
              <>
                {/* F12.29 v6 �?" Botón "Cancelar" (CIERRE �?' ABIERTO).
                    Se arma con `useBotonArmado`: el ghost click del toque que
                    entró al estado CIERRE cae sobre esta posición y NO debe
                    dispararlo. Solo un pointerdown tras el fin del gesto lo habilita. */}
                <button
                  type="button"
                  {...armar(() => setEstado(ESTADOS.ABIERTO))}
                  className={`min-h-tactil flex-1 rounded-canon35 bg-fondo-profundo text-crema-ticket border border-white/10 px-4 ${FEEDBACK_TACTIL}`}
                >
                  Cancelar
                </button>
                {/* B3 �?" Paso 1: pide confirmación.
                    F12.29 (v6) �?" el botón se arma con `useBotonArmado`. El
                    `click` sintetizado del toque que cambió ABIERTO �?' CIERRE
                    cae sobre ESTE botón (misma posición) y, sin la guardia,
                    abriría el modal sin que el cajero lo tocara. Con la guardia
                    solo dispara tras un nuevo gesto legítimo. */}
                <button
                  type="button"
                  {...armar(alPedirConfirmacionCierre)}
                  disabled={ocupado}
                  className={`min-h-tactil flex-1 rounded-canon35 bg-peligro/80 text-crema-ticket font-semibold px-4 disabled:opacity-50 ${FEEDBACK_TACTIL}`}
                >
                  Cerrar turno
                </button>
              </>
            ) : (
              /* B4 �?" Botón para iniciar nuevo turno sin salir del gestor */
              <button
                type="button"
                onClick={alNuevoTurno}
                data-testid="nuevo-turno"
                className={`min-h-tactil flex-1 rounded-canon35 bg-acento text-fondo-profundo font-semibold px-4 ${FEEDBACK_TACTIL}`}
              >
                Iniciar Nuevo Turno
              </button>
            )}
          </div>

          {/* B3 �?" Modal de confirmación del cierre (acción irreversible).
              F12.26 �?" OVERLAY CENTRADO. Antes era un bloque inline al fondo de
              la sección de cierre: quedaba fuera del viewport y el cajero no lo
              veía ("no aparece nada"). Ahora es un overlay `fixed inset-0 z-50`
              con fondo oscurecido, imposible de ignorar (paridad con el viejo
              POS, que usaba `fixed inset-0 z-50`). Se conservan `role`,
              `aria-label` y `data-testid` para no romper los tests. */}
          {confirmandoCierre ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
              // F12.29 (v4) �?" SIN cierre por "tocar fuera".
              //
              // POR QU�?: el modal confirma una acción IRREVERSIBLE (cerrar el
              // turno). v1 (rAF), v2 (pointerdown origin) y v3 (onTouchEnd +
              // ventana de 400 ms) intentaron distinguir el "ghost click"
              // sintetizado del toque deliberado, y los tres fallaron en
              // hardware real: el navegador sintetiza la cadena COMPLETA
              // (pointerdown �?' mousedown �?' mouseup �?' click) en las coordenadas
              // del dedo, y el timing varía por dispositivo/navegador.
              //
              // La solución robusta NO es filtrar el ghost click, sino ELIMINAR
              // la superficie sobre la que cae: un modal destructivo NO debe
              // cerrarse al tocar fuera (anti-patrón de UX). El cajero cierra
              // con un botón explícito: "Volver" o "Sí, cerrar turno".
              //
              // Esto elimina la clase ENTERA de bugs de ghost click: no hay
              // handler de cierre en el backdrop, así que ningún evento
              // sintetizado puede cerrar el modal.
            >
              <div
                role="alertdialog"
                aria-label="Confirmar cierre de turno"
                className="w-full max-w-md rounded-canon50 bg-fondo-panel border border-peligro/40 p-6 flex flex-col gap-4 shadow-2xl"
              >
                <h3 className="text-lg font-bold text-crema-ticket">
                  �s�️ Confirmar cierre de turno
                </h3>
                <p className="text-crema-ticket font-semibold">
                  Esta acción es <strong className="text-peligro">irreversible</strong>.
                </p>
                <p className="text-sm text-crema-ticket/70">
                  ¿Confirmar cierre con descuadre de{' '}
                  <strong className={descuadreEnVivo === 0 ? 'text-acento' : 'text-peligro'}>
                    {formatearPrecio(descuadreEnVivo)}
                  </strong>?
                </p>
                <div className="flex gap-3">
                  {/* F12.29 v6 �?" "Volver" se arma con `useBotonArmado`.
                      El modal se monta justo bajo el dedo del cajero; el ghost
                      click del toque que lo abrió puede caer sobre este botón
                      (misma zona) y cerrarlo al instante. La guardia de gesto
                      lo impide: el botón está bloqueado hasta que el dedo se
                      levante. */}
                  <button
                    type="button"
                    {...armar(() => setConfirmandoCierre(false))}
                    className={`min-h-tactil flex-1 rounded-canon35 bg-fondo-profundo text-crema-ticket border border-white/10 px-4 ${FEEDBACK_TACTIL}`}
                  >
                    Volver
                  </button>
                  {/* F12.29 v6 �?" "Sí, cerrar turno" es IRREVERSIBLE: se arma
                      igual. Un ghost click NUNCA debe cerrar el turno. */}
                  <button
                    type="button"
                    {...armar(alCerrarTurno)}
                    disabled={ocupado}
                    data-testid="confirmar-cierre-definitivo"
                    className={`min-h-tactil flex-1 rounded-canon35 bg-peligro text-white font-semibold px-4 disabled:opacity-50 ${FEEDBACK_TACTIL}`}
                  >
                    {ocupado ? 'Cerrando�?�' : 'Sí, cerrar turno'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* FASE 10.6.1 �?" teclado táctil (paridad de operación del viejo POS).
          Solo se muestra cuando hay un campo enfocado: el cajero toca el campo
          y luego teclea. El teclado es puro; la máquina de foco vive arriba.

          FIX-BUG17 �?" En el estado ABIERTO el teclado se monta DENTRO de la
          sección de Movimientos (junto al formulario). Aquí solo se monta para
          los estados SIN_TURNO (fondo inicial) y CIERRE (conteos), para no
          duplicar el teclado ni los data-testid. */}
      {campoActivo && estado !== ESTADOS.ABIERTO ? (
        <TecladoTactil
          valor={valoresRef.current[campoActivo] ?? ''}
          onTecla={alPulsarTecla}
          activo
          tipo={CAMPOS[campoActivo]?.tipo || 'numerico'}
          etiqueta={CAMPOS[campoActivo]?.etiqueta || ''}
        />
      ) : null}

      {/* FASE 10.4 �?" modal de contexto diario (se abre al cerrar el turno). */}
      {mostrarContexto ? (
        <DailyContextModal
          servicio={servicioContexto}
          onCerrar={alCerrarContexto}
        />
      ) : null}

      {/* FASE 10.6.4 �?" NOTA DE DISE�'O: el viejo POS montaba un
          `CorteTicketTemplate` oculto y serializaba su DOM para imprimir. El
          POS nuevo NO lo necesita: `alImprimirCorte` genera el string térmico
          con `generarCorteHTML` (autosuficiente, sin leer el DOM). Montar una
          copia oculta duplicaría los `data-testid` del resumen visible
          (`esperado`, `contado`, `diferencia`, `movimientos`) y rompería las
          consultas de los tests. La paridad es de OPERACI�"N (se imprime el
          corte), no de DOM. */}
    </div>
  );
}
