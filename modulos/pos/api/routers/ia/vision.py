"""Endpoints del extractor de estética visual (FS2-05).

  POST /ia/extraer-estetica   → extraer_estetica
  POST /ia/guardar-tema       → guardar_tema
  GET  /ia/temas-generados    → listar_temas_generados
"""

from __future__ import annotations

import base64
import json
import os
import re
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from .deps import (
    AI_HABILITADA,
    AI_LOCAL_MODELO,
    AI_LOCAL_TIMEOUT,
    AI_LOCAL_URL,
    CATALOGO_FUENTES,
    MODULOS_CONOCIDOS,
    PROMPT_EXTRACCION,
    hex_a_canales_rgb,
    mapear_fuente,
    validar_contraste_tema,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Modelos de respuesta
# ---------------------------------------------------------------------------
class TokenExtraido(BaseModel):
    valor: str   # canales RGB: "193 215 46"
    hex: str     # "#c1d72e"
    confianza: int  # 0-100


class ContrasteResultado(BaseModel):
    par: str
    ratio: float
    minimo: float
    pasa: bool


class ExtraccionRespuesta(BaseModel):
    tokens: dict[str, TokenExtraido]
    forma: dict[str, str]
    tipografia: dict[str, dict]
    contraste: dict
    extras: dict
    advertencias: list[dict]


class GuardarTemaRequest(BaseModel):
    nombre: str
    modulo_destino: str
    tokens: dict[str, str]  # canales RGB
    forma: Optional[dict] = None
    tipografia: Optional[dict] = None
    extras: Optional[dict] = None
    asignado_como: Optional[str] = None  # "default" | "opcion_1" | "opcion_2" | null


# ---------------------------------------------------------------------------
# Almacén en memoria (temporal hasta que la tabla temas_generados exista)
# ---------------------------------------------------------------------------
_temas_generados: list[dict] = []


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/extraer-estetica", response_model=ExtraccionRespuesta)
async def extraer_estetica(
    imagen: UploadFile = File(..., description="Imagen JPG/PNG de referencia (≤5 MB)"),
    modulo_destino: str = Form(..., description="Módulo destino: pos, estadisticas, etc."),
):
    """Extrae los 11 tokens de estética visual de una imagen usando IA.

    Reglas del extractor (EX-01 a EX-05):
    - EX-01: La IA da dirección, no valores exactos.
    - EX-02: Las tipografías se mapean al catálogo cerrado.
    - EX-04: Ningún tema se aplica sin pasar validarContraste().
    - EX-05: Requiere AI_HABILITADA = true.
    """
    if not AI_HABILITADA:
        raise HTTPException(
            status_code=503,
            detail="La IA no está habilitada. Configure AI_HABILITADA=true.",
        )

    if modulo_destino not in MODULOS_CONOCIDOS:
        raise HTTPException(
            status_code=400,
            detail=f"Módulo '{modulo_destino}' no reconocido. Opciones: {MODULOS_CONOCIDOS}",
        )

    contenido = await imagen.read()
    if len(contenido) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="La imagen excede 5 MB.")

    if not imagen.content_type or not imagen.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="El archivo debe ser una imagen (JPG/PNG).")

    imagen_b64 = base64.b64encode(contenido).decode("utf-8")

    try:
        resultado_ia = await _llamar_ia_vision(imagen_b64, imagen.content_type)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Error al comunicarse con la IA: {str(e)}")

    advertencias = []
    tokens_rgb = {}
    for nombre_token in ["acento", "fondo_profundo", "fondo_profundo_alt", "fondo_panel", "crema_ticket", "peligro"]:
        info = resultado_ia.get("tokens", {}).get(nombre_token, {})
        hex_val = info.get("hex", "#888888")
        confianza = info.get("confianza", 50)

        canales = hex_a_canales_rgb(hex_val)
        tokens_rgb[nombre_token] = TokenExtraido(valor=canales, hex=hex_val, confianza=confianza)

        if confianza < 70:
            advertencias.append({
                "campo": nombre_token,
                "tipo": "baja_confianza",
                "mensaje": f"Confianza {confianza}%. El valor {hex_val} es aproximado.",
            })

    tokens_para_contraste = {k: v.valor for k, v in tokens_rgb.items()}
    contraste_resultado = validar_contraste_tema(tokens_para_contraste)

    fuente_sugerida = resultado_ia.get("tipografia", {}).get("fuente_ui", "Inter")
    fuente_mapeada = mapear_fuente(fuente_sugerida)

    if fuente_mapeada["confianza"] < 100:
        advertencias.append({
            "campo": "fuente_ui",
            "tipo": "aproximacion",
            "mensaje": f"No se puede confirmar la fuente desde una imagen. Se sugiere {fuente_mapeada['nombre']}.",
        })

    return ExtraccionRespuesta(
        tokens=tokens_rgb,
        forma=resultado_ia.get("forma", {"radio_pequeno": "20px", "radio_medio": "28px", "radio_grande": "36px"}),
        tipografia={
            "fuente_ui": {"sugerida": fuente_mapeada["nombre"], "confianza": fuente_mapeada["confianza"], "catalogo": CATALOGO_FUENTES},
            "fuente_ticket": {"sugerida": "ui-monospace", "confianza": 100, "catalogo": ["ui-monospace"]},
        },
        contraste=contraste_resultado,
        extras=resultado_ia.get("extras", {
            "sombras": "suaves", "bordes": "sin bordes visibles",
            "densidad": "cómoda", "iconos": "línea",
            "adjetivos": ["moderno", "limpio", "profesional"],
        }),
        advertencias=advertencias,
    )


@router.post("/guardar-tema")
async def guardar_tema(req: GuardarTemaRequest):
    """Guarda un tema extraído por IA y opcionalmente lo asigna a un módulo.

    Regla EX-03: el módulo sigue ofreciendo máximo 3 temas.
    El extractor permite crear; el admin elige cuáles 3 asignar.
    """
    if req.modulo_destino not in MODULOS_CONOCIDOS:
        raise HTTPException(status_code=400, detail=f"Módulo '{req.modulo_destino}' no reconocido.")

    if req.asignado_como and req.asignado_como not in ("default", "opcion_1", "opcion_2"):
        raise HTTPException(status_code=400, detail="asignado_como debe ser 'default', 'opcion_1', 'opcion_2' o null.")

    contraste = validar_contraste_tema(req.tokens)
    if not contraste["valido"]:
        raise HTTPException(status_code=400, detail=f"El tema no pasa contraste WCAG AA: {'; '.join(contraste['problemas'])}")

    tema = {
        "id": len(_temas_generados) + 1,
        "nombre": req.nombre,
        "modulo_destino": req.modulo_destino,
        "tokens": req.tokens,
        "forma": req.forma,
        "tipografia": req.tipografia,
        "extras": req.extras,
        "asignado_como": req.asignado_como,
        "contraste": contraste,
    }
    _temas_generados.append(tema)
    return {"mensaje": f"Tema '{req.nombre}' guardado.", "tema": tema}


@router.get("/temas-generados")
async def listar_temas_generados(modulo: Optional[str] = None):
    """Lista los temas generados por el extractor."""
    if modulo:
        return [t for t in _temas_generados if t["modulo_destino"] == modulo]
    return _temas_generados


# ---------------------------------------------------------------------------
# Funciones internas
# ---------------------------------------------------------------------------
async def _llamar_ia_vision(imagen_b64: str, content_type: str) -> dict:
    """Llama al motor de IA (local/nube) con el prompt de extracción.

    Soporta:
    - Ollama (local): POST /api/generate con modelo llava
    - OpenAI-compatible: POST /v1/chat/completions con visión
    """
    import httpx

    try:
        async with httpx.AsyncClient(timeout=AI_LOCAL_TIMEOUT) as client:
            response = await client.post(
                f"{AI_LOCAL_URL}/api/generate",
                json={"model": AI_LOCAL_MODELO, "prompt": PROMPT_EXTRACCION,
                      "images": [imagen_b64], "stream": False, "format": "json"},
            )
            response.raise_for_status()
            return _parsear_json_ia(response.json().get("response", "{}"))
    except httpx.ConnectError:
        pass
    except Exception:
        pass

    api_key = os.getenv("AI_API_KEY", "")
    api_url = os.getenv("AI_API_URL", f"{AI_LOCAL_URL}/v1/chat/completions")

    async with httpx.AsyncClient(timeout=AI_LOCAL_TIMEOUT) as client:
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        response = await client.post(
            api_url, headers=headers,
            json={"model": AI_LOCAL_MODELO, "messages": [{"role": "user", "content": [
                {"type": "text", "text": PROMPT_EXTRACCION},
                {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{imagen_b64}"}},
            ]}], "max_tokens": 2000},
        )
        response.raise_for_status()
        return _parsear_json_ia(response.json()["choices"][0]["message"]["content"])


def _parsear_json_ia(texto: str) -> dict:
    """Extrae JSON de la respuesta de la IA (que puede incluir texto extra)."""
    match = re.search(r"\{[\s\S]*\}", texto)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {
        "tokens": {
            "acento": {"hex": "#c1d72e", "confianza": 50},
            "fondo_profundo": {"hex": "#0a0a0a", "confianza": 50},
            "fondo_profundo_alt": {"hex": "#080808", "confianza": 50},
            "fondo_panel": {"hex": "#1a1a1a", "confianza": 50},
            "crema_ticket": {"hex": "#fdfbf7", "confianza": 50},
            "peligro": {"hex": "#ef4444", "confianza": 50},
        },
        "forma": {"radio_pequeno": "20px", "radio_medio": "28px", "radio_grande": "36px"},
        "tipografia": {"fuente_ui": "Inter", "fuente_ticket": "ui-monospace"},
        "extras": {"sombras": "suaves", "bordes": "sin bordes visibles",
                   "densidad": "cómoda", "iconos": "línea",
                   "adjetivos": ["moderno", "limpio", "profesional"]},
    }
