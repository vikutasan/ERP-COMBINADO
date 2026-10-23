"""Punto de entrada HTTP del POS del ERP COMBINADO — FASE 1.7.

API propia del módulo POS. Vive en el puerto 5211 y su base de datos es
`erp_pos`, aislada. Es un módulo STANDALONE (RT-09, REGLA 1): no importa
código de ningún otro módulo ni del ERP de producción, y ningún otro módulo
importa su código. La comunicación con el resto del ERP COMBINADO es
exclusivamente por contratos HTTP tipados.

Responsabilidades:
  1. Crear la app FastAPI.
  2. Permitir CORS desde los frontends autorizados: el POS (5210) y el hub
     Vista General (5200), que embebe los módulos por iframe.
  3. Traducir `ReglaViolada` a su código HTTP (400/403/404/409). El dominio
     lanza reglas; la capa HTTP las convierte en respuestas. Así el dominio
     nunca conoce HTTP y la frontera se respeta.
  4. Montar los routers de catálogo y POS.
  5. Exponer `GET /health` para que docker-compose y el hub puedan verificar
     que el servidor está vivo.

Regla dura: este servidor NUNCA toca el ERP de producción. Su base de datos es
`erp_pos`, aislada. Sus consumidores son el frontend del POS y el hub.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from routers import catalog, cash, delivery, gestion_productos, ia, kitchen, notifications, orders, pos, sync, terminals
from rules import ReglaViolada

app = FastAPI(
    title="Nuevo POS — API",
    description=(
        "Capa HTTP del POS nuevo. Materializa los contratos de la FASE 2 "
        "sobre los modelos de la FASE 1 y las reglas de la FASE 3."
    ),
    version="0.1.0",
)

# ---------------------------------------------------------------------------
# CORS — el frontend del POS vive en 5210 y el hub Vista General en 5200.
# Ambos son orígenes distintos del API (5211), así que deben declararse.
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5210",
        "http://127.0.0.1:5210",
        "http://localhost:5200",
        "http://127.0.0.1:5200",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Frontera dominio → HTTP: una `ReglaViolada` conserva su código de error.
# ---------------------------------------------------------------------------
@app.exception_handler(ReglaViolada)
async def _manejador_regla_violada(_: Request, exc: ReglaViolada) -> JSONResponse:
    """Convierte una violación de regla de negocio en su respuesta HTTP."""
    return JSONResponse(
        status_code=exc.codigo,
        content={"detail": exc.mensaje, "regla": exc.regla},
    )


# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(catalog.router)
app.include_router(pos.router)
app.include_router(terminals.router)
app.include_router(cash.router)
app.include_router(ia.router)
app.include_router(orders.router)
# F12.22 — Contrato 27: encolado del ticket (Outbox). Estaba declarado desde
# la FASE 8.0 pero nunca implementado; el POS recibía 404 al enviar por
# WhatsApp/email. Este router cierra ese hueco.
app.include_router(notifications.router)
# MS-01 — Pantalla de Cocina: cola en tiempo real RECIBIDO → EN_PREP → LISTO.
app.include_router(kitchen.router)
# MS-02 — Módulo de Reparto: asignación de repartidores y tracking de entregas.
app.include_router(delivery.router)
# MS-03 — Sincronización Central: consolidación, outbox, conflictos y dashboard multi-sucursal.
app.include_router(sync.router)
# NC-GP-01 -- Modulo Gestion de Productos: historial de precios (ledger inmutable)
app.include_router(gestion_productos.router)


@app.get("/health", tags=["salud"])
async def health() -> dict[str, str]:
    """Sonda de vida para docker-compose, para el frontend y para el hub."""
    return {"status": "ok", "servicio": "erp-combinado-pos-api"}
