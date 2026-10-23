"""Lectura de la configuración transversal (DT-06) — FASE 7.5.1b.

Este módulo es el LECTOR de `system_settings`. La UI que ESCRIBE esos valores
es Vista General (que aún no existe); aquí solo se leen, con degradación segura.

Directrices que respeta:
  - DT-06 (Configuración): los valores transversales se declaran UNA vez y cada
    módulo los LEE. El POS no redefine la política de pago: la lee.
  - DT-07 (IA / degradación): la AUSENCIA de configuración degrada al
    comportamiento MÁS CONSERVADOR, nunca bloquea la venta. Si
    `order_payment_policy` no está declarada, se asume `PAGO_COMPLETO`: el
    pedido solo se proyecta cuando el ticket está PAID. Es la opción que menos
    compromete (no se prepara comida sin cobro confirmado).

La política `order_payment_policy` tiene 3 valores válidos:
  - `SIN_PAGO`        → el pedido se proyecta al CREAR el ticket (TENTATIVO).
  - `ANTICIPO`        → el pedido se proyecta cuando el pago cubre el
                        `deposit_percent` declarado (TENTATIVO).
  - `PAGO_COMPLETO`   → el pedido se proyecta solo al COBRAR (PAGADO).
                        Es el default seguro (DT-07).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import SystemSetting

# La clave lógica del valor transversal (DT-06).
CLAVE_POLITICA_PAGO = "order_payment_policy"

# Los 3 valores válidos de la política.
POLITICA_SIN_PAGO = "SIN_PAGO"
POLITICA_ANTICIPO = "ANTICIPO"
POLITICA_PAGO_COMPLETO = "PAGO_COMPLETO"

# El default seguro (DT-07): si no hay configuración, se asume el más
# conservador. Nunca se bloquea la venta por falta de configuración.
POLITICA_POR_DEFECTO = POLITICA_PAGO_COMPLETO

POLITICAS_VALIDAS = frozenset(
    {POLITICA_SIN_PAGO, POLITICA_ANTICIPO, POLITICA_PAGO_COMPLETO}
)


async def leer_valor(db: AsyncSession, clave: str) -> str | None:
    """Devuelve el valor de una clave de configuración, o `None` si no existe.

    No lanza si la tabla no existe todavía (degradación segura, DT-07): un
    sistema sin configuración debe seguir vendiendo, no caerse.
    """
    try:
        fila = (
            await db.execute(select(SystemSetting).where(SystemSetting.key == clave))
        ).scalars().first()
    except Exception:
        # Si la tabla aún no existe (BD sin migrar), se degrada a "no declarado".
        return None
    return None if fila is None else fila.value


async def leer_politica_pago(db: AsyncSession) -> str:
    """Devuelve la política de pago vigente, degradando al default seguro.

    Si el valor no está declarado, está vacío o es inválido, devuelve
    `PAGO_COMPLETO` (DT-07). Nunca lanza: la venta no se bloquea por
    configuración ausente.
    """
    valor = await leer_valor(db, CLAVE_POLITICA_PAGO)
    if valor is None:
        return POLITICA_POR_DEFECTO
    normalizado = valor.strip().upper()
    if normalizado not in POLITICAS_VALIDAS:
        return POLITICA_POR_DEFECTO
    return normalizado
