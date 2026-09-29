from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import get_current_user
from app.database.session import get_db
from app.models.credit import CarbonCredit
from app.models.enums import OrderStatus, PortfolioStatus, ProjectStatus
from app.models.portfolio import OrderItem, Portfolio, PortfolioItem, SimulatedOrder
from app.models.project import Project
from app.models.score import ProjectScore
from app.models.user import User
from app.schemas.order import (
    CertificateResponse,
    OrderCreate,
    OrderItemResponse,
    OrderReportResponse,
    OrderResponse,
    QuoteItemResponse,
    QuoteRequest,
    QuoteResponse,
    ReportAllocation,
    ReportRiskSignal,
)
from app.services.reports import render_order_report_pdf


router = APIRouter(prefix="/orders", tags=["simulated orders"])
CENT = Decimal("0.01")
MILLI_CREDIT = Decimal("0.001")
DISCLAIMER_VERSION = "2026-09"
DISCLAIMER = (
    "Simulation only. No payment, transfer, registry retirement, or legal carbon claim occurs."
)
REPORT_VERSION = "1.0"


def load_owned_portfolio(db: Session, user_id: UUID, portfolio_id: UUID) -> Portfolio:
    portfolio = db.scalar(
        select(Portfolio)
        .where(Portfolio.id == portfolio_id, Portfolio.user_id == user_id)
        .options(
            selectinload(Portfolio.items)
            .joinedload(PortfolioItem.credit)
            .joinedload(CarbonCredit.project)
        )
    )
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    return portfolio


def quote_items(portfolio: Portfolio) -> list[QuoteItemResponse]:
    if not portfolio.items:
        raise HTTPException(status_code=422, detail="Portfolio must contain at least one holding.")
    items = []
    for holding in portfolio.items:
        credit = holding.credit
        if credit.project.status != ProjectStatus.ACTIVE:
            raise HTTPException(status_code=409, detail="A selected project is no longer active.")
        if credit.currency != portfolio.currency:
            raise HTTPException(status_code=409, detail="A selected credit currency has changed.")
        if holding.quantity > credit.quantity_available:
            raise HTTPException(
                status_code=409,
                detail=f"Insufficient availability for credit {credit.id}.",
            )
        line_total = (holding.quantity * credit.price_per_credit).quantize(
            CENT, rounding=ROUND_HALF_UP
        )
        items.append(
            QuoteItemResponse(
                credit_id=credit.id,
                project_id=credit.project_id,
                project_name=credit.project.name,
                vintage=credit.vintage,
                quantity=float(holding.quantity),
                unit_price=float(credit.price_per_credit),
                line_total=float(line_total),
                currency=credit.currency,
                quantity_available=float(credit.quantity_available),
            )
        )
    return sorted(items, key=lambda item: (str(item.project_id), item.vintage, str(item.credit_id)))


def build_quote(portfolio: Portfolio) -> QuoteResponse:
    items = quote_items(portfolio)
    return QuoteResponse(
        portfolio_id=portfolio.id,
        items=items,
        total_cost=float(sum((Decimal(str(item.line_total)) for item in items), Decimal("0"))),
        total_credits=float(sum((Decimal(str(item.quantity)) for item in items), Decimal("0"))),
        currency=portfolio.currency,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        disclaimer=DISCLAIMER,
    )


def order_query():
    return select(SimulatedOrder).options(selectinload(SimulatedOrder.items))


def load_owned_order(db: Session, user_id: UUID, order_id: UUID) -> SimulatedOrder:
    order = db.scalar(
        order_query().where(
            SimulatedOrder.id == order_id,
            SimulatedOrder.user_id == user_id,
        )
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Simulated order not found.")
    return order


def order_response(order: SimulatedOrder) -> OrderResponse:
    items = sorted(order.items, key=lambda item: (item.project_name_snapshot, item.vintage))
    certificate = None
    if order.certificate_reference is not None:
        certificate = CertificateResponse(
            reference=order.certificate_reference,
            issued_at=order.certificate_issued_at,
            quantity=float(order.retirement_quantity),
            statement=(
                "Simulated retirement certificate only. This is not a registry-issued retirement."
            ),
        )
    return OrderResponse(
        id=order.id,
        reference=order.reference,
        portfolio_id=order.portfolio_id,
        status=order.status,
        total_cost_snapshot=float(order.total_cost_snapshot),
        total_credits_snapshot=float(order.total_credits_snapshot),
        currency=items[0].currency,
        disclaimer_version=order.disclaimer_version,
        created_at=order.created_at,
        cancelled_at=order.cancelled_at,
        items=[
            OrderItemResponse(
                id=item.id,
                credit_id=item.credit_id,
                project_id=item.project_id,
                project_name=item.project_name_snapshot,
                vintage=item.vintage,
                quantity=float(item.quantity),
                unit_price_snapshot=float(item.unit_price_snapshot),
                line_total_snapshot=float(item.line_total_snapshot),
                currency=item.currency,
            )
            for item in items
        ],
        simulated_retirement_certificate=certificate,
    )


def latest_project_score(project: Project) -> ProjectScore | None:
    if not project.scores:
        return None
    return max(project.scores, key=lambda score: (score.calculated_at, str(score.id)))


def report_response(order: SimulatedOrder, user: User) -> OrderReportResponse:
    limitations: set[str] = set()
    allocations: list[ReportAllocation] = []
    total_credits = Decimal(order.total_credits_snapshot)

    for item in sorted(
        order.items, key=lambda value: (value.project_name_snapshot, value.vintage)
    ):
        if not item.registry_snapshot:
            limitations.add("Registry information was unavailable when this order was created.")
        if not item.methodology_snapshot:
            limitations.add("Methodology information was unavailable when this order was created.")
        if not item.source_url_snapshot:
            limitations.add("A source URL was unavailable when this order was created.")
        if item.carboniq_score_snapshot is None:
            limitations.add("A CarbonIQ score was unavailable when this order was created.")
        if item.risk_signals_snapshot is None:
            limitations.add("Risk signals were not captured for this legacy order.")

        risk_signals = [
            ReportRiskSignal.model_validate(signal)
            for signal in (item.risk_signals_snapshot or [])
        ]
        allocation_percent = (
            Decimal(item.quantity) / total_credits * Decimal("100")
            if total_credits
            else Decimal("0")
        )
        allocations.append(
            ReportAllocation(
                credit_id=item.credit_id,
                project_id=item.project_id,
                project_name=item.project_name_snapshot,
                vintage=item.vintage,
                quantity=float(item.quantity),
                unit_price_snapshot=float(item.unit_price_snapshot),
                line_total_snapshot=float(item.line_total_snapshot),
                allocation_percent=float(allocation_percent),
                registry=item.registry_snapshot,
                methodology=item.methodology_snapshot,
                source_url=item.source_url_snapshot,
                data_as_of=item.data_as_of_snapshot,
                carboniq_score=(
                    float(item.carboniq_score_snapshot)
                    if item.carboniq_score_snapshot is not None
                    else None
                ),
                quality_score=(
                    float(item.quality_score_snapshot)
                    if item.quality_score_snapshot is not None
                    else None
                ),
                risk_score=(
                    float(item.risk_score_snapshot)
                    if item.risk_score_snapshot is not None
                    else None
                ),
                score_methodology_version=item.score_methodology_version_snapshot,
                risk_signals=risk_signals,
            )
        )

    certificate = order_response(order).simulated_retirement_certificate
    return OrderReportResponse(
        report_version=REPORT_VERSION,
        generated_at=datetime.now(timezone.utc),
        order_id=order.id,
        order_reference=order.reference,
        order_status=order.status,
        order_created_at=order.created_at,
        cancelled_at=order.cancelled_at,
        buyer_organization=user.organization_name,
        currency=order.items[0].currency,
        total_cost_snapshot=float(order.total_cost_snapshot),
        total_credits=float(total_credits),
        estimated_carbon_impact_tonnes=float(total_credits),
        allocations=allocations,
        simulated_retirement_certificate=certificate,
        limitations=sorted(limitations)
        or [
            "Scores and risk signals are decision-support indicators, not independent "
            "assurance or investment advice."
        ],
        disclaimer=DISCLAIMER,
    )


def update_project_availability(db: Session, project_ids: set[UUID]) -> None:
    db.flush()
    for project_id in project_ids:
        total = db.scalar(
            select(func.coalesce(func.sum(CarbonCredit.quantity_available), 0)).where(
                CarbonCredit.project_id == project_id
            )
        )
        project = db.get(Project, project_id)
        project.available_quantity = Decimal(total).quantize(
            MILLI_CREDIT, rounding=ROUND_HALF_UP
        )


@router.post("/quote", response_model=QuoteResponse)
def create_quote(
    payload: QuoteRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> QuoteResponse:
    portfolio = load_owned_portfolio(db, current_user.id, payload.portfolio_id)
    if portfolio.status == PortfolioStatus.ORDERED:
        raise HTTPException(status_code=409, detail="Portfolio has already been ordered.")
    return build_quote(portfolio)


class SimulateOrderRequest(BaseModel):
    portfolio_id: UUID


@router.post("/simulate")
def simulate_order(
    payload: SimulateOrderRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    from app.api.routes.portfolios import get_owned_portfolio, portfolio_response

    portfolio = db.scalar(
        select(Portfolio)
        .where(Portfolio.id == payload.portfolio_id, Portfolio.user_id == current_user.id)
    )
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found.")

    existing_order = db.scalar(
        select(SimulatedOrder).where(SimulatedOrder.portfolio_id == portfolio.id)
    )
    if existing_order:
        order = existing_order
    else:
        order_payload = OrderCreate(
            portfolio_id=portfolio.id,
            acknowledge_simulation=True,
            simulate_retirement=False,
        )
        order = create_order(order_payload, current_user, db)

    port_resp = portfolio_response(get_owned_portfolio(db, current_user.id, portfolio.id))
    return {
        "id": str(order.id),
        "portfolio": port_resp.model_dump(mode="json"),
        "created_at": order.created_at.isoformat() if hasattr(order, "created_at") else datetime.now(timezone.utc).isoformat(),
        "disclaimer": "Demonstration only. No credits were purchased, transferred or retired.",
        "disclaimer_version": "1.0.0",
    }


@router.post("", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
def create_order(
    payload: OrderCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> OrderResponse:
    portfolio = db.scalar(
        select(Portfolio)
        .where(Portfolio.id == payload.portfolio_id, Portfolio.user_id == current_user.id)
        .with_for_update()
    )
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    if portfolio.status == PortfolioStatus.ORDERED:
        raise HTTPException(status_code=409, detail="Portfolio has already been ordered.")

    holdings = list(
        db.scalars(
            select(PortfolioItem)
            .where(PortfolioItem.portfolio_id == portfolio.id)
            .order_by(PortfolioItem.credit_id)
        )
    )
    if not holdings:
        raise HTTPException(status_code=422, detail="Portfolio must contain at least one holding.")

    credit_ids = [holding.credit_id for holding in holdings]
    project_ids = set(
        db.scalars(
            select(CarbonCredit.project_id).where(CarbonCredit.id.in_(credit_ids))
        )
    )
    projects = list(
        db.scalars(
            select(Project)
            .where(Project.id.in_(project_ids))
            .options(
                selectinload(Project.scores),
                selectinload(Project.risk_signals),
            )
            .order_by(Project.id)
            .with_for_update()
        ).unique()
    )
    credits = list(
        db.scalars(
            select(CarbonCredit)
            .where(CarbonCredit.id.in_(credit_ids))
            .order_by(CarbonCredit.id)
            .with_for_update()
        )
    )
    credit_by_id = {credit.id: credit for credit in credits}
    project_by_id = {project.id: project for project in projects}

    total_cost = Decimal("0")
    total_credits = Decimal("0")
    order = SimulatedOrder(
        reference=f"CIQ-DEMO-{datetime.now(timezone.utc).year}-{uuid4().hex[:10].upper()}",
        user_id=current_user.id,
        portfolio_id=portfolio.id,
        status=OrderStatus.SIMULATED,
        total_cost_snapshot=Decimal("0"),
        total_credits_snapshot=Decimal("0"),
        disclaimer_version=DISCLAIMER_VERSION,
    )
    for holding in holdings:
        credit = credit_by_id.get(holding.credit_id)
        if credit is None:
            raise HTTPException(status_code=409, detail="A selected credit no longer exists.")
        project = project_by_id[credit.project_id]
        if project.status != ProjectStatus.ACTIVE:
            raise HTTPException(status_code=409, detail="A selected project is no longer active.")
        if credit.currency != portfolio.currency:
            raise HTTPException(status_code=409, detail="A selected credit currency has changed.")
        if holding.quantity > credit.quantity_available:
            raise HTTPException(
                status_code=409,
                detail=f"Insufficient availability for credit {credit.id}.",
            )
        line_total = (holding.quantity * credit.price_per_credit).quantize(
            CENT, rounding=ROUND_HALF_UP
        )
        score = latest_project_score(project)
        risk_snapshot = [
            {
                "code": signal.code,
                "severity": signal.severity.value,
                "title": signal.title,
                "message": signal.message,
                "rule_version": signal.rule_version,
            }
            for signal in sorted(
                (signal for signal in project.risk_signals if signal.resolved_at is None),
                key=lambda signal: (signal.severity.value, signal.code),
            )
        ]
        credit.quantity_available -= holding.quantity
        total_cost += line_total
        total_credits += holding.quantity
        order.items.append(
            OrderItem(
                credit=credit,
                project_id=project.id,
                project_name_snapshot=project.name,
                vintage=credit.vintage,
                quantity=holding.quantity,
                unit_price_snapshot=credit.price_per_credit,
                line_total_snapshot=line_total,
                currency=credit.currency,
                registry_snapshot=project.registry,
                methodology_snapshot=project.methodology,
                source_url_snapshot=project.source_url,
                data_as_of_snapshot=project.data_as_of,
                carboniq_score_snapshot=score.carboniq_score if score else None,
                quality_score_snapshot=score.quality_score if score else None,
                risk_score_snapshot=score.risk_score if score else None,
                score_methodology_version_snapshot=(
                    score.methodology_version if score else None
                ),
                risk_signals_snapshot=risk_snapshot,
            )
        )

    order.total_cost_snapshot = total_cost.quantize(CENT, rounding=ROUND_HALF_UP)
    order.total_credits_snapshot = total_credits.quantize(
        MILLI_CREDIT, rounding=ROUND_HALF_UP
    )
    if payload.simulate_retirement:
        order.certificate_reference = (
            f"CIQ-RET-{datetime.now(timezone.utc).year}-{uuid4().hex[:10].upper()}"
        )
        order.certificate_issued_at = datetime.now(timezone.utc)
        order.retirement_quantity = order.total_credits_snapshot
    portfolio.status = PortfolioStatus.ORDERED
    db.add(order)
    update_project_availability(db, project_ids)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Portfolio has already been ordered.") from exc
    return order_response(load_owned_order(db, current_user.id, order.id))


@router.get("", response_model=list[OrderResponse])
def list_orders(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[OrderResponse]:
    orders = db.scalars(
        order_query()
        .where(SimulatedOrder.user_id == current_user.id)
        .order_by(SimulatedOrder.created_at.desc(), SimulatedOrder.id)
    )
    return [order_response(order) for order in orders]


@router.get("/{order_id}/report", response_model=None)
def download_order_report(
    order_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    report_format: Annotated[Literal["json", "pdf"], Query(alias="format")] = "json",
) -> Response:
    """Return an owner-scoped evidence report for a completed simulated order."""
    report = report_response(load_owned_order(db, current_user.id, order_id), current_user)
    if report_format == "json":
        return JSONResponse(content=jsonable_encoder(report))

    filename = f"carboniq-{report.order_reference.lower()}.pdf"
    return Response(
        content=render_order_report_pdf(report),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/{order_id}", response_model=OrderResponse)
def read_order(
    order_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> OrderResponse:
    return order_response(load_owned_order(db, current_user.id, order_id))


@router.post("/{order_id}/cancel", response_model=OrderResponse)
def cancel_order(
    order_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> OrderResponse:
    existing = db.scalar(
        select(SimulatedOrder).where(
            SimulatedOrder.id == order_id,
            SimulatedOrder.user_id == current_user.id,
        )
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Simulated order not found.")
    db.scalar(select(Portfolio).where(Portfolio.id == existing.portfolio_id).with_for_update())
    order = db.scalar(
        order_query().where(SimulatedOrder.id == order_id).with_for_update()
    )
    if order.status == OrderStatus.CANCELLED:
        return order_response(order)

    project_ids = {item.project_id for item in order.items}
    list(
        db.scalars(
            select(Project)
            .where(Project.id.in_(project_ids))
            .order_by(Project.id)
            .with_for_update()
        )
    )
    credits = list(
        db.scalars(
            select(CarbonCredit)
            .where(CarbonCredit.id.in_([item.credit_id for item in order.items]))
            .order_by(CarbonCredit.id)
            .with_for_update()
        )
    )
    credit_by_id = {credit.id: credit for credit in credits}
    for item in order.items:
        credit_by_id[item.credit_id].quantity_available += item.quantity
    order.status = OrderStatus.CANCELLED
    order.cancelled_at = datetime.now(timezone.utc)
    update_project_availability(db, project_ids)
    db.commit()
    return order_response(load_owned_order(db, current_user.id, order.id))
