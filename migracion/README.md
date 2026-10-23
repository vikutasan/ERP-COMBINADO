# Migración de datos — Producción → ERP COMBINADO

Esta carpeta contiene **todo** lo necesario para traer, de forma **estrictamente
de solo lectura**, los cuatro datos que el ERP COMBINADO hereda de producción:

| # | Dato | Tabla de origen | Tabla destino | Fase |
|---|------|-----------------|---------------|------|
| 1 | Categorías | `public.categories` | `erp_catalogo.categories` | 2.2 |
| 2 | Productos y precios | `public.products` | `erp_catalogo.products` | 2.3 |
| 3 | Perfiles de seguridad | `public.security_profiles` | `erp_seguridad.security_profiles` | 2.4 |
| 4 | Colaboradores (PIN de acceso) | `public.employees` | `erp_seguridad.employees` | 2.4 |

**No se migra nada más.** En particular: **cero historial de ventas**, cero
tickets, cero movimientos de inventario, cero auditoría. Las ventas del ERP
COMBINADO empiezan en cero por decisión del usuario.

---

## REGLA 0 — cómo se garantiza que producción no se toca

La garantía **no** es una convención ni una promesa del agente. Es el motor de
PostgreSQL. Los scripts de importación se conectan con el rol
`erp_combinado_lectura`, que:

- tiene `SELECT` sobre **exactamente cuatro tablas**;
- **no** tiene `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` ni `TRIGGER`
  sobre ninguna tabla;
- **no** tiene `CREATE` sobre el esquema `public`;
- **no** es superusuario, ni puede crear bases de datos, ni crear roles.

Un `UPDATE` accidental no corrompe datos: **falla**. Verificado empíricamente
(ver §Verificación).

---

## Orden de ejecución

Los scripts se ejecutan **desde la raíz de `ERP-R-DE-RICO`** (el contenedor de
producción vive ahí). Las rutas a esta carpeta son relativas a esa raíz.

### Paso 1 — Crear el rol de solo lectura (FASE 2.1)

```cmd
docker exec -i rderico-db-dev psql -U user -d rderico -v ON_ERROR_STOP=1 < ..\ERP-COMBINADO\migracion\01_rol_lectura.sql
```

Idempotente: se puede ejecutar varias veces. Si el rol ya existe, re-otorga los
privilegios (converge al estado declarado).

### Paso 2 — Verificar el rol (FASE 2.1)

```cmd
docker exec -i rderico-db-dev psql -U user -d rderico -v ON_ERROR_STOP=1 < ..\ERP-COMBINADO\migracion\02_verificar_rol.sql
```

Debe terminar con `OK — 4 tablas legibles, 0 escribibles`.

### Paso 3 — Importar (FASE 2.2 / 2.3 / 2.4)

```cmd
python scripts\importar-categorias.py
python scripts\importar-productos.py
python scripts\importar-colaboradores.py
```

### Paso 4 — Verificar la importación (FASE 2.5)

```cmd
python scripts\verificar-importacion.py
```

Falla con código de salida distinto de cero si los conteos o la suma de precios
no coinciden exactamente con producción.

---

## Credenciales del rol

| Campo | Valor |
|-------|-------|
| Rol | `erp_combinado_lectura` |
| Contraseña | `lectura_solo_2026` |
| Host (desde el host) | `localhost:5433` |
| Host (desde otro contenedor) | `rderico-db-dev:5432` |
| Base de datos | `rderico` |

> La contraseña es de un rol **de solo lectura sobre cuatro tablas**. No da
> acceso a nada más. Aun así, vive en `.env` y no se versiona en claro fuera de
> este documento de migración.

---

## Verificación ejecutada (FASE 2.1 — cerrada)

### Catálogo del motor

```
=== 1. Atributos del rol ===
        rolname        | superusuario | puede_crear_bd | puede_crear_roles | puede_conectar
-----------------------+--------------+----------------+-------------------+----------------
 erp_combinado_lectura | f            | f              | f                 | t

=== 2. Privilegios por tabla ===
    table_name     | privilegios
-------------------+-------------
 categories        | SELECT
 employees         | SELECT
 products          | SELECT
 security_profiles | SELECT

=== 3. Conteo por tipo de privilegio ===
 privilege_type | tablas
----------------+--------
 SELECT         |      4

=== 4. Privilegios sobre el esquema public ===
 tiene_usage | tiene_create
-------------+--------------
 t           | f

=== 5. Veredicto ===
 OK — 4 tablas legibles, 0 escribibles
```

### Lectura real con el rol (conteos de producción)

```
         t         | count
-------------------+-------
 categories        |    20
 products          |   392
 employees         |    64
 security_profiles |     6
```

### Pruebas negativas (escrituras rechazadas por el motor)

```
UPDATE products SET name = name WHERE id = 1;
  ERROR:  permission denied for table products

DELETE FROM categories WHERE id = 1;
  ERROR:  permission denied for table categories

SELECT count(*) FROM tickets;   -- fuera de alcance
  ERROR:  permission denied for table tickets
```

Las tres escrituras/lecturas fuera de alcance fueron **rechazadas por
PostgreSQL**. REGLA 0 queda garantizada a nivel de motor, no de disciplina.

---

## Nota crítica sobre el PIN de los colaboradores

En producción **no existe** una columna `pin`, `password` ni `hash` en ninguna
tabla (verificado con `information_schema.columns`). El PIN **es**
`employees.employee_code`, almacenado en **texto plano**, de 4 a 6 dígitos:

- `apps/api/modules/security/models.py:39` → `employee_code = Column(String, unique=True, nullable=False, index=True)  # PIN de acceso`
- `apps/api/modules/security/service.py:174` → `where(models.Employee.employee_code == pin, ...)`
- `apps/api/modules/security/schemas.py:33` → `employee_code: str  # PIN de 4-6 dígitos`

Consecuencia para la FASE 2.4: la importación **preserva los PIN reales** de los
colaboradores sin hashear nada y sin re-emitir credenciales. Los cajeros siguen
entrando con el mismo PIN que usan hoy en producción.

**Deuda declarada:** almacenar el PIN en texto plano es una debilidad de
producción que el ERP COMBINADO **hereda a propósito** en la FASE 2 para no
romper la operación. Se registra en `DEUDA.md` (FASE 7.5) y se corrige después
del switch, no antes.
