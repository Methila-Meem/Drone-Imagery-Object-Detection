from fastapi import APIRouter

from app.schemas.health import HealthResponse


router = APIRouter(tags=["health"])


@router.get("/", response_model=HealthResponse)
async def root() -> HealthResponse:
    return HealthResponse(status="ok", service="backend")


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", service="backend")
