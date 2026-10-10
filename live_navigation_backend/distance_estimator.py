from typing import Any

# Approximate real-world heights for common COCO classes, in metres.
KNOWN_HEIGHTS = {
    "person": 1.7,
    "bicycle": 1.1,
    "car": 1.5,
    "motorcycle": 1.2,
    "bus": 3.0,
    "truck": 2.5,
    "dog": 0.6,
    "cat": 0.35,
    "chair": 0.9,
    "bench": 0.8,
    "suitcase": 0.7,
    "backpack": 0.5,
    "traffic light": 2.5,
    "stop sign": 2.0,
}


def estimate_distance(detection: dict[str, Any], frame_height: int) -> float | None:
    """Return a rough monocular estimate; callers should expose categories, not precision."""
    label = detection["label"]
    known_height = KNOWN_HEIGHTS.get(label)
    box_height = max(1.0, detection["bbox"]["y2"] - detection["bbox"]["y1"])
    if not known_height or frame_height <= 0:
        return None

    # A calibrated focal length is unavailable in a browser camera stream. This
    # deliberately uses a conservative scale and rounds the result upstream.
    focal_length = frame_height * 0.9
    return max(0.35, min(12.0, (known_height * focal_length) / box_height))


def distance_category(distance: float | None) -> str:
    if distance is None:
        return "unknown"
    if distance < 0.8:
        return "very_close"
    if distance < 1.5:
        return "close"
    if distance < 3.0:
        return "medium"
    return "far"
