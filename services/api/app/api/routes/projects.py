from __future__ import annotations

from math import ceil
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.database.session import get_db
from app.models.enums import ProjectCategory, ProjectStatus, VerificationStatus
from app.models.project import Project
from app.models.score import ProjectScore
from app.schemas.project import (
    CreditResponse,
    DocumentResponse,
    ProjectCompareRequest,
    ProjectCompareResponse,
    ProjectDetail,
    ProjectPage,
    ProjectSummary,
    RiskSignalResponse,
    ScoreSummary,
)


router = APIRouter(prefix="/projects", tags=["projects"])

PROJECT_REQUIRED_FIELDS = {
    "external_id",
    "name",
    "slug",
    "developer_name",
    "description",
    "country_code",
    "project_type",
    "category",
    "registry",
    "verification_status",
    "status",
    "source_url",
    "data_as_of",
    "is_synthetic",
}


def latest_scores_subquery():
    ranked = (
        select(
            ProjectScore.project_id,
            ProjectScore.carboniq_score,
            ProjectScore.quality_score,
            ProjectScore.impact_score,
            ProjectScore.risk_score,
            ProjectScore.confidence,
            ProjectScore.methodology_version,
            ProjectScore.calculated_at,
            func.row_number()
            .over(
                partition_by=ProjectScore.project_id,
                order_by=(ProjectScore.calculated_at.desc(), ProjectScore.id.desc()),
            )
            .label("row_number"),
        )
        .subquery()
    )
    return select(ranked).where(ranked.c.row_number == 1).subquery()


def summary_from_row(project: Project, score) -> ProjectSummary:
    return ProjectSummary.model_validate(
        {
            **{column.name: getattr(project, column.name) for column in Project.__table__.columns},
            "carboniq_score": score.carboniq_score,
            "impact_score": score.impact_score,
            "risk_score": score.risk_score,
            "confidence": score.confidence,
        }
    )


def score_summary(score: ProjectScore | None) -> ScoreSummary | None:
    if score is None:
        return None
    return ScoreSummary.model_validate(
        {
            "carboniq_score": score.carboniq_score,
            "quality_score": score.quality_score,
            "impact_score": score.impact_score,
            "risk_score": score.risk_score,
            "confidence": score.confidence,
            "methodology_version": score.methodology_version,
            "calculated_at": score.calculated_at,
        }
    )


def detail_from_project(project: Project) -> ProjectDetail:
    latest_score = max(
        project.scores,
        key=lambda item: (item.calculated_at, str(item.id)),
        default=None,
    )
    base = {column.name: getattr(project, column.name) for column in Project.__table__.columns}
    return ProjectDetail.model_validate(
        {
            **base,
            "carboniq_score": latest_score.carboniq_score if latest_score else None,
            "risk_score": latest_score.risk_score if latest_score else None,
            "confidence": latest_score.confidence if latest_score else None,
            "latest_score": score_summary(latest_score),
            "active_risk_signals": [
                RiskSignalResponse.model_validate(signal)
                for signal in project.risk_signals
                if signal.resolved_at is None
            ],
            "inventory": [CreditResponse.model_validate(credit) for credit in project.credits],
            "documents": [
                DocumentResponse.model_validate(document) for document in project.documents
            ],
        }
    )


def load_public_project(db: Session, project_id: UUID) -> Project:
    project = db.scalar(
        select(Project)
        .where(Project.id == project_id, Project.status == ProjectStatus.ACTIVE)
        .options(
            selectinload(Project.scores),
            selectinload(Project.risk_signals),
            selectinload(Project.credits),
            selectinload(Project.documents),
        )
    )
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    return project


def validate_project_state(project: Project) -> None:
    if (
        project.vintage_start is not None
        and project.vintage_end is not None
        and project.vintage_end < project.vintage_start
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="vintage_end must be greater than or equal to vintage_start.",
        )
    if project.price_per_credit is not None and project.currency is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="currency is required when price_per_credit is supplied.",
        )


def commit_project(db: Session, project: Project) -> Project:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A project with the same external ID, slug, or registry identifier already exists.",
        ) from exc
    db.refresh(project)
    return project


@router.get("", response_model=ProjectPage)
def list_projects(
    db: Annotated[Session, Depends(get_db)],
    q: Annotated[str | None, Query(max_length=200)] = None,
    query: Annotated[str | None, Query(max_length=200)] = None,
    project_type: Annotated[list[str] | None, Query()] = None,
    category: ProjectCategory | None = None,
    country: Annotated[list[str] | None, Query()] = None,
    region: Annotated[list[str] | None, Query()] = None,
    registry: Annotated[list[str] | None, Query()] = None,
    verification_status: VerificationStatus | None = None,
    vintage_from: Annotated[int | None, Query(ge=1900, le=2200)] = None,
    vintage_to: Annotated[int | None, Query(ge=1900, le=2200)] = None,
    vintage_year: Annotated[int | None, Query(ge=1900, le=2200)] = None,
    vintage: Annotated[int | None, Query(ge=1900, le=2200)] = None,
    price_min: Annotated[float | None, Query(ge=0)] = None,
    price_max: Annotated[float | None, Query(ge=0)] = None,
    max_price: Annotated[float | None, Query(ge=0)] = None,
    risk_max: Annotated[float | None, Query(ge=0, le=100)] = None,
    max_risk: Annotated[float | None, Query(ge=0, le=100)] = None,
    impact_min: Annotated[float | None, Query(ge=0, le=100)] = None,
    available_only: bool = False,
    sdg: Annotated[list[int] | None, Query()] = None,
    sort: Annotated[str, Query()] = "name",
    order: Annotated[str, Query()] = "asc",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ProjectPage:
    search_query = q or query
    vintage_val = vintage_year if vintage_year is not None else vintage
    effective_price_max = price_max if price_max is not None else max_price
    effective_risk_max = risk_max if risk_max is not None else max_risk

    # Handle frontend compound sort strings like "score_desc", "price_asc"
    if "_" in sort and sort not in ("carboniq_score", "risk_score", "updated_at"):
        parts = sort.rsplit("_", 1)
        if parts[1] in ("asc", "desc"):
            field_name = parts[0]
            order = parts[1]
            if field_name == "score":
                sort = "carboniq_score"
            else:
                sort = field_name

    if vintage_from is not None and vintage_to is not None and vintage_to < vintage_from:
        raise HTTPException(status_code=422, detail="vintage_to must not precede vintage_from.")
    if price_min is not None and effective_price_max is not None and effective_price_max < price_min:
        raise HTTPException(status_code=422, detail="price_max must not be less than price_min.")
    if country and any(len(value.strip()) != 2 for value in country):
        raise HTTPException(status_code=422, detail="Countries must use two-letter codes.")
    if sdg and any(value < 1 or value > 17 for value in sdg):
        raise HTTPException(status_code=422, detail="SDGs must be integers between 1 and 17.")

    latest = latest_scores_subquery()
    conditions = [Project.status == ProjectStatus.ACTIVE]
    if search_query:
        escaped = search_query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        conditions.append(
            or_(
                Project.name.ilike(pattern, escape="\\"),
                Project.developer_name.ilike(pattern, escape="\\"),
                Project.description.ilike(pattern, escape="\\"),
            )
        )
    if project_type:
        conditions.append(Project.project_type.in_([value.strip() for value in project_type]))
    if category:
        conditions.append(Project.category == category)
    if country:
        conditions.append(Project.country_code.in_([value.strip().upper() for value in country]))
    if region:
        conditions.append(Project.region.in_([value.strip() for value in region]))
    if registry:
        conditions.append(Project.registry.in_([value.strip() for value in registry]))
    if verification_status:
        conditions.append(Project.verification_status == verification_status)
    if vintage_from is not None:
        conditions.append(Project.vintage_end >= vintage_from)
    if vintage_to is not None:
        conditions.append(Project.vintage_start <= vintage_to)
    if vintage_val is not None:
        conditions.extend(
            [Project.vintage_start <= vintage_val, Project.vintage_end >= vintage_val]
        )
    if price_min is not None:
        conditions.append(Project.price_per_credit >= price_min)
    if effective_price_max is not None:
        conditions.append(Project.price_per_credit <= effective_price_max)
    if effective_risk_max is not None:
        conditions.append(latest.c.risk_score <= effective_risk_max)
    if impact_min is not None:
        conditions.append(latest.c.impact_score >= impact_min)
    if available_only:
        conditions.append(Project.available_quantity > 0)
    for sdg_value in sdg or []:
        conditions.append(Project.sdgs.any(sdg_value))

    sort_columns = {
        "name": Project.name,
        "price": Project.price_per_credit,
        "carboniq_score": latest.c.carboniq_score,
        "risk_score": latest.c.risk_score,
        "updated_at": Project.updated_at,
    }
    sort_column = sort_columns[sort]
    ordering = sort_column.asc().nulls_last() if order == "asc" else sort_column.desc().nulls_last()
    joined = Project.__table__.outerjoin(latest, latest.c.project_id == Project.id)
    total = db.scalar(select(func.count()).select_from(joined).where(and_(*conditions))) or 0
    statement: Select = (
        select(Project, latest)
        .select_from(joined)
        .where(and_(*conditions))
        .order_by(ordering, Project.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = db.execute(statement).all()
    items = [summary_from_row(row[0], row) for row in rows]
    return ProjectPage(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
        total_pages=ceil(total / page_size) if total else 0,
    )


@router.post("/compare", response_model=ProjectCompareResponse)
def compare_projects(
    payload: ProjectCompareRequest,
    db: Annotated[Session, Depends(get_db)],
) -> ProjectCompareResponse:
    projects = [load_public_project(db, project_id) for project_id in payload.project_ids]
    return ProjectCompareResponse(items=[detail_from_project(project) for project in projects])


@router.get("/{project_id}", response_model=ProjectDetail)
def read_project(
    project_id: UUID,
    db: Annotated[Session, Depends(get_db)],
) -> ProjectDetail:
    return detail_from_project(load_public_project(db, project_id))


@router.get("/{project_id}/credits", response_model=list[CreditResponse])
def list_project_credits(
    project_id: UUID,
    db: Annotated[Session, Depends(get_db)],
) -> list[CreditResponse]:
    project = load_public_project(db, project_id)
    return [
        CreditResponse.model_validate(credit)
        for credit in sorted(project.credits, key=lambda item: (item.vintage, str(item.id)))
    ]


@router.get("/{project_id}/documents", response_model=list[DocumentResponse])
def list_project_documents(
    project_id: UUID,
    db: Annotated[Session, Depends(get_db)],
) -> list[DocumentResponse]:
    project = load_public_project(db, project_id)
    return [
        DocumentResponse.model_validate(document)
        for document in sorted(project.documents, key=lambda item: (item.title, str(item.id)))
    ]


@router.get("/{project_id}/score")
def get_project_score(
    project_id: UUID,
    db: Annotated[Session, Depends(get_db)],
) -> dict | None:
    project = load_public_project(db, project_id)
    score = max(
        project.scores,
        key=lambda item: (item.calculated_at, str(item.id)),
        default=None,
    )
    if score is None:
        return None
    return {
        "id": str(score.id),
        "project_id": str(score.project_id),
        "methodology_version": score.methodology_version,
        "status": "scored" if score.carboniq_score is not None else "insufficient_evidence",
        "overall_score": float(score.carboniq_score) if score.carboniq_score is not None else None,
        "quality_score": float(score.quality_score) if score.quality_score is not None else None,
        "impact_score": float(score.impact_score) if score.impact_score is not None else None,
        "risk_score": float(score.risk_score) if score.risk_score is not None else None,
        "confidence": float(score.confidence) if score.confidence is not None else 1.0,
        "calculated_at": score.calculated_at.isoformat() if score.calculated_at else "",
        "missing_evidence": score.explanation.get("missing_evidence", []) if isinstance(score.explanation, dict) else [],
        "components": {
            "integrity": float(score.integrity_score) if score.integrity_score is not None else None,
            "permanence": float(score.permanence_score) if score.permanence_score is not None else None,
            "verification": float(score.verification_score) if score.verification_score is not None else None,
            "co_benefits": float(score.co_benefits_score) if score.co_benefits_score is not None else None,
            "value": float(score.value_score) if score.value_score is not None else None,
            "delivery": float(score.delivery_score) if score.delivery_score is not None else None,
            "compatibility": float(score.compatibility_score) if score.compatibility_score is not None else None,
        },
    }


@router.get("/{project_id}/risk-signals")
def get_project_risk_signals(
    project_id: UUID,
    db: Annotated[Session, Depends(get_db)],
) -> list[dict]:
    project = load_public_project(db, project_id)
    return [
        {
            "id": str(signal.id),
            "code": signal.code,
            "severity": signal.severity.value if hasattr(signal.severity, "value") else str(signal.severity),
            "explanation": signal.title,
            "evidence": signal.message,
            "rule_version": signal.rule_version,
            "detected_at": signal.detected_at.isoformat() if signal.detected_at else "",
            "human_review": signal.requires_review,
        }
        for signal in project.risk_signals
        if signal.resolved_at is None
    ]


class RiskReviewRequest(BaseModel):
    action: str = "resolve"  # "resolve", "acknowledge", "dismiss"
    notes: str = ""


@router.post("/{project_id}/risk-signals/{signal_id}/review")
def review_risk_signal(
    project_id: UUID,
    signal_id: UUID,
    payload: RiskReviewRequest,
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """Human-in-the-loop curator review to acknowledge or resolve flagged project risk signals."""
    from datetime import datetime, timezone
    from app.models.score import RiskSignal

    signal = db.scalar(
        select(RiskSignal).where(
            RiskSignal.id == signal_id,
            RiskSignal.project_id == project_id,
        )
    )
    if signal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Risk signal not found.")

    signal.requires_review = False
    signal.resolved_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "status": "success",
        "signal_id": str(signal.id),
        "action": payload.action,
        "resolved_at": signal.resolved_at.isoformat(),
        "notes": payload.notes,
    }

