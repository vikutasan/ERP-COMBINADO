# REPORTE DE VERIFICACIÓN — FASE 2 (Importación de producción)

**Fecha de ejecución:** 2026-10-23 (UTC)
**Script:** [`scripts/verificar-importacion.py`](../scripts/verificar-importacion.py)
**Resultado:** ✅ **VERIFICACIÓN CORRECTA — 32 comprobaciones, 0 fallos** (exit 0)

---

## Comando ejecutado

```bash
docker run --rm --network pos_default \
  -v "$(pwd)/../ERP-COMBINADO/scripts:/scripts" \
  -v "$(pwd)/../ERP-COMBINADO/migracion:/migracion" \
  -e MAPA_IDS_PATH=/migracion/mapa_ids.csv \
  -e PROD_DB_HOST=host.docker.internal -e PROD_DB_PORT=5433 \
  -e DEST_DB_HOST=db -e DEST_DB_PORT=5432 \
  python:3.12-slim sh -c "pip install -q 'psycopg[binary]>=3.1' && python /scripts/verificar-importacion.py"
```

Producción se lee con el rol de **solo lectura** `erp_combinado_lectura` (FASE 2.1).
Ninguna escritura toca `ERP-R-DE-RICO` (REGLA 0 respetada).

---

## 1/4 — CATEGORÍAS

| Comprobación | Resultado |
|---|---|
| Número de categorías | **20** ✅ |
| Conjunto de nombres de categoría | idéntico ✅ |
| Distribución de productos por categoría | idéntica ✅ |

Nombres verificados: `1.-EMPAQUE Y PAN BLANCO`, `2.-A - B`, `3.-C - D`, `4.-E F G H I J K`,
`5.-L - M`, `6.-N O P Q`, `7.-R - S`, `8.-T U V W Y Z`, `9.-LACTEOS`, `10.-SOBRE PEDIDO`,
`11.-ESPORADICOS`, `12.-CAFES Y CHOCOLATES`, `13.-SOUVENIRS`, `14.-HELADOS`, `15.-PALETAS`,
`16.-AGUAS Y MALTEADAS`, `17.-ROSCA DE REYES`, `BOLAS DE HELADO`, `DESCONTINUADOS`, `HOJALDRAS`.

---

## 2/4 — PRODUCTOS

| Comprobación | Resultado |
|---|---|
| Número de productos | **392** ✅ |
| Suma exacta de precios | **15354.00** ✅ |
| Suma exacta de costos | **0.00** ✅ |
| Productos activos | **388** ✅ |
| Productos disponibles para venta (informativo) | **388** ✅ |
| Productos con código de barras | **315** ✅ |
| Suma de precios por categoría | idéntica en las 20 categorías ✅ |

Suma de precios por categoría (Decimal, sin flotantes — RT-02):

```
10.-SOBRE PEDIDO        307.00     11.-ESPORADICOS          390.00
12.-CAFES Y CHOCOLATES  526.00     13.-SOUVENIRS            360.00
14.-HELADOS            3572.00     15.-PALETAS              154.00
16.-AGUAS Y MALTEADAS   111.00     17.-ROSCA DE REYES      3705.00
1.-EMPAQUE Y PAN BLANCO 218.00     2.-A - B                 236.00
3.-C - D                462.00     4.-E F G H I J K         242.00
5.-L - M                247.00     6.-N O P Q              1213.00
7.-R - S               1064.00     8.-T U V W Y Z           145.00
9.-LACTEOS              329.00     BOLAS DE HELADO          120.00
DESCONTINUADOS          166.00     HOJALDRAS               1787.00
```

---

## 3/4 — COLABORADORES Y PERFILES

| Comprobación | Resultado |
|---|---|
| Número de perfiles de seguridad | **6** ✅ |
| Número de colaboradores | **64** ✅ |
| Colaboradores activos | **36** ✅ |
| Colaboradores sin perfil asignado | **1** ✅ |
| Conjunto exacto de PINs (`employee_code`) | idéntico (64) ✅ |
| PINs distintos en destino (sin duplicados) | **64** ✅ |
| Colaboradores con perfil huérfano | **0** ✅ |
| Colaboradores con id que no es UUIDv5 | **0** ✅ |
| Perfiles con id que no es UUIDv5 | **0** ✅ |
| Huella MD5 de perfiles | `79ce2c7d342645406b345449dc9bfed9` ✅ |
| Conjunto (nombre, PIN, rol, activo) | idéntico ✅ |

---

## 4/4 — MAPA DE IDENTIFICADORES (`migracion/mapa_ids.csv`)

| Comprobación | Resultado |
|---|---|
| El mapa de IDs existe | ✅ |
| Cabecera del mapa | `entidad, id_produccion, uuid_combinado, clave_natural, importado_en_utc` ✅ |
| Filas por entidad | `categoria: 20`, `producto: 392`, `perfil: 6`, `empleado: 64` ✅ |
| Filas únicas `(entidad, id_produccion)` | **482** ✅ |
| UUIDs coherentes con el namespace del proyecto | todos ✅ |
| Todos los UUIDs son UUIDv5 válidos | todos ✅ |
| Namespace del proyecto | `6f1c9a3e-2b47-5d8a-9c31-0e7b4f2a8d15` ✅ |
| Categorías del mapa existen en `erp_pos` | 0 ausentes ✅ |
| Productos del mapa existen en `erp_pos` | 0 ausentes ✅ |
| Perfiles del mapa existen en `erp_seguridad` | 0 ausentes ✅ |
| Colaboradores del mapa existen en `erp_seguridad` | 0 ausentes ✅ |

---

## Conclusión

La importación de la FASE 2 es **FIEL**: el ERP COMBINADO tiene exactamente los mismos
datos que producción en las cuatro cosas que se trajeron (categorías, productos con sus
precios, perfiles y colaboradores con sus credenciales de acceso), y nada más.

El mapa `migracion/mapa_ids.csv` permite trazar cualquier entidad del ERP COMBINADO de
vuelta a su `id_produccion` original, lo que habilita la auditoría cruzada y el rollback.

---

## Evidencia complementaria — FASE 2.7 (venta end-to-end)

El POS del ERP COMBINADO completa una venta real contra este catálogo importado.
Script: [`scripts/smoke-venta.py`](../scripts/smoke-venta.py) — **36/36 comprobaciones OK**.

```
1) Salud del API ......................... ok / erp-combinado-pos-api
2) Catálogo importado .................... 388 productos · 18 categorías
3) Sesión de terminal .................... SMOKE-01
4) Turno de caja ......................... abierto (línea base 0.00)
5) Crear ticket (contrato 3) ............. V0005 · OPEN · 850.00 × 2 = 1700.00
6) Añadir ítem atómico (contrato 18) ..... total acumulado 2400.00
7) Lectura del ticket .................... contrato 21 (5 escalares) + contrato 30 (2 líneas)
8) Cobro (contrato 5) .................... PAID · 2400.00 · version 1 → 2
9) Resumen del turno ..................... Δ ventas 2400.00 · Δ transacciones 1 · Δ esperado 2400.00
10) Cierre del turno ..................... capturado 2400.00 · diferencia 0.00
```

## Evidencia complementaria — regresiones

| Suite | Resultado |
|---|---|
| `pytest` en `erp_combinado_pos_api` | **420 passed**, 13 warnings |
| `scripts/guard-produccion.mjs` | 356 archivos, **0 violaciones** (REGLA 0 + REGLA 1) |
| `scripts/verificar-puertos.mjs` | 17 módulos, **0 conflictos** |
