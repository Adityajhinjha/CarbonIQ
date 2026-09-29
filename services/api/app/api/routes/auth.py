from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies import get_current_user
from app.core.config import get_settings
from app.core.security import (
    create_access_token,
    digest_refresh_token,
    generate_refresh_token,
    hash_password,
    verify_password,
)
from app.database.session import get_db
from app.models.enums import UserRole
from app.models.user import RefreshToken, User
from app.schemas.auth import (
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)


router = APIRouter(prefix="/auth", tags=["authentication"])


def authentication_failed() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or password.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def issue_token_pair(db: Session, user: User) -> TokenResponse:
    settings = get_settings()
    raw_refresh_token = generate_refresh_token()
    refresh_expiry = datetime.now(timezone.utc) + timedelta(
        days=settings.refresh_token_expire_days
    )
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=digest_refresh_token(raw_refresh_token),
            expires_at=refresh_expiry,
        )
    )
    access_token = create_access_token(user.id, user.role)
    return TokenResponse(
        access_token=access_token,
        refresh_token=raw_refresh_token,
        expires_in=settings.access_token_expire_minutes * 60,
        refresh_expires_in=settings.refresh_token_expire_days * 86400,
    )


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Annotated[Session, Depends(get_db)]) -> User:
    user = User(
        email=str(payload.email),
        password_hash=hash_password(payload.password.get_secret_value()),
        organization_name=payload.get_organization_name(),
        role=UserRole.BUYER,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        ) from exc
    db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Annotated[Session, Depends(get_db)]) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == str(payload.email)))
    if (
        user is None
        or not user.is_active
        or not verify_password(payload.password.get_secret_value(), user.password_hash)
    ):
        raise authentication_failed()

    token_pair = issue_token_pair(db, user)
    db.commit()
    return token_pair


@router.post("/refresh", response_model=TokenResponse)
def refresh_tokens(
    payload: RefreshRequest,
    db: Annotated[Session, Depends(get_db)],
) -> TokenResponse:
    now = datetime.now(timezone.utc)
    token = db.scalar(
        select(RefreshToken)
        .options(joinedload(RefreshToken.user))
        .with_for_update(of=RefreshToken)
        .where(
            RefreshToken.token_hash
            == digest_refresh_token(payload.refresh_token.get_secret_value())
        )
    )
    if (
        token is None
        or token.revoked_at is not None
        or token.expires_at <= now
        or not token.user.is_active
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token.",
        )

    token.revoked_at = now
    token_pair = issue_token_pair(db, token.user)
    db.commit()
    return token_pair


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    payload: LogoutRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    token = db.scalar(
        select(RefreshToken).where(
            RefreshToken.user_id == current_user.id,
            RefreshToken.token_hash
            == digest_refresh_token(payload.refresh_token.get_secret_value()),
        )
    )
    if token is not None and token.revoked_at is None:
        token.revoked_at = datetime.now(timezone.utc)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserResponse)
def read_current_user(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    return current_user
