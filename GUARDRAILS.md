# GUARDRAILS — ERP COMBINADO

Documento de blindaje. Las dos reglas de abajo están copiadas **textualmente** de
[`REGLAS_CRITICAS_PARA_EL_AGENTE.md`](../../PLANOS-ARQUITECTONICOS-DEL-NUEVO-ERP/00-transversal/REGLAS_CRITICAS_PARA_EL_AGENTE.md).
No se parafrasean: se copian, porque una paráfrasis es una interpretación y una
interpretación es una puerta abierta.

---

## REGLA 0 — ERP-R-DE-RICO ES PRODUCCION EN VIVO. INTOCABLE.

### Lo que significa "nunca"

- **Nunca** editar un archivo dentro de `ERP-R-DE-RICO/`.
- **Nunca** ejecutar `git commit`, `git add`, `git push`, `git checkout`,
  `git reset`, `git stash` ni ninguna otra operación de escritura dentro de
  `ERP-R-DE-RICO/`.
- **Nunca** ejecutar migraciones, `DROP`, `ALTER`, `UPDATE`, `DELETE` ni
  `INSERT` contra la base de datos de producción.
- **Nunca** reiniciar, detener ni reconstruir los contenedores de producción.
- **Nunca** cambiar el enlace (el puerto, el proxy, el acceso directo, el
  `iframe`) que usan las terminales de producción. **Eso lo hace el operador.**

### Por que existe esta regla

Dos incidentes reales, ambos con terminales congeladas en horario de venta:

1. **Incidente #1** — el agente modificó `ExperimentCenterUI.jsx` en producción.
   Se revirtió con `git checkout HEAD`.
2. **Incidente #2** — commit `02a1cbd`. El agente refactorizó
   `ERP-R-DE-RICO/apps/inventory/ProductCatalogUI.jsx` y perdió los backticks en
   las líneas 287 y 367. El error de sintaxis de Babel **congeló TODAS las
   terminales de producción**. Se necesitaron dos hotfixes (`7c67cf1`,
   `e51bf5e`) para recuperar el servicio.

La regla no es burocracia. Es la cicatriz de dos caídas.

---

## REGLA 1 — El nuevo modulo es una app STANDALONE. No se integra al ERP viejo.

- Tiene su **propio** servidor de desarrollo, en un **puerto único**.
- Tiene su **propio** `package.json` y su **propio** `vite.config.js`.
- Su proxy `/api` apunta a **su propia** API, nunca a la API de producción.
- **NO importa nada de `ERP-R-DE-RICO/apps/`.**
- **NO es importado por `ERP-R-DE-RICO/apps/`.**

La comunicación con otros módulos es **solo** por contratos HTTP tipados
(RT-09). Ningún módulo lee ni escribe las tablas de otro.

---

## Cómo se hace cumplir

| Guard | Qué verifica | Cuándo corre |
|:---|:---|:---|
| [`scripts/guard-produccion.mjs`](scripts/guard-produccion.mjs) | Que ningún archivo de `ERP-COMBINADO/` contenga la ruta `ERP-R-DE-RICO/apps/` en un `import`, `require` o `from` | Antes de cada commit |
| [`scripts/verificar-puertos.mjs`](scripts/verificar-puertos.mjs) | Que dos módulos no compartan puerto | Antes de cada commit |

```bash
node scripts/guard-produccion.mjs
node scripts/verificar-puertos.mjs
```

Si alguno falla, **no se commitea**. No hay excepciones, no hay "solo esta vez".

---

## Tabla de acciones permitidas y prohibidas

| Acción | ¿Permitida? |
|:---|:---:|
| Leer archivos de `ERP-R-DE-RICO/` (solo lectura) | ✅ |
| Consultar la BD de producción con un rol `SELECT`-only | ✅ |
| Copiar archivos de `ERP-R-DE-RICO/` hacia `ERP-COMBINADO/` | ✅ |
| Editar cualquier archivo de `ERP-R-DE-RICO/` | ❌ |
| Ejecutar git de escritura en `ERP-R-DE-RICO/` | ❌ |
| Migrar, alterar o borrar datos de producción | ❌ |
| Reiniciar contenedores de producción | ❌ |
| Cambiar el enlace de las terminales de producción | ❌ (lo hace el operador) |
| Importar código de `ERP-R-DE-RICO/apps/` en un módulo | ❌ |
| Que un módulo lea las tablas de otro módulo | ❌ |
