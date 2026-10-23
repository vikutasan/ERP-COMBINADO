"""Pruebas de los endpoints de Seguridad y Acceso (contratos 7 y 8).

Se ejercita el router real de FastAPI con `TestClient`, sustituyendo la
dependencia de base de datos por una sesión falsa. Así se verifica el
comportamiento observable del contrato —códigos HTTP, forma del JSON y
reglas de negocio— sin necesidad de levantar PostgreSQL.

Contratos cubiertos:
  * Contrato 7 — GET  /security/employees/{employee_id}
  * Contrato 8 — POST /security/employees/validate-pin

Reglas verificadas:
  * RN-S01 — la proyección nunca expone `employee_code` ni secretos.
  * RN-S03 — un colaborador inactivo no valida.
  * RN-S04 — el PIN se compara por igualdad exacta, nunca por prefijo.
  * O-21   — el PIN nunca viaja de vuelta en la respuesta.
"""

from __future__ import annotations

import uuid
from typing import Any, Iterator

import pytest
from fastapi.testclient import TestClient

from core.database import get_db
from main import app
from models.seguridad import Employee, SecurityProfile


# ---------------------------------------------------------------------------
# Utilidades de prueba
# ---------------------------------------------------------------------------


class _ResultadoFalso:
    """Imita el resultado de `session.execute(...)`."""

    def __init__(self, valor: Any) -> None:
        self._valor = valor

    def scalar_one_or_none(self) -> Any:
        return self._valor


class _SesionFalsa:
    """Sesión mínima: devuelve un empleado fijo o `None`."""

    def __init__(self, empleado: Employee | None) -> None:
        self._empleado = empleado
        self.consultas = 0

    async def execute(self, *_args: Any, **_kwargs: Any) -> _ResultadoFalso:
        self.consultas += 1
        return _ResultadoFalso(self._empleado)


def _empleado(
    *,
    pin: str = "1234",
    activo: bool = True,
    permisos: dict[str, Any] | None = None,
) -> Employee:
    """Construye un `Employee` en memoria con un perfil asociado."""
    perfil = SecurityProfile(
        id=uuid.uuid4(),
        name="Cajero",
        description="Perfil de prueba",
        permissions=permisos if permisos is not None else {"ventas.crear": True},
        is_system=False,
    )
    empleado = Employee(
        id=uuid.uuid4(),
        name="Ana López",
        employee_code=pin,
        role="CAJERO",
        is_active=activo,
        profile_id=perfil.id,
        employee_number=7,
        exclude_attendance=False,
    )
    empleado.profile = perfil
    return empleado


@pytest.fixture()
def cliente() -> Iterator[TestClient]:
    """Cliente con la dependencia de sesión neutralizada."""
    with TestClient(app) as cliente_http:
        yield cliente_http
    app.dependency_overrides.clear()


def _montar_sesion(empleado: Employee | None) -> _SesionFalsa:
    """Inyecta una sesión falsa que devuelve `empleado`.

    `get_db` es un generador asíncrono en producción, así que la sustitución
    también lo es: FastAPI cierra la dependencia al terminar la petición.
    """
    sesion = _SesionFalsa(empleado)

    async def _dependencia() -> Any:
        yield sesion

    app.dependency_overrides[get_db] = _dependencia
    return sesion


# ---------------------------------------------------------------------------
# Contrato 7 — GET /security/employees/{employee_id}
# ---------------------------------------------------------------------------


def test_contrato_7_devuelve_los_cuatro_campos(cliente: TestClient) -> None:
    empleado = _empleado(permisos={"ventas.crear": True, "caja.abrir": True})
    _montar_sesion(empleado)

    respuesta = cliente.get(f"/security/employees/{empleado.id}")

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert set(cuerpo) == {"employee_id", "nombre", "perfil", "permisos"}
    assert cuerpo["employee_id"] == str(empleado.id)
    assert cuerpo["nombre"] == "Ana López"
    assert cuerpo["perfil"] == "Cajero"
    assert cuerpo["permisos"] == ["caja.abrir", "ventas.crear"]


def test_contrato_7_nunca_expone_el_pin(cliente: TestClient) -> None:
    empleado = _empleado(pin="9876")
    _montar_sesion(empleado)

    respuesta = cliente.get(f"/security/employees/{empleado.id}")

    assert respuesta.status_code == 200
    assert "9876" not in respuesta.text
    assert "employee_code" not in respuesta.text


def test_contrato_7_devuelve_404_si_no_existe(cliente: TestClient) -> None:
    _montar_sesion(None)

    respuesta = cliente.get(f"/security/employees/{uuid.uuid4()}")

    assert respuesta.status_code == 404
    assert "detail" in respuesta.json()


def test_contrato_7_rechaza_un_id_que_no_es_uuid(cliente: TestClient) -> None:
    _montar_sesion(None)

    respuesta = cliente.get("/security/employees/no-es-un-uuid")

    assert respuesta.status_code == 422


def test_contrato_7_tolera_un_perfil_sin_permisos(cliente: TestClient) -> None:
    empleado = _empleado(permisos={})
    _montar_sesion(empleado)

    respuesta = cliente.get(f"/security/employees/{empleado.id}")

    assert respuesta.status_code == 200
    assert respuesta.json()["permisos"] == []


# ---------------------------------------------------------------------------
# Contrato 8 — POST /security/employees/validate-pin
# ---------------------------------------------------------------------------


def test_contrato_8_pin_correcto_devuelve_el_employee_id(cliente: TestClient) -> None:
    empleado = _empleado(pin="4321")
    _montar_sesion(empleado)

    respuesta = cliente.post(
        "/security/employees/validate-pin",
        json={"employee_id": str(empleado.id), "pin": "4321"},
    )

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert set(cuerpo) == {"valido", "employee_id"}
    assert cuerpo["valido"] is True
    assert cuerpo["employee_id"] == str(empleado.id)


def test_contrato_8_pin_incorrecto_devuelve_401(cliente: TestClient) -> None:
    empleado = _empleado(pin="4321")
    _montar_sesion(empleado)

    respuesta = cliente.post(
        "/security/employees/validate-pin",
        json={"employee_id": str(empleado.id), "pin": "0000"},
    )

    assert respuesta.status_code == 401
    assert "4321" not in respuesta.text


def test_contrato_8_no_acepta_un_prefijo_del_pin(cliente: TestClient) -> None:
    """RN-S04: un PIN que es prefijo de otro NO abre la sesión.

    El prefijo debe tener longitud válida para que la prueba llegue al router:
    un PIN demasiado corto lo rechaza el esquema con 422 y no probaría nada.
    """
    empleado = _empleado(pin="43210")
    _montar_sesion(empleado)

    respuesta = cliente.post(
        "/security/employees/validate-pin",
        json={"employee_id": str(empleado.id), "pin": "4321"},
    )

    assert respuesta.status_code == 401


def test_contrato_8_empleado_inexistente_devuelve_401(cliente: TestClient) -> None:
    _montar_sesion(None)

    respuesta = cliente.post(
        "/security/employees/validate-pin",
        json={"employee_id": str(uuid.uuid4()), "pin": "1234"},
    )

    assert respuesta.status_code == 401


def test_contrato_8_empleado_inactivo_no_valida(cliente: TestClient) -> None:
    empleado = _empleado(pin="4321", activo=False)
    _montar_sesion(empleado)

    respuesta = cliente.post(
        "/security/employees/validate-pin",
        json={"employee_id": str(empleado.id), "pin": "4321"},
    )

    assert respuesta.status_code == 401
    assert "baja" in respuesta.json()["detail"].lower()


def test_contrato_8_pin_con_forma_invalida_devuelve_422(cliente: TestClient) -> None:
    empleado = _empleado(pin="4321")
    _montar_sesion(empleado)

    respuesta = cliente.post(
        "/security/employees/validate-pin",
        json={"employee_id": str(empleado.id), "pin": "abcd"},
    )

    assert respuesta.status_code == 422


def test_contrato_8_la_respuesta_nunca_contiene_el_pin(cliente: TestClient) -> None:
    empleado = _empleado(pin="4321")
    _montar_sesion(empleado)

    respuesta = cliente.post(
        "/security/employees/validate-pin",
        json={"employee_id": str(empleado.id), "pin": "4321"},
    )

    assert respuesta.status_code == 200
    assert "4321" not in respuesta.text


# ---------------------------------------------------------------------------
# Salud del servicio
# ---------------------------------------------------------------------------


def test_health_responde_ok(cliente: TestClient) -> None:
    respuesta = cliente.get("/health")

    assert respuesta.status_code == 200
    assert respuesta.json()["status"] == "ok"
