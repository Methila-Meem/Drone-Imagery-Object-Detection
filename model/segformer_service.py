from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any

import numpy as np
from PIL import Image, ImageOps

MODEL_NAME = "nvidia/segformer-b2-finetuned-ade-512-512"
MODEL_CACHE_DIR = Path(__file__).resolve().parent / ".cache" / "huggingface"
INFERENCE_MAX_SIDE = 1024

_TARGET_LABEL_ALIASES = {
    "building": ("building", "house", "skyscraper"),
    "vegetation": ("tree", "grass", "plant", "palm", "field"),
    "road": ("road", "route", "path", "runway", "sidewalk"),
    "earth/ground": ("earth", "ground", "land", "dirt", "soil"),
}

_MASK_COLORS = {
    "building": "#dc2626",
    "vegetation": "#16a34a",
    "road": "#2563eb",
    "earth/ground": "#ca8a04",
}

_MASK_ALPHA = {
    "building": 96,
    "vegetation": 96,
    "road": 96,
    "earth/ground": 88,
}

_MIN_COMPONENT_AREA_RATIO = 0.0004
_MAX_BOXES_PER_LABEL = 40
_FULL_BBOX_AREA_RATIO = 0.92
_FULL_COMPONENT_AREA_RATIO = 0.75


class SegFormerServiceError(RuntimeError):
    pass


@dataclass(frozen=True)
class SegFormerDetection:
    label: str
    confidence: float
    bbox: tuple[int, int, int, int]
    pixel_area: int
    color: str


@dataclass(frozen=True)
class SegFormerPrediction:
    detections: list[SegFormerDetection]
    mask_image: Image.Image
    model_used: str
    image_width: int
    image_height: int


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
    ) -> SegFormerPrediction:
        self._ensure_loaded()

        if self.processor is None or self.model is None or self.device is None:
            raise SegFormerServiceError("SegFormer service is not initialized.")

        torch = _import_torch()

        try:
            source_image = Image.open(image_path)
            source_image = ImageOps.exif_transpose(source_image).convert("RGB")
        except OSError as exc:
            raise SegFormerServiceError(
                f"Unable to read image for SegFormer detection: {image_path.name}"
            ) from exc

        output_width = output_size[0] if output_size else source_image.width
        output_height = output_size[1] if output_size else source_image.height
        processed_image = _resize_for_inference(source_image)
        processed_width, processed_height = processed_image.size

        inputs = self.processor(
            images=processed_image,
            return_tensors="pt",
            do_resize=False,
        )
        inputs = {key: value.to(self.device) for key, value in inputs.items()}

        try:
            with torch.no_grad():
                outputs = self.model(**inputs)
                semantic_map = self.processor.post_process_semantic_segmentation(
                    outputs,
                    target_sizes=[(processed_height, processed_width)],
                )[0]
                resized_logits = torch.nn.functional.interpolate(
                    outputs.logits,
                    size=(processed_height, processed_width),
                    mode="bilinear",
                    align_corners=False,
                )
                probabilities = torch.softmax(resized_logits, dim=1)[0]
                confidence_map = probabilities.max(dim=0).values
        except RuntimeError as exc:
            raise SegFormerServiceError(
                "SegFormer inference failed. Try a smaller image or run on a machine with more memory."
            ) from exc

        class_map_np = semantic_map.cpu().numpy().astype(np.int32)
        confidence_np = confidence_map.cpu().numpy().astype(np.float32)
        detections = self._extract_detections(
            class_map=class_map_np,
            confidence_map=confidence_np,
            confidence_threshold=confidence_threshold,
            output_width=output_width,
            output_height=output_height,
        )
        mask_image = self._build_mask_image(
            class_map=class_map_np,
            confidence_map=confidence_np,
            confidence_threshold=confidence_threshold,
            output_width=output_width,
            output_height=output_height,
        )

        return SegFormerPrediction(
            detections=detections,
            mask_image=mask_image,
            model_used=self.model_name,
            image_width=output_width,
            image_height=output_height,
        )

    def warm_up(self) -> None:
        self._ensure_loaded()

        if self.processor is None or self.model is None or self.device is None:
            raise SegFormerServiceError("SegFormer service is not initialized.")

        torch = _import_torch()
        dummy_image = Image.new("RGB", (64, 64), (0, 0, 0))
        inputs = self.processor(images=dummy_image, return_tensors="pt", do_resize=False)
        inputs = {key: value.to(self.device) for key, value in inputs.items()}

        try:
            with torch.no_grad():
                outputs = self.model(**inputs)
                self.processor.post_process_semantic_segmentation(
                    outputs,
                    target_sizes=[(64, 64)],
                )
        except RuntimeError as exc:
            raise SegFormerServiceError("SegFormer warm-up inference failed.") from exc

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
                local_files_only = _has_cached_model(self.model_name)
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
        image_area = width * height
        min_area = max(32, int(image_area * _MIN_COMPONENT_AREA_RATIO))
        x_scale = output_width / width
        y_scale = output_height / height
        detections: list[SegFormerDetection] = []

        for class_id, target_label in self.id_to_target_label.items():
            mask = (class_map == class_id).astype(np.uint8)
            component_count, labels, stats, _ = cv2.connectedComponentsWithStats(
                mask,
                connectivity=8,
            )

            label_detections: list[SegFormerDetection] = []
            for component_id in range(1, component_count):
                x = int(stats[component_id, cv2.CC_STAT_LEFT])
                y = int(stats[component_id, cv2.CC_STAT_TOP])
                box_width = int(stats[component_id, cv2.CC_STAT_WIDTH])
                box_height = int(stats[component_id, cv2.CC_STAT_HEIGHT])
                area = int(stats[component_id, cv2.CC_STAT_AREA])

                if area < min_area:
                    continue

                bbox_area_ratio = (box_width * box_height) / image_area
                component_area_ratio = area / image_area
                if (
                    bbox_area_ratio >= _FULL_BBOX_AREA_RATIO
                    and component_area_ratio < _FULL_COMPONENT_AREA_RATIO
                ):
                    continue

                component_pixels = labels == component_id
                confidence_values = confidence_map[component_pixels]
                if confidence_values.size == 0:
                    continue

                confidence = float(confidence_values.mean())
                if confidence < confidence_threshold:
                    continue

                x_max = min(x + box_width, width)
                y_max = min(y + box_height, height)
                scaled_bbox = (
                    int(round(x * x_scale)),
                    int(round(y * y_scale)),
                    int(round(x_max * x_scale)),
                    int(round(y_max * y_scale)),
                )
                scaled_area = int(round(area * x_scale * y_scale))

                label_detections.append(
                    SegFormerDetection(
                        label=target_label,
                        confidence=round(confidence, 4),
                        bbox=scaled_bbox,
                        pixel_area=max(1, scaled_area),
                        color=_MASK_COLORS[target_label],
                    )
                )

            label_detections.sort(
                key=lambda detection: detection.pixel_area,
                reverse=True,
            )
            detections.extend(label_detections[:_MAX_BOXES_PER_LABEL])

        detections.sort(key=lambda detection: detection.confidence, reverse=True)
        return detections

    def _build_mask_image(
        self,
        class_map: np.ndarray,
        confidence_map: np.ndarray,
        confidence_threshold: float,
        output_width: int,
        output_height: int,
    ) -> Image.Image:
        height, width = class_map.shape
        mask_rgba = np.zeros((height, width, 4), dtype=np.uint8)

        for class_id, target_label in self.id_to_target_label.items():
            color = _hex_to_rgba(
                _MASK_COLORS[target_label],
                alpha=_MASK_ALPHA[target_label],
            )
            pixels = (class_map == class_id) & (confidence_map >= confidence_threshold)
            mask_rgba[pixels] = color

        mask_image = Image.fromarray(mask_rgba, mode="RGBA")
        if mask_image.size != (output_width, output_height):
            mask_image = mask_image.resize(
                (output_width, output_height),
                resample=Image.Resampling.NEAREST,
            )

        return mask_image


_SERVICE = SegFormerService()


def run_segformer_detection(
    image_path: Path,
    confidence_threshold: float,
    output_size: tuple[int, int] | None = None,
) -> SegFormerPrediction:
    return _SERVICE.predict(
        image_path=image_path,
        confidence_threshold=confidence_threshold,
        output_size=output_size,
    )


def warm_up_segformer() -> None:
    _SERVICE.warm_up()


def _resize_for_inference(image: Image.Image) -> Image.Image:
    max_side = max(image.size)
    if max_side <= INFERENCE_MAX_SIDE:
        return image

    scale = INFERENCE_MAX_SIDE / max_side
    width = max(1, int(round(image.width * scale)))
    height = max(1, int(round(image.height * scale)))
    return image.resize((width, height), resample=Image.Resampling.LANCZOS)


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


def _has_cached_model(model_name: str) -> bool:
    cache_name = f"models--{model_name.replace('/', '--')}"
    snapshots_dir = MODEL_CACHE_DIR / cache_name / "snapshots"
    return snapshots_dir.exists() and any(snapshots_dir.iterdir())


def _hex_to_rgba(color: str, alpha: int) -> tuple[int, int, int, int]:
    normalized = color.lstrip("#")
    return (
        int(normalized[0:2], 16),
        int(normalized[2:4], 16),
        int(normalized[4:6], 16),
        alpha,
    )


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
