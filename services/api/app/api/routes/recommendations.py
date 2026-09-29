from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import get_current_user_optional
from app.database.session import get_db
from app.models.enums import ProjectStatus, RiskTolerance
from app.models.project import Project
from app.models.score import ProjectScore
from app.models.user import BuyerPreference, User
from app.api.routes.projects import detail_from_project


router = APIRouter(prefix="/recommendations", tags=["recommendations"])


class RecommendationRequest(BaseModel):
    preference_id: str | UUID | None = None


class RecommendationItemResponse(BaseModel):
    project: Any
    match_score: float
    reasons: list[str]
    trade_offs: list[str]


class RecommendationRunResponse(BaseModel):
    id: str
    items: list[RecommendationItemResponse]
    engine_version: str
    data_snapshot: str
    created_at: str
    stale: bool


@router.post("", response_model=RecommendationRunResponse)
def generate_recommendations(
    payload: RecommendationRequest,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User | None, Depends(get_current_user_optional)] = None,
) -> RecommendationRunResponse:
    preference: BuyerPreference | None = None
    if payload.preference_id:
        try:
            pref_uuid = UUID(str(payload.preference_id))
            preference = db.scalar(select(BuyerPreference).where(BuyerPreference.id == pref_uuid))
        except ValueError:
            pass

    if preference is None and current_user:
        preference = db.scalar(
            select(BuyerPreference)
            .where(BuyerPreference.user_id == current_user.id)
            .order_by(BuyerPreference.created_at.desc())
        )

    # Fetch active projects
    projects = list(
        db.scalars(
            select(Project)
            .where(Project.status == ProjectStatus.ACTIVE)
            .options(
                selectinload(Project.scores),
                selectinload(Project.risk_signals),
                selectinload(Project.credits),
                selectinload(Project.documents),
            )
        )
    )

    items: list[RecommendationItemResponse] = []
    pref_category = preference.preferred_category.value if preference and preference.preferred_category else None
    pref_countries = preference.preferred_countries if preference else []
    pref_sdgs = set(preference.sdg_priorities) if preference else set()
    pref_risk = preference.risk_tolerance if preference else RiskTolerance.LOW
    max_budget_per_credit = (
        float(preference.budget / preference.required_credits)
        if preference and preference.budget and preference.required_credits
        else None
    )

    for proj in projects:
        score_obj: ProjectScore | None = max(
            proj.scores,
            key=lambda s: (s.calculated_at, str(s.id)),
            default=None,
        )
        base_quality = float(score_obj.carboniq_score) if score_obj and score_obj.carboniq_score is not None else 72.0
        risk_val = float(score_obj.risk_score) if score_obj and score_obj.risk_score is not None else 25.0
        unit_price = float(proj.price_per_credit) if proj.price_per_credit is not None else 25.0

        match_score = base_quality
        reasons: list[str] = []
        trade_offs: list[str] = []

        # Category match
        if pref_category:
            if proj.category.value == pref_category:
                match_score += 8.0
                reasons.append(f"Direct match for preferred {proj.category.value} pathway.")
            else:
                trade_offs.append(f"Differs from target {pref_category} category.")

        # Country match
        if pref_countries:
            if proj.country_code in pref_countries:
                match_score += 6.0
                reasons.append(f"Located in preferred region ({proj.country_code}).")

        # SDG alignment
        matched_sdgs = set(proj.sdgs or []) & pref_sdgs
        if matched_sdgs:
            match_score += min(len(matched_sdgs) * 3.0, 10.0)
            reasons.append(f"Supports {len(matched_sdgs)} priority SDGs ({', '.join(f'#{s}' for s in sorted(matched_sdgs))}).")

        # Risk tolerance check
        if pref_risk == RiskTolerance.LOW and risk_val > 30:
            match_score -= 12.0
            trade_offs.append(f"Risk rating ({risk_val:.0f}/100) exceeds conservative threshold.")
        elif risk_val < 20:
            match_score += 5.0
            reasons.append(f"Low risk profile with strong governance indicators.")

        # Budget check
        if max_budget_per_credit is not None:
            if unit_price <= max_budget_per_credit:
                match_score += 5.0
                reasons.append("Within designated target price range.")
            else:
                match_score -= 10.0
                trade_offs.append(f"Price per credit ({unit_price:.1f}) above baseline target.")

        if not reasons:
            reasons.append("High overall methodology verification standard.")

        clamped_score = round(max(35.0, min(99.0, match_score)), 1)
        items.append(
            RecommendationItemResponse(
                project=detail_from_project(proj).model_dump(mode="json"),
                match_score=clamped_score,
                reasons=reasons,
                trade_offs=trade_offs,
            )
        )

    # Sort descending by match_score
    items.sort(key=lambda item: item.match_score, reverse=True)

    now = datetime.now(timezone.utc)
    return RecommendationRunResponse(
        id=f"rec_{uuid4().hex[:12]}",
        items=items[:12],
        engine_version="1.0.0",
        data_snapshot=now.strftime("%Y-%m-%d"),
        created_at=now.isoformat(),
        stale=False,
    )
