"""Puerta de FASE 2 — Frontera (Contratos).

Verifica los 3 criterios de la puerta (Plan de Construcción §4.3):

  1. El test de arquitectura pasa: 0 imports del POS a modelos ajenos.
  2. Cada contrato tiene su firma (entrada/salida) documentada.
  3. Ningún contrato expone una tabla; todos exponen una operación.

La evidencia es el análisis del código y del registro, no la intención.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from contracts import CONTRATOS, listar_contratos

# Raíz del backend: .../apps/api
API_ROOT = Path(__file__).resolve().parent.parent

# Módulos ajenos al POS. El POS NO puede importar sus modelos.
MODULOS_AJENOS = (
    "catalog",
    "warehouse",
    "orders",
    "security",
    "cash",
    "production",
    "vision",
    "audit",
    "stats",
)

# Los 31 contratos esperados: los 17 del Documento 9 §10 (FASE 2) más los 5
# atómicos de la FASE 3.2 (corrigen el defecto D-2: endpoints sin contrato) más
# el contrato 23 de la FASE 5.0 (pizarrón de cuentas abiertas) más los 2 de la
# FASE 7.0 (capacidades de IA — cierran la brecha de la DT-07) más los 2 de la
# FASE 8.0 (CRM y Notificaciones — lado POS) más el contrato 28 de la FASE 10.4
# (contexto diario post-corte — cierra la brecha B-02) más el contrato 29 de la
# FASE 10.6.2 (eliminar movimiento de caja — cierra la brecha de paridad de
# operación del Gestor de Caja) más el contrato 29 de la FASE 12.9.1 (creación
# de ticket — cierra el hueco A-02 del endpoint `POST /pos/tickets`, que
# existía sin contrato declarado) más el contrato 30 de la FASE 12.10 (lectura
# de líneas — cierra el hueco A-02 que dejó abierto la Regla 15: el contrato 21
# devuelve 5 campos escalares y NO las líneas, así que recuperar una cuenta del
# pizarrón no podía hidratar el carrito) más el contrato 31 de la FASE 12.20
# (actualización de pedido — cierra el hueco A-02 del endpoint
# `PATCH /pos/tickets/{id}/order`, que permite persistir la programación de un
# ticket ya creado: el flujo real del POS es "productos primero, pedido después").
LOS_33_CONTRATOS = (
    "catalogo.productos_para_venta",
    "almacenes.consumir_por_venta",
    "almacenes.disponibilidad",
    "produccion.disponible_para_vender",
    "pos.eventos_auditables",
    "pos.resumen_de_venta",
    "seguridad.identidad_del_empleado",
    "seguridad.validar_pin",
    "caja.sesion_activa",
    "caja.abrir_turno",
    "caja.registrar_movimiento",
    "caja.resumen_del_turno",
    "caja.cerrar_turno",
    "caja.reporte_diario",
    "pedidos.registrar_desde_ticket",
    "pedidos.pedido_del_ticket",
    "vision.reconocer_producto",
    # ── FASE 3.2 — POS atómico ─────────────────────────────────────────────
    "pos.añadir_item",
    "pos.cambiar_cantidad",
    "pos.quitar_item",
    "pos.leer_ticket",
    "pos.verificar_envio",
    # ── FASE 5.0 — Pizarrón de cuentas abiertas ────────────────────────────
    "pos.cuentas_abiertas",
    # ── FASE 7.0 — Capacidades de IA (proveedor: Centro de IA — DT-07) ─────
    "ia.transcribir_voz",
    "ia.interpretar_intencion",
    # ── FASE 8.0 — CRM y Notificaciones (lado POS) ─────────────────────────
    "clientes.beneficios_para_ticket",
    "notificaciones.encolar_ticket",
    # ── FASE 10.6.2 — Eliminar movimiento de caja (proveedor: Caja) ────────
    "caja.eliminar_movimiento",
    # ── FASE 12.10 — Lectura de líneas (proveedor: POS — cierra A-02) ──────
    "pos.leer_lineas",
    # ── FASE 12.9.1 — Creación de ticket (proveedor: POS — cierra A-02) ────
    "pos.crear_ticket",
    # ── FASE 12.20 — Actualización de pedido (proveedor: POS — cierra A-02) ─
    "pos.actualizar_pedido",
    # ── FASE 10.4 — Contexto diario post-corte (proveedor: POS) ────────────
    "pos.contexto_diario",
    # ── FASE 3.3 / BUG-08 — Cobro de ticket (proveedor: POS) ───────────────
    "pos.cobrar_ticket",
)


def _imports_absolutos_de(archivo: Path) -> list[str]:
    """Devuelve los módulos importados de forma ABSOLUTA por un archivo .py.

    Solo se consideran los imports absolutos (nivel 0). Un import relativo
    (`from .cash import ...`, nivel >= 1) apunta a un submódulo PROPIO del
    paquete, no a un módulo ajeno. Confundirlos produce falsos positivos:
    el POS tiene su propio `models/cash.py` (tablas `cash_sessions`), que no
    es el módulo ajeno `cash`.
    """
    arbol = ast.parse(archivo.read_text(encoding="utf-8"), filename=str(archivo))
    modulos: list[str] = []
    for nodo in ast.walk(arbol):
        if isinstance(nodo, ast.Import):
            # `import x.y` es siempre absoluto.
            modulos.extend(alias.name for alias in nodo.names)
        elif isinstance(nodo, ast.ImportFrom):
            # `from .x import y` tiene level >= 1 → es relativo, se ignora.
            if nodo.module and nodo.level == 0:
                modulos.append(nodo.module)
    return modulos


def _archivos_python(directorio: Path) -> list[Path]:
    """Todos los .py de un directorio, recursivo, sin cachés."""
    return [
        p
        for p in directorio.rglob("*.py")
        if "__pycache__" not in p.parts and ".pytest_cache" not in p.parts
    ]


# ── Criterio 1: test de arquitectura ───────────────────────────────────────


def test_criterio1_el_pos_no_importa_modelos_ajenos():
    """0 imports del POS a modelos ajenos.

    Se revisan los paquetes del POS (`models/`, `contracts/`) buscando
    cualquier import que apunte a un módulo ajeno. Debe haber 0.
    """
    violaciones: list[str] = []
    for paquete in ("models", "contracts"):
        directorio = API_ROOT / paquete
        if not directorio.exists():
            continue
        for archivo in _archivos_python(directorio):
            for modulo in _imports_absolutos_de(archivo):
                raiz = modulo.split(".")[0]
                if raiz in MODULOS_AJENOS:
                    violaciones.append(f"{archivo.relative_to(API_ROOT)} importa '{modulo}'")
    assert violaciones == [], (
        "El POS importa modelos ajenos (viola P-01 / Regla de Oro #5):\n  "
        + "\n  ".join(violaciones)
    )


def test_criterio1_los_contratos_no_importan_modelos():
    """El paquete `contracts/` no importa NINGÚN modelo (ni propio ni ajeno).

    Un contrato es una frontera: describe operaciones, no toca tablas.
    """
    directorio = API_ROOT / "contracts"
    violaciones: list[str] = []
    for archivo in _archivos_python(directorio):
        for modulo in _imports_absolutos_de(archivo):
            raiz = modulo.split(".")[0]
            if raiz == "models" or raiz in MODULOS_AJENOS:
                violaciones.append(f"{archivo.relative_to(API_ROOT)} importa '{modulo}'")
    assert violaciones == [], (
        "Un contrato importa un modelo (debe ser pura frontera):\n  "
        + "\n  ".join(violaciones)
    )


# ── Criterio 2: cada contrato tiene su firma ───────────────────────────────


def test_criterio2_hay_exactamente_33_contratos():
    """El registro declara los 33 contratos (17 F2 + 5 F3.2 + 1 F5.0 + 2 F7.0 + 2 F8.0 + 1 F10.4 + 1 F10.6.2 + 1 F12.9.1 + 1 F12.10 + 1 F12.20 + 1 F3.3/BUG-08)."""
    assert len(CONTRATOS) == 33, f"Se esperaban 33 contratos, hay {len(CONTRATOS)}"
    nombres = tuple(c.nombre for c in CONTRATOS)
    assert nombres == LOS_33_CONTRATOS, f"Los nombres no coinciden:\n{nombres}"


def test_criterio2_cada_contrato_tiene_firma_documentada():
    """Cada contrato declara entrada y salida no vacías, y una operación."""
    for contrato in CONTRATOS:
        assert contrato.operacion, f"{contrato.nombre} no declara operación"
        assert contrato.entrada, f"{contrato.nombre} no declara entrada"
        assert contrato.salida, f"{contrato.nombre} no declara salida"
        assert contrato.consumidor, f"{contrato.nombre} no declara consumidor"
        assert contrato.proveedor, f"{contrato.nombre} no declara proveedor"
        # La firma legible debe poder construirse.
        assert "->" in contrato.firma, f"{contrato.nombre} no produce firma legible"


def test_criterio2_la_operacion_es_una_operacion_no_una_tabla():
    """La operación declarada es un endpoint (verbo HTTP), no un nombre de tabla."""
    verbos = ("GET ", "POST ", "PUT ", "PATCH ", "DELETE ")
    for contrato in CONTRATOS:
        assert contrato.operacion.startswith(verbos), (
            f"{contrato.nombre}: '{contrato.operacion}' no es una operación HTTP"
        )


# ── Criterio 3: ningún contrato expone una tabla ───────────────────────────


def test_criterio3_ningun_contrato_expone_una_tabla():
    """Ningún contrato expone una tabla; todos exponen una operación (O-23)."""
    for contrato in CONTRATOS:
        assert contrato.tabla_expuesta is None, (
            f"{contrato.nombre} expone la tabla '{contrato.tabla_expuesta}'"
        )


def test_criterio3_ninguna_salida_es_select_estrella():
    """Ninguna salida declara `SELECT *` ni una fila completa (O-23)."""
    for contrato in CONTRATOS:
        for campo, tipo in contrato.salida.items():
            assert "*" not in tipo, f"{contrato.nombre}.{campo} expone '*'"
            assert tipo != "Row", f"{contrato.nombre}.{campo} expone una fila completa"


def test_criterio3_el_pos_es_proveedor_en_sus_contratos():
    """El POS es proveedor en auditoría, estadísticas y sus contratos de ticket.

    Documento 9 §12 fijaba 2 (auditoría y estadísticas). La FASE 3.2 añade 5
    contratos atómicos cuyo proveedor es el propio POS (endpoints de ticket).
    La FASE 5.0 añade el contrato 23 (pizarrón de cuentas abiertas), también
    provisto por el POS. La FASE 12.9.1 añade el contrato 29 (creación de
    ticket), que cierra el hueco A-02 del endpoint `POST /pos/tickets`.
    La FASE 12.10 añade el contrato 30 (lectura de líneas), que cierra el hueco
    A-02 de la lectura de líneas para hidratar el carrito.
    """
    proveedor_pos = [c.nombre for c in CONTRATOS if c.proveedor == "POS"]
    assert proveedor_pos == [
        "pos.eventos_auditables",
        "pos.resumen_de_venta",
        "pos.añadir_item",
        "pos.cambiar_cantidad",
        "pos.quitar_item",
        "pos.leer_ticket",
        "pos.verificar_envio",
        "pos.cuentas_abiertas",
        "pos.leer_lineas",
        "pos.crear_ticket",
        "pos.actualizar_pedido",
        "pos.contexto_diario",
        "pos.cobrar_ticket",
    ], f"El POS es proveedor en contratos inesperados: {proveedor_pos}"


def test_listar_contratos_devuelve_los_33():
    """La función pública del paquete devuelve los 33 contratos."""
    assert len(listar_contratos()) == 33
