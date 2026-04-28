from app.schemas.detection import DetectionResult


def non_max_suppression(
    detections: list[DetectionResult],
    iou_threshold: float,
    max_detections: int,
) -> list[DetectionResult]:
    sorted_detections = sorted(
        detections,
        key=lambda detection: detection.confidence,
        reverse=True,
    )
    kept: list[DetectionResult] = []

    for detection in sorted_detections:
        if len(kept) >= max_detections:
            break

        if all(
            bbox_iou(detection.bbox, kept_detection.bbox) < iou_threshold
            for kept_detection in kept
        ):
            kept.append(detection)

    return kept


def bbox_iou(
    first: tuple[int, int, int, int],
    second: tuple[int, int, int, int],
) -> float:
    first_x_min, first_y_min, first_x_max, first_y_max = first
    second_x_min, second_y_min, second_x_max, second_y_max = second

    intersection_x_min = max(first_x_min, second_x_min)
    intersection_y_min = max(first_y_min, second_y_min)
    intersection_x_max = min(first_x_max, second_x_max)
    intersection_y_max = min(first_y_max, second_y_max)

    intersection_width = max(0, intersection_x_max - intersection_x_min)
    intersection_height = max(0, intersection_y_max - intersection_y_min)
    intersection_area = intersection_width * intersection_height

    first_area = max(0, first_x_max - first_x_min) * max(
        0,
        first_y_max - first_y_min,
    )
    second_area = max(0, second_x_max - second_x_min) * max(
        0,
        second_y_max - second_y_min,
    )
    union_area = first_area + second_area - intersection_area

    if union_area <= 0:
        return 0.0

    return intersection_area / union_area
