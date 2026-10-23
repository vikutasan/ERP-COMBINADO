"""Esquema inicial de Seguridad y Acceso: security_profiles y employees.

Revision ID: 0001
Revises:
Create Date: 2026-10-23

Crea las dos únicas tablas que este módulo posee. Ninguna otra tabla del ERP
vive aquí: Seguridad es dueño de la identidad y de los permisos, y todo lo
demás (catálogo, ventas, almacenes) pertenece a otros módulos y se consulta
por contrato (RT-09).

Notas de diseño:
  * `id` es UUID (DT-03): el UUID identifica, el folio comunica.
  * `permissions` es JSONB con `{}` por defecto: un perfil sin permisos es
    válido y no debe romper la lectura (rn_s02 tolera `None`).
  * `employee_code` es UNIQUE y es el PIN. No se guarda hasheado porque el
    contrato 8 compara igualdad exacta y la defensa real es el rate-limit
    (O-21), no el secreto del hash.
  * `profile_id` usa ON DELETE SET NULL: borrar un perfil nunca debe borrar
    colaboradores; solo los deja sin perfil.
  * Los timestamps usan `(now() AT TIME ZONE 'utc')` (DT-01): se almacena en
    UTC y se presenta en hora local en el frontend.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# Identificadores de revisión, usados por Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "security_profiles",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column(
            "permissions",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "is_system",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("(now() AT TIME ZONE 'utc')"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("(now() AT TIME ZONE 'utc')"),
        ),
        sa.UniqueConstraint("name", name="uq_security_profiles_name"),
    )

    op.create_table(
        "employees",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("employee_code", sa.String(length=16), nullable=False),
        sa.Column(
            "role",
            sa.String(length=60),
            nullable=False,
            server_default=sa.text("'CAJERO'"),
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "profile_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("employee_number", sa.Integer(), nullable=True),
        sa.Column(
            "exclude_attendance",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("(now() AT TIME ZONE 'utc')"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("(now() AT TIME ZONE 'utc')"),
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["security_profiles.id"],
            name="fk_employees_profile_id_security_profiles",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("employee_code", name="uq_employees_employee_code"),
    )

    # El contrato 8 busca por igualdad exacta sobre employee_code; el UNIQUE ya
    # crea el índice, pero lo dejamos explícito para documentar la intención.
    op.create_index(
        "ix_employees_employee_code",
        "employees",
        ["employee_code"],
        unique=False,
    )
    op.create_index(
        "ix_employees_profile_id",
        "employees",
        ["profile_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_employees_profile_id", table_name="employees")
    op.drop_index("ix_employees_employee_code", table_name="employees")
    op.drop_table("employees")
    op.drop_table("security_profiles")
