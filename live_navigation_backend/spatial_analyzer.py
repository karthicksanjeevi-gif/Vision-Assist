from typing import Any

from config import settings


def direction_for_bbox(bbox: dict[str, float], frame_width: int) -> str:
    center_x = (bbox["x1"] + bbox["x2"]) / 2
    normalized = center_x / max(1, frame_width)
    if normalized < 0.16:
        return "far_left"
    if normalized < 0.33:
        return "left"
    if normalized < 0.46:
        return "center_left"
    if normalized > 0.84:
        return "far_right"
    if normalized > 0.67:
        return "right"
    if normalized > 0.54:
        return "center_right"
    return "center"


def corridor_for_frame(frame_width: int, frame_height: int) -> dict[str, float]:
    corridor_width = min(0.8, max(0.2, settings.walking_corridor_width))
    return {
        "x1": frame_width * (0.5 - corridor_width / 2),
        "x2": frame_width * (0.5 + corridor_width / 2),
        "y1": frame_height * settings.corridor_start,
        "y2": frame_height * 0.98,
    }


def intersects_corridor(bbox: dict[str, float], corridor: dict[str, float]) -> bool:
    overlap_x = bbox["x1"] < corridor["x2"] and bbox["x2"] > corridor["x1"]
    overlap_y = bbox["y1"] < corridor["y2"] and bbox["y2"] > corridor["y1"]
    return overlap_x and overlap_y


def enrich_detection(detection: dict[str, Any], frame_width: int, frame_height: int) -> dict[str, Any]:
    corridor = corridor_for_frame(frame_width, frame_height)
    detection["direction"] = direction_for_bbox(detection["bbox"], frame_width)
    detection["in_path"] = intersects_corridor(detection["bbox"], corridor)
    detection["normalized_center"] = {
        "x": round(detection["center"]["x"] / max(frame_width, 1), 3),
        "y": round(detection["center"]["y"] / max(frame_height, 1), 3),
    }
    return detection
