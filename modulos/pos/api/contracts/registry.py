"""Registro de los 32 contratos — FASE 2 (Frontera) + FASE 3.2 (Atómico) + FASE 7.0 (IA) + FASE 8.0 (CRM) + FASE 10.4 (Contexto diario) + FASE 12.9.1 (Creación de ticket) + FASE 12.10 (Lectura de líneas) + FASE 12.20 (Actualización de pedido).

Cada contrato se declara aquí con su firma completa (entrada/salida) y su
proveedor. El registro es la fuente única de verdad: el test de la puerta F2
lo recorre y verifica que ningún contrato exponga una tabla.

Matriz de contratos (Documento 9 §10):

  #   Contrato                            Consumidor          Proveedor    Estado hoy
  1   catalogo.productos_para_venta       POS                 Catálogo     Ya existe (parcial)
  2   almacenes.consumir_por_venta        POS                 Almacenes    Deuda
  3   almacenes.disponibilidad            POS                 Almacenes    Deuda
  4   produccion.disponible_para_vender   POS                 Producción   Deuda
  5   pos.eventos_auditables              Auditoría           POS          Cicatriz
  6   pos.resumen_de_venta                Estadísticas        POS          Deuda
  7   seguridad.identidad_del_empleado    POS                 Seguridad    Deuda
  8   seguridad.validar_pin               POS                 Seguridad    Deuda
  9   caja.sesion_activa                  POS                 Caja         Ya existe
  10  caja.abrir_turno                    POS                 Caja         Ya existe
  11  caja.registrar_movimiento           POS                 Caja         Ya existe
  12  caja.resumen_del_turno              POS                 Caja         Ya existe
  13  caja.cerrar_turno                   POS                 Caja         Ya existe
  14  caja.reporte_diario                 POS / Estadísticas  Caja         Ya existe
  15  pedidos.registrar_desde_ticket      POS                 Pedidos      Deuda
  16  pedidos.pedido_del_ticket           POS                 Pedidos      Deuda
  17  vision.reconocer_producto           POS                 Centro de IA Deuda

Contratos atómicos de la FASE 3.2 (corrigen el defecto D-2 de la v1.0 del plan,
que listaba endpoints sin contrato — regla A-02):

  18  pos.añadir_item                     POS                 POS          FASE 3.2
  19  pos.cambiar_cantidad                POS                 POS          FASE 3.2
  20  pos.quitar_item                     POS                 POS          FASE 3.2
  21  pos.leer_ticket                     POS                 POS          FASE 3.2
  22  pos.verificar_envio                 POS                 POS          FASE 3.2

Contrato de la FASE 5.0 (pizarrón de cuentas abiertas):

  23  pos.cuentas_abiertas                POS                 POS          FASE 5.0

Contratos de la FASE 7.0 (capacidades de IA — cierran la brecha de la DT-07):

  24  ia.transcribir_voz                  POS                 Centro de IA FASE 7.0
  25  ia.interpretar_intencion            POS                 Centro de IA FASE 7.0

Contratos de la FASE 8.0 (CRM y Notificaciones — lado POS):

  26  clientes.beneficios_para_ticket     POS                 CRM          FASE 8.0
  27  notificaciones.encolar_ticket       POS                 Notificaciones FASE 8.0

Contrato de la FASE 12.9.1 (creación de ticket — cierra el hueco A-02 del
endpoint `POST /pos/tickets`, que existía sin contrato declarado):

  29  pos.crear_ticket                    POS                 POS          FASE 12.9.1

Contrato de la FASE 12.20 (actualización de pedido — cierra el hueco A-02 del
endpoint `PATCH /pos/tickets/{id}/order`, que existía sin contrato declarado y
que permite persistir la programación de un ticket ya creado):

  31  pos.actualizar_pedido               POS                 POS          FASE 12.20

──────────────────────────────────────────────────────────────────────────────
NOTA DE FRONTERA — CRM Y NOTIFICACIONES (FASE 8.0) — añadida 30 Sep 2026
──────────────────────────────────────────────────────────────────────────────
El proveedor de los beneficios de cliente es el **CRM** (módulo del ERP), NO el
POS. El POS **consume** el CRM por contrato; nunca lee sus tablas (A-02).

  · El contrato 26 (`clientes.beneficios_para_ticket`) devuelve los beneficios
    aplicables a un ticket (puntos canjeables, promociones vigentes). El POS
    los muestra y los aplica; el CRM es el dueño del cálculo.

  · El contrato 27 (`notificaciones.encolar_ticket`) ENCOLA el envío del ticket
    (WhatsApp/Email) usando el patrón Outbox (Regla de Oro #7): el POS encola
    dentro de la transacción del ticket; el worker de Notificaciones envía
    después. El POS NUNCA envía directamente.

  · Regla de oro (DT-07): un fallo del CRM o de Notificaciones NUNCA bloquea
    una venta. El POS degrada a "sin beneficios" / "sin envío" y cobra igual.
──────────────────────────────────────────────────────────────────────────────
El proveedor de las capacidades de IA es el **Centro de IA** (módulo paraguas
del ERP, `apps/ai/`), NO el POS. El POS **consume** la IA por contrato; nunca
importa el motor (`torch`, `whisper`, `ultralytics`, `tesseract`).

  · El contrato 17 (`vision.reconocer_producto`) tiene como proveedor al
    Centro de IA. Su `proveedor` se declara aquí como "Centro de IA" para que
    no se confunda con un motor interno del POS.

  · DECLARADOS por la F7.0 (antes eran deuda, ahora son contratos):
      - 24 `ia.transcribir_voz`        POS → Centro de IA   (voz, Whisper)
      - 25 `ia.interpretar_intencion`  POS → Centro de IA   (NLU, Ollama)

    Con esto el POS ya NO habla con la IA por convención implícita: pide por
    contrato. Se cierra la brecha que violaba la Regla Dura A-02.

  · Regla de oro (DT-07): un fallo del motor de IA NUNCA bloquea una venta.
    El Gateway traduce cualquier fallo a 503 `IA_NO_DISPONIBLE`. Los contratos
    24 y 25 declaran ese 503 en `errores` para que el POS degrade a modo
    manual sin bloquear el cobro.
──────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Contrato:
    """Un contrato entre módulos.

    Un contrato es una OPERACIÓN, no una tabla. Por eso `operacion` es
    obligatoria y `tabla_expuesta` debe ser siempre `None` (regla O-23).
    """

    numero: int
    nombre: str
    consumidor: str
    proveedor: str
    operacion: str
    entrada: dict[str, str]
    salida: dict[str, str]
    garantias: tuple[str, ...] = field(default_factory=tuple)
    errores: tuple[str, ...] = field(default_factory=tuple)
    estado_hoy: str = "Deuda"
    # Un contrato NUNCA expone una tabla. Este campo existe para poder
    # afirmarlo explícitamente en el test de la puerta.
    tabla_expuesta: None = None

    @property
    def firma(self) -> str:
        """La firma legible: `proveedor.operacion(entrada) -> salida`."""
        ent = ", ".join(f"{k}: {v}" for k, v in self.entrada.items())
        sal = ", ".join(f"{k}: {v}" for k, v in self.salida.items())
        return f"{self.nombre}({ent}) -> {{{sal}}}"


CONTRATOS: tuple[Contrato, ...] = (
    # ── §1 Catálogo ────────────────────────────────────────────────────────
    Contrato(
        numero=1,
        nombre="catalogo.productos_para_venta",
        consumidor="POS",
        proveedor="Catálogo",
        operacion="GET /catalog/products-for-sale",
        entrada={"channel": "String", "include_hidden": "Boolean = false"},
        salida={
            "productos": "List[ProductoParaVenta]",
            "categorias": "List[CategoriaParaVenta]",
        },
        garantias=(
            "Devuelve una PROYECCIÓN de venta, no la fila completa (O-23).",
            "Solo incluye productos visibles para el canal pedido.",
            "El precio ya viene resuelto por el proveedor.",
        ),
        errores=("400 si el canal es inválido.",),
        estado_hoy="Ya existe (parcial)",
    ),
    # ── §2 Almacenes ───────────────────────────────────────────────────────
    Contrato(
        numero=2,
        nombre="almacenes.consumir_por_venta",
        consumidor="POS",
        proveedor="Almacenes",
        operacion="POST /warehouse/consume-for-sale",
        entrada={
            "evento_id": "UUID",
            "items": "List[{item_id: String, item_type: String, cantidad: Numeric}]",
            "ticket_id": "UUID",
        },
        salida={"aplicado": "Boolean", "movimientos": "List[UUID]"},
        garantias=(
            "Idempotente por `evento_id` (patrón Outbox, A-04 / O-19).",
            "El POS NO escribe `products.stock` ni `stock_almacen`.",
            "Se ejecuta en la MISMA transacción del guardado del ticket.",
        ),
        errores=(
            "409 si el `evento_id` ya fue aplicado con otro contenido.",
            "422 si algún item no existe.",
        ),
    ),
    Contrato(
        numero=3,
        nombre="almacenes.disponibilidad",
        consumidor="POS",
        proveedor="Almacenes",
        operacion="GET /warehouse/availability",
        entrada={"item_ids": "List[String]", "almacen_id": "UUID NULL"},
        salida={"disponibilidad": "List[{item_id, item_type, cantidad_disponible: Numeric}]"},
        garantias=(
            "Devuelve una PROYECCIÓN, no la tabla `stock_almacen` (O-23).",
            "El POS NO lee `products.stock` (columna eliminada en F1).",
        ),
        errores=("400 si la lista de items está vacía.",),
    ),
    # ── §3 Producción ──────────────────────────────────────────────────────
    Contrato(
        numero=4,
        nombre="produccion.disponible_para_vender",
        consumidor="POS",
        proveedor="Producción",
        operacion="GET /production/available-to-sell",
        entrada={"fecha": "Date (hora local)", "channel": "String"},
        salida={"disponibles": "List[{producto_id, cantidad: Numeric}]"},
        garantias=(
            "Usa la fecha LOCAL, no UTC (corrige D-28 / O-20).",
            "El POS NO lee la tabla `doughs`.",
        ),
        errores=("400 si el formato de fecha es inválido.",),
    ),
    # ── §4 Auditoría (POS es PROVEEDOR) ────────────────────────────────────
    Contrato(
        numero=5,
        nombre="pos.eventos_auditables",
        consumidor="Auditoría",
        proveedor="POS",
        operacion="GET /pos/auditable-events",
        entrada={"desde": "DateTime(timezone=True)", "hasta": "DateTime(timezone=True)"},
        salida={"eventos": "List[{tipo, ticket_id, usuario_id, timestamp, detalle}]"},
        garantias=(
            "El POS expone un RESUMEN de eventos, nunca su tabla `tickets`.",
            "Es una cicatriz: ya existe y se conserva.",
        ),
        errores=("400 si el rango de fechas es inválido.",),
        estado_hoy="Implementado",
    ),
    # ── §5 Estadísticas (POS es PROVEEDOR) ─────────────────────────────────
    Contrato(
        numero=6,
        nombre="pos.resumen_de_venta",
        consumidor="Estadísticas",
        proveedor="POS",
        operacion="GET /pos/sales-summary",
        entrada={"desde": "Date (hora local)", "hasta": "Date (hora local)"},
        salida={
            "total_ventas": "Numeric(12,2)",
            "numero_tickets": "Integer",
            "por_canal": "List[{canal, total: Numeric(12,2)}]",
        },
        garantias=(
            "El POS expone un RESUMEN, nunca su tabla `tickets` (O-23).",
            "Usa la fecha LOCAL, no UTC.",
        ),
        errores=("400 si el rango de fechas es inválido.",),
    ),
    # ── §6 Seguridad ───────────────────────────────────────────────────────
    Contrato(
        numero=7,
        nombre="seguridad.identidad_del_empleado",
        consumidor="POS",
        proveedor="Seguridad",
        operacion="GET /security/employees/{employee_id}",
        entrada={"employee_id": "UUID"},
        salida={
            "employee_id": "UUID",
            "nombre": "String",
            "perfil": "String",
            "permisos": "List[String]",
        },
        garantias=(
            "Devuelve una PROYECCIÓN, no la tabla `employees` (O-23).",
            "El POS NO lee `employees` directamente.",
        ),
        errores=("404 si el empleado no existe.",),
    ),
    Contrato(
        numero=8,
        nombre="seguridad.validar_pin",
        consumidor="POS",
        proveedor="Seguridad",
        operacion="POST /security/employees/validate-pin",
        entrada={"pin": "String"},
        salida={"valido": "Boolean", "employee_id": "UUID NULL"},
        garantias=(
            "Único contrato que expone un secreto en tránsito (O-21).",
            "Exige HTTPS y rate-limit obligatorio (O-21).",
        ),
        errores=(
            "429 si se excede el rate-limit.",
            "401 si el PIN es inválido.",
        ),
    ),
    # ── §7 Caja (ya existe, completo) ──────────────────────────────────────
    Contrato(
        numero=9,
        nombre="caja.sesion_activa",
        consumidor="POS",
        proveedor="Caja",
        operacion="GET /cash/active-session",
        entrada={"terminal_id": "UUID"},
        salida={"cash_session_id": "UUID NULL", "abierta_en": "DateTime(timezone=True) NULL"},
        garantias=("El POS NO lee la tabla `cash_sessions`.",),
        errores=(),
        estado_hoy="Ya existe",
    ),
    Contrato(
        numero=10,
        nombre="caja.abrir_turno",
        consumidor="POS",
        proveedor="Caja",
        operacion="POST /cash/open-session",
        entrada={
            "terminal_id": "UUID",
            # FICHA_FIX_TURNO_CAJA_USUARIO_ID (7 Oct 2026) — el ERP autentica al
            # cajero con un id NUMÉRICO (`currentUser.id = 1`), no con un UUID.
            # El contrato acepta `UUID | String | Int` y lo normaliza a un UUID
            # determinista (uuid5) en la frontera. Antes exigía `UUID` y Pydantic
            # v2 rechazaba el id del ERP con 422 (`uuid_type`): el turno NUNCA
            # se abría. Misma clase de bug que F7.7c.
            "usuario_id": "UUID | String | Int",
            "monto_inicial": "Numeric(12,2)",
            # F10.5 — paridad de datos: el nombre del cajero que el viejo POS
            # persistía en `cash_sessions.employee_name`. Opcional.
            "usuario_nombre": "String NULL",
        },
        salida={"cash_session_id": "UUID", "abierta_en": "DateTime(timezone=True)"},
        garantias=("Una sola sesión abierta por terminal.",),
        errores=("409 si ya hay una sesión abierta en la terminal.",),
        estado_hoy="Ya existe",
    ),
    Contrato(
        numero=11,
        nombre="caja.registrar_movimiento",
        consumidor="POS",
        proveedor="Caja",
        operacion="POST /cash/movements",
        entrada={
            "cash_session_id": "UUID",
            "tipo": "String",
            "monto": "Numeric(12,2)",
            "motivo": "Text NULL",
        },
        salida={"movement_id": "UUID"},
        garantias=("Una sesión CLOSED ya no acepta movimientos.",),
        errores=("400 si la sesión está cerrada.",),
        estado_hoy="Ya existe",
    ),
    Contrato(
        numero=12,
        nombre="caja.resumen_del_turno",
        consumidor="POS",
        proveedor="Caja",
        operacion="GET /cash/session-summary/{cash_session_id}",
        entrada={"cash_session_id": "UUID"},
        salida={
            "esperado": "Numeric(12,2)",
            "movimientos": "List[{tipo, monto: Numeric(12,2)}]",
            # F10.5 — paridad de datos: el desglose que el viejo POS exponía
            # en `CashSummaryResponse` (8 campos). Se calcula con RN-53/RN-58.
            "fondo_inicial": "Numeric(12,2)",
            "total_entradas": "Numeric(12,2)",
            "total_salidas": "Numeric(12,2)",
            "total_credito": "Numeric(12,2)",
            "total_debito": "Numeric(12,2)",
            "total_ventas": "Numeric(12,2)",
            "num_transacciones": "Integer",
        },
        garantias=("Devuelve una PROYECCIÓN, no la tabla `cash_movements`.",),
        errores=("404 si la sesión no existe.",),
        estado_hoy="Ya existe",
    ),
    Contrato(
        numero=13,
        nombre="caja.cerrar_turno",
        consumidor="POS",
        proveedor="Caja",
        operacion="POST /cash/close-session",
        entrada={
            "cash_session_id": "UUID",
            "montos_fisicos": "Numeric(12,2)",
        },
        salida={
            "esperado": "Numeric(12,2)",
            "capturado": "Numeric(12,2)",
            "diferencia": "Numeric(12,2)",
        },
        garantias=(
            "Marca la sesión como CLOSED y guarda los montos físicos capturados.",
            "Devuelve la diferencia (descuadre) para que el cajero la vea.",
            "Una sesión CLOSED ya no acepta movimientos.",
        ),
        errores=("400 si la sesión ya está cerrada.",),
        estado_hoy="Ya existe",
    ),
    Contrato(
        numero=14,
        nombre="caja.reporte_diario",
        consumidor="POS / Estadísticas",
        proveedor="Caja",
        operacion="GET /cash/daily-report/{fecha}",
        entrada={"fecha": "Date (hora local)"},
        salida={"reporte": "List[{canal, cajero, terminal, total: Numeric(12,2)}]"},
        garantias=(
            "Agrupa por canal y por cajero/terminal.",
            "Usa la fecha LOCAL, no UTC.",
        ),
        errores=("400 si el formato de fecha es inválido.",),
        estado_hoy="Ya existe",
    ),
    # ── §8 Pedidos ─────────────────────────────────────────────────────────
    Contrato(
        numero=15,
        nombre="pedidos.registrar_desde_ticket",
        consumidor="POS",
        proveedor="Pedidos",
        operacion="POST /orders/from-ticket",
        entrada={
            "ticket_id": "UUID",
            "order_type": "String",
            "status_ticket": "String",
            "delivery_type": "String",
            "customer_name": "String NULL",
            "customer_phone": "String NULL",
            "committed_at": "DateTime(timezone=True) NULL",
            "packaging_type": "String",
            "delivery_address": "Text NULL",
            "notes": "Text NULL",
        },
        salida={
            "order_id": "UUID",
            "status": "String",
            "earliest_ready_at": "DateTime(timezone=True)",
        },
        garantias=(
            "Idempotente por `ticket_id`: si el pedido ya existe, lo ACTUALIZA.",
            "El mapeo de estado es del proveedor: OPEN → TENTATIVO, PAID → PAGADO.",
            "Pedidos calcula `earliest_ready_at`; el POS no lo inventa.",
            "Se ejecuta en la MISMA transacción del guardado del ticket.",
        ),
        errores=(
            "404 si el ticket no existe.",
            "409 si el ticket no es de tipo PEDIDO.",
        ),
    ),
    Contrato(
        numero=16,
        nombre="pedidos.pedido_del_ticket",
        consumidor="POS",
        proveedor="Pedidos",
        operacion="GET /orders/by-ticket/{ticket_id}",
        entrada={"ticket_id": "UUID"},
        salida={
            "order_id": "UUID",
            "delivery_type": "String",
            "status": "String",
            "customer_name": "String NULL",
            "customer_phone": "String NULL",
            "committed_at": "DateTime(timezone=True) NULL",
            "packaging_type": "String",
            "delivery_address": "Text NULL",
            "delivery_fee": "Numeric(12,2) NULL",
            "notes": "Text NULL",
        },
        garantias=(
            "Devuelve el pedido asociado al ticket, o 404 si no tiene.",
            "Devuelve una PROYECCIÓN, no la fila completa (O-23).",
        ),
        errores=("404 si el ticket no existe o no tiene pedido.",),
    ),
    # ── §9 Visión (proveedor: Centro de IA — DT-07) ────────────────────────
    Contrato(
        numero=17,
        nombre="vision.reconocer_producto",
        consumidor="POS",
        proveedor="Centro de IA",
        operacion="POST /vision/predict",
        entrada={"frame_base64": "String", "channel": "String", "top_k": "Integer = 3"},
        salida={
            "detecciones": "List[{sku, nombre, confianza: Float(0..1), bbox}]",
            "modelo_version": "String",
        },
        garantias=(
            "Devuelve hasta `top_k` candidatos ordenados por confianza.",
            "Si no reconoce nada, devuelve lista vacía (200), no error.",
            "El POS decide qué hacer con la detección: Visión solo sugiere.",
        ),
        errores=(
            "400 si `frame_base64` está vacío o excede 5 MB.",
            "503 si el modelo no está cargado.",
        ),
    ),
    # ── §10 POS atómico — FASE 3.2 (corrige el defecto D-2) ────────────────
    Contrato(
        numero=18,
        nombre="pos.añadir_item",
        consumidor="POS",
        proveedor="POS",
        operacion="POST /pos/tickets/{ticket_id}/items",
        entrada={
            "ticket_id": "UUID",
            "item_id": "String",
            "product_id": "UUID",
            "quantity": "Integer",
            "version": "Integer",
        },
        salida={
            "ticket_id": "UUID",
            "item_id": "String",
            "version": "Integer",
            "total": "Numeric(12,2)",
            "lineas": "List[{item_id, product_id, quantity, unit_price, subtotal}]",
        },
        garantias=(
            "IDEMPOTENTE por `item_id`: repetir el POST con el mismo `item_id` "
            "deja el ticket en el MISMO estado (no duplica la línea).",
            "El `unit_price` se congela desde el catálogo (RN-18); el cliente no dicta precio.",
            "Un producto ya presente incrementa su cantidad, no crea otra línea (RN-17).",
            "Toda escritura valida el `version` recibido (RN-25) y lo incrementa (RN-27).",
            "Devuelve una PROYECCIÓN de las líneas, no la tabla `ticket_items` (O-23).",
        ),
        errores=(
            "404 si el producto no existe (RN-21).",
            "400 si el producto está inactivo (RN-22).",
            "400 si la cantidad no es un entero positivo (RN-20).",
            "400 si la sesión de la terminal no está activa (RN-24).",
            "400 si el ticket está PAID (RN-23).",
            "409 si el `version` recibido no coincide con el actual (RN-25).",
        ),
        estado_hoy="FASE 3.2",
    ),
    Contrato(
        numero=19,
        nombre="pos.cambiar_cantidad",
        consumidor="POS",
        proveedor="POS",
        operacion="PATCH /pos/tickets/{ticket_id}/items/{item_id}",
        entrada={
            "ticket_id": "UUID",
            "item_id": "String",
            "quantity": "Integer",
            "version": "Integer",
        },
        salida={
            "ticket_id": "UUID",
            "item_id": "String",
            "version": "Integer",
            "total": "Numeric(12,2)",
            "lineas": "List[{item_id, product_id, quantity, unit_price, subtotal}]",
        },
        garantias=(
            "BLOQUEO OPTIMISTA por `version`: si el `version` recibido no coincide, "
            "responde 409 y NO escribe (RN-25/RN-26).",
            "El `unit_price` NO se recalcula: la línea conserva el precio congelado (RN-18).",
            "El subtotal se recalcula como unit_price × quantity (RN-19).",
            "Cada escritura exitosa incrementa el `version` (RN-27).",
            "Devuelve una PROYECCIÓN de las líneas, no la tabla `ticket_items` (O-23).",
        ),
        errores=(
            "404 si el ticket o el ítem no existen.",
            "400 si la cantidad no es un entero positivo (RN-20).",
            "400 si el ticket está PAID (RN-23).",
            "409 si el `version` recibido no coincide con el actual (RN-25/RN-26).",
        ),
        estado_hoy="FASE 3.2",
    ),
    Contrato(
        numero=20,
        nombre="pos.quitar_item",
        consumidor="POS",
        proveedor="POS",
        operacion="DELETE /pos/tickets/{ticket_id}/items/{item_id}",
        entrada={
            "ticket_id": "UUID",
            "item_id": "String",
            "version": "Integer",
        },
        salida={
            "ticket_id": "UUID",
            "item_id": "String",
            "version": "Integer",
            "total": "Numeric(12,2)",
            "lineas": "List[{item_id, product_id, quantity, unit_price, subtotal}]",
        },
        garantias=(
            "ANTI-DEGRADACIÓN (RN-37): si quitar la línea reduce el total de líneas "
            "en más del 50%, la operación se RECHAZA con 400.",
            "El total se recalcula como la suma de los subtotales restantes (RN-16).",
            "Cada escritura exitosa incrementa el `version` (RN-27).",
            "Devuelve una PROYECCIÓN de las líneas, no la tabla `ticket_items` (O-23).",
        ),
        errores=(
            "404 si el ticket o el ítem no existen.",
            "400 si la reducción de líneas supera el 50% (RN-37).",
            "400 si el ticket está PAID (RN-23).",
            "409 si el `version` recibido no coincide con el actual (RN-25).",
        ),
        estado_hoy="FASE 3.2",
    ),
    Contrato(
        numero=21,
        nombre="pos.leer_ticket",
        consumidor="POS",
        proveedor="POS",
        operacion="GET /pos/tickets/{ticket_id}",
        entrada={"ticket_id": "UUID"},
        salida={
            "id": "UUID",
            "account_num": "String",
            "status": "String",
            "total": "Numeric(12,2)",
            "version": "Integer",
        },
        garantias=(
            "RESPUESTA LIGERA: devuelve EXACTAMENTE 5 campos escalares (Regla 15).",
            "NO devuelve las líneas: leer las líneas es responsabilidad de otro contrato.",
            "Devuelve una PROYECCIÓN, no la fila completa de `tickets` (O-23).",
            "`account_num` es el folio (presentación, RN-10); `id` es la identidad (RN-09).",
        ),
        errores=("404 si el ticket no existe.",),
        estado_hoy="FASE 3.2",
    ),
    Contrato(
        numero=22,
        nombre="pos.verificar_envio",
        consumidor="POS",
        proveedor="POS",
        operacion="POST /pos/tickets/{ticket_id}/verify",
        entrada={
            "ticket_id": "UUID",
            "item_ids": "List[String]",
            "cantidades": "List[Int] = [] (opcional, BUG-07)",
        },
        salida={
            "existe": "Boolean",
            "item_ids_persistidos": "List[String]",
            "faltantes": "List[String]",
        },
        garantias=(
            "VERIFICACIÓN POST-ENVÍO (v6.1 $453): confirma en la BASE DE DATOS que el "
            "ticket y sus ítems existen ANTES de que el frontend limpie el carrito.",
            "`existe` es True solo si el ticket está persistido.",
            "`faltantes` lista los `item_ids` que el cliente cree haber enviado pero "
            "que NO están en la BD: si no está vacío, el frontend NO debe limpiar.",
            "BUG-07: la cobertura es por UNIDADES (suma de `cantidades`), no por "
            "número de líneas, porque RN-17 fusiona los productos repetidos en una "
            "sola fila de `ticket_items`. Si `cantidades` se omite, se degrada al "
            "conteo de líneas (comportamiento previo, BUG-06).",
            "Es de SOLO LECTURA: no modifica el ticket ni sus líneas.",
        ),
        errores=("404 si el ticket no existe.",),
        estado_hoy="FASE 3.2",
    ),
    # ── FASE 5.0 — Pizarrón de cuentas abiertas ────────────────────────────
    Contrato(
        numero=23,
        nombre="pos.cuentas_abiertas",
        consumidor="POS",
        proveedor="POS",
        operacion="GET /pos/open-accounts",
        entrada={"terminal_id": "String = NULL (opcional)"},
        salida={"cuentas": "List[CuentaAbiertaSalida]"},
        garantias=(
            "Devuelve una PROYECCIÓN de las cuentas OPEN, no la tabla `tickets` (O-23).",
            "RESPUESTA LIGERA: cada cuenta expone campos escalares explícitos (Regla 15).",
            "F12.6 — PARIDAD DE PRESENTACIÓN: la proyección incluye terminal, "
            "capturista (nombre desnormalizado, patrón F10.5), cliente, teléfono, "
            "tipo de pedido, tipo de entrega y hora de creación, como el viejo POS.",
            "BUG-04 — CONTEXTO DE PEDIDO COMPLETO: la proyección incluye además "
            "`committed_at` (fecha compromiso de entrega), `packaging_type`, "
            "`delivery_address` y `order_notes`. Sin ellos, recuperar un PEDIDO del "
            "pizarrón perdía su fecha compromiso en el estado local del cliente.",
            "Si `terminal_id` viene, devuelve SOLO las cuentas de esa terminal (RN-31).",
            "FICHA_FIX_PIZARRON_422 — si `terminal_id` se OMITE (o viene vacío), "
            "devuelve TODAS las cuentas OPEN de TODAS las terminales (modo CAJA, D1).",
            "NO devuelve las líneas: leer las líneas es del contrato 21.",
        ),
        errores=(),
        estado_hoy="FASE 5.0 + F12.6 + FICHA_FIX_PIZARRON_422 + BUG-04",
    ),
    # ── §11 IA — Voz (proveedor: Centro de IA — DT-07 / FASE 7.0) ──────────
    Contrato(
        numero=24,
        nombre="ia.transcribir_voz",
        consumidor="POS",
        proveedor="Centro de IA",
        operacion="POST /ai/voice/transcribe",
        entrada={
            "audio_base64": "String",
            "formato": "String = 'webm'",
            "idioma": "String = 'es-MX'",
        },
        salida={
            "texto": "String",
            "confianza": "Float(0..1)",
            "duracion_ms": "Integer",
        },
        garantias=(
            "Transcribe el audio a texto en español. NO interpreta la intención.",
            "El POS decide qué hacer con el texto: la IA solo transcribe.",
            "Si el audio es silencio o ininteligible, devuelve `texto` vacío (200), no error.",
        ),
        errores=(
            "400 si `audio_base64` está vacío o excede 10 MB.",
            "503 `IA_NO_DISPONIBLE` si el motor de voz no está cargado.",
        ),
        estado_hoy="FASE 7.0",
    ),
    # ── §11 IA — NLU (proveedor: Centro de IA — DT-07 / FASE 7.0) ──────────
    Contrato(
        numero=25,
        nombre="ia.interpretar_intencion",
        consumidor="POS",
        proveedor="Centro de IA",
        operacion="POST /ai/voice/parse-intent",
        entrada={
            "texto": "String",
            "contexto": "Dict = {}",
        },
        salida={
            "intent": "String",
            "entidades": "Dict",
            "confianza": "Float(0..1)",
        },
        garantias=(
            "Traduce el texto a una intención estructurada (intent + entidades).",
            "El POS valida el intent contra su allowlist: la IA PROPONE, el operador CONFIRMA.",
            "Si no reconoce la intención, devuelve `intent='desconocido'` (200), no error.",
        ),
        errores=(
            "400 si `texto` está vacío.",
            "503 `IA_NO_DISPONIBLE` si el motor NLU no está cargado.",
        ),
        estado_hoy="FASE 7.0",
    ),
    # ── §12 CRM — Beneficios del cliente (proveedor: CRM — FASE 8.0) ───────
    Contrato(
        numero=26,
        nombre="clientes.beneficios_para_ticket",
        consumidor="POS",
        proveedor="CRM",
        operacion="POST /crm/benefits/for-ticket",
        entrada={
            "cliente_id": "String | None",
            "telefono": "String | None",
            "total": "String",
            "lineas": "List[Dict]",
        },
        salida={
            "beneficios": "List[Dict]",
            "puntos_disponibles": "Integer",
            "puntos_a_ganar": "Integer",
        },
        garantias=(
            "Devuelve los beneficios aplicables al ticket (puntos, promociones).",
            "El CRM es el dueño del cálculo; el POS solo muestra y aplica.",
            "Si el cliente no está identificado, devuelve lista vacía (200), no error.",
        ),
        errores=(
            "400 si `total` no es un String decimal válido.",
            "503 `CRM_NO_DISPONIBLE` si el CRM no responde; el POS degrada a sin beneficios.",
        ),
        estado_hoy="FASE 8.0",
    ),
    # ── §13 Notificaciones — Envío del ticket (proveedor: Notificaciones — FASE 8.0) ──
    Contrato(
        numero=27,
        nombre="notificaciones.encolar_ticket",
        consumidor="POS",
        proveedor="Notificaciones",
        operacion="POST /notifications/enqueue-ticket",
        entrada={
            "evento_id": "String (clave de idempotencia, RN-86)",
            "ticket_uuid": "UUID | None",
            "canales": "List[String] (WHATSAPP | EMAIL, RN-89)",
            "destinatario": "Dict ({telefono} | {email}, RN-90)",
            "payload": "Dict (folio, total, items, fecha)",
        },
        salida={
            "encolado": "Boolean",
            "mensajes": "List[{canal, estado, envio_id}]",
        },
        garantias=(
            "ENCOLA el envío del ticket (patrón Outbox, Regla de Oro #7).",
            "El POS encola dentro de la transacción del ticket; el worker envía después.",
            "El POS NUNCA envía directamente: solo encola.",
            "Idempotente por `evento_id` + canal (RN-86): reintentar no duplica.",
        ),
        errores=(
            "400 si `canales` está vacío, un canal no es soportado (RN-89) "
            "o el destino no corresponde al canal (RN-90).",
            "503 `NOTIFICACIONES_NO_DISPONIBLE` si la cola no responde; el POS no bloquea la venta.",
        ),
        estado_hoy="FASE 12.22",
    ),
    # ── §15 Caja — Eliminar movimiento (proveedor: Caja — FASE 10.6.2) ─────
    Contrato(
        numero=29,
        nombre="caja.eliminar_movimiento",
        consumidor="POS",
        proveedor="Caja",
        operacion="DELETE /cash/movements/{movement_id}",
        entrada={"movement_id": "UUID"},
        salida={"eliminado": "Boolean"},
        garantias=(
            "Solo se elimina un movimiento si la sesión está ABIERTA (RN-52).",
            "Una sesión CLOSED es inmutable: no se elimina nada (400).",
            "El viejo POS ya tenía esta operación (DELETE /cash/sessions/{id}/movements/{mid}); "
            "el nuevo POS la había OMITIDO. F10.6.2 restaura la paridad de operación.",
        ),
        errores=(
            "404 si el movimiento no existe.",
            "400 si la sesión del movimiento está cerrada (RN-52).",
        ),
        estado_hoy="FASE 10.6.2",
    ),
    # ── §15 POS — Lectura de líneas (proveedor: POS — FASE 12.10) ─────────
    Contrato(
        numero=30,
        nombre="pos.leer_lineas",
        consumidor="POS",
        proveedor="POS",
        operacion="GET /pos/tickets/{id}/items",
        entrada={
            "ticket_id": "UUID (path)",
        },
        salida={
            "ticket_id": "UUID",
            "version": "Integer",
            "total": "Numeric(12,2)",
            "lineas": "List[LineaAtomicaSalida]",
        },
        garantias=(
            "Cierra el hueco A-02 que dejó abierto la Regla 15: el contrato 21 "
            "devuelve EXACTAMENTE 5 campos escalares y NO las líneas, así que "
            "recuperar una cuenta del pizarrón no podía hidratar el carrito.",
            "Es de SOLO LECTURA: no escribe ni modifica el ticket.",
            "Devuelve una PROYECCIÓN de las líneas, nunca la tabla `ticket_items` (O-23).",
            "Devuelve `version` y `total` para que el cliente adopte la identidad "
            "completa de la cuenta al hidratar el carrito (RN-25).",
            "El `item_id` de cada línea es la clave de idempotencia que el cliente "
            "envió (contrato 18); se deriva del `product_id` (deuda D-9).",
        ),
        errores=(
            "404 si el ticket no existe.",
        ),
        estado_hoy="FASE 12.10",
    ),
    # ── §15 POS — Creación de ticket (proveedor: POS — FASE 12.9.1) ────────
    Contrato(
        numero=29,
        nombre="pos.crear_ticket",
        consumidor="POS",
        proveedor="POS",
        operacion="POST /pos/tickets",
        entrada={
            "terminal_id": "String",
            "channel": "String = 'PANADERIA'",
            "items": "List[{product_id: UUID, quantity: Integer}] = []",
            "order_type": "String = 'VENTA_DIRECTA'",
            "capturista_nombre": "String | None",
        },
        salida={
            "id": "UUID",
            "account_num": "String (folio V####, RN-10)",
            "status": "String (OPEN, RN-14)",
            "total": "Numeric(12,2)",
            "version": "Integer",
            "terminal_id": "String",
            "channel": "String",
            "items": "List[LineaSalida]",
            "payment_details": "Dict | None",
        },
        garantias=(
            "El ticket puede nacer SIN LÍNEAS (`items` vacío): es el flujo real "
            "del POS, que crea la cuenta vacía para obtener folio y `account_num`, "
            "y luego la llena por el contrato 18 (`pos.añadir_item`).",
            "Un ticket vacío es válido: nace OPEN con `total` = 0.00 y aparece en "
            "el pizarrón (contrato 23) hasta que se cobra.",
            "El `unit_price` y el `subtotal` los resuelve el servidor contra el "
            "catálogo (RN-18/RN-19); el cliente NO dicta precios.",
            "El ticket nace OPEN (RN-14) y con `version` 0 (RN-15).",
            "Exige una sesión de terminal activa (RN-24).",
            "Devuelve una PROYECCIÓN, no la fila completa de `tickets` (O-23).",
        ),
        errores=(
            "404 si la terminal no tiene sesión activa (RN-24).",
            "404 si algún `product_id` no existe (RN-21).",
            "400 si algún producto está inactivo (RN-22).",
            "400 si alguna `quantity` no es un entero positivo (RN-20).",
        ),
        estado_hoy="FASE 12.9.1",
    ),
    # ── §15 POS — Actualización de pedido (proveedor: POS — FASE 12.20) ─────
    Contrato(
        numero=31,
        nombre="pos.actualizar_pedido",
        consumidor="POS",
        proveedor="POS",
        operacion="PATCH /pos/tickets/{id}/order",
        entrada={
            "ticket_id": "UUID (path)",
            "version": "Integer (RN-25)",
            "order_type": "String | None",
            "order_status": "String | None",
            "delivery_type": "String | None",
            "customer_name": "String | None",
            "customer_phone": "String | None",
            "committed_at": "Datetime | None",
            "packaging_type": "String | None",
            "delivery_address": "String | None",
            "order_notes": "String | None",
        },
        salida={
            "id": "UUID",
            "account_num": "String (folio V####, RN-10)",
            "status": "String (OPEN, RN-14)",
            "total": "Numeric(12,2)",
            "version": "Integer",
            "terminal_id": "String",
            "channel": "String",
            "items": "List[LineaSalida]",
            "payment_details": "Dict | None",
        },
        garantias=(
            "Cierra el hueco del flujo REAL del POS 'productos primero, pedido "
            "después': el ticket nace VENTA_DIRECTA (contrato 29) y LUEGO se "
            "programa como PEDIDO. Sin este contrato, `guardarPedido` no podía "
            "persistir el bloque y el post-it del pizarrón no se distinguía de "
            "una cuenta normal.",
            "Semántica PATCH: solo se aplican los campos PRESENTES en la entrada. "
            "Un campo ausente NO se toca; un campo presente con `null` limpia el "
            "valor (permite revertir un pedido a venta directa).",
            "Valida concurrencia optimista (RN-25): `version` debe coincidir, si "
            "no responde 409.",
            "Un ticket PAID no se modifica (RN-23).",
            "Re-proyecta el pedido (contrato 15) en la MISMA transacción, con "
            "idempotencia por `ticket_id` (RN-68): el cambio se refleja en "
            "`orders` de inmediato.",
            "Devuelve una PROYECCIÓN, no la fila completa de `tickets` (O-23).",
        ),
        errores=(
            "404 si el ticket no existe.",
            "409 si el `version` no coincide (RN-25).",
            "400 si el ticket ya está PAID (RN-23).",
        ),
        estado_hoy="FASE 12.20",
    ),
    # ── §14 Estadísticas — Contexto diario (proveedor: POS — FASE 10.4) ─────
    Contrato(
        numero=28,
        nombre="pos.contexto_diario",
        consumidor="Estadísticas",
        proveedor="POS",
        operacion="PUT /pos/daily-context",
        entrada={
            "target_date": "Date (hora local)",
            "is_atypical": "Boolean = false",
            "weather_condition": "String | None",
            "notes": "String | None",
        },
        salida={
            "target_date": "Date (hora local)",
            "is_atypical": "Boolean",
            "weather_condition": "String | None",
            "notes": "String | None",
        },
        garantias=(
            "El POS captura el contexto del día tras el corte (clima, atípico, notas).",
            "El POS NO es dueño de la tabla `daily_contexts`: la posee Estadísticas.",
            "Es una DEUDA: el endpoint aún no existe en el nuevo POS (F10.4 lo porta).",
            "No bloquea la venta ni el cierre: si falla, el cajero puede omitirlo.",
        ),
        errores=(
            "400 si `target_date` no es una fecha válida.",
            "503 `ESTADISTICAS_NO_DISPONIBLE` si el módulo no responde; el POS no bloquea.",
        ),
        estado_hoy="Deuda",
    ),
    # ── §15 Cobro de ticket (proveedor: POS — FASE 3.3 / BUG-08) ────────────
    Contrato(
        numero=33,
        nombre="pos.cobrar_ticket",
        consumidor="POS (frontend)",
        proveedor="POS",
        operacion="POST /pos/tickets/{ticket_id}/pay",
        entrada={
            "ticket_id": "UUID (path)",
            "payment_details": "Dict (pagos mixtos: efectivo/tarjeta/transferencia)",
            "version": "Int (concurrencia optimista, RN-25)",
            "cobrador_nombre": "String | None",
            # DEUDA-BUG08 (Obs. 1): el nombre es heredado y engañoso. En el cobro
            # ajeno NO es «la sesión de caja del ticket», sino EL TURNO DE LA CAJA
            # QUE COBRA. Se conserva por compatibilidad; ver la nota de vocabulario.
            "cash_session_id": "UUID | None (opcional, BUG-08) — el turno de la caja que COBRA",
        },
        salida={
            "id": "UUID",
            "account_num": "String",
            "status": "String (PAID)",
            "total": "Decimal",
            "version": "Int",
        },
        garantias=(
            "El turno de caja lo determina la terminal que COBRA, no la de origen del ticket.",
            "`cash_session_id` es OPCIONAL (retrocompatibilidad): si falta, el backend usa el turno de la terminal del ticket.",
            "El backend VALIDA el turno declarado (E-13): existe (RN-49) + OPEN (RN-55) + su terminal tiene sesión activa (RN-24).",
            "El `terminal_id` del ticket NUNCA se sobreescribe (RN-12): el origen es trazabilidad inmutable.",
            "El dinero se cuenta en la caja que lo recibió (RN-53).",
            # DEUDA-BUG08 (Obs. 2): el fallback es legítimo pero OBSERVABLE.
            "Si se usa el fallback (sin `cash_session_id`), se escribe un asiento de auditoría (RN-75/76/77) con `extras.observacion = 'DEUDA-BUG08-OBS2'`.",
            "Con `POS_ESTRICTO_TURNO_CAJA` activo, el fallback se rechaza con 400: el cobro exige declarar el turno.",
        ),
        errores=(
            "404 si el ticket no existe.",
            "409 si el `version` no coincide (RN-25).",
            "400 si el ticket ya está PAID (RN-23).",
            "400 si no hay turno de caja abierto para la terminal que cobra (RN-49).",
            "400 si el `cash_session_id` declarado no existe o está cerrado (RN-55).",
            "400 si `POS_ESTRICTO_TURNO_CAJA` está activo y falta `cash_session_id` (DEUDA-BUG08 Obs. 2).",
        ),
        estado_hoy="FASE 3.3 / BUG-08",
    ),
)


def listar_contratos() -> tuple[Contrato, ...]:
    """Devuelve los 33 contratos del registro."""
    return CONTRATOS
