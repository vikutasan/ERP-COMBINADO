"""Importa los colaboradores de producción al ERP COMBINADO — FASE 2.4.

QUÉ HACE
--------
Lee `public.security_profiles` y `public.employees` de la base de producción
(`rderico`) con el rol de solo lectura y escribe los mismos registros en la base
`erp_seguridad` del ERP COMBINADO, con UUIDs nuevos y estables.

Es el tercero de los tres importadores de la FASE 2. El usuario pidió traer
exactamente cuatro cosas de producción, y esta es la tercera:

    1. catálogo de productos con sus precios actuales   → FASE 2.3
    2. categorías de productos actuales                 → FASE 2.2
    3. credenciales de acceso de los colaboradores      → FASE 2.4 (este script)
    4. nada más

QUÉ **NO** HACE
---------------
No toca producción. No importa historial de ventas, ni asistencia, ni nómina, ni
incidencias: todo eso empieza de cero en el ERP COMBINADO. No borra colaboradores
del destino que no vengan de producción (los reporta como huérfanos).

EL PIN — LA DECISIÓN MÁS DELICADA DE ESTE SCRIPT
------------------------------------------------
En producción NO existe ninguna columna de PIN, contraseña ni hash. El PIN **es**
`employees.employee_code`, guardado en texto plano y validado por igualdad directa
en `security/service.py:validar_pin()`.

Por eso `employee_code` se copia **sin transformar**. Si se hasheara o se
regenerara, los 36 colaboradores activos no podrían entrar al POS el día del
cambio y el Strangler Fig (RT-12) fallaría en el peor momento posible: con el
personal frente a la caja. La FASE 6.3 valida tres PINs reales contra este
esquema para demostrar que la copia fue fiel.

MAPEO DE COLUMNAS
-----------------
    security_profiles
    -----------------------
    id (integer)      →  id (uuid, determinista)
    name              →  name
    description       →  description
    permissions (json)→  permissions (jsonb)
    is_system         →  is_system

    employees
    -----------------------
    id (integer)      →  id (uuid, determinista)
    name              →  name
    employee_code     →  employee_code   (EL PIN — se conserva tal cual)
    role              →  role
    is_active         →  is_active
    profile_id (int)  →  profile_id (uuid, remapeado con uuid_perfil)
    employee_number   →  employee_number
    exclude_attendance→  exclude_attendance

ORDEN DE ESCRITURA
------------------
Los perfiles van PRIMERO. `employees.profile_id` es una clave foránea a
`security_profiles.id`; insertar colaboradores antes que perfiles violaría la FK.
Dentro de cada tabla se usa `INSERT ... ON CONFLICT (id) DO UPDATE`, así que
re-ejecutar el script actualiza en lugar de duplicar.

EL COLABORADOR SIN PERFIL
-------------------------
En producción hay un colaborador (`PROBADOR`, código 0000) con `profile_id` NULL.
Se importa igual, con `profile_id` NULL: es un registro de prueba desactivado
(`is_active = false`) y el esquema destino admite NULL en esa columna. Descartarlo
haría que el conteo de colaboradores no cuadrara con producción y la FASE 2.5
fallaría por una diferencia que en realidad es correcta.

USO
---
    python scripts/importar-colaboradores.py
"""

from __future__ import annotations

import json
import sys

from importacion_comun import (
    aviso,
    conectar_destino,
    conectar_produccion,
    fallo,
    ok,
    registrar_en_mapa,
    titulo,
    uuid_empleado,
    uuid_perfil,
)

# La base destino de este importador NO es `erp_pos` sino `erp_seguridad`.
# `conectar_destino()` abre `erp_pos` por defecto, así que aquí se abre una
# conexión propia apuntando a la base correcta, reutilizando las mismas
# credenciales y variables de entorno.
import os

import psycopg

DEST_SEGURIDAD_DB = os.environ.get("DEST_SEGURIDAD_DB", "erp_seguridad")


def conectar_seguridad() -> "psycopg.Connection":
    """Abre una conexión de escritura a la base `erp_seguridad`."""
    from importacion_comun import DEST_HOST, DEST_PASSWORD, DEST_PORT, DEST_USER

    try:
        return psycopg.connect(
            host=DEST_HOST,
            port=DEST_PORT,
            dbname=DEST_SEGURIDAD_DB,
            user=DEST_USER,
            password=DEST_PASSWORD,
            connect_timeout=10,
        )
    except psycopg.OperationalError as exc:
        sys.exit(
            f"No se pudo conectar a {DEST_SEGURIDAD_DB} "
            f"({DEST_HOST}:{DEST_PORT} como {DEST_USER}).\n"
            f"  Detalle: {exc}\n"
            "  ¿Creaste la base y aplicaste migracion/02_esquema_seguridad.sql?"
        )


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

SQL_LEER_PERFILES = """
    SELECT id, name, description, permissions::text, is_system
    FROM public.security_profiles
    ORDER BY id
"""

SQL_LEER_EMPLEADOS = """
    SELECT id, name, employee_code, role, is_active, profile_id,
           employee_number, exclude_attendance
    FROM public.employees
    ORDER BY id
"""

SQL_INSERTAR_PERFIL = """
    INSERT INTO security_profiles (
        id, name, description, permissions, is_system
    )
    VALUES (%s, %s, %s, %s::jsonb, %s)
    ON CONFLICT (id) DO UPDATE SET
        name        = EXCLUDED.name,
        description = EXCLUDED.description,
        permissions = EXCLUDED.permissions,
        is_system   = EXCLUDED.is_system,
        updated_at  = (now() AT TIME ZONE 'utc')
"""

SQL_INSERTAR_EMPLEADO = """
    INSERT INTO employees (
        id, name, employee_code, role, is_active, profile_id,
        employee_number, exclude_attendance
    )
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (id) DO UPDATE SET
        name               = EXCLUDED.name,
        employee_code      = EXCLUDED.employee_code,
        role               = EXCLUDED.role,
        is_active          = EXCLUDED.is_active,
        profile_id         = EXCLUDED.profile_id,
        employee_number    = EXCLUDED.employee_number,
        exclude_attendance = EXCLUDED.exclude_attendance,
        updated_at         = (now() AT TIME ZONE 'utc')
"""


def main() -> int:
    titulo("FASE 2.4 — Importación de COLABORADORES (producción → erp_seguridad)")

    # ------------------------------------------------------------------
    # 1. Leer producción (solo lectura, garantizado por rol + sesión)
    # ------------------------------------------------------------------
    print("\n[1/5] Leyendo perfiles y colaboradores de producción…")
    conn_prod = conectar_produccion()
    try:
        with conn_prod.cursor() as cur:
            cur.execute(SQL_LEER_PERFILES)
            filas_perfiles = cur.fetchall()

            cur.execute(SQL_LEER_EMPLEADOS)
            filas_empleados = cur.fetchall()
    finally:
        conn_prod.close()

    if not filas_perfiles:
        fallo("Producción no devolvió ningún perfil de seguridad. Abortando.")
        return 1
    if not filas_empleados:
        fallo("Producción no devolvió ningún colaborador. Abortando.")
        return 1

    ok(f"{len(filas_perfiles)} perfiles leídos de producción.")
    ok(f"{len(filas_empleados)} colaboradores leídos de producción.")

    # ------------------------------------------------------------------
    # 2. Transformar perfiles
    # ------------------------------------------------------------------
    print("\n[2/5] Transformando perfiles…")
    registros_perfiles = []
    for id_prod, name, description, permissions_txt, is_system in filas_perfiles:
        # `permissions` llega como texto JSON desde producción. Se valida que
        # sea JSON parseable antes de escribirlo: un valor corrupto reventaría
        # el cast a jsonb dentro de la transacción y abortaría toda la carga.
        try:
            json.loads(permissions_txt) if permissions_txt else {}
        except json.JSONDecodeError as exc:
            fallo(f"El perfil {name!r} tiene permisos con JSON inválido: {exc}")
            return 1

        registros_perfiles.append((
            uuid_perfil(id_prod),
            name,
            description,
            permissions_txt or "{}",
            bool(is_system),
        ))
    ok(f"{len(registros_perfiles)} perfiles transformados a UUID.")

    # ------------------------------------------------------------------
    # 3. Transformar colaboradores
    # ------------------------------------------------------------------
    print("\n[3/5] Transformando colaboradores…")
    registros_empleados = []
    codigos_vistos: dict[str, int] = {}
    for (id_prod, name, employee_code, role, is_active, profile_id,
         employee_number, exclude_attendance) in filas_empleados:

        # El PIN debe ser único en el destino. Producción ya lo garantiza con
        # un índice único, pero se comprueba aquí para dar un error legible en
        # lugar de un `UniqueViolation` a media transacción.
        if employee_code in codigos_vistos:
            fallo(
                f"PIN duplicado en producción: {employee_code!r} aparece en los "
                f"colaboradores {codigos_vistos[employee_code]} y {id_prod}. "
                "El destino exige unicidad de PIN."
            )
            return 1
        codigos_vistos[employee_code] = id_prod

        registros_empleados.append((
            uuid_empleado(id_prod),
            name,
            employee_code,          # EL PIN: sin transformar
            role or "CAJERO",
            bool(is_active) if is_active is not None else True,
            uuid_perfil(profile_id) if profile_id is not None else None,
            employee_number,
            bool(exclude_attendance) if exclude_attendance is not None else False,
        ))
    ok(f"{len(registros_empleados)} colaboradores transformados a UUID.")

    activos = sum(1 for r in registros_empleados if r[4])
    sin_perfil = sum(1 for r in registros_empleados if r[5] is None)
    ok(f"Activos: {activos}. Sin perfil asignado: {sin_perfil}.")

    # ------------------------------------------------------------------
    # 4. Escribir en el destino (perfiles primero, por la clave foránea)
    # ------------------------------------------------------------------
    print("\n[4/5] Escribiendo en erp_seguridad…")
    conn_dest = conectar_seguridad()
    try:
        with conn_dest.cursor() as cur:
            cur.executemany(SQL_INSERTAR_PERFIL, registros_perfiles)
        ok(f"{len(registros_perfiles)} perfiles insertados/actualizados.")

        with conn_dest.cursor() as cur:
            cur.executemany(SQL_INSERTAR_EMPLEADO, registros_empleados)
        ok(f"{len(registros_empleados)} colaboradores insertados/actualizados.")

        conn_dest.commit()

        with conn_dest.cursor() as cur:
            cur.execute("SELECT count(*) FROM security_profiles")
            total_perfiles = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM employees")
            total_empleados = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM employees WHERE is_active")
            total_activos = cur.fetchone()[0]
    finally:
        conn_dest.close()

    ok(f"Total de perfiles en el destino:      {total_perfiles}.")
    ok(f"Total de colaboradores en el destino: {total_empleados}.")
    ok(f"Colaboradores activos en el destino:  {total_activos}.")

    # ------------------------------------------------------------------
    # 5. Registrar el mapa de IDs
    # ------------------------------------------------------------------
    print("\n[5/5] Registrando mapa de identificadores…")
    for id_prod, name, *_ in filas_perfiles:
        registrar_en_mapa("perfil", id_prod, uuid_perfil(id_prod), name)
    for fila in filas_empleados:
        id_prod, name, employee_code = fila[0], fila[1], fila[2]
        registrar_en_mapa(
            "empleado", id_prod, uuid_empleado(id_prod),
            f"{employee_code} - {name}",
        )
    ok(f"{len(filas_perfiles) + len(filas_empleados)} filas añadidas a "
       "migracion/mapa_ids.csv.")

    # ------------------------------------------------------------------
    # Resumen
    # ------------------------------------------------------------------
    if total_perfiles != len(registros_perfiles):
        aviso(
            f"El destino tiene {total_perfiles} perfiles pero se importaron "
            f"{len(registros_perfiles)}. Hay perfiles creados a mano en el ERP "
            "COMBINADO. No se borran automáticamente: revísalos."
        )
    if total_empleados != len(registros_empleados):
        aviso(
            f"El destino tiene {total_empleados} colaboradores pero se importaron "
            f"{len(registros_empleados)}. Hay colaboradores creados a mano en el "
            "ERP COMBINADO. No se borran automáticamente: revísalos."
        )

    titulo("FASE 2.4 COMPLETADA")
    print(f"  Perfiles importados:      {len(registros_perfiles)}")
    print(f"  Colaboradores importados: {len(registros_empleados)}")
    print(f"  Colaboradores activos:    {activos}")
    print(f"  PINs conservados:         {len(codigos_vistos)} (texto plano, igual que producción)")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
