"""Verifica que la importación de la FASE 2 sea fiel — FASE 2.5.

QUÉ HACE
--------
Compara, campo por campo y agregado por agregado, lo que hay en producción
(`rderico`) contra lo que quedó en el ERP COMBINADO (`erp_pos` + `erp_seguridad`).
Si CUALQUIER comprobación falla, el script termina con código de salida 1 y
enumera exactamente qué no cuadró.

Es la comprobación que convierte "el importador dijo que sí" en "los datos son
los mismos". Sin este script, la FASE 2 sería una promesa; con él, es un hecho
verificable que se puede volver a ejecutar en cualquier momento.

QUÉ COMPARA
-----------
    1. CATEGORÍAS
       - número de categorías
       - conjunto de nombres (no solo el conteo: 20 nombres distintos con el
         mismo conteo seguirían siendo una importación equivocada)
       - distribución de productos por categoría

    2. PRODUCTOS
       - número de productos
       - suma exacta de precios (Numeric, no float — RT-02)
       - suma exacta de costos
       - número de productos activos y de disponibles
       - número de productos con código de barras
       - suma de precios por categoría (detecta un remapeo de category_id mal
         hecho aunque los totales globales cuadren)

    3. COLABORADORES
       - número de perfiles y de colaboradores
       - número de colaboradores activos
       - número de colaboradores sin perfil
       - conjunto de PINs (`employee_code`): deben ser EXACTAMENTE los mismos,
         porque son las credenciales con las que el personal entrará al POS
       - número de PINs distintos (detecta duplicados)
       - integridad referencial: 0 colaboradores con un `profile_id` que no
         exista en `security_profiles`
       - validez de los UUIDs: todos deben ser UUIDv5 del namespace del proyecto

    4. MAPA DE IDENTIFICADORES
       - que exista `migracion/mapa_ids.csv`
       - que tenga una fila por cada registro importado de cada entidad
       - que no haya filas duplicadas para la misma `(entidad, id_produccion)`
       - que cada UUID del mapa sea el UUIDv5 esperado para su id de producción

POR QUÉ NO SE COMPARA `permissions` CON UN DIFF DE TEXTO
--------------------------------------------------------
Producción guarda `permissions` como `json` (preserva el orden de inserción de
las claves) y el destino como `jsonb` (normaliza el orden: primero por longitud
de clave, luego byte a byte). Un `diff` de texto entre ambos SIEMPRE reportaría
diferencias aunque los datos sean idénticos — es un falso positivo garantizado.

Por eso la comparación se hace sobre `(permissions::jsonb)::text` en AMBOS
lados, o mejor aún sobre un hash MD5 del agregado normalizado. Así se compara
el CONTENIDO semántico, no la representación.

USO
---
    python scripts/verificar-importacion.py

    # Dentro de Docker (montando scripts/ y migracion/):
    docker run --rm --network pos_default \
        -v "<repo>/scripts:/scripts" -v "<repo>/migracion:/migracion" \
        -e MAPA_IDS_PATH=/migracion/mapa_ids.csv \
        -e PROD_DB_HOST=host.docker.internal -e PROD_DB_PORT=5433 \
        -e DEST_DB_HOST=db -e DEST_DB_PORT=5432 \
        python:3.12-slim sh -c "pip install -q 'psycopg[binary]>=3.1' && python /scripts/verificar-importacion.py"

CÓDIGO DE SALIDA
----------------
    0  todas las comprobaciones pasaron
    1  al menos una comprobación falló (el detalle se imprime en pantalla)
"""

from __future__ import annotations

import csv
import os
import re
import sys
import uuid
from decimal import Decimal

import psycopg

from importacion_comun import (
    CABECERA_MAPA,
    NAMESPACE_ERP_COMBINADO,
    RUTA_MAPA,
    aviso,
    conectar_produccion,
    fallo,
    ok,
    titulo,
    uuid_categoria,
    uuid_empleado,
    uuid_perfil,
    uuid_producto,
)

# La base destino de los colaboradores NO es `erp_pos` sino `erp_seguridad`.
DEST_SEGURIDAD_DB = os.environ.get("DEST_SEGURIDAD_DB", "erp_seguridad")


# ---------------------------------------------------------------------------
# Infraestructura de comprobación
# ---------------------------------------------------------------------------

class Verificador:
    """Acumula comprobaciones y decide el código de salida.

    Cada comprobación imprime su resultado en el momento, para que el operador
    vea el progreso, y se guarda para el resumen final. El script NO aborta en
    la primera diferencia: las enumera todas, porque quien depura una migración
    quiere ver el panorama completo, no arreglar un fallo por ejecución.
    """

    def __init__(self) -> None:
        self.total = 0
        self.fallos: list[str] = []

    def igual(self, etiqueta: str, produccion: object, destino: object) -> bool:
        """Comprueba que dos valores sean iguales."""
        self.total += 1
        if produccion == destino:
            ok(f"{etiqueta}: {destino}")
            return True
        fallo(f"{etiqueta}: producción={produccion!r} ≠ destino={destino!r}")
        self.fallos.append(etiqueta)
        return False

    def condicion(self, etiqueta: str, cumple: bool, detalle: str = "") -> bool:
        """Comprueba una condición booleana con detalle libre."""
        self.total += 1
        if cumple:
            ok(f"{etiqueta}{(': ' + detalle) if detalle else ''}")
            return True
        fallo(f"{etiqueta}{(': ' + detalle) if detalle else ''}")
        self.fallos.append(etiqueta)
        return False

    def resumen(self) -> int:
        """Imprime el resumen y devuelve el código de salida."""
        print()
        print("=" * 72)
        if self.fallos:
            print(f"VERIFICACIÓN FALLIDA — {len(self.fallos)} de {self.total} "
                  f"comprobaciones no cuadraron")
            print("=" * 72)
            for i, nombre in enumerate(self.fallos, 1):
                print(f"  {i}. {nombre}")
            print()
            return 1
        print(f"VERIFICACIÓN CORRECTA — {self.total} comprobaciones, 0 fallos")
        print("=" * 72)
        print()
        return 0


def conectar_seguridad() -> "psycopg.Connection":
    """Abre una conexión de LECTURA a la base `erp_seguridad`."""
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
            "  ¿Está arriba el contenedor de la base de seguridad?"
        )


def conectar_pos() -> "psycopg.Connection":
    """Abre una conexión de LECTURA a la base `erp_pos`."""
    from importacion_comun import DEST_DB, DEST_HOST, DEST_PASSWORD, DEST_PORT, DEST_USER

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
            f"No se pudo conectar a {DEST_DB} "
            f"({DEST_HOST}:{DEST_PORT} como {DEST_USER}).\n"
            f"  Detalle: {exc}\n"
            "  ¿Está arriba el contenedor erp_combinado_pos_db?"
        )


def _escalar(conn: "psycopg.Connection", sql: str) -> object:
    """Ejecuta una consulta que devuelve un único valor."""
    with conn.cursor() as cur:
        cur.execute(sql)
        fila = cur.fetchone()
    return fila[0] if fila else None


def _filas(conn: "psycopg.Connection", sql: str) -> list[tuple]:
    """Ejecuta una consulta y devuelve todas las filas."""
    with conn.cursor() as cur:
        cur.execute(sql)
        return cur.fetchall()


def _decimal(valor: object) -> Decimal:
    """Normaliza un agregado monetario a Decimal.

    `SUM()` sobre una columna `numeric` devuelve `Decimal`, pero sobre una tabla
    vacía devuelve `None`. Se normaliza a `Decimal('0')` para que la comparación
    no dependa de si hay filas. Nunca se pasa por `float`: RT-02 prohíbe float
    para dinero, y un `float` aquí podría ocultar una diferencia de un centavo.
    """
    if valor is None:
        return Decimal("0")
    if isinstance(valor, Decimal):
        return valor
    return Decimal(str(valor))


# ---------------------------------------------------------------------------
# 1. Categorías
# ---------------------------------------------------------------------------

def verificar_categorias(v: Verificador, prod: "psycopg.Connection",
                         pos: "psycopg.Connection") -> None:
    titulo("1/4 — CATEGORÍAS")

    v.igual(
        "Número de categorías",
        _escalar(prod, "SELECT count(*) FROM public.categories"),
        _escalar(pos, "SELECT count(*) FROM categories"),
    )

    # El conjunto de nombres, no solo el conteo: 20 categorías con nombres
    # distintos seguirían siendo una importación equivocada.
    nombres_prod = {f[0] for f in _filas(prod, "SELECT name FROM public.categories")}
    nombres_dest = {f[0] for f in _filas(pos, "SELECT name FROM categories")}
    v.igual("Conjunto de nombres de categoría", nombres_prod, nombres_dest)

    # Distribución de productos por categoría. Detecta un remapeo de
    # `category_id` que dejara productos colgando de la categoría equivocada
    # aunque el total global de productos cuadrara.
    dist_prod = dict(_filas(prod, """
        SELECT c.name, count(p.id)
        FROM public.categories c
        LEFT JOIN public.products p ON p.category_id = c.id
        GROUP BY c.name
        ORDER BY c.name
    """))
    dist_dest = dict(_filas(pos, """
        SELECT c.name, count(p.id)
        FROM categories c
        LEFT JOIN products p ON p.category_id = c.id
        GROUP BY c.name
        ORDER BY c.name
    """))
    v.igual("Distribución de productos por categoría", dist_prod, dist_dest)


# ---------------------------------------------------------------------------
# 2. Productos
# ---------------------------------------------------------------------------

def verificar_productos(v: Verificador, prod: "psycopg.Connection",
                        pos: "psycopg.Connection") -> None:
    titulo("2/4 — PRODUCTOS")

    v.igual(
        "Número de productos",
        _escalar(prod, "SELECT count(*) FROM public.products"),
        _escalar(pos, "SELECT count(*) FROM products"),
    )

    # Suma EXACTA de precios. Es la comprobación más importante de la fase: si
    # un solo precio se redondeó o se perdió, el POS cobraría distinto que
    # producción y el Strangler Fig sería inseguro.
    v.igual(
        "Suma exacta de precios",
        _decimal(_escalar(prod, "SELECT sum(price) FROM public.products")),
        _decimal(_escalar(pos, "SELECT sum(price) FROM products")),
    )

    v.igual(
        "Suma exacta de costos",
        _decimal(_escalar(prod, "SELECT sum(cost) FROM public.products")),
        _decimal(_escalar(pos, "SELECT sum(cost) FROM products")),
    )

    # OJO con los nombres de columna: producción usa `products.active`, NO
    # `is_active` (comprobado contra information_schema). Y producción NO tiene
    # columna `is_available`: la disponibilidad es un concepto nuevo del POS del
    # ERP COMBINADO, así que no se puede comparar contra producción. Se compara
    # solo `active`, que sí existe en ambos lados.
    v.igual(
        "Productos activos",
        _escalar(prod, "SELECT count(*) FROM public.products WHERE active"),
        _escalar(pos, "SELECT count(*) FROM products WHERE active"),
    )

    # `available` es exclusivo del destino: se informa, no se compara.
    v.condicion(
        "Productos disponibles para venta en el destino (informativo)",
        True,
        str(_escalar(pos, "SELECT count(*) FROM products WHERE active AND available")),
    )

    # Los códigos de barras son la clave natural que usa el cajero para buscar
    # un producto. Si se perdieran, el POS seguiría vendiendo pero el escaneo
    # dejaría de funcionar.
    v.igual(
        "Productos con código de barras",
        _escalar(prod, "SELECT count(*) FROM public.products WHERE barcode IS NOT NULL AND barcode <> ''"),
        _escalar(pos, "SELECT count(*) FROM products WHERE barcode IS NOT NULL AND barcode <> ''"),
    )

    # Suma de precios por categoría: detecta un `category_id` mal remapeado
    # aunque los totales globales cuadren.
    por_cat_prod = dict(_filas(prod, """
        SELECT c.name, sum(p.price)
        FROM public.categories c
        JOIN public.products p ON p.category_id = c.id
        GROUP BY c.name
        ORDER BY c.name
    """))
    por_cat_dest = dict(_filas(pos, """
        SELECT c.name, sum(p.price)
        FROM categories c
        JOIN products p ON p.category_id = c.id
        GROUP BY c.name
        ORDER BY c.name
    """))
    v.igual(
        "Suma de precios por categoría",
        {k: _decimal(x) for k, x in por_cat_prod.items()},
        {k: _decimal(x) for k, x in por_cat_dest.items()},
    )


# ---------------------------------------------------------------------------
# 3. Colaboradores
# ---------------------------------------------------------------------------

RE_UUID_V5 = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


def verificar_colaboradores(v: Verificador, prod: "psycopg.Connection",
                            seg: "psycopg.Connection") -> None:
    titulo("3/4 — COLABORADORES Y PERFILES")

    v.igual(
        "Número de perfiles de seguridad",
        _escalar(prod, "SELECT count(*) FROM public.security_profiles"),
        _escalar(seg, "SELECT count(*) FROM security_profiles"),
    )

    v.igual(
        "Número de colaboradores",
        _escalar(prod, "SELECT count(*) FROM public.employees"),
        _escalar(seg, "SELECT count(*) FROM employees"),
    )

    v.igual(
        "Colaboradores activos",
        _escalar(prod, "SELECT count(*) FROM public.employees WHERE is_active"),
        _escalar(seg, "SELECT count(*) FROM employees WHERE is_active"),
    )

    v.igual(
        "Colaboradores sin perfil asignado",
        _escalar(prod, "SELECT count(*) FROM public.employees WHERE profile_id IS NULL"),
        _escalar(seg, "SELECT count(*) FROM employees WHERE profile_id IS NULL"),
    )

    # LOS PINs. Es la comprobación que decide si el personal podrá entrar al POS
    # el día del cambio. Se comparan los CONJUNTOS, no solo el conteo: 64 PINs
    # distintos en ambos lados podrían ser 64 PINs completamente diferentes.
    pins_prod = {f[0] for f in _filas(prod, "SELECT employee_code FROM public.employees")}
    pins_dest = {f[0] for f in _filas(seg, "SELECT employee_code FROM employees")}
    v.igual("Conjunto exacto de PINs (employee_code)", pins_prod, pins_dest)

    v.igual(
        "PINs distintos en el destino (sin duplicados)",
        len(pins_prod),
        _escalar(seg, "SELECT count(DISTINCT employee_code) FROM employees"),
    )

    # Integridad referencial: ningún colaborador debe apuntar a un perfil
    # inexistente. Un huérfano aquí significaría que el remapeo de `profile_id`
    # falló y ese colaborador entraría al POS sin permisos.
    v.igual(
        "Colaboradores con perfil huérfano (debe ser 0)",
        0,
        _escalar(seg, """
            SELECT count(*)
            FROM employees e
            LEFT JOIN security_profiles p ON p.id = e.profile_id
            WHERE e.profile_id IS NOT NULL AND p.id IS NULL
        """),
    )

    # Todos los identificadores del destino deben ser UUIDv5 del namespace del
    # proyecto. Un UUIDv4 colado aquí rompería la idempotencia del importador.
    v.igual(
        "Colaboradores con id que no es UUIDv5 (debe ser 0)",
        0,
        _escalar(seg, """
            SELECT count(*) FROM employees
            WHERE id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        """),
    )
    v.igual(
        "Perfiles con id que no es UUIDv5 (debe ser 0)",
        0,
        _escalar(seg, """
            SELECT count(*) FROM security_profiles
            WHERE id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        """),
    )

    # Contenido semántico de los permisos. Se normaliza a jsonb en AMBOS lados
    # antes de hashear, porque producción usa `json` (preserva orden de claves) y
    # el destino `jsonb` (las reordena). Comparar el texto crudo daría un falso
    # positivo garantizado.
    hash_prod = _escalar(prod, """
        SELECT md5(string_agg(
            name || '|' || COALESCE(description, '') || '|' ||
            (permissions::jsonb)::text || '|' || is_system::text,
            E'\\n' ORDER BY name
        ))
        FROM public.security_profiles
    """)
    hash_dest = _escalar(seg, """
        SELECT md5(string_agg(
            name || '|' || COALESCE(description, '') || '|' ||
            permissions::text || '|' || is_system::text,
            E'\\n' ORDER BY name
        ))
        FROM security_profiles
    """)
    v.igual("Huella MD5 de perfiles (nombre+descripción+permisos+is_system)",
            hash_prod, hash_dest)

    # Los nombres y roles de los colaboradores, comparados como conjunto.
    ident_prod = {
        (f[0], f[1], f[2], f[3])
        for f in _filas(prod, """
            SELECT name, employee_code, role, is_active
            FROM public.employees
        """)
    }
    ident_dest = {
        (f[0], f[1], f[2], f[3])
        for f in _filas(seg, """
            SELECT name, employee_code, role, is_active
            FROM employees
        """)
    }
    v.igual("Conjunto (nombre, PIN, rol, activo) de colaboradores",
            ident_prod, ident_dest)


# ---------------------------------------------------------------------------
# 4. Mapa de identificadores
# ---------------------------------------------------------------------------

def verificar_mapa(v: Verificador, prod: "psycopg.Connection",
                   pos: "psycopg.Connection", seg: "psycopg.Connection") -> None:
    titulo("4/4 — MAPA DE IDENTIFICADORES (migracion/mapa_ids.csv)")

    if not RUTA_MAPA.exists():
        v.condicion("El mapa de IDs existe", False, str(RUTA_MAPA))
        return
    v.condicion("El mapa de IDs existe", True, str(RUTA_MAPA))

    with RUTA_MAPA.open("r", newline="", encoding="utf-8") as fh:
        lector = csv.reader(fh)
        cabecera = next(lector, None)
        filas = [f for f in lector if len(f) == len(CABECERA_MAPA)]

    v.igual("Cabecera del mapa", CABECERA_MAPA, cabecera)

    # Una fila por registro importado de cada entidad.
    esperado = {
        "categoria": _escalar(prod, "SELECT count(*) FROM public.categories"),
        "producto": _escalar(prod, "SELECT count(*) FROM public.products"),
        "perfil": _escalar(prod, "SELECT count(*) FROM public.security_profiles"),
        "empleado": _escalar(prod, "SELECT count(*) FROM public.employees"),
    }
    obtenido: dict[str, int] = {}
    for fila in filas:
        obtenido[fila[0]] = obtenido.get(fila[0], 0) + 1
    v.igual("Filas del mapa por entidad", esperado, obtenido)

    # Sin duplicados: la clave es `(entidad, id_produccion)`.
    claves = [(f[0], f[1]) for f in filas]
    v.igual("Filas únicas en el mapa (entidad, id_produccion)",
            len(claves), len(set(claves)))

    # Cada UUID del mapa debe ser exactamente el UUIDv5 esperado para su id de
    # producción. Esto detecta un mapa que se escribió con un namespace distinto
    # o con la clave equivocada: parecería correcto pero apuntaría a otro sitio.
    generadores = {
        "categoria": uuid_categoria,
        "producto": uuid_producto,
        "perfil": uuid_perfil,
        "empleado": uuid_empleado,
    }
    incoherentes: list[str] = []
    for entidad, id_prod, uuid_txt, *_ in filas:
        generador = generadores.get(entidad)
        if generador is None:
            incoherentes.append(f"{entidad}:{id_prod} (entidad desconocida)")
            continue
        try:
            esperado_uuid = generador(int(id_prod))
        except (TypeError, ValueError):
            incoherentes.append(f"{entidad}:{id_prod} (id no numérico)")
            continue
        if uuid_txt != str(esperado_uuid):
            incoherentes.append(f"{entidad}:{id_prod} ({uuid_txt} ≠ {esperado_uuid})")

    v.condicion(
        "UUIDs del mapa coherentes con el namespace del proyecto",
        not incoherentes,
        f"{len(incoherentes)} incoherentes" if incoherentes else "todos coherentes",
    )
    for detalle in incoherentes[:10]:
        print(f"           · {detalle}")
    if len(incoherentes) > 10:
        print(f"           · … y {len(incoherentes) - 10} más")

    # Todos los UUIDs del mapa deben ser UUIDv5 válidos.
    invalidos = [f for f in filas if not RE_UUID_V5.match(f[2])]
    v.condicion(
        "Todos los UUIDs del mapa son UUIDv5 válidos",
        not invalidos,
        f"{len(invalidos)} inválidos" if invalidos else "todos válidos",
    )

    # El namespace declarado en el módulo debe ser el que se usó. Si alguien lo
    # cambia, todos los UUIDs ya importados dejan de ser reproducibles.
    v.igual(
        "Namespace del proyecto",
        "6f1c9a3e-2b47-5d8a-9c31-0e7b4f2a8d15",
        str(NAMESPACE_ERP_COMBINADO),
    )

    # Los UUIDs del mapa deben existir realmente en el destino. Un mapa que
    # apunta a filas inexistentes es peor que no tener mapa: da falsa confianza.
    uuids_cat = {f[2] for f in filas if f[0] == "categoria"}
    uuids_prod = {f[2] for f in filas if f[0] == "producto"}
    uuids_perf = {f[2] for f in filas if f[0] == "perfil"}
    uuids_emp = {f[2] for f in filas if f[0] == "empleado"}

    existentes_cat = {str(f[0]) for f in _filas(pos, "SELECT id FROM categories")}
    existentes_prod = {str(f[0]) for f in _filas(pos, "SELECT id FROM products")}
    existentes_perf = {str(f[0]) for f in _filas(seg, "SELECT id FROM security_profiles")}
    existentes_emp = {str(f[0]) for f in _filas(seg, "SELECT id FROM employees")}

    v.condicion("Categorías del mapa existen en erp_pos",
                uuids_cat <= existentes_cat,
                f"{len(uuids_cat - existentes_cat)} ausentes")
    v.condicion("Productos del mapa existen en erp_pos",
                uuids_prod <= existentes_prod,
                f"{len(uuids_prod - existentes_prod)} ausentes")
    v.condicion("Perfiles del mapa existen en erp_seguridad",
                uuids_perf <= existentes_perf,
                f"{len(uuids_perf - existentes_perf)} ausentes")
    v.condicion("Colaboradores del mapa existen en erp_seguridad",
                uuids_emp <= existentes_emp,
                f"{len(uuids_emp - existentes_emp)} ausentes")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> int:
    titulo("FASE 2.5 — VERIFICACIÓN DE LA IMPORTACIÓN (producción vs ERP COMBINADO)")

    v = Verificador()

    print("\nConectando…")
    prod = conectar_produccion()
    pos = conectar_pos()
    seg = conectar_seguridad()
    ok("Conexiones abiertas (producción en solo lectura).")

    try:
        verificar_categorias(v, prod, pos)
        verificar_productos(v, prod, pos)
        verificar_colaboradores(v, prod, seg)
        verificar_mapa(v, prod, pos, seg)
    finally:
        prod.close()
        pos.close()
        seg.close()

    codigo = v.resumen()

    if codigo == 0:
        print("La importación de la FASE 2 es FIEL: el ERP COMBINADO tiene los")
        print("mismos datos que producción en las cuatro cosas que se trajeron.")
        print()
    else:
        aviso("No cierres la FASE 2 hasta que todas las comprobaciones pasen.")
        print()

    return codigo


if __name__ == "__main__":
    sys.exit(main())
