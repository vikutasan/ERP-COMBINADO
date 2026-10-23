"""A-04 — Outbox transaccional — FASE 4 (Guardianes).

Fuente autoritativa: `PLAN_DE_CONSTRUCCION_DEL_NUEVO_POS.md` §6.2 (A-04) y §6.3.

El problema que resuelve: en el POS viejo, el descuento de stock se hacía con
`try/except pass` — si fallaba, se silenciaba y el ticket quedaba guardado sin
descontar. Eso es una **pérdida silenciosa de datos**.

La solución (patrón Outbox): el evento de inventario **vive en la MISMA
transacción** que el guardado del ticket. O se guardan los dos, o no se guarda
ninguno. No hay estado intermedio, no hay silencio.

Reglas que protege:
  - RN-63: el evento se emite ANTES del commit, en la misma transacción.
  - RN-66: la idempotencia se garantiza por `(evento_id, item_id)`.
  - E-05:  0 `try/except pass` en la ruta crítica.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID, uuid4


class SinSilenciosEnRutaCritica(Exception):
    """Se lanza si se intenta silenciar una excepción en la ruta crítica (E-05)."""

    def __init__(self, operacion: str) -> None:
        super().__init__(
            f"[E-05] La operación crítica '{operacion}' no puede silenciar excepciones"
        )
        self.operacion = operacion


@dataclass(frozen=True)
class EventoOutbox:
    """Un evento de inventario que vive en la misma transacción del ticket.

    `evento_id` es la clave de idempotencia (RN-66): si el mismo evento se
    intenta aplicar dos veces, la segunda es un no-op.
    """

    evento_id: UUID
    ticket_id: UUID
    tipo: str
    items: tuple[dict[str, Any], ...] = field(default_factory=tuple)

    @classmethod
    def nuevo(cls, ticket_id: UUID, tipo: str, items: list[dict[str, Any]]) -> "EventoOutbox":
        """Crea un evento nuevo con un `evento_id` fresco."""
        return cls(evento_id=uuid4(), ticket_id=ticket_id, tipo=tipo, items=tuple(items))


class OutboxTransaccional:
    """Un outbox en memoria que modela la transacción del guardado del ticket.

    La transacción es atómica: `guardar_ticket` y `emitir_evento` ocurren dentro
    del mismo `with`. Si algo falla, NADA se persiste (rollback total). Nunca se
    silencia una excepción.
    """

    def __init__(self) -> None:
        self._tickets: dict[UUID, dict[str, Any]] = {}
        self._eventos: list[EventoOutbox] = []
        self._aplicados: set[tuple[UUID, str]] = set()
        self._en_transaccion = False
        self._pendientes: list[tuple[str, Any]] = []

    # ── Ciclo de transacción ────────────────────────────────────────────────

    def __enter__(self) -> "OutboxTransaccional":
        self._en_transaccion = True
        self._pendientes = []
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        """Cierra la transacción. Si hubo excepción, hace rollback total.

        Devuelve False para PROPAGAR la excepción: nunca se silencia (E-05).
        """
        if exc_type is not None:
            # Rollback total: nada de lo pendiente se persiste.
            self._pendientes = []
            self._en_transaccion = False
            return False  # ← propaga; NO silencia
        # Commit: aplica lo pendiente de forma atómica.
        for tipo, payload in self._pendientes:
            if tipo == "ticket":
                self._tickets[payload["id"]] = payload
            elif tipo == "evento":
                self._eventos.append(payload)
        self._pendientes = []
        self._en_transaccion = False
        return False

    # ── Operaciones de la ruta crítica ──────────────────────────────────────

    def guardar_ticket(self, ticket: dict[str, Any]) -> None:
        """Guarda el ticket dentro de la transacción (pendiente hasta el commit)."""
        if not self._en_transaccion:
            raise RuntimeError("guardar_ticket debe ocurrir dentro de una transacción")
        self._pendientes.append(("ticket", ticket))

    def emitir_evento(self, evento: EventoOutbox) -> None:
        """Emite el evento de inventario en la MISMA transacción (RN-63)."""
        if not self._en_transaccion:
            raise RuntimeError("emitir_evento debe ocurrir dentro de una transacción")
        self._pendientes.append(("evento", evento))

    def aplicar_evento(self, evento: EventoOutbox) -> bool:
        """Aplica el evento con idempotencia por `(evento_id, item_id)` (RN-66).

        Devuelve True si aplicó, False si ya estaba aplicado (no-op).
        """
        aplicado = False
        for item in evento.items:
            clave = (evento.evento_id, str(item.get("item_id")))
            if clave in self._aplicados:
                continue  # idempotente: ya aplicado
            self._aplicados.add(clave)
            aplicado = True
        return aplicado

    # ── Consultas (para los tests) ──────────────────────────────────────────

    @property
    def tickets(self) -> dict[UUID, dict[str, Any]]:
        return dict(self._tickets)

    @property
    def eventos(self) -> tuple[EventoOutbox, ...]:
        return tuple(self._eventos)

    def evento_aplicado(self, evento_id: UUID, item_id: str) -> bool:
        return (evento_id, item_id) in self._aplicados
