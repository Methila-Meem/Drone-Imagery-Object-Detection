from dataclasses import dataclass

import aiosqlite


@dataclass(frozen=True)
class DetectionRecord:
    detection_id: str
    image_id: str
    model_used: str
    detections_json: str
    mask_path: str | None
    inference_time_ms: int
    confidence_threshold: float
    created_at: str


async def insert_detection(
    connection: aiosqlite.Connection,
    detection: DetectionRecord,
) -> None:
    await connection.execute(
        """
        INSERT INTO detections (
            detection_id,
            image_id,
            model_used,
            detections_json,
            mask_path,
            inference_time_ms,
            confidence_threshold,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            detection.detection_id,
            detection.image_id,
            detection.model_used,
            detection.detections_json,
            detection.mask_path,
            detection.inference_time_ms,
            detection.confidence_threshold,
            detection.created_at,
        ),
    )
