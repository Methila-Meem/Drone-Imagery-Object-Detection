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


def run_simulated_detection(
    image_id: str, confidence_threshold: float
) -> DetectionResponse:
    try:
        image = get_image(image_id)
    except UnknownImageError:
        raise

    detections = [
        detection
        for detection in _SIMULATED_DETECTIONS
        if detection.confidence >= confidence_threshold
    ]

    return DetectionResponse(
        image_id=image.image_id,
        mode="simulated",
        detections=detections,
    )
