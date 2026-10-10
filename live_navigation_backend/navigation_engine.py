from collections import Counter
from typing import Any

from config import settings

BLOCKING_RISKS = {"medium", "high", "critical"}
LEFT_ZONES = {"far_left", "left", "center_left"}
RIGHT_ZONES = {"far_right", "right", "center_right"}


def _risk_score(item: dict[str, Any]) -> float:
    distance_score = {"very_close": 1.0, "close": 0.8, "medium": 0.5, "near": 0.5, "far": 0.15, "unknown": 0.35}.get(item.get("distance_category", "unknown"), 0.35)
    position_score = 0.9 if item.get("in_path") else 0.2
    movement_score = 0.25 if item.get("movement") == "approaching" else 0.0
    confidence_score = float(item.get("confidence", 0.0)) * 0.2
    return distance_score * 0.45 + position_score * 0.3 + movement_score + confidence_score


def _blocking(detections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [item for item in detections if item.get("confirmed", True) and item.get("in_path") and item.get("risk") in BLOCKING_RISKS]


def _side_blocked(detections: list[dict[str, Any]], zones: set[str]) -> bool:
    return any(item.get("direction") in zones and item.get("risk") in BLOCKING_RISKS for item in detections)


def _safe_direction(detections: list[dict[str, Any]], obstacle: dict[str, Any]) -> str | None:
    left_blocked = _side_blocked(detections, LEFT_ZONES)
    right_blocked = _side_blocked(detections, RIGHT_ZONES)
    preferred = "right" if obstacle.get("direction") in LEFT_ZONES else "left"
    if preferred == "left" and not left_blocked:
        return "left"
    if preferred == "right" and not right_blocked:
        return "right"
    if not left_blocked:
        return "left"
    if not right_blocked:
        return "right"
    return None


def _description(item: dict[str, Any]) -> str:
    direction = item.get("direction", "center")
    location = "ahead" if direction == "center" else f"on the {direction.replace('_', ' ')}"
    return f"{item.get('label', 'obstacle')} {location}"


def _decision(status: str, action: str, instruction: str, confidence: float) -> dict[str, Any]:
    return {"status": status, "action": action, "instruction": instruction, "confidence": round(max(0.0, min(1.0, confidence)), 2)}


def make_navigation_decision(detections: list[dict[str, Any]]) -> dict[str, Any]:
    confirmed = [item for item in detections if item.get("confirmed", True)]
    if not confirmed:
        tentative = next((item for item in detections if item.get("in_path")), None)
        if tentative:
            return _decision("caution", "slow_down", f"Possible {tentative.get('label', 'obstacle')} ahead. Slow down while I confirm it.", 0.45)
        return _decision("clear", "continue", "Path ahead appears clear. Continue forward.", 0.7)

    blocking = sorted(_blocking(confirmed), key=_risk_score, reverse=True)
    if not blocking:
        visible = max(confirmed, key=lambda item: float(item.get("confidence", 0.0)))
        return _decision("clear", "continue", f"I see a {_description(visible)}. The walking path is clear.", 0.75)

    obstacle = blocking[0]
    score = _risk_score(obstacle)
    direction = _safe_direction(confirmed, obstacle)
    distance_category = obstacle.get("distance_category", "unknown")
    approaching = obstacle.get("movement") == "approaching"

    if obstacle.get("risk") == "critical" or distance_category == "very_close":
        if direction and score >= settings.minimum_decision_confidence:
            return _decision("critical", f"move_{direction}", f"Warning. There is a {obstacle['label']} very close ahead. Move {direction} to avoid it.", score)
        return _decision("critical", "stop", f"Stop. The {obstacle['label']} is very close and I cannot confirm a safe path around it.", score)

    if approaching and obstacle.get("risk") in {"high", "critical"}:
        if not direction:
            return _decision("danger", "stop", f"Stop. The {obstacle['label']} is approaching and both sides are blocked.", score)
        if direction and score >= settings.minimum_decision_confidence:
            return _decision("danger", f"move_{direction}", f"Warning. The {obstacle['label']} is approaching. Move {direction}.", score)
        return _decision("danger", "slow_down", f"Warning. A {obstacle['label']} is approaching. Slow down.", score)

    if obstacle.get("risk") == "high":
        if direction and score >= settings.minimum_decision_confidence:
            return _decision("danger", f"move_{direction}", f"Warning. There is a {obstacle['label']} ahead. Move {direction} to avoid it.", score)
        return _decision("danger", "stop", f"Stop. The {obstacle['label']} is blocking the walking path.", score)

    if direction and score >= settings.minimum_decision_confidence:
        return _decision("caution", f"move_{direction}", f"Caution. There is a {obstacle['label']} ahead. Move {direction} to avoid it.", score)
    return _decision("caution", "slow_down", f"Caution. There is a {obstacle['label']} ahead. Slow down.", score)


def scene_summary(detections: list[dict[str, Any]]) -> str:
    visible = [item for item in detections if item.get("risk") in BLOCKING_RISKS]
    if not visible:
        return ""
    counts = Counter(item.get("label", "object") for item in visible)
    parts = [f"{count} {label}{'s' if count != 1 else ''}" for label, count in counts.most_common(2)]
    return ", ".join(parts) + "."
