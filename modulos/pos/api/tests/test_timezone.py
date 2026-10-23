"""Tests de zona horaria — FA-02.

Verifica que `get_business_tz()`, `a_hora_local()` y `local_day_bounds_utc()`
usan ZoneInfo('America/Mexico_City') y producen el offset correcto.

NOTA HISTÓRICA — DST en México (importante para entender estos tests):
  México abolió el horario de verano (DST) mediante Decreto publicado en el
  DOF el 31 de octubre de 2022, vigente desde el 31 de octubre de 2022.
  A partir de 2023, America/Mexico_City es CST FIJO (UTC-6) todo el año.
  No existe CDT (UTC-5) para fechas >= 2023 en esta zona horaria.

  tzdata >= 2022g refleja este cambio. Si el contenedor tiene una versión
  anterior, los tests de verano fallarán dando UTC-5 en vez de UTC-6.

Los tests de "spring forward" y "fall back" que existían originalmente
documentaban un comportamiento que ya no aplica post-2023. Se reemplazaron
por tests que verifican que TODOS los días del año son de 24h (sin DST).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from rules.registry import (
    a_hora_local,
    get_business_tz,
    local_day_bounds_utc,
    utcnow,
)


# ---------------------------------------------------------------------------
# Utilidades de test
# ---------------------------------------------------------------------------

MEX = ZoneInfo("America/Mexico_City")


def utc(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def mex(year: int, month: int, day: int, hour: int = 0, minute: int = 0, fold: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=MEX, fold=fold)


# ---------------------------------------------------------------------------
# Test 1: get_business_tz devuelve ZoneInfo (no el fallback fijo)
# ---------------------------------------------------------------------------

def test_get_business_tz_es_zoneinfo() -> None:
    """FA-02: get_business_tz() debe devolver ZoneInfo, no timezone fijo."""
    tz = get_business_tz()
    assert isinstance(tz, ZoneInfo), (
        f"Se esperaba ZoneInfo pero se obtuvo {type(tz)}. "
        "Asegúrate de que tzdata>=2022g está instalado."
    )
    assert str(tz) == "America/Mexico_City"


# ---------------------------------------------------------------------------
# Test 2: Día de invierno — CST (UTC-6)
# ---------------------------------------------------------------------------

def test_a_hora_local_invierno() -> None:
    """Un instante UTC en invierno se convierte a CST = UTC-6."""
    # 2026-01-15 12:00 UTC → 2026-01-15 06:00 CST
    instante = utc(2026, 1, 15, 12, 0)
    local = a_hora_local(instante)
    assert local.hour == 6
    assert local.utcoffset() == timedelta(hours=-6)


def test_local_day_bounds_invierno() -> None:
    """Un día de invierno: 2026-01-15 00:00 CST = 06:00 UTC."""
    dia = datetime(2026, 1, 15, tzinfo=MEX)
    inicio_utc, fin_utc = local_day_bounds_utc(dia)

    # CST = UTC-6, así que medianoche local = 06:00 UTC
    assert inicio_utc == utc(2026, 1, 15, 6, 0)
    assert fin_utc == utc(2026, 1, 16, 6, 0)
    # El día tiene exactamente 24 horas
    assert (fin_utc - inicio_utc) == timedelta(hours=24)


# ---------------------------------------------------------------------------
# Test 3: Día de "verano" — post-2023 también es CST (UTC-6)
#
# Desde el Decreto DOF 31-Oct-2022, México eliminó el DST.
# America/Mexico_City es UTC-6 (CST) todo el año para 2023 en adelante.
# No existe CDT (UTC-5) para estas fechas.
# ---------------------------------------------------------------------------

def test_a_hora_local_verano_es_cst() -> None:
    """Post-2023: junio también es CST (UTC-6), NO CDT (UTC-5).

    México abolió el DST en 2023.  Un instante UTC en "verano" 2026
    se convierte a CST = UTC-6, igual que en invierno.
    """
    # 2026-06-15 12:00 UTC → 2026-06-15 06:00 CST (no 07:00 CDT)
    instante = utc(2026, 6, 15, 12, 0)
    local = a_hora_local(instante)
    assert local.hour == 6, (
        f"Se esperaba hour=6 (CST, UTC-6 fijo post-2023), obtuvo {local.hour}. "
        "Si obtienes 7, tzdata del contenedor es anterior a 2022g y no refleja "
        "la abolición del DST en México."
    )
    assert local.utcoffset() == timedelta(hours=-6)


def test_local_day_bounds_verano_es_cst() -> None:
    """Post-2023: un día de junio tiene 24h y usa UTC-6 (CST fijo)."""
    dia = datetime(2026, 6, 15, tzinfo=MEX)
    inicio_utc, fin_utc = local_day_bounds_utc(dia)

    # CST = UTC-6, medianoche local = 06:00 UTC (igual que en invierno)
    assert inicio_utc == utc(2026, 6, 15, 6, 0)
    assert fin_utc == utc(2026, 6, 16, 6, 0)
    # Sin DST, todos los días duran exactamente 24h
    assert (fin_utc - inicio_utc) == timedelta(hours=24)


# ---------------------------------------------------------------------------
# Test 4: Sin spring-forward — Los días de "transición histórica" son de 24h
#
# En el régimen antiguo, el primer domingo de abril era de 23h (spring-forward)
# y el último domingo de octubre era de 25h (fall-back).
# Post-2023: ambos días son días normales de 24h.
# ---------------------------------------------------------------------------

def test_dia_abril_historico_es_24h() -> None:
    """El primer domingo de abril (ex spring-forward) ahora es un día normal de 24h.

    Antes de 2023 este día duraba 23h (el reloj saltaba de 02:00 a 03:00).
    Post-2023: no hay salto; el día dura exactamente 24h como cualquier otro.
    """
    # 2026-04-05 era la fecha que habrían aplicado el spring-forward histórico
    dia = datetime(2026, 4, 5, tzinfo=MEX)
    inicio_utc, fin_utc = local_day_bounds_utc(dia)
    duracion = fin_utc - inicio_utc
    assert duracion == timedelta(hours=24), (
        f"Se esperaban 24h (sin DST post-2023), obtuvo {duracion}. "
        "Si obtienes 23h, tzdata no refleja la abolición del DST en México."
    )


def test_dia_octubre_historico_es_24h() -> None:
    """El último domingo de octubre (ex fall-back) ahora es un día normal de 24h.

    Antes de 2023 este día duraba 25h (el reloj retrocedía de 02:00 a 01:00).
    Post-2023: no hay retroceso; el día dura exactamente 24h.
    """
    # 2026-10-25 era la fecha que habrían aplicado el fall-back histórico
    dia = datetime(2026, 10, 25, tzinfo=MEX)
    inicio_utc, fin_utc = local_day_bounds_utc(dia)
    duracion = fin_utc - inicio_utc
    assert duracion == timedelta(hours=24), (
        f"Se esperaban 24h (sin DST post-2023), obtuvo {duracion}. "
        "Si obtienes 25h, tzdata no refleja la abolición del DST en México."
    )


def test_offset_constante_todo_el_anio() -> None:
    """Post-2023: el offset de America/Mexico_City es UTC-6 los 12 meses.

    Verifica enero, abril, junio y octubre — los 4 puntos críticos del
    antiguo calendario DST — para confirmar que todos son UTC-6.
    """
    fechas = [
        ("enero",   utc(2026, 1, 15, 12, 0)),
        ("abril",   utc(2026, 4, 5,  12, 0)),   # ex spring-forward
        ("junio",   utc(2026, 6, 15, 12, 0)),   # ex "verano CDT"
        ("octubre", utc(2026, 10, 25, 8, 0)),   # ex fall-back
    ]
    for nombre, instante in fechas:
        local = a_hora_local(instante)
        assert local.utcoffset() == timedelta(hours=-6), (
            f"Se esperaba UTC-6 en {nombre} 2026 (CST fijo post-2023), "
            f"obtuvo {local.utcoffset()}."
        )


# ---------------------------------------------------------------------------
# Test 5: utcnow devuelve UTC con tzinfo
# ---------------------------------------------------------------------------

def test_utcnow_tiene_tzinfo() -> None:
    """utcnow() siempre devuelve un datetime con tzinfo=UTC."""
    ahora = utcnow()
    assert ahora.tzinfo is not None
    assert ahora.utcoffset() == timedelta(0)


# ---------------------------------------------------------------------------
# Test 6: Regresión — offset fijo y ZoneInfo producen el MISMO resultado post-2023
#
# Antes de 2023: ZoneInfo daba UTC-5 en verano, offset fijo UTC-6 → 1h de error.
# Post-2023:     ZoneInfo da UTC-6 todo el año, igual que el offset fijo.
#                La regresión histórica ya no existe; este test documenta el cambio.
# ---------------------------------------------------------------------------

def test_regresion_offset_fijo_ya_no_aplica_post_2023() -> None:
    """Post-2023: ZoneInfo y offset fijo UTC-6 producen el mismo resultado.

    Antes de 2023 el offset fijo era incorrecto en verano (1h de error en
    el arqueo de caja). Ahora Mexico City es CST fijo, igual que el offset.
    El bug histórico ya no existe — este test documenta ese cambio.
    """
    instante = utc(2026, 6, 15, 12, 0)

    # ZoneInfo — CST fijo post-2023 (UTC-6)
    local_zoneinfo = a_hora_local(instante)
    assert local_zoneinfo.hour == 6
    assert local_zoneinfo.utcoffset() == timedelta(hours=-6)

    # Offset fijo — UTC-6 siempre
    local_fijo = instante.astimezone(timezone(timedelta(hours=-6)))
    assert local_fijo.hour == 6

    # Post-2023: no hay diferencia entre ZoneInfo y offset fijo en verano
    diff = local_zoneinfo.utcoffset() - local_fijo.utcoffset()
    assert diff == timedelta(0), (
        "Se esperaba diferencia 0 (ambos UTC-6 post-2023). "
        f"Obtuvo {diff} — tzdata podría no tener el decreto DOF 31-Oct-2022."
    )
