"""Esquemas del POS — Contratos 3, 5, 18–22, 31 (FASE 3 + 7.5.0) (FD-03)."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Sesión de terminal — Contrato 9: GET /pos/session-active
# ---------------------------------------------------------------------------

class SesionActiva(BaseModel):
    """La sesión de terminal abierta, o `null` si no hay ninguna (RN-01)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    terminal_id: str
    is_active: bool


class SesionTerminalEntrada(BaseModel):
    """Entrada de `POST /pos/sessions` — abrir (o reutilizar) la sesión.

    Paridad con el viejo POS: al seleccionar una terminal se abre su sesión.
    El endpoint es idempotente, así que basta con el `terminal_id`.
    """

    terminal_id: str = Field(min_length=1, description="Id de la terminal (ej. TERM-04)")


# ---------------------------------------------------------------------------
# Tickets — Contrato 3: POST /pos/tickets
# ---------------------------------------------------------------------------

class LineaEntrada(BaseModel):
    """Una línea del carrito tal como la envía el frontend.

    Solo `product_id` y `quantity`: el `unit_price` y el `subtotal` los resuelve
    el servidor contra el catálogo (RN-18, RN-19). El cliente no dicta precios.
    """

    product_id: UUID
    quantity: int = Field(ge=1, description="Entero positivo (RN-20)")


class CrearTicketEntrada(BaseModel):
    """Entrada del contrato 3: crear un ticket OPEN con sus líneas.

    FASE 7.5.0 — El ticket puede nacer como PEDIDO PROGRAMADO. Los 9 campos
    de programación son OPCIONALES: si no vienen, el ticket es una venta
    directa de mostrador.

    F12.9.1 — `items` puede venir VACÍO: el ticket nace sin líneas y se llena
    después por el contrato atómico 18. Este es el flujo REAL del POS.
    """

    terminal_id: str
    channel: str = "PANADERIA"
    items: list[LineaEntrada] = Field(default_factory=list)

    order_type: str = "VENTA_DIRECTA"
    order_status: str | None = None
    delivery_type: str | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    committed_at: datetime | None = None
    packaging_type: str | None = None
    delivery_address: str | None = None
    order_notes: str | None = None

    # F12.6 — Trazabilidad: nombre del capturista (foto histórica, patrón F10.5).
    capturista_nombre: str | None = None


class LineaSalida(BaseModel):
    """Una línea persistida del ticket."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    # `item_id` es el ID de idempotencia generado por el cliente (contrato 18).
    # Se expone en LineaSalida para que el frontend pueda sincronizar su
    # carrito local tras un PATCH /order (fix desync 'items_no_persistidos').
    item_id: str
    product_id: UUID
    quantity: int
    unit_price: Decimal
    subtotal: Decimal
    # Nombre congelado al momento de la venta — para el ticket impreso.
    name: str | None = None


class TicketSalida(BaseModel):
    """Salida del contrato 3 y del contrato 5: el ticket persistido.

    `account_num` es el folio (presentación, RN-10); `id` es la identidad
    (RN-09). `version` viaja para concurrencia optimista (RN-15, RN-25).

    F12.21 — Los campos `order_*` viajan para que el ticket impreso al cobrar
    pueda decidir la doble copia de un PEDIDO.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_num: str
    status: str
    total: Decimal
    version: int
    terminal_id: str | None = None
    channel: str
    items: list[LineaSalida] = Field(default_factory=list)
    payment_details: dict[str, Any] | None = None
    order_type: str = "VENTA_DIRECTA"
    delivery_type: str | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    committed_at: datetime | None = None
    packaging_type: str | None = None
    delivery_address: str | None = None
    order_notes: str | None = None
    # F12.6 — Trazabilidad: quién capturó y quién cobró (para el ticket impreso).
    captured_by_name: str | None = None
    cashed_by_name: str | None = None
    # Fecha de creación para imprimir la hora correcta en el ticket.
    created_at: datetime | None = None


# ---------------------------------------------------------------------------
# Cobro — Contrato 5: POST /pos/tickets/{id}/pay
# ---------------------------------------------------------------------------

class CobrarTicketEntrada(BaseModel):
    """Entrada del contrato 5: cobrar un ticket.

    `payment_details` es libre (JSONB) pero tiene una FORMA CANÓNICA desde
    FASE 9.1 (pagos mixtos). La suma de `monto` debe cuadrar EXACTAMENTE el
    total del ticket (RN-94) y cada `metodo` debe ser válido (RN-95).

    BUG-08 — `cash_session_id` opcional: la terminal que COBRA puede ser
    distinta a la de origen del ticket.
    """

    payment_details: dict[str, Any] = Field(default_factory=dict)
    version: int = Field(ge=0, description="Version esperado (RN-25)")
    cobrador_nombre: str | None = None
    cash_session_id: UUID | None = None


# ---------------------------------------------------------------------------
# POS atómico — Contratos 18–22 (FASE 3.2)
# ---------------------------------------------------------------------------

class LineaAtomicaSalida(BaseModel):
    """Una línea del ticket en la proyección atómica.

    `item_id` es la clave de idempotencia. El `unit_price` viene congelado
    (RN-18); el `subtotal` es unit_price × quantity (RN-19).
    """

    model_config = ConfigDict(from_attributes=True)

    item_id: str
    product_id: UUID
    quantity: int
    unit_price: Decimal
    subtotal: Decimal


class TicketAtomicoSalida(BaseModel):
    """Salida común de los contratos 18, 19 y 20.

    Devuelve la proyección de las líneas y el `version` nuevo para encadenar
    la siguiente escritura con concurrencia optimista (RN-25/RN-27).
    """

    ticket_id: UUID
    item_id: str
    version: int
    total: Decimal
    lineas: list[LineaAtomicaSalida] = Field(default_factory=list)


class AnadirItemEntrada(BaseModel):
    """Entrada del contrato 18: añadir (o incrementar) un ítem.

    `item_id` es la clave de IDEMPOTENCIA: repetir el POST con el mismo
    `item_id` deja el ticket en el MISMO estado (no duplica la línea).
    """

    item_id: str = Field(min_length=1, description="Clave de idempotencia")
    product_id: UUID
    quantity: int = Field(ge=1, description="Entero positivo (RN-20)")
    version: int = Field(ge=0, description="Version esperado (RN-25)")


class CambiarCantidadEntrada(BaseModel):
    """Entrada del contrato 19: cambiar la cantidad de una línea."""

    quantity: int = Field(ge=1, description="Entero positivo (RN-20)")
    version: int = Field(ge=0, description="Version esperado (RN-25)")


class QuitarItemEntrada(BaseModel):
    """Entrada del contrato 20: quitar una línea del ticket."""

    version: int = Field(ge=0, description="Version esperado (RN-25)")


class ActualizarPedidoEntrada(BaseModel):
    """Entrada del contrato 31: actualizar la programación de un ticket YA creado.

    Todos los campos son OPCIONALES: solo se aplican los que vienen con valor
    (semántica PATCH). `version` es obligatorio (RN-25).
    """

    version: int = Field(ge=0, description="Version esperado (RN-25)")
    order_type: str | None = None
    order_status: str | None = None
    delivery_type: str | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    committed_at: datetime | None = None
    packaging_type: str | None = None
    delivery_address: str | None = None
    order_notes: str | None = None


class TicketLigeroSalida(BaseModel):
    """Salida del contrato 21: EXACTAMENTE 5 campos escalares (Regla 15).

    NO incluye las líneas: leer las líneas es responsabilidad de otro contrato.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_num: str
    status: str
    total: Decimal
    version: int


class LineasTicketSalida(BaseModel):
    """Salida del contrato 30: las líneas de un ticket (FASE 12.10)."""

    ticket_id: UUID
    version: int
    total: Decimal
    lineas: list[LineaAtomicaSalida] = Field(default_factory=list)


class VerificarEnvioEntrada(BaseModel):
    """Entrada del contrato 22: verificar que el ticket y sus ítems existen.

    BUG-07 — `cantidades` (opcional): la cantidad de UNIDADES de cada línea,
    en el MISMO orden que `item_ids`. Evita el falso déficit por fusión RN-17.
    """

    item_ids: list[str] = Field(default_factory=list)
    cantidades: list[int] = Field(default_factory=list)


class VerificarEnvioSalida(BaseModel):
    """Salida del contrato 22: verificación post-envío (v6.1 $453)."""

    existe: bool
    item_ids_persistidos: list[str] = Field(default_factory=list)
    faltantes: list[str] = Field(default_factory=list)
