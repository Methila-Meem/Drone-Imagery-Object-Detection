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


async def list_detections(connection: aiosqlite.Connection) -> list[DetectionRecord]:
    cursor = await connection.execute(
        """
        SELECT detection_id, image_id, model_used, detections_json, mask_path,
               inference_time_ms, confidence_threshold, created_at
        FROM detections
        ORDER BY created_at DESC
        """
    )
    rows = await cursor.fetchall()
    return [_row_to_detection(row) for row in rows]


async def list_detections_paginated(
    connection: aiosqlite.Connection,
    *,
    limit: int,
    offset: int,
) -> list[DetectionRecord]:
    cursor = await connection.execute(
        """
        SELECT detection_id, image_id, model_used, detections_json, mask_path,
               inference_time_ms, confidence_threshold, created_at
        FROM detections
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
        """,
        (limit, offset),
    )
    rows = await cursor.fetchall()
    return [_row_to_detection(row) for row in rows]


async def count_detections(connection: aiosqlite.Connection) -> int:
    cursor = await connection.execute("SELECT COUNT(*) AS total FROM detections")
    row = await cursor.fetchone()
    return int(row["total"])


async def get_detection(
    connection: aiosqlite.Connection, detection_id: str
) -> DetectionRecord | None:
    cursor = await connection.execute(
        """
        SELECT detection_id, image_id, model_used, detections_json, mask_path,
               inference_time_ms, confidence_threshold, created_at
        FROM detections
        WHERE detection_id = ?
        """,
        (detection_id,),
    )
    row = await cursor.fetchone()
    return _row_to_detection(row) if row is not None else None


async def delete_detection(connection: aiosqlite.Connection, detection_id: str) -> bool:
    cursor = await connection.execute(
        "DELETE FROM detections WHERE detection_id = ?",
        (detection_id,),
    )
    return cursor.rowcount > 0


def _row_to_detection(row: aiosqlite.Row) -> DetectionRecord:
    return DetectionRecord(
        detection_id=row["detection_id"],
        image_id=row["image_id"],
        model_used=row["model_used"],
        detections_json=row["detections_json"],
        mask_path=row["mask_path"],
        inference_time_ms=row["inference_time_ms"],
        confidence_threshold=row["confidence_threshold"],
        created_at=row["created_at"],
    )
