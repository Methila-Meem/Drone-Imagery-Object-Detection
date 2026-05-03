import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from app.schemas.detection import DetectionResponse, DetectionResult
from app.db.database import get_connection
from app.db.detection_repo import DetectionRecord, insert_detection
from app.services.image_registry import (
    UnknownImageError,
    get_image,
    get_static_image_path,
)
from app.services.overlay_utils import build_static_url, save_detection_mask

logger = logging.getLogger(__name__)

_SEGFORMER_MODULE = None


class SegFormerDetectionError(RuntimeError):
    pass


async def run_real_detection(
    image_id: str,
    confidence_threshold: float,
    mask_url_base: str | None = None,
    response_mode: str = "segformer",
) -> DetectionResponse:
    try:
        image = await get_image(image_id)
    except UnknownImageError:
        raise

    image_path = get_static_image_path(image)
    service = _load_segformer_service()
    detection_id = str(uuid4())
    started_at = perf_counter()

    try:
        prediction = service.run_segformer_detection(
            image_path=image_path,
            confidence_threshold=confidence_threshold,
            output_size=(image.width, image.height),
        )
    except service.SegFormerServiceError as exc:
        raise SegFormerDetectionError(str(exc)) from exc

    inference_time_ms = int(round((perf_counter() - started_at) * 1000))
    mask_filename = save_detection_mask(
        detection_id=detection_id,
        image=prediction.mask_image,
    )
    detections = [
        DetectionResult(
            label=detection.label,
            confidence=detection.confidence,
            bbox=detection.bbox,
            pixel_area=detection.pixel_area,
            color=detection.color,
        )
        for detection in prediction.detections
    ]
    persisted_mask_path = f"outputs/{mask_filename}"
    await _persist_detection(
        detection_id=detection_id,
        image_id=image.image_id,
        model_used=prediction.model_used,
        detections=detections,
        mask_path=persisted_mask_path,
        inference_time_ms=inference_time_ms,
        confidence_threshold=confidence_threshold,
    )

    return DetectionResponse(
        detection_id=detection_id,
        image_id=image.image_id,
        mode=response_mode,
        model_used=prediction.model_used,
        inference_time_ms=inference_time_ms,
        image_width=prediction.image_width,
        image_height=prediction.image_height,
        detections=detections,
        mask_url=build_static_url(mask_url_base, mask_filename),
    )


def warm_up_segformer() -> None:
    service = _load_segformer_service()
    try:
        service.warm_up_segformer()
    except service.SegFormerServiceError as exc:
        logger.warning("SegFormer warm-up failed: %s", exc)


async def _persist_detection(
    *,
    detection_id: str,
    image_id: str,
    model_used: str,
    detections: list[DetectionResult],
    mask_path: str,
    inference_time_ms: int,
    confidence_threshold: float,
) -> None:
    connection = await get_connection()
    try:
        await insert_detection(
            connection,
            DetectionRecord(
                detection_id=detection_id,
                image_id=image_id,
                model_used=model_used,
                detections_json=json.dumps(
                    [detection.model_dump() for detection in detections]
                ),
                mask_path=mask_path,
                inference_time_ms=inference_time_ms,
                confidence_threshold=confidence_threshold,
                created_at=datetime.now(UTC).isoformat(),
            ),
        )
        await connection.commit()
    finally:
        await connection.close()


def _load_segformer_service():
    global _SEGFORMER_MODULE

    if _SEGFORMER_MODULE is not None:
        return _SEGFORMER_MODULE

    try:
        from model import segformer_service
    except ImportError:
        import importlib.util
        import sys

        service_path = (
            Path(__file__).resolve().parents[3] / "model" / "segformer_service.py"
        )
        spec = importlib.util.spec_from_file_location(
            "model.segformer_service",
            service_path,
        )
        if spec is None or spec.loader is None:
            raise SegFormerDetectionError("Unable to locate model/segformer_service.py.")

        segformer_service = importlib.util.module_from_spec(spec)
        sys.modules["model.segformer_service"] = segformer_service
        spec.loader.exec_module(segformer_service)

    _SEGFORMER_MODULE = segformer_service
    return segformer_service
