from fastapi import APIRouter, HTTPException, status

from app.schemas.detection import DetectionRequest, DetectionResponse
from app.services.image_registry import UnknownImageError
from app.services.simulated_detection import run_simulated_detection


router = APIRouter(prefix="/api/detect", tags=["detection"])


@router.post("", response_model=DetectionResponse)
async def detect_objects(request: DetectionRequest) -> DetectionResponse:
    try:
        return run_simulated_detection(
            image_id=request.image_id,
            confidence_threshold=request.confidence_threshold,
        )
    except UnknownImageError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown image_id: {exc.image_id}",
        ) from exc
