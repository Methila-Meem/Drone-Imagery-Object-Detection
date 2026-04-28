import logging
import os
from pathlib import Path
from threading import Lock
from typing import Any

from app.schemas.detection import DetectionResponse, DetectionResult
from app.services.image_registry import STATIC_IMAGES_DIR, UnknownImageError, get_image
from app.services.overlay_utils import (
    build_detection_overlay,
    build_static_url,
    save_overlay_image,
)

logger = logging.getLogger(__name__)

YOLO_MODEL_NAME = "yolov8s.pt"
YOLO_IMAGE_SIZE = 1024
YOLO_IOU_THRESHOLD = 0.45
YOLO_MAX_DETECTIONS = 300
YOLO_CACHE_DIR = Path(__file__).resolve().parents[3] / "model" / ".cache" / "ultralytics"
MPL_CONFIG_DIR = Path(__file__).resolve().parents[3] / "model" / ".cache" / "matplotlib"

_YOLO_MODEL: Any | None = None
_YOLO_LOCK = Lock()


class YOLODetectionError(RuntimeError):
    pass


def run_yolo_detection(
    image_id: str,
    confidence_threshold: float,
    mask_url_base: str | None = None,
) -> DetectionResponse:
    try:
        image = get_image(image_id)
    except UnknownImageError:
        raise

    image_path = STATIC_IMAGES_DIR / image.filename
    model = _load_yolo_model()
    device = _get_torch_device()

    logger.info(
        "YOLOv8s inference started image_id=%s path=%s conf=%.2f imgsz=%s device=%s",
        image.image_id,
        image_path,
        confidence_threshold,
        YOLO_IMAGE_SIZE,
        device,
    )

    try:
        results = model.predict(
            source=str(image_path),
            imgsz=YOLO_IMAGE_SIZE,
            conf=confidence_threshold,
            iou=YOLO_IOU_THRESHOLD,
            max_det=YOLO_MAX_DETECTIONS,
            agnostic_nms=False,
            device=device,
            verbose=False,
        )
    except Exception as exc:
        raise YOLODetectionError("YOLOv8s inference failed.") from exc

    detections = _extract_yolo_detections(results, image.width, image.height)
    overlay = build_detection_overlay(
        width=image.width,
        height=image.height,
        detections=detections,
    )
    overlay_path = save_overlay_image(
        image_id=image.image_id,
        confidence_threshold=confidence_threshold,
        image=overlay,
        prefix="yolo_overlay",
        subdir="overlays",
    )

    logger.info(
        "YOLOv8s inference completed image_id=%s detections=%s overlay=%s",
        image.image_id,
        len(detections),
        overlay_path,
    )

    return DetectionResponse(
        image_id=image.image_id,
        mode="yolo",
        detections=detections,
        mask_url=build_static_url(mask_url_base, overlay_path),
    )


def _load_yolo_model() -> Any:
    global _YOLO_MODEL

    if _YOLO_MODEL is not None:
        return _YOLO_MODEL

    with _YOLO_LOCK:
        if _YOLO_MODEL is not None:
            return _YOLO_MODEL

        _prepare_yolo_cache_dirs()

        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise YOLODetectionError(
                "Ultralytics is required for YOLOv8s detection. Install backend requirements and retry."
            ) from exc

        try:
            _YOLO_MODEL = YOLO(YOLO_MODEL_NAME)
        except Exception as exc:
            raise YOLODetectionError(
                "Unable to load YOLOv8s weights 'yolov8s.pt'. Check that ultralytics is installed and the weights can be downloaded."
            ) from exc

        logger.info("YOLOv8s model loaded weights=%s", YOLO_MODEL_NAME)
        return _YOLO_MODEL


def _prepare_yolo_cache_dirs() -> None:
    YOLO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    MPL_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("YOLO_CONFIG_DIR", str(YOLO_CACHE_DIR))
    os.environ.setdefault("MPLCONFIGDIR", str(MPL_CONFIG_DIR))


def _extract_yolo_detections(
    results: Any,
    image_width: int,
    image_height: int,
) -> list[DetectionResult]:
    detections: list[DetectionResult] = []

    for result in results:
        boxes = getattr(result, "boxes", None)
        if boxes is None or len(boxes) == 0:
            continue

        names = getattr(result, "names", {})
        xyxy_values = boxes.xyxy.cpu().numpy()
        confidence_values = boxes.conf.cpu().numpy()
        class_values = boxes.cls.cpu().numpy().astype(int)

        for xyxy, confidence, class_id in zip(
            xyxy_values,
            confidence_values,
            class_values,
            strict=False,
        ):
            x_min, y_min, x_max, y_max = _clamp_xyxy(
                xyxy,
                width=image_width,
                height=image_height,
            )
            if x_max <= x_min or y_max <= y_min:
                continue

            label = str(names.get(int(class_id), f"class_{int(class_id)}"))
            detections.append(
                DetectionResult(
                    label=label,
                    confidence=round(float(confidence), 4),
                    bbox=(x_min, y_min, x_max, y_max),
                )
            )

    detections.sort(key=lambda detection: detection.confidence, reverse=True)
    return detections


def _clamp_xyxy(xyxy: Any, width: int, height: int) -> tuple[int, int, int, int]:
    x_min, y_min, x_max, y_max = [int(round(float(value))) for value in xyxy]
    return (
        min(max(x_min, 0), width),
        min(max(y_min, 0), height),
        min(max(x_max, 0), width),
        min(max(y_max, 0), height),
    )


def _get_torch_device() -> str:
    try:
        import torch
    except ImportError:
        return "cpu"

    return "cuda" if torch.cuda.is_available() else "cpu"
