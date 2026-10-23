"""A-03 — Un test guardián por regla crítica — FASE 4 (Guardianes).

Fuente autoritativa: `PLAN_DE_CONSTRUCCION_DEL_NUEVO_POS.md` §6.2 (A-03) y §6.3.

Una regla no automatizada es solo una intención. Un **guardián** es un test que
**falla si la regla se viola**. La diferencia con el test de F3 es de dirección:

  - El test de F3 (comportamiento) prueba que la regla HACE lo que dice.
  - El guardián de F4 prueba que la regla NO PERMITE lo que prohíbe.

Un guardián se define por:
  - `regla`:   el número de la regla crítica que protege (RN-xx).
  - `nombre`:  el identificador del guardián.
  - `amenaza`: la violación concreta que detecta (en lenguaje humano).
  - `detectar`: (escenario) -> bool. Devuelve True si la amenaza está presente
                (es decir, si la regla fue violada). El guardián FALLA cuando
                `detectar` devuelve True.

Las reglas críticas son las 5 cicatrices de F3 más las reglas transversales que
protegen la integridad del sistema (identidad, outbox, zona horaria).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from rules import ReglaViolada


class GuardianViolado(Exception):
    """Se lanza cuando un guardián detecta que una regla crítica fue violada."""

    def __init__(self, regla: str, guardian: str, amenaza: str) -> None:
        super().__init__(f"[{regla}] Guardián '{guardian}' detectó: {amenaza}")
        self.regla = regla
        self.guardian = guardian
        self.amenaza = amenaza


@dataclass(frozen=True)
class Guardia:
    """Un guardián: un test que falla si una regla crítica se viola."""

    regla: str
    nombre: str
    amenaza: str
    detectar: Callable[[Any], bool] = field(compare=False, repr=False)

    def vigilar(self, escenario: Any) -> None:
        """Ejecuta el guardián. Lanza `GuardianViolado` si la amenaza está presente."""
        if self.detectar(escenario):
            raise GuardianViolado(self.regla, self.nombre, self.amenaza)


# ---------------------------------------------------------------------------
# Detectores de amenaza (uno por regla crítica)
#
# Cada detector recibe un "escenario" (un dict que describe un intento de
# operación) y devuelve True si ese escenario VIOLA la regla.
# ---------------------------------------------------------------------------

def _detecta_draft_ajeno(escenario: dict) -> bool:
    """RN-31/RN-32: escribir un DRAFT que pertenece a otra terminal."""
    ticket = escenario.get("ticket", {})
    terminal = escenario.get("terminal_id")
    return ticket.get("status") == "DRAFT" and ticket.get("terminal_id") != terminal


def _detecta_degradacion(escenario: dict) -> bool:
    """RN-37: reducir las líneas por debajo del 50% sin confirmación explícita."""
    total_actual = escenario.get("total_actual", 0)
    total_nuevo = escenario.get("total_nuevo", 0)
    confirmado = escenario.get("confirmado", False)
    if total_actual <= 0:
        return False
    return (total_nuevo / total_actual) < 0.5 and not confirmado


def _detecta_version_obsoleta(escenario: dict) -> bool:
    """RN-25/RN-26: escribir con una versión que no es la actual."""
    return escenario.get("version_recibido") != escenario.get("version_actual")


def _detecta_folio_reutilizado(escenario: dict) -> bool:
    """RN-10/RN-11: reutilizar un folio ya emitido."""
    folios_emitidos = set(escenario.get("folios_emitidos", []))
    folio_nuevo = escenario.get("folio_nuevo")
    return folio_nuevo in folios_emitidos


def _detecta_evento_sin_idempotencia(escenario: dict) -> bool:
    """RN-63/RN-66: aplicar un evento dos veces sin clave de idempotencia."""
    movimientos = escenario.get("movimientos", [])
    evento_id = escenario.get("evento_id")
    item_id = escenario.get("item_id")
    return any(
        m.get("evento_id") == evento_id and m.get("item_id") == item_id
        for m in movimientos
    )


def _detecta_folio_como_identidad(escenario: dict) -> bool:
    """A-05: usar el folio (presentación) como identidad (clave)."""
    return escenario.get("clave_usada") == "folio"


def _detecta_offset_hardcodeado(escenario: dict) -> bool:
    """RN-81: hardcodear un offset de zona horaria fuera del punto único."""
    fuente = escenario.get("fuente", "")
    import re

    patron = re.compile(r"timedelta\(\s*hours\s*=\s*-?\d+|utcoffset\(\s*-?\d+|[-+]\d{1,2}h\b")
    return bool(patron.search(fuente))


def _detecta_evento_fuera_de_transaccion(escenario: dict) -> bool:
    """A-04: emitir el evento fuera de la transacción del guardado del ticket."""
    return escenario.get("evento_en_misma_transaccion") is False


def _detecta_silencio_en_ruta_critica(escenario: dict) -> bool:
    """A-04 / E-05: silenciar una excepción con `except ... pass` en ruta crítica."""
    return escenario.get("silencia_excepcion") is True


# ---------------------------------------------------------------------------
# El catálogo de guardianes críticos
# ---------------------------------------------------------------------------

GUARDIANES_CRITICOS: tuple[Guardia, ...] = (
    # ── Cicatriz 1: DRAFT GUARD (RN-31 – RN-36) ────────────────────────────
    Guardia(
        regla="RN-31",
        nombre="draft_no_se_escribe_desde_otra_terminal",
        amenaza="una terminal escribe el DRAFT de otra terminal",
        detectar=_detecta_draft_ajeno,
    ),
    # ── Cicatriz 2: Anti-degradación (RN-37 – RN-40) ───────────────────────
    Guardia(
        regla="RN-37",
        nombre="no_se_degradan_las_lineas_sin_confirmar",
        amenaza="las líneas caen por debajo del 50% sin confirmación explícita",
        detectar=_detecta_degradacion,
    ),
    # ── Cicatriz 3: Bloqueo optimista (RN-25 – RN-30) ──────────────────────
    Guardia(
        regla="RN-25",
        nombre="no_se_escribe_con_version_obsoleta",
        amenaza="se escribe con una versión que no es la actual (lost update)",
        detectar=_detecta_version_obsoleta,
    ),
    # ── Cicatriz 4: Reciclaje de folios (RN-10 / RN-11 / RN-41 – RN-43) ────
    Guardia(
        regla="RN-10",
        nombre="no_se_reutiliza_un_folio_emitido",
        amenaza="se reutiliza un folio ya emitido",
        detectar=_detecta_folio_reutilizado,
    ),
    # ── Cicatriz 5: Idempotencia de emergencia (RN-63 – RN-66) ─────────────
    Guardia(
        regla="RN-63",
        nombre="el_evento_no_se_aplica_dos_veces",
        amenaza="un evento se aplica dos veces sin clave de idempotencia",
        detectar=_detecta_evento_sin_idempotencia,
    ),
    # ── A-05: identidad ≠ folio ────────────────────────────────────────────
    Guardia(
        regla="RN-09",
        nombre="el_folio_no_es_la_identidad",
        amenaza="una regla de negocio usa el folio como identidad",
        detectar=_detecta_folio_como_identidad,
    ),
    # ── RN-81: sin offset hardcodeado ──────────────────────────────────────
    Guardia(
        regla="RN-81",
        nombre="no_hay_offset_de_zona_horaria_hardcodeado",
        amenaza="se hardcodea un offset de zona horaria fuera del punto único",
        detectar=_detecta_offset_hardcodeado,
    ),
    # ── A-04: outbox transaccional ─────────────────────────────────────────
    Guardia(
        regla="RN-63",
        nombre="el_evento_vive_en_la_misma_transaccion",
        amenaza="el evento se emite fuera de la transacción del guardado del ticket",
        detectar=_detecta_evento_fuera_de_transaccion,
    ),
    # ── A-04 / E-05: sin silencios en ruta crítica ─────────────────────────
    Guardia(
        regla="RN-63",
        nombre="no_hay_silencios_en_ruta_critica",
        amenaza="una excepción se silencia con `except ... pass` en ruta crítica",
        detectar=_detecta_silencio_en_ruta_critica,
    ),
)


def listar_guardianes() -> tuple[Guardia, ...]:
    """Devuelve los guardianes críticos del catálogo."""
    return GUARDIANES_CRITICOS


def matriz_guardian_regla() -> dict[str, str]:
    """La matriz `guardián → regla` para trazabilidad."""
    return {g.nombre: g.regla for g in GUARDIANES_CRITICOS}
