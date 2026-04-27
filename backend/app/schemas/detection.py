from typing import Literal

from pydantic import BaseModel, Field


class DetectionRequest(BaseModel):
    image_id: str
    confidence_threshold: float = Field(default=0.5, ge=0.0, le=1.0)


class DetectionResult(BaseModel):
    label: str
    confidence: float
    bbox: tuple[int, int, int, int]


class DetectionResponse(BaseModel):
    image_id: str
    mode: Literal["simulated"]
    detections: list[DetectionResult]
