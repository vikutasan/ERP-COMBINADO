"""Puerta de FASE 7.0 — Contratos de IA (voz + NLU).

Verifica que el POS declare por contrato las dos capacidades de IA que antes
usaba por convención implícita (hallazgo H-2 del plan de Fase 7), cerrando la
brecha que violaba la Regla Dura A-02.

Criterios de la puerta:

  1. Existen los contratos 24 (`ia.transcribir_voz`) y 25
     (`ia.interpretar_intencion`), con el número correcto.
  2. El proveedor de ambos es el **Centro de IA** (DT-07), NO el POS.
  3. El consumidor de ambos es el POS.
  4. Ambos declaran `503 IA_NO_DISPONIBLE` en `errores` (degradación elegante:
     un fallo del motor de IA nunca bloquea una venta).
  5. Ninguno expone una tabla (O-23): son operaciones, no tablas.
  6. El POS NO importa el motor de IA (`torch`, `whisper`, `ultralytics`,
     `tesseract`) — la frontera se respeta en el código, no solo en el registro.

La evidencia es el registro y el análisis del código, no la intención.
"""

from __future__ import annotations

import ast
from pathlib import Path

from contracts import CONTRATOS, listar_contratos

# Raíz del backend: .../apps/api
API_ROOT = Path(__file__).resolve().parent.parent

# Los dos contratos que declara la F7.0.
CONTRATO_VOZ = "ia.transcribir_voz"
CONTRATO_NLU = "ia.interpretar_intencion"

# El proveedor de las capacidades de IA es el Centro de IA (DT-07).
PROVEEDOR_IA = "Centro de IA"

# Motores de IA que el POS NUNCA debe importar (DT-07). Si alguno aparece en un
# import del POS, la frontera se rompió.
MOTORES_PROHIBIDOS = ("torch", "whisper", "ultralytics", "tesseract", "openai", "google.generativeai")


def _contrato(nombre: str):
    """Devuelve el contrato con ese nombre, o falla con un mensaje claro."""
    for contrato in CONTRATOS:
        if contrato.nombre == nombre:
            return contrato
    raise AssertionError(f"No existe el contrato '{nombre}' en el registro")


# ── Criterio 1: los contratos existen con su número ────────────────────────


def test_criterio1_existe_el_contrato_de_voz():
    """El contrato 24 es `ia.transcribir_voz`."""
    contrato = _contrato(CONTRATO_VOZ)
    assert contrato.numero == 24, f"Se esperaba el número 24, es {contrato.numero}"


def test_criterio1_existe_el_contrato_de_nlu():
    """El contrato 25 es `ia.interpretar_intencion`."""
    contrato = _contrato(CONTRATO_NLU)
    assert contrato.numero == 25, f"Se esperaba el número 25, es {contrato.numero}"


def test_criterio1_el_registro_tiene_al_menos_25_contratos():
    """El registro tiene al menos los 25 contratos que introdujo la F7.0.

    La F8.0 añadió los contratos 26 y 27 (CRM y Notificaciones); por eso la
    aserción es `>= 25` y no `== 25`: la F7.0 garantiza su piso, no el techo.
    """
    assert len(CONTRATOS) >= 25, f"Se esperaban al menos 25 contratos, hay {len(CONTRATOS)}"
    assert len(listar_contratos()) >= 25


# ── Criterio 2: el proveedor es el Centro de IA (DT-07) ────────────────────


def test_criterio2_el_proveedor_de_voz_es_el_centro_de_ia():
    """La voz la provee el Centro de IA, no el POS (DT-07)."""
    contrato = _contrato(CONTRATO_VOZ)
    assert contrato.proveedor == PROVEEDOR_IA, (
        f"El proveedor de {CONTRATO_VOZ} es '{contrato.proveedor}', "
        f"se esperaba '{PROVEEDOR_IA}'"
    )


def test_criterio2_el_proveedor_de_nlu_es_el_centro_de_ia():
    """El NLU lo provee el Centro de IA, no el POS (DT-07)."""
    contrato = _contrato(CONTRATO_NLU)
    assert contrato.proveedor == PROVEEDOR_IA, (
        f"El proveedor de {CONTRATO_NLU} es '{contrato.proveedor}', "
        f"se esperaba '{PROVEEDOR_IA}'"
    )


def test_criterio2_el_pos_no_es_proveedor_de_los_contratos_de_ia():
    """El POS NO figura como proveedor de ningún contrato de IA."""
    proveedores_ia = [
        c.nombre for c in CONTRATOS if c.nombre.startswith("ia.")
    ]
    assert proveedores_ia == [CONTRATO_VOZ, CONTRATO_NLU], (
        f"Contratos ia.* inesperados: {proveedores_ia}"
    )
    for nombre in proveedores_ia:
        assert _contrato(nombre).proveedor != "POS", (
            f"{nombre} no puede tener al POS como proveedor (DT-07)"
        )


# ── Criterio 3: el consumidor es el POS ────────────────────────────────────


def test_criterio3_el_pos_consume_ambos_contratos():
    """El POS es el consumidor de los dos contratos de IA."""
    for nombre in (CONTRATO_VOZ, CONTRATO_NLU):
        assert _contrato(nombre).consumidor == "POS", (
            f"El consumidor de {nombre} debe ser el POS"
        )


# ── Criterio 4: degradación elegante (503 IA_NO_DISPONIBLE) ────────────────


def test_criterio4_ambos_declaran_503_ia_no_disponible():
    """Un fallo del motor de IA se traduce a 503, nunca a un 500 (DT-07)."""
    for nombre in (CONTRATO_VOZ, CONTRATO_NLU):
        errores = " ".join(_contrato(nombre).errores)
        assert "503" in errores, f"{nombre} no declara un error 503"
        assert "IA_NO_DISPONIBLE" in errores, (
            f"{nombre} no declara el código IA_NO_DISPONIBLE"
        )


def test_criterio4_ambos_declaran_400_por_entrada_invalida():
    """La entrada inválida se rechaza con 400, no con un 500."""
    for nombre in (CONTRATO_VOZ, CONTRATO_NLU):
        errores = " ".join(_contrato(nombre).errores)
        assert "400" in errores, f"{nombre} no declara un error 400"


# ── Criterio 5: son operaciones, no tablas (O-23) ──────────────────────────


def test_criterio5_ninguno_expone_una_tabla():
    """Los contratos de IA exponen una operación, nunca una tabla (O-23)."""
    for nombre in (CONTRATO_VOZ, CONTRATO_NLU):
        contrato = _contrato(nombre)
        assert contrato.tabla_expuesta is None, (
            f"{nombre} expone la tabla '{contrato.tabla_expuesta}'"
        )
        assert contrato.operacion.startswith(("GET ", "POST ", "PUT ", "PATCH ", "DELETE ")), (
            f"{nombre}: '{contrato.operacion}' no es una operación HTTP"
        )


def test_criterio5_ambos_tienen_firma_documentada():
    """Cada contrato de IA declara entrada, salida y firma legible."""
    for nombre in (CONTRATO_VOZ, CONTRATO_NLU):
        contrato = _contrato(nombre)
        assert contrato.entrada, f"{nombre} no declara entrada"
        assert contrato.salida, f"{nombre} no declara salida"
        assert "->" in contrato.firma, f"{nombre} no produce firma legible"


# ── Criterio 6: el POS no importa el motor de IA (frontera en el código) ───


def _imports_absolutos_de(archivo: Path) -> list[str]:
    """Devuelve los módulos importados de forma ABSOLUTA por un archivo .py."""
    try:
        arbol = ast.parse(archivo.read_text(encoding="utf-8"))
    except (SyntaxError, UnicodeDecodeError):
        return []
    modulos: list[str] = []
    for nodo in ast.walk(arbol):
        if isinstance(nodo, ast.Import):
            modulos.extend(alias.name for alias in nodo.names)
        elif isinstance(nodo, ast.ImportFrom):
            if nodo.level == 0 and nodo.module:
                modulos.append(nodo.module)
    return modulos


def _archivos_python(directorio: Path) -> list[Path]:
    """Todos los .py del directorio, excluyendo tests y cachés."""
    return [
        p
        for p in directorio.rglob("*.py")
        if "__pycache__" not in p.parts and "tests" not in p.parts
    ]


def test_criterio6_el_pos_no_importa_el_motor_de_ia():
    """Ningún archivo del backend importa un motor de IA (DT-07).

    El POS consume la IA por contrato (HTTP). Si importara `torch`, `whisper`,
    `ultralytics` o `tesseract`, la frontera estaría rota.
    """
    infractores: list[str] = []
    for archivo in _archivos_python(API_ROOT):
        for modulo in _imports_absolutos_de(archivo):
            raiz = modulo.split(".")[0]
            if raiz in MOTORES_PROHIBIDOS:
                infractores.append(f"{archivo.relative_to(API_ROOT)} importa '{modulo}'")
    assert not infractores, (
        "El POS importa motores de IA (viola DT-07):\n" + "\n".join(infractores)
    )
