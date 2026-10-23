"""Reglas de negocio del módulo Seguridad y Acceso — FASE 3.1."""

from rules.registry import (
    ReglaViolada,
    rn_s01_pin_no_se_expone,
    rn_s02_permisos_desde_jsonb,
    rn_s03_empleado_inactivo_no_valida,
    rn_s04_pin_comparacion_exacta,
)

__all__ = [
    "ReglaViolada",
    "rn_s01_pin_no_se_expone",
    "rn_s02_permisos_desde_jsonb",
    "rn_s03_empleado_inactivo_no_valida",
    "rn_s04_pin_comparacion_exacta",
]
