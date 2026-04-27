from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any

import numpy as np
from PIL import Image, ImageOps

MODEL_NAME = "nvidia/segformer-b0-finetuned-ade-512-512"
MODEL_CACHE_DIR = Path(__file__).resolve().parent / ".cache" / "huggingface"

_TARGET_LABEL_ALIASES = {
    "building": ("building", "house", "skyscraper"),
    "vegetation": ("tree", "grass", "plant", "palm", "field"),
    "road": ("road", "route", "path", "runway", "sidewalk"),
    "earth/ground": ("earth", "ground", "land", "dirt", "soil"),
}

_MIN_COMPONENT_AREA_RATIO = 0.0003
_MAX_BOXES_PER_LABEL = 20


class SegFormerServiceError(RuntimeError):
    pass


@dataclass(frozen=True)
class SegFormerDetection:
    label: str
    confidence: float
    bbox: tuple[int, int, int, int]


class SegFormerService:
    def __init__(self, model_name: str = MODEL_NAME) -> None:
        self.model_name = model_name
        self.device: Any | None = None
        self.processor: Any | None = None
        self.model: Any | None = None
        self.id_to_target_label: dict[int, str] = {}
        self._lock = Lock()

    def predict(
        self,
        image_path: Path,
        confidence_threshold: float,
        output_size: tuple[int, int] | None = None,
    ) -> list[SegFormerDetection]:
        self._ensure_loaded()

        if self.processor is None or self.model is None or self.device is None:
            raise SegFormerServiceError("SegFormer service is not initialized.")

        torch = _import_torch()

        try:
            image = Image.open(image_path)
            image = ImageOps.exif_transpose(image).convert("RGB")
        except OSError as exc:
            raise SegFormerServiceError(
                f"Unable to read image for real detection: {image_path.name}"
            ) from exc

        inputs = self.processor(images=image, return_tensors="pt")
        inputs = {key: value.to(self.device) for key, value in inputs.items()}

        try:
            with torch.no_grad():
                outputs = self.model(**inputs)
                probabilities = torch.softmax(outputs.logits, dim=1)[0]
                confidence_map, class_map = probabilities.max(dim=0)
        except RuntimeError as exc:
            raise SegFormerServiceError(
                "SegFormer inference failed. Try a smaller image or run on a machine with more memory."
            ) from exc

        class_map_np = class_map.cpu().numpy().astype(np.int32)
        confidence_np = confidence_map.cpu().numpy().astype(np.float32)

        return self._extract_detections(
            class_map=class_map_np,
            confidence_map=confidence_np,
            confidence_threshold=confidence_threshold,
            output_width=output_size[0] if output_size else image.width,
            output_height=output_size[1] if output_size else image.height,
        )

    def _ensure_loaded(self) -> None:
        if self.model is not None and self.processor is not None:
            return

        with self._lock:
            if self.model is not None and self.processor is not None:
                return

            torch = _import_torch()

            try:
                from transformers import SegformerForSemanticSegmentation
                from transformers import SegformerImageProcessor
            except ImportError as exc:
                raise SegFormerServiceError(
                    "HuggingFace Transformers is required for real detection. Install backend requirements and retry."
                ) from exc

            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

            try:
                MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
                local_files_only = _has_cached_model()
                self.processor = SegformerImageProcessor.from_pretrained(
                    self.model_name,
                    cache_dir=MODEL_CACHE_DIR,
                    local_files_only=local_files_only,
                )
                self.model = SegformerForSemanticSegmentation.from_pretrained(
                    self.model_name,
                    cache_dir=MODEL_CACHE_DIR,
                    local_files_only=local_files_only,
                )
                self.model.to(self.device)
                self.model.eval()
            except Exception as exc:
                raise SegFormerServiceError(
                    f"Unable to load SegFormer model '{self.model_name}'. "
                    "Check that backend dependencies are installed and the HuggingFace model can be downloaded."
                ) from exc

            self.id_to_target_label = _build_target_label_map(
                self.model.config.id2label
            )

            if not self.id_to_target_label:
                raise SegFormerServiceError(
                    f"SegFormer model '{self.model_name}' loaded, but no useful ADE labels were found."
                )

    def _extract_detections(
        self,
        class_map: np.ndarray,
        confidence_map: np.ndarray,
        confidence_threshold: float,
        output_width: int,
        output_height: int,
    ) -> list[SegFormerDetection]:
        cv2 = _import_cv2()
        height, width = class_map.shape
        min_area = max(4, int(width * height * _MIN_COMPONENT_AREA_RATIO))
        x_scale = output_width / width
        y_scale = output_height / height
        detections: list[SegFormerDetection] = []

        for class_id, target_label in self.id_to_target_label.items():
            mask = (class_map == class_id).astype(np.uint8) * 255
            contours, _ = cv2.findContours(
                mask,
                cv2.RETR_EXTERNAL,
                cv2.CHAIN_APPROX_SIMPLE,
            )

            label_detections: list[SegFormerDetection] = []
            for contour in contours:
                area = int(cv2.contourArea(contour))
                if area < min_area:
                    continue

                x, y, box_width, box_height = cv2.boundingRect(contour)
                component_mask = np.zeros(mask.shape, dtype=np.uint8)
                cv2.drawContours(component_mask, [contour], -1, 255, thickness=-1)
                confidence_values = confidence_map[component_mask == 255]
                if confidence_values.size == 0:
                    continue

                confidence = float(confidence_values.mean())
                if confidence < confidence_threshold:
                    continue

                label_detections.append(
                    SegFormerDetection(
                        label=target_label,
                        confidence=round(confidence, 4),
                        bbox=(
                            int(round(x * x_scale)),
                            int(round(y * y_scale)),
                            int(round(min(x + box_width, width) * x_scale)),
                            int(round(min(y + box_height, height) * y_scale)),
                        ),
                    )
                )

            label_detections.sort(
                key=lambda detection: detection.confidence,
                reverse=True,
            )
            detections.extend(label_detections[:_MAX_BOXES_PER_LABEL])

        detections.sort(key=lambda detection: detection.confidence, reverse=True)
        return detections


_SERVICE = SegFormerService()


def run_segformer_detection(
    image_path: Path,
    confidence_threshold: float,
    output_size: tuple[int, int] | None = None,
) -> list[SegFormerDetection]:
    return _SERVICE.predict(
        image_path=image_path,
        confidence_threshold=confidence_threshold,
        output_size=output_size,
    )


def _build_target_label_map(id2label: dict[int | str, str]) -> dict[int, str]:
    id_to_target_label: dict[int, str] = {}

    for raw_class_id, raw_label in id2label.items():
        class_id = int(raw_class_id)
        normalized_label = _normalize_label(raw_label)

        for target_label, aliases in _TARGET_LABEL_ALIASES.items():
            if any(alias in normalized_label for alias in aliases):
                id_to_target_label[class_id] = target_label
                break

    return id_to_target_label


def _normalize_label(label: str) -> str:
    return (
        label.lower()
        .replace(",", " ")
        .replace("-", " ")
        .replace("_", " ")
        .replace("/", " ")
    )


def _has_cached_model() -> bool:
    cache_name = f"models--{MODEL_NAME.replace('/', '--')}"
    snapshots_dir = MODEL_CACHE_DIR / cache_name / "snapshots"
    return snapshots_dir.exists() and any(snapshots_dir.iterdir())


def _import_torch() -> Any:
    try:
        import torch
    except ImportError as exc:
        raise SegFormerServiceError(
            "PyTorch is required for real detection. Install backend requirements and retry."
        ) from exc

    return torch


def _import_cv2() -> Any:
    try:
        import cv2
    except ImportError as exc:
        raise SegFormerServiceError(
            "OpenCV is required to convert segmentation masks into bounding boxes. Install opencv-python-headless and retry."
        ) from exc

    return cv2
