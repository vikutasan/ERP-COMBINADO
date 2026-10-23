"""Smoke test de VENTA end-to-end — FASE 2.7 del ERP COMBINADO.

Prueba que el POS puede VENDER de verdad con el catálogo importado de
producción (FASE 2.2 y 2.3) y con los colaboradores importados (FASE 2.4).
No siembra nada: usa el catálogo que ya está en `erp_pos` y lo vende por la
API real, en el puerto 5211.

Flujo que ejercita (los contratos reales del POS):

  1. GET  /health                                  — el API está vivo.
  2. GET  /catalog/products-for-sale?channel=...   — el catálogo se sirve.
  3. POST /pos/sessions                            — sesión de terminal (idempotente).
  4. POST /cash/open-session                       — turno de caja (RN-49, exigido por el cobro).
  5. POST /pos/tickets                             — ticket OPEN con líneas (contrato 3).
  6. POST /pos/tickets/{id}/items                  — ítem atómico (contrato 18).
  7. GET  /pos/tickets/{id}                        — lectura del ticket.
  8. POST /pos/tickets/{id}/pay                    — cobro (contrato 5, RN-94/RN-95).
  9. GET  /cash/session-summary/{id}               — el turno refleja la venta.
 10. POST /cash/close-session                      — cierre del turno.

Decisiones de diseño (y por qué):

  * **Dinero siempre Decimal, nunca float (RT-02).** Los precios llegan como
    STRING desde la API (DT-02). Se convierten con `Decimal(...)` y se suman
    con Decimal. Comparar con float daría falsos negativos por redondeo.
  * **El total lo calcula el BACKEND, no este script (regla 6 de DT-02).** El
    script solo VERIFICA que el total que devolvió el servidor sea igual a la
    suma exacta de `unit_price * quantity` de las líneas que devolvió el
    servidor. Si el script sumara por su cuenta y comparara contra sí mismo,
    la prueba no probaría nada.
  * **El cobro exige turno de caja abierto (RN-49).** Sin `cash_session_id`
    el endpoint cae al turno activo de la terminal; si no hay ninguno, falla.
    Por eso el script abre el turno ANTES de cobrar y lo cierra al final.
  * **El turno se cierra SIEMPRE, incluso si la venta falla.** El `finally`
    cierra la caja para no dejar la terminal bloqueada con un turno abierto
    que impediría la siguiente corrida (RN-49 devuelve 409 si ya hay uno).
  * **La terminal es propia del smoke test (`SMOKE-01`).** No se usa una
    terminal real para no ensuciar el corte de un cajero de verdad.
  * **El script es idempotente en lo que puede serlo.** La sesión de terminal
    y el turno de caja se reutilizan si ya existen; los tickets NO, porque
    cada corrida debe producir una venta nueva y verificable.

Uso:

    python scripts/smoke-venta.py
    python scripts/smoke-venta.py --base-url http://localhost:5211
    python scripts/smoke-venta.py --terminal SMOKE-02 --canal HELADERIA

Sale con código 0 si TODAS las comprobaciones pasan, 1 si alguna falla.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any

# ---------------------------------------------------------------------------
# Presentación — mismo estilo que los scripts de importación de la FASE 2.
# ---------------------------------------------------------------------------

ANCHO = 72


def titulo(texto: str) -> None:
    print()
    print("=" * ANCHO)
    print(texto)
    print("=" * ANCHO)


def ok(texto: str) -> None:
    print(f"  [OK]   {texto}")


def aviso(texto: str) -> None:
    print(f"  [..]   {texto}")


def fallo(texto: str) -> None:
    print(f"  [FALLO] {texto}")


# ---------------------------------------------------------------------------
# Cliente HTTP mínimo — sin dependencias externas.
# ---------------------------------------------------------------------------

class ErrorHttp(RuntimeError):
    """Un error HTTP con el cuerpo de la respuesta ya leído."""

    def __init__(self, metodo: str, ruta: str, codigo: int, cuerpo: str) -> None:
        self.metodo = metodo
        self.ruta = ruta
        self.codigo = codigo
        self.cuerpo = cuerpo
        super().__init__(f"{metodo} {ruta} → HTTP {codigo}: {cuerpo[:400]}")


class Cliente:
    """Cliente HTTP que habla JSON contra la API del POS."""

    def __init__(self, base_url: str, timeout: float = 20.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _peticion(
        self,
        metodo: str,
        ruta: str,
        cuerpo: dict[str, Any] | None = None,
    ) -> Any:
        url = f"{self.base_url}{ruta}"
        datos: bytes | None = None
        cabeceras = {"Accept": "application/json"}
        if cuerpo is not None:
            datos = json.dumps(cuerpo).encode("utf-8")
            cabeceras["Content-Type"] = "application/json"

        peticion = urllib.request.Request(
            url, data=datos, headers=cabeceras, method=metodo
        )
        try:
            with urllib.request.urlopen(peticion, timeout=self.timeout) as respuesta:
                texto = respuesta.read().decode("utf-8")
                return json.loads(texto) if texto.strip() else None
        except urllib.error.HTTPError as exc:
            texto = exc.read().decode("utf-8", errors="replace")
            raise ErrorHttp(metodo, ruta, exc.code, texto) from exc
        except urllib.error.URLError as exc:
            raise ErrorHttp(metodo, ruta, 0, f"sin conexión: {exc.reason}") from exc

    def get(self, ruta: str) -> Any:
        return self._peticion("GET", ruta)

    def post(self, ruta: str, cuerpo: dict[str, Any] | None = None) -> Any:
        return self._peticion("POST", ruta, cuerpo or {})


# ---------------------------------------------------------------------------
# Verificador — acumula fallos, no aborta en el primero.
# ---------------------------------------------------------------------------

class Verificador:
    """Acumula comprobaciones y reporta TODAS al final.

    Mismo principio que `verificar-importacion.py`: quien depura una venta
    quiere el panorama completo, no un fallo por corrida.
    """

    def __init__(self) -> None:
        self.total = 0
        self.fallos: list[str] = []

    def igual(self, etiqueta: str, obtenido: object, esperado: object) -> bool:
        self.total += 1
        if obtenido == esperado:
            ok(f"{etiqueta}: {obtenido}")
            return True
        fallo(f"{etiqueta}: obtenido={obtenido!r} ≠ esperado={esperado!r}")
        self.fallos.append(etiqueta)
        return False

    def condicion(self, etiqueta: str, cumple: bool, detalle: str = "") -> bool:
        self.total += 1
        sufijo = f": {detalle}" if detalle else ""
        if cumple:
            ok(f"{etiqueta}{sufijo}")
            return True
        fallo(f"{etiqueta}{sufijo}")
        self.fallos.append(etiqueta)
        return False

    def resumen(self) -> int:
        print()
        print("=" * ANCHO)
        if not self.fallos:
            print(f"RESULTADO: {self.total}/{self.total} comprobaciones OK")
            print("=" * ANCHO)
            return 0
        print(f"RESULTADO: {self.total - len(self.fallos)}/{self.total} OK — "
              f"{len(self.fallos)} FALLO(S)")
        for etiqueta in self.fallos:
            print(f"  - {etiqueta}")
        print("=" * ANCHO)
        return 1


# ---------------------------------------------------------------------------
# Utilidades de dinero — Decimal, jamás float (RT-02).
# ---------------------------------------------------------------------------

def a_decimal(valor: object) -> Decimal:
    """Convierte un valor monetario de la API a Decimal.

    La API serializa el dinero como STRING (DT-02). Si llegara un número,
    `Decimal(str(x))` sigue siendo exacto para lo que el JSON trae; lo que
    NUNCA se hace es `Decimal(float)` ni aritmética en float.
    """
    try:
        return Decimal(str(valor))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError(f"valor monetario ilegible: {valor!r}") from exc


# ---------------------------------------------------------------------------
# El smoke test
# ---------------------------------------------------------------------------

def ejecutar(args: argparse.Namespace) -> int:
    cliente = Cliente(args.base_url)
    v = Verificador()
    terminal = args.terminal
    canal = args.canal

    titulo("FASE 2.7 — Smoke test de VENTA end-to-end (ERP COMBINADO · POS)")
    aviso(f"API: {cliente.base_url}")
    aviso(f"Terminal: {terminal} · Canal: {canal}")

    # ------------------------------------------------------------------
    # 1. El API está vivo.
    # ------------------------------------------------------------------
    print()
    print("1) Salud del API")
    salud = cliente.get("/health")
    v.igual("GET /health → status", (salud or {}).get("status"), "ok")
    v.igual(
        "GET /health → servicio",
        (salud or {}).get("servicio"),
        "erp-combinado-pos-api",
    )

    # ------------------------------------------------------------------
    # 2. El catálogo importado se sirve y tiene productos vendibles.
    # ------------------------------------------------------------------
    print()
    print("2) Catálogo importado (FASE 2.2 / 2.3)")
    catalogo = cliente.get(f"/catalog/products-for-sale?channel={canal}")
    productos = (catalogo or {}).get("productos") or []
    categorias = (catalogo or {}).get("categorias") or []
    v.condicion(
        "GET /catalog/products-for-sale → productos",
        len(productos) > 0,
        f"{len(productos)} productos",
    )
    v.condicion(
        "GET /catalog/products-for-sale → categorias",
        len(categorias) > 0,
        f"{len(categorias)} categorías",
    )

    # Se eligen los dos productos MÁS CAROS con precio > 0 para que el total
    # sea inequívoco y no se confunda con un cero accidental.
    vendibles = [
        p for p in productos
        if a_decimal(p.get("price", "0")) > Decimal("0.00")
    ]
    vendibles.sort(key=lambda p: a_decimal(p["price"]), reverse=True)
    if len(vendibles) < 2:
        fallo("no hay al menos 2 productos con precio > 0 para vender")
        v.fallos.append("productos vendibles suficientes")
        return v.resumen()

    elegidos = vendibles[:2]
    for p in elegidos:
        aviso(f"producto elegido: {p.get('name')} · {p.get('price')} · {p.get('id')}")

    # ------------------------------------------------------------------
    # 3. Sesión de terminal (idempotente).
    # ------------------------------------------------------------------
    print()
    print("3) Sesión de terminal")
    sesion = cliente.post("/pos/sessions", {"terminal_id": terminal})
    sesion_id = (sesion or {}).get("id")
    v.condicion("POST /pos/sessions → id", bool(sesion_id), str(sesion_id))
    v.igual("POST /pos/sessions → terminal_id", (sesion or {}).get("terminal_id"), terminal)

    # ------------------------------------------------------------------
    # 4. Turno de caja (RN-49: el cobro lo exige).
    # ------------------------------------------------------------------
    print()
    print("4) Turno de caja")
    turno_id: str | None = None
    try:
        turno = cliente.post(
            "/cash/open-session",
            {
                "terminal_id": terminal,
                "usuario_id": "smoke-test",
                "usuario_nombre": "SMOKE TEST (FASE 2.7)",
                "monto_inicial": "0.00",
            },
        )
        turno_id = (turno or {}).get("cash_session_id")
        v.condicion("POST /cash/open-session → cash_session_id", bool(turno_id), str(turno_id))
    except ErrorHttp as exc:
        if exc.codigo == 409:
            # RN-49: ya hay un turno abierto en esta terminal. Se reutiliza.
            aviso("la terminal ya tiene turno abierto (RN-49); se reutiliza")
            activo = cliente.get(f"/cash/active-session?terminal_id={terminal}")
            turno_id = (activo or {}).get("cash_session_id")
            v.condicion(
                "GET /cash/active-session → cash_session_id",
                bool(turno_id),
                str(turno_id),
            )
        else:
            raise

    # El turno puede venir de una corrida anterior (RN-49). Se toma una foto
    # de partida y todas las comprobaciones del turno se hacen por DIFERENCIA,
    # de modo que el smoke test es repetible sin limpiar la base.
    base = cliente.get(f"/cash/session-summary/{turno_id}") or {}
    base_ventas = a_decimal(base.get("total_ventas"))
    base_transacciones = int(base.get("num_transacciones") or 0)
    base_esperado = a_decimal(base.get("esperado"))
    aviso(
        f"línea base del turno: ventas={base_ventas} "
        f"transacciones={base_transacciones} esperado={base_esperado}"
    )

    turno_cerrado = False

    try:
        # --------------------------------------------------------------
        # 5. Crear el ticket con UNA línea (contrato 3).
        # --------------------------------------------------------------
        print()
        print("5) Crear ticket (contrato 3)")
        primero = elegidos[0]
        ticket = cliente.post(
            "/pos/tickets",
            {
                "terminal_id": terminal,
                "channel": canal,
                "capturista_nombre": "SMOKE TEST (FASE 2.7)",
                "items": [
                    {"product_id": primero["id"], "quantity": 2},
                ],
            },
        )
        ticket_id = (ticket or {}).get("id")
        v.condicion("POST /pos/tickets → id", bool(ticket_id), str(ticket_id))
        v.igual("POST /pos/tickets → status", (ticket or {}).get("status"), "OPEN")
        v.condicion(
            "POST /pos/tickets → account_num (folio)",
            bool((ticket or {}).get("account_num")),
            str((ticket or {}).get("account_num")),
        )

        lineas = (ticket or {}).get("items") or []
        v.igual("POST /pos/tickets → líneas", len(lineas), 1)
        if lineas:
            v.igual(
                "POST /pos/tickets → cantidad de la línea",
                lineas[0].get("quantity"),
                2,
            )
            v.igual(
                "POST /pos/tickets → unit_price congelado del catálogo",
                a_decimal(lineas[0].get("unit_price")),
                a_decimal(primero["price"]),
            )

        # El total lo calcula el backend; aquí solo se VERIFICA.
        esperado_1 = a_decimal(primero["price"]) * Decimal("2")
        v.igual(
            "POST /pos/tickets → total = precio × 2",
            a_decimal((ticket or {}).get("total")),
            esperado_1,
        )

        # --------------------------------------------------------------
        # 6. Añadir un segundo producto por el contrato atómico 18.
        # --------------------------------------------------------------
        print()
        print("6) Añadir ítem atómico (contrato 18)")
        segundo = elegidos[1]
        version_actual = int((ticket or {}).get("version", 0))
        item_id = f"smoke-{uuid.uuid4()}"
        atomico = cliente.post(
            f"/pos/tickets/{ticket_id}/items",
            {
                "item_id": item_id,
                "product_id": segundo["id"],
                "quantity": 1,
                "version": version_actual,
            },
        )
        v.igual("POST /pos/tickets/{id}/items → item_id", (atomico or {}).get("item_id"), item_id)
        v.igual(
            "POST /pos/tickets/{id}/items → líneas",
            len((atomico or {}).get("lineas") or []),
            2,
        )
        esperado_2 = esperado_1 + a_decimal(segundo["price"])
        v.igual(
            "POST /pos/tickets/{id}/items → total acumulado",
            a_decimal((atomico or {}).get("total")),
            esperado_2,
        )

        # --------------------------------------------------------------
        # 7. Leer el ticket y comprobar que lo persistido cuadra.
        # --------------------------------------------------------------
        print()
        print("7) Lectura del ticket")
        # Contrato 21: respuesta LIGERA, exactamente 5 escalares y SIN líneas.
        leido = cliente.get(f"/pos/tickets/{ticket_id}")
        v.igual("GET /pos/tickets/{id} → status", (leido or {}).get("status"), "OPEN")
        v.igual(
            "GET /pos/tickets/{id} → total persistido",
            a_decimal((leido or {}).get("total")),
            esperado_2,
        )
        v.igual(
            "GET /pos/tickets/{id} → campos del contrato 21 (5 escalares)",
            sorted((leido or {}).keys()),
            ["account_num", "id", "status", "total", "version"],
        )
        # Contrato 30: las líneas viven en su propio endpoint.
        lineas_resp = cliente.get(f"/pos/tickets/{ticket_id}/items")
        lineas_leidas = (lineas_resp or {}).get("lineas") or []
        v.igual(
            "GET /pos/tickets/{id}/items → líneas persistidas",
            len(lineas_leidas),
            2,
        )
        v.igual(
            "GET /pos/tickets/{id}/items → total del contrato 30",
            a_decimal((lineas_resp or {}).get("total")),
            esperado_2,
        )
        suma_lineas = sum(
            (a_decimal(l.get("subtotal")) for l in lineas_leidas), Decimal("0.00")
        )
        v.igual(
            "GET /pos/tickets/{id}/items → suma de subtotales = total",
            suma_lineas,
            esperado_2,
        )

        # --------------------------------------------------------------
        # 8. Cobrar (contrato 5). RN-94: los pagos cuadran EXACTO.
        # --------------------------------------------------------------
        print()
        print("8) Cobro (contrato 5)")
        version_cobro = int((leido or {}).get("version", 0))
        cobrado = cliente.post(
            f"/pos/tickets/{ticket_id}/pay",
            {
                "version": version_cobro,
                "cobrador_nombre": "SMOKE TEST (FASE 2.7)",
                "cash_session_id": turno_id,
                "payment_details": {
                    "pagos": [
                        {"metodo": "EFECTIVO", "monto": str(esperado_2)},
                    ]
                },
            },
        )
        v.igual("POST /pos/tickets/{id}/pay → status", (cobrado or {}).get("status"), "PAID")
        v.igual(
            "POST /pos/tickets/{id}/pay → total cobrado",
            a_decimal((cobrado or {}).get("total")),
            esperado_2,
        )
        v.condicion(
            "POST /pos/tickets/{id}/pay → version incrementada",
            int((cobrado or {}).get("version", -1)) > version_cobro,
            f"{version_cobro} → {(cobrado or {}).get('version')}",
        )
        pagos = ((cobrado or {}).get("payment_details") or {}).get("pagos") or []
        v.igual("POST /pos/tickets/{id}/pay → pagos registrados", len(pagos), 1)
        if pagos:
            v.igual(
                "POST /pos/tickets/{id}/pay → monto del pago",
                a_decimal(pagos[0].get("monto")),
                esperado_2,
            )

        # --------------------------------------------------------------
        # 9. El turno de caja refleja la venta.
        # --------------------------------------------------------------
        print()
        print("9) Resumen del turno de caja")
        resumen = cliente.get(f"/cash/session-summary/{turno_id}")
        v.condicion("GET /cash/session-summary → respuesta", resumen is not None)
        # RN-58: el resumen clasifica por método en campos numéricos, no en texto.
        # Se compara contra la línea base: el turno puede traer ventas previas.
        v.igual(
            "GET /cash/session-summary → Δ total_ventas",
            a_decimal((resumen or {}).get("total_ventas")) - base_ventas,
            esperado_2,
        )
        v.igual(
            "GET /cash/session-summary → Δ num_transacciones",
            int((resumen or {}).get("num_transacciones") or 0) - base_transacciones,
            1,
        )
        v.igual(
            "GET /cash/session-summary → ventas_propias + ventas_ajenas = total",
            a_decimal((resumen or {}).get("ventas_propias"))
            + a_decimal((resumen or {}).get("ventas_ajenas")),
            a_decimal((resumen or {}).get("total_ventas")),
        )
        # RN-53: Δ esperado = Δ ventas en efectivo (fondo y movimientos sin cambio).
        v.igual(
            "GET /cash/session-summary → Δ esperado (RN-53)",
            a_decimal((resumen or {}).get("esperado")) - base_esperado,
            esperado_2,
        )

        # --------------------------------------------------------------
        # 10. Cerrar el turno.
        # --------------------------------------------------------------
        print()
        print("10) Cierre del turno")
        # Contrato 13: el conteo físico va en `montos_fisicos` (RN-54).
        # Se cuenta el efectivo ESPERADO del turno completo (no solo esta venta),
        # para que el arqueo cuadre aunque el turno traiga ventas previas.
        esperado_turno = a_decimal((resumen or {}).get("esperado"))
        cierre = cliente.post(
            "/cash/close-session",
            {
                "cash_session_id": turno_id,
                "montos_fisicos": str(esperado_turno),
            },
        )
        v.igual(
            "POST /cash/close-session → capturado",
            a_decimal((cierre or {}).get("capturado")),
            esperado_turno,
        )
        v.igual(
            "POST /cash/close-session → esperado del arqueo",
            a_decimal((cierre or {}).get("esperado")),
            esperado_turno,
        )
        v.igual(
            "POST /cash/close-session → diferencia (arqueo cuadrado)",
            a_decimal((cierre or {}).get("diferencia")),
            Decimal("0.00"),
        )
        turno_cerrado = True

    finally:
        # El turno se cierra SIEMPRE para no bloquear la siguiente corrida.
        if turno_id is not None and not turno_cerrado:
            try:
                cliente.post(
                    "/cash/close-session",
                    {"cash_session_id": turno_id, "montos_fisicos": "0.00"},
                )
                aviso("turno de caja asegurado como cerrado")
            except ErrorHttp as exc:
                # 400/409 aquí significa que ya estaba cerrado: es lo esperado.
                aviso(f"cierre de turno no aplicable (HTTP {exc.codigo})")

    return v.resumen()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Smoke test de venta end-to-end del POS (FASE 2.7)."
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost:5211",
        help="URL base del API del POS (por defecto http://localhost:5211)",
    )
    parser.add_argument(
        "--terminal",
        default="SMOKE-01",
        help="Terminal propia del smoke test (por defecto SMOKE-01)",
    )
    parser.add_argument(
        "--canal",
        default="PANADERIA",
        help="Canal de venta (por defecto PANADERIA)",
    )
    args = parser.parse_args()

    try:
        return ejecutar(args)
    except ErrorHttp as exc:
        print()
        fallo(str(exc))
        print()
        print("=" * ANCHO)
        print("RESULTADO: abortado por error HTTP")
        print("=" * ANCHO)
        return 1


if __name__ == "__main__":
    sys.exit(main())
