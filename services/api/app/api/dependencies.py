from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import InvalidAccessTokenError, decode_access_token
from app.database.session import get_db
from app.models.enums import UserRole
from app.models.user import User


bearer_scheme = HTTPBearer(auto_error=False)


def unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing authentication credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized()

    try:
        claims = decode_access_token(credentials.credentials)
    except InvalidAccessTokenError as exc:
        raise unauthorized() from exc

    user = db.get(User, claims.subject)
    if user is None:
        raise unauthorized()
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled.",
        )
    return user


def get_current_user_optional(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User | None:
    if credentials is None or credentials.scheme.lower() != "bearer":
        return None
    try:
        claims = decode_access_token(credentials.credentials)
    except InvalidAccessTokenError:
        return None
    user = db.get(User, claims.subject)
    if user is None or not user.is_active:
        return None
    return user


class RoleChecker:
    def __init__(self, *allowed_roles: UserRole) -> None:
        self.allowed_roles = frozenset(allowed_roles)

    def __call__(
        self,
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        if current_user.role not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions.",
            )
        return current_user


def require_roles(*roles: UserRole) -> RoleChecker:
    return RoleChecker(*roles)


require_administrator = require_roles(UserRole.ADMIN)
