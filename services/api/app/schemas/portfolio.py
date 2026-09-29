from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models.enums import PortfolioStatus


class PortfolioCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    currency: str = Field(min_length=3, max_length=3)
    preference_id: UUID | None = None

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized.isalpha():
            raise ValueError("currency must contain three letters.")
        return normalized


class PortfolioUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=160)


class HoldingCreate(BaseModel):
    credit_id: UUID
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)


class HoldingUpdate(BaseModel):
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)


class HoldingResponse(BaseModel):
    id: UUID
    credit_id: UUID
    project_id: UUID
    project_name: str
    vintage: int
    quantity: float
    unit_price_snapshot: float
    line_total: float
    allocation_percent: float
    current_quantity_available: float
    quality_score: float | None
    risk_score: float | None
    is_locked: bool


class PortfolioResponse(BaseModel):
    id: UUID
    user_id: UUID
    preference_id: UUID | None
    name: str
    status: PortfolioStatus
    currency: str
    total_cost: float
    total_credits: float
    estimated_carbon_impact_tonnes: float
    average_quality: float | None
    portfolio_risk: float | None
    optimizer_version: str | None
    holdings: list[HoldingResponse]
    items: list[Any] = Field(default_factory=list)
    is_synthetic: bool = False
    created_at: datetime
    updated_at: datetime

