"""Paquete `routers/cash` — Router de Caja (FS2-04).

Materializa los contratos 9–14 declarados en la FASE 2:

  Contrato 9  GET  /cash/active-session              → sessions.sesion_activa
  Contrato 10 POST /cash/open-session                → sessions.abrir_turno
  Contrato 11 POST /cash/movements                   → movements.registrar_movimiento
  Contrato 12 GET  /cash/session-summary/{id}        → reports.resumen_del_turno
  Contrato 13 POST /cash/close-session               → sessions.cerrar_turno
  Contrato 14 GET  /cash/daily-report/{fecha}        → reports.reporte_diario
  Contrato 29 DELETE /cash/movements/{movement_id}   → movements.eliminar_movimiento

Retrocompatibilidad con `main.py`:
  `from routers import cash; app.include_router(cash.router)` sigue funcionando.

Estructura del paquete (FS2-04):
  deps.py      → utilidades internas compartidas (sin endpoints)
  sessions.py  → contratos 9, 10, 13 (sesión de caja)
  movements.py → contratos 11, 29 (movimientos)
  reports.py   → contratos 12, 14 (resumen y reporte)
"""

from __future__ import annotations

from fastapi import APIRouter

from .movements import router as _movements_router
from .reports import router as _reports_router
from .sessions import router as _sessions_router

router = APIRouter(prefix="/cash", tags=["caja"])

router.include_router(_sessions_router)
router.include_router(_movements_router)
router.include_router(_reports_router)

__all__ = ["router"]
