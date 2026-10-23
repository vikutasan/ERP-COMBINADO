"""Configuración transversal: la tabla `system_settings` — FASE 7.5.1a.

Revision ID: 0002_system_settings
Revises: 0001_initial_schema
Create Date: 2026-09-30

Crea la capa de ALMACENAMIENTO de la directriz DT-06 (Configuración).

Por qué existe esta migración (HALLAZGO D-4 de la autocrítica de F7.5):
  El plan v3.0 de F7.5 nombraba `system_settings` como si ya existiera. NO
  existía: los 17 modelos de la Fase 1 no la incluían. La lección de la REGLA
  DURA 2 ("verificar, no asumir") es exactamente esta: un plan que nombra una
  tabla debe verificar que la tabla existe. Se crea aquí, con su migración,
  ANTES de que ningún código la lea.

Diseño clave/valor:
  - `key`   clave lógica única (p. ej. `order_payment_policy`).
  - `value` valor serializado como texto; NULL = "no declarado" → el
    consumidor degrada a su default seguro (DT-07).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# Identificadores de revisión, usados por Alembic.
revision: str = "0002_system_settings"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "system_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    # Una sola verdad por valor transversal: la clave es única.
    op.create_index(
        "ix_system_settings_key", "system_settings", ["key"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_system_settings_key", table_name="system_settings")
    op.drop_table("system_settings")
