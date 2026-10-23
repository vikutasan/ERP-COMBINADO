# PUERTOS — ERP COMBINADO

Rangos reservados. **Ningún módulo puede salirse de su rango ni repetir puerto.**
El guard [`scripts/verificar-puertos.mjs`](scripts/verificar-puertos.mjs) lo
verifica en cada commit.

## Rangos

```
5000 / 5001 / 5433   → ERP-R-DE-RICO (PRODUCCIÓN — jamás se toca)
5100 / 5101 / 5432   → NUEVO-ERP (desarrollo actual — no se toca)
5200 – 5241          → ERP-COMBINADO (frontends pares, APIs impares)
5440 – 5450          → PostgreSQL de ERP-COMBINADO (una por módulo)
```

> **Nota:** el plan maestro declara el rango PostgreSQL como `5440–5450`. La
> versión anterior de este documento decía `5439–5455`; se corrige aquí para
> coincidir con el plan, que es la fuente de autoridad.

## Asignación por módulo

| # | Módulo | Frontend | API | Base de datos |
|:---:|:---|:---:|:---:|:---|
| 1 | Vista General | 5200 | 5201 | `erp_vista_general` |
| 2 | Punto de Venta IA (POS nuevo) | 5210 | 5211 | `erp_pos` |
| 3 | Gestión de Productos | 5212 | 5213 | `erp_catalogo` |
| 4 | Gestión de Almacenes | 5214 | 5215 | `erp_almacenes` |
| 5 | Centro de IA | 5216 | 5217 | `erp_ia` |
| 6 | Gestión de la Producción | 5218 | 5219 | `erp_produccion` |
| 7 | Gestión de Pickup | 5220 | 5221 | `erp_pickup` |
| 8 | Gestión de Repartos | 5222 | 5223 | `erp_repartos` |
| 9 | Estadísticas | 5224 | 5225 | `erp_estadisticas` |
| 10 | Gestión de Compras | 5226 | 5227 | `erp_compras` |
| 11 | Seguridad y Acceso | 5228 | 5229 | `erp_seguridad` |
| 12 | Recursos Humanos | 5230 | 5231 | `erp_rrhh` |
| 13 | Auditoría y Control | 5232 | 5233 | `erp_auditoria` |
| 14 | Ajustes del Sistema | 5234 | 5235 | `erp_ajustes` |
| 15 | Monitoreo de Red | 5236 | 5237 | `erp_red` |
| 16 | Reparto Pan Grandeza | 5238 | 5239 | `erp_grandeza` |
| 17 | Heladería | 5240 | 5241 | `erp_heladeria` |

## Asignación de puertos PostgreSQL

| Módulo | Puerto |
|:---|:---:|
| Vista General | 5440 |
| Punto de Venta IA | 5441 |
| Gestión de Productos | 5442 |
| Gestión de Almacenes | 5443 |
| Centro de IA | 5444 |
| Gestión de la Producción | 5445 |
| Gestión de Pickup | 5446 |
| Gestión de Repartos | 5447 |
| Estadísticas | 5448 |
| Gestión de Compras | 5449 |
| Seguridad y Acceso | 5450 |

> Los módulos 12–17 reutilizan el rango `5440–5450` según se levanten; el guard
> solo exige que **dos módulos activos** no compartan puerto. Cuando se levanten
> los 17 simultáneamente, el rango se extiende a `5440–5456` y se actualiza este
> documento junto con `modulos.json`.

## Reglas

1. Un frontend **nunca** usa un puerto impar del rango; una API **nunca** usa un
   puerto par.
2. Un módulo **nunca** apunta su proxy `/api` a un puerto que no sea el suyo.
3. El shell del hub (5200) **nunca** abre conexión directa a la base de datos de
   un módulo: solo enlaza por HTTP.
4. Si un puerto está ocupado, se **detiene** el arranque (`strictPort: true`). No
   se cambia el puerto a la ligera: se libera el que corresponde.
