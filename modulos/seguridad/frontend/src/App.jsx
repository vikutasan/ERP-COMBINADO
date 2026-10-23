/**
 * Pantalla principal de Seguridad y Acceso — FASE 3.1 del ERP COMBINADO.
 *
 * Esta pantalla ejercita los DOS contratos del módulo, y nada más:
 *
 *   Contrato 8  POST /security/employees/validate-pin
 *               El colaborador teclea su PIN y recibe su employee_id.
 *               Es el único contrato que transporta un secreto (O-21).
 *
 *   Contrato 7  GET  /security/employees/{employee_id}
 *               Con el employee_id se pide la PROYECCIÓN de identidad
 *               (nombre, perfil, permisos). Nunca devuelve el PIN (RN-S01)
 *               ni la tabla employees completa (O-23).
 *
 * Reglas que esta pantalla respeta a propósito:
 *
 *   O-21  El PIN vive SOLO en el estado del componente. No se registra en
 *         consola, no se guarda en localStorage, no se envía a ningún otro
 *         sitio y se borra del estado en cuanto termina la validación.
 *   REGLA 1  No importa nada de ERP-R-DE-RICO/apps/ ni de otros módulos.
 *         Todo el tráfico HTTP pasa por ./api.js.
 *   DT-02  El frontend no calcula dinero. Aquí no hay dinero que calcular,
 *         pero la regla se mantiene: no se hacen sumas de negocio.
 *   RT-14  Responsivo: la rejilla de dos columnas colapsa a una sola en
 *         tableta y móvil (ver index.css).
 */

import { useCallback, useEffect, useState } from 'react';
import { comprobarSalud, obtenerIdentidad, validarPin } from './api.js';

/** Longitud mínima y máxima del PIN, alineada con el esquema del contrato 8. */
const PIN_MIN = 4;
const PIN_MAX = 8;

/**
 * Ficha de identidad resuelta.
 *
 * Es un componente de presentación puro: recibe la proyección del contrato 7
 * y la dibuja. No hace peticiones, no guarda estado.
 */
function FichaIdentidad({ identidad }) {
  const permisos = Array.isArray(identidad.permisos) ? identidad.permisos : [];

  return (
    <div className="identidad">
      <p className="identidad__nombre">{identidad.nombre}</p>
      <p className="identidad__perfil">{identidad.perfil}</p>

      {permisos.length > 0 ? (
        <ul className="permisos">
          {permisos.map((permiso) => (
            <li className="permisos__item" key={permiso}>
              {permiso}
            </li>
          ))}
        </ul>
      ) : (
        <p className="vacio">Este perfil no tiene permisos declarados.</p>
      )}

      <p className="tarjeta__ayuda">
        employee_id: <code>{identidad.employee_id}</code>
      </p>
    </div>
  );
}

export default function App() {
  // --- Contrato 8: PIN ---------------------------------------------------
  const [pin, setPin] = useState('');
  const [validando, setValidando] = useState(false);
  const [errorPin, setErrorPin] = useState('');

  // --- Contrato 7: identidad --------------------------------------------
  const [identidad, setIdentidad] = useState(null);
  const [uuid, setUuid] = useState('');
  const [consultando, setConsultando] = useState(false);
  const [errorUuid, setErrorUuid] = useState('');

  // --- Salud del módulo --------------------------------------------------
  const [salud, setSalud] = useState(null);

  useEffect(() => {
    let vigente = true;
    comprobarSalud().then((enLinea) => {
      if (vigente) setSalud(enLinea);
    });
    return () => {
      vigente = false;
    };
  }, []);

  /**
   * Contrato 8 seguido del contrato 7.
   *
   * El PIN se limpia del estado en cuanto la petición termina, tanto si
   * valida como si no (O-21). Si valida, se encadena la consulta de la
   * identidad para que el operador vea de inmediato quién entró.
   */
  const enviarPin = useCallback(
    async (evento) => {
      evento.preventDefault();
      setErrorPin('');

      if (!/^\d+$/.test(pin)) {
        setErrorPin('El PIN debe contener solo dígitos.');
        return;
      }
      if (pin.length < PIN_MIN || pin.length > PIN_MAX) {
        setErrorPin(`El PIN debe tener entre ${PIN_MIN} y ${PIN_MAX} dígitos.`);
        return;
      }

      setValidando(true);
      try {
        const resultado = await validarPin(pin);
        setPin('');

        if (!resultado || !resultado.employee_id) {
          setIdentidad(null);
          setErrorPin('El PIN no corresponde a ningún colaborador activo.');
          return;
        }

        const ficha = await obtenerIdentidad(resultado.employee_id);
        setIdentidad(ficha);
      } catch (error) {
        setPin('');
        setIdentidad(null);
        setErrorPin(error.message || 'No se pudo validar el PIN.');
      } finally {
        setValidando(false);
      }
    },
    [pin],
  );

  /**
   * Contrato 7 directo: el operador pega un employee_id y consulta la ficha.
   * Sirve para diagnosticar sin conocer el PIN de nadie.
   */
  const consultarUuid = useCallback(
    async (evento) => {
      evento.preventDefault();
      setErrorUuid('');

      const limpio = uuid.trim();
      if (limpio === '') {
        setErrorUuid('Escribe un employee_id para consultar.');
        return;
      }

      setConsultando(true);
      try {
        const ficha = await obtenerIdentidad(limpio);
        setIdentidad(ficha);
      } catch (error) {
        setIdentidad(null);
        setErrorUuid(error.message || 'No se pudo consultar la identidad.');
      } finally {
        setConsultando(false);
      }
    },
    [uuid],
  );

  const claseSalud =
    salud === null ? 'salud__punto' : salud ? 'salud__punto salud__punto--ok' : 'salud__punto salud__punto--error';
  const textoSalud = salud === null ? 'Comprobando…' : salud ? 'Servicio en línea' : 'Servicio sin respuesta';

  return (
    <div className="modulo">
      <header className="encabezado">
        <div>
          <h1 className="encabezado__titulo">Seguridad y Acceso</h1>
          <p className="encabezado__subtitulo">
            Identidad del colaborador y validación de PIN — contratos 7 y 8.
          </p>
        </div>
        <p className="salud">
          <span className={claseSalud} aria-hidden="true" />
          {textoSalud}
        </p>
      </header>

      <main className="contenido">
        {/* Contrato 8 — validar PIN */}
        <section className="tarjeta">
          <h2 className="tarjeta__titulo">Entrar con PIN</h2>
          <p className="tarjeta__ayuda">
            El PIN se envía una sola vez, no se guarda y se borra del formulario al terminar.
          </p>

          <form onSubmit={enviarPin} noValidate>
            <div className="campo">
              <label className="campo__etiqueta" htmlFor="pin">
                PIN del colaborador
              </label>
              <input
                id="pin"
                className="campo__entrada campo__entrada--pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={PIN_MAX}
                value={pin}
                onChange={(evento) => setPin(evento.target.value.replace(/\D/g, ''))}
                disabled={validando}
                placeholder="••••"
              />
            </div>

            <button className="boton boton--ancho" type="submit" disabled={validando || pin.length === 0}>
              {validando ? 'Validando…' : 'Validar PIN'}
            </button>
          </form>

          {errorPin !== '' && (
            <p className="mensaje--error" role="alert">
              {errorPin}
            </p>
          )}
        </section>

        {/* Contrato 7 — consultar identidad por employee_id */}
        <section className="tarjeta">
          <h2 className="tarjeta__titulo">Consultar identidad</h2>
          <p className="tarjeta__ayuda">
            Consulta directa por employee_id. Útil para diagnosticar sin conocer el PIN de nadie.
          </p>

          <form onSubmit={consultarUuid} noValidate>
            <div className="campo">
              <label className="campo__etiqueta" htmlFor="uuid">
                employee_id
              </label>
              <input
                id="uuid"
                className="campo__entrada"
                type="text"
                autoComplete="off"
                spellCheck="false"
                value={uuid}
                onChange={(evento) => setUuid(evento.target.value)}
                disabled={consultando}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </div>

            <button className="boton boton--ancho" type="submit" disabled={consultando || uuid.trim() === ''}>
              {consultando ? 'Consultando…' : 'Consultar'}
            </button>
          </form>

          {errorUuid !== '' && (
            <p className="mensaje--error" role="alert">
              {errorUuid}
            </p>
          )}
        </section>

        {/* Resultado compartido por ambos contratos */}
        <section className="tarjeta" style={{ gridColumn: '1 / -1' }}>
          <h2 className="tarjeta__titulo">Identidad resuelta</h2>
          {identidad ? (
            <FichaIdentidad identidad={identidad} />
          ) : (
            <p className="vacio">Todavía no hay ninguna identidad resuelta.</p>
          )}
        </section>
      </main>
    </div>
  );
}
