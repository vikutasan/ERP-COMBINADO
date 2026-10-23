"""Puerta de FASE 5 — Superficie (Interfaces).

Verifica los 3 criterios de la puerta (Plan de Construcción §7.3):

  1. Paridad funcional con el POS actual (los 6 flujos E.1 a E.6 replicados).
  2. Ningún contenedor crítico tiene ancho fijo en píxeles (R-01).
  3. La paleta canónica se respeta en las 24 interfaces.

La evidencia es el registro de las 24 interfaces y las reglas duras del
Documento 6, no la intención. El test recorre el registro y afirma los 3
criterios sobre datos.

DEFECTO DEL PLANO (26 vs 24). El Documento 7 dice "26 interfaces" en su título,
en §0.3 y en §10, pero su contenido enumerado y trazable es de 24: §6 se titula
"Fichas — Composición (4)", §8 enumera 24 filas (01–24), hay 24 fichas, y el
README declara "7 + 6 + 5 + 4 + 2". El "26" es un error aritmético del plano.
Esta puerta verifica las 24 interfaces documentadas; NO se inventan interfaces
para forzar el 26.
"""

from __future__ import annotations

import re

import pytest

from superficie import (
    CONTENEDORES_CRITICOS,
    FLUJOS,
    INTERFACES,
    MODOS,
    PALETA_CANONICA,
    PATRON_ANCHO_FIJO,
    RADIOS_CANONICOS,
    REGLAS_DURAS,
    conteo_por_tipo,
    interfaces_con_ancho_fijo,
    interfaces_que_no_declaran_los_3_modos,
    listar_interfaces,
    matriz_interfaz_tipo,
)

# Las 24 interfaces documentadas (Documento 7 §3–§7, fichas 01–24).
# El Documento 7 dice "26" en su título/§0.3/§10, pero su contenido enumerado y
# trazable es de 24 (§6 "Composición (4)", §8 con 24 filas, 24 fichas, README
# "7+6+5+4+2"). El "26" es un error aritmético del plano (ver docstring).
LAS_24_INTERFACES = (
    # Pantallas raíz (7)
    "RetailVisionPOS",
    "TableServicePOS",
    "VisionTrainingUI",
    "GrandezaParamsUI",
    "GrandezaDailyUI",
    "GrandezaDriverUI",
    "RepartoPanGrandezaUI",
    # Modales (6)
    "CheckoutScreen",
    "GestionPersonal",
    "GestorDeCaja",
    "ProgramacionPedidoModal",
    "TerminalSelector",
    "OpenAccountsCorkboard",
    # Paneles y overlays (5)
    "SalesReceipt",
    "POSHeader",
    "POSOverlays",
    "VisionVisor",
    "VisionScanner",
    # Composición (4)
    "ProductGrid",
    "ProductCard",
    "CategoryBar",
    "CategoryEditor",
    # Impresión (2)
    "TicketTemplate",
    "CorteTicketTemplate",
)

# Los 6 flujos funcionales (Documento 5 §E).
LOS_6_FLUJOS = ("E.1", "E.2", "E.3", "E.4", "E.5", "E.6")


# ── Criterio 1: paridad funcional (los 6 flujos E.1 a E.6) ────────────────────

def test_criterio1_hay_24_interfaces():
    """El inventario trazable del Documento 7 (fichas 01–24) declara 24 interfaces.

    El Documento 7 dice "26" en su título/§0.3/§10, pero su contenido enumerado
    y trazable es de 24 (§6 "Composición (4)", §8 con 24 filas, 24 fichas,
    README "7+6+5+4+2"). El "26" es un error aritmético del plano.
    """
    assert len(INTERFACES) == 24
    assert len(listar_interfaces()) == 24


def test_criterio1_los_nombres_son_los_24_esperados():
    """Los nombres del registro coinciden con el inventario canónico (24)."""
    nombres = tuple(i.nombre for i in INTERFACES)
    assert nombres == LAS_24_INTERFACES


def test_criterio1_el_conteo_por_tipo_suma_24():
    """7 raíz + 6 modales + 5 paneles/overlays + 4 composición + 2 impresión = 24.

    El Documento 7 §0.3 agrupa "Paneles y overlays" en una sola fila de 5; el
    registro los desglosa en 4 paneles + 1 overlay (suma 5).
    """
    conteo = conteo_por_tipo()
    assert conteo.get("Pantalla raíz") == 7
    assert conteo.get("Modal") == 6
    assert conteo.get("Panel") == 4
    assert conteo.get("Overlay") == 1
    assert conteo.get("Panel", 0) + conteo.get("Overlay", 0) == 5
    assert conteo.get("Composición") == 4
    assert conteo.get("Impresión") == 2
    assert sum(conteo.values()) == 24


def test_criterio1_los_6_flujos_estan_declarados():
    """Los 6 flujos E.1 a E.6 del Documento 5 §E están en el registro."""
    ids = tuple(f["id"] for f in FLUJOS)
    assert ids == LOS_6_FLUJOS


def test_criterio1_cada_flujo_tiene_interfaces_y_reglas():
    """Cada flujo declara las interfaces que lo sirven y las reglas que lo gobiernan."""
    for flujo in FLUJOS:
        assert flujo["interfaces"], f"{flujo['id']} sin interfaces"
        assert flujo["reglas"], f"{flujo['id']} sin reglas"
        assert flujo["nombre"], f"{flujo['id']} sin nombre"


def test_criterio1_las_interfaces_de_los_flujos_existen():
    """Toda interfaz referenciada por un flujo existe en el registro."""
    nombres = set(matriz_interfaz_tipo().keys())
    for flujo in FLUJOS:
        for interfaz in flujo["interfaces"]:
            assert interfaz in nombres, (
                f"{flujo['id']} referencia la interfaz inexistente '{interfaz}'"
            )


def test_criterio1_las_reglas_de_los_flujos_son_rn_validas():
    """Toda regla referenciada por un flujo es una RN-XX del catálogo."""
    patron = re.compile(r"^RN-\d{2}$")
    for flujo in FLUJOS:
        for regla in flujo["reglas"]:
            assert patron.match(regla), f"{flujo['id']} referencia la regla inválida '{regla}'"


def test_criterio1_el_flujo_e1_es_la_venta_directa():
    """E.1 (venta directa) usa el shell raíz y el ticket."""
    e1 = next(f for f in FLUJOS if f["id"] == "E.1")
    assert "RetailVisionPOS" in e1["interfaces"]
    assert "SalesReceipt" in e1["interfaces"]
    assert "CheckoutScreen" in e1["interfaces"]


def test_criterio1_el_flujo_e5_es_el_corte_de_caja():
    """E.5 (corte de caja) usa el gestor de caja y la plantilla de corte."""
    e5 = next(f for f in FLUJOS if f["id"] == "E.5")
    assert "GestorDeCaja" in e5["interfaces"]
    assert "CorteTicketTemplate" in e5["interfaces"]


def test_criterio1_el_flujo_e6_es_la_ocupacion_de_terminal():
    """E.6 (ocupación de terminal) usa el selector de terminal."""
    e6 = next(f for f in FLUJOS if f["id"] == "E.6")
    assert "TerminalSelector" in e6["interfaces"]


# ── Criterio 2: ningún contenedor crítico con ancho fijo (R-01) ───────────────

def test_criterio2_ninguna_interfaz_no_exenta_tiene_ancho_fijo():
    """R-01: ningún contenedor raíz (no exento) tiene w-[...px] fijo."""
    violaciones = interfaces_con_ancho_fijo()
    assert violaciones == (), (
        "Interfaces con ancho fijo en su contenedor raíz: "
        + ", ".join(f"{i.nombre} ({i.contenedor_raiz})" for i in violaciones)
    )


def test_criterio2_los_10_contenedores_criticos_estan_catalogados():
    """El Documento 6 §4.1 cataloga 10 contenedores críticos a parametrizar."""
    assert len(CONTENEDORES_CRITICOS) == 10


def test_criterio2_cada_contenedor_critico_declara_actual_y_nuevo():
    """Cada contenedor crítico declara su ancho rígido y su ancho fluido."""
    for c in CONTENEDORES_CRITICOS:
        assert c["actual"], f"{c['archivo']}:{c['linea']} sin ancho actual"
        assert c["nuevo"], f"{c['archivo']}:{c['linea']} sin ancho nuevo"
        # El ancho nuevo debe ser fluido: w-full + max-w o lg:w.
        assert "w-full" in c["nuevo"], (
            f"{c['archivo']}:{c['linea']} no nace fluido: {c['nuevo']}"
        )


def test_criterio2_el_ancho_nuevo_no_es_un_ancho_fijo():
    """El ancho nuevo de cada contenedor crítico NO contiene un w-[...px] fijo.

    Se usa el MISMO detector que la puerta (PATRON_ANCHO_FIJO), que excluye
    `max-w-`, `min-w-` y los anchos acotados a un breakpoint (`lg:w-[...]`).
    """
    for c in CONTENEDORES_CRITICOS:
        assert not PATRON_ANCHO_FIJO.search(c["nuevo"]), (
            f"{c['archivo']}:{c['linea']} sigue con ancho fijo: {c['nuevo']}"
        )


def test_criterio2_las_plantillas_de_impresion_estan_exentas():
    """R-02: las 2 plantillas de impresión están exentas de responsividad."""
    exentas = [i for i in INTERFACES if i.exenta_responsiva]
    assert len(exentas) == 2
    nombres = {i.nombre for i in exentas}
    assert nombres == {"TicketTemplate", "CorteTicketTemplate"}


def test_criterio2_la_deteccion_de_ancho_fijo_no_marca_max_w():
    """La detección de R-01 NO marca `max-w-[...]` (es fluido)."""
    from superficie.registry import Interfaz

    fluido = Interfaz(
        numero=99,
        nombre="Fluido",
        tipo="Composición",
        anclaje="x",
        lineas="—",
        modos={"MOSTRADOR": "a", "COMPACTO": "b", "MOVIL": "c"},
        contenedor_raiz="w-full max-w-[420px]",
    )
    assert not fluido.tiene_ancho_fijo


def test_criterio2_la_deteccion_de_ancho_fijo_si_marca_w_fijo():
    """La detección de R-01 SÍ marca `w-[420px]` (rígido)."""
    from superficie.registry import Interfaz

    rigido = Interfaz(
        numero=99,
        nombre="Rígido",
        tipo="Composición",
        anclaje="x",
        lineas="—",
        modos={"MOSTRADOR": "a", "COMPACTO": "b", "MOVIL": "c"},
        contenedor_raiz="w-[420px]",
    )
    assert rigido.tiene_ancho_fijo


# ── Criterio 3: la paleta canónica se respeta en las 24 interfaces ────────────

def test_criterio3_la_paleta_canonica_esta_declarada():
    """La paleta canónica del Documento 7 §2.1 está declarada."""
    assert PALETA_CANONICA["acento_principal"] == "#c1d72e"
    assert PALETA_CANONICA["fondo_profundo"] == "#0a0a0a"
    assert PALETA_CANONICA["crema_ticket"] == "#fdfbf7"


def test_criterio3_los_radios_canonicos_estan_declarados():
    """Los radios canónicos del Documento 7 §2.3 están declarados."""
    assert "rounded-[35px]" in RADIOS_CANONICOS
    assert "rounded-[40px]" in RADIOS_CANONICOS
    assert "rounded-[50px]" in RADIOS_CANONICOS


def test_criterio3_las_4_reglas_duras_estan_declaradas():
    """Las 4 reglas duras R-01 a R-04 del Documento 6 §3 están declaradas."""
    assert set(REGLAS_DURAS.keys()) == {"R-01", "R-02", "R-03", "R-04"}


def test_criterio3_toda_interfaz_de_pantalla_usa_la_paleta():
    """Toda interfaz de pantalla/modal/panel/composición declara su paleta."""
    for i in INTERFACES:
        if i.tipo == "Impresión":
            continue  # Las plantillas usan solo la crema del papel.
        assert i.paleta, f"{i.nombre} no declara paleta"


def test_criterio3_el_acento_principal_aparece_en_las_interfaces_clave():
    """El acento #c1d72e aparece en las interfaces transaccionales clave."""
    claves = ("RetailVisionPOS", "SalesReceipt", "CheckoutScreen", "ProductCard")
    for nombre in claves:
        interfaz = next(i for i in INTERFACES if i.nombre == nombre)
        assert "#c1d72e" in interfaz.paleta, f"{nombre} no usa el acento canónico"


def test_criterio3_el_fondo_profundo_aparece_en_las_pantallas_raiz():
    """El fondo #0a0a0a aparece en las pantallas raíz."""
    for i in INTERFACES:
        if i.tipo == "Pantalla raíz":
            assert "#0a0a0a" in i.paleta, f"{i.nombre} no usa el fondo profundo"


def test_criterio3_la_crema_del_ticket_aparece_en_el_ticket():
    """La crema #fdfbf7 aparece en el ticket y en las plantillas de impresión."""
    for nombre in ("SalesReceipt", "TicketTemplate", "CorteTicketTemplate"):
        interfaz = next(i for i in INTERFACES if i.nombre == nombre)
        assert "#fdfbf7" in interfaz.paleta, f"{nombre} no usa la crema del ticket"


# ── R-03: los 3 modos son explícitos ──────────────────────────────────────────

def test_r03_toda_interfaz_declara_los_3_modos():
    """R-03: cada interfaz declara explícitamente MOSTRADOR, COMPACTO y MÓVIL."""
    violaciones = interfaces_que_no_declaran_los_3_modos()
    assert violaciones == (), (
        "Interfaces que no declaran los 3 modos: "
        + ", ".join(i.nombre for i in violaciones)
    )


def test_r03_los_3_modos_son_los_del_documento_6():
    """Los 3 modos son MOSTRADOR, COMPACTO y MOVIL (Documento 6 §2)."""
    assert MODOS == ("MOSTRADOR", "COMPACTO", "MOVIL")


def test_r03_cada_interfaz_tiene_anclaje_al_codigo():
    """Cada interfaz tiene su anclaje al código (Documento 7 §7 de cada ficha)."""
    for i in INTERFACES:
        assert i.anclaje, f"{i.nombre} sin anclaje"
        assert i.lineas, f"{i.nombre} sin líneas"
