"""Los guardianes del POS nuevo — FASE 4 (Guardianes).

Fuente autoritativa: `PLAN_DE_CONSTRUCCION_DEL_NUEVO_POS.md` §6.

Una regla no automatizada es solo una intención (RN-81 fue violada precisamente
por eso). Esta fase convierte cada regla crítica en un **test guardián** que
**falla si la regla se viola**, y cierra las tres deudas estructurales:

  A-03  Un test guardián por regla crítica.
        → `apps/api/guards/guardians.py` (el catálogo de guardianes)
        → `apps/api/tests/test_f4_guardianes.py` (la puerta que los ejecuta)

  A-04  Outbox transaccional: el evento vive en la MISMA transacción que el
        guardado del ticket. Elimina `try/except pass` en la ruta crítica.
        → `apps/api/guards/outbox.py`

  A-05  Separación explícita identidad (UUID) ≠ presentación (folio).
        → `apps/api/guards/identity.py`

Puerta de salida (§6.3):
  [ ] El CI falla si se viola una regla crítica (verificable rompiendo una).
  [ ] 0 `try/except pass` en la ruta crítica (búsqueda automatizada en CI).
  [ ] Ninguna regla de negocio usa el folio como identidad.
"""

from __future__ import annotations

from .audit import (
    AsientoAuditoria,
    LogDeAuditoria,
    SinTerminalEnAuditoria,
)
from .guardians import (
    GUARDIANES_CRITICOS,
    Guardia,
    GuardianViolado,
    listar_guardianes,
    matriz_guardian_regla,
)
from .identity import (
    IdentidadDeTicket,
    folio_no_es_identidad,
    identidad_es_uuid,
    separar_identidad_de_folio,
)
from .outbox import (
    EventoOutbox,
    OutboxTransaccional,
    SinSilenciosEnRutaCritica,
)

__all__ = [
    # A-03
    "GUARDIANES_CRITICOS",
    "Guardia",
    "GuardianViolado",
    "listar_guardianes",
    "matriz_guardian_regla",
    # A-04
    "EventoOutbox",
    "OutboxTransaccional",
    "SinSilenciosEnRutaCritica",
    # A-05
    "IdentidadDeTicket",
    "folio_no_es_identidad",
    "identidad_es_uuid",
    "separar_identidad_de_folio",
    # FASE 13.0 — Log de auditoría (RN-75/76/77)
    "AsientoAuditoria",
    "LogDeAuditoria",
    "SinTerminalEnAuditoria",
]
