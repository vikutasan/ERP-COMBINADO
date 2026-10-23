"""Conexión a PostgreSQL (async) — FASE 3.1 del ERP COMBINADO.

Una sola fuente de verdad para el engine y la fábrica de sesiones del módulo
Seguridad y Acceso. La URL se lee de `DATABASE_URL`; si no existe, se usa un
valor por defecto de desarrollo que apunta al PostgreSQL del ERP COMBINADO
(puerto 5441, base `erp_seguridad`).

Regla dura (RT-09, REGLA 1): Seguridad tiene su PROPIA base de datos. No
comparte la del POS (`erp_pos`, 5440), ni la del ERP de producción
(`erp_rderico`, 5433), ni la del NUEVO-ERP (`nuevo_pos`, 5432).

Nota histórica: la base `erp_seguridad` ya existía dentro del contenedor del
POS porque la FASE 2.4 importó ahí los 64 colaboradores y los 6 perfiles. En
la FASE 3.1 ese mismo PostgreSQL se publica en su propio puerto (5441) con su
propio contenedor, de modo que Seguridad deja de depender del POS para vivir.
"""

from __future__ import annotations

import os

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

# URL de conexión. El prefijo `postgresql+asyncpg` es obligatorio para async.
# Default de desarrollo: PostgreSQL de Seguridad en el puerto 5441.
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://seguridad:seguridad@localhost:5441/erp_seguridad",
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
