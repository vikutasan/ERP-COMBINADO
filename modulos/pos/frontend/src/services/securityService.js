/**
 * Servicio de seguridad — Capa de contrato con el backend.
 *
 * Responsabilidad: validar PIN, consultar permisos.
 * Portado del POS viejo: apps/pos/services/securityService.js
 *
 * Endpoint consumido:
 *   POST /security/employees/validate-pin  → { id, name, role, profile_id, profile }
 *
 * @see Fase 2 del PLAN_MAESTRO_DEFINITIVO_POS.md
 */

// FP-01: URL dinámica desde CONFIG (shared/config.js → VITE_API_URL → .env).
import { CONFIG } from '../../../shared/config.js';
const API_BASE_URL = CONFIG.API_BASE_URL;

/**
 * Valida un PIN numérico contra el backend.
 * @param {string} pin - PIN numérico del empleado
 * @returns {Promise<Object>} { id, name, role, profile_id, profile: { permissions } }
 * @throws {Error} Si el PIN es incorrecto o el servidor falla
 */
export async function validatePin(pin) {
  const res = await fetch(`${API_BASE_URL}/security/employees/validate-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) throw new Error('PIN incorrecto');
  return res.json();
}
