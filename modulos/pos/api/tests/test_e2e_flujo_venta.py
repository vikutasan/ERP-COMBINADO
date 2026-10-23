"""Puerta R4 / Peldaño 2 — El FLUJO COMPLETO DE VENTA contra la API real.

Cierra el riesgo R4 del `PLAN_DE_CIERRE_DE_RIESGOS_ESTRUCTURALES.md`: hasta
ahora cada contrato tenía su puerta aislada, pero NINGUNA puerta ejercitaba la
SECUENCIA COMPLETA que el POS ejecuta de verdad. Un contrato puede pasar su
test y aun así romperse al encadenarse con los demás (frontera entre puertas).

Este test es el hermano de API del `RetailVisionPOS.e2e.test.jsx` (Peldaño 1):
mismo flujo, misma secuencia, distinto nivel. Si el frontend y la API divergen
en la forma del flujo, uno de los dos peldaños se pone rojo.

FLUJO QUE SE EJERCITA (idéntico al del POS real)
────────────────────────────────────────────────
  1. Crear ticket VACÍO            → contrato 29  (POST /pos/tickets)
  2. Añadir producto A (qty 1)     → contrato 18  (POST /pos/tickets/{id}/items)
  3. Añadir producto A OTRA VEZ    → contrato 18  → FUSIÓN RN-17 (1 línea, qty 2)
  4. Añadir producto B (qty 1)     → contrato 18  → 2 líneas distintas
  5. Cobrar el ticket              → contrato 5   (POST /pos/tickets/{id}/pay)
  6. Verificar estado PAID + total → la venta quedó cerrada y cuadrada

La evidencia es la RESPUESTA HTTP real contra la app FastAPI montada sobre
PostgreSQL, no la intención. Se siembran DOS productos, una sesión de terminal
y un turno de caja abierto (RN-49: sin turno no se cobra), se recorre la
secuencia completa y se limpia al terminar.

Aislamiento de event loop: cada test crea su PROPIO engine async (ligado al
loop de ese test) y sobreescribe la dependencia `get_db` de FastAPI. Así se
evita el error "Future attached to a different loop".

Reglas que este test ancla:
  * RN-17 — un producto aparece UNA sola vez; volver a tocarlo incrementa la
    cantidad (fusión por `product_id`). El criterio 1 lo afirma.
  * RN-94 — la suma de los pagos cuadra EXACTAMENTE el total del ticket.
  * RN-49 — el cobro exige un turno de caja abierto.
  * RN-31 — una cuenta PAID ya NO se lista en el pizarrón.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.database import DATABASE_URL, get_db
from main import app
from models import CashSession, Product, TerminalSession, Ticket, TicketItem

TERMINAL_ID = "TEST-E2E-VENTA"

# Precios sembrados: A = 15.00, B = 20.00. El total esperado del flujo es
# (2 × 15.00) + (1 × 20.00) = 50.00, resuelto SIEMPRE por el servidor.
PRECIO_A = Decimal("15.00")
PRECIO_B = Decimal("20.00")
TOTAL_ESPERADO = Decimal("50.00")


# ---------------------------------------------------------------------------
# Aislamiento por test: engine propio ligado al loop del test
# ---------------------------------------------------------------------------

class _Entorno:
    """Engine + fábrica de sesiones ligados al loop del test en curso."""

    def __init__(self) -> None:
        self.engine = create_async_engine(DATABASE_URL, pool_pre_ping=True, future=True)
        self.Session = async_sessionmaker(
            bind=self.engine, class_=AsyncSession, expire_on_commit=False
        )

    async def cerrar(self) -> None:
        await self.engine.dispose()


@pytest.fixture
async def entorno():
    """Engine por test + override de `get_db` para que la app use ese engine."""
    ent = _Entorno()

    async def _get_db_override() -> AsyncSession:
        async with ent.Session() as session:
            yield session

    app.dependency_overrides[get_db] = _get_db_override
    try:
        yield ent
    finally:
        app.dependency_overrides.pop(get_db, None)
        await ent.cerrar()


# ---------------------------------------------------------------------------
# Utilidades de siembra y limpieza (usan el engine del test)
# ---------------------------------------------------------------------------

async def _limpiar(ent: _Entorno) -> None:
    """Borra los datos de prueba (tickets, ítems, turno, sesión y productos)."""
    async with ent.Session() as db:
        await db.execute(
            delete(TicketItem).where(
                TicketItem.ticket_id.in_(select(Ticket.id).where(Ticket.terminal_id == TERMINAL_ID))
            )
        )
        await db.execute(delete(Ticket).where(Ticket.terminal_id == TERMINAL_ID))
        await db.execute(
            delete(CashSession).where(CashSession.terminal_id == TERMINAL_ID)
        )
        await db.execute(
            delete(TerminalSession).where(TerminalSession.terminal_id == TERMINAL_ID)
        )
        await db.execute(delete(Product).where(Product.sku.like("TEST-E2E-VENTA-%")))
        await db.commit()


async def _sembrar(ent: _Entorno) -> tuple[uuid.UUID, uuid.UUID]:
    """Crea sesión de terminal, turno de caja OPEN y DOS productos.

    Devuelve los ids de los dos productos. El turno de caja es OBLIGATORIO
    para poder cobrar (RN-49): sin él, el contrato 5 responde 400.
    """
    async with ent.Session() as db:
        sesion = TerminalSession(terminal_id=TERMINAL_ID, is_active=True)
        turno = CashSession(
            terminal_id=TERMINAL_ID,
            employee_id=uuid.uuid4(),
            employee_name="Cajero E2E",
            opening_float=Decimal("0.00"),
            status="OPEN",
        )
        producto_a = Product(
            sku=f"TEST-E2E-VENTA-A-{uuid.uuid4().hex[:8]}",
            name="Producto E2E A",
            price=PRECIO_A,
            cost=Decimal("6.00"),
            active=True,
        )
        producto_b = Product(
            sku=f"TEST-E2E-VENTA-B-{uuid.uuid4().hex[:8]}",
            name="Producto E2E B",
            price=PRECIO_B,
            cost=Decimal("8.00"),
            active=True,
        )
        db.add_all([sesion, turno, producto_a, producto_b])
        await db.commit()
        return producto_a.id, producto_b.id


def _cliente() -> httpx.AsyncClient:
    """Cliente HTTP async contra la app ASGI (sin red real)."""
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def _crear_ticket_vacio(cliente: httpx.AsyncClient) -> httpx.Response:
    """Crea un ticket SIN LÍNEAS vía el contrato 29 (el flujo real del POS)."""
    return await cliente.post(
        "/pos/tickets",
        json={
            "terminal_id": TERMINAL_ID,
            "channel": "PANADERIA",
            "items": [],
        },
    )


async def _anadir_item(
    cliente: httpx.AsyncClient,
    ticket_id: str,
    product_id: uuid.UUID,
    item_id: str,
    quantity: int,
    version: int,
) -> httpx.Response:
    """Añade una línea vía el contrato 18 (cuerpo EXACTO que manda el POS).

    El frontend NO manda `unit_price`: el servidor lo resuelve desde el catálogo
    por `product_id`. Este helper replica ese cuerpo para que la puerta detecte
    cualquier regresión que reintroduzca el precio en el cliente.
    """
    return await cliente.post(
        f"/pos/tickets/{ticket_id}/items",
        json={
            "product_id": str(product_id),
            "quantity": quantity,
            "item_id": item_id,
            "version": version,
        },
    )


# ---------------------------------------------------------------------------
# Criterio 1 — El flujo completo de venta deja el ticket PAID y cuadrado
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_flujo_completo_de_venta(entorno):
    """Crear vacío → añadir → fusionar → añadir otro → cobrar → PAID.

    Es el camino feliz de una venta de mostrador, de punta a punta, contra la
    API real. Si CUALQUIER eslabón de la cadena se rompe, este test cae.
    """
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        product_a, product_b = await _sembrar(ent)
        async with _cliente() as cliente:
            # --- Paso 1: el ticket nace VACÍO (contrato 29) -----------------
            creado = await _crear_ticket_vacio(cliente)
            assert creado.status_code == 201, creado.text
            ticket = creado.json()
            ticket_id = ticket["id"]
            assert ticket["status"] == "OPEN", ticket
            assert Decimal(str(ticket["total"])) == Decimal("0.00"), ticket

            # --- Paso 2: entra el producto A (qty 1) ------------------------
            item_a = str(uuid.uuid4())
            r2 = await _anadir_item(cliente, ticket_id, product_a, item_a, 1, 0)
            assert r2.status_code in (200, 201), r2.text
            c2 = r2.json()
            assert len(c2["lineas"]) == 1, c2
            assert Decimal(str(c2["total"])) == PRECIO_A, c2

            # --- Paso 3: se toca A OTRA VEZ → FUSIÓN RN-17 ------------------
            # El POS manda un `item_id` NUEVO (nueva intención) pero el MISMO
            # `product_id`: la fusión RN-17 incrementa la cantidad a 2 y NO
            # aparece una 2ª línea. (Reenviar el MISMO `item_id` sería el NO-OP
            # de idempotencia del contrato 18, que NO es lo que aquí se prueba.)
            item_a2 = str(uuid.uuid4())
            r3 = await _anadir_item(cliente, ticket_id, product_a, item_a2, 1, c2["version"])
            assert r3.status_code in (200, 201), r3.text
            c3 = r3.json()
            assert len(c3["lineas"]) == 1, (
                "RN-17 ROTA: tocar el mismo producto creó una 2ª línea en vez de "
                f"fusionar. Líneas: {c3['lineas']}"
            )
            assert c3["lineas"][0]["quantity"] == 2, c3
            assert Decimal(str(c3["total"])) == PRECIO_A * 2, c3

            # --- Paso 4: entra el producto B (qty 1) → 2ª línea -------------
            item_b = str(uuid.uuid4())
            r4 = await _anadir_item(cliente, ticket_id, product_b, item_b, 1, c3["version"])
            assert r4.status_code in (200, 201), r4.text
            c4 = r4.json()
            assert len(c4["lineas"]) == 2, c4
            assert Decimal(str(c4["total"])) == TOTAL_ESPERADO, c4

            # --- Paso 5: se cobra el ticket (contrato 5) --------------------
            # RN-94: la suma de los pagos debe cuadrar EXACTAMENTE el total.
            r5 = await cliente.post(
                f"/pos/tickets/{ticket_id}/pay",
                json={
                    "version": c4["version"],
                    "payment_details": {
                        "pagos": [{"metodo": "EFECTIVO", "monto": str(TOTAL_ESPERADO)}]
                    },
                },
            )
            assert r5.status_code in (200, 201), r5.text
            c5 = r5.json()
            assert c5["status"] == "PAID", c5
            assert Decimal(str(c5["total"])) == TOTAL_ESPERADO, c5
    finally:
        await _limpiar(ent)


# ---------------------------------------------------------------------------
# Criterio 2 — Tras cobrar, la cuenta desaparece del pizarrón (RN-31)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_venta_cobrada_sale_del_pizarron(entorno):
    """Una cuenta PAID ya NO se lista en el pizarrón de la terminal.

    Cierra la frontera entre el contrato 5 (cobrar) y el contrato 23 (listar):
    cobrar debe RETIRAR la cuenta de las abiertas, no dejarla colgada.
    """
    ent: _Entorno = entorno
    await _limpiar(ent)
    try:
        product_a, _ = await _sembrar(ent)
        async with _cliente() as cliente:
            creado = await _crear_ticket_vacio(cliente)
            assert creado.status_code == 201, creado.text
            ticket_id = creado.json()["id"]

            # Antes de cobrar: la cuenta vacía SÍ está en el pizarrón.
            antes = await cliente.get(
                "/pos/open-accounts", params={"terminal_id": TERMINAL_ID}
            )
            assert antes.status_code == 200, antes.text
            assert ticket_id in [c["id"] for c in antes.json()["cuentas"]], antes.text

            # Se llena y se cobra.
            item_a = str(uuid.uuid4())
            r2 = await _anadir_item(cliente, ticket_id, product_a, item_a, 1, 0)
            assert r2.status_code in (200, 201), r2.text
            version = r2.json()["version"]

            r3 = await cliente.post(
                f"/pos/tickets/{ticket_id}/pay",
                json={
                    "version": version,
                    "payment_details": {
                        "pagos": [{"metodo": "EFECTIVO", "monto": str(PRECIO_A)}]
                    },
                },
            )
            assert r3.status_code in (200, 201), r3.text
            assert r3.json()["status"] == "PAID", r3.text

            # Después de cobrar: la cuenta YA NO está en el pizarrón.
            despues = await cliente.get(
                "/pos/open-accounts", params={"terminal_id": TERMINAL_ID}
            )
            assert despues.status_code == 200, despues.text
            ids = [c["id"] for c in despues.json()["cuentas"]]
            assert ticket_id not in ids, (
                "La cuenta cobrada SIGUE en el pizarrón; el cobro no la retiró "
                f"(RN-31). Cuentas: {ids}"
            )
    finally:
        await _limpiar(ent)
