"""Conexión a PostgreSQL (async) — FASE 1 del ERP COMBINADO.

Una sola fuente de verdad para el engine y la fábrica de sesiones. La URL se
lee de `DATABASE_URL`; si no existe, se usa un valor por defecto de desarrollo
que apunta al PostgreSQL del ERP COMBINADO (puerto 5440, base `erp_pos`).

Regla dura (RT-09, REGLA 1): el POS tiene su PROPIA base de datos. No comparte
la del ERP de producción (`erp_rderico`, puerto 5433) ni la del NUEVO-ERP
(`nuevo_pos`, puerto 5432).
"""

from __future__ import annotations

import os

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

# URL de conexión. El prefijo `postgresql+asyncpg` es obligatorio para async.
# Default de desarrollo: PostgreSQL del ERP COMBINADO en el puerto 5440.
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://pos:pos@localhost:5440/erp_pos",
)

# `pool_pre_ping` evita usar conexiones muertas tras un reinicio del servidor.
engine = create_async_engine(DATABASE_URL, pool_pre_ping=True, future=True)

# `expire_on_commit=False` permite leer los atributos tras el commit sin
# disparar una consulta extra (útil en los endpoints async).
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncSession:
    """Dependencia de FastAPI: entrega una sesión y la cierra al terminar."""
    async with AsyncSessionLocal() as session:
        yield session
