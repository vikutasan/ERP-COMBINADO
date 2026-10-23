/**
 * Puerta de FASE 7.2 — Voz: `voiceCartMapper` (lógica pura).
 *
 * Cubre los criterios 1–5 del gate (§7.4 del plan):
 *   1. Resuelve un producto por SKU exacto.
 *   2. Resuelve por nombre normalizado (sin acentos).
 *   3. Marca `resuelto: false` si no encuentra el producto.
 *   4. Marca `revisar: true` si la confianza < 0.7.
 *   5. Degrada cualquier intent fuera de la allowlist a `DESCONOCIDA`.
 *
 * El mapper es lógica pura (A-01): se porta CON su test.
 */

import { describe, it, expect } from 'vitest';
import {
  VOICE_CART_CONFIDENCE_THRESHOLD,
  POS_VOICE_INTENTS,
  POS_ALLOWED_INTENTS,
  normalizar,
  resolverProductoPorVoz,
  mapVoiceIntentToCartProposal,
  validateVoiceCartProposal,
  buildCartItemsFromProposal,
} from './voiceCartMapper.js';

const CATALOGO = [
  { id: 'SKU-001', name: 'Concha Vainilla', price: 12.5 },
  { id: 'SKU-002', name: 'Bolillo', price: 3.0 },
  { id: 'SKU-003', name: 'Pan de Elote', price: 25.0 },
];

describe('F7.2 · voiceCartMapper · criterio 1 — SKU exacto', () => {
  it('resuelve por id exacto', () => {
    const p = resolverProductoPorVoz('SKU-002', CATALOGO);
    expect(p).not.toBeNull();
    expect(p.id).toBe('SKU-002');
    expect(p.name).toBe('Bolillo');
  });

  it('el SKU exacto gana sobre cualquier coincidencia de nombre', () => {
    const catalogo = [
      { id: 'SKU-001', name: 'Concha Vainilla', price: 12.5 },
      { id: 'Concha Vainilla', name: 'Otro', price: 1 },
    ];
    const p = resolverProductoPorVoz('Concha Vainilla', catalogo);
    expect(p.id).toBe('Concha Vainilla');
  });
});

describe('F7.2 · voiceCartMapper · criterio 2 — nombre normalizado', () => {
  it('resuelve por nombre exacto sin acentos ni mayúsculas', () => {
    const p = resolverProductoPorVoz('concha vainilla', CATALOGO);
    expect(p?.id).toBe('SKU-001');
  });

  it('resuelve cuando el nombre del producto contiene lo dictado', () => {
    const p = resolverProductoPorVoz('concha', CATALOGO);
    expect(p?.id).toBe('SKU-001');
  });

  it('normalizar() quita acentos, signos y colapsa espacios', () => {
    expect(normalizar('  Pan de ELOTE!! ')).toBe('pan de elote');
    expect(normalizar('Café·con-Leche')).toBe('cafe con leche');
  });
});

describe('F7.2 · voiceCartMapper · criterio 3 — no resuelto', () => {
  it('devuelve null si el SKU no existe', () => {
    expect(resolverProductoPorVoz('SKU-999', CATALOGO)).toBeNull();
  });

  it('devuelve null si el texto está vacío', () => {
    expect(resolverProductoPorVoz('', CATALOGO)).toBeNull();
    expect(resolverProductoPorVoz('   ', CATALOGO)).toBeNull();
  });

  it('marca `resuelto: false` en la línea cuando no encuentra el producto', () => {
    const propuesta = mapVoiceIntentToCartProposal(
      { intent: 'AGREGAR_ITEM', entidades: { items: [{ sku: 'NO-EXISTE', cantidad: 2 }] }, confianza: 0.9 },
      CATALOGO
    );
    expect(propuesta.lineas).toHaveLength(1);
    expect(propuesta.lineas[0].resuelto).toBe(false);
    expect(propuesta.lineas[0].producto_id).toBeNull();
    expect(propuesta.hay_no_resueltos).toBe(true);
  });
});

describe('F7.2 · voiceCartMapper · criterio 4 — umbral de confianza 0.7', () => {
  it('el umbral declarado es 0.7', () => {
    expect(VOICE_CART_CONFIDENCE_THRESHOLD).toBe(0.7);
  });

  it('marca `revisar: true` si la confianza es menor al umbral', () => {
    const propuesta = mapVoiceIntentToCartProposal(
      { intent: 'AGREGAR_ITEM', entidades: { items: [{ sku: 'SKU-002', cantidad: 1 }] }, confianza: 0.5 },
      CATALOGO
    );
    expect(propuesta.revisar).toBe(true);
  });

  it('NO marca `revisar` si la confianza es alta y todo está resuelto', () => {
    const propuesta = mapVoiceIntentToCartProposal(
      { intent: 'AGREGAR_ITEM', entidades: { items: [{ sku: 'SKU-002', cantidad: 1 }] }, confianza: 0.95 },
      CATALOGO
    );
    expect(propuesta.revisar).toBe(false);
  });

  it('marca `revisar: true` si hay líneas sin resolver aunque la confianza sea alta', () => {
    const propuesta = mapVoiceIntentToCartProposal(
      { intent: 'AGREGAR_ITEM', entidades: { items: [{ sku: 'NO-EXISTE', cantidad: 1 }] }, confianza: 0.99 },
      CATALOGO
    );
    expect(propuesta.revisar).toBe(true);
  });
});

describe('F7.2 · voiceCartMapper · criterio 5 — allowlist', () => {
  it('la allowlist solo contiene AGREGAR_ITEM', () => {
    expect([...POS_ALLOWED_INTENTS]).toEqual([POS_VOICE_INTENTS.AGREGAR_ITEM]);
  });

  it('degrada COBRAR a DESCONOCIDA', () => {
    const propuesta = mapVoiceIntentToCartProposal(
      { intent: 'COBRAR', entidades: {}, confianza: 0.99 },
      CATALOGO
    );
    expect(propuesta.intencion).toBe(POS_VOICE_INTENTS.DESCONOCIDA);
  });

  it('degrada CANCELAR y QUITAR_ITEM a DESCONOCIDA', () => {
    for (const intent of ['CANCELAR', 'QUITAR_ITEM']) {
      const propuesta = mapVoiceIntentToCartProposal({ intent, confianza: 0.99 }, CATALOGO);
      expect(propuesta.intencion).toBe(POS_VOICE_INTENTS.DESCONOCIDA);
    }
  });

  it('degrada una intención inventada a DESCONOCIDA', () => {
    const propuesta = mapVoiceIntentToCartProposal(
      { intent: 'BORRAR_TODO', confianza: 0.99 },
      CATALOGO
    );
    expect(propuesta.intencion).toBe(POS_VOICE_INTENTS.DESCONOCIDA);
  });

  it('acepta AGREGAR_ITEM', () => {
    const propuesta = mapVoiceIntentToCartProposal(
      { intent: 'AGREGAR_ITEM', entidades: { items: [{ sku: 'SKU-002', cantidad: 3 }] }, confianza: 0.9 },
      CATALOGO
    );
    expect(propuesta.intencion).toBe(POS_VOICE_INTENTS.AGREGAR_ITEM);
    expect(propuesta.lineas[0].cantidad).toBe(3);
  });

  it('acepta el alias `intencion` del motor viejo', () => {
    const propuesta = mapVoiceIntentToCartProposal(
      { intencion: 'agregar_item', items: [{ sku: 'SKU-002', cantidad: 1 }], confianza: 0.9 },
      CATALOGO
    );
    expect(propuesta.intencion).toBe(POS_VOICE_INTENTS.AGREGAR_ITEM);
  });
});

describe('F7.2 · voiceCartMapper · regla de oro (human-in-the-loop)', () => {
  it('toda propuesta nace sin confirmar', () => {
    const propuesta = mapVoiceIntentToCartProposal(
      { intent: 'AGREGAR_ITEM', entidades: { items: [{ sku: 'SKU-002', cantidad: 1 }] }, confianza: 0.99 },
      CATALOGO
    );
    expect(propuesta.confirmado).toBe(false);
    expect(propuesta.lineas.every((l) => l.confirmado === false)).toBe(true);
  });

  it('validateVoiceCartProposal exige confirmación explícita', () => {
    const propuesta = mapVoiceIntentToCartProposal(
      { intent: 'AGREGAR_ITEM', entidades: { items: [{ sku: 'SKU-002', cantidad: 1 }] }, confianza: 0.99 },
      CATALOGO
    );
    expect(validateVoiceCartProposal(propuesta).ok).toBe(false);
    const confirmada = { ...propuesta, confirmado: true };
    expect(validateVoiceCartProposal(confirmada).ok).toBe(true);
  });

  it('validateVoiceCartProposal rechaza DESCONOCIDA', () => {
    const propuesta = mapVoiceIntentToCartProposal({ intent: 'COBRAR', confianza: 0.99 }, CATALOGO);
    expect(validateVoiceCartProposal(propuesta).ok).toBe(false);
  });

  it('buildCartItemsFromProposal solo emite líneas resueltas y con cantidad', () => {
    const propuesta = mapVoiceIntentToCartProposal(
      {
        intent: 'AGREGAR_ITEM',
        entidades: {
          items: [
            { sku: 'SKU-002', cantidad: 3 },
            { sku: 'NO-EXISTE', cantidad: 1 },
          ],
        },
        confianza: 0.9,
      },
      CATALOGO
    );
    const items = buildCartItemsFromProposal(propuesta);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ id: 'SKU-002', name: 'Bolillo', price: 3.0, quantity: 3 });
  });
});
