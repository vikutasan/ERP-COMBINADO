"""Las 95 reglas de negocio del POS nuevo — FASE 3 + FASE 8.0 (CRM) + FASE 9.1 (Pagos mixtos).

Fuente autoritativa: `ESPECIFICACION_FUNCIONAL_POS_INGENIERIA_INVERSA.md` §C
(17 categorías, RN-01 a RN-95).

La unidad de migración NO es la regla: es **regla + test** (Plan §5.1).
Este paquete contiene la implementación pura y determinista de cada regla,
operando sobre los contratos de F2 (`apps/api/contracts/`). No toca la base
de datos ni HTTP: así cada regla es verificable de forma aislada.

  C.1  Sesión de terminal y ocupación      RN-01 – RN-08   (8)
  C.2  Tickets: identidad y folio          RN-09 – RN-16   (8)
  C.3  Tickets: líneas                     RN-17 – RN-24   (8)
  C.4  Concurrencia optimista              RN-25 – RN-30   (6)
  C.5  DRAFT GUARD                         RN-31 – RN-36   (6)
  C.6  Anti-degradación de líneas          RN-37 – RN-40   (4)
  C.7  Reserva y limpieza de borradores    RN-41 – RN-48   (8)
  C.8  Caja: sesión y movimientos          RN-49 – RN-56   (8)
  C.9  Caja: clasificación de pagos        RN-57 – RN-60   (4)
  C.10 Inventario: eventos                 RN-61 – RN-66   (6)
  C.11 Pedidos: proyección                 RN-67 – RN-70   (4)
  C.12 Visión                              RN-71 – RN-74   (4)
  C.13 Auditoría                           RN-75 – RN-77   (3)
  C.14 Tiempo y zona horaria               RN-78 – RN-80   (3)
  C.15 Regla transversal                   RN-81           (1)
  C.16 CRM y Notificaciones                RN-82 – RN-93   (12)
  C.17 Pagos mixtos                        RN-94 – RN-95   (2)
                                           TOTAL           95
"""

from __future__ import annotations

from .registry import (
    LAS_95_REGLAS,
    Regla,
    ReglaViolada,
    listar_reglas,
    matriz_regla_test,
)

__all__ = [
    "LAS_95_REGLAS",
    "Regla",
    "ReglaViolada",
    "listar_reglas",
    "matriz_regla_test",
]

