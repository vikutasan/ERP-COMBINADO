"""Contratos 7 y 8 — Identidad del empleado y validación de PIN (FASE 3.1).

Este router es la ÚNICA puerta de entrada a `erp_seguridad`. Ningún otro módulo
lee las tablas `employees` ni `security_profiles`: el POS pide identidad por
HTTP y recibe una proyección (O-23).

Contrato 7 — `seguridad.identidad_del_empleado`
    GET /security/employees/{employee_id}
    200 → {"employee_id", "nombre", "perfil", "permisos"}
    404 → el UUID no existe

Contrato 8 — `seguridad.validar_pin`
    POST /security/employees/validate-pin
    200 → {"valido": true,  "employee_id": "UUID"}
    401 → {"valido": false, "employee_id": null}
    429 → rate-limit excedido (O-21)

Decisiones de diseño que no son obvias:

  * El contrato 8 responde 401 y no 404 cuando el PIN no existe. Un 404
    distinguiría "PIN inexistente" de "PIN de un colaborador dado de baja" y
    permitiría enumerar los PINs activos del negocio. Ambos casos son
    `valido=false` con el mismo código.
  * El PIN se busca con `WHERE employee_code = :pin`, igualdad exacta. Nunca
    `LIKE` ni `startswith`: el PIN "12" no puede abrir la sesión de "1234".
  * El rate-limit se aplica ANTES de tocar la base. Sin él, 4 dígitos son
    10 000 combinaciones y un script las recorre en segundos (O-21).
  * La consulta del contrato 7 usa `selectinload` del perfil para no disparar
    una segunda consulta por cada empleado leído.
"""

# NOTA: este módulo NO usa `from __future__ import annotations` a propósito.
# `slowapi` envuelve `validar_pin` con un decorador, y FastAPI resuelve las
# anotaciones contra los globales del wrapper. Con anotaciones diferidas
# (PEP 563) el nombre `ValidarPinEntrada` queda como cadena y no se puede
# resolver, lo que rompe el arranque con `PydanticUndefinedAnnotation`.
# Al evaluarlas de inmediato, el tipo real viaja en el `__annotations__`.

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import PIN_RATE_LIMIT
from core.database import get_db
from models.seguridad import Employee
from rules.registry import (
    ReglaViolada,
    rn_s01_pin_no_se_expone,
    rn_s02_permisos_desde_jsonb,
    rn_s03_empleado_inactivo_no_valida,
    rn_s04_pin_comparacion_exacta,
)
from schemas.seguridad import (
    IdentidadEmpleadoSalida,
    ValidarPinEntrada,
    ValidarPinSalida,
)

router = APIRouter(prefix="/security", tags=["seguridad"])

# O-21: el limitador vive en el router y se registra en `main.py` sobre
# `app.state.limiter`. La clave es la IP del cliente: el POS corre en la misma
# máquina que el navegador, así que una IP equivale a una terminal.
limiter = Limiter(key_func=get_remote_address)


def _proyeccion(empleado: Employee) -> dict[str, object]:
    """Arma la proyección del contrato 7 a partir de la fila del empleado.

    Se construye como `dict` y no directamente como modelo Pydantic para poder
    pasarla por `rn_s01_pin_no_se_expone` ANTES de serializarla. Si la regla
    lanza, el endpoint responde 500 y el PIN nunca llegó al cliente.

    Un colaborador sin perfil devuelve `perfil=""` y `permisos=[]`. No es un
    error: hay colaboradores de producción sin perfil asignado y el POS debe
    poder abrir turno con ellos (el perfil solo restringe acciones, no el
    acceso).
    """
    perfil = empleado.profile
    return {
        "employee_id": empleado.id,
        "nombre": empleado.name,
        "perfil": perfil.name if perfil is not None else "",
        "permisos": rn_s02_permisos_desde_jsonb(
            perfil.permissions if perfil is not None else None
        ),
    }


@router.get(
    "/employees/{employee_id}",
    response_model=IdentidadEmpleadoSalida,
    summary="Contrato 7 — identidad del empleado",
)
async def identidad_del_empleado(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> IdentidadEmpleadoSalida:
    """Devuelve la identidad y los permisos de un colaborador.

    `employee_id` se declara como `uuid.UUID`: FastAPI rechaza con 422 un id
    que no sea UUID antes de llegar a la base. Eso es correcto aquí porque el
    identificador no es un secreto (DT-03: el UUID identifica, el folio
    comunica) y un id mal formado es un error del llamador, no del negocio.

    Un colaborador inactivo SÍ se devuelve: la identidad es un dato histórico
    que la auditoría necesita para poner nombre a un ticket viejo. Lo que se
    bloquea es la validación del PIN (RN-S03), no la lectura del nombre.
    """
    consulta = (
        select(Employee)
        .options(selectinload(Employee.profile))
        .where(Employee.id == employee_id)
    )
    empleado = (await db.execute(consulta)).scalar_one_or_none()

    if empleado is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe un colaborador con id {employee_id}.",
        )

    return IdentidadEmpleadoSalida(**rn_s01_pin_no_se_expone(_proyeccion(empleado)))


@router.post(
    "/employees/validate-pin",
    response_model=ValidarPinSalida,
    summary="Contrato 8 — validar PIN",
)
@limiter.limit(PIN_RATE_LIMIT)
async def validar_pin(
    request: Request,
    entrada: ValidarPinEntrada,
    db: AsyncSession = Depends(get_db),
) -> ValidarPinSalida:
    """Valida un PIN y devuelve el colaborador al que pertenece.

    `request` no se usa en el cuerpo, pero es obligatorio: `slowapi` lee de él
    la IP del cliente para contar los intentos. Sin el parámetro, el decorador
    falla al construir la clave.

    El PIN se compara contra `employee_code` por igualdad exacta. La consulta
    trae como máximo una fila porque `employee_code` es UNIQUE.

    Un PIN válido de un colaborador inactivo devuelve `valido=false` con
    `employee_id=null` (RN-S03): el POS no debe poder distinguir "PIN
    equivocado" de "PIN de alguien dado de baja". Esa distinción solo la ve
    Recursos Humanos, que lee la tabla por su propio contrato.
    """
    consulta = select(Employee).where(Employee.employee_code == entrada.pin)
    empleado = (await db.execute(consulta)).scalar_one_or_none()

    if empleado is None:
        # 401 y no 404: no se filtra si el PIN existe (ver docstring del módulo).
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="PIN incorrecto.",
        )

    # RN-S04: la comparación se hace explícita aunque la consulta ya filtró por
    # igualdad. Si alguien cambia la consulta a un `LIKE`, esta regla lo detecta.
    if not rn_s04_pin_comparacion_exacta(entrada.pin, empleado.employee_code):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="PIN incorrecto.",
        )

    if not rn_s03_empleado_inactivo_no_valida(empleado.is_active):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="El colaborador está dado de baja.",
        )

    return ValidarPinSalida(valido=True, employee_id=empleado.id)


__all__ = ["router", "limiter", "ReglaViolada"]
