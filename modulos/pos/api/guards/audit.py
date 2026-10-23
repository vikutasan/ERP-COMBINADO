"""A-06 — Guardián del log de auditoría — FASE 13.0 (Auditoría y Control).

El log de auditoría vive en la MISMA transacción que la escritura que audita.
Es el mismo principio que el outbox (RN-63 / A-04): si la operación falla, el
asiento de auditoría NO se persiste. Un log que registra escrituras que nunca
ocurrieron es peor que no tener log.

Reglas que protege:
  RN-75  cada escritura POS se registra.
  RN-76  el registro incluye endpoint, payload, código de respuesta y extras.
  RN-78  el timestamp se almacena en UTC (con tzinfo).

Por qué un guardián y no una llamada suelta:
  Igual que el outbox, el registro de auditoría debe ser IMPOSIBLE de olvidar
  en la ruta crítica. El guardián expone una única puerta (`registrar`) que
  valida el contenido (RN-76) y el timestamp (RN-78) antes de encolar el
  asiento. Si la transacción se revierte, el asiento se va con ella.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from rules.registry import (
    ReglaViolada,
    rn76_contenido_del_registro,
    rn78_timestamps_en_utc,
)


@dataclass(frozen=True)
class AsientoAuditoria:
    """Un asiento de auditoría listo para persistir.

    Es inmutable (frozen): una vez construido, no se corrige. Si una escritura
    se deshace, se registra el asiento contrario (mismo principio que el
    ledger de inventario, CA-09 / E-12).
    """

    endpoint: str
    payload: dict[str, Any]
    codigo: int
    terminal_id: str
    usuario_id: str | None
    extras: dict[str, Any]
    timestamp: datetime

    @classmethod
    def construir(
        cls,
        endpoint: str,
        payload: dict[str, Any],
        codigo: int,
        terminal_id: str,
        usuario_id: str | None = None,
        extras: dict[str, Any] | None = None,
        ahora: datetime | None = None,
    ) -> "AsientoAuditoria":
        """Construye un asiento validando RN-76 (contenido) y RN-78 (UTC)."""
        # RN-76 — el contenido mínimo del registro.
        contenido = rn76_contenido_del_registro(endpoint, payload, codigo, extras)
        # RN-78 — el timestamp debe ser UTC con tzinfo.
        instante = rn78_timestamps_en_utc(ahora or datetime.now(timezone.utc))
        return cls(
            endpoint=contenido["endpoint"],
            payload=contenido["payload"],
            codigo=contenido["codigo"],
            terminal_id=terminal_id,
            usuario_id=usuario_id,
            extras=contenido["extras"],
            timestamp=instante,
        )


class SinTerminalEnAuditoria(ReglaViolada):
    """Se lanza si se intenta auditar una escritura sin terminal (RN-77)."""

    def __init__(self) -> None:
        super().__init__(
            "RN-77",
            "El asiento de auditoría exige terminal_id para poder consultarse",
            400,
        )


@dataclass
class LogDeAuditoria:
    """Un log de auditoría en memoria que modela la transacción de la escritura.

    Se usa como context manager, igual que `OutboxTransaccional`:

        with LogDeAuditoria() as log:
            log.registrar("POST /pos/tickets", {...}, 201, "T1")
            # … la escritura real …
        # al salir sin excepción, los asientos quedan confirmados

    Si el bloque lanza una excepción, los asientos se descartan (rollback):
    no se audita una escritura que no ocurrió.
    """

    asientos: list[AsientoAuditoria] = field(default_factory=list)
    _confirmado: bool = False

    def __enter__(self) -> "LogDeAuditoria":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        if exc_type is not None:
            # Rollback: la escritura falló, el asiento se va con ella.
            self.asientos.clear()
            self._confirmado = False
            return False  # NO silencia la excepción (E-05).
        self._confirmado = True
        return False

    def registrar(
        self,
        endpoint: str,
        payload: dict[str, Any],
        codigo: int,
        terminal_id: str,
        usuario_id: str | None = None,
        extras: dict[str, Any] | None = None,
        ahora: datetime | None = None,
    ) -> AsientoAuditoria:
        """Registra una escritura (RN-75). Exige terminal (RN-77)."""
        if not terminal_id:
            raise SinTerminalEnAuditoria()
        asiento = AsientoAuditoria.construir(
            endpoint=endpoint,
            payload=payload,
            codigo=codigo,
            terminal_id=terminal_id,
            usuario_id=usuario_id,
            extras=extras,
            ahora=ahora,
        )
        self.asientos.append(asiento)
        return asiento

    @property
    def confirmado(self) -> bool:
        """True si la transacción cerró sin excepción."""
        return self._confirmado
