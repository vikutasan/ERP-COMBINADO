/**
 * ApiContext — FA-01: inyección de dependencias del cliente del API.
 *
 * Antes: cada hook recibía `api` como prop explícita, lo que significaba
 * que `RetailVisionPOS.jsx` tenía que importar `* as api from './api/client.js'`
 * y pasarlo a cada hook individualmente. Esto acoplaba el componente orquestador
 * con el detalle de implementación del cliente.
 *
 * Ahora: el cliente del API se inyecta UNA sola vez en el árbol React mediante
 * `<ApiProvider>`. Los hooks lo obtienen con `useApi()` sin necesitar que su
 * llamador lo pase explícitamente.
 *
 * Beneficios:
 *   - Los tests solo necesitan mockear el Context, no cada prop individual.
 *   - Añadir un nuevo hook que use el API no requiere cambiar el componente padre.
 *   - El cliente puede intercambiarse en tests sin tocar la firma de los hooks.
 *
 * Uso:
 *   // main.jsx
 *   import { ApiProvider } from './context/ApiContext.jsx';
 *   <ApiProvider><App /></ApiProvider>
 *
 *   // En cualquier hook o componente profundo
 *   import { useApi } from '../context/ApiContext.jsx';
 *   const api = useApi();
 *
 *   // En tests
 *   import { ApiContext } from './context/ApiContext.jsx';
 *   <ApiContext.Provider value={mockApi}><ComponenteBajoTest /></ApiContext.Provider>
 */

import React, { createContext, useContext, useMemo } from 'react';
import * as defaultApiClient from '../api/client.js';

/** @type {React.Context<typeof defaultApiClient | null>} */
export const ApiContext = createContext(null);

/**
 * Proveedor del cliente del API.
 *
 * @param {{ cliente?: object, children: React.ReactNode }} props
 *   `cliente` permite inyectar un cliente alternativo (tests, storybook).
 *   Si se omite, usa el cliente de producción `api/client.js`.
 */
export function ApiProvider({ cliente, children }) {
  // `useMemo` evita recrear el valor en cada render cuando `cliente` es estable.
  const valor = useMemo(() => cliente ?? defaultApiClient, [cliente]);
  return (
    <ApiContext.Provider value={valor}>
      {children}
    </ApiContext.Provider>
  );
}

/**
 * Hook para acceder al cliente del API desde cualquier componente o hook.
 *
 * Fuera de un `<ApiProvider>` devuelve `null` (sin lanzar error), lo que
 * permite que el patrón de fallback `const api = apiProp ?? apiCtx` en los
 * hooks funcione correctamente en tests que inyectan el cliente como prop.
 *
 * En producción siempre hay un `<ApiProvider>` en main.jsx, así que `api`
 * nunca será `null` en el árbol real de la aplicación.
 *
 * @returns {typeof defaultApiClient | null}
 */
export function useApi() {
  return useContext(ApiContext);
}
