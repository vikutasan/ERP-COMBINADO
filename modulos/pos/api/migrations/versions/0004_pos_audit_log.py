"""El log de auditoría del POS: `pos_audit_log` — FASE 13.0.

Revision ID: 0004_pos_audit_log
Revises: 0003_ticket_traceability
Create Date: 2026-10-06

Por qué existe esta migración (F13.0 — el hueco real de la Fase 13):
  Las reglas RN-75/76/77 (auditoría) estaban declaradas pero operaban sobre
  una lista en memoria: no había tabla, no había endpoint, no había test
  (deuda D-11.1). El libro mayor (`movimientos_inventario`) y el outbox
  (`warehouse_events`) cubren el INVENTARIO, no la AUDITORÍA DE ESCRITURAS
  del POS.

  Esta tabla es la fuente de verdad de "qué escritura hizo el POS, cuándo, en
  qué terminal y con qué resultado". El contrato 5 (`pos.eventos_auditables`)
  lee de AQUÍ, nunca de `tickets` (frontera A-02 / O-23).

Reglas duras que respeta:
  C-01  PK UUID (identidad global), nunca entero.
  C-02  `timestamp` en DateTime(timezone=True) — UTC (RN-78).
  RN-77 índice compuesto (terminal_id, timestamp) para la consulta por rango.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# Identificadores de revisión, usados por Alembic.
revision: str = "0004_pos_audit_log"
down_revision: Union[str, None] = "0003_ticket_traceability"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "pos_audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        # RN-76 — la ruta de la escritura.
        sa.Column("endpoint", sa.String(), nullable=False),
        # RN-76 — el cuerpo de la petición, sin datos sensibles.
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default="{}"),
        # RN-76 — el código de respuesta HTTP.
        sa.Column("codigo", sa.Integer(), nullable=False),
        # RN-77 — la terminal que hizo la escritura.
        sa.Column("terminal_id", sa.String(), nullable=False),
        # Quién la hizo. Nullable: hay escrituras de sistema sin usuario.
        sa.Column("usuario_id", sa.String(), nullable=True),
        # RN-76 — metadatos adicionales.
        sa.Column("extras", postgresql.JSONB(), nullable=False, server_default="{}"),
        # RN-78 — UTC con tzinfo.
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
    )
    # RN-77 — la consulta "eventos de esta terminal entre estas fechas".
    op.create_index("ix_pos_audit_log_terminal_id", "pos_audit_log", ["terminal_id"])
    op.create_index("ix_pos_audit_log_timestamp", "pos_audit_log", ["timestamp"])
    op.create_index(
        "ix_pos_audit_log_terminal_timestamp",
        "pos_audit_log",
        ["terminal_id", "timestamp"],
    )


def downgrade() -> None:
    op.drop_index("ix_pos_audit_log_terminal_timestamp", table_name="pos_audit_log")
    op.drop_index("ix_pos_audit_log_timestamp", table_name="pos_audit_log")
    op.drop_index("ix_pos_audit_log_terminal_id", table_name="pos_audit_log")
    op.drop_table("pos_audit_log")
