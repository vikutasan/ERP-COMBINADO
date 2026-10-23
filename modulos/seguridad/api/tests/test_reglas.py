"""Pruebas de las reglas puras de Seguridad y Acceso.

Estas pruebas no tocan base de datos ni HTTP: verifican unicamente las cuatro
funciones de `rules/registry.py`. Son la primera linea de defensa porque
cualquier router que las llame hereda el comportamiento probado aqui.
"""
from __future__ import annotations

import pytest

from rules.registry import (
    ReglaViolada,
    rn_s01_pin_no_se_expone,
    rn_s02_permisos_desde_jsonb,
    rn_s03_empleado_inactivo_no_valida,
    rn_s04_pin_comparacion_exacta,
)


# ---------------------------------------------------------------------------
# RN-S01 - el PIN nunca se expone
# ---------------------------------------------------------------------------


def test_rn_s01_deja_pasar_una_proyeccion_limpia() -> None:
    proyeccion = {
        "employee_id": "11111111-1111-1111-1111-111111111111",
        "nombre": "Ana Lopez",
        "perfil": "Cajero",
        "permisos": ["ventas.crear"],
    }

    assert rn_s01_pin_no_se_expone(proyeccion) == proyeccion


@pytest.mark.parametrize(
    "campo_prohibido",
    ["employee_code", "pin", "password", "hash", "secret"],
)
def test_rn_s01_rechaza_cada_campo_prohibido(campo_prohibido: str) -> None:
    proyeccion = {"employee_id": "x", "nombre": "Ana", campo_prohibido: "1234"}

    with pytest.raises(ReglaViolada) as excinfo:
        rn_s01_pin_no_se_expone(proyeccion)

    assert excinfo.value.regla == "RN-S01"
    assert excinfo.value.codigo == 500


def test_rn_s01_no_muta_la_proyeccion_original() -> None:
    proyeccion = {"employee_id": "x", "nombre": "Ana"}
    copia = dict(proyeccion)

    rn_s01_pin_no_se_expone(proyeccion)

    assert proyeccion == copia


# ---------------------------------------------------------------------------
# RN-S02 - los permisos salen del JSONB, ordenados y solo los verdaderos
# ---------------------------------------------------------------------------


def test_rn_s02_devuelve_solo_las_claves_verdaderas_y_ordenadas() -> None:
    permissions = {
        "ventas.crear": True,
        "ventas.anular": False,
        "caja.abrir": True,
        "reportes.ver": 0,
        "inventario.editar": 1,
    }

    assert rn_s02_permisos_desde_jsonb(permissions) == [
        "caja.abrir",
        "inventario.editar",
        "ventas.crear",
    ]


def test_rn_s02_tolera_perfil_sin_permisos() -> None:
    assert rn_s02_permisos_desde_jsonb(None) == []
    assert rn_s02_permisos_desde_jsonb({}) == []


def test_rn_s02_rechaza_un_perfil_corrupto() -> None:
    with pytest.raises(ReglaViolada) as excinfo:
        rn_s02_permisos_desde_jsonb(["ventas.crear"])  # type: ignore[arg-type]

    assert excinfo.value.regla == "RN-S02"
    assert excinfo.value.codigo == 500


# ---------------------------------------------------------------------------
# RN-S03 - un colaborador dado de baja no valida
# ---------------------------------------------------------------------------


def test_rn_s03_empleado_activo_valida() -> None:
    assert rn_s03_empleado_inactivo_no_valida(True) is True


def test_rn_s03_empleado_inactivo_no_valida() -> None:
    assert rn_s03_empleado_inactivo_no_valida(False) is False


def test_rn_s03_normaliza_valores_truthy() -> None:
    assert rn_s03_empleado_inactivo_no_valida(1) is True  # type: ignore[arg-type]
    assert rn_s03_empleado_inactivo_no_valida(0) is False  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# RN-S04 - comparacion exacta del PIN
# ---------------------------------------------------------------------------


def test_rn_s04_pin_identico_es_valido() -> None:
    assert rn_s04_pin_comparacion_exacta("1234", "1234") is True


@pytest.mark.parametrize(
    ("recibido", "almacenado"),
    [
        ("1234", "12345"),
        ("12345", "1234"),
        ("1234", "1235"),
        ("1234", " 1234"),
        ("1234", "1234 "),
        ("", "1234"),
    ],
)
def test_rn_s04_cualquier_diferencia_invalida(recibido: str, almacenado: str) -> None:
    assert rn_s04_pin_comparacion_exacta(recibido, almacenado) is False


def test_rn_s04_no_hace_coincidencia_por_prefijo() -> None:
    """Un PIN que es prefijo de otro NO debe validar (evita enumeracion)."""
    assert rn_s04_pin_comparacion_exacta("12", "1234") is False
