# ERP COMBINADO — R de Rico

Rediseño limpio del ERP completo, construido sobre las reglas arquitectónicas del
POS nuevo. **No es una copia del ERP viejo**: es un hub que enlaza módulos
standalone, cada uno con su propia API, su propia base de datos y su propio
contenedor.

## Qué es y qué no es

| Es | No es |
|:---|:---|
| Un hub que **enlaza** módulos por URL | Un monolito que importa código de los módulos |
| 17 módulos standalone, cada uno con API + BD propias | Un único backend compartido |
| Comunicación **solo** por contratos HTTP tipados | Llamadas directas a tablas de otro módulo |
| Un reemplazo paralelo del ERP de producción (Strangler Fig) | Una modificación del ERP de producción |

## Reglas de oro

1. **`ERP-R-DE-RICO` es producción en vivo. NO SE TOCA.** Ver [`GUARDRAILS.md`](GUARDRAILS.md).
2. **Cada módulo es standalone.** No importa código de otro módulo ni del ERP viejo.
3. **La comunicación es solo por contratos HTTP tipados.** Ningún módulo lee ni
   escribe las tablas de otro.
4. **El operador hace el switch.** El agente nunca cambia el enlace de producción.

## Estructura

```
ERP-COMBINADO/
├── README.md              este archivo
├── GUARDRAILS.md          REGLA 0 y REGLA 1, textuales
├── PUERTOS.md             rangos de puertos reservados
├── modulos.json           registro de los 17 módulos del hub
├── .env.example           variables de entorno de referencia
├── scripts/
│   ├── guard-produccion.mjs    falla si algo importa del ERP de producción
│   └── verificar-puertos.mjs   falla si dos módulos comparten puerto
├── packages/
│   └── theme-engine/      motor de temas compartido (RT-11)
└── modulos/
    └── pos/               Punto de Venta IA (frontend 5210, API 5211, BD erp_pos)
        ├── api/
        ├── frontend/
        ├── shared/
        └── docker-compose.yml
```

## Rangos de puertos

```
5000 / 5001 / 5433   → ERP-R-DE-RICO (PRODUCCIÓN — jamás se toca)
5100 / 5101 / 5432   → NUEVO-ERP (desarrollo — no se toca)
5200 – 5241          → ERP-COMBINADO (frontends pares, APIs impares)
5440 – 5450          → PostgreSQL de ERP-COMBINADO (una por módulo)
```

Detalle completo en [`PUERTOS.md`](PUERTOS.md).

## Arranque rápido (POS)

```bash
cd modulos/pos
docker compose up -d db
docker compose up -d api
cd frontend && npm install && npm run dev
```

- POS: <http://localhost:5210>
- API: <http://localhost:5211/health>
- PostgreSQL: `localhost:5440` (base `erp_pos`)

## Verificación obligatoria

Antes de cualquier commit:

```bash
node scripts/guard-produccion.mjs
node scripts/verificar-puertos.mjs
```

Ambos deben salir en verde. Si alguno falla, **no se commitea**.

## Estado del proyecto

| Fase | Descripción | Estado |
|:---:|:---|:---|
| 0 | Andamiaje y blindaje | Completada |
| 1 | El POS nuevo entra tal cual | Completada |
| 2 | Importación del catálogo y colaboradores desde producción | Pendiente |
| 3 | Contratos críticos (catálogo, seguridad, estadísticas) | Pendiente |
| 4 | Módulos conservados y adaptados | Pendiente |
| 5 | Vista General y shell del hub | Pendiente |
| 6 | Pruebas de paridad contra producción | Pendiente |
| 7 | Documentación de cierre | Pendiente |
| 8 | Repositorio GitHub y primer hito | Pendiente |

Plan maestro completo: [`../ERP-R-DE-RICO/plans/PLAN_MAESTRO_ERP_COMBINADO_V1.md`](../ERP-R-DE-RICO/plans/PLAN_MAESTRO_ERP_COMBINADO_V1.md)
