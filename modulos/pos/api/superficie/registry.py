"""Registro de las 24 interfaces — FASE 5 (Superficie).

Cada interfaz se declara aquí con su tipo, su anclaje al código del POS viejo
(Documento 7 §3–§7) y su comportamiento declarado en los 3 modos responsivos
(Documento 6 §2). El registro es la fuente única de verdad: el test de la puerta
F5 lo recorre y verifica que las 24 interfaces existan, que ninguna tenga ancho
fijo en su contenedor raíz (R-01) y que la paleta canónica se respete.

Inventario (Documento 7 §3–§7, fichas 01–24):

  Tipo                 Cantidad  Componentes
  ───────────────────  ────────  ─────────────────────────────────────────────
  Pantallas raíz          7      RetailVisionPOS, TableServicePOS,
                                 VisionTrainingUI, GrandezaParamsUI,
                                 GrandezaDailyUI, GrandezaDriverUI,
                                 RepartoPanGrandezaUI
  Modales                 6      CheckoutScreen, GestionPersonal, GestorDeCaja,
                                 ProgramacionPedidoModal, TerminalSelector,
                                 OpenAccountsCorkboard
  Paneles y overlays      5      SalesReceipt, POSHeader, POSOverlays,
                                 VisionVisor, VisionScanner
  Composición             4      ProductGrid, ProductCard, CategoryBar,
                                 CategoryEditor
  Impresión               2      TicketTemplate, CorteTicketTemplate
  ───────────────────  ────────
  TOTAL                  24

Nota de conteo (Documento 7 §0.3): `POSOverlays.jsx` exporta 3 overlays
(`ForceLogoutModal`, `OfflineBanner`, `ToastNotification`) que se cuentan como un
solo archivo. `CategoryEditor` vive en `apps/pos/` (no en `components/`) pero es
composición del POS.

DEFECTO DEL PLANO (registrado, no corregido aquí) — 26 vs 24:
  El Documento 7 dice "26 interfaces" en su título, en §0.3 (tabla) y en §10
  (cierre). Pero su contenido enumerado y trazable es de 24:
    - §6 se titula "Fichas — Composición (4)" y contiene 4 fichas (19–22).
    - §8 (matriz de trazabilidad) enumera exactamente 24 filas (01–24).
    - El documento contiene 24 fichas (FICHA 01 a FICHA 24).
    - El README del plano declara "7 + 6 + 5 + 4 + 2" = 24.
  La fila "Composición | 5" de §0.3 lista solo 4 nombres, y la columna suma
  7+6+5+4+2 = 24, no 26. El "26" es un error aritmético del plano.
  Este registro se ancla a las 24 interfaces documentadas (las que tienen ficha
  y fila de trazabilidad). NO se inventan interfaces para forzar el 26.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# ── Los 3 modos de layout (Documento 6 §2) ────────────────────────────────────
# El modo MOSTRADOR (≥1024px) es la referencia de verdad y es INTOCABLE.
# COMPACTO (768–1023px) y MÓVIL (<768px) son ADICIONES, no sustituciones.
MODOS = ("MOSTRADOR", "COMPACTO", "MOVIL")

# ── La paleta canónica (Documento 7 §2.1) ─────────────────────────────────────
# Estos valores son la identidad visual del POS. Viajan intactos en los 3 modos.
PALETA_CANONICA: dict[str, str] = {
    "acento_principal": "#c1d72e",
    "fondo_profundo": "#0a0a0a",
    "fondo_profundo_alt": "#080808",
    "fondo_panel": "#1a1a1a",
    "crema_ticket": "#fdfbf7",
    "rojo_peligro": "#ef4444",  # red-500
}

# ── Los radios canónicos (Documento 7 §2.3) ───────────────────────────────────
RADIOS_CANONICOS = ("rounded-[35px]", "rounded-[40px]", "rounded-[50px]")

# ── Las 4 reglas duras de responsividad (Documento 6 §3) ──────────────────────
# Un componente que las viole NO se acepta en revisión.
REGLAS_DURAS: dict[str, str] = {
    "R-01": "CERO anchos absolutos en contenedores raíz (w-[...px] prohibido).",
    "R-02": "Tipografía que escala, no que se fija (text-[7px]/[8px]/[9px] prohibido como base legible).",
    "R-03": "Los 3 modos son explícitos, no implícitos (MÓVIL base, md: COMPACTO, lg: MOSTRADOR).",
    "R-04": "Targets táctiles de 44×44px mínimo, con ≥8px de separación entre adyacentes.",
}

# ── Los 28 contenedores de ancho fijo a parametrizar (Documento 6 §4.1) ───────
# Los 10 CRÍTICOS del POS transaccional (bloquean el cobro). Cada uno declara
# su ancho actual (rígido) y su ancho nuevo (fluido).
CONTENEDORES_CRITICOS: tuple[dict[str, str], ...] = (
    {"archivo": "SalesReceipt.jsx", "linea": "41", "actual": "w-[420px]", "nuevo": "w-full max-w-[420px]"},
    {"archivo": "CheckoutScreen.jsx", "linea": "132", "actual": "w-[1100px]", "nuevo": "w-full max-w-[1100px]"},
    {"archivo": "CheckoutScreen.jsx", "linea": "133", "actual": "w-[800px]", "nuevo": "w-full max-w-[800px]"},
    {"archivo": "CheckoutScreen.jsx", "linea": "322", "actual": "w-[320px] flex-shrink-0", "nuevo": "w-full lg:w-[320px] lg:flex-shrink-0"},
    {"archivo": "GestionPersonal.jsx", "linea": "123", "actual": "w-[800px] h-[600px]", "nuevo": "w-full max-w-[800px] h-full max-h-[600px]"},
    {"archivo": "GestionPersonal.jsx", "linea": "241", "actual": "w-[280px]", "nuevo": "w-full sm:w-[280px]"},
    {"archivo": "GestorDeCaja.jsx", "linea": "853", "actual": "w-[380px]", "nuevo": "w-full lg:w-[380px]"},
    {"archivo": "TableServicePOS.jsx", "linea": "134", "actual": "w-[400px]", "nuevo": "w-full lg:w-[400px]"},
    {"archivo": "VisionTrainingUI.jsx", "linea": "80", "actual": "w-[450px]", "nuevo": "w-full lg:w-[450px]"},
    {"archivo": "SalesReceipt.jsx", "linea": "206", "actual": "w-[400px]", "nuevo": "w-full max-w-[400px]"},
)

# ── Los 6 flujos funcionales (Documento 5 §E) ─────────────────────────────────
# La puerta F5 exige paridad funcional: los 6 flujos replicados.
FLUJOS: tuple[dict[str, object], ...] = (
    {
        "id": "E.1",
        "nombre": "Venta directa (mostrador)",
        "interfaces": ("RetailVisionPOS", "POSHeader", "ProductGrid", "ProductCard", "CategoryBar", "SalesReceipt", "CheckoutScreen"),
        "reglas": ("RN-14", "RN-16", "RN-18", "RN-21", "RN-22", "RN-23", "RN-25", "RN-26", "RN-27", "RN-62", "RN-63"),
    },
    {
        "id": "E.2",
        "nombre": "Pedido (con proyección a Order)",
        "interfaces": ("RetailVisionPOS", "SalesReceipt", "ProgramacionPedidoModal"),
        "reglas": ("RN-67", "RN-68", "RN-69", "RN-70"),
    },
    {
        "id": "E.3",
        "nombre": "Recuperación de cuenta",
        "interfaces": ("RetailVisionPOS", "OpenAccountsCorkboard", "SalesReceipt"),
        "reglas": ("RN-31", "RN-32", "RN-33", "RN-25", "RN-26"),
    },
    {
        "id": "E.4",
        "nombre": "Guardado de emergencia",
        "interfaces": ("RetailVisionPOS", "POSOverlays"),
        "reglas": ("RN-40",),
    },
    {
        "id": "E.5",
        "nombre": "Corte de caja",
        "interfaces": ("GestorDeCaja", "CorteTicketTemplate"),
        "reglas": ("RN-50", "RN-51", "RN-53", "RN-54", "RN-55", "RN-57", "RN-59", "RN-60"),
    },
    {
        "id": "E.6",
        "nombre": "Ocupación de terminal",
        "interfaces": ("TerminalSelector", "POSHeader", "POSOverlays"),
        "reglas": ("RN-03", "RN-04", "RN-06", "RN-07", "RN-08"),
    },
)


# R-01: detecta un ancho absoluto en píxeles que fija el contenedor raíz.
# NO marca `max-w-[...]` ni `min-w-[...]` (fluidos) ni los anchos acotados a un
# breakpoint (`sm:`/`md:`/`lg:`/`xl:`/`2xl:`), porque no fijan el ancho raíz.
PATRON_ANCHO_FIJO = re.compile(
    r"(?<!max-)(?<!min-)(?<!\bsm:)(?<!\bmd:)(?<!\blg:)(?<!\bxl:)(?<!\b2xl:)"
    r"\bw-\[\d+px\]"
)


@dataclass(frozen=True)
class Interfaz:
    """Una de las 24 interfaces documentadas del POS.

    `anclaje` es la ruta del archivo en el POS viejo (Documento 7 §7 de cada
    ficha), para trazabilidad. `modos` declara explícitamente el comportamiento
    en los 3 modos (R-03). `contenedor_raiz` declara la clase del contenedor
    raíz: si tiene un `w-[...px]` fijo, viola R-01.
    """

    numero: int
    nombre: str
    tipo: str
    anclaje: str
    lineas: str
    modos: dict[str, str]
    contenedor_raiz: str
    paleta: tuple[str, ...] = field(default_factory=tuple)
    exenta_responsiva: bool = False

    @property
    def tiene_ancho_fijo(self) -> bool:
        """R-01: ¿el contenedor raíz tiene un ancho absoluto en píxeles?

        Se permite `min-w-[...]` (tablas con scroll), `max-w-[...]` (fluido) y
        los anchos acotados a un breakpoint (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`),
        porque no fijan el ancho raíz en todos los modos. Se prohíbe `w-[<n>px]`
        sin acotar como ancho del contenedor raíz.
        """
        return bool(PATRON_ANCHO_FIJO.search(self.contenedor_raiz))

    @property
    def declara_los_3_modos(self) -> bool:
        """R-03: ¿declara explícitamente los 3 modos?"""
        return all(m in self.modos for m in MODOS)


INTERFACES: tuple[Interfaz, ...] = (
    # ── §3 Pantallas raíz (7) ─────────────────────────────────────────────────
    Interfaz(
        numero=1,
        nombre="RetailVisionPOS",
        tipo="Pantalla raíz",
        anclaje="apps/pos/RetailVisionPOS.jsx",
        lineas="30 (767 líneas)",
        modos={
            "MOSTRADOR": "layout completo de 2 columnas (cuerpo + ticket)",
            "COMPACTO": "el ticket lateral se estrecha; el grid pasa a 3 columnas",
            "MOVIL": "el ticket se convierte en panel inferior deslizable; el grid a 2 columnas",
        },
        contenedor_raiz="w-full h-screen flex flex-col",
        paleta=("#0a0a0a", "#c1d72e"),
    ),
    Interfaz(
        numero=2,
        nombre="TableServicePOS",
        tipo="Pantalla raíz",
        anclaje="apps/pos/TableServicePOS.jsx",
        lineas="13 (165 líneas)",
        modos={
            "MOSTRADOR": "grid de mesas lg:grid-cols-4; comanda lateral w-full lg:w-[400px]",
            "COMPACTO": "grid grid-cols-2; comanda apilada debajo",
            "MOVIL": "grid grid-cols-2; comanda como panel inferior",
        },
        contenedor_raiz="w-full h-screen flex flex-col bg-[#0a0a0a]",
        paleta=("#0a0a0a",),
    ),
    Interfaz(
        numero=3,
        nombre="VisionTrainingUI",
        tipo="Pantalla raíz",
        anclaje="apps/pos/VisionTrainingUI.jsx",
        lineas="80",
        modos={
            "MOSTRADOR": "panel de entrenamiento w-full lg:w-[450px]",
            "COMPACTO": "panel w-full bajo el contenido",
            "MOVIL": "panel w-full, 1 columna",
        },
        contenedor_raiz="w-full h-screen flex flex-col",
        paleta=("#0a0a0a", "#c1d72e"),
    ),
    Interfaz(
        numero=4,
        nombre="GrandezaParamsUI",
        tipo="Pantalla raíz",
        anclaje="apps/pos/GrandezaParamsUI.jsx",
        lineas="66 (1643 líneas)",
        modos={
            "MOSTRADOR": "tabs de admin con columnas laterales",
            "COMPACTO": "tabs apiladas",
            "MOVIL": "1 columna, scroll vertical",
        },
        contenedor_raiz="w-full min-h-screen flex flex-col",
        paleta=("#0a0a0a", "#3b82f6", "#6366f1"),
    ),
    Interfaz(
        numero=5,
        nombre="GrandezaDailyUI",
        tipo="Pantalla raíz",
        anclaje="apps/pos/GrandezaDailyUI.jsx",
        lineas="—",
        modos={
            "MOSTRADOR": "vista de gerente con columnas",
            "COMPACTO": "columnas apiladas",
            "MOVIL": "1 columna, scroll vertical",
        },
        contenedor_raiz="w-full min-h-screen flex flex-col",
        paleta=("#0a0a0a", "#f59e0b", "#10b981"),
    ),
    Interfaz(
        numero=6,
        nombre="GrandezaDriverUI",
        tipo="Pantalla raíz",
        anclaje="apps/pos/GrandezaDriverUI.jsx",
        lineas="—",
        modos={
            "MOSTRADOR": "vista de repartidor con mapa",
            "COMPACTO": "mapa + lista apilados",
            "MOVIL": "1 columna, acciones en barra inferior",
        },
        contenedor_raiz="w-full min-h-screen flex flex-col bg-black/75",
        paleta=("#0a0a0a", "#f59e0b"),
    ),
    Interfaz(
        numero=7,
        nombre="RepartoPanGrandezaUI",
        tipo="Pantalla raíz",
        anclaje="apps/pos/RepartoPanGrandezaUI.jsx",
        lineas="16 (219 líneas)",
        modos={
            "MOSTRADOR": "suites de reparto en grid",
            "COMPACTO": "grid reducido",
            "MOVIL": "1 columna, scroll vertical",
        },
        contenedor_raiz="w-full min-h-screen flex flex-col",
        paleta=("#0a0a0a", "#f59e0b"),
    ),
    # ── §4 Modales (6) ────────────────────────────────────────────────────────
    Interfaz(
        numero=8,
        nombre="CheckoutScreen",
        tipo="Modal",
        anclaje="apps/pos/components/CheckoutScreen.jsx",
        lineas="132–133, 322",
        modos={
            "MOSTRADOR": "modal centrado w-full max-w-[1100px]; columna lateral w-full lg:w-[320px]",
            "COMPACTO": "modal w-full max-w-[800px]",
            "MOVIL": "modal w-full, 1 columna",
        },
        contenedor_raiz="w-full max-w-[1100px] mx-auto",
        paleta=("#1a1a1a", "#c1d72e"),
    ),
    Interfaz(
        numero=9,
        nombre="GestionPersonal",
        tipo="Modal",
        anclaje="apps/pos/components/GestionPersonal.jsx",
        lineas="123, 241",
        modos={
            "MOSTRADOR": "modal w-full max-w-[800px] h-full max-h-[600px]; numpad w-full sm:w-[280px]",
            "COMPACTO": "modal w-full max-w-[800px]",
            "MOVIL": "modal w-full; numpad w-full",
        },
        contenedor_raiz="w-full max-w-[800px] h-full max-h-[600px]",
        paleta=("#1a1a1a", "#c1d72e"),
    ),
    Interfaz(
        numero=10,
        nombre="GestorDeCaja",
        tipo="Modal",
        anclaje="apps/pos/components/GestorDeCaja.jsx",
        lineas="853",
        modos={
            "MOSTRADOR": "modal con teclado táctil w-full lg:w-[380px]",
            "COMPACTO": "teclado w-full bajo el contenido",
            "MOVIL": "1 columna, acciones en barra inferior",
        },
        contenedor_raiz="w-full max-w-[900px] mx-auto",
        paleta=("#1a1a1a", "#c1d72e"),
    ),
    Interfaz(
        numero=11,
        nombre="ProgramacionPedidoModal",
        tipo="Modal",
        anclaje="apps/pos/components/ProgramacionPedidoModal.jsx",
        lineas="—",
        modos={
            "MOSTRADOR": "modal centrado",
            "COMPACTO": "modal w-full",
            "MOVIL": "modal w-full, 1 columna",
        },
        contenedor_raiz="w-full max-w-[600px] mx-auto",
        paleta=("#1a1a1a", "#c1d72e"),
    ),
    Interfaz(
        numero=12,
        nombre="TerminalSelector",
        tipo="Modal",
        anclaje="apps/pos/components/TerminalSelector.jsx",
        lineas="—",
        modos={
            "MOSTRADOR": "grid de terminales",
            "COMPACTO": "grid reducido",
            "MOVIL": "1 columna, scroll vertical",
        },
        contenedor_raiz="w-full max-w-[900px] mx-auto",
        paleta=("#0a0a0a", "#c1d72e"),
    ),
    Interfaz(
        numero=13,
        nombre="OpenAccountsCorkboard",
        tipo="Modal",
        anclaje="apps/pos/components/OpenAccountsCorkboard.jsx",
        lineas="—",
        modos={
            "MOSTRADOR": "corcho de cuentas abiertas en grid",
            "COMPACTO": "grid reducido",
            "MOVIL": "1 columna, scroll vertical",
        },
        contenedor_raiz="w-full max-w-[1000px] mx-auto",
        paleta=("#1a1a1a", "#c1d72e"),
    ),
    # ── §5 Paneles y overlays (5) ─────────────────────────────────────────────
    Interfaz(
        numero=14,
        nombre="SalesReceipt",
        tipo="Panel",
        anclaje="apps/pos/components/SalesReceipt.jsx",
        lineas="41, 87, 128, 182, 206",
        modos={
            "MOSTRADOR": "panel lateral w-full max-w-[420px]",
            "COMPACTO": "panel colapsable (botón 'Ver ticket')",
            "MOVIL": "panel inferior deslizable / pantalla completa",
        },
        contenedor_raiz="w-full max-w-[420px] flex flex-col",
        paleta=("#fdfbf7", "#c1d72e"),
    ),
    Interfaz(
        numero=15,
        nombre="POSHeader",
        tipo="Panel",
        anclaje="apps/pos/components/POSHeader.jsx",
        lineas="—",
        modos={
            "MOSTRADOR": "header completo (terminal, red, cuenta, Venta/Pedido, Caja)",
            "COMPACTO": "header compacto",
            "MOVIL": "header reducido, acciones en barra inferior",
        },
        contenedor_raiz="w-full flex items-center justify-between",
        paleta=("#0a0a0a", "#c1d72e"),
    ),
    Interfaz(
        numero=16,
        nombre="POSOverlays",
        tipo="Overlay",
        anclaje="apps/pos/components/POSOverlays.jsx",
        lineas="—",
        modos={
            "MOSTRADOR": "3 overlays (ForceLogoutModal, OfflineBanner, ToastNotification)",
            "COMPACTO": "overlays fluidos",
            "MOVIL": "overlays fluidos, banner en barra inferior",
        },
        contenedor_raiz="w-full fixed inset-0 pointer-events-none",
        paleta=("#0a0a0a", "#c1d72e"),
    ),
    Interfaz(
        numero=17,
        nombre="VisionVisor",
        tipo="Panel",
        anclaje="apps/pos/components/VisionVisor.jsx",
        lineas="—",
        modos={
            "MOSTRADOR": "visor de cámara a pantalla completa del cuerpo",
            "COMPACTO": "visor reducido",
            "MOVIL": "visor a pantalla completa",
        },
        contenedor_raiz="w-full h-full relative",
        paleta=("#0a0a0a", "#c1d72e"),
    ),
    Interfaz(
        numero=18,
        nombre="VisionScanner",
        tipo="Panel",
        anclaje="apps/pos/VisionScanner.jsx",
        lineas="—",
        modos={
            "MOSTRADOR": "escáner con estados IDLE/ANALYZING/LOCAL/CLOUD/ERROR",
            "COMPACTO": "escáner reducido",
            "MOVIL": "escáner a pantalla completa",
        },
        contenedor_raiz="w-full h-full relative",
        paleta=("#0a0a0a", "#c1d72e"),
    ),
    # ── §6 Composición (4) ────────────────────────────────────────────────────
    Interfaz(
        numero=19,
        nombre="ProductGrid",
        tipo="Composición",
        anclaje="apps/pos/components/ProductGrid.jsx",
        lineas="—",
        modos={
            "MOSTRADOR": "grid de productos (4 columnas)",
            "COMPACTO": "grid de 3 columnas",
            "MOVIL": "grid de 2 columnas",
        },
        contenedor_raiz="w-full grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4",
        paleta=("#0a0a0a", "#c1d72e"),
    ),
    Interfaz(
        numero=20,
        nombre="ProductCard",
        tipo="Composición",
        anclaje="apps/pos/components/ProductCard.jsx",
        lineas="—",
        modos={
            "MOSTRADOR": "tarjeta rounded-[35px] con cascada de imágenes de 5 niveles",
            "COMPACTO": "tarjeta fluida",
            "MOVIL": "tarjeta fluida",
        },
        contenedor_raiz="w-full rounded-[35px] overflow-hidden",
        paleta=("#0a0a0a", "#c1d72e"),
    ),
    Interfaz(
        numero=21,
        nombre="CategoryBar",
        tipo="Composición",
        anclaje="apps/pos/components/CategoryBar.jsx",
        lineas="—",
        modos={
            "MOSTRADOR": "barra de categorías + botón ESCANER IA",
            "COMPACTO": "barra con scroll horizontal",
            "MOVIL": "barra con scroll horizontal",
        },
        contenedor_raiz="w-full flex items-center gap-2 overflow-x-auto",
        paleta=("#0a0a0a", "#c1d72e"),
    ),
    Interfaz(
        numero=22,
        nombre="CategoryEditor",
        tipo="Composición",
        anclaje="apps/pos/CategoryEditor.jsx",
        lineas="—",
        modos={
            "MOSTRADOR": "editor de categorías",
            "COMPACTO": "editor fluido",
            "MOVIL": "editor fluido, 1 columna",
        },
        contenedor_raiz="w-full max-w-[600px] mx-auto",
        paleta=("#1a1a1a", "#c1d72e"),
    ),
    # ── §7 Impresión (2) — EXENTAS de responsividad (R-02) ────────────────────
    Interfaz(
        numero=23,
        nombre="TicketTemplate",
        tipo="Impresión",
        anclaje="apps/pos/components/TicketTemplate.jsx",
        lineas="7",
        modos={
            "MOSTRADOR": "papel térmico 58mm/80mm — ancho físico fijo",
            "COMPACTO": "papel térmico 58mm/80mm — ancho físico fijo",
            "MOVIL": "papel térmico 58mm/80mm — ancho físico fijo",
        },
        contenedor_raiz="w-[58mm] font-mono",
        paleta=("#fdfbf7",),
        exenta_responsiva=True,
    ),
    Interfaz(
        numero=24,
        nombre="CorteTicketTemplate",
        tipo="Impresión",
        anclaje="apps/pos/components/CorteTicketTemplate.jsx",
        lineas="65",
        modos={
            "MOSTRADOR": "papel térmico — ancho físico fijo",
            "COMPACTO": "papel térmico — ancho físico fijo",
            "MOVIL": "papel térmico — ancho físico fijo",
        },
        contenedor_raiz="w-[80mm] font-mono",
        paleta=("#fdfbf7",),
        exenta_responsiva=True,
    ),
)


def listar_interfaces() -> tuple[Interfaz, ...]:
    """Las 24 interfaces documentadas, en orden."""
    return INTERFACES


def matriz_interfaz_tipo() -> dict[str, str]:
    """Matriz `interfaz → tipo`, para el test de la puerta."""
    return {i.nombre: i.tipo for i in INTERFACES}


def conteo_por_tipo() -> dict[str, int]:
    """Cuántas interfaces hay de cada tipo (debe sumar 24)."""
    conteo: dict[str, int] = {}
    for i in INTERFACES:
        conteo[i.tipo] = conteo.get(i.tipo, 0) + 1
    return conteo


def interfaces_con_ancho_fijo() -> tuple[Interfaz, ...]:
    """Las interfaces que violan R-01 (excluye las exentas de responsividad)."""
    return tuple(i for i in INTERFACES if not i.exenta_responsiva and i.tiene_ancho_fijo)


def interfaces_que_no_declaran_los_3_modos() -> tuple[Interfaz, ...]:
    """Las interfaces que violan R-03."""
    return tuple(i for i in INTERFACES if not i.declara_los_3_modos)
