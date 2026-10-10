from dataclasses import dataclass
from math import hypot
from typing import Any

from config import settings


@dataclass
class Track:
    label: str
    bbox: dict[str, float]
    hits: int = 1
    missed: int = 0
    movement: str = "stationary"


def _center(bbox: dict[str, float]) -> tuple[float, float]:
    return ((bbox["x1"] + bbox["x2"]) / 2, (bbox["y1"] + bbox["y2"]) / 2)


def _area(bbox: dict[str, float]) -> float:
    return max(1.0, bbox["x2"] - bbox["x1"]) * max(1.0, bbox["y2"] - bbox["y1"])


class CentroidTracker:
    """Lightweight per-session tracker with confirmation, aging, and motion labels."""

    def __init__(self, max_distance: float | None = None, smoothing: float | None = None) -> None:
        self.max_distance = max_distance or settings.tracker_max_distance
        self.smoothing = smoothing if smoothing is not None else settings.temporal_smoothing
        self.next_id = 1
        self.previous: dict[int, Track] = {}

    def update(self, detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
        unmatched = set(self.previous)
        current: dict[int, Track] = {}

        for detection in detections:
            bbox = detection["bbox"]
            center = _center(bbox)
            candidates = [track_id for track_id in unmatched if self.previous[track_id].label == detection["label"]]
            track_id = min(
                candidates,
                key=lambda item: hypot(center[0] - _center(self.previous[item].bbox)[0], center[1] - _center(self.previous[item].bbox)[1]),
                default=None,
            )
            if track_id is None:
                track_id = self.next_id
                self.next_id += 1
            else:
                previous_center = _center(self.previous[track_id].bbox)
                if hypot(center[0] - previous_center[0], center[1] - previous_center[1]) > self.max_distance:
                    track_id = self.next_id
                    self.next_id += 1
                else:
                    unmatched.remove(track_id)

            previous = self.previous.get(track_id)
            if previous:
                previous_area = _area(previous.bbox)
                for coordinate in ("x1", "y1", "x2", "y2"):
                    bbox[coordinate] = round(previous.bbox[coordinate] * (1 - self.smoothing) + bbox[coordinate] * self.smoothing, 1)
                area_change = (_area(bbox) - previous_area) / max(previous_area, 1.0)
                movement = "approaching" if area_change > 0.12 else "moving_away" if area_change < -0.12 else "stationary"
                hits = previous.hits + 1
            else:
                movement = "unknown"
                hits = 1

            current[track_id] = Track(detection["label"], bbox.copy(), hits, 0, movement)
            detection["track_id"] = track_id
            detection["track_hits"] = hits
            detection["confirmed"] = hits >= settings.minimum_track_hits
            detection["movement"] = movement

        for track_id in unmatched:
            track = self.previous[track_id]
            track.missed += 1
            if track.missed <= settings.maximum_track_age:
                current[track_id] = track

        self.previous = current
        return detections
