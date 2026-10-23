"""Las 95 reglas de negocio (RN-01 a RN-95) — FASE 3 + FASE 8.0 (CRM) + FASE 9.1 (Pagos mixtos).

Cada regla es una `Regla` con:
  - `numero`   : RN-01 … RN-93
  - `categoria`: la categoría C.1 … C.16 de la ESPECIFICACION §C
  - `enunciado`: el texto verbatim de la regla
  - `test`     : el nombre del test que la prueba (trazabilidad regla → test)
  - `verificar`: la implementación pura de la regla (lanza `ReglaViolada` si
                 se viola, o devuelve el resultado de la operación)

La unidad de migración es **regla + test** (Plan §5.1): ninguna regla existe
sin su test. La matriz `regla → test` se genera con `matriz_regla_test()`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


class ReglaViolada(Exception):
    """Se lanza cuando una regla de negocio se viola.

    `codigo` es el código HTTP que el POS actual devuelve para esa violación
    (400, 403, 404, 409), de modo que la regla conserva su contrato de error.
    """

    def __init__(self, regla: str, mensaje: str, codigo: int = 400) -> None:
        super().__init__(f"[{regla}] {mensaje}")
        self.regla = regla
        self.mensaje = mensaje
        self.codigo = codigo


@dataclass(frozen=True)
class Regla:
    numero: str
    categoria: str
    enunciado: str
    test: str
    verificar: Callable[..., Any] = field(compare=False, repr=False)


# ---------------------------------------------------------------------------
# Utilidades de tiempo (RN-78 a RN-81).
# ---------------------------------------------------------------------------
#
# FA-02 - ZoneInfo con DST real.
#
# Antes: _OFFSET_NEGOCIO = timedelta(hours=-6) - offset fijo sin DST.
# America/Mexico_City cambia a CDT (UTC-5) en marzo y vuelve a CST (UTC-6)
# en noviembre. Con offset fijo el reporte diario del dia del cambio da
# limites incorrectos (1h de error en el arqueo).
#
# Ahora: ZoneInfo maneja DST automaticamente. tzdata>=2024.1 provee la base
# IANA en contenedores Linux minimos. La interfaz publica NO cambia.

try:
    _ZONA_NEGOCIO: ZoneInfo = ZoneInfo("America/Mexico_City")
except ZoneInfoNotFoundError:  # pragma: no cover
    import warnings
    warnings.warn(
        "tzdata no disponible: usando UTC-6 fijo. "
        "Instala tzdata>=2024.1 para DST correcto (America/Mexico_City).",
        RuntimeWarning,
        stacklevel=1,
    )
    _ZONA_NEGOCIO = None  # type: ignore[assignment]


def utcnow() -> datetime:
    """Instante actual en UTC con tzinfo (RN-78)."""
    return datetime.now(timezone.utc)


def get_business_tz() -> ZoneInfo | timezone:
    """Zona horaria del negocio (RN-79). Unico punto de verdad.

    FA-02: devuelve ZoneInfo('America/Mexico_City') con soporte DST.
    Fallback a timezone(timedelta(hours=-6)) si tzdata no esta disponible.
    """
    if _ZONA_NEGOCIO is not None:
        return _ZONA_NEGOCIO
    return timezone(timedelta(hours=-6))  # fallback sin tzdata


def a_hora_local(instante: datetime) -> datetime:
    """Convierte un instante UTC a la hora local del negocio (RN-79).

    FA-02: con ZoneInfo el resultado refleja CDT (+1h) en horario de verano.
    """
    if instante.tzinfo is None:
        instante = instante.replace(tzinfo=timezone.utc)
    return instante.astimezone(get_business_tz())


def local_day_bounds_utc(dia_local: datetime) -> tuple[datetime, datetime]:
    """Limites [inicio, fin) en UTC de un dia local de negocio (RN-80).

    FA-02: con ZoneInfo el cambio de hora de verano se maneja correctamente.
    fold=0 desambigua la hora repetida del fall-back de noviembre.
    """
    tz = get_business_tz()
    inicio_local = dia_local.replace(
        hour=0, minute=0, second=0, microsecond=0, tzinfo=tz, fold=0
    )
    fin_local = inicio_local + timedelta(days=1)
    return inicio_local.astimezone(timezone.utc), fin_local.astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# C.1 — Sesión de terminal y ocupación (RN-01 a RN-08)
# ---------------------------------------------------------------------------

def rn01_una_sesion_por_terminal(sesiones_abiertas: list[dict], terminal_id: str) -> None:
    """RN-01: una terminal solo puede tener UNA sesión abierta a la vez."""
    abiertas = [s for s in sesiones_abiertas if s["terminal_id"] == terminal_id and s["estado"] == "OPEN"]
    if len(abiertas) > 1:
        raise ReglaViolada("RN-01", f"La terminal {terminal_id} tiene {len(abiertas)} sesiones abiertas", 400)


def rn02_identidad_de_sesion(terminal_id: str, employee_id: str) -> tuple[str, str]:
    """RN-02: una sesión se identifica por terminal_id + employee_id."""
    if not terminal_id or not employee_id:
        raise ReglaViolada("RN-02", "La sesión requiere terminal_id y employee_id", 400)
    return (terminal_id, employee_id)


def rn03_candado_exclusivo(ocupante_actual: str | None, solicitante: str) -> None:
    """RN-03: un TerminalLock es exclusivo; solo un ocupante a la vez."""
    if ocupante_actual is not None and ocupante_actual != solicitante:
        raise ReglaViolada("RN-03", f"La terminal está ocupada por {ocupante_actual}", 409)


def rn04_ttl_del_candado(creado: datetime, ahora: datetime, ttl_min: int = 15) -> bool:
    """RN-04: el candado vence a los `ttl_min`; al vencer se considera libre."""
    return (ahora - creado) < timedelta(minutes=ttl_min)


def rn05_solo_el_dueno_libera(dueno: str, solicitante: str, es_admin: bool = False) -> None:
    """RN-05: solo el dueño del candado puede liberarlo; otro recibe 403."""
    if dueno != solicitante and not es_admin:
        raise ReglaViolada("RN-05", f"{solicitante} no es dueño del candado de {dueno}", 403)


def rn06_admin_fuerza_desbloqueo(es_admin: bool) -> None:
    """RN-06: un administrador puede forzar el desbloqueo de una terminal ajena."""
    if not es_admin:
        raise ReglaViolada("RN-06", "Solo un administrador puede forzar el desbloqueo", 403)


def rn07_heartbeat_renueva_ttl(creado: datetime, ahora: datetime) -> datetime:
    """RN-07: el heartbeat renueva el TTL del candado del dueño."""
    return ahora


def rn08_purgar_vencidos(candados: list[dict], ahora: datetime, ttl_min: int = 15) -> list[dict]:
    """RN-08: los candados vencidos se purgan antes de reportar el estado."""
    return [c for c in candados if rn04_ttl_del_candado(c["creado"], ahora, ttl_min)]


# ---------------------------------------------------------------------------
# C.2 — Tickets: identidad y folio (RN-09 a RN-16)
# ---------------------------------------------------------------------------

def rn09_identidad_vs_folio(ticket: dict) -> tuple[UUID, str]:
    """RN-09: identidad interna = id (PK); externa = account_num (folio)."""
    if "id" not in ticket or "account_num" not in ticket:
        raise ReglaViolada("RN-09", "El ticket requiere id (PK) y account_num (folio)", 400)
    return ticket["id"], ticket["account_num"]


def rn10_formato_de_folio(consecutivo: int) -> str:
    """RN-10: el folio visible tiene formato V#### (V + consecutivo)."""
    if consecutivo < 1:
        raise ReglaViolada("RN-10", "El consecutivo del folio debe ser >= 1", 400)
    return f"V{consecutivo:04d}"


def rn11_folio_local_a_sucursal(folio: str, sucursal: str) -> str:
    """RN-11: el folio es local a la sucursal; no es un identificador global."""
    return f"{sucursal}:{folio}"


def rn12_terminal_id_inmutable(terminal_id_actual: str | None, terminal_id_nuevo: str) -> str:
    """RN-12: el terminal_id de un ticket nunca se sobrescribe una vez asignado."""
    if terminal_id_actual is not None and terminal_id_actual != terminal_id_nuevo:
        raise ReglaViolada("RN-12", "El terminal_id de un ticket es inmutable", 400)
    return terminal_id_nuevo


def rn13_canal_por_defecto(canal: str | None) -> str:
    """RN-13: un ticket pertenece a un canal; por defecto PANADERIA."""
    return canal or "PANADERIA"


def rn14_ciclo_de_vida(status: str) -> str:
    """RN-14: el status tiene un ciclo de vida definido."""
    validos = {"DRAFT", "OPEN", "PAID", "CANCELLED"}
    if status not in validos:
        raise ReglaViolada("RN-14", f"Status inválido: {status}", 400)
    return status


def rn15_version_para_concurrencia(version: int) -> int:
    """RN-15: un ticket tiene un version (entero) para concurrencia optimista."""
    if not isinstance(version, int) or version < 0:
        raise ReglaViolada("RN-15", "El version debe ser un entero >= 0", 400)
    return version


def rn16_total_es_suma_de_subtotales(lineas: list[dict]) -> Decimal:
    """RN-16: el total del ticket es la suma de los subtotales de sus líneas."""
    return sum((Decimal(str(l["subtotal"])) for l in lineas), Decimal("0.00"))


# ---------------------------------------------------------------------------
# C.3 — Tickets: líneas (RN-17 a RN-24)
# ---------------------------------------------------------------------------

def rn17_un_producto_una_vez(lineas: list[dict], product_id: str) -> list[dict]:
    """RN-17: un producto aparece una sola vez; agregarlo incrementa la cantidad."""
    for l in lineas:
        if l["product_id"] == product_id:
            l["quantity"] += 1
            l["subtotal"] = Decimal(str(l["unit_price"])) * l["quantity"]
            return lineas
    lineas.append({"product_id": product_id, "quantity": 1})
    return lineas


def rn18_unit_price_congelado(precio_catalogo: Decimal, precio_linea: Decimal | None) -> Decimal:
    """RN-18: el unit_price de la línea se congela al momento de agregarla."""
    return precio_linea if precio_linea is not None else Decimal(str(precio_catalogo))


def rn19_subtotal_de_linea(unit_price: Decimal, quantity: int) -> Decimal:
    """RN-19: el subtotal de la línea es unit_price × quantity."""
    return Decimal(str(unit_price)) * quantity


def rn20_cantidad_entero_positivo(quantity: int) -> int:
    """RN-20: la cantidad de una línea es un entero positivo."""
    if not isinstance(quantity, int) or quantity <= 0:
        raise ReglaViolada("RN-20", "La cantidad debe ser un entero positivo", 400)
    return quantity


def rn21_producto_inexistente(producto: dict | None) -> None:
    """RN-21: no se puede agregar un producto inexistente (404)."""
    if producto is None:
        raise ReglaViolada("RN-21", "Producto inexistente", 404)


def rn22_producto_inactivo(producto: dict) -> None:
    """RN-22: no se puede agregar un producto inactivo (400)."""
    if not producto.get("activo", True):
        raise ReglaViolada("RN-22", "Producto inactivo", 400)


def rn23_no_modificar_paid(status: str) -> None:
    """RN-23: no se puede modificar un ticket en estado PAID (400)."""
    if status == "PAID":
        raise ReglaViolada("RN-23", "No se puede modificar un ticket PAID", 400)


def rn24_sesion_activa(estado_sesion: str) -> None:
    """RN-24: no se puede operar sobre un ticket de una sesión inactiva (400)."""
    if estado_sesion != "OPEN":
        raise ReglaViolada("RN-24", "La sesión de la terminal no está activa", 400)


# ---------------------------------------------------------------------------
# C.4 — Concurrencia optimista (RN-25 a RN-30)
# ---------------------------------------------------------------------------

def rn25_validar_version(version_recibido: int, version_actual: int) -> None:
    """RN-25: toda escritura valida el version recibido."""
    if version_recibido != version_actual:
        raise ReglaViolada("RN-25", "El version recibido no coincide con el actual", 409)


def rn26_version_obsoleta(version_recibido: int, version_actual: int) -> None:
    """RN-26: si el version recibido es obsoleto, se responde 409."""
    if version_recibido < version_actual:
        raise ReglaViolada("RN-26", "Version obsoleto", 409)


def rn27_incrementar_version(version_actual: int) -> int:
    """RN-27: cada escritura exitosa incrementa el version en 1."""
    return version_actual + 1


def rn28_version_protege_concurrencia(version_a: int, version_b: int) -> bool:
    """RN-28: el version protege contra escrituras concurrentes de dos terminales."""
    return version_a == version_b


def rn29_expirar_cache_tras_escritura(escritura_atomica: bool) -> bool:
    """RN-29: tras una escritura atómica se expira la caché (db.expire_all())."""
    return escritura_atomica


def rn30_reserva_con_skip_locked(consulta: str) -> str:
    """RN-30: la reserva de ticket usa skip_locked para no bloquear terminales."""
    if "skip_locked" not in consulta.lower():
        raise ReglaViolada("RN-30", "La reserva debe usar skip_locked", 400)
    return consulta


# ---------------------------------------------------------------------------
# C.5 — DRAFT GUARD (RN-31 a RN-36)
# ---------------------------------------------------------------------------

def rn31_draft_pertenece_a_su_terminal(ticket: dict, terminal_id: str) -> None:
    """RN-31: un ticket DRAFT pertenece a la terminal que lo creó."""
    if ticket["status"] == "DRAFT" and ticket["terminal_id"] != terminal_id:
        raise ReglaViolada("RN-31", "El DRAFT pertenece a otra terminal", 400)


def rn32_no_escribir_draft_ajeno(ticket: dict, terminal_id: str) -> None:
    """RN-32: otra terminal no puede escribir sobre un DRAFT ajeno (400)."""
    if ticket["status"] == "DRAFT" and ticket["terminal_id"] != terminal_id:
        raise ReglaViolada("RN-32", "No se puede escribir sobre un DRAFT ajeno", 400)


def rn33_misma_terminal_continua_su_draft(ticket: dict, terminal_id: str) -> None:
    """RN-33: la misma terminal sí puede continuar su propio DRAFT."""
    if ticket["status"] == "DRAFT" and ticket["terminal_id"] != terminal_id:
        raise ReglaViolada("RN-33", "Solo la terminal dueña continúa su DRAFT", 400)


def rn34_draft_vacio_reutilizable(ticket: dict) -> bool:
    """RN-34: un DRAFT sin ítems puede reutilizarse para una nueva venta."""
    return ticket["status"] == "DRAFT" and len(ticket.get("items", [])) == 0


def rn35_draft_con_items_no_se_reutiliza(ticket: dict) -> bool:
    """RN-35: un DRAFT con ítems no se reutiliza; se crea uno nuevo."""
    return not (ticket["status"] == "DRAFT" and len(ticket.get("items", [])) > 0)


def rn36_guarda_antes_de_aplicar(orden: list[str]) -> None:
    """RN-36: la guarda de DRAFT se evalúa antes de aplicar cambios."""
    if not orden or orden[0] != "GUARD":
        raise ReglaViolada("RN-36", "La guarda de DRAFT debe evaluarse antes de aplicar", 400)


# ---------------------------------------------------------------------------
# C.6 — Anti-degradación de líneas (RN-37 a RN-40)
# ---------------------------------------------------------------------------

def rn37_umbral_anti_degradacion(total_actual: int, total_nuevo: int, umbral: float = 0.5) -> None:
    """RN-37: no se permite una reducción mayor al 50% del total de líneas."""
    if total_actual > 0 and total_nuevo < total_actual * (1 - umbral):
        raise ReglaViolada("RN-37", f"Reducción de líneas superior al {int(umbral*100)}%", 400)


def rn38_anti_degradacion_protege(total_actual: int, total_nuevo: int) -> bool:
    """RN-38: la anti-degradación protege contra pérdida por payloads incompletos."""
    return total_nuevo >= total_actual * 0.5


def rn39_rechazar_si_supera_umbral(total_actual: int, total_nuevo: int, umbral: float = 0.5) -> None:
    """RN-39: si la reducción supera el umbral, la operación se rechaza."""
    rn37_umbral_anti_degradacion(total_actual, total_nuevo, umbral)


def rn40_sincronizacion_idempotente(conjunto_a: set, conjunto_b: set) -> bool:
    """RN-40: la sincronización de líneas es idempotente para el mismo conjunto."""
    return conjunto_a == conjunto_b


# ---------------------------------------------------------------------------
# C.7 — Reserva y limpieza de borradores (RN-41 a RN-48)
# ---------------------------------------------------------------------------

def rn41_reserva_busca_draft_vacio(drafts: list[dict]) -> dict | None:
    """RN-41: la reserva busca primero un DRAFT vacío reutilizable de la terminal."""
    for d in drafts:
        if d["status"] == "DRAFT" and len(d.get("items", [])) == 0:
            return d
    return None


def rn42_draft_vacio_reutilizable_5min(creado: datetime, ahora: datetime) -> bool:
    """RN-42: un DRAFT vacío solo se reutiliza si fue creado en los últimos 5 min."""
    return (ahora - creado) <= timedelta(minutes=5)


def rn43_draft_vacio_viejo_se_descarta(creado: datetime, ahora: datetime) -> bool:
    """RN-43: un DRAFT vacío más antiguo se descarta y se crea uno nuevo."""
    return not rn42_draft_vacio_reutilizable_5min(creado, ahora)


def rn44_limpieza_throttled(ultima_limpieza: datetime | None, ahora: datetime) -> bool:
    """RN-44: la limpieza de borradores está throttled (máx. 1 vez por minuto)."""
    if ultima_limpieza is None:
        return True
    return (ahora - ultima_limpieza) >= timedelta(minutes=1)


def rn45_draft_vacio_obsoleto_1h(creado: datetime, ahora: datetime) -> bool:
    """RN-45: un DRAFT vacío con más de 1 hora se considera obsoleto."""
    return (ahora - creado) > timedelta(hours=1)


def rn46_draft_con_items_tiene_ttl(creado: datetime, ahora: datetime, ttl_horas: int = 4) -> bool:
    """RN-46: un DRAFT con ítems tiene un TTL de expiración."""
    return (ahora - creado) <= timedelta(hours=ttl_horas)


def rn47_al_expirar_pasa_a_cancelled(ticket: dict) -> dict:
    """RN-47: al expirar, el DRAFT pasa a CANCELLED."""
    ticket["status"] = "CANCELLED"
    return ticket


def rn48_limpieza_libera_terminal(candados: list[dict], terminal_id: str) -> list[dict]:
    """RN-48: la limpieza libera la terminal para nuevas ventas."""
    return [c for c in candados if c["terminal_id"] != terminal_id]


# ---------------------------------------------------------------------------
# C.8 — Caja: sesión y movimientos (RN-49 a RN-56)
# ---------------------------------------------------------------------------

def rn49_una_sesion_caja_por_terminal(sesiones: list[dict], terminal_id: str) -> None:
    """RN-49: solo puede existir UNA sesión de caja OPEN por terminal."""
    abiertas = [s for s in sesiones if s["terminal_id"] == terminal_id and s["estado"] == "OPEN"]
    if len(abiertas) > 1:
        raise ReglaViolada("RN-49", f"La terminal {terminal_id} tiene {len(abiertas)} cajas abiertas", 400)


def rn50_opening_float(fondo: Decimal) -> Decimal:
    """RN-50: una sesión de caja registra opening_float (fondo inicial)."""
    if fondo < 0:
        raise ReglaViolada("RN-50", "El fondo inicial no puede ser negativo", 400)
    return Decimal(str(fondo))


def rn51_movimiento_entrada_o_salida(tipo: str, monto: Decimal, concepto: str) -> dict:
    """RN-51: los movimientos son ENTRADA o SALIDA con monto y concepto."""
    if tipo not in ("ENTRADA", "SALIDA"):
        raise ReglaViolada("RN-51", f"Tipo de movimiento inválido: {tipo}", 400)
    if not concepto:
        raise ReglaViolada("RN-51", "El movimiento requiere concepto", 400)
    return {"tipo": tipo, "monto": Decimal(str(monto)), "concepto": concepto}


def rn52_movimiento_eliminable_si_abierta(estado_sesion: str) -> None:
    """RN-52: un movimiento puede eliminarse mientras la sesión esté abierta."""
    if estado_sesion != "OPEN":
        raise ReglaViolada("RN-52", "No se puede eliminar un movimiento de una caja cerrada", 400)


def rn53_efectivo_esperado(fondo: Decimal, entradas: Decimal, salidas: Decimal, ventas_efectivo: Decimal) -> Decimal:
    """RN-53: efectivo esperado = fondo + entradas − salidas + ventas en efectivo."""
    return Decimal(str(fondo)) + Decimal(str(entradas)) - Decimal(str(salidas)) + Decimal(str(ventas_efectivo))


def rn54_cierre_registra_conteos(physical_cash: Decimal, credito: Decimal, debito: Decimal) -> dict:
    """RN-54: al cerrar se registra el conteo físico, crédito y débito."""
    return {
        "physical_cash": Decimal(str(physical_cash)),
        "credito": Decimal(str(credito)),
        "debito": Decimal(str(debito)),
    }


def rn55_sesion_cerrada_inmutable(estado_sesion: str) -> None:
    """RN-55: una sesión cerrada es inmutable."""
    if estado_sesion == "CLOSED":
        raise ReglaViolada("RN-55", "Una sesión de caja cerrada es inmutable", 400)


def rn56_historial_filtrado_por_terminal_y_fecha(sesiones: list[dict], terminal_id: str, dia_local: str) -> list[dict]:
    """RN-56: el historial se filtra por terminal y fecha local."""
    return [s for s in sesiones if s["terminal_id"] == terminal_id and s["dia_local"] == dia_local]


# ---------------------------------------------------------------------------
# C.9 — Caja: clasificación de pagos (RN-57 a RN-60)
# ---------------------------------------------------------------------------

def rn57_clasificar_por_metodo(metodo: str) -> str:
    """RN-57: los pagos se clasifican por método (efectivo, crédito, débito, transferencia)."""
    validos = {"EFECTIVO", "CREDITO", "DEBITO", "TRANSFERENCIA"}
    if metodo not in validos:
        raise ReglaViolada("RN-57", f"Método de pago inválido: {metodo}", 400)
    return metodo


def rn58_clasificacion_alimenta_resumen(pagos: list[dict]) -> dict:
    """RN-58: la clasificación alimenta el resumen y el reporte diario."""
    resumen: dict[str, Decimal] = {}
    for p in pagos:
        metodo = rn57_clasificar_por_metodo(p["metodo"])
        resumen[metodo] = resumen.get(metodo, Decimal("0.00")) + Decimal(str(p["monto"]))
    return resumen


def rn94_suma_de_pagos_cuadra_total(pagos: list[dict], total: Decimal) -> None:
    """RN-94: la suma de los pagos debe cuadrar EXACTAMENTE el total del ticket.

    FASE 9.1 — Pagos mixtos. El dinero es Decimal (DT-02): no hay tolerancia de
    punto flotante. Si la suma de los abonos no es igual al total, se lanza
    `ReglaViolada` (400). Esto impide cobrar de menos (saldo pendiente) o de más
    (cambio mal calculado) y es la defensa de frontera del cobro mixto.
    """
    if not pagos:
        raise ReglaViolada("RN-94", "El cobro no tiene pagos", 400)
    suma = sum((Decimal(str(p["monto"])) for p in pagos), Decimal("0.00"))
    if suma != Decimal(str(total)):
        raise ReglaViolada(
            "RN-94",
            f"La suma de los pagos ({suma}) no cuadra el total ({total})",
            400,
        )


def rn95_metodos_de_pago_validos(pagos: list[dict]) -> None:
    """RN-95: cada pago usa un método válido (reutiliza RN-57, no duplica la lista).

    FASE 9.1 — Pagos mixtos. Se valida cada abono por separado para que un pago
    mixto con un método inválido falle con el mismo motivo que un pago único.
    """
    if not pagos:
        raise ReglaViolada("RN-95", "El cobro no tiene pagos", 400)
    for p in pagos:
        rn57_clasificar_por_metodo(str(p.get("metodo", "")).upper())


def rn59_reporte_usa_dia_local(instante_utc: datetime) -> str:
    """RN-59: el reporte diario usa el día local de negocio, no el día UTC."""
    return a_hora_local(instante_utc).strftime("%Y-%m-%d")


def rn60_resumen_distingue_esperado_y_contado(esperado: Decimal, contado: Decimal) -> dict:
    """RN-60: el resumen distingue efectivo esperado de efectivo contado."""
    return {"esperado": Decimal(str(esperado)), "contado": Decimal(str(contado))}


# ---------------------------------------------------------------------------
# C.10 — Inventario: eventos (RN-61 a RN-66)
# ---------------------------------------------------------------------------

def rn61_ledger_inmutable(operacion: str) -> None:
    """RN-61: el inventario es un libro mayor inmutable; nunca se hace UPDATE stock."""
    if operacion.upper() == "UPDATE":
        raise ReglaViolada("RN-61", "El ledger de inventario es inmutable (no UPDATE)", 400)


def rn62_pos_emite_evento_no_descuenta(accion: str) -> str:
    """RN-62: el POS no descuenta stock directamente; emite un WarehouseEvent."""
    if accion != "EMITIR_EVENTO":
        raise ReglaViolada("RN-62", "El POS debe emitir un evento, no descontar stock", 400)
    return accion


def rn63_evento_antes_del_commit(orden: list[str]) -> None:
    """RN-63: el WarehouseEvent se inserta antes del commit de la transacción POS."""
    if "INSERT_EVENTO" not in orden or "COMMIT" not in orden:
        raise ReglaViolada("RN-63", "El evento debe insertarse antes del commit", 400)
    if orden.index("INSERT_EVENTO") > orden.index("COMMIT"):
        raise ReglaViolada("RN-63", "El evento se insertó después del commit", 400)


def rn64_fallo_de_evento_no_tumba_el_pos(evento_ok: bool) -> bool:
    """RN-64: si la emisión del evento falla, el POS no falla (try/except pass)."""
    return True


def rn65_estados_del_evento(estado: str) -> str:
    """RN-65: el WarehouseEvent tiene estado PENDIENTE, PROCESADO o FALLIDO."""
    validos = {"PENDIENTE", "PROCESADO", "FALLIDO"}
    if estado not in validos:
        raise ReglaViolada("RN-65", f"Estado de evento inválido: {estado}", 400)
    return estado


def rn66_idempotencia_por_evento_id(movimientos: list[dict], evento_id: str, item_id: str) -> bool:
    """RN-66: el índice único (evento_id, item_id) garantiza idempotencia."""
    for m in movimientos:
        if m["evento_id"] == evento_id and m["item_id"] == item_id:
            return False  # ya existe: no se duplica
    return True


# ---------------------------------------------------------------------------
# C.11 — Pedidos: proyección (RN-67 a RN-70)
# ---------------------------------------------------------------------------

def rn67_ticket_a_pedido(ticket: dict, corresponde: bool) -> dict | None:
    """RN-67: un ticket puede proyectarse a un Order cuando corresponde."""
    if not corresponde:
        return None
    return {"ticket_id": ticket["id"], "status": "PENDIENTE"}


def rn68_relacion_1a1(pedidos: list[dict], ticket_id: UUID) -> None:
    """RN-68: la relación ticket↔pedido es 1:1 (ticket_id único)."""
    if any(p["ticket_id"] == ticket_id for p in pedidos):
        raise ReglaViolada("RN-68", "Ya existe un pedido para este ticket (relación 1:1)", 400)


def rn69_catorce_estados(estado: str) -> str:
    """RN-69: el pedido tiene 14 estados de ciclo de vida."""
    validos = {
        "PENDIENTE", "CONFIRMADO", "EN_PREPARACION", "LISTO", "EN_RUTA",
        "ENTREGADO", "CANCELADO", "DEVUELTO", "REPROGRAMADO", "EN_ESPERA",
        "PARCIAL", "FACTURADO", "PAGADO", "ARCHIVADO",
    }
    if estado not in validos:
        raise ReglaViolada("RN-69", f"Estado de pedido inválido: {estado}", 400)
    return estado


def rn70_datos_de_reparto(tipo_entrega: str, empaque: str, lat: float, lng: float, distancia: float, costo: Decimal) -> dict:
    """RN-70: el pedido registra tipo de entrega, empaque y datos de reparto."""
    return {
        "tipo_entrega": tipo_entrega,
        "empaque": empaque,
        "lat": lat,
        "lng": lng,
        "distancia": distancia,
        "costo": Decimal(str(costo)),
    }


# ---------------------------------------------------------------------------
# C.12 — Visión (RN-71 a RN-74)
# ---------------------------------------------------------------------------

def rn71_motor_orb(motor: str) -> str:
    """RN-71: la predicción por visión usa el motor ORB existente."""
    if motor != "ORB":
        raise ReglaViolada("RN-71", f"Motor de visión no soportado: {motor}", 400)
    return motor


def rn72_umbral_de_confianza(confianza: float, umbral: float = 0.35) -> bool:
    """RN-72: una detección se acepta si su confianza supera el umbral 0.35."""
    return confianza > umbral


def rn73_etiquetado_por_sku(sku: str) -> str:
    """RN-73: las imágenes de entrenamiento se etiquetan por SKU."""
    if not sku:
        raise ReglaViolada("RN-73", "La etiqueta de entrenamiento requiere SKU", 400)
    return sku


def rn74_vision_asistiva(bloquea_venta_manual: bool) -> None:
    """RN-74: la visión es asistiva; no bloquea la venta manual."""
    if bloquea_venta_manual:
        raise ReglaViolada("RN-74", "La visión no debe bloquear la venta manual", 400)


# ---------------------------------------------------------------------------
# C.13 — Auditoría (RN-75 a RN-77)
# ---------------------------------------------------------------------------

def rn75_registrar_escritura(log: list[dict], endpoint: str) -> list[dict]:
    """RN-75: cada escritura POS se registra en un log de auditoría."""
    log.append({"endpoint": endpoint})
    return log


def rn76_contenido_del_registro(endpoint: str, payload: dict, codigo: int, extras: dict | None = None) -> dict:
    """RN-76: el registro incluye endpoint, payload, código de respuesta y extras."""
    return {"endpoint": endpoint, "payload": payload, "codigo": codigo, "extras": extras or {}}


def rn77_consulta_por_terminal_y_rango(log: list[dict], terminal_id: str, desde: datetime, hasta: datetime) -> list[dict]:
    """RN-77: la auditoría se consulta por terminal y rango de fechas."""
    return [
        e for e in log
        if e.get("terminal_id") == terminal_id and desde <= e.get("timestamp", desde) <= hasta
    ]


# ---------------------------------------------------------------------------
# C.14 — Tiempo y zona horaria (RN-78 a RN-80)
# ---------------------------------------------------------------------------

def rn78_timestamps_en_utc(instante: datetime) -> datetime:
    """RN-78: todos los timestamps se almacenan en UTC."""
    if instante.tzinfo is None:
        raise ReglaViolada("RN-78", "El timestamp debe llevar tzinfo (UTC)", 400)
    return instante.astimezone(timezone.utc)


def rn79_conversion_con_zona_de_negocio(instante: datetime) -> datetime:
    """RN-79: la conversión a hora local usa la zona de negocio (get_business_tz)."""
    return a_hora_local(instante)


def rn80_limites_del_dia_local(dia_local: datetime) -> tuple[datetime, datetime]:
    """RN-80: los límites del día local se calculan con local_day_bounds_utc."""
    return local_day_bounds_utc(dia_local)


# ---------------------------------------------------------------------------
# C.15 — Regla transversal (RN-81)
# ---------------------------------------------------------------------------

def rn81_sin_offset_hardcodeado(fuente: str) -> None:
    """RN-81: ninguna capa debe hardcodear un offset de zona horaria.

    Detecta un offset literal (p. ej. `timedelta(hours=-6)` o `+6h`) fuera de
    la utilidad de zona de negocio. Es la regla que el POS actual viola
    (DB-04, `cash/service.py:189-190`).
    """
    import re

    patron = re.compile(
        r"timedelta\(\s*hours\s*=\s*-?\d+|utcoffset\(\s*-?\d+|[-+]\d{1,2}h\b"
    )
    if patron.search(fuente):
        raise ReglaViolada("RN-81", "Offset de zona horaria hardcodeado", 400)


# ---------------------------------------------------------------------------
# C.16 — CRM y Notificaciones (RN-82 a RN-93) — FASE 8.0
#
# 7 reglas IMPLEMENTADAS (RN-82, RN-83, RN-84, RN-85, RN-86, RN-87, RN-88)
# y 5 DECLARADAS (RN-89 a RN-93): su `verificar` es un guard explícito que
# documenta la regla y falla ruidosamente si alguien la invoca antes de que
# su sub-fase la implemente. Declarar ≠ implementar (defecto D-4 del plan).
# ---------------------------------------------------------------------------

def rn82_cliente_opcional_no_bloquea(cliente_id: str | None) -> None:
    """RN-82: la identificación del cliente es OPCIONAL; nunca bloquea la venta.

    El POS puede cobrar sin cliente (Público General). Un `cliente_id` ausente
    es un caso válido, no un error.
    """
    if cliente_id is not None and not isinstance(cliente_id, str):
        raise ReglaViolada("RN-82", "cliente_id debe ser String o None", 400)


def rn83_beneficios_no_modifican_total_negativo(total: Decimal, descuento: Decimal) -> Decimal:
    """RN-83: los beneficios (puntos/promos) NUNCA dejan el total por debajo de 0."""
    resultado = total - descuento
    if resultado < Decimal("0"):
        raise ReglaViolada("RN-83", "El descuento no puede dejar el total negativo", 400)
    return resultado


def rn84_puntos_no_se_actualizan_se_anexan(operacion: str) -> None:
    """RN-84: los puntos NUNCA se actualizan; se anexan al ledger (Regla de Oro #10)."""
    if operacion.upper() != "INSERT":
        raise ReglaViolada("RN-84", "Los puntos solo se anexan (INSERT), nunca UPDATE", 400)


def rn85_envio_por_outbox_no_directo(envio_directo: bool) -> None:
    """RN-85: el POS NUNCA envía el ticket directamente; lo ENCOLA (Outbox, Regla de Oro #7)."""
    if envio_directo:
        raise ReglaViolada("RN-85", "El POS debe encolar el envío, no enviarlo directo", 400)


def rn86_encolar_en_la_misma_transaccion(orden: list[str]) -> None:
    """RN-86: el encolado del envío ocurre DENTRO de la transacción del ticket."""
    if "encolar" not in orden:
        raise ReglaViolada("RN-86", "El encolado debe ocurrir en la transacción del ticket", 400)
    if orden.index("encolar") > orden.index("commit"):
        raise ReglaViolada("RN-86", "El encolado debe ir antes del commit", 400)


def rn87_fallo_de_crm_no_tumba_el_pos(excepcion: Exception | None) -> None:
    """RN-87: un fallo del CRM degrada a 'sin beneficios'; NUNCA bloquea la venta (DT-07)."""
    if excepcion is not None:
        # El POS captura y degrada; esta regla documenta que el fallo es tolerado.
        return None
    return None


def rn88_fallo_de_notificaciones_no_tumba_el_pos(excepcion: Exception | None) -> None:
    """RN-88: un fallo de Notificaciones degrada a 'sin envío'; NUNCA bloquea la venta (DT-07)."""
    if excepcion is not None:
        return None
    return None


def rn89_canal_de_envio_soportado(canal: str) -> str:
    """RN-89 (DECLARADA): el canal de envío debe ser whatsapp o email.

    Implementación pendiente en F8.4 (Notificaciones). Declarada aquí para que
    la matriz regla → test exista desde F8.0.
    """
    raise NotImplementedError("RN-89 se implementa en F8.4 (Notificaciones)")


def rn90_destino_valido_para_el_canal(destino: str, canal: str) -> None:
    """RN-90 (DECLARADA): el destino debe ser un teléfono o email válido según el canal.

    Implementación pendiente en F8.4 (Notificaciones).
    """
    raise NotImplementedError("RN-90 se implementa en F8.4 (Notificaciones)")


def rn91_beneficio_pertenece_al_cliente(beneficio: dict, cliente_id: str) -> None:
    """RN-91 (DECLARADA): un beneficio solo se aplica al cliente que lo posee.

    Implementación pendiente en F8.2 (CRM).
    """
    raise NotImplementedError("RN-91 se implementa en F8.2 (CRM)")


def rn92_promocion_vigente(promocion: dict, ahora: datetime) -> bool:
    """RN-92 (DECLARADA): una promoción solo aplica si está vigente a la fecha.

    Implementación pendiente en F8.2 (CRM).
    """
    raise NotImplementedError("RN-92 se implementa en F8.2 (CRM)")


def rn93_auditoria_del_beneficio_aplicado(log: list[dict], beneficio_id: str) -> list[dict]:
    """RN-93 (DECLARADA): cada beneficio aplicado se registra en la auditoría (DT-05).

    Implementación pendiente en F8.2 (CRM).
    """
    raise NotImplementedError("RN-93 se implementa en F8.2 (CRM)")


# ---------------------------------------------------------------------------
# El registro de las 95 reglas y la matriz regla → test
# ---------------------------------------------------------------------------

LAS_95_REGLAS: tuple[Regla, ...] = (
    # C.1 — Sesión de terminal y ocupación (RN-01 a RN-08)
    Regla("RN-01", "C.1", "Una terminal solo puede tener una sesión de trabajo abierta a la vez.", "test_rn01", rn01_una_sesion_por_terminal),
    Regla("RN-02", "C.1", "Una sesión de terminal se identifica por terminal_id y operador (employee_id).", "test_rn02", rn02_identidad_de_sesion),
    Regla("RN-03", "C.1", "Un candado de terminal (TerminalLock) es exclusivo: solo un ocupante a la vez.", "test_rn03", rn03_candado_exclusivo),
    Regla("RN-04", "C.1", "El candado tiene un TTL (por defecto 15 minutos); al vencer, se considera libre.", "test_rn04", rn04_ttl_del_candado),
    Regla("RN-05", "C.1", "Solo el dueño del candado puede liberarlo (unlock); otro recibe 403.", "test_rn05", rn05_solo_el_dueno_libera),
    Regla("RN-06", "C.1", "Un administrador puede forzar el desbloqueo de una terminal ajena.", "test_rn06", rn06_admin_fuerza_desbloqueo),
    Regla("RN-07", "C.1", "El heartbeat renueva el TTL del candado del dueño.", "test_rn07", rn07_heartbeat_renueva_ttl),
    Regla("RN-08", "C.1", "Los candados vencidos se purgan antes de reportar el estado de terminales.", "test_rn08", rn08_purgar_vencidos),
    # C.2 — Tickets: identidad y folio (RN-09 a RN-16)
    Regla("RN-09", "C.2", "Un ticket se identifica internamente por id (PK) y externamente por account_num (folio visible).", "test_rn09", rn09_identidad_vs_folio),
    Regla("RN-10", "C.2", "El folio visible tiene formato V#### (V + consecutivo), generado por sesión.", "test_rn10", rn10_formato_de_folio),
    Regla("RN-11", "C.2", "El folio es local a la sucursal; no es un identificador global.", "test_rn11", rn11_folio_local_a_sucursal),
    Regla("RN-12", "C.2", "El terminal_id de un ticket nunca se sobrescribe una vez asignado.", "test_rn12", rn12_terminal_id_inmutable),
    Regla("RN-13", "C.2", "Un ticket pertenece a un canal (channel), por defecto PANADERIA.", "test_rn13", rn13_canal_por_defecto),
    Regla("RN-14", "C.2", "Un ticket tiene un status con ciclo de vida definido (DRAFT, OPEN, PAID, CANCELLED, etc.).", "test_rn14", rn14_ciclo_de_vida),
    Regla("RN-15", "C.2", "Un ticket tiene un version (entero) para control de concurrencia optimista.", "test_rn15", rn15_version_para_concurrencia),
    Regla("RN-16", "C.2", "El total del ticket es la suma de los subtotales de sus líneas.", "test_rn16", rn16_total_es_suma_de_subtotales),
    # C.3 — Tickets: líneas (RN-17 a RN-24)
    Regla("RN-17", "C.3", "Un producto aparece una sola vez por ticket; agregarlo de nuevo incrementa la cantidad.", "test_rn17", rn17_un_producto_una_vez),
    Regla("RN-18", "C.3", "El unit_price de la línea se congela al momento de agregarla.", "test_rn18", rn18_unit_price_congelado),
    Regla("RN-19", "C.3", "El subtotal de la línea es unit_price × quantity.", "test_rn19", rn19_subtotal_de_linea),
    Regla("RN-20", "C.3", "La cantidad de una línea es un entero positivo.", "test_rn20", rn20_cantidad_entero_positivo),
    Regla("RN-21", "C.3", "No se puede agregar un producto inexistente (404).", "test_rn21", rn21_producto_inexistente),
    Regla("RN-22", "C.3", "No se puede agregar un producto inactivo (400).", "test_rn22", rn22_producto_inactivo),
    Regla("RN-23", "C.3", "No se puede modificar un ticket en estado PAID (400).", "test_rn23", rn23_no_modificar_paid),
    Regla("RN-24", "C.3", "No se puede operar sobre un ticket de una sesión inactiva (400).", "test_rn24", rn24_sesion_activa),
    # C.4 — Concurrencia optimista (RN-25 a RN-30)
    Regla("RN-25", "C.4", "Toda operación de escritura sobre un ticket valida el version recibido.", "test_rn25", rn25_validar_version),
    Regla("RN-26", "C.4", "Si el version recibido es obsoleto, se responde 409 (conflicto).", "test_rn26", rn26_version_obsoleta),
    Regla("RN-27", "C.4", "Cada escritura exitosa incrementa el version en 1.", "test_rn27", rn27_incrementar_version),
    Regla("RN-28", "C.4", "El version protege contra escrituras concurrentes de dos terminales.", "test_rn28", rn28_version_protege_concurrencia),
    Regla("RN-29", "C.4", "Tras una escritura atómica, se expira la caché de sesión (db.expire_all()) para releer el estado real.", "test_rn29", rn29_expirar_cache_tras_escritura),
    Regla("RN-30", "C.4", "La reserva de ticket usa skip_locked para evitar bloquear a otras terminales.", "test_rn30", rn30_reserva_con_skip_locked),
    # C.5 — DRAFT GUARD (RN-31 a RN-36)
    Regla("RN-31", "C.5", "Un ticket en estado DRAFT pertenece a la terminal que lo creó.", "test_rn31", rn31_draft_pertenece_a_su_terminal),
    Regla("RN-32", "C.5", "Otra terminal no puede escribir sobre un DRAFT ajeno (400).", "test_rn32", rn32_no_escribir_draft_ajeno),
    Regla("RN-33", "C.5", "La misma terminal sí puede continuar su propio DRAFT.", "test_rn33", rn33_misma_terminal_continua_su_draft),
    Regla("RN-34", "C.5", "Un DRAFT sin ítems puede reutilizarse para una nueva venta.", "test_rn34", rn34_draft_vacio_reutilizable),
    Regla("RN-35", "C.5", "Un DRAFT con ítems no se reutiliza; se crea uno nuevo.", "test_rn35", rn35_draft_con_items_no_se_reutiliza),
    Regla("RN-36", "C.5", "La guarda de DRAFT se evalúa antes de aplicar cambios.", "test_rn36", rn36_guarda_antes_de_aplicar),
    # C.6 — Anti-degradación de líneas (RN-37 a RN-40)
    Regla("RN-37", "C.6", "Al sincronizar líneas, no se permite una reducción mayor al 50% del total de líneas.", "test_rn37", rn37_umbral_anti_degradacion),
    Regla("RN-38", "C.6", "La anti-degradación protege contra pérdida accidental de líneas por payloads incompletos.", "test_rn38", rn38_anti_degradacion_protege),
    Regla("RN-39", "C.6", "Si la reducción supera el umbral, la operación se rechaza.", "test_rn39", rn39_rechazar_si_supera_umbral),
    Regla("RN-40", "C.6", "La sincronización de líneas es idempotente para el mismo conjunto.", "test_rn40", rn40_sincronizacion_idempotente),
    # C.7 — Reserva y limpieza de borradores (RN-41 a RN-48)
    Regla("RN-41", "C.7", "La reserva busca primero un DRAFT vacío reutilizable de la terminal.", "test_rn41", rn41_reserva_busca_draft_vacio),
    Regla("RN-42", "C.7", "Un DRAFT vacío solo se reutiliza si fue creado dentro de los últimos 5 minutos.", "test_rn42", rn42_draft_vacio_reutilizable_5min),
    Regla("RN-43", "C.7", "Un DRAFT vacío más antiguo se descarta y se crea uno nuevo.", "test_rn43", rn43_draft_vacio_viejo_se_descarta),
    Regla("RN-44", "C.7", "La limpieza de borradores obsoletos está throttled (máximo 1 vez por minuto).", "test_rn44", rn44_limpieza_throttled),
    Regla("RN-45", "C.7", "Un DRAFT vacío con más de 1 hora se considera obsoleto.", "test_rn45", rn45_draft_vacio_obsoleto_1h),
    Regla("RN-46", "C.7", "Un DRAFT con ítems tiene un TTL de expiración.", "test_rn46", rn46_draft_con_items_tiene_ttl),
    Regla("RN-47", "C.7", "Al expirar, el DRAFT pasa a CANCELLED.", "test_rn47", rn47_al_expirar_pasa_a_cancelled),
    Regla("RN-48", "C.7", "La limpieza libera la terminal para nuevas ventas.", "test_rn48", rn48_limpieza_libera_terminal),
    # C.8 — Caja: sesión y movimientos (RN-49 a RN-56)
    Regla("RN-49", "C.8", "Solo puede existir una sesión de caja OPEN por terminal.", "test_rn49", rn49_una_sesion_caja_por_terminal),
    Regla("RN-50", "C.8", "Una sesión de caja registra opening_float (fondo inicial).", "test_rn50", rn50_opening_float),
    Regla("RN-51", "C.8", "Los movimientos de caja son ENTRADA o SALIDA con monto y concepto.", "test_rn51", rn51_movimiento_entrada_o_salida),
    Regla("RN-52", "C.8", "Un movimiento puede eliminarse mientras la sesión esté abierta.", "test_rn52", rn52_movimiento_eliminable_si_abierta),
    Regla("RN-53", "C.8", "El efectivo esperado = fondo inicial + entradas − salidas + ventas en efectivo.", "test_rn53", rn53_efectivo_esperado),
    Regla("RN-54", "C.8", "Al cerrar, se registra el conteo físico (physical_cash), crédito y débito.", "test_rn54", rn54_cierre_registra_conteos),
    Regla("RN-55", "C.8", "Una sesión cerrada es inmutable.", "test_rn55", rn55_sesion_cerrada_inmutable),
    Regla("RN-56", "C.8", "El historial de sesiones se filtra por terminal y fecha local.", "test_rn56", rn56_historial_filtrado_por_terminal_y_fecha),
    # C.9 — Caja: clasificación de pagos (RN-57 a RN-60)
    Regla("RN-57", "C.9", "Los pagos se clasifican por método (efectivo, crédito, débito, transferencia).", "test_rn57", rn57_clasificar_por_metodo),
    Regla("RN-58", "C.9", "La clasificación alimenta el resumen y el reporte diario.", "test_rn58", rn58_clasificacion_alimenta_resumen),
    Regla("RN-59", "C.9", "El reporte diario usa el día local de negocio, no el día UTC.", "test_rn59", rn59_reporte_usa_dia_local),
    Regla("RN-60", "C.9", "El resumen distingue efectivo esperado de efectivo contado.", "test_rn60", rn60_resumen_distingue_esperado_y_contado),
    # C.10 — Inventario: eventos (RN-61 a RN-66)
    Regla("RN-61", "C.10", "El inventario es un libro mayor inmutable (movimientos_inventario); nunca se hace UPDATE stock.", "test_rn61", rn61_ledger_inmutable),
    Regla("RN-62", "C.10", "El POS no descuenta stock directamente; emite un WarehouseEvent.", "test_rn62", rn62_pos_emite_evento_no_descuenta),
    Regla("RN-63", "C.10", "El WarehouseEvent se inserta antes del commit de la transacción POS.", "test_rn63", rn63_evento_antes_del_commit),
    Regla("RN-64", "C.10", "Si la emisión del evento falla, el POS no falla (try/except pass).", "test_rn64", rn64_fallo_de_evento_no_tumba_el_pos),
    Regla("RN-65", "C.10", "El WarehouseEvent tiene estado PENDIENTE, PROCESADO o FALLIDO.", "test_rn65", rn65_estados_del_evento),
    Regla("RN-66", "C.10", "Un movimiento de inventario se liga a su evento por evento_id; el índice único (evento_id, item_id) garantiza idempotencia.", "test_rn66", rn66_idempotencia_por_evento_id),
    # C.11 — Pedidos: proyección (RN-67 a RN-70)
    Regla("RN-67", "C.11", "Un ticket puede proyectarse a un Order (pedido) cuando corresponde.", "test_rn67", rn67_ticket_a_pedido),
    Regla("RN-68", "C.11", "La relación ticket↔pedido es 1:1 (ticket_id único).", "test_rn68", rn68_relacion_1a1),
    Regla("RN-69", "C.11", "El pedido tiene 14 estados de ciclo de vida.", "test_rn69", rn69_catorce_estados),
    Regla("RN-70", "C.11", "El pedido registra tipo de entrega, empaque y datos de reparto (lat/lng/distancia/costo).", "test_rn70", rn70_datos_de_reparto),
    # C.12 — Visión (RN-71 a RN-74)
    Regla("RN-71", "C.12", "La predicción por visión usa el motor ORB existente.", "test_rn71", rn71_motor_orb),
    Regla("RN-72", "C.12", "Una detección se acepta si su confianza supera el umbral 0.35.", "test_rn72", rn72_umbral_de_confianza),
    Regla("RN-73", "C.12", "Las imágenes de entrenamiento se etiquetan por SKU.", "test_rn73", rn73_etiquetado_por_sku),
    Regla("RN-74", "C.12", "La visión es asistiva: no bloquea la venta manual.", "test_rn74", rn74_vision_asistiva),
    # C.13 — Auditoría (RN-75 a RN-77)
    Regla("RN-75", "C.13", "Cada escritura POS se registra en un log de auditoría (pos_audit.log).", "test_rn75", rn75_registrar_escritura),
    Regla("RN-76", "C.13", "El registro incluye endpoint, payload, código de respuesta y extras.", "test_rn76", rn76_contenido_del_registro),
    Regla("RN-77", "C.13", "La auditoría se consulta por terminal y rango de fechas.", "test_rn77", rn77_consulta_por_terminal_y_rango),
    # C.14 — Tiempo y zona horaria (RN-78 a RN-80)
    Regla("RN-78", "C.14", "Todos los timestamps se almacenan en UTC.", "test_rn78", rn78_timestamps_en_utc),
    Regla("RN-79", "C.14", "La conversión a hora local usa la zona de negocio (get_business_tz).", "test_rn79", rn79_conversion_con_zona_de_negocio),
    Regla("RN-80", "C.14", "Los límites del día local se calculan con local_day_bounds_utc.", "test_rn80", rn80_limites_del_dia_local),
    # C.15 — Regla transversal (RN-81)
    Regla("RN-81", "C.15", "Ninguna capa debe hardcodear un offset de zona horaria; siempre debe usar la utilidad de zona de negocio.", "test_rn81", rn81_sin_offset_hardcodeado),
    # C.16 — CRM y Notificaciones (RN-82 a RN-93) — FASE 8.0
    Regla("RN-82", "C.16", "La identificación del cliente es opcional; nunca bloquea la venta.", "test_rn82", rn82_cliente_opcional_no_bloquea),
    Regla("RN-83", "C.16", "Los beneficios nunca dejan el total del ticket por debajo de cero.", "test_rn83", rn83_beneficios_no_modifican_total_negativo),
    Regla("RN-84", "C.16", "Los puntos nunca se actualizan; se anexan al ledger (Regla de Oro #10).", "test_rn84", rn84_puntos_no_se_actualizan_se_anexan),
    Regla("RN-85", "C.16", "El POS nunca envía el ticket directamente; lo encola (Outbox, Regla de Oro #7).", "test_rn85", rn85_envio_por_outbox_no_directo),
    Regla("RN-86", "C.16", "El encolado del envío ocurre dentro de la transacción del ticket.", "test_rn86", rn86_encolar_en_la_misma_transaccion),
    Regla("RN-87", "C.16", "Un fallo del CRM degrada a sin beneficios; nunca bloquea la venta (DT-07).", "test_rn87", rn87_fallo_de_crm_no_tumba_el_pos),
    Regla("RN-88", "C.16", "Un fallo de Notificaciones degrada a sin envío; nunca bloquea la venta (DT-07).", "test_rn88", rn88_fallo_de_notificaciones_no_tumba_el_pos),
    Regla("RN-89", "C.16", "El canal de envío debe ser whatsapp o email.", "test_rn89", rn89_canal_de_envio_soportado),
    Regla("RN-90", "C.16", "El destino debe ser un teléfono o email válido según el canal.", "test_rn90", rn90_destino_valido_para_el_canal),
    Regla("RN-91", "C.16", "Un beneficio solo se aplica al cliente que lo posee.", "test_rn91", rn91_beneficio_pertenece_al_cliente),
    Regla("RN-92", "C.16", "Una promoción solo aplica si está vigente a la fecha.", "test_rn92", rn92_promocion_vigente),
    Regla("RN-93", "C.16", "Cada beneficio aplicado se registra en la auditoría (DT-05).", "test_rn93", rn93_auditoria_del_beneficio_aplicado),
    # C.17 — Pagos mixtos (RN-94 a RN-95) — FASE 9.1
    Regla("RN-94", "C.17", "La suma de los pagos cuadra exactamente el total del ticket.", "test_rn94", rn94_suma_de_pagos_cuadra_total),
    Regla("RN-95", "C.17", "Cada pago usa un método válido (efectivo, crédito, débito, transferencia).", "test_rn95", rn95_metodos_de_pago_validos),
)



def listar_reglas() -> tuple[Regla, ...]:
    """Devuelve las 95 reglas en orden."""
    return LAS_95_REGLAS


def matriz_regla_test() -> dict[str, str]:
    """Devuelve {RN-xx: nombre_del_test} — la trazabilidad regla → test."""
    return {r.numero: r.test for r in LAS_95_REGLAS}
