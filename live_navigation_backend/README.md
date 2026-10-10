# VisionAssist Live Navigation Backend

This service receives resized JPEG frames over `WS /ws/navigation`, runs local YOLO inference, and returns structured obstacle and navigation events. It does not send frames to a cloud model.

## Windows setup

From the repository root in PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r live_navigation_backend\requirements.txt
uvicorn live_navigation_backend.main:app --reload --host 0.0.0.0 --port 8000
```

The first model load downloads `yolo11m.pt` if Ultralytics does not find it locally. This medium-sized YOLO11 model improves detection accuracy over the previous nano default at the cost of higher CPU/GPU use and slower inference. Set `YOLO_MODEL` to another Ultralytics model or a local model path when offline. The frontend expects `ws://localhost:8000` by default; set `VITE_NAVIGATION_BACKEND_URL` when the service is hosted elsewhere.

Check `http://localhost:8000/health` before opening the frontend. A healthy service may report `not_loaded` until the first frame causes lazy model loading; `unavailable` means model loading or its dependencies failed.

The browser owns camera permission, preview, speech synthesis, event cooldown, and resource cleanup. The backend owns frame decoding, detection, tracking IDs, spatial zones, distance categories, corridor overlap, risk, and conservative navigation decisions.

## Accuracy and safety controls

The default `yolo11m.pt` weights are trained on COCO. They can detect the supported COCO navigation classes in `obstacle_detector.py` such as people, vehicles, chairs, tables, bags, animals, traffic lights, signs, umbrellas, and plants. Standard COCO weights do **not** contain dedicated `stairs`, `door`, `pole`, or `wall` classes. Those require a custom-trained model; adding their names to a filter cannot make the model detect them.

Useful `.env` settings:

```env
YOLO_MODEL=yolo11m.pt
YOLO_DEVICE=auto
CONFIDENCE_THRESHOLD=0.45
IOU_THRESHOLD=0.50
IMAGE_SIZE=640
DETECTION_FPS=7
MINIMUM_TRACK_HITS=2
MAXIMUM_TRACK_AGE=3
TEMPORAL_SMOOTHING=0.65
WALKING_CORRIDOR_WIDTH=0.36
MINIMUM_DECISION_CONFIDENCE=0.58
DEBUG_OVERLAYS=false
LOG_LEVEL=INFO
```

`distance` is an uncalibrated monocular estimate and should not be treated as a measured range. Navigation decisions use qualitative categories and confidence. For reliable metre-level distances, calibrate the camera or enable a separately evaluated depth model.

Run the backend and frontend in separate PowerShell terminals:

```powershell
npm run navigation
npm run dev
```

Run the deterministic safety and temporal tests:

```powershell
.\.venv\Scripts\python.exe -m unittest live_navigation_backend.test_navigation -v
```

Set `DEBUG_OVERLAYS=true` to write the latest annotated frame to `live_navigation_backend/debug_latest.jpg`. Logs include inference latency, detection count, classes, selected action, and decision confidence.

## Measuring improvement

Build a labelled evaluation set covering rooms, corridors, stairs, doors, sidewalks, crowds, low light, bright scenes, partial occlusion, moving people, and multiple obstacles. For each frame record the true object boxes/classes, whether the walking corridor is blocked, and the safe action. Compare model versions using precision, recall, mAP, false-positive/false-negative counts, corridor-block accuracy, action accuracy, instruction changes per minute, mean/p95 inference latency, and processed FPS. Measure distance error only on calibrated scenes; otherwise compare distance-category accuracy and unknown-rate.
