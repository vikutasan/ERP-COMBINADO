"""Pruebas de los esquemas de los contratos 7 y 8.

Verifican la forma de entrada/salida sin tocar base de datos. Lo importante
aqui es que el PIN se valide ANTES de llegar al router: si la forma es
invalida, la peticion muere en 422 y nunca consume una consulta ni un intento
del rate-limit.
"""
from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from core.config import PIN_LONGITUD_MAXIMA, PIN_LONGITUD_MINIMA
from schemas.seguridad import (
    IdentidadEmpleadoSalida,
    ValidarPinEntrada,
    ValidarPinSalida,
)


# ---------------------------------------------------------------------------
# Contrato 7 - IdentidadEmpleadoSalida
# ---------------------------------------------------------------------------


def test_identidad_expone_los_cuatro_campos_del_contrato() -> None:
    identidad = IdentidadEmpleadoSalida(
        employee_id=uuid.uuid4(),
        nombre="Ana Lopez",
        perfil="Cajero",
        permisos=["caja.abrir", "ventas.crear"],
    )

    assert set(identidad.model_dump()) == {
        "employee_id",
        "nombre",
        "perfil",
        "permisos",
    }


def test_identidad_permisos_por_defecto_es_lista_vacia() -> None:
    identidad = IdentidadEmpleadoSalida(
        employee_id=uuid.uuid4(),
        nombre="Ana Lopez",
        perfil="",
    )

    assert identidad.permisos == []


def test_identidad_no_admite_campos_extra_de_pin() -> None:
    """El contrato 7 nunca debe poder transportar el PIN (RN-S01)."""
    with pytest.raises(ValidationError):
        IdentidadEmpleadoSalida(
            employee_id=uuid.uuid4(),
            nombre="Ana Lopez",
            perfil="Cajero",
            employee_code="1234",
        )


# ---------------------------------------------------------------------------
# Contrato 8 - ValidarPinEntrada
# ---------------------------------------------------------------------------


def test_pin_valido_se_acepta() -> None:
    pin = "1" * PIN_LONGITUD_MINIMA
    entrada = ValidarPinEntrada(pin=pin)

    assert entrada.pin == pin


def test_pin_de_longitud_maxima_se_acepta() -> None:
    pin = "9" * PIN_LONGITUD_MAXIMA
    entrada = ValidarPinEntrada(pin=pin)

    assert entrada.pin == pin


@pytest.mark.parametrize(
    "pin_invalido",
    [
        "",
        "abc",
        "12ab",
        "12 34",
        "-123",
        "1.23",
        "1" * (PIN_LONGITUD_MINIMA - 1),
        "1" * (PIN_LONGITUD_MAXIMA + 1),
    ],
)
def test_pin_con_forma_invalida_se_rechaza(pin_invalido: str) -> None:
    with pytest.raises(ValidationError):
        ValidarPinEntrada(pin=pin_invalido)


def test_pin_no_aparece_en_la_representacion() -> None:
    """`repr=False` evita que el PIN acabe en un log por accidente."""
    entrada = ValidarPinEntrada(pin="1234")

    assert "1234" not in repr(entrada)


# ---------------------------------------------------------------------------
# Contrato 8 - ValidarPinSalida
# ---------------------------------------------------------------------------


def test_pin_valido_devuelve_el_employee_id() -> None:
    empleado_id = uuid.uuid4()
    salida = ValidarPinSalida(valido=True, employee_id=empleado_id)

    assert salida.valido is True
    assert salida.employee_id == empleado_id


def test_pin_invalido_no_devuelve_employee_id() -> None:
    salida = ValidarPinSalida(valido=False)

    assert salida.valido is False
    assert salida.employee_id is None


def test_salida_del_contrato_8_solo_tiene_dos_campos() -> None:
    salida = ValidarPinSalida(valido=False)

    assert set(salida.model_dump()) == {"valido", "employee_id"}
