import json
from datetime import UTC, datetime
from time import perf_counter
from uuid import uuid4

from app.db.database import get_connection
from app.db.detection_repo import DetectionRecord, insert_detection
from app.schemas.detection import DetectionResponse, DetectionResult
from app.services.image_registry import UnknownImageError, get_image


_SIMULATED_DETECTIONS = [
    DetectionResult(label="building", confidence=0.91, bbox=(120, 80, 260, 220)),
    DetectionResult(label="building", confidence=0.84, bbox=(620, 180, 820, 360)),
    DetectionResult(label="vegetation", confidence=0.88, bbox=(310, 420, 610, 720)),
    DetectionResult(label="vegetation", confidence=0.67, bbox=(940, 120, 1260, 390)),
    DetectionResult(label="open_land", confidence=0.79, bbox=(780, 620, 1190, 940)),
    DetectionResult(label="open_land", confidence=0.56, bbox=(1350, 760, 1730, 1080)),
    DetectionResult(label="road/path", confidence=0.86, bbox=(40, 980, 1780, 1125)),
    DetectionResult(label="road/path", confidence=0.62, bbox=(1010, 350, 1160, 1030)),
]
_SIMULATED_BASE_WIDTH = 2048
_SIMULATED_BASE_HEIGHT = 1536
_SIMULATED_COLORS = {
    "building": "#dc2626",
    "vegetation": "#16a34a",
    "open_land": "#ca8a04",
    "road/path": "#2563eb",
}


async def run_simulated_detection(
    image_id: str, confidence_threshold: float
) -> DetectionResponse:
    started_at = perf_counter()
    try:
        image = await get_image(image_id)
    except UnknownImageError:
        raise

    detections = [
        _scale_detection(detection, image.width, image.height)
        for detection in _SIMULATED_DETECTIONS
        if detection.confidence >= confidence_threshold
    ]
    detection_id = str(uuid4())
    inference_time_ms = int(round((perf_counter() - started_at) * 1000))
    await _persist_detection(
        detection_id=detection_id,
        image_id=image.image_id,
        detections=detections,
        inference_time_ms=inference_time_ms,
        confidence_threshold=confidence_threshold,
    )

    return DetectionResponse(
        detection_id=detection_id,
        image_id=image.image_id,
        mode="simulated",
        model_used="simulated",
        inference_time_ms=inference_time_ms,
        image_width=image.width,
        image_height=image.height,
        detections=detections,
    )


def _scale_detection(
    detection: DetectionResult,
    image_width: int,
    image_height: int,
) -> DetectionResult:
    x_scale = image_width / _SIMULATED_BASE_WIDTH
    y_scale = image_height / _SIMULATED_BASE_HEIGHT
    x_min, y_min, x_max, y_max = detection.bbox
    scaled_bbox = (
        min(max(int(round(x_min * x_scale)), 0), image_width),
        min(max(int(round(y_min * y_scale)), 0), image_height),
        min(max(int(round(x_max * x_scale)), 0), image_width),
        min(max(int(round(y_max * y_scale)), 0), image_height),
    )

    return DetectionResult(
        label=detection.label,
        confidence=detection.confidence,
        bbox=scaled_bbox,
        pixel_area=max(
            (scaled_bbox[2] - scaled_bbox[0]) * (scaled_bbox[3] - scaled_bbox[1]),
            0,
        ),
        color=detection.color or _SIMULATED_COLORS.get(detection.label),
    )


async def _persist_detection(
    *,
    detection_id: str,
    image_id: str,
    detections: list[DetectionResult],
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
                model_used="simulated",
                detections_json=json.dumps(
                    [detection.model_dump() for detection in detections]
                ),
                mask_path=None,
                inference_time_ms=inference_time_ms,
                confidence_threshold=confidence_threshold,
                created_at=datetime.now(UTC).isoformat(),
            ),
        )
        await connection.commit()
    finally:
        await connection.close()
