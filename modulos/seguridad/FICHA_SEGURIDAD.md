# FICHA DE INGENIERÍA — Seguridad y Acceso (FASE 3.1)

> Módulo 10 de 17 del ERP COMBINADO. Implementa los **contratos 7 y 8** del
> [`registry.py`](../../contracts/registry.py). Es el módulo que el POS consulta
> para saber **quién** está operando la caja.

---

## 1. Identidad del módulo

| Dato | Valor |
|---|---|
| Nombre | Seguridad y Acceso |
| Slug | `seguridad` |
| Frontend | `http://localhost:5228` |
| API | `http://localhost:5229` |
| Base de datos | `erp_seguridad` en PostgreSQL `localhost:5441` |
| Contenedores | `erp_combinado_seguridad_api`, `erp_combinado_seguridad_db` |
| Volumen | `seguridad_erp_seguridad_data` |
| Contratos que expone | **7** (identidad del empleado) y **8** (validación de PIN) |
| Contratos que consume | ninguno |
| Dependencias de otros módulos | **ninguna** (REGLA 1) |

---

## 2. Contratos implementados

### Contrato 7 — `GET /security/employees/{employee_id}`

Devuelve la **proyección** del colaborador, nunca la tabla (O-23).

```json
{
  "employee_id": "48627697-4907-5fd6-a9b2-6ed63768a840",
  "nombre": "Alfa",
  "perfil": "MANAGER",
  "permisos": ["auditoria", "driver", "financials", "inventory", "..."]
}
```

- Campos **exactos**: `employee_id`, `nombre`, `perfil`, `permisos`. Nada más.
- `404` si el `employee_id` no existe.
- `422` si el `employee_id` no es un UUID válido.
- **RN-S01**: el PIN jamás aparece en la respuesta. La regla pura
  [`rn_s01_pin_no_se_expone()`](../api/rules/registry.py) se aplica sobre el
  diccionario proyectado antes de construir el esquema, de modo que un campo
  prohibido que se colara en la proyección **rompe la petición**, no la fuga.
- Un perfil sin permisos devuelve `permisos: []`, nunca `null`.

### Contrato 8 — `POST /security/employees/validate-pin`

```json
// petición
{ "pin": "3333" }

// respuesta 200
{ "valido": true, "employee_id": "48627697-4907-5fd6-a9b2-6ed63768a840" }

// respuesta 401
{ "detail": "PIN incorrecto." }
```

- Campos de salida **exactos**: `valido`, `employee_id`. Nada más.
- `401` si el PIN no existe, si el colaborador está dado de baja (**RN-S03**)
  o si el PIN es un prefijo de uno real (**RN-S04**, comparación exacta).
- `422` si el PIN no es numérico o su longitud está fuera de
  `[PIN_LONGITUD_MINIMA, PIN_LONGITUD_MAXIMA]` (4–8 por defecto).
- `429` si se supera el límite de intentos (**O-21**).
- El PIN **nunca** viaja en la URL ni en la respuesta.

---

## 3. Decisiones de diseño

### 3.1 `employee_code` ES el PIN

El modelo [`Employee`](../api/models/seguridad.py) documenta que
`employee_code` es el PIN. No hay columna `pin` separada. Es único, de 16
caracteres como máximo, y el contrato 8 lo compara **por igualdad exacta**,
nunca por prefijo. Esto se descubrió al intentar consultar `employees.pin` y
recibir `column e.pin does not exist`: el esquema era correcto, la consulta no.

### 3.2 El PIN vive solo en el estado del componente

Consecuencia directa de **O-21** en el frontend
([`App.jsx`](frontend/src/App.jsx)):

- El PIN se guarda en `useState` y **se limpia en cuanto termina la
  validación**, antes incluso de encadenar la llamada al contrato 7.
- Nunca se escribe en `localStorage`, `sessionStorage`, la URL ni la consola.
- El campo es `type="password"` con `inputMode="numeric"` y `autoComplete="off"`.

### 3.3 El frontend no suma ni calcula nada

El frontend solo **formatea** lo que recibe. No hay lógica de negocio en
[`api.js`](frontend/src/api.js): es un cliente HTTP tipado que traduce errores
del backend a mensajes legibles.

### 3.4 Tema estándar inalterable (RT-11)

Los colores, tipografía y estructura viven en variables CSS declaradas en
`:root` dentro de [`index.css`](frontend/src/index.css). El hub puede
sobrescribir el acento y los colores semánticos sin editar el módulo.

### 3.5 Responsivo total (RT-14)

La rejilla de tarjetas usa `grid-template-columns: repeat(auto-fit, minmax(...))`
y la tarjeta de identidad ocupa `gridColumn: '1 / -1'`. Los tres breakpoints
(móvil `< 640px`, tableta `640–1023px`, escritorio `>= 1024px`) están cubiertos
sin media queries frágiles.

---

## 4. Incidente RT-09 detectado y corregido

**Síntoma.** Tras aplicar la migración `0001`, la base `erp_seguridad` del
contenedor de Seguridad (puerto **5441**) estaba **vacía**: `total 0, activos 0,
con_perfil 0`. Sin embargo, el reporte de la FASE 2.4 afirmaba haber importado
64 colaboradores.

**Causa raíz.** [`importacion_comun.py`](../../scripts/importacion_comun.py)
define `DEST_PORT = 5440`, que es el puerto del **contenedor del POS**. Los
scripts [`importar-colaboradores.py`](../../scripts/importar-colaboradores.py)
y [`verificar-importacion.py`](../../scripts/verificar-importacion.py)
reutilizaban ese `DEST_PORT` junto con `dbname=erp_seguridad`. El resultado:
la FASE 2.4 escribió los colaboradores en la base `erp_seguridad` que vive
**dentro del contenedor del POS**, no en la del módulo Seguridad.

Esto viola **RT-09** («cada módulo tiene su propia base en su propio
contenedor») y **REGLA 1** (los módulos no comparten infraestructura).

**Corrección aplicada.**

1. Ambos scripts declaran ahora su propio puerto:
   ```python
   DEST_SEGURIDAD_PORT = int(os.environ.get("DEST_SEGURIDAD_PORT", "5441"))
   ```
   y `conectar_seguridad()` importa solo `DEST_HOST`, `DEST_PASSWORD` y
   `DEST_USER` de `importacion_comun`, usando `port=DEST_SEGURIDAD_PORT`.
2. Los datos ya importados se trasladaron con
   `pg_dump --data-only --column-inserts` desde el contenedor del POS y se
   restauraron con `psql -v ON_ERROR_STOP=1` en el contenedor de Seguridad.
3. Se verificó el resultado: **64 colaboradores, 36 activos, 63 con perfil,
   6 perfiles, 0 huérfanos**.

**Lección.** Un importador que escribe en la base de otro módulo no falla de
forma ruidosa: escribe con éxito en el lugar equivocado. Por eso el puerto
destino debe ser explícito por módulo y no heredarse de un módulo vecino.

---

## 5. Verificación

### 5.1 Pruebas automáticas

| Suite | Comando | Resultado |
|---|---|---|
| API (pytest) | `docker compose run --rm --no-deps api sh -c "pip install -q -r requirements.txt pytest pytest-asyncio httpx && python -m pytest -q"` | **51 passed**, 1 warning, 1.38 s |
| Frontend (vitest) | `npm run test` | **14 passed**, 1 archivo, 16.93 s |
| Build | `npm run build` | 32 módulos, 147.94 kB JS (47.84 kB gzip), 1.18 s |
| Guard de producción | `node scripts/guard-produccion.mjs` | 385 archivos, **0 violaciones** |
| Verificador de puertos | `node scripts/verificar-puertos.mjs` | 17 módulos, **0 conflictos** |

### 5.2 Verificación end-to-end contra la API viva

[`verificar_contratos.py`](api/verificar_contratos.py) se ejecuta dentro del
contenedor y comprueba los dos contratos contra datos reales:

```
docker compose exec -T api python verificar_contratos.py
```

**18 comprobaciones, todas en verde:**

| Bloque | Comprobación | Resultado |
|---|---|---|
| Salud | `GET /health` | 200, `estado: ok` |
| Contrato 8 | PIN `3333` (Alfa / MANAGER) | 200, `valido: True` |
| Contrato 8 | campos exactos | `['employee_id', 'valido']` |
| Contrato 8 | el PIN no viaja en la respuesta | ausente |
| Contrato 7 | `GET /employees/{id}` | 200 |
| Contrato 7 | campos exactos | `['employee_id', 'nombre', 'perfil', 'permisos']` |
| Contrato 7 | `employee_id` coincide con el del contrato 8 | sí |
| Contrato 7 | `nombre` / `perfil` | `Alfa` / `MANAGER` |
| Contrato 7 | `permisos` es lista no vacía | sí (20 permisos) |
| Contrato 7 | el PIN no se expone (RN-S01) | ausente |
| Error | PIN inexistente `0000` | 401 |
| Error | prefijo del PIN `3330` (RN-S04) | 401 |
| Error | PIN no numérico `abc` | 422 |
| Error | PIN demasiado corto `333` | 422 |
| Error | UUID inexistente | 404 |
| Error | UUID malformado | 422 |

> **Nota sobre los datos de prueba.** Los PIN de producción son de 4–5 dígitos.
> `9999` **existe** (ARELY, activa) y `333` es demasiado corto para llegar al
> router, así que el esquema lo rechaza con 422 antes de evaluar RN-S04. Por eso
> la prueba de «PIN inexistente» usa `0000` y la de «prefijo» usa `3330`
> (prefijo válido en longitud de `3333`).

---

## 6. Estructura de archivos

```
modulos/seguridad/
├── docker-compose.yml          # db 5441 + api 5229
├── FICHA_SEGURIDAD.md          # este documento
├── api/
│   ├── main.py                 # FastAPI, CORS, manejadores de error
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── verificar_contratos.py  # verificación end-to-end (18 checks)
│   ├── core/
│   │   ├── config.py           # PIN_LONGITUD_MINIMA/MAXIMA, DATABASE_URL
│   │   └── database.py         # engine async + get_db()
│   ├── models/
│   │   ├── base.py             # Base declarativo (¡NO está en core/!)
│   │   └── seguridad.py        # SecurityProfile, Employee
│   ├── schemas/
│   │   └── seguridad.py        # IdentidadEmpleadoSalida, ValidarPinEntrada/Salida
│   ├── routers/
│   │   └── seguridad.py        # contratos 7 y 8
│   ├── rules/
│   │   └── registry.py         # RN-S01, RN-S02, RN-S03, RN-S04
│   ├── migrations/
│   │   ├── env.py
│   │   └── versions/0001_esquema_inicial.py
│   └── tests/
│       ├── test_reglas.py      # reglas puras
│       ├── test_schemas.py     # esquemas
│       └── test_router_seguridad.py  # endpoints
└── frontend/
    ├── package.json
    ├── vite.config.js          # puerto 5228, proxy /api -> 5229
    ├── index.html
    └── src/
        ├── main.jsx
        ├── index.css           # variables de tema (RT-11)
        ├── api.js              # cliente HTTP de los contratos 7 y 8
        ├── api.test.js         # 14 pruebas
        └── App.jsx             # PIN + identidad
```

---

## 7. Deuda conocida

| # | Deuda | Motivo | Impacto |
|---|---|---|---|
| 1 | El rate-limit de O-21 es en memoria | No hay Redis en este módulo todavía | Un reinicio del contenedor reinicia el contador. Aceptable en local; **bloqueante para producción**. |
| 2 | No hay endpoint de administración de colaboradores | FASE 3.1 solo cubre los contratos 7 y 8 | El alta/baja de colaboradores se hará en la ficha de Recursos Humanos (FASE 4.8). |
| 3 | El frontend no tiene router | Es una pantalla única de identificación | El hub lo monta en un iframe; no necesita rutas propias. |
| 4 | `pytest-asyncio` emite un `PytestDeprecationWarning` | `asyncio_default_fixture_loop_scope` sin declarar | Cosmético; se fijará al añadir la siguiente suite async. |

---

## 8. Cómo arrancarlo

```bash
cd modulos/seguridad
docker compose up -d db
docker compose run --rm --no-deps api sh -c "pip install -q -r requirements.txt && alembic upgrade head"
docker compose up -d api
# frontend
cd frontend && npm install && npm run dev
```

Comprobación rápida:

```bash
curl http://localhost:5229/health
# {"status":"ok","servicio":"erp-combinado-seguridad-api"}
```

---

**Estado: FASE 3.1 cerrada.** Contratos 7 y 8 implementados, probados y
verificados contra datos reales de producción. La violación de RT-09 de la
FASE 2.4 quedó corregida en el código y en los datos.
