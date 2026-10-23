"""Esquemas de caja — Contratos 9–14 (FASE 4.1) (FD-03)."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid5

from pydantic import BaseModel, Field, field_validator

# Espacio de nombres fijo para derivar UUIDs deterministas desde IDs del ERP.
# @see FICHA_FIX_TURNO_CAJA_USUARIO_ID (7 Oct 2026)
ESPACIO_IDS_ERP = UUID("6f2a1c9e-0b7d-4e3a-9c5f-1d8b2a4e6f70")


class SesionCajaActiva(BaseModel):
    """Salida del contrato 9: la sesión de caja abierta de una terminal.

    El POS NO lee la tabla `cash_sessions`: pregunta por este contrato. Si no
    hay turno abierto, `cash_session_id` es `None` (no es un error).
    """

    cash_session_id: UUID | None = None
    abierta_en: datetime | None = None


class AbrirTurnoEntrada(BaseModel):
    """Entrada del contrato 10: abrir un turno de caja.

    `monto_inicial` es el fondo con el que arranca el cajero (RN-50: no puede
    ser negativo). `usuario_id` es el empleado que abre el turno.

    FASE 10.5 — PARIDAD DE DATOS DE CAJA. El viejo POS enviaba
    `employee_name` al abrir la sesión y lo persistía en
    `cash_sessions.employee_name`; el corte y el reporte diario lo mostraban.
    El nuevo POS solo enviaba `usuario_id`, así que el nombre del cajero se
    perdía (se guardaba el UUID como nombre). `usuario_nombre` restaura ese
    dato. Es OPCIONAL para no romper a un consumidor que aún no lo envíe: si
    falta, el router cae al `usuario_id` (comportamiento anterior).

    FICHA_FIX_TURNO_CAJA_USUARIO_ID (7 Oct 2026) — TOLERANCIA AL ID DEL ERP.
    El ERP autentica al cajero con un id NUMÉRICO (`currentUser.id = 1`), no
    con un UUID. Declarar `usuario_id: UUID` hacía que Pydantic v2 rechazara
    la petición con 422 (`uuid_type`) y el turno NUNCA se abría.
    La corrección acepta `str | int | UUID` y lo normaliza a UUID determinista.
    """

    terminal_id: str
    usuario_id: str | int | UUID
    monto_inicial: Decimal = Field(default=Decimal("0.00"), ge=0)
    usuario_nombre: str | None = None

    @field_validator("usuario_id", mode="before")
    @classmethod
    def _normalizar_usuario_id(cls, valor: object) -> UUID:
        """Normaliza el id del empleado a un UUID determinista."""
        if isinstance(valor, UUID):
            return valor
        if isinstance(valor, str):
            try:
                return UUID(valor)
            except (ValueError, AttributeError):
                return uuid5(ESPACIO_IDS_ERP, valor)
        if isinstance(valor, int):
            return uuid5(ESPACIO_IDS_ERP, str(valor))
        raise ValueError("usuario_id debe ser un UUID o un id de empleado")


class AbrirTurnoSalida(BaseModel):
    """Salida del contrato 10: el turno recién abierto."""

    cash_session_id: UUID
    abierta_en: datetime


class MovimientoEntrada(BaseModel):
    """Entrada del contrato 11: registrar una entrada o salida de efectivo.

    `tipo` es ENTRADA o SALIDA (RN-51). `motivo` es el concepto (obligatorio).
    """

    cash_session_id: UUID
    tipo: str
    monto: Decimal
    motivo: str


class MovimientoSalida(BaseModel):
    """Salida del contrato 11: el movimiento persistido."""

    movement_id: UUID


class EliminarMovimientoSalida(BaseModel):
    """Salida del contrato 29: el movimiento eliminado (FASE 10.6.2).

    El viejo POS ya permitía borrar un movimiento mientras la caja estuviera
    abierta (RN-52); el nuevo POS lo había OMITIDO. Esta salida confirma el
    borrado para que el POS refresque el resumen sin adivinar.
    """

    eliminado: bool = True


class MovimientoResumen(BaseModel):
    """Un movimiento dentro del resumen del turno (contrato 12).

    FASE 10.6.2 — Se añade `movement_id` para el botón ✕ de eliminar.
    FASE 10.6.3 — Se añaden `creado_en` y `motivo` para paridad con el viejo POS.
    """

    movement_id: UUID
    tipo: str
    monto: Decimal
    motivo: str
    creado_en: datetime


class ResumenTurnoSalida(BaseModel):
    """Salida del contrato 12: la PROYECCIÓN del turno, no la tabla.

    `esperado` es el efectivo que debería haber en la caja (RN-53):
    fondo + entradas − salidas + ventas en efectivo.

    F10.5 — Desglose de paridad: 7 campos adicionales para conciliación.
    DEUDA-BUG08 — `ventas_propias` y `ventas_ajenas` separan el total por
    terminal de origen del ticket.
    """

    esperado: Decimal
    movimientos: list[MovimientoResumen] = Field(default_factory=list)
    fondo_inicial: Decimal = Decimal("0.00")
    total_entradas: Decimal = Decimal("0.00")
    total_salidas: Decimal = Decimal("0.00")
    total_credito: Decimal = Decimal("0.00")
    total_debito: Decimal = Decimal("0.00")
    total_transferencia: Decimal = Decimal("0.00")
    total_ventas: Decimal = Decimal("0.00")
    num_transacciones: int = 0
    ventas_propias: Decimal = Decimal("0.00")
    ventas_ajenas: Decimal = Decimal("0.00")
    num_transacciones_ajenas: int = 0


class CerrarTurnoEntrada(BaseModel):
    """Entrada del contrato 13: cerrar el turno con el conteo físico.

    `montos_fisicos` es el efectivo contado; `credito` y `debito` son los
    vouchers contados (RN-54).
    """

    cash_session_id: UUID
    montos_fisicos: Decimal
    credito: Decimal = Field(default=Decimal("0.00"))
    debito: Decimal = Field(default=Decimal("0.00"))


class CerrarTurnoSalida(BaseModel):
    """Salida del contrato 13: el arqueo con su descuadre.

    `diferencia` = capturado − esperado. Positivo = sobrante; negativo = faltante.
    """

    esperado: Decimal
    capturado: Decimal
    diferencia: Decimal


class LineaReporteDiario(BaseModel):
    """Una línea del reporte diario (contrato 14), agrupada por canal/cajero."""

    canal: str
    cajero: str
    terminal: str
    total: Decimal


class ReporteDiarioSalida(BaseModel):
    """Salida del contrato 14: el reporte del día local (RN-59)."""

    fecha: str
    reporte: list[LineaReporteDiario] = Field(default_factory=list)
