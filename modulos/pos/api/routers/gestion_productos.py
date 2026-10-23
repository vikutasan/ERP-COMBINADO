"""
gestion_productos.py -- Router del modulo Gestion de Productos (NUEVO ERP)

Endpoints:

NC-GP-01 (Historial de precios):
  GET  /catalog/products/{id}/price-history  -- Ledger inmutable de precios

NC-GP-05 (Tags transversales):
  GET    /catalog/tags                        -- Lista todos los tags del catalogo
  POST   /catalog/tags                        -- Crea un nuevo tag
  DELETE /catalog/tags/{tag_id}               -- Elimina un tag (y sus asignaciones)
  GET    /catalog/products/{id}/tags          -- Tags de un producto
  PUT    /catalog/products/{id}/tags          -- Reemplaza todos los tags de un producto

NC-GP-02 (Variantes de producto):
  GET    /catalog/products/{id}/variants      -- Variantes de un producto
  POST   /catalog/products/{id}/variants      -- Crea una nueva variante
  PUT    /catalog/products/{id}/variants/{vid}-- Actualiza una variante
  DELETE /catalog/products/{id}/variants/{vid}-- Elimina una variante

RT-02: price_modifier y precios son Numeric -> str en JSON.
RT-03: IDs de tags y variantes son UUID.
RT-04: El historial de precios es append-only (solo lectura aqui).
RT-01: changed_at en ISO-8601 UTC.

ADAPTACION ERP COMBINADO (FASE 2.3b):
  `product_id` es UUID en todo el modulo, porque `products.id` es UUID en el
  ERP COMBINADO (ADR-GP-04 / REGLA 15). En el NUEVO-ERP original era INTEGER.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select, desc, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.gestion_productos import ProductPriceHistory, ProductTag, product_tag_map, ProductVariant

router = APIRouter(prefix="/catalog", tags=["gestion-productos"])


# ===========================================================================
# NC-GP-01 — Historial de precios (ledger inmutable)
# ===========================================================================

@router.get(
    "/products/{product_id}/price-history",
    response_model=list[dict],
    summary="Historial de precios de un producto (NC-GP-01)",
)
async def get_price_history(
    product_id: uuid.UUID,
    limit: int = Query(default=100, le=500),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """RT-04: Ledger inmutable. Solo lectura — los eventos no se editan ni se borran."""
    result = await db.execute(
        select(ProductPriceHistory)
        .where(ProductPriceHistory.product_id == product_id)
        .order_by(desc(ProductPriceHistory.changed_at))
        .limit(limit)
    )
    entries = result.scalars().all()
    return [
        {
            "id":         e.id,
            "product_id": str(e.product_id),
            "price":      str(e.price),   # RT-02: Decimal -> str
            "cost":       str(e.cost) if e.cost is not None else None,
            "changed_at": e.changed_at.isoformat(),  # RT-01: ISO-8601 UTC
            "changed_by": e.changed_by,
            "reason":     e.reason,
        }
        for e in entries
    ]


# ===========================================================================
# NC-GP-05 — Tags transversales (CRUD del catalogo de tags)
# ===========================================================================

@router.get(
    "/tags",
    response_model=list[dict],
    summary="Lista todos los tags del catalogo (NC-GP-05)",
)
async def list_tags(db: AsyncSession = Depends(get_db)) -> list[dict]:
    """Devuelve todos los tags disponibles en el catalogo, ordenados por nombre."""
    result = await db.execute(select(ProductTag).order_by(ProductTag.name))
    tags = result.scalars().all()
    return [{"id": str(t.id), "name": t.name, "color": t.color} for t in tags]


@router.post(
    "/tags",
    response_model=dict,
    status_code=201,
    summary="Crea un nuevo tag (NC-GP-05)",
)
async def create_tag(
    payload: dict,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Crea un tag nuevo. El nombre debe ser unico (slug sin espacios, ej: 'sin-gluten').
    Si el tag ya existe, retorna 409.
    """
    name = (payload.get("name") or "").strip().lower()
    color = payload.get("color")
    if not name:
        raise HTTPException(status_code=400, detail="El campo 'name' es obligatorio.")

    # Verificar unicidad
    existing = (await db.execute(
        select(ProductTag).where(ProductTag.name == name)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail=f"El tag '{name}' ya existe.")

    tag = ProductTag(id=uuid.uuid4(), name=name, color=color)
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return {"id": str(tag.id), "name": tag.name, "color": tag.color}


@router.delete(
    "/tags/{tag_id}",
    status_code=204,
    response_model=None,
    summary="Elimina un tag del catalogo (NC-GP-05)",
)
async def delete_tag(tag_id: str, db: AsyncSession = Depends(get_db)) -> None:
    """
    Elimina un tag. ON DELETE CASCADE en product_tag_map limpia las asignaciones.
    Retorna 404 si el tag no existe.
    """
    try:
        uid = uuid.UUID(tag_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="tag_id no es un UUID valido.")

    tag = (await db.execute(
        select(ProductTag).where(ProductTag.id == uid)
    )).scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail=f"Tag '{tag_id}' no encontrado.")

    await db.delete(tag)
    await db.commit()


# ===========================================================================
# NC-GP-05 — Asignacion de tags a productos
# ===========================================================================

@router.get(
    "/products/{product_id}/tags",
    response_model=list[dict],
    summary="Tags asignados a un producto (NC-GP-05)",
)
async def get_product_tags(product_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> list[dict]:
    """Devuelve los tags actualmente asignados al producto."""
    result = await db.execute(
        select(ProductTag)
        .join(product_tag_map, ProductTag.id == product_tag_map.c.tag_id)
        .where(product_tag_map.c.product_id == product_id)
        .order_by(ProductTag.name)
    )
    tags = result.scalars().all()
    return [{"id": str(t.id), "name": t.name, "color": t.color} for t in tags]


@router.put(
    "/products/{product_id}/tags",
    response_model=list[dict],
    summary="Reemplaza todos los tags de un producto (NC-GP-05)",
)
async def update_product_tags(
    product_id: uuid.UUID,
    payload: dict,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """
    Semantica replace-all: elimina todas las asignaciones actuales y asigna
    los tags de la lista enviada. Si un nombre de tag no existe, lo crea.

    Body: { "tag_names": ["sin-gluten", "vegano"] }
    """
    tag_names: list[str] = [
        n.strip().lower() for n in (payload.get("tag_names") or []) if n.strip()
    ]

    # Eliminar todas las asignaciones actuales
    await db.execute(
        delete(product_tag_map).where(product_tag_map.c.product_id == product_id)
    )

    assigned: list[ProductTag] = []
    for name in tag_names:
        # Buscar o crear el tag
        tag = (await db.execute(
            select(ProductTag).where(ProductTag.name == name)
        )).scalar_one_or_none()
        if not tag:
            tag = ProductTag(id=uuid.uuid4(), name=name)
            db.add(tag)
            await db.flush()  # Para obtener el id antes del commit

        # Insertar en la tabla puente
        await db.execute(
            product_tag_map.insert().values(product_id=product_id, tag_id=tag.id)
        )
        assigned.append(tag)

    await db.commit()
    return [{"id": str(t.id), "name": t.name, "color": t.color} for t in assigned]


# ===========================================================================
# NC-GP-02 -- Variantes de producto
# ===========================================================================

def _variant_to_dict(v: ProductVariant) -> dict:
    return {
        "id":             str(v.id),
        "product_id":     str(v.product_id),
        "variant_name":   v.variant_name,
        "price_modifier": str(v.price_modifier),  # RT-02: Decimal -> str
        "is_default":     v.is_default,
        "sort_order":     v.sort_order,
        "active":         v.active,
    }


@router.get("/products/{product_id}/variants", response_model=list[dict], summary="Variantes (NC-GP-02)")
async def get_variants(product_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> list[dict]:
    result = await db.execute(
        select(ProductVariant)
        .where(ProductVariant.product_id == product_id)
        .order_by(ProductVariant.sort_order, ProductVariant.variant_name)
    )
    return [_variant_to_dict(v) for v in result.scalars().all()]


@router.post("/products/{product_id}/variants", response_model=dict, status_code=201, summary="Crear variante (NC-GP-02)")
async def create_variant(product_id: uuid.UUID, payload: dict, db: AsyncSession = Depends(get_db)) -> dict:
    name = (payload.get("variant_name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="'variant_name' es obligatorio.")
    if payload.get("is_default"):
        await db.execute(sa_update(ProductVariant).where(ProductVariant.product_id == product_id).values(is_default=False))
    variant = ProductVariant(
        id=uuid.uuid4(), product_id=product_id, variant_name=name,
        price_modifier=payload.get("price_modifier", 0),
        is_default=bool(payload.get("is_default", False)),
        sort_order=int(payload.get("sort_order", 0)),
        active=bool(payload.get("active", True)),
    )
    db.add(variant)
    await db.commit()
    await db.refresh(variant)
    return _variant_to_dict(variant)


@router.put("/products/{product_id}/variants/{variant_id}", response_model=dict, summary="Actualizar variante (NC-GP-02)")
async def update_variant(product_id: uuid.UUID, variant_id: str, payload: dict, db: AsyncSession = Depends(get_db)) -> dict:
    try:
        vid = uuid.UUID(variant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="variant_id no es UUID valido.")
    variant = (await db.execute(select(ProductVariant).where(ProductVariant.id == vid, ProductVariant.product_id == product_id))).scalar_one_or_none()
    if not variant:
        raise HTTPException(status_code=404, detail="Variante no encontrada.")
    if payload.get("is_default") and not variant.is_default:
        await db.execute(sa_update(ProductVariant).where(ProductVariant.product_id == product_id, ProductVariant.id != vid).values(is_default=False))
    for field in ("variant_name", "price_modifier", "is_default", "sort_order", "active"):
        if field in payload and payload[field] is not None:
            setattr(variant, field, payload[field])
    await db.commit()
    await db.refresh(variant)
    return _variant_to_dict(variant)


@router.delete("/products/{product_id}/variants/{variant_id}", status_code=204, response_model=None, summary="Eliminar variante (NC-GP-02)")
async def delete_variant(product_id: uuid.UUID, variant_id: str, db: AsyncSession = Depends(get_db)) -> None:
    try:
        vid = uuid.UUID(variant_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="variant_id no es UUID valido.")
    variant = (await db.execute(select(ProductVariant).where(ProductVariant.id == vid, ProductVariant.product_id == product_id))).scalar_one_or_none()
    if not variant:
        raise HTTPException(status_code=404, detail="Variante no encontrada.")
    await db.delete(variant)
    await db.commit()
