from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, field_validator

from app.models.enums import UserRole


class RegisterRequest(BaseModel):
    email: EmailStr
    password: SecretStr = Field(min_length=8, max_length=128)
    organization_name: str | None = Field(default=None, max_length=160)
    name: str | None = Field(default=None, max_length=160)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()

    def get_organization_name(self) -> str:
        val = (self.organization_name or self.name or "").strip()
        if len(val) < 2:
            return "Individual Buyer"
        return val[:160]


class LoginRequest(BaseModel):
    email: EmailStr
    password: SecretStr = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


class RefreshRequest(BaseModel):
    refresh_token: SecretStr = Field(min_length=32)


class LogoutRequest(BaseModel):
    refresh_token: SecretStr = Field(min_length=32)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    organization_name: str
    name: str = ""
    role: UserRole
    is_active: bool

    def __init__(self, **data: object) -> None:
        super().__init__(**data)
        if not self.name:
            self.name = self.organization_name


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_expires_in: int
