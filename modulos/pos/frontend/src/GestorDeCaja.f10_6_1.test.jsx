/**
 * Puerta de FASE 10.6.1 — Teclado táctil del Gestor de Caja (frontend).
 *
 * Verifica que `GestorDeCaja` recupera la OPERACIÓN del teclado táctil del viejo
 * POS: el cajero toca un campo de monto y teclea en pantalla, sin depender del
 * teclado físico. La IMPLEMENTACIÓN se reescribe (§6.8): el teclado es un
 * componente puro (`TecladoTactil`) y la máquina de foco vive en el contenedor.
 *
 *   1. Sin campo enfocado, el teclado NO se muestra.
 *   2. Al enfocar un campo, el teclado aparece y refleja su etiqueta.
 *   3. Teclear dígitos construye el monto en el campo enfocado.
 *   4. Un solo punto decimal (el segundo se ignora).
 *   5. Máximo dos decimales (el tercero se ignora).
 *   6. `←` borra el último carácter; `C` limpia todo.
 *   7. `ENTER` avanza el foco al siguiente campo del estado (CIERRE).
 *   8. El monto tecleado se envía al registrar el movimiento.
 *
 * Este archivo lo ejecuta Vitest (jsdom) vía `npm run test` en apps/pos.
 *
 * @see PLAN_DE_ABORDAJE_F10_6_PARIDAD_DE_OPERACION_DE_CAJA.md §5 (F10.6.1)
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import GestorDeCaja from './GestorDeCaja.jsx';
// F12.29 v5 — los botones de cierre se arman con `useBotonArmado`: un toque
// real emite `pointerdown` + `click`. `tocar` encapsula esa secuencia.
import { tocar } from './test-utils/tocar.js';

afterEach(() => {
  cleanup();
});

/** Turno abierto de ejemplo (contrato 10). */
function turnoAbierto() {
  return {
    cash_session_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    terminal_id: 'TERM-01',
    monto_inicial: '500.00',
    abierta_en: '2026-09-30T14:00:00Z',
  };
}

/** Resumen del turno (contrato 12) mínimo. */
function resumenTurno(extra = {}) {
  return {
    esperado: '1500.00',
    movimientos: [],
    fondo_inicial: '500.00',
    total_entradas: '0.00',
    total_salidas: '0.00',
    total_credito: '0.00',
    total_debito: '0.00',
    total_transferencia: '0.00',
    total_ventas: '0.00',
    num_transacciones: 0,
    ...extra,
  };
}

/** Servicio de caja doble con turno ya abierto. */
function servicioCaja(resumen = resumenTurno()) {
  return {
    obtenerTurnoActivo: vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: turnoAbierto(),
    })),
    obtenerResumen: vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: resumen,
    })),
    cerrarTurno: vi.fn(),
    abrirTurno: vi.fn(),
    registrarMovimiento: vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: { id: 'mov-1' },
    })),
  };
}

/** Servicio de contexto doble (contrato 28) — no interviene aquí. */
function servicioContexto() {
  return {
    CLIMAS: [],
    enviarContextoDiario: vi.fn(async () => ({ outcome: 'ok', reason: null, data: {} })),
  };
}

/** Monta el gestor con un turno ya abierto y espera el resumen asíncrono. */
async function montarConTurnoAbierto(servicio) {
  render(
    <GestorDeCaja
      terminalId="TERM-01"
      usuarioId="user-1"
      servicio={servicio}
      servicioContexto={servicioContexto()}
    />
  );
  await waitFor(() => {
    expect(screen.getByText('Resumen del turno')).toBeTruthy();
  });
  await waitFor(() => {
    expect(servicio.obtenerResumen).toHaveBeenCalled();
  });
}

/** Monta el gestor SIN turno (formulario de apertura). */
async function montarSinTurno(servicio) {
  servicio.obtenerTurnoActivo = vi.fn(async () => ({
    outcome: 'ok',
    reason: null,
    data: null,
  }));
  render(
    <GestorDeCaja
      terminalId="TERM-01"
      usuarioId="user-1"
      servicio={servicio}
      servicioContexto={servicioContexto()}
    />
  );
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Abrir turno' })).toBeTruthy();
  });
}

/** Pulsa una tecla del teclado táctil por su aria-label. */
function teclear(tecla) {
  fireEvent.click(screen.getByLabelText(`Tecla ${tecla}`));
}

// ---------------------------------------------------------------------------
// 1. Visibilidad del teclado
// ---------------------------------------------------------------------------

describe('F10.6.1 — criterio 1: el teclado aparece solo con un campo enfocado', () => {
  it('no muestra el teclado si ningún campo está enfocado', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);
    expect(screen.queryByLabelText('Teclado táctil')).toBeNull();
  });

  it('muestra el teclado al enfocar el monto del movimiento', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);
    fireEvent.focus(screen.getByTestId('campo-montoMov'));
    expect(screen.getByLabelText('Teclado táctil')).toBeTruthy();
    expect(screen.getByText('Monto del movimiento')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Construcción del monto
// ---------------------------------------------------------------------------

describe('F10.6.1 — criterio 2: teclear construye el monto', () => {
  it('concatena los dígitos en el campo enfocado', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);
    fireEvent.focus(screen.getByTestId('campo-montoMov'));

    teclear('1');
    teclear('2');
    teclear('3');

    expect(screen.getByTestId('campo-montoMov').value).toBe('123');
    expect(screen.getByTestId('teclado-display').textContent).toBe('123');
  });

  it('ignora un segundo punto decimal', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);
    fireEvent.focus(screen.getByTestId('campo-montoMov'));

    teclear('1');
    teclear('.');
    teclear('5');
    teclear('.'); // ignorado
    teclear('9');

    expect(screen.getByTestId('campo-montoMov').value).toBe('1.59');
  });

  it('limita a dos decimales', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);
    fireEvent.focus(screen.getByTestId('campo-montoMov'));

    teclear('1');
    teclear('.');
    teclear('2');
    teclear('3');
    teclear('4'); // ignorado (tercer decimal)

    expect(screen.getByTestId('campo-montoMov').value).toBe('1.23');
  });

  it('no deja ceros a la izquierda', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);
    fireEvent.focus(screen.getByTestId('campo-montoMov'));

    teclear('0');
    teclear('5');

    expect(screen.getByTestId('campo-montoMov').value).toBe('5');
  });
});

// ---------------------------------------------------------------------------
// 3. Borrado y limpieza
// ---------------------------------------------------------------------------

describe('F10.6.1 — criterio 3: borrar y limpiar', () => {
  it('← borra el último carácter', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);
    fireEvent.focus(screen.getByTestId('campo-montoMov'));

    teclear('1');
    teclear('2');
    teclear('3');
    teclear('←');

    expect(screen.getByTestId('campo-montoMov').value).toBe('12');
  });

  it('C limpia todo el campo', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);
    fireEvent.focus(screen.getByTestId('campo-montoMov'));

    teclear('1');
    teclear('2');
    // FIX-BUG17 — la tecla de limpiar emite 'LIMPIAR' (antes 'C'), para no
    // colisionar con la letra "C" del teclado alfabético.
    fireEvent.click(screen.getByLabelText('Tecla limpiar'));

    expect(screen.getByTestId('campo-montoMov').value).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 4. ENTER avanza el foco (estado CIERRE)
// ---------------------------------------------------------------------------

describe('F10.6.1 — criterio 4: ENTER avanza el foco', () => {
  it('pasa de efectivo a crédito y luego a débito', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    // Entrar al estado CIERRE (F12.29 v5 — toque real).
    tocar(screen.getByText('Cerrar turno'));

    fireEvent.focus(screen.getByTestId('campo-conteoEfectivo'));
    // El display del teclado refleja el campo enfocado (su etiqueta).
    expect(screen.getByTestId('teclado-display').previousSibling.textContent).toBe(
      'Efectivo contado'
    );

    teclear('ENTER');
    expect(screen.getByTestId('teclado-display').previousSibling.textContent).toBe(
      'Crédito contado'
    );

    teclear('ENTER');
    expect(screen.getByTestId('teclado-display').previousSibling.textContent).toBe(
      'Débito contado'
    );

    // En el último campo, ENTER desenfoca (el teclado desaparece).
    teclear('ENTER');
    expect(screen.queryByLabelText('Teclado táctil')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. El monto tecleado llega al servicio
// ---------------------------------------------------------------------------

describe('F10.6.1 — criterio 5: el monto tecleado se envía', () => {
  it('registra el movimiento con el monto construido en pantalla', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    fireEvent.focus(screen.getByTestId('campo-montoMov'));
    teclear('2');
    teclear('5');
    teclear('.');
    teclear('5');

    fireEvent.change(screen.getByLabelText('Motivo del movimiento'), {
      target: { value: 'Cambio' },
    });
    fireEvent.click(screen.getByText('Registrar movimiento'));

    await waitFor(() => {
      expect(servicio.registrarMovimiento).toHaveBeenCalledWith(
        expect.objectContaining({ monto: 25.5, motivo: 'Cambio' })
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 6. El teclado también sirve en el formulario de apertura
// ---------------------------------------------------------------------------

describe('F10.6.1 — criterio 6: teclado en el formulario de apertura', () => {
  it('permite teclear el fondo inicial', async () => {
    const servicio = servicioCaja();
    await montarSinTurno(servicio);

    fireEvent.focus(screen.getByTestId('campo-fondoInicial'));
    teclear('5');
    teclear('0');
    teclear('0');

    expect(screen.getByTestId('campo-fondoInicial').value).toBe('500');
  });
});

// ---------------------------------------------------------------------------
// 7. FIX-BUG17 — teclado ALFABÉTICO para el "Motivo"
// ---------------------------------------------------------------------------

describe('FIX-BUG17 — criterio 7: el Motivo usa el teclado alfabético', () => {
  it('al enfocar el Motivo, el teclado cambia a modo alfabético', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    fireEvent.focus(screen.getByTestId('campo-motivoMov'));

    const teclado = screen.getByLabelText('Teclado táctil');
    expect(teclado.getAttribute('data-tipo')).toBe('alfabetico');
    expect(screen.getByText('Teclado alfabético')).toBeTruthy();
  });

  it('teclear letras construye el motivo en el campo enfocado', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    fireEvent.focus(screen.getByTestId('campo-motivoMov'));
    teclear('C');
    teclear('A');
    teclear('M');
    teclear('B');
    teclear('I');
    teclear('O');

    expect(screen.getByTestId('campo-motivoMov').value).toBe('CAMBIO');
    expect(screen.getByTestId('teclado-display').textContent).toBe('CAMBIO');
  });

  it('el modo numérico NO acepta letras (el Motivo sí)', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    // El campo Monto usa el teclado numérico.
    fireEvent.focus(screen.getByTestId('campo-montoMov'));
    expect(screen.getByLabelText('Teclado táctil').getAttribute('data-tipo')).toBe('numerico');
    // No existe la tecla "A" en el modo numérico.
    expect(screen.queryByLabelText('Tecla A')).toBeNull();
  });

  it('ENTER avanza del Monto al Motivo (orden de tabulación ABIERTO)', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    fireEvent.focus(screen.getByTestId('campo-montoMov'));
    expect(screen.getByTestId('teclado-display').previousSibling.textContent).toBe(
      'Monto del movimiento'
    );

    teclear('ENTER');
    expect(screen.getByTestId('teclado-display').previousSibling.textContent).toBe(
      'Motivo del movimiento'
    );
  });
});

// ---------------------------------------------------------------------------
// 8. FIX-BUG17 — el teclado queda JUNTO al formulario (arriba del Balance)
// ---------------------------------------------------------------------------

describe('FIX-BUG17 — criterio 8: el teclado va junto al formulario', () => {
  it('el teclado se monta dentro de la sección de Movimientos', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    fireEvent.focus(screen.getByTestId('campo-montoMov'));

    const movimientos = screen.getByLabelText('Movimientos del turno');
    const teclado = screen.getByLabelText('Teclado táctil');
    // El teclado es descendiente de la sección de Movimientos (no del final
    // del contenedor, lejos del campo).
    expect(movimientos.contains(teclado)).toBe(true);
  });

  it('la sección de Movimientos aparece ANTES que el Balance en el DOM', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    const movimientos = screen.getByLabelText('Movimientos del turno');
    const balance = screen.getByLabelText('Resumen del turno');
    // `compareDocumentPosition` con DOCUMENT_POSITION_FOLLOWING (4) confirma
    // que el Balance viene DESPUÉS de Movimientos.
    const relacion = movimientos.compareDocumentPosition(balance);
    expect(relacion & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 9. FIX-BUG17 — el teclado alfabético va en ORDEN ALFABÉTICO (A→Z)
// ---------------------------------------------------------------------------

describe('FIX-BUG17 — criterio 9: el teclado alfabético respeta el orden A→Z', () => {
  it('las letras se pintan en orden alfabético, no QWERTY', async () => {
    const servicio = servicioCaja();
    await montarConTurnoAbierto(servicio);

    fireEvent.focus(screen.getByTestId('campo-motivoMov'));

    const teclado = screen.getByLabelText('Teclado táctil');
    // Se leen las etiquetas de las teclas de letra (aria-label "Tecla X").
    const letras = Array.from(teclado.querySelectorAll('button'))
      .map((b) => b.getAttribute('aria-label') || '')
      .filter((etiqueta) => /^Tecla [A-ZÑ]$/.test(etiqueta))
      .map((etiqueta) => etiqueta.replace('Tecla ', ''));

    // La primera letra es la A y la segunda la B (orden alfabético, no QWERTY
    // donde la primera sería la Q).
    expect(letras[0]).toBe('A');
    expect(letras[1]).toBe('B');
    expect(letras[2]).toBe('C');
    // El arreglo completo está ordenado alfabéticamente.
    const ordenado = [...letras].sort((a, b) => a.localeCompare(b, 'es'));
    expect(letras).toEqual(ordenado);
  });
});

// ---------------------------------------------------------------------------
// 10. FIX-BUG17 — el Balance desglosa los CUATRO métodos de pago (RN-57)
// ---------------------------------------------------------------------------

describe('FIX-BUG17 — criterio 10: el Balance muestra la Transferencia', () => {
  it('pinta la fila de Transferencia con su monto', async () => {
    const servicio = servicioCaja(
      resumenTurno({
        total_credito: '100.00',
        total_debito: '50.00',
        total_transferencia: '75.00',
        total_ventas: '225.00',
      })
    );
    await montarConTurnoAbierto(servicio);

    const fila = screen.getByTestId('desglose-transferencia');
    expect(fila.textContent).toContain('75');
    // La etiqueta visible nombra el método.
    expect(screen.getByText(/Transferencia/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 11. FIX-BUG17 — los movimientos se agrupan por tipo (Entradas / Salidas)
// ---------------------------------------------------------------------------

describe('FIX-BUG17 — criterio 11: movimientos agrupados por tipo', () => {
  it('separa las entradas de las salidas en dos grupos', async () => {
    const servicio = servicioCaja(
      resumenTurno({
        movimientos: [
          { id: 'm1', tipo: 'ENTRADA', monto: '100.00', motivo: 'Cambio', creado_en: '2026-01-01T10:00:00Z' },
          { id: 'm2', tipo: 'SALIDA', monto: '30.00', motivo: 'Compra', creado_en: '2026-01-01T10:05:00Z' },
          { id: 'm3', tipo: 'ENTRADA', monto: '20.00', motivo: 'Propina', creado_en: '2026-01-01T10:10:00Z' },
        ],
      })
    );
    await montarConTurnoAbierto(servicio);

    const entradas = screen.getByTestId('grupo-entradas');
    const salidas = screen.getByTestId('grupo-salidas');

    // Cada grupo contiene SOLO los movimientos de su tipo.
    expect(entradas.textContent).toContain('Cambio');
    expect(entradas.textContent).toContain('Propina');
    expect(entradas.textContent).not.toContain('Compra');
    expect(salidas.textContent).toContain('Compra');
    expect(salidas.textContent).not.toContain('Cambio');

    // El grupo de Entradas aparece ANTES que el de Salidas en el DOM.
    const relacion = entradas.compareDocumentPosition(salidas);
    expect(relacion & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 12. FIX-BUG17 — el campo Motivo sugiere los motivos más usados/recientes
// ---------------------------------------------------------------------------

describe('FIX-BUG17 — criterio 12: sugerencias de motivo', () => {
  it('sugiere los motivos más frecuentes al enfocar el campo', async () => {
    const servicio = servicioCaja(
      resumenTurno({
        movimientos: [
          { id: 'm1', tipo: 'ENTRADA', monto: '100.00', motivo: 'Cambio', creado_en: '2026-01-01T10:00:00Z' },
          { id: 'm2', tipo: 'ENTRADA', monto: '20.00', motivo: 'Cambio', creado_en: '2026-01-01T10:05:00Z' },
          { id: 'm3', tipo: 'ENTRADA', monto: '15.00', motivo: 'Propina', creado_en: '2026-01-01T10:07:00Z' },
          { id: 'm4', tipo: 'SALIDA', monto: '30.00', motivo: 'Compra', creado_en: '2026-01-01T10:10:00Z' },
        ],
      })
    );
    await montarConTurnoAbierto(servicio);

    // FIX-BUG17 (feedback #3): las sugerencias se filtran por el tipo activo.
    // El toggle arranca en SALIDA; se conmuta a ENTRADA para probar el orden
    // por frecuencia DENTRO de un tipo.
    fireEvent.click(screen.getByRole('button', { name: 'Entrada' }));

    // Antes de enfocar el campo no hay sugerencias visibles.
    expect(screen.queryByTestId('sugerencias-motivo')).toBeNull();

    fireEvent.focus(screen.getByTestId('campo-motivoMov'));

    const panel = screen.getByTestId('sugerencias-motivo');
    const chips = Array.from(panel.querySelectorAll('button'));
    // El motivo más frecuente de ENTRADA ("Cambio", 2 veces) va primero.
    expect(chips[0].textContent).toBe('Cambio');

    // Al pulsar una sugerencia, el campo Motivo adopta ese valor.
    fireEvent.click(chips[0]);
    expect(screen.getByTestId('campo-motivoMov').value).toBe('Cambio');
  });
});

// ---------------------------------------------------------------------------
// 13. FIX-BUG17 (feedback #3) — las sugerencias se SEGREGAN por tipo
// ---------------------------------------------------------------------------

describe('FIX-BUG17 — criterio 13: sugerencias de motivo filtradas por tipo', () => {
  it('sugiere solo motivos del tipo activo (ENTRADA vs SALIDA)', async () => {
    const servicio = servicioCaja(
      resumenTurno({
        movimientos: [
          { id: 'm1', tipo: 'ENTRADA', monto: '100.00', motivo: 'Cambio', creado_en: '2026-01-01T10:00:00Z' },
          { id: 'm2', tipo: 'ENTRADA', monto: '20.00', motivo: 'Propina', creado_en: '2026-01-01T10:05:00Z' },
          { id: 'm3', tipo: 'SALIDA', monto: '30.00', motivo: 'Compra de insumos', creado_en: '2026-01-01T10:10:00Z' },
          { id: 'm4', tipo: 'SALIDA', monto: '10.00', motivo: 'Retiro', creado_en: '2026-01-01T10:15:00Z' },
        ],
      })
    );
    await montarConTurnoAbierto(servicio);

    // El toggle arranca en SALIDA: las sugerencias son de SALIDA, no de ENTRADA.
    fireEvent.focus(screen.getByTestId('campo-motivoMov'));
    let chips = Array.from(
      screen.getByTestId('sugerencias-motivo').querySelectorAll('button'),
    ).map((b) => b.textContent);
    expect(chips).toContain('Compra de insumos');
    expect(chips).toContain('Retiro');
    expect(chips).not.toContain('Cambio');
    expect(chips).not.toContain('Propina');

    // Al conmutar a ENTRADA, las sugerencias cambian a las de ENTRADA.
    fireEvent.click(screen.getByRole('button', { name: 'Entrada' }));
    chips = Array.from(
      screen.getByTestId('sugerencias-motivo').querySelectorAll('button'),
    ).map((b) => b.textContent);
    expect(chips).toContain('Cambio');
    expect(chips).toContain('Propina');
    expect(chips).not.toContain('Compra de insumos');
    expect(chips).not.toContain('Retiro');
  });
});

// ---------------------------------------------------------------------------
// 14. FIX-BUG17 (feedback #3) — borrar un movimiento pide confirmación
// ---------------------------------------------------------------------------

describe('FIX-BUG17 — criterio 14: modal de advertencia al borrar', () => {
  it('el ✕ abre un modal y solo borra al confirmar', async () => {
    const servicio = servicioCaja(
      resumenTurno({
        movimientos: [
          {
            movement_id: 'mov-9',
            tipo: 'SALIDA',
            monto: '30.00',
            motivo: 'Compra',
            creado_en: '2026-01-01T10:05:00Z',
          },
        ],
      })
    );
    servicio.eliminarMovimiento = vi.fn(async () => ({
      outcome: 'ok',
      reason: null,
      data: {},
    }));
    await montarConTurnoAbierto(servicio);

    // Antes de pulsar ✕ no hay modal ni llamada al backend.
    expect(screen.queryByTestId('confirmar-eliminar-movimiento')).toBeNull();
    expect(servicio.eliminarMovimiento).not.toHaveBeenCalled();

    // El ✕ abre el modal de advertencia (NO borra directo).
    fireEvent.click(screen.getByTestId('eliminar-movimiento-0'));
    const modal = screen.getByTestId('confirmar-eliminar-movimiento');
    expect(modal.textContent).toContain('Compra');
    expect(servicio.eliminarMovimiento).not.toHaveBeenCalled();

    // Cancelar cierra el modal sin tocar el backend.
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByTestId('confirmar-eliminar-movimiento')).toBeNull();
    expect(servicio.eliminarMovimiento).not.toHaveBeenCalled();

    // Reabrir y confirmar SÍ borra el movimiento correcto.
    fireEvent.click(screen.getByTestId('eliminar-movimiento-0'));
    fireEvent.click(screen.getByTestId('confirmar-eliminar-movimiento-si'));
    await waitFor(() => {
      expect(servicio.eliminarMovimiento).toHaveBeenCalledWith('mov-9');
    });
  });
});
