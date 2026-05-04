from typing import Literal

from pydantic import BaseModel, Field


class DetectionRequest(BaseModel):
    image_id: str
    mode: Literal["simulated", "segformer", "real", "yolo"] = "segformer"
    confidence_threshold: float = Field(default=0.5, ge=0.0, le=1.0)


class DetectionResult(BaseModel):
    label: str
    confidence: float
    bbox: tuple[int, int, int, int]
    pixel_area: int | None = None
    color: str | None = None


class DetectionResponse(BaseModel):
    detection_id: str | None = None
    image_id: str
    mode: Literal["simulated", "segformer", "real", "yolo"]
    model_used: str | None = None
    inference_time_ms: int | None = None
    image_width: int | None = None
    image_height: int | None = None
    detections: list[DetectionResult]
    mask_url: str | None = None
    mask_base64: str | None = None


class DetectionHistoryItem(BaseModel):
    detection_id: str
    image_id: str
    timestamp: str
    filename: str
    image_url: str
    image_width: int
    image_height: int
    bounds: dict[str, float]
    mode: Literal["simulated", "segformer", "real", "yolo"]
    model_used: str
    class_count: int
    detected_classes: list[str]
    inference_time_ms: int | None
    confidence_threshold: float
    detections: list[DetectionResult]
    mask_url: str | None = None
    created_at: str


class DetectionHistoryResponse(BaseModel):
    history: list[DetectionHistoryItem]
    page: int = 1
    page_size: int = 20
    total: int = 0
