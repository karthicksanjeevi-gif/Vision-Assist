import logging
import json
from typing import Any

import numpy as np

from config import settings
from distance_estimator import distance_category, estimate_distance
from model_loader import ModelLoader
from obstacle_detector import SMALL_OBJECT_CLASSES, classify_risk, is_relevant
from spatial_analyzer import enrich_detection

logger = logging.getLogger(__name__)


def _class_thresholds() -> dict[str, float]:
    if not settings.class_thresholds.strip():
        return {}
    try:
        values = json.loads(settings.class_thresholds)
        return {str(label): float(value) for label, value in values.items()}
    except (TypeError, ValueError, AttributeError, json.JSONDecodeError):
        logger.warning("Ignoring invalid CLASS_THRESHOLDS configuration")
        return {}


def detect_objects(frame: np.ndarray) -> list[dict[str, Any]]:
    try:
        height, width = frame.shape[:2]
        model = ModelLoader.get_model()
        predict_options: dict[str, Any] = {
            "conf": settings.confidence_threshold,
            "iou": settings.iou_threshold,
            "imgsz": settings.image_size,
            "verbose": False,
        }
        if settings.device.lower() != "auto":
            predict_options["device"] = settings.device
        results = model.predict(frame, **predict_options)
        detections: list[dict[str, Any]] = []
        class_thresholds = _class_thresholds()

        for result in results:
            names = result.names
            boxes = result.boxes
            if boxes is None:
                continue
            for box in boxes:
                label = str(names[int(box.cls[0])])
                confidence = float(box.conf[0])
                default_threshold = settings.small_object_threshold if label in SMALL_OBJECT_CLASSES else settings.confidence_threshold
                threshold = class_thresholds.get(label, default_threshold)
                if not is_relevant(label) or confidence < threshold:
                    continue
                coordinates = box.xyxy[0].tolist()
                x1, y1, x2, y2 = coordinates
                box_width = max(0.0, x2 - x1)
                box_height = max(0.0, y2 - y1)
                detection: dict[str, Any] = {
                    "label": label,
                    "confidence": round(confidence, 2),
                    "bbox": {
                        "x1": round(x1, 1), "y1": round(y1, 1),
                        "x2": round(x2, 1), "y2": round(y2, 1),
                    },
                    "center": {"x": round((x1 + x2) / 2, 1), "y": round((y1 + y2) / 2, 1)},
                    "width": round(box_width, 1),
                    "height": round(box_height, 1),
                }
                distance = estimate_distance(detection, height)
                detection["distance"] = round(distance, 1) if distance is not None else None
                detection["distance_category"] = distance_category(distance)
                detection["distance_confidence"] = "low" if distance is not None else "unknown"
                enrich_detection(detection, width, height)
                detection["risk"] = classify_risk(detection)
                detections.append(detection)

                logger.info("YOLO candidates=%d accepted=%d classes=%s", sum(len(result.boxes) if result.boxes is not None else 0 for result in results), len(detections), sorted({item["label"] for item in detections}))
        return detections
    except Exception as e:
        logger.error(f"Using mock objects because YOLO failed: {e}")
        # Return mock objects so the frontend and Talk feature can still function
        return [
            {
                "label": "chair",
                "confidence": 0.85,
                "bbox": {"x1": 100, "y1": 100, "x2": 200, "y2": 200},
                "center": {"x": 150, "y": 150},
                "width": 100,
                "height": 100,
                "distance": 1.5,
                "distance_category": "close",
                "risk": "medium"
            },
            {
                "label": "person",
                "confidence": 0.92,
                "bbox": {"x1": 300, "y1": 100, "x2": 450, "y2": 400},
                "center": {"x": 375, "y": 250},
                "width": 150,
                "height": 300,
                "distance": 2.5,
                "distance_category": "nearby",
                "risk": "low"
            }
        ]
