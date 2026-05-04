# Model Layer

This directory contains the model-facing code and local model caches used by the backend.

## SegFormer

`segformer_service.py` implements the primary SRS detection path:

- Loads `nvidia/segformer-b2-finetuned-ade-512-512` through HuggingFace Transformers.
- Uses CUDA when available and CPU otherwise.
- Resizes source imagery to a max side of `1024` before inference.
- Calls `processor.post_process_semantic_segmentation(outputs, target_sizes=[(H, W)])`.
- Converts useful ADE semantic classes into component bounding boxes with OpenCV `connectedComponentsWithStats`.
- Returns component-level detections with `label`, `confidence`, `bbox`, `pixel_area`, and `color`.
- Builds transparent RGBA mask images for the backend to save under `backend/static/outputs/`.

The backend wrapper lives in `backend/app/services/segformer_detection.py` and handles image lookup, API error mapping, detection persistence, and static mask URLs.

## Local Caches

Downloaded HuggingFace and Ultralytics artifacts are kept under `model/.cache/` and are ignored by git. A clean clone may download model weights on first use if they are not already cached locally.

## Optional YOLO

YOLOv8s is implemented in `backend/app/services/yolo_service.py`, not in this directory. Its cache is still stored under `model/.cache/ultralytics`.
