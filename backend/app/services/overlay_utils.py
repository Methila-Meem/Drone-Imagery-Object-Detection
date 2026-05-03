from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageDraw

from app.schemas.detection import DetectionResult

STATIC_MASKS_DIR = Path(__file__).resolve().parents[2] / "static" / "masks"
STATIC_OUTPUTS_DIR = Path(__file__).resolve().parents[2] / "static" / "outputs"


def save_overlay_image(
    image_id: str,
    confidence_threshold: float,
    image: Image.Image,
    prefix: str,
    subdir: str | None = None,
) -> str:
    output_dir = STATIC_MASKS_DIR / subdir if subdir else STATIC_MASKS_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    threshold_token = f"{confidence_threshold:.2f}".replace(".", "_")
    filename = f"{image_id}_{prefix}_{threshold_token}_{uuid4().hex}.png"
    temp_path = output_dir / f"{filename}.uploading"
    target_path = output_dir / filename

    image.save(temp_path, format="PNG")
    temp_path.replace(target_path)
    return f"{subdir}/{filename}" if subdir else filename


def save_detection_mask(detection_id: str, image: Image.Image) -> str:
    STATIC_OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{detection_id}_mask.png"
    temp_path = STATIC_OUTPUTS_DIR / f"{filename}.uploading"
    target_path = STATIC_OUTPUTS_DIR / filename

    image.save(temp_path, format="PNG")
    temp_path.replace(target_path)
    return filename


def build_static_url(static_url_base: str | None, path: str) -> str | None:
    if static_url_base is None:
        return None

    return f"{static_url_base.rstrip('/')}/{path.lstrip('/')}"


def build_detection_overlay(
    width: int,
    height: int,
    detections: list[DetectionResult],
) -> Image.Image:
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for detection in detections:
        x_min, y_min, x_max, y_max = _clamp_bbox(detection.bbox, width, height)
        if x_max <= x_min or y_max <= y_min:
            continue

        label = f"{detection.label} {detection.confidence:.2f}"
        draw.rectangle(
            (x_min, y_min, x_max, y_max),
            fill=(37, 99, 235, 54),
            outline=(37, 99, 235, 220),
            width=max(2, round(min(width, height) * 0.0015)),
        )

        text_bbox = draw.textbbox((x_min, y_min), label)
        text_width = text_bbox[2] - text_bbox[0]
        text_height = text_bbox[3] - text_bbox[1]
        label_y = max(0, y_min - text_height - 6)
        draw.rectangle(
            (x_min, label_y, x_min + text_width + 8, label_y + text_height + 6),
            fill=(15, 23, 42, 190),
        )
        draw.text((x_min + 4, label_y + 3), label, fill=(255, 255, 255, 235))

    return overlay


def _clamp_bbox(
    bbox: tuple[int, int, int, int],
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    x_min, y_min, x_max, y_max = bbox
    return (
        min(max(x_min, 0), width),
        min(max(y_min, 0), height),
        min(max(x_max, 0), width),
        min(max(y_max, 0), height),
    )
