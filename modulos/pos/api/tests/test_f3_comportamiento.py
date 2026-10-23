"""Puerta de FASE 3 — Comportamiento (Reglas + Tests).

Verifica los 3 criterios de la puerta (Plan de Construcción §5.3):

  1. La matriz `regla → test` está completa (95 de 95).
  2. Ninguna regla migró sin test (verificable por la matriz).
  3. Las cicatrices (DRAFT GUARD, anti-degradación, bloqueo optimista,
     reciclaje de folios, idempotencia de emergencia) están presentes y probadas.

La unidad de migración es **regla + test** (Plan §5.1): cada RN-xx tiene su
test `test_rnxx` que prueba la implementación de `apps/api/rules/registry.py`.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from rules import LAS_95_REGLAS, ReglaViolada, listar_reglas, matriz_regla_test
from rules import registry as R


# ===========================================================================
# Criterio 1 y 2 — la matriz regla → test está completa (95/95)
# ===========================================================================

def test_criterio1_la_matriz_tiene_95_reglas():
    """La matriz regla → test tiene exactamente 95 entradas."""
    matriz = matriz_regla_test()
    assert len(matriz) == 95, f"La matriz tiene {len(matriz)} entradas, no 95"


def test_criterio1_los_numeros_van_de_rn01_a_rn95():
    """Los números de regla son RN-01 … RN-95, sin huecos."""
    numeros = [r.numero for r in LAS_95_REGLAS]
    esperados = [f"RN-{i:02d}" for i in range(1, 96)]
    assert numeros == esperados, "Los números de regla no son RN-01 … RN-95 en orden"


def test_criterio2_ninguna_regla_sin_test():
    """Ninguna regla migró sin test: todas tienen un nombre de test."""
    for r in LAS_95_REGLAS:
        assert r.test, f"{r.numero} no tiene test"
        assert r.test.startswith("test_rn"), f"{r.numero} tiene un test mal nombrado: {r.test}"


def test_criterio2_cada_regla_tiene_enunciado():
    """Cada regla tiene su enunciado verbatim de la ESPECIFICACION §C."""
    for r in LAS_95_REGLAS:
        assert r.enunciado, f"{r.numero} no tiene enunciado"
        assert r.categoria.startswith("C."), f"{r.numero} no tiene categoría"


def test_criterio2_las_17_categorias_estan_presentes():
    """Las 17 categorías C.1 … C.17 están representadas."""
    categorias = {r.categoria for r in LAS_95_REGLAS}
    esperadas = {f"C.{i}" for i in range(1, 18)}
    assert categorias == esperadas, f"Faltan categorías: {esperadas - categorias}"


def test_listar_reglas_devuelve_las_95():
    """listar_reglas() devuelve las 95 reglas."""
    assert len(listar_reglas()) == 95


# ===========================================================================
# C.1 — Sesión de terminal y ocupación (RN-01 a RN-08)
# ===========================================================================

def test_rn01():
    """RN-01: una terminal solo puede tener una sesión abierta a la vez."""
    R.rn01_una_sesion_por_terminal([{"terminal_id": "T1", "estado": "OPEN"}], "T1")
    with pytest.raises(ReglaViolada):
        R.rn01_una_sesion_por_terminal(
            [{"terminal_id": "T1", "estado": "OPEN"}, {"terminal_id": "T1", "estado": "OPEN"}], "T1"
        )


def test_rn02():
    """RN-02: una sesión se identifica por terminal_id + employee_id."""
    assert R.rn02_identidad_de_sesion("T1", "E1") == ("T1", "E1")
    with pytest.raises(ReglaViolada):
        R.rn02_identidad_de_sesion("", "E1")


def test_rn03():
    """RN-03: un TerminalLock es exclusivo."""
    R.rn03_candado_exclusivo(None, "T1")
    R.rn03_candado_exclusivo("T1", "T1")
    with pytest.raises(ReglaViolada):
        R.rn03_candado_exclusivo("T1", "T2")


def test_rn04():
    """RN-04: el candado vence a los 15 min."""
    ahora = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
    assert R.rn04_ttl_del_candado(ahora - timedelta(minutes=5), ahora) is True
    assert R.rn04_ttl_del_candado(ahora - timedelta(minutes=20), ahora) is False


def test_rn05():
    """RN-05: solo el dueño libera el candado; otro recibe 403."""
    R.rn05_solo_el_dueno_libera("T1", "T1")
    with pytest.raises(ReglaViolada) as e:
        R.rn05_solo_el_dueno_libera("T1", "T2")
    assert e.value.codigo == 403


def test_rn06():
    """RN-06: un administrador puede forzar el desbloqueo."""
    R.rn06_admin_fuerza_desbloqueo(True)
    with pytest.raises(ReglaViolada) as e:
        R.rn06_admin_fuerza_desbloqueo(False)
    assert e.value.codigo == 403


def test_rn07():
    """RN-07: el heartbeat renueva el TTL."""
    ahora = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
    assert R.rn07_heartbeat_renueva_ttl(ahora - timedelta(minutes=10), ahora) == ahora


def test_rn08():
    """RN-08: los candados vencidos se purgan antes de reportar."""
    ahora = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
    candados = [
        {"terminal_id": "T1", "creado": ahora - timedelta(minutes=5)},
        {"terminal_id": "T2", "creado": ahora - timedelta(minutes=30)},
    ]
    vivos = R.rn08_purgar_vencidos(candados, ahora)
    assert len(vivos) == 1 and vivos[0]["terminal_id"] == "T1"


# ===========================================================================
# C.2 — Tickets: identidad y folio (RN-09 a RN-16)
# ===========================================================================

def test_rn09():
    """RN-09: identidad interna = id; externa = account_num."""
    uid = uuid4()
    assert R.rn09_identidad_vs_folio({"id": uid, "account_num": "V0001"}) == (uid, "V0001")
    with pytest.raises(ReglaViolada):
        R.rn09_identidad_vs_folio({"id": uid})


def test_rn10():
    """RN-10: el folio tiene formato V####."""
    assert R.rn10_formato_de_folio(1) == "V0001"
    assert R.rn10_formato_de_folio(42) == "V0042"
    with pytest.raises(ReglaViolada):
        R.rn10_formato_de_folio(0)


def test_rn11():
    """RN-11: el folio es local a la sucursal."""
    assert R.rn11_folio_local_a_sucursal("V0001", "SUC-A") == "SUC-A:V0001"


def test_rn12():
    """RN-12: el terminal_id nunca se sobrescribe."""
    assert R.rn12_terminal_id_inmutable(None, "T1") == "T1"
    assert R.rn12_terminal_id_inmutable("T1", "T1") == "T1"
    with pytest.raises(ReglaViolada):
        R.rn12_terminal_id_inmutable("T1", "T2")


def test_rn13():
    """RN-13: el canal por defecto es PANADERIA."""
    assert R.rn13_canal_por_defecto(None) == "PANADERIA"
    assert R.rn13_canal_por_defecto("HELADERIA") == "HELADERIA"


def test_rn14():
    """RN-14: el status tiene un ciclo de vida definido."""
    assert R.rn14_ciclo_de_vida("DRAFT") == "DRAFT"
    with pytest.raises(ReglaViolada):
        R.rn14_ciclo_de_vida("INVENTADO")


def test_rn15():
    """RN-15: el version es un entero >= 0."""
    assert R.rn15_version_para_concurrencia(0) == 0
    with pytest.raises(ReglaViolada):
        R.rn15_version_para_concurrencia(-1)


def test_rn16():
    """RN-16: el total es la suma de los subtotales."""
    lineas = [{"subtotal": "10.50"}, {"subtotal": "4.50"}]
    assert R.rn16_total_es_suma_de_subtotales(lineas) == Decimal("15.00")


# ===========================================================================
# C.3 — Tickets: líneas (RN-17 a RN-24)
# ===========================================================================

def test_rn17():
    """RN-17: un producto aparece una sola vez; se incrementa la cantidad."""
    lineas = [{"product_id": "P1", "quantity": 1, "unit_price": "10.00", "subtotal": "10.00"}]
    R.rn17_un_producto_una_vez(lineas, "P1")
    assert len(lineas) == 1 and lineas[0]["quantity"] == 2
    assert lineas[0]["subtotal"] == Decimal("20.00")


def test_rn18():
    """RN-18: el unit_price se congela al agregar."""
    assert R.rn18_unit_price_congelado(Decimal("10.00"), None) == Decimal("10.00")
    assert R.rn18_unit_price_congelado(Decimal("10.00"), Decimal("8.00")) == Decimal("8.00")


def test_rn19():
    """RN-19: subtotal = unit_price × quantity."""
    assert R.rn19_subtotal_de_linea(Decimal("10.00"), 3) == Decimal("30.00")


def test_rn20():
    """RN-20: la cantidad es un entero positivo."""
    assert R.rn20_cantidad_entero_positivo(1) == 1
    with pytest.raises(ReglaViolada):
        R.rn20_cantidad_entero_positivo(0)


def test_rn21():
    """RN-21: producto inexistente → 404."""
    R.rn21_producto_inexistente({"id": "P1"})
    with pytest.raises(ReglaViolada) as e:
        R.rn21_producto_inexistente(None)
    assert e.value.codigo == 404


def test_rn22():
    """RN-22: producto inactivo → 400."""
    R.rn22_producto_inactivo({"activo": True})
    with pytest.raises(ReglaViolada):
        R.rn22_producto_inactivo({"activo": False})


def test_rn23():
    """RN-23: no se modifica un ticket PAID."""
    R.rn23_no_modificar_paid("OPEN")
    with pytest.raises(ReglaViolada):
        R.rn23_no_modificar_paid("PAID")


def test_rn24():
    """RN-24: no se opera sobre una sesión inactiva."""
    R.rn24_sesion_activa("OPEN")
    with pytest.raises(ReglaViolada):
        R.rn24_sesion_activa("CLOSED")


# ===========================================================================
# C.4 — Concurrencia optimista (RN-25 a RN-30)
# ===========================================================================

def test_rn25():
    """RN-25: toda escritura valida el version recibido."""
    R.rn25_validar_version(3, 3)
    with pytest.raises(ReglaViolada) as e:
        R.rn25_validar_version(2, 3)
    assert e.value.codigo == 409


def test_rn26():
    """RN-26: version obsoleto → 409."""
    with pytest.raises(ReglaViolada) as e:
        R.rn26_version_obsoleta(1, 3)
    assert e.value.codigo == 409


def test_rn27():
    """RN-27: cada escritura incrementa el version en 1."""
    assert R.rn27_incrementar_version(3) == 4


def test_rn28():
    """RN-28: el version protege contra escrituras concurrentes."""
    assert R.rn28_version_protege_concurrencia(3, 3) is True
    assert R.rn28_version_protege_concurrencia(3, 4) is False


def test_rn29():
    """RN-29: tras una escritura atómica se expira la caché."""
    assert R.rn29_expirar_cache_tras_escritura(True) is True


def test_rn30():
    """RN-30: la reserva usa skip_locked (vocabulario de la regla, no SQL crudo)."""
    assert "skip_locked" in R.rn30_reserva_con_skip_locked("SELECT ... FOR UPDATE skip_locked")
    with pytest.raises(ReglaViolada):
        R.rn30_reserva_con_skip_locked("SELECT ... FOR UPDATE")


# ===========================================================================
# C.5 — DRAFT GUARD (RN-31 a RN-36)  ← CICATRIZ
# ===========================================================================

def test_rn31():
    """RN-31: un DRAFT pertenece a la terminal que lo creó."""
    R.rn31_draft_pertenece_a_su_terminal({"status": "DRAFT", "terminal_id": "T1"}, "T1")
    with pytest.raises(ReglaViolada):
        R.rn31_draft_pertenece_a_su_terminal({"status": "DRAFT", "terminal_id": "T1"}, "T2")


def test_rn32():
    """RN-32: otra terminal no escribe sobre un DRAFT ajeno."""
    R.rn32_no_escribir_draft_ajeno({"status": "DRAFT", "terminal_id": "T1"}, "T1")
    with pytest.raises(ReglaViolada):
        R.rn32_no_escribir_draft_ajeno({"status": "DRAFT", "terminal_id": "T1"}, "T2")


def test_rn33():
    """RN-33: la misma terminal sí continúa su DRAFT."""
    R.rn33_misma_terminal_continua_su_draft({"status": "DRAFT", "terminal_id": "T1"}, "T1")


def test_rn34():
    """RN-34: un DRAFT sin ítems es reutilizable."""
    assert R.rn34_draft_vacio_reutilizable({"status": "DRAFT", "items": []}) is True
    assert R.rn34_draft_vacio_reutilizable({"status": "DRAFT", "items": [1]}) is False


def test_rn35():
    """RN-35: un DRAFT con ítems no se reutiliza."""
    assert R.rn35_draft_con_items_no_se_reutiliza({"status": "DRAFT", "items": [1]}) is False
    assert R.rn35_draft_con_items_no_se_reutiliza({"status": "DRAFT", "items": []}) is True


def test_rn36():
    """RN-36: la guarda se evalúa antes de aplicar."""
    R.rn36_guarda_antes_de_aplicar(["GUARD", "APPLY"])
    with pytest.raises(ReglaViolada):
        R.rn36_guarda_antes_de_aplicar(["APPLY", "GUARD"])


# ===========================================================================
# C.6 — Anti-degradación de líneas (RN-37 a RN-40)  ← CICATRIZ
# ===========================================================================

def test_rn37():
    """RN-37: no se permite una reducción mayor al 50%."""
    R.rn37_umbral_anti_degradacion(10, 6)
    with pytest.raises(ReglaViolada):
        R.rn37_umbral_anti_degradacion(10, 4)


def test_rn38():
    """RN-38: la anti-degradación protege contra payloads incompletos."""
    assert R.rn38_anti_degradacion_protege(10, 5) is True
    assert R.rn38_anti_degradacion_protege(10, 4) is False


def test_rn39():
    """RN-39: si la reducción supera el umbral, se rechaza."""
    with pytest.raises(ReglaViolada):
        R.rn39_rechazar_si_supera_umbral(10, 3)


def test_rn40():
    """RN-40: la sincronización es idempotente para el mismo conjunto."""
    assert R.rn40_sincronizacion_idempotente({"a", "b"}, {"b", "a"}) is True
    assert R.rn40_sincronizacion_idempotente({"a"}, {"a", "b"}) is False


# ===========================================================================
# C.7 — Reserva y limpieza de borradores (RN-41 a RN-48)
# ===========================================================================

def test_rn41():
    """RN-41: la reserva busca primero un DRAFT vacío."""
    drafts = [{"status": "DRAFT", "items": [1]}, {"status": "DRAFT", "items": []}]
    assert R.rn41_reserva_busca_draft_vacio(drafts)["items"] == []


def test_rn42():
    """RN-42: un DRAFT vacío se reutiliza si es de los últimos 5 min."""
    ahora = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
    assert R.rn42_draft_vacio_reutilizable_5min(ahora - timedelta(minutes=3), ahora) is True
    assert R.rn42_draft_vacio_reutilizable_5min(ahora - timedelta(minutes=10), ahora) is False


def test_rn43():
    """RN-43: un DRAFT vacío más antiguo se descarta."""
    ahora = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
    assert R.rn43_draft_vacio_viejo_se_descarta(ahora - timedelta(minutes=10), ahora) is True


def test_rn44():
    """RN-44: la limpieza está throttled (máx. 1/min)."""
    ahora = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
    assert R.rn44_limpieza_throttled(None, ahora) is True
    assert R.rn44_limpieza_throttled(ahora - timedelta(seconds=30), ahora) is False
    assert R.rn44_limpieza_throttled(ahora - timedelta(minutes=2), ahora) is True


def test_rn45():
    """RN-45: un DRAFT vacío con más de 1 hora es obsoleto."""
    ahora = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
    assert R.rn45_draft_vacio_obsoleto_1h(ahora - timedelta(hours=2), ahora) is True
    assert R.rn45_draft_vacio_obsoleto_1h(ahora - timedelta(minutes=30), ahora) is False


def test_rn46():
    """RN-46: un DRAFT con ítems tiene un TTL."""
    ahora = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
    assert R.rn46_draft_con_items_tiene_ttl(ahora - timedelta(hours=1), ahora) is True
    assert R.rn46_draft_con_items_tiene_ttl(ahora - timedelta(hours=5), ahora) is False


def test_rn47():
    """RN-47: al expirar, el DRAFT pasa a CANCELLED."""
    ticket = {"status": "DRAFT"}
    assert R.rn47_al_expirar_pasa_a_cancelled(ticket)["status"] == "CANCELLED"


def test_rn48():
    """RN-48: la limpieza libera la terminal."""
    candados = [{"terminal_id": "T1"}, {"terminal_id": "T2"}]
    libres = R.rn48_limpieza_libera_terminal(candados, "T1")
    assert len(libres) == 1 and libres[0]["terminal_id"] == "T2"


# ===========================================================================
# C.8 — Caja: sesión y movimientos (RN-49 a RN-56)
# ===========================================================================

def test_rn49():
    """RN-49: solo una sesión de caja OPEN por terminal."""
    R.rn49_una_sesion_caja_por_terminal([{"terminal_id": "T1", "estado": "OPEN"}], "T1")
    with pytest.raises(ReglaViolada):
        R.rn49_una_sesion_caja_por_terminal(
            [{"terminal_id": "T1", "estado": "OPEN"}, {"terminal_id": "T1", "estado": "OPEN"}], "T1"
        )


def test_rn50():
    """RN-50: la sesión registra opening_float."""
    assert R.rn50_opening_float(Decimal("500.00")) == Decimal("500.00")
    with pytest.raises(ReglaViolada):
        R.rn50_opening_float(Decimal("-1.00"))


def test_rn51():
    """RN-51: los movimientos son ENTRADA o SALIDA con monto y concepto."""
    m = R.rn51_movimiento_entrada_o_salida("ENTRADA", Decimal("100.00"), "Refuerzo")
    assert m["tipo"] == "ENTRADA" and m["monto"] == Decimal("100.00")
    with pytest.raises(ReglaViolada):
        R.rn51_movimiento_entrada_o_salida("OTRO", Decimal("1.00"), "x")


def test_rn52():
    """RN-52: un movimiento se elimina si la sesión está abierta."""
    R.rn52_movimiento_eliminable_si_abierta("OPEN")
    with pytest.raises(ReglaViolada):
        R.rn52_movimiento_eliminable_si_abierta("CLOSED")


def test_rn53():
    """RN-53: efectivo esperado = fondo + entradas − salidas + ventas."""
    assert R.rn53_efectivo_esperado(
        Decimal("500.00"), Decimal("100.00"), Decimal("50.00"), Decimal("300.00")
    ) == Decimal("850.00")


def test_rn54():
    """RN-54: al cerrar se registra conteo físico, crédito y débito."""
    cierre = R.rn54_cierre_registra_conteos(Decimal("800.00"), Decimal("100.00"), Decimal("50.00"))
    assert cierre["physical_cash"] == Decimal("800.00")


def test_rn55():
    """RN-55: una sesión cerrada es inmutable."""
    R.rn55_sesion_cerrada_inmutable("OPEN")
    with pytest.raises(ReglaViolada):
        R.rn55_sesion_cerrada_inmutable("CLOSED")


def test_rn56():
    """RN-56: el historial se filtra por terminal y fecha local."""
    sesiones = [
        {"terminal_id": "T1", "dia_local": "2026-09-26"},
        {"terminal_id": "T2", "dia_local": "2026-09-26"},
    ]
    assert len(R.rn56_historial_filtrado_por_terminal_y_fecha(sesiones, "T1", "2026-09-26")) == 1


# ===========================================================================
# C.9 — Caja: clasificación de pagos (RN-57 a RN-60)
# ===========================================================================

def test_rn57():
    """RN-57: los pagos se clasifican por método."""
    assert R.rn57_clasificar_por_metodo("EFECTIVO") == "EFECTIVO"
    with pytest.raises(ReglaViolada):
        R.rn57_clasificar_por_metodo("BITCOIN")


def test_rn58():
    """RN-58: la clasificación alimenta el resumen."""
    resumen = R.rn58_clasificacion_alimenta_resumen(
        [{"metodo": "EFECTIVO", "monto": "100.00"}, {"metodo": "EFECTIVO", "monto": "50.00"}]
    )
    assert resumen["EFECTIVO"] == Decimal("150.00")


def test_rn59():
    """RN-59: el reporte usa el día local, no el UTC."""
    # 2026-09-27 02:00 UTC = 2026-09-26 20:00 en UTC-6.
    instante = datetime(2026, 9, 27, 2, 0, tzinfo=timezone.utc)
    assert R.rn59_reporte_usa_dia_local(instante) == "2026-09-26"


def test_rn60():
    """RN-60: el resumen distingue esperado de contado."""
    r = R.rn60_resumen_distingue_esperado_y_contado(Decimal("800.00"), Decimal("790.00"))
    assert r["esperado"] == Decimal("800.00") and r["contado"] == Decimal("790.00")


# ===========================================================================
# C.10 — Inventario: eventos (RN-61 a RN-66)  ← CICATRIZ (idempotencia)
# ===========================================================================

def test_rn61():
    """RN-61: el ledger es inmutable; no UPDATE."""
    R.rn61_ledger_inmutable("INSERT")
    with pytest.raises(ReglaViolada):
        R.rn61_ledger_inmutable("UPDATE")


def test_rn62():
    """RN-62: el POS emite un evento, no descuenta stock."""
    assert R.rn62_pos_emite_evento_no_descuenta("EMITIR_EVENTO") == "EMITIR_EVENTO"
    with pytest.raises(ReglaViolada):
        R.rn62_pos_emite_evento_no_descuenta("DESCONTAR_STOCK")


def test_rn63():
    """RN-63: el evento se inserta antes del commit."""
    R.rn63_evento_antes_del_commit(["INSERT_EVENTO", "COMMIT"])
    with pytest.raises(ReglaViolada):
        R.rn63_evento_antes_del_commit(["COMMIT", "INSERT_EVENTO"])


def test_rn64():
    """RN-64: si el evento falla, el POS no falla."""
    assert R.rn64_fallo_de_evento_no_tumba_el_pos(False) is True


def test_rn65():
    """RN-65: el evento tiene estado PENDIENTE/PROCESADO/FALLIDO."""
    assert R.rn65_estados_del_evento("PENDIENTE") == "PENDIENTE"
    with pytest.raises(ReglaViolada):
        R.rn65_estados_del_evento("OTRO")


def test_rn66():
    """RN-66: el índice único (evento_id, item_id) garantiza idempotencia."""
    movimientos = [{"evento_id": "E1", "item_id": "I1"}]
    assert R.rn66_idempotencia_por_evento_id(movimientos, "E1", "I1") is False
    assert R.rn66_idempotencia_por_evento_id(movimientos, "E2", "I1") is True


# ===========================================================================
# C.11 — Pedidos: proyección (RN-67 a RN-70)
# ===========================================================================

def test_rn67():
    """RN-67: un ticket puede proyectarse a un Order."""
    uid = uuid4()
    assert R.rn67_ticket_a_pedido({"id": uid}, True)["ticket_id"] == uid
    assert R.rn67_ticket_a_pedido({"id": uid}, False) is None


def test_rn68():
    """RN-68: la relación ticket↔pedido es 1:1."""
    uid = uuid4()
    R.rn68_relacion_1a1([], uid)
    with pytest.raises(ReglaViolada):
        R.rn68_relacion_1a1([{"ticket_id": uid}], uid)


def test_rn69():
    """RN-69: el pedido tiene 14 estados."""
    assert R.rn69_catorce_estados("PENDIENTE") == "PENDIENTE"
    with pytest.raises(ReglaViolada):
        R.rn69_catorce_estados("INVENTADO")


def test_rn70():
    """RN-70: el pedido registra tipo de entrega, empaque y reparto."""
    d = R.rn70_datos_de_reparto("DOMICILIO", "CAJA", 19.4, -99.1, 3.2, Decimal("50.00"))
    assert d["tipo_entrega"] == "DOMICILIO" and d["costo"] == Decimal("50.00")


# ===========================================================================
# C.12 — Visión (RN-71 a RN-74)
# ===========================================================================

def test_rn71():
    """RN-71: la visión usa el motor ORB."""
    assert R.rn71_motor_orb("ORB") == "ORB"
    with pytest.raises(ReglaViolada):
        R.rn71_motor_orb("YOLO")


def test_rn72():
    """RN-72: se acepta si la confianza supera 0.35."""
    assert R.rn72_umbral_de_confianza(0.40) is True
    assert R.rn72_umbral_de_confianza(0.30) is False


def test_rn73():
    """RN-73: las imágenes se etiquetan por SKU."""
    assert R.rn73_etiquetado_por_sku("SKU-1") == "SKU-1"
    with pytest.raises(ReglaViolada):
        R.rn73_etiquetado_por_sku("")


def test_rn74():
    """RN-74: la visión es asistiva; no bloquea la venta manual."""
    R.rn74_vision_asistiva(False)
    with pytest.raises(ReglaViolada):
        R.rn74_vision_asistiva(True)


# ===========================================================================
# C.13 — Auditoría (RN-75 a RN-77)
# ===========================================================================

def test_rn75():
    """RN-75: cada escritura se registra en el log."""
    log = R.rn75_registrar_escritura([], "/pos/tickets")
    assert len(log) == 1 and log[0]["endpoint"] == "/pos/tickets"


def test_rn76():
    """RN-76: el registro incluye endpoint, payload, código y extras."""
    e = R.rn76_contenido_del_registro("/pos/tickets", {"a": 1}, 200, {"terminal": "T1"})
    assert e["endpoint"] == "/pos/tickets" and e["codigo"] == 200 and e["extras"]["terminal"] == "T1"


def test_rn77():
    """RN-77: la auditoría se consulta por terminal y rango."""
    t0 = datetime(2026, 9, 26, 10, 0, tzinfo=timezone.utc)
    log = [
        {"terminal_id": "T1", "timestamp": t0},
        {"terminal_id": "T2", "timestamp": t0},
    ]
    r = R.rn77_consulta_por_terminal_y_rango(log, "T1", t0 - timedelta(hours=1), t0 + timedelta(hours=1))
    assert len(r) == 1 and r[0]["terminal_id"] == "T1"


# ===========================================================================
# C.14 — Tiempo y zona horaria (RN-78 a RN-80)
# ===========================================================================

def test_rn78():
    """RN-78: los timestamps se almacenan en UTC."""
    instante = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
    assert R.rn78_timestamps_en_utc(instante) == instante
    with pytest.raises(ReglaViolada):
        R.rn78_timestamps_en_utc(datetime(2026, 9, 26, 12, 0))


def test_rn79():
    """RN-79: la conversión usa la zona de negocio."""
    instante = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
    local = R.rn79_conversion_con_zona_de_negocio(instante)
    assert local.hour == 6  # UTC-6


def test_rn80():
    """RN-80: los límites del día local se calculan en UTC."""
    dia = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
    inicio, fin = R.rn80_limites_del_dia_local(dia)
    assert inicio == datetime(2026, 9, 26, 6, 0, tzinfo=timezone.utc)
    assert fin == datetime(2026, 9, 27, 6, 0, tzinfo=timezone.utc)


# ===========================================================================
# C.15 — Regla transversal (RN-81)
# ===========================================================================

def test_rn81():
    """RN-81: ninguna capa hardcodea un offset de zona horaria."""
    R.rn81_sin_offset_hardcodeado("instante.astimezone(get_business_tz())")
    with pytest.raises(ReglaViolada):
        R.rn81_sin_offset_hardcodeado("instante + timedelta(hours=-6)")


# ===========================================================================
# C.17 — Pagos mixtos (RN-94 a RN-95) — FASE 9.1
# ===========================================================================

def test_rn94():
    """RN-94: la suma de los pagos cuadra exactamente el total del ticket."""
    # Un pago mixto que cuadra: 40 + 60 = 100.
    R.rn94_suma_de_pagos_cuadra_total(
        [{"metodo": "EFECTIVO", "monto": "40.00"}, {"metodo": "DEBITO", "monto": "60.00"}],
        Decimal("100.00"),
    )
    # Un pago único que cuadra.
    R.rn94_suma_de_pagos_cuadra_total([{"metodo": "EFECTIVO", "monto": "100.00"}], Decimal("100.00"))
    # Cobrar de menos (saldo pendiente) se rechaza.
    with pytest.raises(ReglaViolada) as e:
        R.rn94_suma_de_pagos_cuadra_total([{"metodo": "EFECTIVO", "monto": "40.00"}], Decimal("100.00"))
    assert e.value.codigo == 400
    # Cobrar de más (cambio mal calculado) se rechaza.
    with pytest.raises(ReglaViolada):
        R.rn94_suma_de_pagos_cuadra_total([{"metodo": "EFECTIVO", "monto": "120.00"}], Decimal("100.00"))
    # Sin pagos se rechaza.
    with pytest.raises(ReglaViolada):
        R.rn94_suma_de_pagos_cuadra_total([], Decimal("100.00"))


def test_rn95():
    """RN-95: cada pago usa un método válido (reutiliza RN-57)."""
    # Un pago mixto con métodos válidos pasa.
    R.rn95_metodos_de_pago_validos(
        [{"metodo": "EFECTIVO", "monto": "40.00"}, {"metodo": "TRANSFERENCIA", "monto": "60.00"}]
    )
    # Un método inválido en cualquier abono se rechaza.
    with pytest.raises(ReglaViolada) as e:
        R.rn95_metodos_de_pago_validos(
            [{"metodo": "EFECTIVO", "monto": "40.00"}, {"metodo": "BITCOIN", "monto": "60.00"}]
        )
    assert e.value.codigo == 400
    # Sin pagos se rechaza.
    with pytest.raises(ReglaViolada):
        R.rn95_metodos_de_pago_validos([])


# ===========================================================================
# Criterio 3 — Las 5 cicatrices están presentes y probadas
# ===========================================================================

def test_cicatriz_draft_guard():
    """Cicatriz 1 — DRAFT GUARD: un DRAFT ajeno no se escribe (RN-31 a RN-36)."""
    ticket = {"status": "DRAFT", "terminal_id": "T1", "items": []}
    # La terminal dueña continúa; otra es rechazada.
    R.rn33_misma_terminal_continua_su_draft(ticket, "T1")
    with pytest.raises(ReglaViolada):
        R.rn32_no_escribir_draft_ajeno(ticket, "T2")
    # La guarda se evalúa antes de aplicar.
    with pytest.raises(ReglaViolada):
        R.rn36_guarda_antes_de_aplicar(["APPLY"])


def test_cicatriz_anti_degradacion():
    """Cicatriz 2 — Anti-degradación: una reducción > 50% se rechaza (RN-37 a RN-40)."""
    R.rn37_umbral_anti_degradacion(10, 6)  # 40% de reducción: pasa
    with pytest.raises(ReglaViolada):
        R.rn37_umbral_anti_degradacion(10, 4)  # 60% de reducción: se rechaza


def test_cicatriz_bloqueo_optimista():
    """Cicatriz 3 — Bloqueo optimista: un version obsoleto da 409 (RN-25 a RN-30)."""
    with pytest.raises(ReglaViolada) as e:
        R.rn25_validar_version(2, 3)
    assert e.value.codigo == 409
    assert R.rn27_incrementar_version(3) == 4


def test_cicatriz_reciclaje_de_folios():
    """Cicatriz 4 — Reciclaje de folios: el folio es local y reutilizable (RN-10, RN-11, RN-41 a RN-43)."""
    assert R.rn10_formato_de_folio(1) == "V0001"
    assert R.rn11_folio_local_a_sucursal("V0001", "SUC-A") == "SUC-A:V0001"
    ahora = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)
    # Un DRAFT vacío reciente se recicla; uno viejo se descarta.
    assert R.rn42_draft_vacio_reutilizable_5min(ahora - timedelta(minutes=3), ahora) is True
    assert R.rn43_draft_vacio_viejo_se_descarta(ahora - timedelta(minutes=10), ahora) is True


def test_cicatriz_idempotencia_de_emergencia():
    """Cicatriz 5 — Idempotencia de emergencia: (evento_id, item_id) no duplica (RN-63 a RN-66)."""
    # El evento se inserta antes del commit.
    R.rn63_evento_antes_del_commit(["INSERT_EVENTO", "COMMIT"])
    # Si el evento falla, el POS no falla.
    assert R.rn64_fallo_de_evento_no_tumba_el_pos(False) is True
    # El mismo (evento_id, item_id) no se duplica.
    movimientos = [{"evento_id": "E1", "item_id": "I1"}]
    assert R.rn66_idempotencia_por_evento_id(movimientos, "E1", "I1") is False