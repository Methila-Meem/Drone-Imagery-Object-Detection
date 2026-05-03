import logging
import os
import time
from uuid import uuid4
from pathlib import Path
from threading import Lock
from typing import Any

from PIL import Image, ImageOps

from app.schemas.detection import DetectionResponse, DetectionResult
from app.services.bbox_utils import non_max_suppression
from app.services.image_registry import (
    UnknownImageError,
    get_image,
    get_static_image_path,
)
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
YOLO_TILE_SIZE = 1024
YOLO_TILE_OVERLAP = 0.2
YOLO_CACHE_DIR = Path(__file__).resolve().parents[3] / "model" / ".cache" / "ultralytics"
MPL_CONFIG_DIR = Path(__file__).resolve().parents[3] / "model" / ".cache" / "matplotlib"
YOLO_MIN_CONFIDENCE = 0.25
YOLO_MIN_BBOX_AREA_RATIO = 0.00002
YOLO_MAX_BBOX_AREA_RATIO = 0.25

AERIAL_ALLOWED_CLASSES = {
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "bus",
    "truck",
    "boat",
}

_YOLO_MODEL: Any | None = None
_YOLO_LOCK = Lock()


class YOLODetectionError(RuntimeError):
    pass


async def run_yolo_detection(
    image_id: str,
    confidence_threshold: float,
    mask_url_base: str | None = None,
) -> DetectionResponse:
    started_at = time.perf_counter()
    detection_id = str(uuid4())

    try:
        image = await get_image(image_id)
    except UnknownImageError:
        raise

    image_path = get_static_image_path(image)
    model = _load_yolo_model()
    device = _get_torch_device()
    source_image = _open_source_image(image_path)
    tiles = _build_tiles(source_image.width, source_image.height)

    logger.info(
        "YOLOv8s tiled inference started image_id=%s path=%s conf=%.2f imgsz=%s tile_size=%s tiles=%s device=%s",
        image.image_id,
        image_path,
        confidence_threshold,
        YOLO_IMAGE_SIZE,
        YOLO_TILE_SIZE,
        len(tiles),
        device,
    )

    effective_confidence_threshold = max(confidence_threshold, YOLO_MIN_CONFIDENCE)

    try:
        raw_detections, filtered_count = _run_tiled_inference(
            model=model,
            image=source_image,
            confidence_threshold=effective_confidence_threshold,
            device=device,
            tiles=tiles,
        )
    except Exception as exc:
        raise YOLODetectionError("YOLOv8s inference failed.") from exc

    detections = non_max_suppression(
        raw_detections,
        iou_threshold=YOLO_IOU_THRESHOLD,
        max_detections=YOLO_MAX_DETECTIONS,
    )
    overlay = build_detection_overlay(
        width=image.width,
        height=image.height,
        detections=detections,
    )
    overlay_path = save_overlay_image(
        image_id=image.image_id,
        confidence_threshold=effective_confidence_threshold,
        image=overlay,
        prefix="yolo_overlay",
        subdir="overlays",
    )
    inference_time_ms = round((time.perf_counter() - started_at) * 1000)

    logger.info(
        "YOLOv8s tiled inference completed image_id=%s raw_detections=%s filtered=%s final_detections=%s overlay=%s",
        image.image_id,
        len(raw_detections),
        filtered_count,
        len(detections),
        overlay_path,
    )

    return DetectionResponse(
        detection_id=detection_id,
        image_id=image.image_id,
        mode="yolo",
        model_used=YOLO_MODEL_NAME,
        inference_time_ms=inference_time_ms,
        image_width=image.width,
        image_height=image.height,
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


def _open_source_image(image_path: Path) -> Image.Image:
    try:
        return ImageOps.exif_transpose(Image.open(image_path)).convert("RGB")
    except OSError as exc:
        raise YOLODetectionError(
            f"Unable to read image for YOLO detection: {image_path.name}"
        ) from exc


def _build_tiles(width: int, height: int) -> list[tuple[int, int, int, int]]:
    tile_size = min(YOLO_TILE_SIZE, max(width, height))
    stride = max(1, int(tile_size * (1 - YOLO_TILE_OVERLAP)))
    x_offsets = _axis_offsets(length=width, tile_size=tile_size, stride=stride)
    y_offsets = _axis_offsets(length=height, tile_size=tile_size, stride=stride)

    return [
        (
            x,
            y,
            min(x + tile_size, width),
            min(y + tile_size, height),
        )
        for y in y_offsets
        for x in x_offsets
    ]


def _axis_offsets(length: int, tile_size: int, stride: int) -> list[int]:
    if length <= tile_size:
        return [0]

    offsets = list(range(0, max(1, length - tile_size + 1), stride))
    final_offset = length - tile_size
    if offsets[-1] != final_offset:
        offsets.append(final_offset)

    return offsets


def _run_tiled_inference(
    model: Any,
    image: Image.Image,
    confidence_threshold: float,
    device: str,
    tiles: list[tuple[int, int, int, int]],
) -> tuple[list[DetectionResult], int]:
    detections: list[DetectionResult] = []
    filtered_count = 0

    for x_min, y_min, x_max, y_max in tiles:
        tile_image = image.crop((x_min, y_min, x_max, y_max))
        results = model.predict(
            source=tile_image,
            imgsz=YOLO_IMAGE_SIZE,
            conf=confidence_threshold,
            iou=YOLO_IOU_THRESHOLD,
            max_det=YOLO_MAX_DETECTIONS,
            agnostic_nms=False,
            device=device,
            verbose=False,
        )
        tile_detections, tile_filtered_count = _extract_yolo_detections(
            results=results,
            x_offset=x_min,
            y_offset=y_min,
            image_width=image.width,
            image_height=image.height,
        )
        detections.extend(tile_detections)
        filtered_count += tile_filtered_count

    return detections, filtered_count


def _extract_yolo_detections(
    results: Any,
    x_offset: int,
    y_offset: int,
    image_width: int,
    image_height: int,
) -> tuple[list[DetectionResult], int]:
    detections: list[DetectionResult] = []
    filtered_count = 0

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
            label = _normalize_yolo_label(names.get(int(class_id), f"class_{int(class_id)}"))
            if not _is_allowed_aerial_label(label):
                filtered_count += 1
                continue

            confidence_value = float(confidence)
            if confidence_value < YOLO_MIN_CONFIDENCE:
                filtered_count += 1
                continue

            x_min, y_min, x_max, y_max = _clamp_xyxy(
                xyxy,
                x_offset=x_offset,
                y_offset=y_offset,
                width=image_width,
                height=image_height,
            )
            if x_max <= x_min or y_max <= y_min:
                continue

            bbox_area_ratio = _bbox_area_ratio(
                bbox=(x_min, y_min, x_max, y_max),
                image_width=image_width,
                image_height=image_height,
            )
            if not _is_valid_bbox_area_ratio(bbox_area_ratio):
                filtered_count += 1
                continue

            detections.append(
                DetectionResult(
                    label=label,
                    confidence=round(confidence_value, 4),
                    bbox=(x_min, y_min, x_max, y_max),
                )
            )

    detections.sort(key=lambda detection: detection.confidence, reverse=True)
    return detections, filtered_count


def _normalize_yolo_label(label: Any) -> str:
    return str(label).strip().lower()


def _is_allowed_aerial_label(label: str) -> bool:
    return label in AERIAL_ALLOWED_CLASSES


def _bbox_area_ratio(
    bbox: tuple[int, int, int, int],
    image_width: int,
    image_height: int,
) -> float:
    x_min, y_min, x_max, y_max = bbox
    image_area = max(image_width * image_height, 1)
    bbox_area = max(x_max - x_min, 0) * max(y_max - y_min, 0)
    return bbox_area / image_area


def _is_valid_bbox_area_ratio(area_ratio: float) -> bool:
    return YOLO_MIN_BBOX_AREA_RATIO <= area_ratio <= YOLO_MAX_BBOX_AREA_RATIO


def _clamp_xyxy(
    xyxy: Any,
    x_offset: int,
    y_offset: int,
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    x_min, y_min, x_max, y_max = [int(round(float(value))) for value in xyxy]
    return (
        min(max(x_min + x_offset, 0), width),
        min(max(y_min + y_offset, 0), height),
        min(max(x_max + x_offset, 0), width),
        min(max(y_max + y_offset, 0), height),
    )


def _get_torch_device() -> str:
    try:
        import torch
    except ImportError:
        return "cpu"

    return "cuda" if torch.cuda.is_available() else "cpu"
