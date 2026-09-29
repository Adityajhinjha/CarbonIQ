from functools import lru_cache
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "CarbonIQ API"
    app_version: str = "0.1.0"
    api_v1_prefix: str = "/api/v1"
    environment: Literal["development", "test", "production"] = "development"
    debug: bool = False
    database_url: str = Field(min_length=1)
    database_echo: bool = False
    database_connect_timeout: int = Field(default=5, ge=1, le=30)
    jwt_secret_key: SecretStr = Field(min_length=32)
    jwt_algorithm: Literal["HS256"] = "HS256"
    access_token_expire_minutes: int = Field(default=15, ge=1, le=1440)
    refresh_token_expire_days: int = Field(default=30, ge=1, le=365)
    cors_allowed_origins: Annotated[list[str], NoDecode] = [
        "*",
    ]
    trusted_hosts: Annotated[list[str], NoDecode] = [
        "*",
    ]
    max_request_body_bytes: int = Field(default=1_048_576, ge=1_024, le=10_485_760)

    @field_validator("cors_allowed_origins", "trusted_hosts", mode="before")
    @classmethod
    def parse_comma_separated_list(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("cors_allowed_origins", "trusted_hosts")
    @classmethod
    def require_non_empty_list(cls, value: list[object]) -> list[object]:
        if not value:
            raise ValueError("At least one value is required.")
        return value

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
