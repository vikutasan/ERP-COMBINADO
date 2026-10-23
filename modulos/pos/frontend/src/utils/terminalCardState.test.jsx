/**
 * Puerta de FASE 7.7b — Regresión del bloqueo de entrada a terminales.
 *
 * El bug que el usuario reportó ("se ve bien pero no me deja entrar a ninguna
 * terminal") tenía DOS causas encadenadas:
 *
 *   1. El router `/pos/terminals/*` no existía en la API (404). → F7.7.
 *   2. Aun con el router, el status exponía `occupier_id` como UUID canónico,
 *      pero el frontend identifica al usuario con su id ORIGINAL (`1`). La
 *      comparación `occupier_id === currentUser.id` nunca era verdadera, así
 *      que el dueño veía su propia terminal como "ocupada por otro" y el
 *      selector le negaba la entrada. → F7.7b (este archivo).
 *
 * Estos tests fijan la clasificación correcta para que el bloqueo no vuelva.
 */

import { describe, it, expect } from 'vitest';
import { resolveCardState, resolveNetStatus } from './terminalCardState.js';

const UUID_DERIVADO = 'ddfc5cb5-e91b-5ada-b4e2-2793e2cd1ba2';

describe('resolveCardState — clasificación de la tarjeta de terminal', () => {
  it('una terminal sin candado es "free"', () => {
    expect(resolveCardState(null, 1)).toBe('free');
    expect(resolveCardState({ occupier_id: null }, 1)).toBe('free');
  });

  it('el dueño se reconoce a sí mismo por `occupier_ref` (id original)', () => {
    // El caso exacto que bloqueaba la entrada: el status trae el UUID en
    // `occupier_id` y el id original en `occupier_ref`.
    const info = { occupier_id: UUID_DERIVADO, occupier_ref: '1' };
    expect(resolveCardState(info, 1)).toBe('mine');
  });

  it('el dueño se reconoce aunque el id venga como string', () => {
    const info = { occupier_id: UUID_DERIVADO, occupier_ref: '1' };
    expect(resolveCardState(info, '1')).toBe('mine');
  });

  it('el dueño se reconoce con ids de texto (cajero-1)', () => {
    const info = { occupier_id: UUID_DERIVADO, occupier_ref: 'cajero-1' };
    expect(resolveCardState(info, 'cajero-1')).toBe('mine');
  });

  it('REGRESIÓN: comparar contra el UUID NO debe marcar la terminal como mía', () => {
    // Si alguien vuelve a comparar contra `occupier_id`, este test lo delata:
    // el UUID derivado nunca es igual al id del usuario.
    const info = { occupier_id: UUID_DERIVADO, occupier_ref: '1' };
    expect(resolveCardState(info, UUID_DERIVADO)).toBe('occupied');
  });

  it('una terminal de otro usuario es "occupied"', () => {
    const info = { occupier_id: UUID_DERIVADO, occupier_ref: '2' };
    expect(resolveCardState(info, 1)).toBe('occupied');
  });

  it('sin usuario actual, una terminal ocupada es "occupied" (no "mine")', () => {
    const info = { occupier_id: UUID_DERIVADO, occupier_ref: '1' };
    expect(resolveCardState(info, null)).toBe('occupied');
    expect(resolveCardState(info, undefined)).toBe('occupied');
  });

  it('compatibilidad: sin `occupier_ref` cae al `occupier_id`', () => {
    // Respuestas antiguas (sin el campo nuevo) siguen clasificando bien.
    const info = { occupier_id: '1' };
    expect(resolveCardState(info, 1)).toBe('mine');
    expect(resolveCardState(info, 2)).toBe('occupied');
  });
});

describe('resolveNetStatus — etiqueta de conexión', () => {
  it('sin candado es DISPONIBLE', () => {
    expect(resolveNetStatus(null).label).toBe('DISPONIBLE');
    expect(resolveNetStatus({ occupier_id: null }).label).toBe('DISPONIBLE');
  });

  it('un candado reciente es EN LÍNEA', () => {
    const info = { occupier_id: UUID_DERIVADO, locked_at: new Date().toISOString() };
    expect(resolveNetStatus(info).label).toBe('EN LÍNEA');
  });

  it('una sesión marcada como expirada es SESIÓN EXPIRADA', () => {
    const info = { occupier_id: UUID_DERIVADO, stale_session: true };
    expect(resolveNetStatus(info).label).toBe('SESIÓN EXPIRADA');
  });
});
