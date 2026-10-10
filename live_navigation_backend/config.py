from dataclasses import dataclass
import os

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))
    model_name: str = os.getenv("YOLO_MODEL", "yolo11m.pt")
    confidence_threshold: float = float(os.getenv("CONFIDENCE_THRESHOLD", "0.45"))
    small_object_threshold: float = float(os.getenv("SMALL_OBJECT_THRESHOLD", "0.30"))
    iou_threshold: float = float(os.getenv("IOU_THRESHOLD", "0.5"))
    image_size: int = int(os.getenv("IMAGE_SIZE", "640"))
    device: str = os.getenv("YOLO_DEVICE", "auto")
    detection_fps: float = float(os.getenv("DETECTION_FPS", "7"))
    class_thresholds: str = os.getenv("CLASS_THRESHOLDS", "")
    critical_distance: float = float(os.getenv("CRITICAL_DISTANCE", "0.8"))
    danger_distance: float = float(os.getenv("DANGER_DISTANCE", "1.5"))
    nearby_distance: float = float(os.getenv("NEARBY_DISTANCE", "3.0"))
    walking_corridor_width: float = float(os.getenv("WALKING_CORRIDOR_WIDTH", "0.36"))
    corridor_start: float = float(os.getenv("CORRIDOR_START", "0.40"))
    minimum_track_hits: int = int(os.getenv("MINIMUM_TRACK_HITS", "2"))
    maximum_track_age: int = int(os.getenv("MAXIMUM_TRACK_AGE", "3"))
    tracker_max_distance: float = float(os.getenv("TRACKER_MAX_DISTANCE", "120"))
    temporal_smoothing: float = float(os.getenv("TEMPORAL_SMOOTHING", "0.65"))
    instruction_cooldown: float = float(os.getenv("INSTRUCTION_COOLDOWN", "2.0"))
    critical_warning_cooldown: float = float(os.getenv("CRITICAL_WARNING_COOLDOWN", "0.8"))
    minimum_decision_confidence: float = float(os.getenv("MINIMUM_DECISION_CONFIDENCE", "0.58"))
    debug_overlays: bool = os.getenv("DEBUG_OVERLAYS", "false").lower() == "true"
    log_level: str = os.getenv("LOG_LEVEL", "INFO").upper()
    debug: bool = os.getenv("DEBUG_OVERLAYS", "false").lower() == "true"
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")


settings = Settings()
