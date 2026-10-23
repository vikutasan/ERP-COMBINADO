"""La configuración transversal del ERP (system_settings) — FASE 7.5.1a.

Tabla: `system_settings`.

Esta es la capa de ALMACENAMIENTO de la directriz DT-06 (Configuración). El
patrón de DT-06 es:

    system_settings  →  Vista General  →  contexto global  →  cada módulo

Los valores transversales se declaran UNA vez (en Vista General, que es la UI)
y se guardan aquí (que es el almacén). Cada módulo los LEE; ninguno los
redefine. El POS no es la excepción: lee `order_payment_policy` de aquí.

Diseño clave/valor:
  - `key`   es la clave lógica (p. ej. `order_payment_policy`). Única.
  - `value` es el valor serializado como texto (JSON o escalar). Se guarda
    como texto para no acoplar el esquema a la forma de cada valor: la
    validación de la forma la hace el módulo que lo consume.

Por qué existe esta tabla (HALLAZGO D-4 de la autocrítica de F7.5):
  El plan v3.0 de F7.5 nombraba `system_settings` como si ya existiera. NO
  existía: los 17 modelos de la Fase 1 no la incluían. Esta es la lección de
  la REGLA DURA 2 ("verificar, no asumir"): un plan que nombra una tabla debe
  verificar que la tabla existe. Se crea aquí, con su migración, antes de que
  ningún código la lea.
"""

from __future__ import annotations

import uuid

from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.base import Base
from core.timestamps import utcnow


class SystemSetting(Base):
    """Un valor de configuración transversal, identificado por su clave.

    Es un almacén clave/valor deliberadamente simple: la forma del valor la
    conoce el módulo que lo consume, no la tabla. Así se pueden declarar
    valores nuevos (políticas, umbrales, topologías de IA) sin migrar el
    esquema cada vez.
    """

    __tablename__ = "system_settings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # La clave lógica. Única: una sola verdad por valor transversal.
    key: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    # El valor serializado como texto. NULL significa "no declarado": el
    # consumidor debe degradar a su default seguro (DT-07).
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Descripción humana del valor (para la UI de Vista General).
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[object] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
