"""Modelos de Seguridad y Acceso — FASE 3.1.

Estos modelos describen EXACTAMENTE las dos tablas que la FASE 2.4 ya pobló en
`erp_seguridad`:

  - `security_profiles` — los 6 perfiles de acceso (permisos en JSONB).
  - `employees`         — los 64 colaboradores, con su PIN y su perfil.

No se inventa ni se renombra ninguna columna: si el modelo y la tabla
discrepan, Alembic generaría una migración destructiva y se perderían los
datos importados. Por eso cada tipo y cada longitud se copia de la tabla real.

O-23 (contrato 7): el POS NUNCA lee estas tablas. Solo ve una PROYECCIÓN
(nombre, perfil, permisos) que arma el router. El PIN no sale nunca de aquí
salvo por el contrato 8, que lo compara y devuelve un booleano.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base


class SecurityProfile(Base):
    """Un perfil de acceso: agrupa permisos y se asigna a los colaboradores.

    `permissions` es JSONB porque la forma de un permiso cambia con el negocio
    (módulos nuevos, acciones nuevas) y no queremos una migración por cada
    permiso. El contrato 7 lo entrega como `List[String]`; la traducción de
    JSONB a lista de claves la hace el router, no el modelo.
    """

    __tablename__ = "security_profiles"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    permissions: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    is_system: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("(now() AT TIME ZONE 'utc')"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("(now() AT TIME ZONE 'utc')"),
        onupdate=func.now(),
    )

    # Un perfil tiene muchos colaboradores. `passive_deletes` deja que el
    # ON DELETE SET NULL de la FK haga su trabajo sin que SQLAlchemy intente
    # ponerlos a NULL uno por uno.
    employees: Mapped[list["Employee"]] = relationship(
        back_populates="profile", passive_deletes=True
    )

    def __repr__(self) -> str:  # pragma: no cover - ayuda de depuración
        return f"<SecurityProfile {self.name!r}>"


class Employee(Base):
    """Un colaborador: la identidad que el POS usa para abrir un turno.

    `employee_code` es el PIN. Es único y de 16 caracteres como máximo porque
    en producción es un número corto; el contrato 8 lo compara por igualdad
    exacta, nunca por prefijo.

    `is_active` es la única puerta de baja: un colaborador inactivo no puede
    validar su PIN (el contrato 8 devuelve `valido=false`), pero su fila se
    conserva para que la auditoría histórica siga teniendo nombre.
    """

    __tablename__ = "employees"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    employee_code: Mapped[str] = mapped_column(
        String(16), nullable=False, unique=True
    )
    role: Mapped[str] = mapped_column(
        String(60), nullable=False, server_default=text("'CAJERO'")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    profile_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("security_profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    employee_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exclude_attendance: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("(now() AT TIME ZONE 'utc')"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("(now() AT TIME ZONE 'utc')"),
        onupdate=func.now(),
    )

    profile: Mapped[SecurityProfile | None] = relationship(
        back_populates="employees"
    )

    def __repr__(self) -> str:  # pragma: no cover - ayuda de depuración
        return f"<Employee {self.name!r} code={self.employee_code!r}>"
