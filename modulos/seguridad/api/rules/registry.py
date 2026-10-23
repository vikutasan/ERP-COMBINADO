"""Reglas de negocio de Seguridad y Acceso — FASE 3.1.

Las reglas del POS se numeran RN-01..RN-95 y viven en el módulo POS. Estas son
las reglas PROPIAS de Seguridad, con prefijo `RN-S` para que nunca se confundan
con las del POS en un log o en un test.

Cada regla es una función pura: recibe datos, devuelve datos o lanza
`ReglaViolada`. No conoce HTTP, no conoce SQLAlchemy, no toca la base. Eso
permite probarlas sin levantar nada y garantiza que la misma regla se aplique
sin importar quién llame al endpoint.
"""

from __future__ import annotations

from typing import Any


class ReglaViolada(Exception):
    """Se lanza cuando una regla de negocio de Seguridad se viola.

    `codigo` es el código HTTP con el que la capa de transporte debe
    responder. El dominio no sabe que existe HTTP; solo declara la gravedad.
    """

    def __init__(self, regla: str, mensaje: str, codigo: int = 400) -> None:
        super().__init__(mensaje)
        self.regla = regla
        self.mensaje = mensaje
        self.codigo = codigo


# ---------------------------------------------------------------------------
# RN-S01 — El PIN nunca sale del módulo.
# ---------------------------------------------------------------------------
def rn_s01_pin_no_se_expone(proyeccion: dict[str, Any]) -> dict[str, Any]:
    """Verifica que una proyección de empleado no contenga el PIN.

    O-23 prohíbe que un contrato exponga una tabla, y O-21 prohíbe que un
    secreto viaje fuera del contrato 8. Esta regla es la última barrera: si
    alguien añade `employee_code` a la proyección del contrato 7, el endpoint
    falla en vez de filtrar los 64 PINs del negocio.

    Se comprueba por nombre de campo, no por valor: un PIN podría coincidir
    con un nombre por casualidad y eso no es una fuga.
    """
    prohibidos = {"employee_code", "pin", "password", "hash", "secret"}
    presentes = prohibidos.intersection(proyeccion.keys())
    if presentes:
        raise ReglaViolada(
            "RN-S01",
            f"La proyección del empleado expone un campo prohibido: "
            f"{sorted(presentes)}. El PIN solo viaja por el contrato 8.",
            500,
        )
    return proyeccion


# ---------------------------------------------------------------------------
# RN-S02 — Los permisos se derivan del JSONB, nunca se inventan.
# ---------------------------------------------------------------------------
def rn_s02_permisos_desde_jsonb(permissions: dict[str, Any] | None) -> list[str]:
    """Convierte el JSONB de permisos en la `List[String]` del contrato 7.

    El JSONB de producción tiene la forma `{"modulo": true|false, ...}`. El
    contrato 7 promete una lista de claves. La traducción es: las claves cuyo
    valor es verdadero, ordenadas alfabéticamente.

    Un permiso con valor `false` NO se incluye: el POS pregunta "¿puede hacer
    esto?" y la respuesta debe ser una lista de lo que SÍ puede. Incluir los
    `false` obligaría a cada consumidor a repetir la comprobación del valor.

    Un `permissions` nulo o vacío devuelve lista vacía, nunca `None`: el
    contrato promete `List[String]` y una lista vacía es una lista válida.
    """
    if not permissions:
        return []
    if not isinstance(permissions, dict):
        raise ReglaViolada(
            "RN-S02",
            f"`permissions` debe ser un objeto JSON, llegó {type(permissions).__name__}.",
            500,
        )
    return sorted(clave for clave, valor in permissions.items() if valor)


# ---------------------------------------------------------------------------
# RN-S03 — Un colaborador inactivo no valida su PIN.
# ---------------------------------------------------------------------------
def rn_s03_empleado_inactivo_no_valida(is_active: bool) -> bool:
    """Devuelve si el colaborador puede autenticarse.

    La baja de un colaborador es `is_active = false`. Un colaborador dado de
    baja conserva su fila (para que la auditoría histórica siga teniendo
    nombre) pero no puede abrir turno. Esta regla es la que impide que un PIN
    viejo siga sirviendo después de un despido.
    """
    return bool(is_active)


# ---------------------------------------------------------------------------
# RN-S04 — El PIN se compara por igualdad exacta, nunca por prefijo.
# ---------------------------------------------------------------------------
def rn_s04_pin_comparacion_exacta(pin_recibido: str, pin_almacenado: str) -> bool:
    """Compara dos PINs por igualdad exacta.

    Existe como función propia para que la comparación sea visible y
    auditable. Un `LIKE` o un `startswith` en la consulta SQL permitiría que
    el PIN "12" abriera la sesión del PIN "1234"; esta regla y la consulta
    del router (`WHERE employee_code = :pin`) lo hacen imposible.

    No se usa `hmac.compare_digest` porque el PIN no es un hash: es un código
    de 4 dígitos que se compara contra una columna indexada. La defensa real
    contra la fuerza bruta es el rate-limit (O-21), no el tiempo constante.
    """
    return pin_recibido == pin_almacenado
