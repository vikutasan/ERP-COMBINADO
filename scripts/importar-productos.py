"""Importa los productos de producción al ERP COMBINADO — FASE 2.3.

QUÉ HACE
--------
Lee las 392 filas de `public.products` en producción (solo lectura, REGLA 0) y
las escribe en `public.products` de `erp_pos` (la base del POS del ERP
COMBINADO), con UUIDs nuevos y deterministas.

MAPEO DE COLUMNAS — producción (14) → destino (13)
--------------------------------------------------
    producción                     destino            tratamiento
    ----------------------------   ----------------   -------------------------
    id            integer          id uuid            uuid_producto(id)  [1]
    sku           varchar          sku                copia literal
    barcode       varchar          barcode            copia; NULL se queda NULL
    name          varchar          name               copia literal
    price         numeric(12,2)    price              copia exacta (DT-02)
    cost          numeric(12,2)    cost               copia exacta (DT-02)
    image_url     varchar          image_url          copia literal
    position      integer          position           copia literal
    nature        varchar          nature             copia literal
    category_id   integer          category_id uuid   uuid_categoria(...) [2]
    active        boolean (null)   active NOT NULL    COALESCE(active, true)
    —             —                available          true (ver [3])
    —             —                unit_of_sale       'PZA' (ver [3])
    stock         double precision —                  DESCARTADO (REGLA 9) [4]
    warehouse     varchar          —                  DESCARTADO (REGLA 9) [4]

[1] UUID DETERMINISTA, no aleatorio. `uuid5(namespace_fijo, "producto:<id>")`
    produce siempre el mismo UUID para el mismo producto de producción. Eso es
    lo que hace el importador idempotente: re-ejecutarlo actualiza las mismas
    filas en lugar de duplicarlas. Un `uuid4()` rompería esa propiedad.

[2] REMAPEO DE LA CLAVE FORÁNEA. Producción usa enteros; el destino usa UUID.
    El UUID de la categoría NO se inventa aquí: se deriva con la MISMA función
    `uuid_categoria()` que usó `importar-categorias.py`. Por eso el orden de
    ejecución importa: las categorías deben importarse ANTES que los productos.
    Si una categoría no existe en el destino, la FK falla y el script aborta
    con un mensaje que dice exactamente cuál falta.

[3] `available` y `unit_of_sale` no existen en producción (se añadieron en la
    migración 0012 del POS). Se dejan en sus valores por defecto: todo el
    catálogo importado queda visible y vendible por pieza. Si más adelante
    algún producto debe ocultarse del POS sin desactivarse, se marca
    `available = false` desde Gestión de Productos, no aquí.

[4] REGLA 9 — `stock` y `warehouse` NO se copian. El stock es propiedad del
    módulo Warehouse y vive en `stock_almacen` + el libro inmutable
    `movimientos_inventario`; nadie escribe `products.stock`. Además el alcance
    aprobado dice que el inventario NO es operativo: no hay validación de stock
    al vender. Copiar el stock de producción sería importar un dato que el nuevo
    sistema no va a usar y que además violaría la regla de propiedad.

IDEMPOTENCIA
------------
`INSERT ... ON CONFLICT (id) DO UPDATE` sobre la PK. Re-ejecutar el script
actualiza nombre, precio, costo, categoría, etc. de las filas ya importadas y
no crea duplicados. El conteo final debe ser siempre 392.

ORDEN DE EJECUCIÓN
------------------
    1. importar-categorias.py   (debe ir primero: crea las categorías)
    2. importar-productos.py    (este script)
    3. importar-colaboradores.py

USO
---
    python scripts/importar-productos.py

Variables de entorno (con valores por defecto para el entorno local):
    PROD_DB_HOST/PORT/NAME/USER/PASSWORD   — producción, rol de solo lectura
    DEST_DB_HOST/PORT/NAME/USER/PASSWORD   — erp_pos del ERP COMBINADO
"""

from __future__ import annotations

import sys
from decimal import Decimal

from importacion_comun import (
    aviso,
    conectar_destino,
    conectar_produccion,
    fallo,
    ok,
    registrar_en_mapa,
    titulo,
    uuid_categoria,
    uuid_producto,
)

# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

# Lectura de producción. Se listan las columnas explícitamente (nunca `SELECT *`)
# para que un cambio de esquema en producción haga fallar el script en vez de
# desalinear silenciosamente el mapeo.
SQL_LEER_PRODUCCION = """
    SELECT id, sku, barcode, name, price, cost, image_url, position,
           nature, category_id, active
      FROM public.products
     ORDER BY id
"""

# Escritura en el destino. `ON CONFLICT (id) DO UPDATE` es lo que da la
# idempotencia: la segunda corrida actualiza en vez de duplicar.
SQL_ESCRIBIR_PRODUCTO = """
    INSERT INTO public.products
        (id, sku, barcode, name, price, cost, image_url, position,
         nature, category_id, active, available, unit_of_sale)
    VALUES
        (%(id)s, %(sku)s, %(barcode)s, %(name)s, %(price)s, %(cost)s,
         %(image_url)s, %(position)s, %(nature)s, %(category_id)s,
         %(active)s, TRUE, 'PZA')
    ON CONFLICT (id) DO UPDATE SET
        sku         = EXCLUDED.sku,
        barcode     = EXCLUDED.barcode,
        name        = EXCLUDED.name,
        price       = EXCLUDED.price,
        cost        = EXCLUDED.cost,
        image_url   = EXCLUDED.image_url,
        position    = EXCLUDED.position,
        nature      = EXCLUDED.nature,
        category_id = EXCLUDED.category_id,
        active      = EXCLUDED.active
"""

SQL_CONTAR_DESTINO = "SELECT count(*) FROM public.products"

SQL_CATEGORIAS_EXISTENTES = "SELECT id FROM public.categories"


# ---------------------------------------------------------------------------
# Transformación
# ---------------------------------------------------------------------------

def transformar(fila: tuple) -> dict:
    """Convierte una fila de producción en los parámetros del INSERT destino.

    Es una función pura: no toca la base de datos. Así el mapeo se puede leer,
    revisar y probar sin conexión.
    """
    (id_prod, sku, barcode, name, price, cost, image_url, position,
     nature, category_id, active) = fila

    # `barcode` vacío en producción se normaliza a NULL. El destino tiene
    # `uq_products_barcode` UNIQUE, y PostgreSQL considera distintos dos NULL,
    # así que 77 productos sin código de barras conviven sin problema. Una
    # cadena vacía, en cambio, chocaría contra sí misma a partir del segundo.
    barcode_limpio = barcode.strip() if isinstance(barcode, str) else barcode
    if barcode_limpio == "":
        barcode_limpio = None

    return {
        "id": uuid_producto(id_prod),
        "sku": sku,
        "barcode": barcode_limpio,
        "name": name,
        # DT-02: el dinero viaja como Decimal, nunca como float. psycopg lo
        # adapta a numeric(12,2) sin pérdida.
        "price": Decimal(str(price)),
        "cost": Decimal(str(cost)) if cost is not None else Decimal("0"),
        "image_url": image_url,
        "position": position,
        "nature": nature if nature else "MANUFACTURADO",
        # Remapeo de la FK: entero de producción → UUID determinista.
        "category_id": uuid_categoria(category_id) if category_id is not None else None,
        # Producción permite NULL en `active`; el destino es NOT NULL.
        "active": True if active is None else bool(active),
    }


# ---------------------------------------------------------------------------
# Programa principal
# ---------------------------------------------------------------------------

def main() -> int:
    titulo("FASE 2.3 — Importación de PRODUCTOS (producción → ERP COMBINADO)")

    # --- Paso 1: leer producción (solo lectura) ---------------------------
    print("\n[1/4] Leyendo productos de producción (solo lectura)…")
    try:
        conn_prod = conectar_produccion()
    except SystemExit:
        raise
    with conn_prod.cursor() as cur:
        cur.execute(SQL_LEER_PRODUCCION)
        filas = cur.fetchall()
    conn_prod.close()

    if not filas:
        fallo("Producción devolvió 0 productos. Se aborta sin escribir nada.")
        return 1
    ok(f"{len(filas)} productos leídos de producción.")

    # --- Paso 2: transformar ---------------------------------------------
    print("\n[2/4] Transformando registros (UUIDs nuevos + remapeo de categoría)…")
    registros = [transformar(f) for f in filas]
    ok(f"{len(registros)} registros transformados.")

    sin_categoria = sum(1 for r in registros if r["category_id"] is None)
    sin_barcode = sum(1 for r in registros if r["barcode"] is None)
    inactivos = sum(1 for r in registros if not r["active"])
    if sin_categoria:
        aviso(f"{sin_categoria} producto(s) sin categoría (category_id NULL).")
    if sin_barcode:
        aviso(f"{sin_barcode} producto(s) sin código de barras (barcode NULL).")
    if inactivos:
        aviso(f"{inactivos} producto(s) inactivo(s) (active = false).")

    # --- Paso 3: escribir en el destino ----------------------------------
    print("\n[3/4] Escribiendo en erp_pos.products…")
    conn_dest = conectar_destino()

    # Verificación previa de la FK: si falta alguna categoría, la escritura
    # fallaría a mitad de lote con un error de FK poco descriptivo. Mejor
    # detectarlo antes y decir exactamente qué categorías faltan.
    with conn_dest.cursor() as cur:
        cur.execute(SQL_CATEGORIAS_EXISTENTES)
        categorias_destino = {row[0] for row in cur.fetchall()}

    requeridas = {r["category_id"] for r in registros if r["category_id"] is not None}
    faltantes = requeridas - categorias_destino
    if faltantes:
        conn_dest.close()
        fallo(
            f"Faltan {len(faltantes)} categoría(s) en el destino. "
            "Ejecuta primero scripts/importar-categorias.py."
        )
        for uuid_faltante in sorted(str(u) for u in faltantes)[:10]:
            print(f"         - {uuid_faltante}")
        return 1
    ok(f"Las {len(requeridas)} categorías referenciadas existen en el destino.")

    try:
        with conn_dest.cursor() as cur:
            cur.executemany(SQL_ESCRIBIR_PRODUCTO, registros)
        conn_dest.commit()
    except Exception as exc:  # noqa: BLE001 - se reporta y se revierte
        conn_dest.rollback()
        conn_dest.close()
        fallo(f"Error al escribir los productos: {exc}")
        return 1

    with conn_dest.cursor() as cur:
        cur.execute(SQL_CONTAR_DESTINO)
        total_destino = cur.fetchone()[0]
    conn_dest.close()

    ok(f"{len(registros)} productos insertados/actualizados.")
    ok(f"Total de productos en el destino: {total_destino}")

    # --- Paso 4: registrar el mapa de IDs --------------------------------
    print("\n[4/4] Registrando el mapa id_produccion → uuid_combinado…")
    for fila, registro in zip(filas, registros):
        registrar_en_mapa(
            entidad="producto",
            id_produccion=fila[0],
            uuid_combinado=registro["id"],
            clave_natural=registro["sku"],
        )
    ok(f"{len(registros)} filas añadidas a migracion/mapa_ids.csv")

    # --- Veredicto --------------------------------------------------------
    print()
    if total_destino != len(registros):
        aviso(
            f"El destino tiene {total_destino} productos y se importaron "
            f"{len(registros)}. La diferencia son filas preexistentes que no "
            "vienen de producción (no se borran automáticamente)."
        )
    print("=" * 72)
    print("FASE 2.3 COMPLETADA")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
