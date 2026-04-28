from pathlib import Path
from uuid import uuid4

from app.schemas.detection import DetectionResponse, DetectionResult
from app.services.image_registry import STATIC_IMAGES_DIR, UnknownImageError, get_image

_SEGFORMER_MODULE = None
STATIC_MASKS_DIR = Path(__file__).resolve().parents[2] / "static" / "masks"


class SegFormerDetectionError(RuntimeError):
    pass


def run_real_detection(
    image_id: str,
    confidence_threshold: float,
    mask_url_base: str | None = None,
) -> DetectionResponse:
    try:
        image = get_image(image_id)
    except UnknownImageError:
        raise

    image_path = STATIC_IMAGES_DIR / image.filename
    service = _load_segformer_service()

    try:
        prediction = service.run_segformer_detection(
            image_path=image_path,
            confidence_threshold=confidence_threshold,
            output_size=(image.width, image.height),
        )
    except service.SegFormerServiceError as exc:
        raise SegFormerDetectionError(str(exc)) from exc

    mask_filename = _save_mask_image(
        image_id=image.image_id,
        confidence_threshold=confidence_threshold,
        mask_image=prediction.mask_image,
    )
    detections = [
        DetectionResult(
            label=detection.label,
            confidence=detection.confidence,
            bbox=detection.bbox,
        )
        for detection in prediction.detections
    ]

    return DetectionResponse(
        image_id=image.image_id,
        mode="real",
        detections=detections,
        mask_url=(
            f"{mask_url_base.rstrip('/')}/{mask_filename}" if mask_url_base else None
        ),
    )


def _save_mask_image(
    image_id: str,
    confidence_threshold: float,
    mask_image,
) -> str:
    STATIC_MASKS_DIR.mkdir(parents=True, exist_ok=True)
    threshold_token = f"{confidence_threshold:.2f}".replace(".", "_")
    mask_filename = f"{image_id}_mask_{threshold_token}_{uuid4().hex}.png"
    temp_path = STATIC_MASKS_DIR / f"{mask_filename}.uploading"
    target_path = STATIC_MASKS_DIR / mask_filename

    mask_image.save(temp_path, format="PNG")
    temp_path.replace(target_path)
    return mask_filename


def _load_segformer_service():
    global _SEGFORMER_MODULE

    if _SEGFORMER_MODULE is not None:
        return _SEGFORMER_MODULE

    try:
        from model import segformer_service
    except ImportError:
        import importlib.util
        import sys

        service_path = (
            Path(__file__).resolve().parents[3] / "model" / "segformer_service.py"
        )
        spec = importlib.util.spec_from_file_location(
            "model.segformer_service",
            service_path,
        )
        if spec is None or spec.loader is None:
            raise SegFormerDetectionError("Unable to locate model/segformer_service.py.")

        segformer_service = importlib.util.module_from_spec(spec)
        sys.modules["model.segformer_service"] = segformer_service
        spec.loader.exec_module(segformer_service)

    _SEGFORMER_MODULE = segformer_service
    return segformer_service
