/**
 * useAuth — Hook de autenticación.
 *
 * Responsabilidad: gestionar el estado de login/logout.
 * - Validar PIN via securityService
 * - Mantener el usuario actual en estado
 * - Persistir sesión en sessionStorage (sobrevive refresh, no tabs)
 *
 * Lección integrada (H1): primitivos en deps, no objetos.
 *
 * @see Fase 2 del PLAN_MAESTRO_DEFINITIVO_POS.md
 */

import { useState, useCallback, useEffect } from 'react';
import { validatePin } from '../services/securityService.js';

const SESSION_KEY = 'pos_session';

/**
 * @returns {{ currentUser, isAuthenticated, isLoading, error, login, logout }}
 */
export function useAuth() {
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Restaurar sesión al montar (sobrevive refresh)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.id) setCurrentUser(parsed);
      }
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }, []);

  const login = useCallback(async (pin) => {
    setError(null);
    setIsLoading(true);
    try {
      const userData = await validatePin(pin);
      const user = {
        id: userData.id,
        name: userData.name,
        role: userData.role,
        profile_id: userData.profile_id,
        permissions: userData.profile?.permissions || {},
      };
      setCurrentUser(user);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
      return user;
    } catch (err) {
      setError('Clave de acceso incorrecta');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setCurrentUser(null);
    sessionStorage.removeItem(SESSION_KEY);
  }, []);

  return {
    currentUser,
    isAuthenticated: currentUser !== null,
    isLoading,
    error,
    login,
    logout,
  };
}
