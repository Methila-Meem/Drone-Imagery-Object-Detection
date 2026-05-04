import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse

from app.db.database import get_connection
from app.db.detection_repo import (
    count_detections,
    delete_detection,
    get_detection,
    list_detections_paginated,
)
from app.db.image_repo import get_image
from app.schemas.detection import (
    DetectionHistoryItem,
    DetectionHistoryResponse,
    DetectionResult,
)


router = APIRouter(tags=["history"])


@router.get("/api/history", response_model=DetectionHistoryResponse)
async def get_history(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> DetectionHistoryResponse:
    connection = await get_connection()
    try:
        total = await count_detections(connection)
        records = await list_detections_paginated(
            connection,
            limit=page_size,
            offset=(page - 1) * page_size,
        )
        history: list[DetectionHistoryItem] = []

        for record in records:
            image = await get_image(connection, record.image_id)
            if image is None:
                continue

            detections = _parse_detections(record.detections_json)
            detected_classes = sorted({detection.label for detection in detections})
            history.append(
                DetectionHistoryItem(
                    detection_id=record.detection_id,
                    image_id=record.image_id,
                    timestamp=record.created_at,
                    filename=image.filename,
                    image_url=str(
                        request.url_for(
                            "static",
                            path=f"images/{Path(image.filepath).name}",
                        )
                    ),
                    image_width=image.width,
                    image_height=image.height,
                    bounds={
                        "north": image.north,
                        "south": image.south,
                        "east": image.east,
                        "west": image.west,
                    },
                    mode=_mode_from_model(record.model_used),
                    model_used=record.model_used,
                    class_count=len(detected_classes),
                    detected_classes=detected_classes,
                    inference_time_ms=record.inference_time_ms,
                    confidence_threshold=record.confidence_threshold,
                    detections=detections,
                    mask_url=_mask_url(request, record.mask_path),
                    created_at=record.created_at,
                )
            )
    finally:
        await connection.close()

    return DetectionHistoryResponse(
        history=history,
        page=page,
        page_size=page_size,
        total=total,
    )


@router.delete("/api/history/{detection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_history_record(detection_id: str) -> Response:
    connection = await get_connection()
    try:
        deleted = await delete_detection(connection, detection_id)
        await connection.commit()
    finally:
        await connection.close()

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown detection_id: {detection_id}",
        )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/api/export/geojson/{detection_id}")
async def export_detection_geojson(detection_id: str) -> JSONResponse:
    connection = await get_connection()
    try:
        detection = await get_detection(connection, detection_id)
        if detection is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Unknown detection_id: {detection_id}",
            )

        image = await get_image(connection, detection.image_id)
        if image is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Image not found for detection_id: {detection_id}",
            )

        feature_collection = _build_geojson(
            detections=_parse_detections(detection.detections_json),
            detection_id=detection.detection_id,
            image_id=detection.image_id,
            mode=_mode_from_model(detection.model_used),
            image_width=image.width,
            image_height=image.height,
            bounds={
                "north": image.north,
                "south": image.south,
                "east": image.east,
                "west": image.west,
            },
        )
    finally:
        await connection.close()

    return JSONResponse(
        content=feature_collection,
        media_type="application/geo+json",
        headers={
            "Content-Disposition": f'attachment; filename="detections_{detection_id}.geojson"'
        },
    )


def _parse_detections(detections_json: str) -> list[DetectionResult]:
    payload = json.loads(detections_json)
    return [DetectionResult.model_validate(item) for item in payload]


def _mode_from_model(model_used: str) -> str:
    normalized = model_used.lower()
    if "yolo" in normalized:
        return "yolo"
    if normalized == "simulated":
        return "simulated"
    return "segformer"


def _mask_url(request: Request, mask_path: str | None) -> str | None:
    if not mask_path:
        return None
    return str(request.url_for("static", path=mask_path))


def _build_geojson(
    *,
    detections: list[DetectionResult],
    detection_id: str,
    image_id: str,
    mode: str,
    image_width: int,
    image_height: int,
    bounds: dict[str, float],
) -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        _bbox_to_polygon_coordinates(
                            detection.bbox,
                            image_width=image_width,
                            image_height=image_height,
                            bounds=bounds,
                        )
                    ],
                },
                "properties": {
                    "detection_id": detection_id,
                    "image_id": image_id,
                    "mode": mode,
                    "class": detection.label,
                    "confidence": detection.confidence,
                    "pixel_area": detection.pixel_area,
                    "color": detection.color,
                },
            }
            for detection in detections
        ],
    }


def _bbox_to_polygon_coordinates(
    bbox: tuple[int, int, int, int],
    *,
    image_width: int,
    image_height: int,
    bounds: dict[str, float],
) -> list[list[float]]:
    x_min, y_min, x_max, y_max = bbox
    top_left = _pixel_to_lng_lat(x_min, y_min, image_width, image_height, bounds)
    top_right = _pixel_to_lng_lat(x_max, y_min, image_width, image_height, bounds)
    bottom_right = _pixel_to_lng_lat(x_max, y_max, image_width, image_height, bounds)
    bottom_left = _pixel_to_lng_lat(x_min, y_max, image_width, image_height, bounds)
    return [top_left, top_right, bottom_right, bottom_left, top_left]


def _pixel_to_lng_lat(
    x: int,
    y: int,
    image_width: int,
    image_height: int,
    bounds: dict[str, float],
) -> list[float]:
    clamped_x = min(max(x, 0), image_width)
    clamped_y = min(max(y, 0), image_height)
    lng = bounds["west"] + (clamped_x / image_width) * (
        bounds["east"] - bounds["west"]
    )
    lat = bounds["north"] - (clamped_y / image_height) * (
        bounds["north"] - bounds["south"]
    )
    return [lng, lat]
