from typing import Any

from config import settings

NAVIGATION_RELEVANT = {
    "person", "bicycle", "car", "motorcycle", "bus", "truck", "bench",
    "chair", "couch", "dining table", "backpack", "handbag", "suitcase",
    "bottle", "cup", "bowl", "dog", "cat", "bird", "horse", "sheep", "cow",
    "traffic light", "fire hydrant", "stop sign", "skateboard", "umbrella",
    "potted plant", "bed", "toilet", "refrigerator", "suitcase", "sports ball",
}

SMALL_OBJECT_CLASSES = {
    "bottle", "cup", "bowl", "backpack", "handbag", "cell phone", "book",
    "traffic light", "stop sign", "fire hydrant", "potted plant",
}

MOVING_LABELS = {"person", "bicycle", "motorcycle", "car", "bus", "truck", "dog", "cat"}


def classify_risk(detection: dict[str, Any]) -> str:
    distance = detection.get("distance")
    in_path = detection.get("in_path", False)
    approaching = detection.get("movement") == "approaching"
    if not in_path:
        if approaching and distance is not None and distance < settings.nearby_distance:
            return "medium"
        return "low" if distance is None or distance >= settings.nearby_distance else "medium"
    if detection.get("confidence", 0.0) < settings.minimum_decision_confidence:
        return "medium" if distance is not None and distance < settings.danger_distance else "low"
    if distance is not None and distance < settings.critical_distance:
        return "critical"
    if distance is not None and distance < settings.danger_distance:
        return "high"
    if approaching:
        return "high"
    return "medium"


def is_relevant(label: str) -> bool:
    return label in NAVIGATION_RELEVANT
