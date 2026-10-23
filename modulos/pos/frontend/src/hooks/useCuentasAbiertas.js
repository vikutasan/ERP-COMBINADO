/**
 * useCuentasAbiertas — refresca el conteo de cuentas abiertas de una terminal.
 *
 * Extraído de `RetailVisionPOS.jsx` (FS2-03). F12.5 — Pizarrón de cuentas
 * abiertas: refresca el CONTEO de cuentas abiertas de la terminal para el
 * badge del botón del header. Es una lectura ligera por el contrato 23;
 * si falla, se deja el conteo en 0 sin romper la pantalla (el pizarrón
 * es la autoridad).
 *
 * @param {object} opciones
 * @param {string} opciones.terminalId - ID de la terminal activa.
 * @param {Function} [opciones.listar] - Función inyectable para tests.
 * @returns {{ cuentasAbiertas: number, refrescarConteoCuentas: Function }}
 */

import { useState, useEffect, useCallback } from 'react';
import { listarCuentasAbiertas as listarDefault } from '../services/openAccountsService.js';

export function useCuentasAbiertas({ terminalId, listar } = {}) {
  const listarCuentasAbiertas = listar ?? listarDefault;
  const [cuentasAbiertas, setCuentasAbiertas] = useState(0);

  const refrescarConteoCuentas = useCallback(async () => {
    const r = await listarCuentasAbiertas(terminalId);
    if (r.outcome === 'ok') {
      setCuentasAbiertas((r.data?.cuentas ?? []).length);
    }
  }, [listarCuentasAbiertas, terminalId]);

  useEffect(() => {
    refrescarConteoCuentas();
  }, [refrescarConteoCuentas]);

  return { cuentasAbiertas, refrescarConteoCuentas };
}
