"""Configuración del módulo Seguridad y Acceso — FASE 3.1.

Todo lo configurable vive aquí y se lee del entorno. Nada de constantes
mágicas repartidas por los routers: si un valor cambia entre desarrollo y
producción, se cambia en un solo lugar.

O-21 (contrato 8): el rate-limit del endpoint del PIN es OBLIGATORIO. Sus
valores por defecto están pensados para una panadería: un cajero teclea su PIN
una vez por turno, así que 10 intentos por minuto por IP es holgado para el
uso legítimo y estrecho para la fuerza bruta.
"""

from __future__ import annotations

import os

# ---------------------------------------------------------------------------
# Rate-limit del contrato 8 (O-21).
# ---------------------------------------------------------------------------
# Formato de `limits`: "<n>/<unidad>", p. ej. "10/minute", "100/hour".
PIN_RATE_LIMIT = os.environ.get("PIN_RATE_LIMIT", "10/minute")

# ---------------------------------------------------------------------------
# Longitud del PIN.
# ---------------------------------------------------------------------------
# El PIN de producción es de 4 dígitos. Se deja configurable para no cerrar la
# puerta a un PIN más largo sin tocar código, pero el valor por defecto es el
# real del negocio.
PIN_LONGITUD_MINIMA = int(os.environ.get("PIN_LONGITUD_MINIMA", "4"))
PIN_LONGITUD_MAXIMA = int(os.environ.get("PIN_LONGITUD_MAXIMA", "8"))

# ---------------------------------------------------------------------------
# Zona horaria del negocio (DT-01: se guarda en UTC, se muestra en local).
# ---------------------------------------------------------------------------
BUSINESS_TZ = os.environ.get("BUSINESS_TZ", "America/Mexico_City")

# ---------------------------------------------------------------------------
# CORS: los frontends autorizados a hablar con esta API.
# ---------------------------------------------------------------------------
# 5228 = frontend de Seguridad y Acceso.
# 5200 = hub Vista General, que embebe los módulos por iframe.
ORIGENES_PERMITIDOS: tuple[str, ...] = tuple(
    origen.strip()
    for origen in os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:5228,http://127.0.0.1:5228,"
        "http://localhost:5200,http://127.0.0.1:5200",
    ).split(",")
    if origen.strip()
)
