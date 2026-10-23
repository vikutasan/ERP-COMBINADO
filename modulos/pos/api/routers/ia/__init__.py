"""Paquete `routers/ia` — Router de IA (FS2-05).

Endpoints (todos prefijados /ia):
  POST /ia/extraer-estetica   → vision.extraer_estetica
  POST /ia/guardar-tema       → vision.guardar_tema
  GET  /ia/temas-generados    → vision.listar_temas_generados

Retrocompatibilidad con `main.py`:
  `from routers import ia; app.include_router(ia.router)` sigue funcionando.

Estructura (FS2-05):
  deps.py   → configuración, prompt, utilidades de contraste y color
  vision.py → endpoints + funciones internas del extractor
"""

from __future__ import annotations

from fastapi import APIRouter

from .vision import router as _vision_router

router = APIRouter(prefix="/ia", tags=["ia"])
router.include_router(_vision_router)

__all__ = ["router"]
