"""Router de sincronización central y multi-sucursal -- MS-03.

Endpoints:
  - POST /sync/push                -> Consolidar lotes desde sucursales (idempotente)
  - GET  /sync/pull                -> Obtener catálogo maestro para sucursales
  - GET  /sync/conflicts           -> Listar conflictos auditables
  - POST /sync/conflicts/{id}/resolve -> Resolver un conflicto manualmente
  - GET  /sync/dashboard/sales     -> KPIs y ventas consolidadas por sucursal
"""

from __future__ import annotations

import uuid
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.timestamps import utcnow
from models.catalog import Category, Product
from models.sync import Branch, CentralConsolidatedRecord, SyncConflict
from schemas.sync import (
    BranchDashboardItem,
    CatalogPullSalida,
    ConflictSalida,
    DashboardConsolidadoSalida,
    ResolveConflictEntrada,
    SyncPushEntrada,
    SyncPushSalida,
)

router = APIRouter(prefix="/sync", tags=["sincronizacion"])


# ---------------------------------------------------------------------------
# POST /sync/push -- Recepción de lotes de sucursal
# ---------------------------------------------------------------------------

@router.post("/push", response_model=SyncPushSalida)
async def push_sync(
    entrada: SyncPushEntrada,
    db: AsyncSession = Depends(get_db),
) -> SyncPushSalida:
    """Recibe un lote de datos de una sucursal (ventas, caja, inventario, catálogo).

    Principios garantizados:
      - P1 Unidireccional: la sucursal empuja sus datos.
      - P3 Idempotente: la clave (branch_id, domain, record_uuid) previene duplicaciones.
      - P5 Auditable y resolución de conflictos: cualquier discrepancia se registra
        en `sync_conflicts` para revisión manual; NUNCA se descarta en silencio.
    """
    # 1. Registrar o actualizar la sucursal y su último contacto
    stmt_branch = select(Branch).where(Branch.code == entrada.branch_id)
    res_branch = await db.execute(stmt_branch)
    branch = res_branch.scalar_one_or_none()

    ahora = utcnow()
    if branch is None:
        branch = Branch(
            code=entrada.branch_id,
            name=f"Sucursal {entrada.branch_id}",
            status="ACTIVE",
            last_sync_at=ahora,
            created_at=ahora,
        )
        db.add(branch)
    else:
        branch.last_sync_at = ahora

    recibidos_nuevos = 0
    conflictos_detectados = 0

    # 2. Procesar cada registro
    for rec in entrada.records:
        record_uuid = str(rec.get("uuid") or rec.get("id") or "")
        if not record_uuid:
            record_uuid = str(uuid.uuid4())
            rec["uuid"] = record_uuid

        stmt_rec = select(CentralConsolidatedRecord).where(
            CentralConsolidatedRecord.branch_id == entrada.branch_id,
            CentralConsolidatedRecord.domain == entrada.domain,
            CentralConsolidatedRecord.record_uuid == record_uuid,
        )
        res_rec = await db.execute(stmt_rec)
        existente = res_rec.scalar_one_or_none()

        if existente is not None:
            # Ya existe. Verificar si es idéntico (idempotencia pura) o si hay discrepancia (conflicto)
            if existente.payload != rec:
                # Discrepancia detectada: verificar si ya fue registrado como conflicto abierto
                stmt_conf = select(SyncConflict).where(
                    SyncConflict.branch_id == entrada.branch_id,
                    SyncConflict.domain == entrada.domain,
                    SyncConflict.record_uuid == record_uuid,
                    SyncConflict.resolved == False,  # noqa: E712
                )
                res_conf = await db.execute(stmt_conf)
                conflicto_existente = res_conf.scalar_one_or_none()

                if not conflicto_existente:
                    nuevo_conflicto = SyncConflict(
                        branch_id=entrada.branch_id,
                        domain=entrada.domain,
                        record_uuid=record_uuid,
                        conflict_reason="PAYLOAD_MISMATCH",
                        payload_local=existente.payload,
                        payload_remote=rec,
                        resolved=False,
                        created_at=ahora,
                    )
                    db.add(nuevo_conflicto)
                conflictos_detectados += 1
            # Si el payload es idéntico, simplemente se ignora (idempotencia)
        else:
            # Nuevo registro consolidado
            nuevo_registro = CentralConsolidatedRecord(
                branch_id=entrada.branch_id,
                domain=entrada.domain,
                record_uuid=record_uuid,
                payload=rec,
                schema_version=entrada.schema_version,
                received_at=ahora,
            )
            db.add(nuevo_registro)
            recibidos_nuevos += 1

    await db.commit()

    return SyncPushSalida(
        status="ok",
        received=recibidos_nuevos,
        conflicts=conflictos_detectados,
        message=f"Consolidación exitosa: {recibidos_nuevos} nuevos, {conflictos_detectados} conflictos.",
    )


# ---------------------------------------------------------------------------
# GET /sync/pull -- Catálogo maestro para sucursales
# ---------------------------------------------------------------------------

@router.get("/pull", response_model=CatalogPullSalida)
async def pull_catalogo(
    domain: str = Query("catalog", description="Dominio a sincronizar"),
    db: AsyncSession = Depends(get_db),
) -> CatalogPullSalida:
    """Provee el catálogo maestro de categorías y productos a las sucursales."""
    if domain not in ("catalog", "catalogo"):
        raise HTTPException(status_code=400, detail=f"Dominio pull '{domain}' no soportado")

    stmt_cats = select(Category).order_by(Category.position.nulls_last(), Category.name)
    cats_res = await db.execute(stmt_cats)
    categories = [
        {
            "id": str(c.id),
            "name": c.name,
            "icon": c.icon,
            "position": c.position,
            "pos_target": c.pos_target,
        }
        for c in cats_res.scalars().all()
    ]

    stmt_prods = select(Product).where(Product.active == True)  # noqa: E712
    prods_res = await db.execute(stmt_prods)
    products = [
        {
            "id": str(p.id),
            "sku": p.sku,
            "name": p.name,
            "category_id": str(p.category_id) if p.category_id else None,
            "price": float(p.price) if p.price is not None else 0.0,
            "barcode": p.barcode,
            "active": p.active,
        }
        for p in prods_res.scalars().all()
    ]

    return CatalogPullSalida(
        schema_version="1.0",
        total_products=len(products),
        products=products,
        categories=categories,
        synced_at=utcnow(),
    )


# ---------------------------------------------------------------------------
# GET /sync/conflicts -- Listado de conflictos
# ---------------------------------------------------------------------------

@router.get("/conflicts", response_model=list[ConflictSalida])
async def listar_conflictos(
    branch_id: str | None = Query(None, description="Filtrar por sucursal"),
    resolved: bool | None = Query(False, description="Filtrar por estado de resolución"),
    db: AsyncSession = Depends(get_db),
) -> list[ConflictSalida]:
    """Lista los conflictos detectados para revisión de auditoría."""
    stmt = select(SyncConflict)
    if branch_id:
        stmt = stmt.where(SyncConflict.branch_id == branch_id)
    if resolved is not None:
        stmt = stmt.where(SyncConflict.resolved == resolved)

    stmt = stmt.order_by(SyncConflict.created_at.desc())
    res = await db.execute(stmt)
    return list(res.scalars().all())


# ---------------------------------------------------------------------------
# POST /sync/conflicts/{id}/resolve -- Resolución de conflicto
# ---------------------------------------------------------------------------

@router.post("/conflicts/{conflict_id}/resolve", response_model=ConflictSalida)
async def resolver_conflicto(
    conflict_id: UUID,
    entrada: ResolveConflictEntrada,
    db: AsyncSession = Depends(get_db),
) -> ConflictSalida:
    """Marca un conflicto como resuelto con notas del auditor."""
    stmt = select(SyncConflict).where(SyncConflict.id == conflict_id)
    res = await db.execute(stmt)
    conflicto = res.scalar_one_or_none()

    if not conflicto:
        raise HTTPException(status_code=404, detail="Conflicto no encontrado")

    conflicto.resolved = True
    conflicto.resolution_notes = entrada.resolution_notes
    conflicto.resolved_at = utcnow()

    await db.commit()
    await db.refresh(conflicto)
    return conflicto


# ---------------------------------------------------------------------------
# GET /sync/dashboard/sales -- Dashboard consolidado multi-sucursal
# ---------------------------------------------------------------------------

@router.get("/dashboard/sales", response_model=DashboardConsolidadoSalida)
async def dashboard_ventas_consolidadas(
    db: AsyncSession = Depends(get_db),
) -> DashboardConsolidadoSalida:
    """Calcula KPIs consolidados agrupados por sucursal."""
    # Obtener todas las sucursales
    stmt_branches = select(Branch).order_by(Branch.code)
    branches_res = await db.execute(stmt_branches)
    branches = branches_res.scalars().all()

    # Obtener todos los registros consolidados del dominio ventas
    stmt_ventas = select(CentralConsolidatedRecord).where(CentralConsolidatedRecord.domain == "ventas")
    ventas_res = await db.execute(stmt_ventas)
    ventas = ventas_res.scalars().all()

    # Obtener conflictos pendientes agrupados por sucursal
    stmt_conf = select(SyncConflict.branch_id, func.count(SyncConflict.id)).where(
        SyncConflict.resolved == False  # noqa: E712
    ).group_by(SyncConflict.branch_id)
    conf_res = await db.execute(stmt_conf)
    conflictos_por_sucursal = dict(conf_res.all())

    # Agrupar ventas por sucursal
    ventas_por_sucursal: dict[str, list[dict[str, Any]]] = {}
    for v in ventas:
        ventas_por_sucursal.setdefault(v.branch_id, []).append(v.payload)

    sucursales_items: list[BranchDashboardItem] = []
    gran_total_ventas = 0.0
    gran_total_tickets = 0

    for b in branches:
        v_list = ventas_por_sucursal.get(b.code, [])
        total_branch_ventas = sum(float(item.get("total", 0.0)) for item in v_list)
        tickets_count = len(v_list)
        ticket_prom = round(total_branch_ventas / tickets_count, 2) if tickets_count > 0 else 0.0
        confs = conflictos_por_sucursal.get(b.code, 0)

        gran_total_ventas += total_branch_ventas
        gran_total_tickets += tickets_count

        sucursales_items.append(
            BranchDashboardItem(
                branch_id=b.code,
                branch_name=b.name,
                status=b.status,
                last_sync_at=b.last_sync_at,
                total_ventas=round(total_branch_ventas, 2),
                total_tickets=tickets_count,
                ticket_promedio=ticket_prom,
                total_conflicts=confs,
            )
        )

    # También incluir sucursales que tengan ventas registradas aunque no estén explícitas en branches
    known_codes = {b.code for b in branches}
    for code, v_list in ventas_por_sucursal.items():
        if code not in known_codes:
            total_branch_ventas = sum(float(item.get("total", 0.0)) for item in v_list)
            tickets_count = len(v_list)
            ticket_prom = round(total_branch_ventas / tickets_count, 2) if tickets_count > 0 else 0.0
            confs = conflictos_por_sucursal.get(code, 0)

            gran_total_ventas += total_branch_ventas
            gran_total_tickets += tickets_count

            sucursales_items.append(
                BranchDashboardItem(
                    branch_id=code,
                    branch_name=f"Sucursal {code}",
                    status="ACTIVE",
                    last_sync_at=None,
                    total_ventas=round(total_branch_ventas, 2),
                    total_tickets=tickets_count,
                    ticket_promedio=ticket_prom,
                    total_conflicts=confs,
                )
            )

    activas_count = sum(1 for s in sucursales_items if s.status == "ACTIVE")
    total_confs_pendientes = sum(conflictos_por_sucursal.values())

    return DashboardConsolidadoSalida(
        sucursales=sucursales_items,
        gran_total_ventas=round(gran_total_ventas, 2),
        gran_total_tickets=gran_total_tickets,
        sucursales_activas=activas_count,
        conflictos_pendientes=total_confs_pendientes,
    )
