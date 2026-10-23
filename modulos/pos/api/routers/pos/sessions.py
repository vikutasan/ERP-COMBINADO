"""Contratos 9 y POST /sessions — Sesiones de terminal — FD-04."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models import TerminalSession
from rules import ReglaViolada
from schemas import SesionActiva, SesionTerminalEntrada

from .deps import _sesion_activa_o_404

router = APIRouter()


@router.post("/sessions", response_model=SesionActiva, status_code=201)
async def abrir_sesion(
    entrada: SesionTerminalEntrada,
    db: AsyncSession = Depends(get_db),
) -> TerminalSession:
    """Abre (o reutiliza) la sesión de terminal — paridad con el viejo POS.

    El viejo POS crea la `TerminalSession` al seleccionar la terminal
    (`POST /pos/sessions`). Este endpoint es IDEMPOTENTE: si la terminal ya
    tiene una sesión activa, la devuelve tal cual; si no, crea una nueva.
    """
    terminal_id = entrada.terminal_id.strip()
    if not terminal_id:
        raise ReglaViolada("RN-24", "El terminal_id es obligatorio", 400)

    existente = (
        await db.execute(
            select(TerminalSession).where(
                TerminalSession.terminal_id == terminal_id,
                TerminalSession.is_active.is_(True),
            )
        )
    ).scalars().first()
    if existente is not None:
        return existente

    sesion = TerminalSession(terminal_id=terminal_id, is_active=True)
    db.add(sesion)
    await db.commit()
    await db.refresh(sesion)
    return sesion


@router.get("/session-active", response_model=SesionActiva | None)
async def session_active(
    terminal_id: str = Query(..., description="Identificador de la terminal"),
    db: AsyncSession = Depends(get_db),
) -> SesionActiva | None:
    """Devuelve la sesión abierta de la terminal, o `null` si no hay ninguna."""
    sesion = (
        await db.execute(
            select(TerminalSession).where(
                TerminalSession.terminal_id == terminal_id,
                TerminalSession.is_active.is_(True),
            )
        )
    ).scalars().first()

    if sesion is None:
        return None
    return SesionActiva.model_validate(sesion)
