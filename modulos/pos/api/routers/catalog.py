"""Router de catálogo — cierre de brechas GP→POS (22-Oct-2026).

Materializa el Contrato 1 (`catalogo.productos_para_venta`):

    GET /catalog/products-for-sale?channel=PANADERIA&include_hidden=false

Garantías del contrato:
  - Es una PROYECCIÓN: solo lo que la pantalla necesita.
  - Solo productos VISIBLES (active=True, available=True) salvo include_hidden.
  - Solo categorías habilitadas para el canal (pos_target / vision_enabled).
  - El precio viene RESUELTO (Decimal, C-03).
  - El orden de categorías y productos respeta el campo `position` del GP.
  - Las variantes activas vienen incrustadas en cada producto (NC-GP-02).
  - 400 si el canal es inválido.

Brechas cerradas (22-Oct-2026):
  - Categorías: filtro por pos_target (canal) y vision_enabled.
  - Categorías: orden por position del GP.
  - Productos: filtro por available (NC-GP-07).
  - Productos: orden por position del GP antes que el nombre.
  - Productos: se exponen available, unit_of_sale y variants.

Nota sobre variantes (NC-GP-02):
  FASE 2.3b: `product_variants.product_id` es UUID, igual que `products.id`
  (ADR-GP-04 / REGLA 15). Se carga una sola query con todas las variantes
  activas y se construye un dict {product_id_uuid: [variantes]} para inyectar
  en la respuesta. Sin variantes, la lista queda vacía (compatibilidad).
"""

from __future__ import annotations

import uuid
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models import Category, Product
from models.gestion_productos import ProductVariant
from schemas.catalog import (
    CatalogoParaVenta,
    CategoriaParaVenta,
    ProductoParaVenta,
    VarianteParaVenta,
)

router = APIRouter(prefix="/catalog", tags=["catálogo"])

CANALES_VALIDOS: frozenset[str] = frozenset({"PANADERIA", "HELADERIA"})


@router.get("/products-for-sale", response_model=CatalogoParaVenta)
async def products_for_sale(
    channel: str = Query(default="PANADERIA", description="Canal del POS (RN-13)"),
    include_hidden: bool = Query(default=False, description="Incluir productos inactivos"),
    db: AsyncSession = Depends(get_db),
) -> CatalogoParaVenta:
    """
    Devuelve el catálogo visible del canal: {productos, categorias}.

    El orden de categorías y productos refleja exactamente lo configurado
    en el módulo Gestión de Productos (campo `position`).
    """
    canal = (channel or "PANADERIA").upper()
    if canal not in CANALES_VALIDOS:
        raise HTTPException(
            status_code=400,
            detail=f"Canal inválido: {channel}. Válidos: {sorted(CANALES_VALIDOS)}",
        )

    # ── Categorías ─────────────────────────────────────────────────────────
    # Filtro: vision_enabled=True + pos_target coincide con canal o es "AMBOS".
    # Orden: position ASC del GP (nulls al final), luego name como desempate.
    cat_query = (
        select(Category)
        .where(Category.vision_enabled.is_(True))
        .where(Category.pos_target.in_([canal, "AMBOS"]))
        .order_by(Category.position.nulls_last(), Category.name)
    )
    categorias_rows = (await db.execute(cat_query)).scalars().all()

    # ── Productos ──────────────────────────────────────────────────────────
    # Filtro: active=True + available=True (NC-GP-07) salvo include_hidden.
    # Orden: position ASC del GP (nulls al final), luego name.
    prod_query = (
        select(Product)
        .order_by(Product.position.nulls_last(), Product.name)
    )
    if not include_hidden:
        prod_query = prod_query.where(
            Product.active.is_(True),
            Product.available.is_(True),  # NC-GP-07: disponibilidad temporal
        )
    productos_rows = (await db.execute(prod_query)).scalars().all()

    # ── Variantes (NC-GP-02) ──────────────────────────────────────────────
    # FASE 2.3b: `product_variants.product_id` es UUID, igual que `products.id`
    # (ADR-GP-04 / REGLA 15). Cargamos TODAS las variantes activas en una sola
    # query y construimos un índice {product_id_uuid: [variantes]}.
    variantes_map: dict[uuid.UUID, list[ProductVariant]] = defaultdict(list)
    if productos_rows:
        variantes_result = await db.execute(
            select(ProductVariant)
            .where(ProductVariant.active.is_(True))
            .order_by(ProductVariant.product_id, ProductVariant.sort_order)
        )
        for v in variantes_result.scalars().all():
            variantes_map[v.product_id].append(v)

    # ── Construcción de la respuesta ──────────────────────────────────────
    def _build_producto(p: Product) -> ProductoParaVenta:
        variants_list: list[VarianteParaVenta] = [
            VarianteParaVenta(
                id=v.id,
                variant_name=v.variant_name,
                price_modifier=v.price_modifier,
                is_default=v.is_default,
                sort_order=v.sort_order,
            )
            for v in variantes_map.get(p.id, [])
        ]

        return ProductoParaVenta(
            id=p.id,
            sku=p.sku,
            barcode=p.barcode,
            name=p.name,
            price=p.price,
            image_url=p.image_url,
            category_id=p.category_id,
            nature=p.nature,
            available=p.available,
            unit_of_sale=p.unit_of_sale,
            variants=variants_list,
        )

    return CatalogoParaVenta(
        productos=[_build_producto(p) for p in productos_rows],
        categorias=[CategoriaParaVenta.model_validate(c) for c in categorias_rows],
    )
