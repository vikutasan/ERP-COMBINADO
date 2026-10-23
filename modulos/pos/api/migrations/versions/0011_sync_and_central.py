"""Tablas de sincronización central y multi-sucursal -- MS-03.

Revision ID: 0011_sync_and_central
Revises: 0010_delivery_assignments
Create Date: 2026-10-21

Por que existe esta migracion (MS-03 -- Sincronizacion Central):
  Materializa la infraestructura de sincronización y multi-sucursal:
    1. `branches`: Registro de sucursales con código y última sincronización.
    2. `sync_outbox`: Cola local de eventos/lotes para push a la central.
    3. `central_consolidated_records`: Almacén central consolidado con clave (branch_id, domain, record_uuid).
    4. `sync_conflicts`: Registro auditable de cualquier conflicto o discrepancia detectada (nunca silencioso).

Reglas que respeta:
  C-01  PK UUID.
  C-02  timestamps con DateTime(timezone=True).
  C-04  Clave única de consolidación (branch_id, domain, record_uuid).
  P1-P6 Contrato de consolidación (unidireccional, asíncrono, idempotente, auditable).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011_sync_and_central"
down_revision: Union[str, None] = "0010_delivery_assignments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Sucursales
    op.create_table(
        "branches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(length=50), nullable=False, unique=True),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="ACTIVE"),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_branches_code", "branches", ["code"])

    # 2. Outbox local
    op.create_table(
        "sync_outbox",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("branch_id", sa.String(length=50), nullable=False),
        sa.Column("domain", sa.String(length=50), nullable=False),
        sa.Column("record_uuid", sa.String(length=64), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="PENDING"),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_sync_outbox_branch_status", "sync_outbox", ["branch_id", "status"])
    op.create_index("ix_sync_outbox_record_uuid", "sync_outbox", ["record_uuid"])

    # 3. Registros consolidados central
    op.create_table(
        "central_consolidated_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("branch_id", sa.String(length=50), nullable=False),
        sa.Column("domain", sa.String(length=50), nullable=False),
        sa.Column("record_uuid", sa.String(length=64), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("schema_version", sa.String(length=20), nullable=False, server_default="1.0"),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("branch_id", "domain", "record_uuid", name="uq_central_branch_domain_uuid"),
    )
    op.create_index("ix_central_records_branch_domain", "central_consolidated_records", ["branch_id", "domain"])

    # 4. Conflictos de sincronización
    op.create_table(
        "sync_conflicts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("branch_id", sa.String(length=50), nullable=False),
        sa.Column("domain", sa.String(length=50), nullable=False),
        sa.Column("record_uuid", sa.String(length=64), nullable=False),
        sa.Column("conflict_reason", sa.String(length=100), nullable=False),
        sa.Column("payload_local", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("payload_remote", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("resolution_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_sync_conflicts_branch_resolved", "sync_conflicts", ["branch_id", "resolved"])


def downgrade() -> None:
    op.drop_table("sync_conflicts")
    op.drop_table("central_consolidated_records")
    op.drop_table("sync_outbox")
    op.drop_table("branches")
