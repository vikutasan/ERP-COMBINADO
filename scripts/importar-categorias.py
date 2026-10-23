"""Importa las categorías de producción al ERP COMBINADO — FASE 2.2.

QUÉ HACE
--------
Lee `public.categories` de la base de producción (`rderico`) con el rol de solo
lectura y escribe las mismas categorías en `categories` de la base del ERP
COMBINADO (`erp_pos`), con UUIDs nuevos y estables.

QUÉ **NO** HACE
---------------
No toca producción. No borra categorías del destino que no vengan de producción
(las reporta como "huérfanas" para revisión manual). No importa productos: eso
es la FASE 2.3.

MAPEO DE COLUMNAS
-----------------
Producción tiene 10 columnas; el modelo `Category` del ERP COMBINADO tiene 9.
La columna `channel` de producción NO se importa: fue reemplazada por
`pos_target` en el esquema nuevo (RT-09, un solo dueño del destino de
proyección). Se conserva `pos_target`, que es la decisión real por categoría.

    producción              →  ERP COMBINADO
    -----------------------    ----------------------
    id (integer)            →  id (uuid, determinista)
    name                    →  name
    icon                    →  icon
    position                →  position
    vision_enabled          →  vision_enabled
    is_system               →  is_system
    heladeria_enabled       →  heladeria_enabled
    pos_target              →  pos_target
    heladeria_default_role  →  heladeria_default_role
    channel                 →  (descartada: reemplazada por pos_target)

IDEMPOTENCIA
------------
`INSERT ... ON CONFLICT (id) DO UPDATE` sobre el UUID determinista. Re-ejecutar
el script actualiza en lugar de duplicar. Es seguro correrlo varias veces.

USO
---
    python scripts/importar-categorias.py
"""

from __future__ import annotations

import sys

from importacion_comun import (
    aviso,
    conectar_destino,
    conectar_produccion,
    fallo,
    ok,
    registrar_en_mapa,
    titulo,
    uuid_categoria,
)

# Columnas que se leen de producción, en el orden en que se insertan.
COLUMNAS_ORIGEN = (
    "id",
    "name",
    "icon",
    "position",
    "vision_enabled",
    "is_system",
    "heladeria_enabled",
    "pos_target",
    "heladeria_default_role",
)

SQL_LEER = f"""
    SELECT {', '.join(COLUMNAS_ORIGEN)}
    FROM public.categories
    ORDER BY position NULLS LAST, id
"""

SQL_INSERTAR = """
    INSERT INTO categories (
        id, name, icon, position, vision_enabled, is_system,
        heladeria_enabled, pos_target, heladeria_default_role
    )
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (id) DO UPDATE SET
        name                   = EXCLUDED.name,
        icon                   = EXCLUDED.icon,
        position               = EXCLUDED.position,
        vision_enabled         = EXCLUDED.vision_enabled,
        is_system              = EXCLUDED.is_system,
        heladeria_enabled      = EXCLUDED.heladeria_enabled,
        pos_target             = EXCLUDED.pos_target,
        heladeria_default_role = EXCLUDED.heladeria_default_role
"""


def main() -> int:
    titulo("FASE 2.2 — Importación de CATEGORÍAS (producción → ERP COMBINADO)")

    # ------------------------------------------------------------------
    # 1. Leer producción (solo lectura, garantizado por rol + sesión)
    # ------------------------------------------------------------------
    print("\n[1/4] Leyendo categorías de producción…")
    conn_prod = conectar_produccion()
    try:
        with conn_prod.cursor() as cur:
            cur.execute(SQL_LEER)
            filas = cur.fetchall()
    finally:
        conn_prod.close()

    if not filas:
        fallo("Producción no devolvió ninguna categoría. Abortando sin escribir.")
        return 1

    ok(f"{len(filas)} categorías leídas de producción.")

    # ------------------------------------------------------------------
    # 2. Transformar (id entero → UUID determinista)
    # ------------------------------------------------------------------
    print("\n[2/4] Transformando identificadores…")
    registros = []
    for fila in filas:
        (id_prod, name, icon, position, vision_enabled, is_system,
         heladeria_enabled, pos_target, heladeria_default_role) = fila

        nuevo_uuid = uuid_categoria(id_prod)
        registros.append((
            nuevo_uuid,
            name,
            icon,
            position,
            bool(vision_enabled) if vision_enabled is not None else False,
            bool(is_system) if is_system is not None else False,
            bool(heladeria_enabled) if heladeria_enabled is not None else False,
            pos_target or "PANADERIA",
            heladeria_default_role,
        ))
    ok(f"{len(registros)} registros transformados a UUID.")

    # ------------------------------------------------------------------
    # 3. Escribir en el destino
    # ------------------------------------------------------------------
    print("\n[3/4] Escribiendo en el ERP COMBINADO…")
    conn_dest = conectar_destino()
    try:
        with conn_dest.cursor() as cur:
            cur.executemany(SQL_INSERTAR, registros)
        conn_dest.commit()

        with conn_dest.cursor() as cur:
            cur.execute("SELECT count(*) FROM categories")
            total_destino = cur.fetchone()[0]
    finally:
        conn_dest.close()

    ok(f"{len(registros)} categorías insertadas/actualizadas.")
    ok(f"Total de categorías en el destino: {total_destino}.")

    # ------------------------------------------------------------------
    # 4. Registrar el mapa de IDs
    # ------------------------------------------------------------------
    print("\n[4/4] Registrando mapa de identificadores…")
    for fila in filas:
        id_prod = fila[0]
        nombre = fila[1]
        registrar_en_mapa("categoria", id_prod, uuid_categoria(id_prod), nombre)
    ok(f"{len(filas)} filas añadidas a migracion/mapa_ids.csv.")

    # ------------------------------------------------------------------
    # Resumen
    # ------------------------------------------------------------------
    if total_destino != len(registros):
        aviso(
            f"El destino tiene {total_destino} categorías pero se importaron "
            f"{len(registros)}. Hay {total_destino - len(registros)} categoría(s) "
            "que no vienen de producción (creadas a mano en el ERP COMBINADO). "
            "No se borran automáticamente: revísalas."
        )

    titulo("FASE 2.2 COMPLETADA")
    print(f"  Categorías importadas: {len(registros)}")
    print(f"  Total en destino:      {total_destino}")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
