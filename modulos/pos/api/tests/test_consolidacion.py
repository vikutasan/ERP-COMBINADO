"""Puerta de FASE 6 — Consolidación (Central).

Fuente autoritativa:
  - `PLAN_DE_CONSTRUCCION_DEL_NUEVO_POS.md` §8 (F6: Consolidación central).
  - `MODELO_DESPLIEGUE_Y_CONSOLIDACION_CENTRAL.md` §2 (el contrato de consolidación).
  - `ESPECIFICACION_FUNCIONAL_POS_INGENIERIA_INVERSA.md` §F (RC-01 a RC-04).

La puerta de salida (Plan §8.3) exige 3 criterios:

  - [ ] La sync de cierre de día envía ventas y caja al central.
  - [ ] Si el central cae, las sucursales siguen operando (el central no es transaccional).
  - [ ] Un conflicto se registra para revisión manual; nunca se resuelve en silencio.

Este test verifica los 3 criterios sobre DATOS, no sobre intención. Además
verifica el contrato (P1-P6), el payload JSON, el outbox, la sync (23:30) y la
resolución de conflictos, y que F6 cierra los 4 riesgos RC-01 a RC-04.
"""

from __future__ import annotations

from datetime import datetime, time, timezone
from uuid import uuid4

import pytest

from consolidacion import (
    CLAVE_SETTING_HORA_CIERRE,
    CRITERIO_GLOBAL,
    CRITERIOS_CENTRAL,
    CRITERIOS_SUCURSAL,
    DOMINIOS,
    ENTIDADES_CENTRAL,
    GARANTIAS,
    HORA_CIERRE_DEFAULT,
    NIVELES_CONECTIVIDAD,
    PRINCIPIOS,
    RIESGOS_QUE_CIERRA,
    SCHEMA_VERSION,
    CentralCaido,
    CentralNoTransaccional,
    Conflicto,
    ConflictoSilencioso,
    JobConsolidacion,
    OutboxConsolidacion,
    PayloadConsolidacion,
    RegistroConflictos,
    SyncCierreDeDia,
    dominios_consolidados,
    matriz_principio_implicacion,
)


# ── Utilidades ────────────────────────────────────────────────────────────────

def _ticket(uuid=None, folio="V0042", total=245.50) -> dict:
    """Un registro de venta con la forma del payload (MODELO §2.4)."""
    return {
        "uuid": str(uuid or uuid4()),
        "folio": folio,
        "status": "PAID",
        "total": total,
        "payment_method": "EFECTIVO",
        "terminal_id": "T1",
        "captured_by_id": 7,
        "created_at_utc": "2026-09-21T18:12:03Z",
        "closed_at_utc": "2026-09-21T18:14:22Z",
        "items": [
            {"sku": "PAN-001", "quantity": 3, "unit_price": 15.00, "subtotal": 45.00}
        ],
    }


# ── CRITERIO 1 — La sync de cierre de día envía ventas y caja al central ──────

def test_criterio1_la_sync_envia_ventas_y_caja_al_central():
    """Plan §8.3: la sync de cierre de día envía ventas y caja al central."""
    outbox = OutboxConsolidacion()
    central = CentralNoTransaccional(branch_id="SUC-CENTRO-01")

    with outbox:
        outbox.encolar("ventas", uuid4(), _ticket())
        outbox.encolar("caja", uuid4(), {"uuid": str(uuid4()), "estado": "CLOSED"})

    job = JobConsolidacion(outbox, central)
    resumen = job.ejecutar(branch_id="SUC-CENTRO-01", erp_version="1.0.0")

    assert resumen["enviados"] == 2
    assert resumen["fallidos"] == 0
    assert central.total_registros == 2
    dominios_enviados = {e["domain"] for e in central.envios}
    assert dominios_enviados == {"ventas", "caja"}


def test_criterio1_el_payload_lleva_branch_id_y_schema_version():
    """MODELO §2.4: el payload lleva branch_id, schema_version y erp_version."""
    payload = PayloadConsolidacion(
        branch_id="SUC-CENTRO-01",
        erp_version="1.0.0",
        domain="ventas",
        records=(_ticket(),),
    )
    d = payload.a_dict()
    assert d["branch_id"] == "SUC-CENTRO-01"
    assert d["schema_version"] == SCHEMA_VERSION
    assert d["erp_version"] == "1.0.0"
    assert d["domain"] == "ventas"
    assert len(d["records"]) == 1
    assert d["sent_at_utc"].endswith("Z")


def test_criterio1_los_4_dominios_estan_declarados():
    """MODELO §2.3: se consolidan 4 dominios (ventas, caja, inventario, catalogo)."""
    assert dominios_consolidados() == ("ventas", "caja", "inventario", "catalogo")
    assert len(DOMINIOS) == 4


def test_criterio1_el_payload_rechaza_un_dominio_desconocido():
    """El payload solo acepta los 4 dominios del contrato."""
    with pytest.raises(ValueError):
        PayloadConsolidacion(
            branch_id="SUC-CENTRO-01",
            erp_version="1.0.0",
            domain="vision",
            records=(),
        )


def test_criterio1_el_payload_exige_branch_id():
    """MODELO §1.4: sin branch_id el envío no se puede enrutar."""
    with pytest.raises(ValueError):
        PayloadConsolidacion(
            branch_id="",
            erp_version="1.0.0",
            domain="ventas",
            records=(),
        )


# ── CRITERIO 2 — Si el central cae, las sucursales siguen operando ────────────

def test_criterio2_si_el_central_cae_la_sucursal_sigue_operando():
    """Plan §8.3 / MODELO §3.2: el central no es transaccional."""
    outbox = OutboxConsolidacion()
    central = CentralNoTransaccional(branch_id="SUC-CENTRO-01")
    central.apagar()

    with outbox:
        outbox.encolar("ventas", uuid4(), _ticket())

    job = JobConsolidacion(outbox, central)
    resumen = job.ejecutar(branch_id="SUC-CENTRO-01", erp_version="1.0.0")

    # El envío falla, pero la sucursal NO se bloquea: el registro queda pendiente.
    assert resumen["enviados"] == 0
    assert resumen["fallidos"] == 1
    assert len(outbox.pendientes()) == 1
    assert outbox.pendientes()[0].enviado is False


def test_criterio2_al_reconectarse_el_central_recibe_los_datos():
    """Criterio global (MODELO §5.3): al reconectarse, el central recibe todo."""
    outbox = OutboxConsolidacion()
    central = CentralNoTransaccional(branch_id="SUC-CENTRO-01")
    central.apagar()

    with outbox:
        outbox.encolar("ventas", uuid4(), _ticket())

    job = JobConsolidacion(outbox, central)
    job.ejecutar(branch_id="SUC-CENTRO-01", erp_version="1.0.0")
    assert central.total_registros == 0

    # El central vuelve: el próximo ciclo reintenta (P4 reanudable).
    central.encender()
    resumen = job.ejecutar(branch_id="SUC-CENTRO-01", erp_version="1.0.0")
    assert resumen["enviados"] == 1
    assert central.total_registros == 1


def test_criterio2_el_central_no_tiene_endpoints_de_venta():
    """H4: el central no es transaccional (no cobra, no vende)."""
    central = CentralNoTransaccional(branch_id="SUC-CENTRO-01")
    # El central solo expone `recibir`; no hay `cobrar`, `vender` ni `abrir_caja`.
    assert hasattr(central, "recibir")
    assert not hasattr(central, "cobrar")
    assert not hasattr(central, "vender")
    assert not hasattr(central, "abrir_caja")


def test_criterio2_el_central_caido_lanza_central_caido():
    """P2: si el central no responde, se lanza CentralCaido (la sucursal no espera)."""
    central = CentralNoTransaccional(branch_id="SUC-CENTRO-01")
    central.apagar()
    payload = PayloadConsolidacion(
        branch_id="SUC-CENTRO-01",
        erp_version="1.0.0",
        domain="ventas",
        records=(_ticket(),),
    )
    with pytest.raises(CentralCaido):
        central.recibir(payload.a_dict())


# ── CRITERIO 3 — Un conflicto se registra; nunca se resuelve en silencio ──────

def test_criterio3_un_conflicto_se_registra_para_revision_manual():
    """Plan §8.3 / MODELO §2.8: el conflicto se registra, no se resuelve solo."""
    registro = RegistroConflictos()
    conflicto = Conflicto(
        branch_id="SUC-CENTRO-01",
        uuid=uuid4(),
        dominio="ventas",
        motivo="Dos sucursales reportan el mismo folio con distinto UUID",
    )
    registro.registrar(conflicto)

    assert len(registro.conflictos) == 1
    assert len(registro.pendientes) == 1
    assert conflicto.resuelto is False


def test_criterio3_resolver_sin_justificacion_es_silencio_prohibido():
    """MODELO §2.8: nunca se resuelve en silencio."""
    registro = RegistroConflictos()
    conflicto = Conflicto(
        branch_id="SUC-CENTRO-01",
        uuid=uuid4(),
        dominio="caja",
        motivo="Diferencia de arqueo",
    )
    registro.registrar(conflicto)
    with pytest.raises(ConflictoSilencioso):
        registro.resolver_manualmente(conflicto, "")


def test_criterio3_resolver_manualmente_deja_rastro():
    """Un conflicto resuelto por un humano deja la justificación."""
    registro = RegistroConflictos()
    conflicto = Conflicto(
        branch_id="SUC-CENTRO-01",
        uuid=uuid4(),
        dominio="inventario",
        motivo="Movimiento duplicado",
    )
    registro.registrar(conflicto)
    registro.resolver_manualmente(conflicto, "Se verificó con el conteo físico")

    assert conflicto.resuelto is True
    assert conflicto.resolucion_manual == "Se verificó con el conteo físico"
    assert len(registro.pendientes) == 0


# ── El contrato: principios P1-P6 (MODELO §2.2) ───────────────────────────────

def test_contrato_hay_6_principios():
    """MODELO §2.2: el contrato tiene 6 principios (P1-P6)."""
    assert len(PRINCIPIOS) == 6
    assert [p["codigo"] for p in PRINCIPIOS] == ["P1", "P2", "P3", "P4", "P5", "P6"]


def test_contrato_p1_es_unidireccional():
    """P1: Sucursal → Central. Nunca al revés."""
    implicacion = matriz_principio_implicacion()["P1"]
    assert "Sucursal" in implicacion and "Central" in implicacion
    assert "Nunca al revés" in implicacion


def test_contrato_p3_es_idempotente_por_branch_id_uuid():
    """P3: la clave (branch_id, uuid) garantiza la idempotencia."""
    implicacion = matriz_principio_implicacion()["P3"]
    assert "(branch_id, uuid)" in implicacion


def test_contrato_p6_sin_acoplamiento_de_esquema():
    """P6: el central no lee la BD de la sucursal; recibe un payload."""
    implicacion = matriz_principio_implicacion()["P6"]
    assert "no lee la BD" in implicacion
    assert "payload" in implicacion


def test_contrato_las_5_garantias_estan_declaradas():
    """MODELO §2.6: at-least-once, idempotencia, orden, reanudación, trazabilidad."""
    nombres = {g["garantia"] for g in GARANTIAS}
    assert nombres == {
        "At-least-once",
        "Idempotencia",
        "Orden por registro",
        "Reanudación",
        "Trazabilidad",
    }


# ── El outbox de consolidación (MODELO §2.5) ──────────────────────────────────

def test_outbox_es_atomico_con_el_ticket():
    """MODELO §2.5: el ticket y su intención de envío son atómicos."""
    outbox = OutboxConsolidacion()
    with outbox:
        outbox.encolar("ventas", uuid4(), _ticket())
    assert len(outbox.registros) == 1


def test_outbox_hace_rollback_si_falla_la_transaccion():
    """Si la transacción falla, NADA se persiste (E-05, no hay silencio)."""
    outbox = OutboxConsolidacion()
    with pytest.raises(RuntimeError):
        with outbox:
            outbox.encolar("ventas", uuid4(), _ticket())
            raise RuntimeError("falla el commit del ticket")
    assert len(outbox.registros) == 0


def test_outbox_encolar_fuera_de_transaccion_falla():
    """El outbox exige una transacción (atómico con el ticket)."""
    outbox = OutboxConsolidacion()
    with pytest.raises(RuntimeError):
        outbox.encolar("ventas", uuid4(), _ticket())


def test_outbox_marca_enviado_con_timestamp_y_response_code():
    """MODELO §2.6: cada envío deja enviado_at_utc y response_code."""
    outbox = OutboxConsolidacion()
    central = CentralNoTransaccional(branch_id="SUC-CENTRO-01")
    with outbox:
        outbox.encolar("ventas", uuid4(), _ticket())
    JobConsolidacion(outbox, central).ejecutar("SUC-CENTRO-01", "1.0.0")

    registro = outbox.registros[0]
    assert registro.enviado is True
    assert registro.enviado_at_utc is not None
    assert registro.response_code == 200


# ── La sync al cierre del día (MODELO §2.3) ───────────────────────────────────

def test_sync_default_es_23_30():
    """Plan §8.2 / MODELO §2.3: default 23:30."""
    assert HORA_CIERRE_DEFAULT == time(23, 30)
    assert SyncCierreDeDia().hora == time(23, 30)


def test_sync_es_configurable_en_system_setting():
    """Plan §8.2: la hora es configurable en SystemSetting."""
    assert CLAVE_SETTING_HORA_CIERRE == "consolidacion.hora_cierre"
    sync = SyncCierreDeDia.desde_setting("22:15")
    assert sync.hora == time(22, 15)


def test_sync_dispara_al_alcanzar_la_hora():
    """La sync dispara cuando la hora local alcanza la hora de cierre."""
    sync = SyncCierreDeDia()
    antes = datetime(2026, 9, 21, 23, 0, tzinfo=timezone.utc)
    despues = datetime(2026, 9, 21, 23, 45, tzinfo=timezone.utc)
    assert sync.debe_disparar(antes) is False
    assert sync.debe_disparar(despues) is True


def test_sync_una_hora_invalida_falla():
    """Una hora mal formada no se acepta en silencio."""
    with pytest.raises(ValueError):
        SyncCierreDeDia.desde_setting("23-30")


# ── El central: idempotencia y no colisión (H1, H2) ───────────────────────────

def test_central_es_idempotente_reenviar_no_duplica():
    """H2: reenviar un batch no duplica (P3)."""
    central = CentralNoTransaccional(branch_id="SUC-CENTRO-01")
    payload = PayloadConsolidacion(
        branch_id="SUC-CENTRO-01",
        erp_version="1.0.0",
        domain="ventas",
        records=(_ticket(uuid="11111111-1111-1111-1111-111111111111"),),
    )
    primero = central.recibir(payload.a_dict())
    segundo = central.recibir(payload.a_dict())

    assert primero["recibidos"] == 1
    assert segundo["duplicados"] == 1
    assert central.total_registros == 1


def test_central_recibe_n_sucursales_sin_colision():
    """H1: dos sucursales con el mismo folio coexisten (UUID distinto)."""
    central = CentralNoTransaccional(branch_id="SUC-CENTRO-01")
    payload_a = PayloadConsolidacion(
        branch_id="SUC-CENTRO-01",
        erp_version="1.0.0",
        domain="ventas",
        records=(_ticket(uuid="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", folio="V0001"),),
    )
    payload_b = PayloadConsolidacion(
        branch_id="SUC-NORTE-02",
        erp_version="1.0.0",
        domain="ventas",
        records=(_ticket(uuid="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", folio="V0001"),),
    )
    central.recibir(payload_a.a_dict())
    central.recibir(payload_b.a_dict())

    # Mismo folio V0001, distinto UUID → no colisionan.
    assert central.total_registros == 2


def test_central_la_clave_es_branch_id_uuid_no_folio():
    """MODELO §1.3: la clave es (branch_id, uuid), nunca (branch_id, folio)."""
    central = CentralNoTransaccional(branch_id="SUC-CENTRO-01")
    uuid_comun = "cccccccc-cccc-cccc-cccc-cccccccccccc"
    payload = PayloadConsolidacion(
        branch_id="SUC-CENTRO-01",
        erp_version="1.0.0",
        domain="ventas",
        records=(_ticket(uuid=uuid_comun, folio="V0001"),),
    )
    central.recibir(payload.a_dict())
    # Mismo UUID, folio distinto → es el MISMO registro (deduplica).
    payload2 = PayloadConsolidacion(
        branch_id="SUC-CENTRO-01",
        erp_version="1.0.0",
        domain="ventas",
        records=(_ticket(uuid=uuid_comun, folio="V9999"),),
    )
    resultado = central.recibir(payload2.a_dict())
    assert resultado["duplicados"] == 1
    assert central.total_registros == 1


# ── El modelo de datos del central (MODELO §3.4) ──────────────────────────────

def test_central_tiene_7_entidades():
    """MODELO §3.4: el central tiene 7 entidades."""
    assert len(ENTIDADES_CENTRAL) == 7
    nombres = {e["entidad"] for e in ENTIDADES_CENTRAL}
    assert nombres == {
        "VentaConsolidada",
        "LineaVentaConsolidada",
        "SesionCajaConsolidada",
        "MovimientoInventarioConsolidado",
        "CatalogoConsolidado",
        "Sucursal",
        "EnvioConsolidacion",
    }


def test_central_recalcula_el_stock_desde_el_ledger():
    """MODELO §3.4: el central recibe el ledger, no el stock calculado."""
    inventario = next(e for e in ENTIDADES_CENTRAL if e["entidad"] == "MovimientoInventarioConsolidado")
    assert "ledger" in inventario["origen"].lower()


# ── Los 3 niveles de conectividad (MODELO §2.7) ───────────────────────────────

def test_hay_3_niveles_de_conectividad():
    """MODELO §2.7: la consolidación es la 4ª capa sobre 3 niveles locales."""
    assert len(NIVELES_CONECTIVIDAD) == 3
    niveles = [n["nivel"] for n in NIVELES_CONECTIVIDAD]
    assert niveles == [
        "Nivel 1 — Normal",
        "Nivel 2 — Degradado",
        "Nivel 3 — Tablets de reparto",
    ]


# ── F6 cierra RC-01 a RC-04 (Plan §9) ─────────────────────────────────────────

def test_f6_cierra_los_4_riesgos_de_concurrencia():
    """Plan §9: F6 — Consolidación cierra RC-01 a RC-04."""
    codigos = [r["codigo"] for r in RIESGOS_QUE_CIERRA]
    assert codigos == ["RC-01", "RC-02", "RC-03", "RC-04"]


def test_f6_rc04_reconoce_el_try_except_pass_como_deuda():
    """RC-04: el try/except pass no se replica en la consolidación."""
    rc04 = next(r for r in RIESGOS_QUE_CIERRA if r["codigo"] == "RC-04")
    assert "try/except pass" in rc04["mitigacion"]


# ── Los criterios de aceptación (MODELO §5) ───────────────────────────────────

def test_hay_7_criterios_de_sucursal():
    """MODELO §5.1: S1 a S7."""
    assert [c["codigo"] for c in CRITERIOS_SUCURSAL] == ["S1", "S2", "S3", "S4", "S5", "S6", "S7"]


def test_hay_6_criterios_del_central():
    """MODELO §5.2: H1 a H6."""
    assert [c["codigo"] for c in CRITERIOS_CENTRAL] == ["H1", "H2", "H3", "H4", "H5", "H6"]


def test_el_criterio_global_esta_declarado():
    """MODELO §5.3: el criterio que cierra el proyecto."""
    assert "central apagado" in CRITERIO_GLOBAL
    assert "sin pérdida ni duplicación" in CRITERIO_GLOBAL


# ── El flujo completo: el día entero con el central apagado ───────────────────

def test_flujo_completo_dia_con_central_apagado_y_reconexion():
    """Criterio global (MODELO §5.3): un día completo, central apagado, sin pérdida."""
    outbox = OutboxConsolidacion()
    central = CentralNoTransaccional(branch_id="SUC-CENTRO-01")
    central.apagar()

    # El día: 3 ventas y 1 cierre de caja, todos encolados localmente.
    with outbox:
        for _ in range(3):
            outbox.encolar("ventas", uuid4(), _ticket())
        outbox.encolar("caja", uuid4(), {"uuid": str(uuid4()), "estado": "CLOSED"})

    job = JobConsolidacion(outbox, central)
    # El central está apagado: nada llega, pero nada se pierde.
    resumen_caido = job.ejecutar("SUC-CENTRO-01", "1.0.0")
    assert resumen_caido["enviados"] == 0
    assert len(outbox.pendientes()) == 4

    # Al reconectarse, el central recibe la totalidad, sin pérdida ni duplicación.
    central.encender()
    resumen_ok = job.ejecutar("SUC-CENTRO-01", "1.0.0")
    assert resumen_ok["enviados"] == 4
    assert central.total_registros == 4
    assert len(outbox.pendientes()) == 0

    # Reenviar no duplica (idempotencia).
    resumen_reenvio = job.ejecutar("SUC-CENTRO-01", "1.0.0")
    assert resumen_reenvio["enviados"] == 0
    assert central.total_registros == 4
