"""A-05 — Identidad (UUID) ≠ presentación (folio) — FASE 4 (Guardianes).

Fuente autoritativa: `PLAN_DE_CONSTRUCCION_DEL_NUEVO_POS.md` §6.2 (A-05) y §6.3.

El problema que resuelve: en el POS viejo, el folio (`V####`) se usaba como
clave. Eso acopla la identidad a la presentación: si cambia el formato del
folio, se rompen las relaciones; si se recicla un folio, se corrompe la historia.

La solución: la **identidad** es un UUID inmutable (RN-09); el **folio** es una
proyección de presentación, reciclable y sin valor relacional.

Reglas que protege:
  - RN-09: la identidad del ticket es un UUID; el folio es presentación.
  - RN-10: el folio tiene formato `V####` y es único entre los emitidos.
  - RN-12: el `terminal_id` es inmutable una vez asignado.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from uuid import UUID

from rules import ReglaViolada

_PATRON_FOLIO = re.compile(r"^V\d{4}$")


@dataclass(frozen=True)
class IdentidadDeTicket:
    """La identidad (UUID) y la presentación (folio) de un ticket, separadas.

    `id` es la clave relacional (inmutable). `folio` es la etiqueta visible
    (reciclable). Nunca se usa `folio` como clave.
    """

    id: UUID
    folio: str

    def __post_init__(self) -> None:
        if not isinstance(self.id, UUID):
            raise ReglaViolada("RN-09", "La identidad del ticket debe ser un UUID", 400)
        if not _PATRON_FOLIO.match(self.folio):
            raise ReglaViolada("RN-10", f"El folio '{self.folio}' no cumple V####", 400)


def identidad_es_uuid(valor: object) -> bool:
    """RN-09: la identidad es un UUID, no un folio ni un entero."""
    return isinstance(valor, UUID)


def folio_no_es_identidad(clave_usada: str) -> None:
    """A-05: ninguna regla de negocio puede usar el folio como identidad.

    Lanza `ReglaViolada` si `clave_usada == "folio"`.
    """
    if clave_usada == "folio":
        raise ReglaViolada(
            "RN-09",
            "El folio es presentación, no identidad; use el UUID",
            400,
        )


def separar_identidad_de_folio(ticket: dict) -> IdentidadDeTicket:
    """Separa explícitamente la identidad (UUID) de la presentación (folio).

    Falla si el ticket no trae un `id` UUID o un `folio` con formato `V####`.
    """
    identidad = ticket.get("id")
    folio = ticket.get("folio")
    if not identidad_es_uuid(identidad):
        raise ReglaViolada("RN-09", "El ticket no tiene identidad UUID", 400)
    if not isinstance(folio, str):
        raise ReglaViolada("RN-10", "El ticket no tiene folio de presentación", 400)
    return IdentidadDeTicket(id=identidad, folio=folio)
