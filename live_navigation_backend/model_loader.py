import logging
from pathlib import Path
from typing import Any

from config import settings

logger = logging.getLogger(__name__)


class ModelLoader:
    _model: Any = None
    _error: str | None = None

    @classmethod
    def get_model(cls) -> Any:
        if cls._model is None:
            try:
                from ultralytics import YOLO
                configured_path = Path(settings.model_name)
                model_path = configured_path if configured_path.is_absolute() else Path(__file__).resolve().parent.parent / configured_path
                cls._model = YOLO(str(model_path))
                cls._error = None
                logger.info("YOLO model loaded: %s", model_path)
            except Exception as exc:
                cls._error = str(exc)
                logger.exception("Unable to load YOLO model")
                raise
        return cls._model

    @classmethod
    def status(cls) -> str:
        if cls._model is not None:
            return "loaded"
        if cls._error:
            return "unavailable"
        return "not_loaded"
