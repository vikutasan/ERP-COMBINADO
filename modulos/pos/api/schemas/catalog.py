"""Esquemas del catálogo — Contrato 1: GET /catalog/products-for-sale.

Brechas cerradas (22-Oct-2026):
  - CategoriaParaVenta: expone pos_target para que el frontend filtre si necesita.
  - ProductoParaVenta: expone available (NC-GP-07) y unit_of_sale (NC-GP-04).
  - ProductoParaVenta: expone variants (NC-GP-02) como sublista para que el POS
    muestre el selector de variante al agregar al carrito.
  - VarianteParaVenta: proyección mínima de una variante (name, price_modifier).
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CategoriaParaVenta(BaseModel):
    """Una categoría tal como la ve el POS (proyección, no la fila completa)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    icon: str | None = None
    position: int | None = None
    pos_target: str = "PANADERIA"   # expuesto para que el POS pueda confirmar el canal


class VarianteParaVenta(BaseModel):
    """
    Una variante de producto tal como la ve el POS (NC-GP-02).

    El POS muestra la lista de variantes al agregar al carrito.
    price_modifier es el delta sobre Product.price (RT-02: Decimal).
    Precio final = products.price + price_modifier.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    variant_name: str
    price_modifier: Decimal  # RT-02: Decimal, nunca float
    is_default: bool = False
    sort_order: int = 0
    active: bool = True


class ProductoParaVenta(BaseModel):
    """
    Un producto tal como lo ve el POS.

    Proyección del contrato 1: solo lo que la pantalla necesita.
    El precio ya viene resuelto (RN-18 lo congela al agregarlo a la línea).

    Campos agregados en cierre de brechas GP→POS (22-Oct-2026):
      - available: el POS solo muestra productos con available=True (NC-GP-07)
      - unit_of_sale: para que el POS muestre la unidad junto al precio (NC-GP-04)
      - variants: sublista de variantes para el selector del carrito (NC-GP-02)
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    sku: str
    barcode: str | None = None
    name: str
    price: Decimal          # RT-02: Decimal
    image_url: str | None = None
    category_id: UUID | None = None
    nature: str = "MANUFACTURADO"
    available: bool = True          # NC-GP-07: disponibilidad temporal
    unit_of_sale: str = "PZA"       # NC-GP-04: unidad de venta
    variants: list[VarianteParaVenta] = []  # NC-GP-02: vacío = sin variantes (compat.)


class CatalogoParaVenta(BaseModel):
    """Salida del contrato 1: `{productos, categorias}`."""

    productos: list[ProductoParaVenta]
    categorias: list[CategoriaParaVenta]
