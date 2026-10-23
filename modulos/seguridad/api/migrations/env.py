"""Entorno de Alembic — Seguridad y Acceso (FASE 3.1).

Este módulo lo ejecuta Alembic en cada `alembic upgrade/downgrade`. Su única
responsabilidad es conectar el motor async de SQLAlchemy con el `Base.metadata`
del módulo para que las migraciones se generen y apliquen contra la base
`erp_seguridad` (puerto 5441), nunca contra la base de producción.

La URL se toma de `DATABASE_URL` para que el mismo archivo sirva en local y
dentro de Docker (`db:5432`). El valor por defecto apunta al puerto publicado
en el host, que es donde corre Alembic cuando se invoca desde la terminal.
"""
from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

# El `Base` declarativo vive en models/base.py, no en core/. Importarlo desde
# el lugar equivocado rompe `alembic upgrade head` con ModuleNotFoundError.
from models.base import Base

# Importar el paquete de modelos registra todas las tablas en Base.metadata.
# Sin este import, `alembic revision --autogenerate` produce una migración vacía.
import models  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _database_url() -> str:
    """Devuelve la URL async de la base de Seguridad.

    Prioriza `DATABASE_URL` (Docker) y cae al puerto publicado en el host.
    """
    return os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://seguridad:seguridad@localhost:5441/erp_seguridad",
    )


def run_migrations_offline() -> None:
    """Genera el SQL sin abrir conexión (modo `--sql`)."""
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def _do_run_migrations(connection: Connection) -> None:
    """Configura el contexto sobre una conexión ya abierta y migra."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def _run_async_migrations() -> None:
    """Abre un engine async, migra y lo cierra."""
    engine = create_async_engine(_database_url(), poolclass=pool.NullPool)

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
