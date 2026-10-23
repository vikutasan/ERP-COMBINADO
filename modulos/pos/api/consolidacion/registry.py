"""Registro del contrato de consolidación — FASE 6 (Consolidación).

Fuente autoritativa:
  - `PLAN_DE_CONSTRUCCION_DEL_NUEVO_POS.md` §8 (F6: Consolidación central).
  - `MODELO_DESPLIEGUE_Y_CONSOLIDACION_CENTRAL.md` §2 (el contrato de consolidación).
  - `ESPECIFICACION_FUNCIONAL_POS_INGENIERIA_INVERSA.md` §F (RC-01 a RC-04).

La consolidación es la **capa superior** de la arquitectura de resiliencia. No es
un requisito del cobro: es una capa **asíncrona de cierre de día** (Plan §8.1). El
POS ya funciona solo; la consolidación conecta cada sucursal con el central.

Topología hub-and-spoke (MODELO §0.2): cada sucursal es un ERP completo e
independiente con su propia BD; el central **no es transaccional** (C4). Si el
central cae, las sucursales siguen operando.

Los 3 entregables de F6 (Plan §8.2):
  1. El **contrato de consolidación** (principios P1-P6, payload JSON, outbox).
  2. La **sync al cierre del día** (default `23:30`, configurable en `SystemSetting`).
  3. La **resolución de conflictos** (tabla `sync_conflictos`, revisión manual,
     nunca silenciosa).

La puerta de salida (Plan §8.3) exige:
  - [ ] La sync de cierre de día envía ventas y caja al central.
  - [ ] Si el central cae, las sucursales siguen operando (el central no es transaccional).
  - [ ] Un conflicto se registra para revisión manual; nunca se resuelve en silencio.

La regla de oro de la identidad (MODELO §1.3): la clave de consolidación es
`(branch_id, uuid)` — **nunca** `(branch_id, folio)`. El folio es para humanos;
el UUID es para máquinas.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time, timezone
from typing import Any
from uuid import UUID, uuid4

# ── Los 6 principios del contrato (MODELO §2.2) ───────────────────────────────
# El contrato es unidireccional: la sucursal envía, el central recibe. El central
# nunca escribe en la sucursal.
PRINCIPIOS: tuple[dict[str, str], ...] = (
    {
        "codigo": "P1",
        "nombre": "Unidireccional",
        "implicacion": "Sucursal → Central. Nunca al revés.",
    },
    {
        "codigo": "P2",
        "nombre": "Asíncrono",
        "implicacion": "La sucursal no espera al central para operar. Si el central cae, la sucursal sigue.",
    },
    {
        "codigo": "P3",
        "nombre": "Idempotente",
        "implicacion": "Reenviar el mismo dato no duplica. La clave (branch_id, uuid) lo garantiza.",
    },
    {
        "codigo": "P4",
        "nombre": "Reanudable",
        "implicacion": "Si el envío falla, se reintenta desde el último punto confirmado.",
    },
    {
        "codigo": "P5",
        "nombre": "Auditable",
        "implicacion": "Todo envío deja rastro: qué se envió, cuándo, con qué resultado.",
    },
    {
        "codigo": "P6",
        "nombre": "Sin acoplamiento de esquema",
        "implicacion": "El central no lee la BD de la sucursal. Recibe un payload definido.",
    },
)

# ── Los 4 dominios que se consolidan (MODELO §2.3) ────────────────────────────
# No todo se envía. Se envía lo que el corporativo necesita para decidir.
# Todos al cierre del día (default 23:30, configurable en SystemSetting).
DOMINIOS: tuple[dict[str, str], ...] = (
    {
        "nombre": "ventas",
        "que_viaja": "Tickets cerrados (PAID), con líneas, totales, forma de pago, terminal, cajero, timestamps UTC",
        "frecuencia": "Al cierre del día",
        "por_que": "Es el dato que el corporativo más consulta",
    },
    {
        "nombre": "caja",
        "que_viaja": "Sesiones cerradas, movimientos, diferencias de arqueo",
        "frecuencia": "Al cierre del día (junto con ventas)",
        "por_que": "Control de efectivo y detección de faltantes",
    },
    {
        "nombre": "inventario",
        "que_viaja": "Movimientos de inventario (ledger), no el stock",
        "frecuencia": "Al cierre del día (junto con ventas)",
        "por_que": "El stock se recalcula en el central; el ledger es la verdad",
    },
    {
        "nombre": "catalogo",
        "que_viaja": "Altas/bajas/cambios de productos y precios",
        "frecuencia": "Al cierre del día (o manual desde el panel)",
        "por_que": "El corporativo necesita ver el catálogo vigente por sucursal",
    },
)

# ── Lo que NO se consolida (MODELO §2.3) ──────────────────────────────────────
NO_SE_CONSOLIDA: tuple[str, ...] = (
    "Sesiones de terminal y candados (son efímeros, locales).",
    "Borradores (DRAFT) y tickets abiertos (aún no son venta).",
    "Datos de visión (imágenes de entrenamiento, predicciones).",
    "Configuración de hardware (impresoras, cámaras).",
)

# ── La hora del cierre de día (MODELO §2.3, fuente autoritativa §3.3.3) ───────
# Default 23:30, configurable en SystemSetting. La clave de configuración es
# `consolidacion.hora_cierre`.
HORA_CIERRE_DEFAULT = time(23, 30)
CLAVE_SETTING_HORA_CIERRE = "consolidacion.hora_cierre"

# ── La versión del esquema del payload (MODELO §2.4) ──────────────────────────
SCHEMA_VERSION = "1.0"

# ── Los 7 estados de un envío (bitácora) ──────────────────────────────────────
# Un envío nace PENDIENTE, pasa a ENVIADO o FALLIDO, y puede quedar CONFLICTO.
ESTADOS_ENVIO: tuple[str, ...] = (
    "PENDIENTE",
    "ENVIADO",
    "FALLIDO",
    "CONFLICTO",
)

# ── Los 3 niveles de conectividad (MODELO §2.7, fuente autoritativa §3.3.2) ───
# La consolidación es una CUARTA capa (sucursal → central), distinta de la cola
# de sincronización del Nivel 2 (terminal → servidor local).
NIVELES_CONECTIVIDAD: tuple[dict[str, str], ...] = (
    {
        "nivel": "Nivel 1 — Normal",
        "condicion": "Terminal conectada por cable Ethernet (LAN) al servidor local",
        "comportamiento": "Todas las operaciones en tiempo real contra PostgreSQL local",
        "indicador": "● Conectado (verde)",
    },
    {
        "nivel": "Nivel 2 — Degradado",
        "condicion": "El servidor local está caído o el cable se desconectó",
        "comportamiento": "Opera 100% desde IndexedDB local; cada operación va a una cola de sincronización con UUID y timestamp",
        "indicador": "● Offline — N operaciones pendientes (amarillo)",
    },
    {
        "nivel": "Nivel 3 — Tablets de reparto",
        "condicion": "Tablet en ruta, fuera de la red",
        "comportamiento": "Opera 100% offline; descarga su paquete de trabajo al salir y sincroniza al volver al WiFi",
        "indicador": "🚚 En Ruta con contador",
    },
)

# ── Las 5 garantías del contrato (MODELO §2.6) ────────────────────────────────
GARANTIAS: tuple[dict[str, str], ...] = (
    {"garantia": "At-least-once", "como": "El job reintenta hasta confirmar."},
    {"garantia": "Idempotencia", "como": "El central deduplica por (branch_id, uuid)."},
    {"garantia": "Orden por registro", "como": "Cada registro es independiente; no hay orden global requerido."},
    {"garantia": "Reanudación", "como": "batch_id + enviado=false permiten retomar."},
    {"garantia": "Trazabilidad", "como": "Cada envío deja enviado_at_utc y response_code."},
)

# ── El modelo de datos del central (MODELO §3.4) ──────────────────────────────
# El central NO replica el modelo de la sucursal. Tiene su propio modelo,
# optimizado para consulta. El stock se recalcula desde el ledger.
ENTIDADES_CENTRAL: tuple[dict[str, str], ...] = (
    {"entidad": "VentaConsolidada", "origen": "Tickets PAID de todas las sucursales", "clave": "(branch_id, uuid)"},
    {"entidad": "LineaVentaConsolidada", "origen": "Líneas de esos tickets", "clave": "(branch_id, uuid, sku)"},
    {"entidad": "SesionCajaConsolidada", "origen": "Sesiones cerradas", "clave": "(branch_id, uuid)"},
    {"entidad": "MovimientoInventarioConsolidado", "origen": "Ledger de inventario", "clave": "(branch_id, uuid)"},
    {"entidad": "CatalogoConsolidado", "origen": "Catálogo vigente por sucursal", "clave": "(branch_id, sku)"},
    {"entidad": "Sucursal", "origen": "Registro de sucursales", "clave": "branch_id"},
    {"entidad": "EnvioConsolidacion", "origen": "Bitácora de envíos recibidos", "clave": "batch_id"},
)

# ── Los 4 riesgos de concurrencia que F6 cierra (ESPECIFICACION §F) ───────────
# F6 no los "elimina": los hace observables y auditables. Un conflicto se
# registra para revisión manual; nunca se resuelve en silencio.
RIESGOS_QUE_CIERRA: tuple[dict[str, str], ...] = (
    {
        "codigo": "RC-01",
        "riesgo": "Dos terminales escriben el mismo ticket",
        "causa": "Ambas pasan la validación de versión a la vez",
        "mitigacion": "Concurrencia optimista (version) — mitiga, no elimina",
    },
    {
        "codigo": "RC-02",
        "riesgo": "Dos terminales reservan el mismo DRAFT vacío",
        "causa": "_find_empty_ticket con skip_locked",
        "mitigacion": "skip_locked reduce, pero no garantiza unicidad lógica",
    },
    {
        "codigo": "RC-03",
        "riesgo": "El candado vence mientras el operador trabaja",
        "causa": "TTL expira por red lenta",
        "mitigacion": "Heartbeat — depende de la red",
    },
    {
        "codigo": "RC-04",
        "riesgo": "El WarehouseEvent se emite pero el commit falla",
        "causa": "Evento huérfano",
        "mitigacion": "try/except pass — no hay compensación",
    },
)

# ── Los criterios de aceptación (MODELO §5) ───────────────────────────────────
CRITERIOS_SUCURSAL: tuple[dict[str, str], ...] = (
    {"codigo": "S1", "criterio": "El ERP completo opera con el POS como módulo", "verificacion": "Venta real de punta a punta"},
    {"codigo": "S2", "criterio": "Las 93 reglas se cumplen", "verificacion": "Suite de tests en verde (incluidos guardianes)"},
    {"codigo": "S3", "criterio": "El POS no lee tablas ajenas", "verificacion": "Test de arquitectura en verde"},
    {"codigo": "S4", "criterio": "No hay try/except pass en la ruta crítica", "verificacion": "Búsqueda automatizada en CI"},
    {"codigo": "S5", "criterio": "El folio es local y el UUID es global", "verificacion": "Revisión de la matriz de trazabilidad"},
    {"codigo": "S6", "criterio": "La sucursal opera con el central caído", "verificacion": "Prueba de desconexión del central"},
    {"codigo": "S7", "criterio": "Los datos llegan al central con branch_id correcto", "verificacion": "Consulta en el central"},
)

CRITERIOS_CENTRAL: tuple[dict[str, str], ...] = (
    {"codigo": "H1", "criterio": "Recibe datos de N sucursales sin colisión", "verificacion": "Dos sucursales con el mismo folio coexisten"},
    {"codigo": "H2", "criterio": "Es idempotente", "verificacion": "Reenviar un batch no duplica"},
    {"codigo": "H3", "criterio": "Es reanudable", "verificacion": "Un envío interrumpido se retoma"},
    {"codigo": "H4", "criterio": "No es transaccional", "verificacion": "El central no tiene endpoints de venta/cobro"},
    {"codigo": "H5", "criterio": "Consolida y reporta", "verificacion": "Reporte corporativo con datos de todas las sucursales"},
    {"codigo": "H6", "criterio": "Detecta sucursales desactualizadas", "verificacion": "Alerta si erp_version difiere"},
)

CRITERIO_GLOBAL = (
    "Una sucursal puede operar un día completo, con el central apagado, y al "
    "reconectarse el central recibe todos sus datos sin pérdida ni duplicación."
)


# ── El payload de consolidación (MODELO §2.4) ─────────────────────────────────
@dataclass(frozen=True)
class PayloadConsolidacion:
    """El sobre común de un envío al central (MODELO §2.4).

    El payload es JSON versionado, con un sobre común y un cuerpo por dominio.
    `uuid` es la clave real; `folio` es descriptivo. Todos los timestamps en UTC.
    """

    branch_id: str
    erp_version: str
    domain: str
    records: tuple[dict[str, Any], ...] = field(default_factory=tuple)
    schema_version: str = SCHEMA_VERSION
    sent_at_utc: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    batch_id: UUID = field(default_factory=uuid4)

    def __post_init__(self) -> None:
        if self.domain not in {d["nombre"] for d in DOMINIOS}:
            raise ValueError(
                f"[F6] Dominio desconocido: {self.domain!r}. "
                f"Válidos: {sorted(d['nombre'] for d in DOMINIOS)}"
            )
        if not self.branch_id:
            raise ValueError("[F6] El payload requiere branch_id (MODELO §1.4).")

    def a_dict(self) -> dict[str, Any]:
        """Serializa el payload al formato JSON del contrato (MODELO §2.4)."""
        return {
            "schema_version": self.schema_version,
            "branch_id": self.branch_id,
            "erp_version": self.erp_version,
            "sent_at_utc": self.sent_at_utc.isoformat().replace("+00:00", "Z"),
            "batch_id": str(self.batch_id),
            "domain": self.domain,
            "records": list(self.records),
        }


# ── El outbox de consolidación (MODELO §2.5) ──────────────────────────────────
@dataclass
class RegistroOutbox:
    """Una fila de `outbox_consolidacion` (MODELO §2.5).

    Se inserta en la MISMA transacción del ticket: el ticket y su intención de
    envío son atómicos. El job dedicado lo lee con `enviado=false`.
    """

    dominio: str
    uuid: UUID
    payload: dict[str, Any]
    enviado: bool = False
    enviado_at_utc: datetime | None = None
    response_code: int | None = None
    intentos: int = 0
    batch_id: UUID = field(default_factory=uuid4)

    @property
    def clave(self) -> tuple[str, UUID]:
        """La clave de idempotencia: (branch_id se añade al enviar, uuid)."""
        return (self.dominio, self.uuid)


class OutboxConsolidacion:
    """Un outbox en memoria que modela `outbox_consolidacion` (MODELO §2.5).

    El envío NO se hace en el request del usuario. Se hace con el mismo patrón
    de outbox que A-04: el registro vive en la misma transacción del ticket, y
    un job dedicado lo envía fuera del request.

    No hay `try/except pass`: un fallo deja `enviado=false` y es observable.
    """

    def __init__(self) -> None:
        self._registros: list[RegistroOutbox] = []
        self._en_transaccion = False
        self._pendientes: list[RegistroOutbox] = []

    # ── Ciclo de transacción (atómico con el ticket) ─────────────────────────

    def __enter__(self) -> "OutboxConsolidacion":
        self._en_transaccion = True
        self._pendientes = []
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        """Cierra la transacción. Si hubo excepción, rollback total (E-05)."""
        if exc_type is not None:
            self._pendientes = []
            self._en_transaccion = False
            return False  # ← propaga; NO silencia
        self._registros.extend(self._pendientes)
        self._pendientes = []
        self._en_transaccion = False
        return False

    def encolar(self, dominio: str, uuid: UUID, payload: dict[str, Any]) -> None:
        """Encola un registro en la MISMA transacción del ticket (MODELO §2.5)."""
        if not self._en_transaccion:
            raise RuntimeError("encolar debe ocurrir dentro de una transacción")
        self._pendientes.append(RegistroOutbox(dominio=dominio, uuid=uuid, payload=payload))

    # ── El job dedicado (fuera del request) ──────────────────────────────────

    def pendientes(self) -> tuple[RegistroOutbox, ...]:
        """SELECT outbox_consolidacion WHERE enviado=false (MODELO §2.5)."""
        return tuple(r for r in self._registros if not r.enviado)

    def marcar_enviado(self, registro: RegistroOutbox, response_code: int = 200) -> None:
        """UPDATE enviado=true, enviado_at_utc=... tras un POST exitoso."""
        registro.enviado = True
        registro.enviado_at_utc = datetime.now(timezone.utc)
        registro.response_code = response_code

    def marcar_fallido(self, registro: RegistroOutbox) -> None:
        """Deja enviado=false; el próximo ciclo reintenta (P4 reanudable)."""
        registro.intentos += 1

    @property
    def registros(self) -> tuple[RegistroOutbox, ...]:
        return tuple(self._registros)


# ── La resolución de conflictos (MODELO §2.8) ─────────────────────────────────
class ConflictoSilencioso(Exception):
    """Se lanza si se intenta resolver un conflicto sin registrarlo (Plan §8.3).

    Un conflicto se registra en `sync_conflictos` para revisión manual. Nunca se
    resuelve automáticamente con lógica silenciosa.
    """

    def __init__(self, detalle: str) -> None:
        super().__init__(
            f"[F6] Un conflicto no puede resolverse en silencio: {detalle}. "
            f"Debe registrarse en sync_conflictos para revisión manual."
        )
        self.detalle = detalle


@dataclass
class Conflicto:
    """Una fila de `sync_conflictos` (MODELO §2.8).

    El conflicto es visible, no silencioso: "Un dato perdido sin aviso es peor
    que un conflicto visible."

    Es mutable: un humano lo resuelve y deja la justificación (`resuelto`,
    `resolucion_manual`). La resolución nunca es automática ni silenciosa.
    """

    branch_id: str
    uuid: UUID
    dominio: str
    motivo: str
    detectado_at_utc: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    resuelto: bool = False
    resolucion_manual: str | None = None


class RegistroConflictos:
    """La tabla `sync_conflictos` en memoria (MODELO §2.8).

    Registra conflictos para revisión manual. Prohíbe la resolución silenciosa.
    """

    def __init__(self) -> None:
        self._conflictos: list[Conflicto] = []

    def registrar(self, conflicto: Conflicto) -> Conflicto:
        """Registra un conflicto para revisión manual."""
        self._conflictos.append(conflicto)
        return conflicto

    def resolver_manualmente(self, conflicto: Conflicto, resolucion: str) -> None:
        """Marca un conflicto como resuelto por un humano (nunca automático)."""
        if not resolucion:
            raise ConflictoSilencioso("la resolución manual requiere una justificación")
        conflicto.resuelto = True
        conflicto.resolucion_manual = resolucion

    @property
    def conflictos(self) -> tuple[Conflicto, ...]:
        return tuple(self._conflictos)

    @property
    def pendientes(self) -> tuple[Conflicto, ...]:
        return tuple(c for c in self._conflictos if not c.resuelto)


# ── La sync al cierre del día (MODELO §2.3) ───────────────────────────────────
@dataclass(frozen=True)
class SyncCierreDeDia:
    """La sync al cierre del día (Plan §8.2, MODELO §2.3).

    Default 23:30, configurable en SystemSetting (`consolidacion.hora_cierre`).
    """

    hora: time = HORA_CIERRE_DEFAULT
    dominios: tuple[str, ...] = tuple(d["nombre"] for d in DOMINIOS)

    @classmethod
    def desde_setting(cls, valor: str | None) -> "SyncCierreDeDia":
        """Construye la sync leyendo la hora de SystemSetting (formato HH:MM)."""
        if not valor:
            return cls()
        partes = valor.strip().split(":")
        if len(partes) != 2:
            raise ValueError(f"[F6] Hora de cierre inválida: {valor!r} (esperado HH:MM)")
        return cls(hora=time(int(partes[0]), int(partes[1])))

    def debe_disparar(self, ahora: datetime) -> bool:
        """True si `ahora` (hora local) alcanzó la hora de cierre del día."""
        return ahora.time() >= self.hora


# ── El central (el hub) — no transaccional (MODELO §3.1, §3.2) ────────────────
class CentralNoTransaccional:
    """El servidor central: recibe, consolida y reporta. NO es transaccional.

    Si el central se apaga, las sucursales siguen vendiendo, cobrando y operando
    con normalidad (MODELO §3.2). El central es un consumidor pasivo.
    """

    def __init__(self, branch_id: str) -> None:
        self.branch_id = branch_id
        self._recibidos: dict[tuple[str, str], dict[str, Any]] = {}
        self._envios: list[dict[str, Any]] = []
        self._caido = False

    def apagar(self) -> None:
        """Simula la caída del central (MODELO §3.2)."""
        self._caido = True

    def encender(self) -> None:
        self._caido = False

    @property
    def caido(self) -> bool:
        return self._caido

    def recibir(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Recibe un payload. Idempotente por (branch_id, uuid) (P3, H2).

        Devuelve un acuse con `recibidos` y `duplicados`. Si el central está
        caído, lanza `CentralCaido` — la sucursal NO espera (P2).
        """
        if self._caido:
            raise CentralCaido(self.branch_id)
        branch_id = payload["branch_id"]
        recibidos = 0
        duplicados = 0
        for record in payload.get("records", []):
            clave = (branch_id, str(record["uuid"]))
            if clave in self._recibidos:
                duplicados += 1
                continue
            self._recibidos[clave] = record
            recibidos += 1
        self._envios.append(
            {
                "batch_id": payload["batch_id"],
                "branch_id": branch_id,
                "domain": payload["domain"],
                "recibidos": recibidos,
                "duplicados": duplicados,
            }
        )
        return {"recibidos": recibidos, "duplicados": duplicados}

    @property
    def total_registros(self) -> int:
        return len(self._recibidos)

    @property
    def envios(self) -> tuple[dict[str, Any], ...]:
        return tuple(self._envios)


class CentralCaido(Exception):
    """Se lanza cuando el central no responde. La sucursal sigue operando (P2)."""

    def __init__(self, branch_id: str) -> None:
        super().__init__(
            f"[F6] El central no responde para la sucursal {branch_id!r}. "
            f"La sucursal sigue operando; los datos se acumulan localmente (P2, P4)."
        )
        self.branch_id = branch_id


# ── El job de consolidación (fuera del request) ───────────────────────────────
class JobConsolidacion:
    """El job dedicado que envía el outbox al central (MODELO §2.5).

    Corre fuera del request del usuario. Reintenta con backoff; si el central
    cae, deja `enviado=false` y el próximo ciclo reintenta (P4).
    """

    def __init__(self, outbox: OutboxConsolidacion, central: CentralNoTransaccional) -> None:
        self.outbox = outbox
        self.central = central

    def ejecutar(self, branch_id: str, erp_version: str) -> dict[str, int]:
        """Envía los registros pendientes, agrupados por dominio.

        Devuelve un resumen: {enviados, fallidos}. Nunca silencia un fallo.
        """
        enviados = 0
        fallidos = 0
        por_dominio: dict[str, list[RegistroOutbox]] = {}
        for registro in self.outbox.pendientes():
            por_dominio.setdefault(registro.dominio, []).append(registro)

        for dominio, registros in por_dominio.items():
            payload = PayloadConsolidacion(
                branch_id=branch_id,
                erp_version=erp_version,
                domain=dominio,
                records=tuple(r.payload for r in registros),
            )
            try:
                self.central.recibir(payload.a_dict())
            except CentralCaido:
                for registro in registros:
                    self.outbox.marcar_fallido(registro)
                    fallidos += 1
                continue
            for registro in registros:
                self.outbox.marcar_enviado(registro)
                enviados += 1
        return {"enviados": enviados, "fallidos": fallidos}


# ── Consultas del registro (para el test de la puerta) ────────────────────────
def listar_principios() -> tuple[dict[str, str], ...]:
    return PRINCIPIOS


def listar_dominios() -> tuple[dict[str, str], ...]:
    return DOMINIOS


def listar_entidades_central() -> tuple[dict[str, str], ...]:
    return ENTIDADES_CENTRAL


def listar_riesgos() -> tuple[dict[str, str], ...]:
    return RIESGOS_QUE_CIERRA


def matriz_principio_implicacion() -> dict[str, str]:
    return {p["codigo"]: p["implicacion"] for p in PRINCIPIOS}


def dominios_consolidados() -> tuple[str, ...]:
    return tuple(d["nombre"] for d in DOMINIOS)
