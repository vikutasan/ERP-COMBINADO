"""Configuración, prompt y utilidades internas del router de IA (FS2-05).

Contiene:
- Variables de entorno del gateway de IA
- PROMPT_EXTRACCION (prompt estructurado para LLaVA/OpenAI-vision)
- Utilidades de conversión de color (espejo del theme-engine en Python)
- Validación de contraste WCAG AA
"""

from __future__ import annotations

import os


# ---------------------------------------------------------------------------
# Configuración del gateway de IA
# ---------------------------------------------------------------------------
AI_HABILITADA = os.getenv("AI_HABILITADA", "false").lower() == "true"
AI_LOCAL_URL = os.getenv("AI_LOCAL_URL", "http://localhost:11434")
AI_LOCAL_MODELO = os.getenv("AI_LOCAL_MODELO", "llava")
AI_LOCAL_TIMEOUT = int(os.getenv("AI_LOCAL_TIMEOUT", "60"))

CATALOGO_FUENTES = ["Inter", "Roboto", "Montserrat", "Nunito", "Poppins"]
MODULOS_CONOCIDOS = ["pos", "estadisticas", "almacenes", "heladeria", "vista_general"]

# ---------------------------------------------------------------------------
# Prompt estructurado — basado en BRIEF_DE_EXTRACCION_VISUAL.md §5.
# ---------------------------------------------------------------------------
PROMPT_EXTRACCION = """Analiza esta imagen de interfaz de usuario (UI) y extrae los siguientes valores visuales.
Responde SOLO con JSON válido, sin explicaciones adicionales.

Extrae:
1. "acento": el color principal de acento (botones, precios, elementos activos). Formato hex (#RRGGBB).
2. "fondo_profundo": el color de fondo más oscuro/predominante. Formato hex.
3. "fondo_profundo_alt": un segundo tono de fondo (para scrollbar, bordes). Formato hex.
4. "fondo_panel": el color de las tarjetas/paneles sobre el fondo. Formato hex.
5. "crema_ticket": el color del texto principal (claro si fondo oscuro, oscuro si fondo claro). Formato hex.
6. "peligro": el color para alertas/errores/eliminar. Formato hex. Si no hay uno visible, usa #ef4444.
7. "radio_pequeno": el radio de borde más pequeño visible (en px). Ej: "12px".
8. "radio_medio": el radio medio. Ej: "20px".
9. "radio_grande": el radio más grande (botones grandes, paneles). Ej: "35px".
10. "fuente_ui": el nombre de la fuente que más se parece a la de la UI. Elige UNA de: Inter, Roboto, Montserrat, Nunito, Poppins.
11. "fuente_ticket": siempre "ui-monospace".

Además:
12. "sombras": "suaves" | "pronunciadas" | "sin sombras"
13. "bordes": "con bordes" | "sin bordes visibles" | "bordes sutiles"
14. "densidad": "compacta" | "cómoda" | "espaciosa"
15. "iconos": "línea" | "sólido" | "mixto"
16. "adjetivos": 3 adjetivos que describan la sensación visual, en español.

Para cada color (1-6), incluye un campo "confianza" (0-100) indicando qué tan seguro estás del valor.

Responde con este formato JSON exacto:
{
  "tokens": {
    "acento": {"hex": "#...", "confianza": 85},
    "fondo_profundo": {"hex": "#...", "confianza": 90},
    "fondo_profundo_alt": {"hex": "#...", "confianza": 70},
    "fondo_panel": {"hex": "#...", "confianza": 80},
    "crema_ticket": {"hex": "#...", "confianza": 90},
    "peligro": {"hex": "#...", "confianza": 60}
  },
  "forma": {
    "radio_pequeno": "..px",
    "radio_medio": "..px",
    "radio_grande": "..px"
  },
  "tipografia": {
    "fuente_ui": "...",
    "fuente_ticket": "ui-monospace"
  },
  "extras": {
    "sombras": "...",
    "bordes": "...",
    "densidad": "...",
    "iconos": "...",
    "adjetivos": ["...", "...", "..."]
  }
}"""


# ---------------------------------------------------------------------------
# Utilidades de conversión (espejo del theme-engine en Python)
# ---------------------------------------------------------------------------
def hex_a_canales_rgb(hex_color: str) -> str:
    """Convierte #RRGGBB a 'R G B'. Ej: '#c1d72e' → '193 215 46'."""
    limpio = hex_color.lstrip("#")
    if len(limpio) == 3:
        limpio = limpio[0] * 2 + limpio[1] * 2 + limpio[2] * 2
    if len(limpio) == 8:
        limpio = limpio[:6]
    r, g, b = int(limpio[0:2], 16), int(limpio[2:4], 16), int(limpio[4:6], 16)
    return f"{r} {g} {b}"


def luminancia_relativa(canales: str) -> float:
    """Luminancia relativa WCAG 2.1."""
    r, g, b = [int(x) for x in canales.split()]

    def lin(c: int) -> float:
        s = c / 255
        return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4

    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def ratio_contraste(a: str, b: str) -> float:
    """Ratio de contraste entre dos colores (canales RGB)."""
    la, lb = luminancia_relativa(a), luminancia_relativa(b)
    claro, oscuro = max(la, lb), min(la, lb)
    return (claro + 0.05) / (oscuro + 0.05)


def validar_contraste_tema(tokens: dict) -> dict:
    """Valida los 5 pares de contraste WCAG AA."""
    resultados = []
    problemas = []

    pares = [
        ("texto/fondo-profundo", tokens["crema_ticket"], tokens["fondo_profundo"], 4.5),
        ("texto/fondo-panel", tokens["crema_ticket"], tokens["fondo_panel"], 4.5),
        ("acento/fondo-profundo", tokens["acento"], tokens["fondo_profundo"], 3.0),
        ("acento/fondo-panel", tokens["acento"], tokens["fondo_panel"], 3.0),
        ("peligro/acento", tokens["peligro"], tokens["acento"], 1.5),
    ]

    for nombre, color_a, color_b, minimo in pares:
        ratio = ratio_contraste(color_a, color_b)
        pasa = ratio >= minimo
        resultados.append({"par": nombre, "ratio": round(ratio, 2), "minimo": minimo, "pasa": pasa})
        if not pasa:
            problemas.append(f"{nombre}: {ratio:.2f}:1 (mínimo {minimo}:1)")

    return {"valido": len(problemas) == 0, "resultados": resultados, "problemas": problemas}


def mapear_fuente(sugerida: str) -> dict:
    """Mapea la fuente sugerida al catálogo cerrado (EX-02)."""
    if not sugerida:
        return {"nombre": "Inter", "confianza": 0}

    normalizada = sugerida.lower().strip()

    for f in CATALOGO_FUENTES:
        if f.lower() == normalizada:
            return {"nombre": f, "confianza": 100}

    for f in CATALOGO_FUENTES:
        if normalizada in f.lower() or f.lower() in normalizada:
            return {"nombre": f, "confianza": 80}

    return {"nombre": "Inter", "confianza": 0}
