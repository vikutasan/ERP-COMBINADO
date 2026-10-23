"""Semilla de datos de prueba — P1.3 del PLAN_DE_PRUEBA_EN_PARALELO_DEL_NUEVO_POS.

Siembra un catálogo mínimo y una sesión de terminal abierta para poder probar
el POS nuevo en paralelo, SIN tocar el ERP ni su base de datos.

Reglas que respeta:
  - C-01  PK UUID (uuid.uuid4)
  - C-02  timestamps UTC con timezone=True
  - C-03  dinero en Numeric(12,2), nunca Float
  - Idempotente: si ya existe el SKU o el nombre, no lo duplica.

Uso (dentro del contenedor `api`):
    docker compose exec api python scripts/seed_demo.py
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from decimal import Decimal
from pathlib import Path

# El proyecto usa imports absolutos de paquetes de primer nivel (`core`, `models`).
# Al correr `python scripts/seed_demo.py`, Python pone `scripts/` en sys.path, no
# la raíz `/app`. Añadimos la raíz para que los imports absolutos resuelvan,
# igual que hace pytest con su rootdir.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from core.database import AsyncSessionLocal  # noqa: E402
from models import Category, Product, TerminalSession  # noqa: E402

# ---------------------------------------------------------------------------
# Catálogo de prueba. Precios en Decimal (C-03). pos_target PANADERIA por
# defecto (coincide con el default del modelo).
# ---------------------------------------------------------------------------
CATEGORIAS: list[dict] = [
    {"name": "Panes", "icon": "🍞", "position": 0},
    {"name": "Bollería", "icon": "🥐", "position": 1},
    {"name": "Bebidas", "icon": "🥤", "position": 2},
]

PRODUCTOS: list[dict] = [
    # (sku, barcode, nombre, precio, costo, categoría)
    ("PAN-001", "7501000000011", "Bolillo", Decimal("3.50"), Decimal("1.20"), "Panes"),
    ("PAN-002", "7501000000028", "Telera", Decimal("4.00"), Decimal("1.40"), "Panes"),
    ("PAN-003", "7501000000035", "Concha de vainilla", Decimal("8.00"), Decimal("2.80"), "Bollería"),
    ("PAN-004", "7501000000042", "Cuernito", Decimal("9.50"), Decimal("3.10"), "Bollería"),
    ("BEB-001", "7501000000059", "Café americano", Decimal("18.00"), Decimal("5.00"), "Bebidas"),
    ("BEB-002", "7501000000066", "Agua 600ml", Decimal("12.00"), Decimal("6.50"), "Bebidas"),
]

TERMINAL_ID = "TERM-01"


async def _sembrar_categorias(session) -> dict[str, uuid.UUID]:
    """Crea las categorías que falten. Devuelve {nombre: id}."""
    existentes = (await session.execute(select(Category))).scalars().all()
    por_nombre = {c.name: c.id for c in existentes}

    for datos in CATEGORIAS:
        if datos["name"] in por_nombre:
            continue
        cat = Category(id=uuid.uuid4(), **datos)
        session.add(cat)
        await session.flush()
        por_nombre[datos["name"]] = cat.id
        print(f"  + categoría: {datos['name']}")

    return por_nombre


async def _sembrar_productos(session, categorias: dict[str, uuid.UUID]) -> int:
    """Crea los productos que falten (por SKU). Devuelve cuántos creó."""
    existentes = (await session.execute(select(Product.sku))).scalars().all()
    skus = set(existentes)
    creados = 0

    for sku, barcode, nombre, precio, costo, cat_nombre in PRODUCTOS:
        if sku in skus:
            continue
        prod = Product(
            id=uuid.uuid4(),
            sku=sku,
            barcode=barcode,
            name=nombre,
            price=precio,
            cost=costo,
            category_id=categorias.get(cat_nombre),
            nature="MANUFACTURADO",
            active=True,
        )
        session.add(prod)
        creados += 1
        print(f"  + producto: {sku} — {nombre} (${precio})")

    return creados


async def _sembrar_sesion(session) -> bool:
    """Abre una sesión de terminal si no hay ninguna activa. Devuelve si creó."""
    activa = (
        await session.execute(
            select(TerminalSession).where(
                TerminalSession.terminal_id == TERMINAL_ID,
                TerminalSession.is_active.is_(True),
            )
        )
    ).scalars().first()

    if activa is not None:
        print(f"  = sesión ya activa en {TERMINAL_ID} (id={activa.id})")
        return False

    sesion = TerminalSession(id=uuid.uuid4(), terminal_id=TERMINAL_ID, is_active=True)
    session.add(sesion)
    await session.flush()
    print(f"  + sesión abierta en {TERMINAL_ID} (id={sesion.id})")
    return True


async def main() -> None:
    print("Sembrando datos de prueba del POS nuevo (BD aislada `nuevo_pos`)…")
    async with AsyncSessionLocal() as session:
        categorias = await _sembrar_categorias(session)
        creados = await _sembrar_productos(session, categorias)
        await _sembrar_sesion(session)
        await session.commit()

    print(f"Listo. Productos nuevos: {creados}. Categorías: {len(categorias)}.")


if __name__ == "__main__":
    asyncio.run(main())
