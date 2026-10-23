"""Entorno de Alembic — FASE 1 del ERP COMBINADO.

Alembic descubre las tablas importando el paquete `models`. La URL de conexión
se lee de `DATABASE_URL` (o del default de desarrollo, que apunta al PostgreSQL
del ERP COMBINADO en el puerto 5440, base `erp_pos`).

Se usa el modo async porque el engine es `asyncpg`. Alembic soporta async
desde la 1.7 con `run_async_migrations`.
"""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

# Importar la Base y TODOS los modelos para que `Base.metadata` esté poblada.
from core.base import Base
import models  # noqa: F401  (el import registra las 17 tablas)

# Objeto de configuración de Alembic.
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# La metadata que Alembic compara contra la base de datos.
target_metadata = Base.metadata


def _database_url() -> str:
    """Lee la URL de conexión desde el entorno, con default de desarrollo.

    El default apunta a la base aislada del POS del ERP COMBINADO: `erp_pos`
    en el puerto 5440. Nunca a `nuevo_pos` (5432) ni a `erp_rderico` (5433).
    """
    return os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://pos:pos@localhost:5440/erp_pos",
    )


def run_migrations_offline() -> None:
    """Modo offline: genera el SQL sin conectarse a la base de datos."""
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run_migrations(connection) -> None:
    """Ejecuta las migraciones sobre una conexión ya abierta."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_async_migrations() -> None:
    """Modo online async: abre el engine, corre y cierra."""
    engine = create_async_engine(_database_url(), pool_pre_ping=True)
    async with engine.connect() as connection:
        await connection.run_sync(_do_run_migrations)
    await engine.dispose()


def run_migrations_online() -> None:
    """Punto de entrada del modo online."""
    asyncio.run(_run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
