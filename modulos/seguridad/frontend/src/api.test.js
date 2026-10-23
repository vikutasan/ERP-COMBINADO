/**
 * Pruebas del cliente HTTP del módulo de Seguridad y Acceso.
 *
 * Se prueba ./api.js y no la pantalla, porque api.js es la frontera: si el
 * cliente respeta las rutas, los códigos y la forma de los errores, la
 * pantalla solo tiene que dibujar. Así estas pruebas no dependen de React
 * ni del DOM y siguen siendo válidas aunque la UI cambie.
 *
 * Lo que se vigila aquí:
 *   - La ruta exacta de cada contrato (7 y 8) y el prefijo /api.
 *   - Que el PIN viaje en el cuerpo como { pin } y en ningún otro sitio.
 *   - Que un 401 se convierta en ErrorApi con estado 401 y mensaje legible.
 *   - Que un fallo de red se convierta en ErrorApi con estado 0.
 *   - Que /health devuelva un booleano y nunca lance.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi, comprobarSalud, obtenerIdentidad, validarPin } from './api.js';

/** Construye una respuesta falsa con la forma mínima que usa api.js. */
function respuesta(estado, cuerpo) {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => {
      if (cuerpo === undefined) throw new SyntaxError('sin cuerpo');
      return cuerpo;
    },
  };
}

const IDENTIDAD = {
  employee_id: '11111111-2222-3333-4444-555555555555',
  nombre: 'Ana Pérez',
  perfil: 'Cajera',
  permisos: ['pos.vender', 'pos.cancelar'],
};

describe('obtenerIdentidad — contrato 7', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('llama a GET /api/security/employees/{id}', async () => {
    globalThis.fetch.mockResolvedValue(respuesta(200, IDENTIDAD));

    const ficha = await obtenerIdentidad(IDENTIDAD.employee_id);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, opciones] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(`/api/security/employees/${IDENTIDAD.employee_id}`);
    expect(opciones.method).toBeUndefined();
    expect(ficha).toEqual(IDENTIDAD);
  });

  it('escapa el identificador antes de meterlo en la ruta', async () => {
    globalThis.fetch.mockResolvedValue(respuesta(200, IDENTIDAD));

    await obtenerIdentidad('a/b c');

    expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/security/employees/a%2Fb%20c');
  });

  it('convierte un 404 en ErrorApi con estado 404 y el detail del backend', async () => {
    globalThis.fetch.mockResolvedValue(respuesta(404, { detail: 'Empleado no encontrado.' }));

    await expect(obtenerIdentidad('no-existe')).rejects.toMatchObject({
      name: 'ErrorApi',
      estado: 404,
      message: 'Empleado no encontrado.',
    });
  });

  it('convierte un 422 de Pydantic en un mensaje legible', async () => {
    globalThis.fetch.mockResolvedValue(
      respuesta(422, {
        detail: [{ loc: ['path', 'employee_id'], msg: 'Input should be a valid UUID', type: 'uuid_parsing' }],
      }),
    );

    await expect(obtenerIdentidad('basura')).rejects.toThrow('Input should be a valid UUID');
  });

  it('convierte un fallo de red en ErrorApi con estado 0', async () => {
    globalThis.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await obtenerIdentidad(IDENTIDAD.employee_id).catch((e) => e);

    expect(error).toBeInstanceOf(ErrorApi);
    expect(error.estado).toBe(0);
    expect(error.message).toContain('No se pudo contactar');
  });
});

describe('validarPin — contrato 8', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hace POST /api/security/employees/validate-pin con { pin } en el cuerpo', async () => {
    globalThis.fetch.mockResolvedValue(respuesta(200, { employee_id: IDENTIDAD.employee_id }));

    const resultado = await validarPin('1234');

    const [url, opciones] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('/api/security/employees/validate-pin');
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(opciones.body)).toEqual({ pin: '1234' });
    expect(resultado.employee_id).toBe(IDENTIDAD.employee_id);
  });

  it('el PIN no aparece en la URL', async () => {
    globalThis.fetch.mockResolvedValue(respuesta(200, { employee_id: IDENTIDAD.employee_id }));

    await validarPin('9876');

    expect(globalThis.fetch.mock.calls[0][0]).not.toContain('9876');
  });

  it('un 401 significa PIN incorrecto y no lanza un error genérico', async () => {
    globalThis.fetch.mockResolvedValue(respuesta(401, { detail: 'PIN incorrecto.' }));

    await expect(validarPin('0000')).rejects.toMatchObject({
      estado: 401,
      message: 'PIN incorrecto.',
    });
  });

  it('un 429 por rate-limit se propaga con su estado', async () => {
    globalThis.fetch.mockResolvedValue(respuesta(429, { detail: 'Demasiados intentos.' }));

    await expect(validarPin('1111')).rejects.toMatchObject({ estado: 429 });
  });

  it('un 200 sin employee_id se devuelve tal cual para que la UI decida', async () => {
    globalThis.fetch.mockResolvedValue(respuesta(200, { employee_id: null }));

    await expect(validarPin('1234')).resolves.toEqual({ employee_id: null });
  });
});

describe('comprobarSalud', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('devuelve true cuando el servicio responde status ok', async () => {
    globalThis.fetch.mockResolvedValue(respuesta(200, { status: 'ok' }));

    await expect(comprobarSalud()).resolves.toBe(true);
    expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/health');
  });

  it('devuelve false cuando el servicio responde con otro estado', async () => {
    globalThis.fetch.mockResolvedValue(respuesta(200, { status: 'degradado' }));

    await expect(comprobarSalud()).resolves.toBe(false);
  });

  it('devuelve false y no lanza cuando el servicio está caído', async () => {
    globalThis.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(comprobarSalud()).resolves.toBe(false);
  });

  it('devuelve false ante un 500', async () => {
    globalThis.fetch.mockResolvedValue(respuesta(500, { detail: 'boom' }));

    await expect(comprobarSalud()).resolves.toBe(false);
  });
});
