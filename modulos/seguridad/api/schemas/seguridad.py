"""Esquemas de Seguridad y Acceso — Contratos 7 y 8 (FASE 3.1).

Cada clase de este archivo es la forma EXACTA de un contrato del registro
(`contracts/registry.py`). Si el registro y el esquema divergen, el contrato
está roto aunque el endpoint responda 200: el consumidor (el POS) programa
contra el registro, no contra el código.

Contrato 7 — `seguridad.identidad_del_empleado`
    GET /security/employees/{employee_id}
    entrada: {"employee_id": "UUID"}
    salida:  {"employee_id": "UUID", "nombre": "String",
              "perfil": "String", "permisos": "List[String]"}

Contrato 8 — `seguridad.validar_pin`
    POST /security/employees/validate-pin
    entrada: {"pin": "String"}
    salida:  {"valido": "Boolean", "employee_id": "UUID NULL"}
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.config import PIN_LONGITUD_MAXIMA, PIN_LONGITUD_MINIMA


class IdentidadEmpleadoSalida(BaseModel):
    """Proyección del empleado — contrato 7.

    O-23: esto NO es la tabla `employees`. Faltan a propósito el PIN, el
    `employee_code`, las fechas y el `profile_id` crudo. El POS solo necesita
    saber quién es la persona, qué perfil tiene y qué puede hacer.

    `extra="forbid"` es la defensa estructural de RN-S01: si alguien intenta
    colar `employee_code` (el PIN) en la proyección, Pydantic lanza en vez de
    ignorarlo en silencio. La regla `rn_s01_pin_no_se_expone` sigue siendo la
    primera barrera; esta es la segunda.
    """

    model_config = ConfigDict(extra="forbid")

    employee_id: uuid.UUID = Field(
        ..., description="UUID del colaborador (identidad, DT-03)."
    )
    nombre: str = Field(..., description="Nombre completo del colaborador.")
    perfil: str = Field(
        ...,
        description=(
            "Nombre del perfil de acceso. Cadena vacía si el colaborador no "
            "tiene perfil asignado: el POS debe poder abrir turno igual."
        ),
    )
    permisos: list[str] = Field(
        default_factory=list,
        description=(
            "Claves de permiso del perfil, ordenadas. Lista vacía si el "
            "colaborador no tiene perfil o el perfil no declara permisos."
        ),
    )


class ValidarPinEntrada(BaseModel):
    """Entrada del contrato 8: el PIN tecleado por el colaborador.

    O-21: este es el ÚNICO contrato que transporta un secreto. Por eso el
    campo se marca `repr=False` — así el PIN no aparece en los logs de
    depuración ni en un `print(modelo)` accidental.
    """

    pin: str = Field(
        ...,
        repr=False,
        description="PIN del colaborador, tal cual lo tecleó.",
    )

    @field_validator("pin")
    @classmethod
    def _validar_forma(cls, valor: str) -> str:
        """Rechaza un PIN con forma imposible ANTES de tocar la base.

        No se recorta ni se normaliza: un PIN con espacios es un PIN distinto.
        Solo se comprueba que sea numérico y que su longitud esté en el rango
        configurado. Un PIN mal formado no es un error del servidor: es una
        validación fallida, y el router responde `valido=false` (401), no 422,
        para no filtrar por el código de estado si el PIN existe o no.
        """
        if not valor.isdigit():
            raise ValueError("El PIN debe contener solo dígitos.")
        if not (PIN_LONGITUD_MINIMA <= len(valor) <= PIN_LONGITUD_MAXIMA):
            raise ValueError(
                f"El PIN debe tener entre {PIN_LONGITUD_MINIMA} y "
                f"{PIN_LONGITUD_MAXIMA} dígitos."
            )
        return valor


class ValidarPinSalida(BaseModel):
    """Salida del contrato 8.

    `employee_id` es `NULL` cuando el PIN no corresponde a nadie. Es
    deliberado: el POS necesita distinguir "PIN equivocado" de "PIN de un
    colaborador dado de baja", y en ambos casos `valido` es `false`.
    """

    valido: bool = Field(..., description="True solo si el PIN existe y el colaborador está activo.")
    employee_id: uuid.UUID | None = Field(
        default=None,
        description="UUID del colaborador si `valido` es True; NULL en caso contrario.",
    )
