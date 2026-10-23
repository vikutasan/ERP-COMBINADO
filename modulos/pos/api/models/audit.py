"""El log de auditoría del POS — FASE 13.0 (Auditoría y Control).

Tabla: `pos_audit_log`.

Por qué existe (F13.0 — el hueco real de la Fase 13):
  El libro mayor (`movimientos_inventario`) y el outbox (`warehouse_events`)
  cubren el INVENTARIO, no la AUDITORÍA DE ESCRITURAS del POS. Las reglas
  RN-75/76/77 estaban declaradas pero operaban sobre una lista en memoria:
  no había tabla, no había endpoint, no había test (deuda D-11.1).

  Este log es la fuente de verdad de "qué escritura hizo el POS, cuándo, en
  qué terminal y con qué resultado". El contrato 5 (`pos.eventos_auditables`)
  lee de AQUÍ, nunca de `tickets` (frontera A-02 / O-23).

Reglas duras que respeta:
  C-01  PK UUID (identidad global), nunca entero.
  C-02  `timestamp` en DateTime(timezone=True) — UTC (RN-78).
  RN-75 cada escritura POS se registra.
  RN-76 el registro incluye endpoint, payload, código de respuesta y extras.
  RN-77 la consulta filtra por terminal y rango de fechas.
"""

from __future__ import annotations

import uuid

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.base import Base
from core.timestamps import utcnow


class PosAuditLog(Base):
    """Un asiento de auditoría: una escritura del POS, registrada.

    Es APPEND-ONLY por diseño: se inserta, nunca se corrige. Si una escritura
    se deshace, se registra el asiento contrario (mismo principio que el
    ledger de inventario, CA-09 / E-12).
    """

    __tablename__ = "pos_audit_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # RN-76 — la ruta de la escritura (p. ej. "POST /pos/tickets").
    endpoint: Mapped[str] = mapped_column(String, nullable=False)
    # RN-76 — el cuerpo de la petición, sin datos sensibles.
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # RN-76 — el código de respuesta HTTP (200, 201, 400, 409, …).
    codigo: Mapped[int] = mapped_column(Integer, nullable=False)
    # RN-77 — la terminal que hizo la escritura (indexada para la consulta).
    terminal_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # Quién la hizo. Nullable: hay escrituras de sistema sin usuario.
    usuario_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # RN-76 — metadatos adicionales (ticket_id, folio, motivo, …).
    extras: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # RN-78 — UTC con tzinfo. Indexado para el filtro por rango (RN-77).
    timestamp: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, index=True
    )

    __table_args__ = (
        # Índice compuesto (terminal_id, timestamp): la consulta de RN-77
        # ("los eventos de esta terminal entre estas fechas") es la más
        # frecuente del módulo de Auditoría.
        {"comment": "ix_pos_audit_log_terminal_timestamp (terminal_id, timestamp)"},
    )
