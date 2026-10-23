"""La consolidación central del POS nuevo — FASE 6 (Consolidación).

La consolidación es lo último porque es la capa superior: el POS ya funciona
solo, y ahora se conecta con el central (Plan §8.1). No es un requisito del
cobro: es una capa **asíncrona de cierre de día**.

Este paquete materializa los 3 entregables de F6 (Plan §8.2):

  - El **contrato de consolidación** (principios P1-P6, payload JSON, outbox).
  - La **sync al cierre del día** (default `23:30`, configurable en `SystemSetting`).
  - La **resolución de conflictos** (tabla `sync_conflictos`, revisión manual,
    nunca silenciosa).

La puerta de salida (Plan §8.3) exige:

  - [ ] La sync de cierre de día envía ventas y caja al central.
  - [ ] Si el central cae, las sucursales siguen operando (el central no es transaccional).
  - [ ] Un conflicto se registra para revisión manual; nunca se resuelve en silencio.

El registro (`registry.py`) es la fuente única de verdad: el test de la puerta
F6 lo recorre y verifica los 3 criterios sobre datos, no sobre intención.

F6 cierra los 4 riesgos de concurrencia RC-01 a RC-04 (Plan §9): no los elimina,
los hace observables y auditables. Un conflicto visible es mejor que un dato
perdido sin aviso.
"""

from __future__ import annotations

from .registry import (
    CLAVE_SETTING_HORA_CIERRE,
    CRITERIO_GLOBAL,
    CRITERIOS_CENTRAL,
    CRITERIOS_SUCURSAL,
    DOMINIOS,
    ENTIDADES_CENTRAL,
    ESTADOS_ENVIO,
    GARANTIAS,
    HORA_CIERRE_DEFAULT,
    NIVELES_CONECTIVIDAD,
    NO_SE_CONSOLIDA,
    PRINCIPIOS,
    RIESGOS_QUE_CIERRA,
    SCHEMA_VERSION,
    CentralCaido,
    CentralNoTransaccional,
    Conflicto,
    ConflictoSilencioso,
    JobConsolidacion,
    OutboxConsolidacion,
    PayloadConsolidacion,
    RegistroConflictos,
    RegistroOutbox,
    SyncCierreDeDia,
    dominios_consolidados,
    listar_dominios,
    listar_entidades_central,
    listar_principios,
    listar_riesgos,
    matriz_principio_implicacion,
)

__all__ = [
    # Datos canónicos del contrato
    "PRINCIPIOS",
    "DOMINIOS",
    "NO_SE_CONSOLIDA",
    "GARANTIAS",
    "NIVELES_CONECTIVIDAD",
    "ENTIDADES_CENTRAL",
    "RIESGOS_QUE_CIERRA",
    "CRITERIOS_SUCURSAL",
    "CRITERIOS_CENTRAL",
    "CRITERIO_GLOBAL",
    "ESTADOS_ENVIO",
    "SCHEMA_VERSION",
    "HORA_CIERRE_DEFAULT",
    "CLAVE_SETTING_HORA_CIERRE",
    # El payload
    "PayloadConsolidacion",
    # El outbox
    "RegistroOutbox",
    "OutboxConsolidacion",
    # La sync
    "SyncCierreDeDia",
    # El central
    "CentralNoTransaccional",
    "CentralCaido",
    "JobConsolidacion",
    # Los conflictos
    "Conflicto",
    "ConflictoSilencioso",
    "RegistroConflictos",
    # Consultas de la puerta
    "listar_principios",
    "listar_dominios",
    "listar_entidades_central",
    "listar_riesgos",
    "matriz_principio_implicacion",
    "dominios_consolidados",
]
