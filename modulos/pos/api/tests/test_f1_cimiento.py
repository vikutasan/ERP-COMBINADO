"""Puerta de FASE 1 — Cimiento de datos.

Verifica los 4 criterios de la puerta (Plan de Construcción §3.3) contra el
esquema REAL en PostgreSQL, no contra los modelos de Python. La evidencia es
la consulta, no la intención.

  CA-06  Todas las PK son UUID.
  CA-07  Todos los timestamps son `timestamp with time zone`.
  CA-08  Ninguna columna monetaria es Float.
  CA-09  El ledger rechaza un UPDATE directo (es inmutable).
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

# Las 17 tablas del Documento 8.
LAS_17_TABLAS = [
    "terminal_sessions",
    "tickets",
    "ticket_items",
    "terminal_locks",
    "cash_sessions",
    "cash_movements",
    "categories",
    "products",
    "product_technical_sheets",
    "orders",
    "almacenes",
    "stock_almacen",
    "movimientos_inventario",
    "warehouse_events",
    "warehouse_eventos_sin_almacen",
    "heladeria_product_config",
    "ticket_item_components",
]


@pytest.mark.asyncio
async def test_ca06_todas_las_pk_son_uuid(conn):
    """CA-06: ninguna tabla usa entero autoincremental como PK."""
    resultado = await conn.execute(
        text(
            """
            SELECT table_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND column_name = 'id'
              AND table_name = ANY(:tablas)
            """
        ),
        {"tablas": LAS_17_TABLAS},
    )
    filas = resultado.fetchall()
    # Deben aparecer las 17 tablas.
    assert len(filas) == 17, f"Se esperaban 17 tablas con PK 'id', hay {len(filas)}"
    for table_name, data_type in filas:
        assert data_type == "uuid", f"{table_name}.id es {data_type}, no uuid"


@pytest.mark.asyncio
async def test_ca07_todos_los_timestamps_son_utc(conn):
    """CA-07: ninguna columna de fecha es `timestamp without time zone`."""
    resultado = await conn.execute(
        text(
            """
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND data_type LIKE 'timestamp%'
              AND table_name = ANY(:tablas)
            """
        ),
        {"tablas": LAS_17_TABLAS},
    )
    filas = resultado.fetchall()
    assert len(filas) > 0, "No se encontró ninguna columna de tiempo (¿migración aplicada?)"
    for table_name, column_name, data_type in filas:
        assert data_type == "timestamp with time zone", (
            f"{table_name}.{column_name} es '{data_type}', no 'timestamp with time zone'"
        )


@pytest.mark.asyncio
async def test_ca08_el_dinero_nunca_es_float(conn):
    """CA-08: ninguna columna monetaria es `double precision` ni `real`."""
    resultado = await conn.execute(
        text(
            """
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND data_type IN ('double precision', 'real')
              AND column_name ~ 'total|precio|price|monto|importe|fee'
              AND table_name = ANY(:tablas)
            """
        ),
        {"tablas": LAS_17_TABLAS},
    )
    filas = resultado.fetchall()
    assert filas == [], f"Columnas monetarias en Float: {filas}"


@pytest.mark.asyncio
async def test_ca09_el_ledger_rechaza_update(conn):
    """CA-09 / E-12: el ledger es inmutable; un UPDATE directo falla."""
    # Insertar un asiento de prueba.
    await conn.execute(
        text(
            """
            INSERT INTO movimientos_inventario
                (id, item_id, item_type, cantidad, tipo_movimiento,
                 metodo_captura, usuario_id, timestamp)
            VALUES
                (gen_random_uuid(), 'SKU-TEST-LEDGER', 'PRODUCTO', 1.0,
                 'ENTRADA_COMPRA', 'TEST', gen_random_uuid(), now())
            """
        )
    )
    await conn.commit()

    # Intentar un UPDATE directo: el trigger debe rechazarlo.
    with pytest.raises(Exception) as excinfo:
        await conn.execute(
            text(
                "UPDATE movimientos_inventario SET cantidad = 99 "
                "WHERE item_id = 'SKU-TEST-LEDGER'"
            )
        )
        await conn.commit()
    assert "inmutable" in str(excinfo.value).lower(), (
        f"El UPDATE no fue rechazado por el guardián del ledger: {excinfo.value}"
    )

    # Limpieza: el DELETE también está bloqueado, así que se desactiva el
    # trigger solo para limpiar la fila de prueba.
    await conn.rollback()
    await conn.execute(text("ALTER TABLE movimientos_inventario DISABLE TRIGGER trg_ledger_inmutable"))
    await conn.execute(
        text("DELETE FROM movimientos_inventario WHERE item_id = 'SKU-TEST-LEDGER'")
    )
    await conn.execute(text("ALTER TABLE movimientos_inventario ENABLE TRIGGER trg_ledger_inmutable"))
    await conn.commit()
