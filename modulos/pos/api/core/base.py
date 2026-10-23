"""Base declarativa de SQLAlchemy — FASE 1.

Todos los modelos heredan de `Base`. Aquí se centralizan las convenciones de
nombres de índices y llaves foráneas para que el esquema sea predecible y las
migraciones de Alembic no generen nombres aleatorios.

Convención de nombres (importante para Alembic):
  - PK  → pk_<tabla>
  - FK  → fk_<tabla>_<columna>_<tabla_referenciada>
  - UQ  → uq_<tabla>_<columna>
  - IX  → ix_<tabla>_<columna>
  - CK  → ck_<tabla>_<nombre>
"""

from __future__ import annotations

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# Convención de nombres. Sin esto, Alembic inventa nombres y las migraciones
# dejan de ser reversibles de forma fiable.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Base declarativa con la convención de nombres aplicada."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)
