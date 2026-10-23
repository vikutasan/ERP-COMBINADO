/**
 * Puerta de FASE 6.3 — Carta PDF con selector de categorías (Entregable B).
 *
 * @paridad: components/CatalogoPDF.f6_3.test.jsx
 * @operacion: La generación del ticket imprimible (carta PDF con selector de categorías)
 *
 * Verifica los 10 criterios del plan v2.1 §9.4:
 *   1. `generarCatalogoPDF` devuelve `{outcome:'ok'}` con categorías válidas.
 *   2. El PDF incluye el nombre del negocio y la fecha.
 *   3. Cada categoría seleccionada aparece con su nombre.
 *   4. Cada producto aparece con su nombre y su precio.
 *   5. Una categoría sin productos NO rompe la generación.
 *   6. `generarCatalogoPDF([])` devuelve `{outcome:'error', reason}`.
 *   7. El modal lista todas las categorías con checkbox.
 *   8. El botón "📄 Exportar PDF" existe en CategoryBar y dispara el modal.
 *   9. El botón respeta R-03 (paleta) y R-04 (target táctil).
 *  10. CategoryBar sigue funcionando con sus props originales.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  generarCatalogoPDF,
  normalizarCategorias,
  formatearPrecio,
  NOMBRE_NEGOCIO,
} from './CatalogoPDF.jsx';
import SelectorCategoriasPDF from './SelectorCategoriasPDF.jsx';
import CategoryBar from './CategoryBar.jsx';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FUENTE_CATALOGO = readFileSync(resolve(AQUI, 'CatalogoPDF.jsx'), 'utf8');
const FUENTE_SELECTOR = readFileSync(resolve(AQUI, 'SelectorCategoriasPDF.jsx'), 'utf8');
const FUENTE_CATEGORY_BAR = readFileSync(resolve(AQUI, 'CategoryBar.jsx'), 'utf8');

const CATEGORIAS = [
  { id: 'cat-pan', name: 'Panadería' },
  { id: 'cat-hel', name: 'Heladería' },
];

const PRODUCTOS = [
  { id: 'p1', name: 'Concha', price: 12.5, category_id: 'cat-pan' },
  { id: 'p2', name: 'Bolillo', price: 3, category_id: 'cat-pan' },
  { id: 'p3', name: 'Nieve de limón', price: 35, category_id: 'cat-hel' },
];

describe('F6.3 — Carta PDF con selector de categorías', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('criterio 1: generarCatalogoPDF devuelve outcome ok', () => {
    const r = generarCatalogoPDF(CATEGORIAS, PRODUCTOS);
    expect(r.outcome).toBe('ok');
    expect(r.data.doc).toBeTruthy();
    expect(r.data.paginas).toBeGreaterThanOrEqual(1);
  });

  it('criterio 2: el PDF incluye el nombre del negocio y la fecha', () => {
    const r = generarCatalogoPDF(CATEGORIAS, PRODUCTOS);
    expect(NOMBRE_NEGOCIO).toBe('R de Rico');
    // El encabezado dibuja el nombre del negocio y la fecha formateada.
    expect(FUENTE_CATALOGO).toMatch(/NOMBRE_NEGOCIO/);
    expect(FUENTE_CATALOGO).toMatch(/formatearFecha\s*\(/);
    expect(typeof r.data.doc.text).toBe('function');
  });

  it('criterio 3: cada categoría seleccionada aparece con su nombre', () => {
    const normalizadas = normalizarCategorias(CATEGORIAS, PRODUCTOS);
    expect(normalizadas).toHaveLength(2);
    expect(normalizadas[0].name).toBe('Panadería');
    expect(normalizadas[1].name).toBe('Heladería');
    // El generador dibuja el nombre de cada categoría en mayúsculas.
    expect(FUENTE_CATALOGO).toMatch(/dibujarTituloCategoria/);
    expect(FUENTE_CATALOGO).toMatch(/toUpperCase/);
  });

  it('criterio 4: cada producto aparece con su nombre y su precio', () => {
    const normalizadas = normalizarCategorias(CATEGORIAS, PRODUCTOS);
    expect(normalizadas[0].productos).toHaveLength(2);
    expect(normalizadas[0].productos[0].name).toBe('Concha');
    expect(normalizadas[0].productos[0].price).toBe(12.5);
    expect(formatearPrecio(12.5)).toContain('12.50');
    expect(FUENTE_CATALOGO).toMatch(/dibujarProducto/);
    expect(FUENTE_CATALOGO).toMatch(/formatearPrecio/);
  });

  it('criterio 5: una categoría sin productos no rompe la generación', () => {
    const vacia = [{ id: 'cat-vacia', name: 'Sin productos' }];
    const r = generarCatalogoPDF(vacia, []);
    expect(r.outcome).toBe('ok');
    expect(r.data.paginas).toBeGreaterThanOrEqual(1);
  });

  it('criterio 6: generarCatalogoPDF([]) devuelve error con reason', () => {
    const r = generarCatalogoPDF([], []);
    expect(r.outcome).toBe('error');
    expect(r.reason).toBe('sin_categorias');
  });

  it('criterio 7: el modal lista todas las categorías con checkbox', () => {
    render(
      <SelectorCategoriasPDF
        categorias={CATEGORIAS}
        onExportar={vi.fn()}
        onCerrar={vi.fn()}
      />,
    );
    const casillas = screen.getAllByRole('checkbox');
    expect(casillas).toHaveLength(2);
    expect(screen.getByLabelText('Panadería')).toBeTruthy();
    expect(screen.getByLabelText('Heladería')).toBeTruthy();
    // Todas vienen marcadas por defecto.
    casillas.forEach((c) => expect(c.checked).toBe(true));
  });

  it('criterio 8: el botón Exportar PDF existe en CategoryBar y dispara el modal', () => {
    const onExportarPDF = vi.fn();
    render(
      <CategoryBar
        categorias={CATEGORIAS}
        categoriaActiva={null}
        onSeleccionar={vi.fn()}
        onExportarPDF={onExportarPDF}
      />,
    );
    const boton = screen.getByLabelText('Exportar carta a PDF');
    expect(boton).toBeTruthy();
    fireEvent.click(boton);
    expect(onExportarPDF).toHaveBeenCalledTimes(1);
  });

  it('criterio 9: el botón respeta R-03 (paleta) y R-04 (target táctil)', () => {
    expect(FUENTE_CATEGORY_BAR).toMatch(/min-h-tactil/);
    expect(FUENTE_CATEGORY_BAR).toMatch(/bg-white\/5/);
    expect(FUENTE_CATEGORY_BAR).toMatch(/text-crema-ticket/);
    // El selector también respeta la paleta y el target táctil.
    expect(FUENTE_SELECTOR).toMatch(/min-h-tactil/);
    expect(FUENTE_SELECTOR).toMatch(/bg-acento/);
    expect(FUENTE_SELECTOR).toMatch(/bg-superficie/);
    // Ninguno declara anchos fijos en px (R-01).
    expect(FUENTE_CATEGORY_BAR).not.toMatch(/(?<!max-)(?<!min-)\bw-\[\d+px\]/);
    expect(FUENTE_SELECTOR).not.toMatch(/(?<!max-)(?<!min-)\bw-\[\d+px\]/);
  });

  it('criterio 10: CategoryBar sigue funcionando con sus props originales', () => {
    const onSeleccionar = vi.fn();
    render(
      <CategoryBar
        categorias={CATEGORIAS}
        categoriaActiva="cat-pan"
        onSeleccionar={onSeleccionar}
      />,
    );
    // Sin `onExportarPDF` el botón NO aparece (retrocompatible).
    expect(screen.queryByLabelText('Exportar carta a PDF')).toBeNull();
    // Los tabs originales siguen ahí y responden.
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(3); // Escáner IA + 2 categorías
    fireEvent.click(screen.getByRole('tab', { name: /Heladería/i }));
    expect(onSeleccionar).toHaveBeenCalledWith('cat-hel');
  });
});
