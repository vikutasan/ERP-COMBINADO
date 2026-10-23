"""Paquete routers/pos — FD-04.

El router del POS se dividió del monolítico `routers/pos.py` (1220 líneas)
en submódulos por responsabilidad:

  deps.py      → Utilidades compartidas (queries, proyecciones, helpers)
  sessions.py  → Contratos 9 y POST /sessions (sesiones de terminal)
  tickets.py   → Contratos 3 y 5 (crear ticket, cobrar)
  items.py     → Contratos 18, 19, 20 (añadir, cambiar, quitar ítem atómico)
  reads.py     → Contratos 21, 22, 30 (leer ticket, verificar, leer líneas)
               → Contrato 23 (cuentas abiertas)
               → Contrato 31 (actualizar programación del pedido)
               → Contrato 26 (eventos auditables)

RETROCOMPATIBILIDAD: `main.py` importa el router con:

    from routers.pos import router

El `prefix="/pos"` y `tags=["pos"]` se declaran aquí para que `main.py`
no necesite cambios.
"""

from __future__ import annotations

from fastapi import APIRouter

from . import items, reads, sessions, tickets
# Re-exportación de utilidades internas usadas en tests (retrocompatibilidad FD-04).
from .deps import _normalizar_pagos as _normalizar_pagos  # noqa: F401

router = APIRouter(prefix="/pos", tags=["pos"])

router.include_router(sessions.router)
router.include_router(tickets.router)
router.include_router(items.router)
router.include_router(reads.router)

__all__ = ["router", "_normalizar_pagos"]
