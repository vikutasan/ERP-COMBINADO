"""Utilidades de tiempo — FASE 1 (C-02).

Regla dura: el tiempo se guarda SIEMPRE en UTC con zona horaria explícita.
Nunca se guarda un `datetime` naive. La presentación en hora local es
responsabilidad de la capa de interfaz, no de la base de datos.

`utcnow()` devuelve un `datetime` con `tzinfo=UTC`, apto para columnas
`DateTime(timezone=True)`.
"""

from __future__ import annotations

from datetime import datetime, timezone


def utcnow() -> datetime:
    """Devuelve el instante actual en UTC, con zona horaria explícita.

    Se usa como `default` y `onupdate` de las columnas de tiempo. Nunca se
    llama a `datetime.utcnow()` (que devuelve naive y es el bug C-02).
    """
    return datetime.now(timezone.utc)
