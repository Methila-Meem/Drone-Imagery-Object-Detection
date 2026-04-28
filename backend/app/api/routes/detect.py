from fastapi import APIRouter, HTTPException, Request, status

from app.schemas.detection import DetectionRequest, DetectionResponse
from app.services.image_registry import UnknownImageError
from app.services.segformer_detection import (
    SegFormerDetectionError,
    run_real_detection,
)
from app.services.simulated_detection import run_simulated_detection


router = APIRouter(prefix="/api/detect", tags=["detection"])


@router.post("", response_model=DetectionResponse)
async def detect_objects(
    detection_request: DetectionRequest, request: Request
) -> DetectionResponse:
    try:
        if detection_request.mode == "simulated":
            return run_simulated_detection(
                image_id=detection_request.image_id,
                confidence_threshold=detection_request.confidence_threshold,
            )

        return run_real_detection(
            image_id=detection_request.image_id,
            confidence_threshold=detection_request.confidence_threshold,
            mask_url_base=str(request.url_for("static", path="masks")),
        )
    except UnknownImageError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown image_id: {exc.image_id}",
        ) from exc
    except SegFormerDetectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
