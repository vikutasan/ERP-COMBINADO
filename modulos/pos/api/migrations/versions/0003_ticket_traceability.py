"""Trazabilidad del ticket: `captured_by_name` / `cashed_by_name` — FASE 12.6.

Revision ID: 0003_ticket_traceability
Revises: 0002_system_settings
Create Date: 2026-10-01

Por qué existe esta migración (F12.6 — PARIDAD DE PRESENTACIÓN):
  El pizarrón del viejo POS muestra, en cada post-it, QUIÉN capturó la cuenta.
  El nuevo POS ya guardaba `captured_by_id` / `cashed_by_id` (UUID), pero el
  nombre NO viajaba: el pizarrón no podía mostrarlo sin un JOIN contra
  `employees`, y leer `employees` desde el POS viola la frontera A-02 / O-23.

  La decisión (patrón F10.5, igual que `cash_sessions.employee_name`) es
  DESNORMALIZAR el nombre en el ticket. Es una FOTO HISTÓRICA ("quién capturó
  ESTA cuenta el día X"), no un valor vivo que deba sincronizarse; por eso NO
  es una segunda fuente de verdad (ver MODELO_DE_DATOS_DEL_NUEVO_POS.md:166 y
  :486, el caso `component_name`). El POS lo envía al crear/cobrar y el
  backend lo persiste. Sin JOIN, sin leer `employees`.

  Las columnas son NULLABLE: los tickets ya existentes no tienen nombre y no
  se inventa uno. El pizarrón degrada a "Desconocido" cuando falta (igual que
  el viejo POS: `t.captured_by_name || 'Desconocido'`).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# Identificadores de revisión, usados por Alembic.
revision: str = "0003_ticket_traceability"
down_revision: Union[str, None] = "0002_system_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # F12.6 — El nombre del capturista y del cobrador viajan CON el ticket.
    # Nullable a propósito: los tickets previos a esta migración no lo tienen.
    op.add_column(
        "tickets",
        sa.Column("captured_by_name", sa.String(), nullable=True),
    )
    op.add_column(
        "tickets",
        sa.Column("cashed_by_name", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tickets", "cashed_by_name")
    op.drop_column("tickets", "captured_by_name")
