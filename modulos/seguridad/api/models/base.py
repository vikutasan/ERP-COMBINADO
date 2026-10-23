"""Base declarativa de SQLAlchemy — FASE 3.1.

Un solo `Base` para todo el módulo. Alembic lo usa en `env.py` para descubrir
las tablas y autogenerar migraciones; los modelos lo usan para registrarse.
"""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base declarativa del módulo Seguridad y Acceso."""
