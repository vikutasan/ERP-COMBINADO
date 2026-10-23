"""Puerta de FASE 9.1.0 — Pagos mixtos (contrato + reglas RN-94/RN-95).

Verifica la compuerta de la sub-fase F9.1.0:

  1. RN-94 — la suma de los pagos cuadra EXACTAMENTE el total (Decimal, sin
     tolerancia). Cobrar de menos o de más se rechaza con `ReglaViolada` (400).
  2. RN-95 — cada pago usa un método válido (reutiliza RN-57, no duplica la
     lista de métodos).
  3. La forma canónica `pagos[]` es la que el router persiste.
  4. Retrocompatibilidad: un cobro viejo (`{metodo, recibido, cambio}`) se
     normaliza a `pagos[]` y sigue funcionando.

La unidad de migración es **regla + test** (Plan §5.1). Este archivo es la
compuerta de la sub-fase; los tests `test_rn94`/`test_rn95` de la matriz viven
en `test_f3_comportamiento.py` (la matriz regla → test es única).
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

import pytest

from routers.pos.deps import _normalizar_pagos
from rules import ReglaViolada
from rules import registry as R


# ===========================================================================
# Criterio 1 — RN-94: la suma de los pagos cuadra el total
# ===========================================================================

def test_rn94_pago_mixto_cuadra():
    """Un pago mixto (efectivo + tarjeta) que suma el total pasa."""
    R.rn94_suma_de_pagos_cuadra_total(
        [
            {"metodo": "EFECTIVO", "monto": "40.00"},
            {"metodo": "DEBITO", "monto": "60.00"},
        ],
        Decimal("100.00"),
    )


def test_rn94_pago_unico_cuadra():
    """Un pago único que suma el total pasa (retrocompatibilidad)."""
    R.rn94_suma_de_pagos_cuadra_total(
        [{"metodo": "EFECTIVO", "monto": "100.00"}], Decimal("100.00")
    )


def test_rn94_cobrar_de_menos_se_rechaza():
    """Cobrar de menos (saldo pendiente) se rechaza con 400."""
    with pytest.raises(ReglaViolada) as e:
        R.rn94_suma_de_pagos_cuadra_total(
            [{"metodo": "EFECTIVO", "monto": "40.00"}], Decimal("100.00")
        )
    assert e.value.codigo == 400
    assert e.value.regla == "RN-94"


def test_rn94_cobrar_de_mas_se_rechaza():
    """Cobrar de más (cambio mal calculado) se rechaza con 400."""
    with pytest.raises(ReglaViolada) as e:
        R.rn94_suma_de_pagos_cuadra_total(
            [{"metodo": "EFECTIVO", "monto": "120.00"}], Decimal("100.00")
        )
    assert e.value.codigo == 400


def test_rn94_sin_pagos_se_rechaza():
    """Un cobro sin pagos se rechaza (no se puede cuadrar el total)."""
    with pytest.raises(ReglaViolada) as e:
        R.rn94_suma_de_pagos_cuadra_total([], Decimal("100.00"))
    assert e.value.codigo == 400


def test_rn94_sin_tolerancia_de_punto_flotante():
    """El dinero es Decimal (DT-02): 0.01 de diferencia se rechaza."""
    with pytest.raises(ReglaViolada):
        R.rn94_suma_de_pagos_cuadra_total(
            [{"metodo": "EFECTIVO", "monto": "99.99"}], Decimal("100.00")
        )


# ===========================================================================
# Criterio 2 — RN-95: cada pago usa un método válido
# ===========================================================================

def test_rn95_pago_mixto_valido():
    """Un pago mixto con métodos válidos pasa."""
    R.rn95_metodos_de_pago_validos(
        [
            {"metodo": "EFECTIVO", "monto": "40.00"},
            {"metodo": "TRANSFERENCIA", "monto": "60.00"},
        ]
    )


def test_rn95_metodo_invalido_en_cualquier_abono_se_rechaza():
    """Un método inválido en cualquier abono se rechaza con 400."""
    with pytest.raises(ReglaViolada) as e:
        R.rn95_metodos_de_pago_validos(
            [
                {"metodo": "EFECTIVO", "monto": "40.00"},
                {"metodo": "BITCOIN", "monto": "60.00"},
            ]
        )
    assert e.value.codigo == 400
    assert e.value.regla == "RN-57"


def test_rn95_sin_pagos_se_rechaza():
    """Un cobro sin pagos se rechaza."""
    with pytest.raises(ReglaViolada) as e:
        R.rn95_metodos_de_pago_validos([])
    assert e.value.codigo == 400


def test_rn95_acepta_los_cuatro_metodos():
    """Los cuatro métodos válidos (RN-57) pasan individualmente."""
    for metodo in ("EFECTIVO", "CREDITO", "DEBITO", "TRANSFERENCIA"):
        R.rn95_metodos_de_pago_validos([{"metodo": metodo, "monto": "10.00"}])


# ===========================================================================
# Criterio 3 — La forma canónica `pagos[]` es la que se persiste
# ===========================================================================

def test_normalizar_respeta_la_forma_canonica():
    """Un `payment_details` ya canónico (`pagos[]`) se devuelve tal cual."""
    canonico = {
        "pagos": [
            {"metodo": "EFECTIVO", "monto": "40.00", "recibido": "50.00", "cambio": "10.00"},
            {"metodo": "DEBITO", "monto": "60.00"},
        ],
        "cajero": "Ana",
    }
    assert _normalizar_pagos(canonico) == canonico


# ===========================================================================
# Criterio 4 — Retrocompatibilidad: el cobro viejo se normaliza
# ===========================================================================

def test_normalizar_cobro_viejo_a_pagos():
    """Un cobro viejo (`{metodo, recibido, cambio}`) se convierte en `pagos[]`."""
    viejo = {"metodo": "efectivo", "recibido": "50.00", "cambio": "10.00", "monto": "40.00"}
    normalizado = _normalizar_pagos(viejo)
    assert "pagos" in normalizado
    assert len(normalizado["pagos"]) == 1
    pago = normalizado["pagos"][0]
    assert pago["metodo"] == "EFECTIVO"  # se normaliza a mayúsculas
    assert pago["monto"] == "40.00"
    assert pago["recibido"] == "50.00"
    assert pago["cambio"] == "10.00"
    # Las claves viejas de nivel superior ya no están (se movieron al pago).
    assert "metodo" not in normalizado
    assert "recibido" not in normalizado
    assert "cambio" not in normalizado


def test_normalizar_conserva_claves_extra():
    """Las claves extra (p. ej. `cajero`) se conservan al normalizar."""
    viejo = {"metodo": "EFECTIVO", "monto": "40.00", "cajero": "Ana"}
    normalizado = _normalizar_pagos(viejo)
    assert normalizado["cajero"] == "Ana"
    assert normalizado["pagos"][0]["metodo"] == "EFECTIVO"


def test_normalizar_dict_vacio_no_falla():
    """Un `payment_details` vacío no rompe la normalización (RN-94 lo rechazará)."""
    assert _normalizar_pagos({}) == {}
    assert _normalizar_pagos(None) == {}


def test_normalizar_sin_metodo_no_inventa_pagos():
    """Sin `metodo` ni `pagos`, no se inventa un pago (RN-94 lo rechazará)."""
    assert _normalizar_pagos({"cajero": "Ana"}) == {"cajero": "Ana"}


# ===========================================================================
# Criterio 5 — El cobro viejo normalizado cuadra con RN-94
# ===========================================================================

def test_cobro_viejo_normalizado_cuadra():
    """El flujo completo: cobro viejo → normalizar → RN-94/RN-95 pasan."""
    viejo = {"metodo": "efectivo", "monto": "100.00", "recibido": "100.00", "cambio": "0.00"}
    normalizado = _normalizar_pagos(viejo)
    pagos = normalizado["pagos"]
    R.rn95_metodos_de_pago_validos(pagos)
    R.rn94_suma_de_pagos_cuadra_total(pagos, Decimal("100.00"))


# ===========================================================================
# Criterio 5b — FICHA_FIX_SUMA_NO_CUADRA_VUELTO (3ª vuelta): defensa de
# frontera. Un cliente obsoleto que mande `monto = recibido` (p. ej. $150
# sobre un total de $100) NO debe romper el cobro: `monto` se acota al total
# y el excedente queda como cambio. El cobro de MENOS sigue rechazándose.
# ===========================================================================

def test_normalizar_acota_monto_al_total_con_vuelto():
    """`monto > total` se acota al total (el excedente es cambio, no pago)."""
    # Cliente obsoleto: manda `monto = recibido = 150` sobre un total de 100.
    malformado = {"metodo": "EFECTIVO", "monto": "150.00", "recibido": "150.00", "cambio": "0.00"}
    normalizado = _normalizar_pagos(malformado, Decimal("100.00"))
    pago = normalizado["pagos"][0]
    # El monto aplicado se acota al total: 100, no 150.
    assert Decimal(str(pago["monto"])) == Decimal("100.00")
    # El recibido se conserva (el cliente SÍ entregó 150).
    assert pago["recibido"] == "150.00"
    # Y ahora RN-94 pasa (antes fallaba con suma_no_cuadra).
    R.rn94_suma_de_pagos_cuadra_total(normalizado["pagos"], Decimal("100.00"))


def test_normalizar_vuelto_legitimo_cuadra():
    """Un vuelto legítimo (`monto = total`, `recibido > total`) cuadra."""
    con_vuelto = {"metodo": "EFECTIVO", "monto": "100.00", "recibido": "150.00", "cambio": "50.00"}
    normalizado = _normalizar_pagos(con_vuelto, Decimal("100.00"))
    pago = normalizado["pagos"][0]
    assert Decimal(str(pago["monto"])) == Decimal("100.00")
    R.rn94_suma_de_pagos_cuadra_total(normalizado["pagos"], Decimal("100.00"))


def test_normalizar_cobro_de_menos_sigue_rechazandose():
    """La defensa NO enmascara el cobro de menos: `monto < total` → RN-94 falla."""
    parcial = {"metodo": "EFECTIVO", "monto": "40.00", "recibido": "40.00", "cambio": "0.00"}
    normalizado = _normalizar_pagos(parcial, Decimal("100.00"))
    with pytest.raises(ReglaViolada):
        R.rn94_suma_de_pagos_cuadra_total(normalizado["pagos"], Decimal("100.00"))


def test_normalizar_monto_no_parseable_no_enmascara():
    """Un `monto` no numérico NO se acota (no es parseable): se conserva tal cual.

    La defensa de frontera solo acota montos NUMÉRICOS mayores al total. Un
    monto no parseable se deja intacto para no enmascarar el error: RN-94 lo
    rechazará al intentar convertirlo a Decimal (comportamiento pre-existente,
    fuera del alcance de esta corrección).
    """
    roto = {"metodo": "EFECTIVO", "monto": "no-es-un-numero", "recibido": "150.00"}
    normalizado = _normalizar_pagos(roto, Decimal("100.00"))
    # No se acota (no es parseable): se conserva para que RN-94 lo detecte.
    assert normalizado["pagos"][0]["monto"] == "no-es-un-numero"
    # RN-94 no puede sumar un monto no numérico: lanza InvalidOperation.
    with pytest.raises(InvalidOperation):
        R.rn94_suma_de_pagos_cuadra_total(normalizado["pagos"], Decimal("100.00"))


def test_normalizar_sin_total_no_acota():
    """Sin `total` no hay nada que acotar: el monto se conserva (retrocompat)."""
    viejo = {"metodo": "EFECTIVO", "monto": "150.00", "recibido": "150.00"}
    normalizado = _normalizar_pagos(viejo)
    assert normalizado["pagos"][0]["monto"] == "150.00"


# ===========================================================================
# Criterio 6 — F9.1.4a: `payment_details` viaja al cliente (TicketSalida)
# ===========================================================================

def test_ticket_salida_expone_payment_details():
    """`TicketSalida` incluye `payment_details` para que el papel lo desglose.

    Antes de F9.1.4 el dato se persistía en la tabla pero NUNCA llegaba al
    cliente: el ticket impreso no podía mostrar los N pagos del cobro mixto.
    """
    from schemas import TicketSalida

    salida = TicketSalida(
        id="00000000-0000-0000-0000-000000000001",
        account_num="V0001",
        status="PAID",
        total=Decimal("100.00"),
        version=2,
        channel="POS",
        items=[],
        payment_details={
            "pagos": [
                {"metodo": "EFECTIVO", "monto": "40.00"},
                {"metodo": "DEBITO", "monto": "60.00"},
            ],
            "cajero": "Ana",
        },
    )
    assert salida.payment_details is not None
    assert len(salida.payment_details["pagos"]) == 2
    assert salida.payment_details["pagos"][1]["metodo"] == "DEBITO"


def test_ticket_salida_sin_cobro_no_tiene_payment_details():
    """Un ticket aún no cobrado expone `payment_details = None` (no rompe)."""
    from schemas import TicketSalida

    salida = TicketSalida(
        id="00000000-0000-0000-0000-000000000002",
        account_num="V0002",
        status="DRAFT",
        total=Decimal("50.00"),
        version=1,
        channel="POS",
        items=[],
    )
    assert salida.payment_details is None
