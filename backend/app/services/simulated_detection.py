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


async def run_simulated_detection(
    image_id: str, confidence_threshold: float
) -> DetectionResponse:
    started_at = perf_counter()
    try:
        image = await get_image(image_id)
    except UnknownImageError:
        raise

    detections = [
        detection
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
