// Cliente HTTP de Seguridad y Acceso — FASE 3.1.
//
// Este archivo es el ÚNICO punto del frontend que habla con el API de
// Seguridad. Ningún componente hace `fetch` por su cuenta: así el manejo de
// errores, el prefijo `/api` y el contrato quedan en un solo lugar.
//
// Contratos consumidos (registry.py):
//   * Contrato 7 — GET  /security/employees/{employee_id}
//   * Contrato 8 — POST /security/employees/validate-pin
//
// O-21: el PIN viaja en el cuerpo de una petición POST sobre HTTPS. Nunca se
// registra en consola, nunca se guarda en localStorage y nunca se devuelve.
//
// Todas las rutas van con el prefijo `/api`, que Vite reescribe al API real
// (5229 en desarrollo). En producción `VITE_API_URL` apunta al servidor real.

const BASE = '/api';

/**
 * Error de la API con el código HTTP y el detalle que devolvió el backend.
 * El `detail` de FastAPI puede ser un string o una lista de errores de
 * validación (422); se normaliza a string para poder mostrarlo tal cual.
 */
export class ErrorApi extends Error {
  constructor(mensaje, estado, detalle) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.estado = estado;
    this.detalle = detalle;
  }
}

/** Convierte el `detail` de FastAPI en un texto legible. */
function _textoDelDetalle(detalle, estado) {
  if (typeof detalle === 'string' && detalle.trim() !== '') return detalle;
  if (Array.isArray(detalle) && detalle.length > 0) {
    // Errores de validación de Pydantic: [{loc, msg, type}, ...]
    return detalle
      .map((e) => (e && typeof e.msg === 'string' ? e.msg : JSON.stringify(e)))
      .join(' · ');
  }
  return `Error ${estado} al contactar el servicio de seguridad.`;
}

/** Ejecuta la petición y traduce cualquier fallo a `ErrorApi`. */
async function _pedir(ruta, opciones = {}) {
  let respuesta;
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) },
      ...opciones,
    });
  } catch (causa) {
    // Fallo de red: el módulo está caído o no hay conexión.
    throw new ErrorApi(
      'No se pudo contactar el servicio de seguridad. Verifica que el módulo esté en línea.',
      0,
      String(causa),
    );
  }

  if (respuesta.status === 204) return null;

  let cuerpo = null;
  try {
    cuerpo = await respuesta.json();
  } catch {
    cuerpo = null;
  }

  if (!respuesta.ok) {
    const detalle = cuerpo && cuerpo.detail !== undefined ? cuerpo.detail : null;
    throw new ErrorApi(_textoDelDetalle(detalle, respuesta.status), respuesta.status, detalle);
  }

  return cuerpo;
}

/**
 * Contrato 7 — identidad del empleado.
 *
 * Devuelve EXACTAMENTE cuatro campos: `employee_id`, `nombre`, `perfil` y
 * `permisos`. El PIN (`employee_code`) nunca forma parte de esta proyección
 * (RN-S01, O-23).
 *
 * @param {string} employeeId UUID del colaborador.
 * @returns {Promise<{employee_id: string, nombre: string, perfil: string, permisos: string[]}>}
 */
export async function obtenerIdentidad(employeeId) {
  return _pedir(`/security/employees/${encodeURIComponent(employeeId)}`);
}

/**
 * Contrato 8 — validación de PIN.
 *
 * Devuelve `{ valido, employee_id }`. Un PIN incorrecto, un colaborador
 * inexistente o un colaborador dado de baja producen 401 con el mismo
 * mensaje genérico: el backend no revela cuál de los tres casos ocurrió.
 *
 * @param {string} pin PIN tecleado por el colaborador.
 * @returns {Promise<{valido: boolean, employee_id: string|null}>}
 */
export async function validarPin(pin) {
  return _pedir('/security/employees/validate-pin', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
}

/**
 * Comprueba que el API de Seguridad esté vivo.
 * Se usa en el indicador de estado del encabezado.
 *
 * @returns {Promise<boolean>}
 */
export async function comprobarSalud() {
  try {
    const cuerpo = await _pedir('/health');
    return Boolean(cuerpo && cuerpo.status === 'ok');
  } catch {
    return false;
  }
}
