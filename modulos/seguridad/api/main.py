"""Punto de entrada HTTP de Seguridad y Acceso — FASE 3.1.

Este servicio es el dueño EXCLUSIVO de `erp_seguridad`. Ningún otro módulo lee
sus tablas: el POS pide identidad por HTTP (contratos 7 y 8) y recibe una
proyección sin PIN (O-23).

Puertos (ver `PUERTOS.md`):
    API        → 5229
    Frontend   → 5228
    PostgreSQL → 5441 (base `erp_seguridad`)

El módulo arranca sin depender de nadie: `contratos_consume` está vacío en
`modulos.json`. Si el POS está caído, Seguridad sigue respondiendo; si Seguridad
está caída, el POS no puede abrir turno (por eso su `notas` dice "Crítico").
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from core.config import ORIGENES_PERMITIDOS
from routers import seguridad
from rules.registry import ReglaViolada

app = FastAPI(
    title="Seguridad y Acceso — API",
    description=(
        "Identidad de colaboradores y validación de PIN del ERP COMBINADO. "
        "Provee los contratos 7 y 8 del registro."
    ),
    version="1.0.0",
)

# O-21: `slowapi` necesita el limitador en `app.state` para poder contar los
# intentos del contrato 8. El limitador se declara en el router (junto al
# endpoint que protege) y se registra aquí, que es donde vive la app.
app.state.limiter = seguridad.limiter

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ORIGENES_PERMITIDOS),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ReglaViolada)
async def _manejador_regla_violada(_: Request, exc: ReglaViolada) -> JSONResponse:
    """Traduce una regla de negocio violada al código HTTP que la regla declara.

    El dominio no conoce HTTP: `ReglaViolada` solo dice "esto es un 400" o "esto
    es un 500". Aquí se convierte en respuesta. Se incluye el nombre de la regla
    para que el log del POS diga exactamente qué se rompió.
    """
    return JSONResponse(
        status_code=exc.codigo,
        content={"detail": exc.mensaje, "regla": exc.regla},
    )


@app.exception_handler(RateLimitExceeded)
async def _manejador_rate_limit(_: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Responde 429 cuando se excede el límite de intentos de PIN (O-21).

    Sin este manejador, `slowapi` devolvería un 500 genérico y el POS no podría
    distinguir "PIN equivocado" de "demasiados intentos". El 429 es la señal
    que el frontend usa para bloquear el teclado numérico unos segundos.
    """
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Demasiados intentos de PIN. Espera un momento.",
            "regla": "O-21",
            "limite": str(exc.detail),
        },
    )


app.include_router(seguridad.router)


@app.get("/health", tags=["salud"])
async def health() -> dict[str, str]:
    """Sonda de salud que el hub consulta para pintar el módulo en verde.

    No toca la base a propósito: si la base está caída, el módulo sigue vivo y
    el hub debe poder mostrarlo. La comprobación de base la hace el endpoint
    real cuando alguien lo llama.
    """
    return {"status": "ok", "servicio": "erp-combinado-seguridad-api"}
