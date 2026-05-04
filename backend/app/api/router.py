from fastapi import APIRouter

from app.api.routes.detect import router as detect_router
from app.api.routes.health import router as health_router
from app.api.routes.history import router as history_router
from app.api.routes.images import router as images_router
from app.api.routes.images import upload_router


api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(images_router)
api_router.include_router(upload_router)
api_router.include_router(detect_router)
api_router.include_router(history_router)
