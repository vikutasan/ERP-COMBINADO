"""Utilidades compartidas por los scripts de importación — FASE 2.

Este módulo concentra TODO lo que los tres importadores (categorías, productos,
colaboradores) necesitan repetir:

  - leer las credenciales del rol de solo lectura desde el entorno;
  - abrir una conexión a producción que el motor garantiza de solo lectura;
  - abrir una conexión al destino (ERP COMBINADO);
  - generar UUIDs deterministas a partir del id de producción, para que una
    re-ejecución del importador produzca exactamente los mismos UUIDs y no
    duplique filas;
  - registrar el mapa `id_produccion → uuid_combinado` en `migracion/mapa_ids.csv`.

DECISIÓN DE DISEÑO — UUIDs deterministas
----------------------------------------
El plan pide "UUIDs nuevos" para el ERP COMBINADO. Si se usara `uuid4()` puro,
cada re-ejecución crearía UUIDs distintos y el importador dejaría de ser
idempotente: la segunda corrida insertaría duplicados o fallaría por clave
única. Por eso se usa `uuid5` sobre un namespace fijo del proyecto y una clave
estable (`categoria:1`, `producto:42`, `empleado:7`).

Resultado: el UUID es *nuevo* (no es el id de producción, que era un entero) y
es *estable* (misma entrada → mismo UUID, siempre). Eso hace el importador
re-ejecutable sin efectos secundarios, que es lo que exige REGLA 0 en la
práctica: poder repetir la migración sin miedo.

REGLA 0 — garantía de solo lectura
----------------------------------
`conectar_produccion()` abre la conexión con `erp_combinado_lectura` y además
ejecuta `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`. Son dos capas
independientes: aunque alguien otorgara permisos de escritura al rol por error,
la sesión seguiría rechazando cualquier escritura. La segunda capa no depende
de la configuración del servidor.
"""

from __future__ import annotations

import csv
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

try:
    import psycopg
except ImportError:  # pragma: no cover - mensaje accionable
    sys.exit(
        "Falta el driver psycopg. Instálalo con:\n"
        "    pip install 'psycopg[binary]>=3.1'"
    )


# ---------------------------------------------------------------------------
# Rutas y constantes
# ---------------------------------------------------------------------------

RAIZ_REPO = Path(__file__).resolve().parent.parent

# Ruta del mapa de identificadores.
#
# POR QUÉ ES CONFIGURABLE: estos importadores se ejecutan dentro de un
# contenedor `python:3.12-slim` con `-v <repo>/scripts:/scripts`. En ese caso
# `__file__` es `/scripts/importacion_comun.py`, así que `parent.parent` es `/`
# y la ruta derivada sería `/migracion/mapa_ids.csv` — un directorio que NO
# está montado. El importador escribiría el mapa dentro del contenedor efímero
# y `--rm` lo destruiría al terminar, perdiendo la trazabilidad en silencio
# (el resumen diría "70 filas añadidas" aunque el CSV del host no cambiara).
#
# Por eso el mapa se puede redirigir con `MAPA_IDS_PATH`. Si no se define, se
# usa la ruta derivada del repo, que es la correcta al ejecutar en el host.
_ruta_mapa_env = os.environ.get("MAPA_IDS_PATH")
RUTA_MAPA = Path(_ruta_mapa_env) if _ruta_mapa_env else RAIZ_REPO / "migracion" / "mapa_ids.csv"

# Namespace fijo del proyecto. NO cambiar: cambiarlo invalida todos los UUIDs
# ya importados y rompe la idempotencia de las re-ejecuciones.
NAMESPACE_ERP_COMBINADO = uuid.UUID("6f1c9a3e-2b47-5d8a-9c31-0e7b4f2a8d15")

# Credenciales del rol de solo lectura (FASE 2.1).
PROD_HOST = os.environ.get("PROD_DB_HOST", "localhost")
PROD_PORT = int(os.environ.get("PROD_DB_PORT", "5433"))
PROD_DB = os.environ.get("PROD_DB_NAME", "rderico")
PROD_USER = os.environ.get("PROD_DB_USER", "erp_combinado_lectura")
PROD_PASSWORD = os.environ.get("PROD_DB_PASSWORD", "lectura_solo_2026")

# Destino: la base del POS del ERP COMBINADO (contenedor erp_combinado_pos_db).
# Las credenciales coinciden con modulos/pos/docker-compose.yml (POSTGRES_USER=pos,
# POSTGRES_PASSWORD=pos, POSTGRES_DB=erp_pos). Si se cambian allí, hay que
# cambiarlas aquí o exportar DEST_DB_USER / DEST_DB_PASSWORD.
DEST_HOST = os.environ.get("DEST_DB_HOST", "localhost")
DEST_PORT = int(os.environ.get("DEST_DB_PORT", "5440"))
DEST_DB = os.environ.get("DEST_DB_NAME", "erp_pos")
DEST_USER = os.environ.get("DEST_DB_USER", "pos")
DEST_PASSWORD = os.environ.get("DEST_DB_PASSWORD", "pos")


# ---------------------------------------------------------------------------
# UUIDs deterministas
# ---------------------------------------------------------------------------

def uuid_categoria(id_produccion: int) -> uuid.UUID:
    """UUID estable para una categoría de producción."""
    return uuid.uuid5(NAMESPACE_ERP_COMBINADO, f"categoria:{id_produccion}")


def uuid_producto(id_produccion: int) -> uuid.UUID:
    """UUID estable para un producto de producción."""
    return uuid.uuid5(NAMESPACE_ERP_COMBINADO, f"producto:{id_produccion}")


def uuid_perfil(id_produccion: int) -> uuid.UUID:
    """UUID estable para un perfil de seguridad de producción."""
    return uuid.uuid5(NAMESPACE_ERP_COMBINADO, f"perfil:{id_produccion}")


def uuid_empleado(id_produccion: int) -> uuid.UUID:
    """UUID estable para un colaborador de producción."""
    return uuid.uuid5(NAMESPACE_ERP_COMBINADO, f"empleado:{id_produccion}")


# ---------------------------------------------------------------------------
# Conexiones
# ---------------------------------------------------------------------------

def conectar_produccion() -> "psycopg.Connection":
    """Abre una conexión de SOLO LECTURA a la base de producción.

    Dos capas de protección:
      1. El rol `erp_combinado_lectura` no tiene privilegios de escritura.
      2. La sesión se marca explícitamente como READ ONLY.

    Si el rol no existe o no puede conectar, el error es explícito y accionable.
    """
    try:
        conn = psycopg.connect(
            host=PROD_HOST,
            port=PROD_PORT,
            dbname=PROD_DB,
            user=PROD_USER,
            password=PROD_PASSWORD,
            connect_timeout=10,
        )
    except psycopg.OperationalError as exc:
        sys.exit(
            f"No se pudo conectar a producción ({PROD_HOST}:{PROD_PORT}/{PROD_DB} "
            f"como {PROD_USER}).\n"
            f"  Detalle: {exc}\n"
            "  ¿Ejecutaste migracion/01_rol_lectura.sql? ¿Está arriba el "
            "contenedor rderico-db-dev?"
        )

    # Segunda capa: la sesión entera rechaza escrituras.
    with conn.cursor() as cur:
        cur.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
    conn.commit()
    return conn


def conectar_destino() -> "psycopg.Connection":
    """Abre una conexión de escritura a la base del ERP COMBINADO."""
    try:
        return psycopg.connect(
            host=DEST_HOST,
            port=DEST_PORT,
            dbname=DEST_DB,
            user=DEST_USER,
            password=DEST_PASSWORD,
            connect_timeout=10,
        )
    except psycopg.OperationalError as exc:
        sys.exit(
            f"No se pudo conectar al destino ({DEST_HOST}:{DEST_PORT}/{DEST_DB} "
            f"como {DEST_USER}).\n"
            f"  Detalle: {exc}\n"
            "  ¿Está arriba el contenedor erp_combinado_pos_db?"
        )


# ---------------------------------------------------------------------------
# Mapa de IDs
# ---------------------------------------------------------------------------

CABECERA_MAPA = [
    "entidad",
    "id_produccion",
    "uuid_combinado",
    "clave_natural",
    "importado_en_utc",
]


def registrar_en_mapa(entidad: str, id_produccion: int, uuid_combinado: uuid.UUID,
                      clave_natural: str) -> None:
    """Registra (o actualiza) una fila del mapa `migracion/mapa_ids.csv`.

    El mapa es la trazabilidad de la migración: permite responder "¿de qué
    producto de producción salió este UUID?" sin volver a consultar producción.

    IDEMPOTENCIA: la clave es `(entidad, id_produccion)`. Si la fila ya existe
    se reescribe en su sitio en lugar de añadir un duplicado. Sin esto, cada
    re-ejecución de un importador inflaría el CSV con filas repetidas y el mapa
    dejaría de ser una fuente de verdad fiable.
    """
    # FALLA RUIDOSA: si el directorio del mapa no se puede crear o escribir,
    # abortamos en lugar de perder la trazabilidad en silencio. Antes de este
    # guard, ejecutar el importador dentro de un contenedor con solo `scripts/`
    # montado escribía el mapa en `/migracion/` (dentro del contenedor efímero)
    # y el resumen reportaba éxito aunque el CSV del host no cambiara.
    try:
        RUTA_MAPA.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise RuntimeError(
            f"No se pudo crear el directorio del mapa de IDs: {RUTA_MAPA.parent}. "
            f"Detalle: {exc}. Si ejecutas dentro de Docker, monta el directorio "
            f"y define MAPA_IDS_PATH apuntando al CSV montado."
        ) from exc

    if not os.access(RUTA_MAPA.parent, os.W_OK):
        raise RuntimeError(
            f"El directorio del mapa de IDs no es escribible: {RUTA_MAPA.parent}. "
            f"Define MAPA_IDS_PATH apuntando a una ruta escribible y montada."
        )

    filas: list[list[str]] = []
    if RUTA_MAPA.exists() and RUTA_MAPA.stat().st_size > 0:
        with RUTA_MAPA.open("r", newline="", encoding="utf-8") as fh:
            lector = csv.reader(fh)
            cabecera = next(lector, None)
            if cabecera == CABECERA_MAPA:
                filas = [f for f in lector if len(f) == len(CABECERA_MAPA)]

    nueva = [
        entidad,
        str(id_produccion),
        str(uuid_combinado),
        clave_natural,
        datetime.now(timezone.utc).isoformat(timespec="seconds"),
    ]

    # Reemplaza la fila existente de esta entidad+id, o la añade al final.
    for i, fila in enumerate(filas):
        if fila[0] == entidad and fila[1] == str(id_produccion):
            filas[i] = nueva
            break
    else:
        filas.append(nueva)

    with RUTA_MAPA.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(CABECERA_MAPA)
        writer.writerows(filas)


def reiniciar_mapa() -> None:
    """Borra el mapa antes de una importación completa desde cero.

    Se llama solo desde el orquestador, nunca desde un importador individual,
    para que re-ejecutar un solo importador no destruya la trazabilidad de los
    otros dos.
    """
    if RUTA_MAPA.exists():
        RUTA_MAPA.unlink()


# ---------------------------------------------------------------------------
# Presentación
# ---------------------------------------------------------------------------

def titulo(texto: str) -> None:
    print()
    print("=" * 72)
    print(texto)
    print("=" * 72)


def ok(texto: str) -> None:
    print(f"  [OK]   {texto}")


def aviso(texto: str) -> None:
    print(f"  [AVISO] {texto}")


def fallo(texto: str) -> None:
    print(f"  [FALLO] {texto}")
