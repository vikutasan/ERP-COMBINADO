"""Puerta de FASE 4 — Guardianes (A-03, A-04, A-05).

Verifica los 3 criterios de la puerta (Plan de Construcción §6.3):

  1. El CI **falla** si se viola una regla crítica (verificable rompiendo una
     a propósito). → cada guardián de A-03 se prueba en las DOS direcciones:
     no dispara con un escenario sano y SÍ dispara (lanza `GuardianViolado`)
     con el escenario que viola la regla.
  2. **0** `try/except pass` en la ruta crítica (búsqueda automatizada en CI).
     → el Outbox (A-04) propaga la excepción; nunca la silencia.
  3. Ninguna regla de negocio usa el folio como identidad. → A-05 lo hace
     imposible: `folio_no_es_identidad` lanza `ReglaViolada`.

La diferencia con la puerta de F3 es de dirección: F3 prueba que la regla HACE
lo que dice; F4 prueba que la regla NO PERMITE lo que prohíbe.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from guards import (
    GUARDIANES_CRITICOS,
    EventoOutbox,
    GuardianViolado,
    IdentidadDeTicket,
    OutboxTransaccional,
    folio_no_es_identidad,
    identidad_es_uuid,
    listar_guardianes,
    matriz_guardian_regla,
    separar_identidad_de_folio,
)
from rules import ReglaViolada


# ===========================================================================
# Criterio 1 — el CI falla si se viola una regla crítica (A-03)
# ===========================================================================

def test_criterio1_hay_un_guardian_por_cada_cicatriz():
    """Las 5 cicatrices de F3 están cubiertas por al menos un guardián."""
    reglas_cubiertas = {g.regla for g in GUARDIANES_CRITICOS}
    # DRAFT GUARD, anti-degradación, bloqueo optimista, reciclaje de folios,
    # idempotencia de emergencia + identidad + zona horaria.
    esperadas = {"RN-31", "RN-37", "RN-25", "RN-10", "RN-63", "RN-09", "RN-81"}
    assert esperadas <= reglas_cubiertas, (
        f"Faltan guardianes para: {esperadas - reglas_cubiertas}"
    )


def test_criterio1_cada_guardian_tiene_regla_nombre_y_amenaza():
    """Todo guardián declara la regla que protege, su nombre y su amenaza."""
    for g in GUARDIANES_CRITICOS:
        assert g.regla.startswith("RN-"), f"{g.nombre} no declara regla"
        assert g.nombre, "un guardián no tiene nombre"
        assert g.amenaza, f"{g.nombre} no declara la amenaza que detecta"
        assert callable(g.detectar), f"{g.nombre} no tiene detector"


def test_criterio1_la_matriz_guardian_regla_esta_completa():
    """La matriz guardián → regla tiene una entrada por guardián."""
    matriz = matriz_guardian_regla()
    assert len(matriz) == len(GUARDIANES_CRITICOS)
    assert len(listar_guardianes()) == len(GUARDIANES_CRITICOS)


def test_criterio1_romper_una_regla_hace_fallar_al_guardian():
    """Verificable rompiendo una regla a propósito: el guardián DEBE fallar.

    Este es el corazón de A-03: si el escenario viola la regla, `vigilar`
    lanza `GuardianViolado`. Si no lo hiciera, el CI no protegería nada.
    """
    # Escenario que VIOLA RN-31: una terminal escribe el DRAFT de otra.
    escenario_malo = {
        "ticket": {"status": "DRAFT", "terminal_id": "T-02"},
        "terminal_id": "T-01",
    }
    guardian = next(g for g in GUARDIANES_CRITICOS if g.regla == "RN-31")
    with pytest.raises(GuardianViolado) as excinfo:
        guardian.vigilar(escenario_malo)
    assert excinfo.value.regla == "RN-31"
    assert excinfo.value.guardian == guardian.nombre


def test_criterio1_el_escenario_sano_no_dispara_al_guardian():
    """La otra dirección: un escenario sano NO debe hacer fallar al guardián."""
    escenario_bueno = {
        "ticket": {"status": "DRAFT", "terminal_id": "T-01"},
        "terminal_id": "T-01",
    }
    guardian = next(g for g in GUARDIANES_CRITICOS if g.regla == "RN-31")
    guardian.vigilar(escenario_bueno)  # no debe lanzar


# ── Cada guardián, en sus dos direcciones ───────────────────────────────────

def test_guardian_draft_guard():
    """RN-31: el DRAFT de otra terminal se rechaza; el propio se acepta."""
    g = next(x for x in GUARDIANES_CRITICOS if x.regla == "RN-31")
    with pytest.raises(GuardianViolado):
        g.vigilar({"ticket": {"status": "DRAFT", "terminal_id": "T-02"}, "terminal_id": "T-01"})
    g.vigilar({"ticket": {"status": "DRAFT", "terminal_id": "T-01"}, "terminal_id": "T-01"})
    # Un ticket que NO es DRAFT no es asunto del DRAFT GUARD.
    g.vigilar({"ticket": {"status": "PAID", "terminal_id": "T-02"}, "terminal_id": "T-01"})


def test_guardian_anti_degradacion():
    """RN-37: caer por debajo del 50% sin confirmación se rechaza."""
    g = next(x for x in GUARDIANES_CRITICOS if x.regla == "RN-37")
    with pytest.raises(GuardianViolado):
        g.vigilar({"total_actual": 10, "total_nuevo": 4, "confirmado": False})
    # Con confirmación explícita, se permite.
    g.vigilar({"total_actual": 10, "total_nuevo": 4, "confirmado": True})
    # Por encima del umbral, se permite.
    g.vigilar({"total_actual": 10, "total_nuevo": 8, "confirmado": False})


def test_guardian_bloqueo_optimista():
    """RN-25: escribir con una versión obsoleta se rechaza."""
    g = next(x for x in GUARDIANES_CRITICOS if x.regla == "RN-25")
    with pytest.raises(GuardianViolado):
        g.vigilar({"version_recibido": 3, "version_actual": 5})
    g.vigilar({"version_recibido": 5, "version_actual": 5})


def test_guardian_reciclaje_de_folios():
    """RN-10: reutilizar un folio ya emitido se rechaza."""
    g = next(x for x in GUARDIANES_CRITICOS if x.regla == "RN-10")
    with pytest.raises(GuardianViolado):
        g.vigilar({"folios_emitidos": ["V0001", "V0002"], "folio_nuevo": "V0001"})
    g.vigilar({"folios_emitidos": ["V0001", "V0002"], "folio_nuevo": "V0003"})


def test_guardian_idempotencia_de_emergencia():
    """RN-63/RN-66: aplicar un evento dos veces se rechaza."""
    g = next(x for x in GUARDIANES_CRITICOS if x.regla == "RN-63"
             and x.nombre == "el_evento_no_se_aplica_dos_veces")
    evento_id = uuid4()
    with pytest.raises(GuardianViolado):
        g.vigilar({
            "movimientos": [{"evento_id": evento_id, "item_id": "it-1"}],
            "evento_id": evento_id,
            "item_id": "it-1",
        })
    g.vigilar({"movimientos": [], "evento_id": evento_id, "item_id": "it-1"})


def test_guardian_identidad_no_es_folio():
    """A-05: usar el folio como identidad se rechaza."""
    g = next(x for x in GUARDIANES_CRITICOS if x.regla == "RN-09")
    with pytest.raises(GuardianViolado):
        g.vigilar({"clave_usada": "folio"})
    g.vigilar({"clave_usada": "id"})


def test_guardian_sin_offset_hardcodeado():
    """RN-81: hardcodear un offset de zona horaria se rechaza."""
    g = next(x for x in GUARDIANES_CRITICOS if x.regla == "RN-81")
    with pytest.raises(GuardianViolado):
        g.vigilar({"fuente": "return ahora + timedelta(hours=6)"})
    g.vigilar({"fuente": "return ahora.astimezone(get_business_tz())"})


def test_guardian_evento_en_misma_transaccion():
    """A-04: emitir el evento fuera de la transacción se rechaza."""
    g = next(x for x in GUARDIANES_CRITICOS if x.nombre == "el_evento_vive_en_la_misma_transaccion")
    with pytest.raises(GuardianViolado):
        g.vigilar({"evento_en_misma_transaccion": False})
    g.vigilar({"evento_en_misma_transaccion": True})


def test_guardian_sin_silencios_en_ruta_critica():
    """A-04 / E-05: silenciar una excepción se rechaza."""
    g = next(x for x in GUARDIANES_CRITICOS if x.nombre == "no_hay_silencios_en_ruta_critica")
    with pytest.raises(GuardianViolado):
        g.vigilar({"silencia_excepcion": True})
    g.vigilar({"silencia_excepcion": False})


# ===========================================================================
# Criterio 2 — 0 try/except pass en la ruta crítica (A-04)
# ===========================================================================

def test_criterio2_el_outbox_guarda_ticket_y_evento_en_la_misma_transaccion():
    """El ticket y su evento se persisten juntos, o no se persiste ninguno."""
    ticket_id = uuid4()
    outbox = OutboxTransaccional()
    with outbox:
        outbox.guardar_ticket({"id": ticket_id, "status": "PAID"})
        outbox.emitir_evento(
            EventoOutbox.nuevo(ticket_id, "consumo", [{"item_id": "it-1", "qty": 2}])
        )
    assert ticket_id in outbox.tickets
    assert len(outbox.eventos) == 1


def test_criterio2_el_outbox_propaga_la_excepcion_nunca_la_silencia():
    """Si algo falla dentro de la transacción, NADA se persiste y la excepción
    se propaga (no hay `except ... pass`)."""
    ticket_id = uuid4()
    outbox = OutboxTransaccional()
    with pytest.raises(RuntimeError):
        with outbox:
            outbox.guardar_ticket({"id": ticket_id, "status": "PAID"})
            outbox.emitir_evento(
                EventoOutbox.nuevo(ticket_id, "consumo", [{"item_id": "it-1"}])
            )
            raise RuntimeError("falla simulada en la ruta crítica")
    # Rollback total: ni el ticket ni el evento sobrevivieron.
    assert ticket_id not in outbox.tickets
    assert len(outbox.eventos) == 0


def test_criterio2_la_idempotencia_por_evento_id_evita_el_doble_descuento():
    """RN-66: aplicar el mismo evento dos veces es un no-op la segunda vez."""
    ticket_id = uuid4()
    outbox = OutboxTransaccional()
    evento = EventoOutbox.nuevo(ticket_id, "consumo", [{"item_id": "it-1", "qty": 2}])
    assert outbox.aplicar_evento(evento) is True
    assert outbox.aplicar_evento(evento) is False  # idempotente
    assert outbox.evento_aplicado(evento.evento_id, "it-1") is True


def test_criterio2_no_se_puede_operar_fuera_de_una_transaccion():
    """La ruta crítica exige transacción: operar fuera es un error explícito."""
    outbox = OutboxTransaccional()
    with pytest.raises(RuntimeError):
        outbox.guardar_ticket({"id": uuid4()})
    with pytest.raises(RuntimeError):
        outbox.emitir_evento(EventoOutbox.nuevo(uuid4(), "consumo", []))


# ===========================================================================
# Criterio 3 — ninguna regla de negocio usa el folio como identidad (A-05)
# ===========================================================================

def test_criterio3_la_identidad_es_un_uuid():
    """RN-09: la identidad es un UUID, no un folio ni un entero."""
    assert identidad_es_uuid(uuid4()) is True
    assert identidad_es_uuid("V0001") is False
    assert identidad_es_uuid(42) is False


def test_criterio3_usar_el_folio_como_identidad_es_una_violacion():
    """A-05: `folio_no_es_identidad` lanza `ReglaViolada` si se usa el folio."""
    with pytest.raises(ReglaViolada) as excinfo:
        folio_no_es_identidad("folio")
    assert excinfo.value.regla == "RN-09"
    folio_no_es_identidad("id")  # no lanza


def test_criterio3_la_identidad_y_el_folio_se_separan_explicitamente():
    """La identidad (UUID) y la presentación (folio) son objetos distintos."""
    identidad = uuid4()
    separada = separar_identidad_de_folio({"id": identidad, "folio": "V0007"})
    assert isinstance(separada, IdentidadDeTicket)
    assert separada.id == identidad
    assert separada.folio == "V0007"
    assert isinstance(separada.id, UUID)


def test_criterio3_un_ticket_sin_identidad_uuid_es_rechazado():
    """Un ticket cuyo `id` no es UUID no puede tener identidad."""
    with pytest.raises(ReglaViolada):
        separar_identidad_de_folio({"id": "V0007", "folio": "V0007"})


def test_criterio3_un_folio_mal_formado_es_rechazado():
    """RN-10: el folio debe cumplir `V####`."""
    with pytest.raises(ReglaViolada):
        IdentidadDeTicket(id=uuid4(), folio="0007")
    with pytest.raises(ReglaViolada):
        IdentidadDeTicket(id=uuid4(), folio="V7")
