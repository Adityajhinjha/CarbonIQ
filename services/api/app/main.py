from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.routes.admin_projects import router as admin_projects_router
from app.api.routes.auth import router as auth_router
from app.api.routes.documents import router as documents_router
from app.api.routes.health import router as health_router
from app.api.routes.imports import router as imports_router
from app.api.routes.orders import router as orders_router
from app.api.routes.portfolios import router as portfolios_router
from app.api.routes.preferences import router as preferences_router
from app.api.routes.projects import router as projects_router
from app.api.routes.recommendations import router as recommendations_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import (
    RequestBodyLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)

settings = get_settings()
configure_logging(settings.debug)

app = FastAPI(
    title=settings.app_name,
    description="API for the CarbonIQ carbon-credit intelligence platform.",
    version=settings.app_version,
    debug=settings.debug,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[str(origin).rstrip("/") for origin in settings.cors_allowed_origins],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["Content-Disposition", "X-Request-ID"],
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestBodyLimitMiddleware, max_bytes=settings.max_request_body_bytes)
app.add_middleware(RequestContextMiddleware)
register_exception_handlers(app)

app.include_router(health_router, prefix=settings.api_v1_prefix)
app.include_router(auth_router, prefix=settings.api_v1_prefix)
app.include_router(projects_router, prefix=settings.api_v1_prefix)
app.include_router(preferences_router, prefix=settings.api_v1_prefix)
app.include_router(admin_projects_router, prefix=settings.api_v1_prefix)
app.include_router(portfolios_router, prefix=settings.api_v1_prefix)
app.include_router(orders_router, prefix=settings.api_v1_prefix)
app.include_router(recommendations_router, prefix=settings.api_v1_prefix)
app.include_router(documents_router, prefix=settings.api_v1_prefix)
app.include_router(imports_router, prefix=settings.api_v1_prefix)
