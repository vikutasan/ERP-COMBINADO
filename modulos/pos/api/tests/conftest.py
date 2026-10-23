"""Configuración de pytest — FASE 1.

Las pruebas de la puerta F1 inspeccionan el ESQUEMA (information_schema) y el
comportamiento del ledger. Requieren una base de datos PostgreSQL viva, la
misma que usa Alembic (`DATABASE_URL`).

Si no hay base de datos disponible, las pruebas se marcan como `skip` en vez
de fallar: la puerta F1 se corre con la base levantada (docker-compose).
"""

from __future__ import annotations

import os

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine


def _database_url() -> str:
    return os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://pos:pos@localhost:5432/nuevo_pos",
    )


@pytest_asyncio.fixture
async def engine():
    """Engine async para las pruebas. Se cierra al terminar."""
    eng = create_async_engine(_database_url(), pool_pre_ping=True)
    try:
        yield eng
    finally:
        await eng.dispose()


@pytest_asyncio.fixture
async def conn(engine):
    """Conexión async para consultar el catálogo del esquema."""
    async with engine.connect() as connection:
        yield connection
