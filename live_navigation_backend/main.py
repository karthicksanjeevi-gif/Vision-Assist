import os
import math
import httpx
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel
from typing import List

app = FastAPI(title="VisionAssist Place Finder")

# ----------------------------------------------------------------------
# 1️⃣ Helper utilities
# ----------------------------------------------------------------------
EARTH_RADIUS_M = 6_371_000  # meters

def haversine(lat1, lng1, lat2, lng2):
    """Return distance (m) and bearing (deg) between two lat/lng pairs."""
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    Δφ = math.radians(lat2 - lat1)
    Δλ = math.radians(lng2 - lng1)

    a = (
        math.sin(Δφ / 2) ** 2
        + math.cos(φ1) * math.cos(φ2) * math.sin(Δλ / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    distance = EARTH_RADIUS_M * c

    y = math.sin(Δλ) * math.cos(φ2)
    x = math.cos(φ1) * math.sin(φ2) - math.sin(φ1) * math.cos(φ2) * math.cos(Δλ)
    bearing = (math.degrees(math.atan2(y, x)) + 360) % 360
    return distance, bearing

# ----------------------------------------------------------------------
# 2️⃣ Models
# ----------------------------------------------------------------------
class PlaceResult(BaseModel):
    name: str
    address: str
    lat: float
    lng: float
    distanceM: float
    bearingDeg: float
    openNow: bool | None = None

class StepResult(BaseModel):
    instruction: str
    distanceM: float
    bearingDeg: float

class DirectionsResponse(BaseModel):
    steps: List[StepResult]

# ----------------------------------------------------------------------
# 3️⃣ Google API wrappers (replace with your own keys or open‑source servers)
# ----------------------------------------------------------------------
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")


def _require_google_api_key() -> str:
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=503, detail="Google Places API is not configured.")
    return GOOGLE_API_KEY


async def google_places(lat: float, lng: float, keyword: str) -> List[PlaceResult]:
    key = _require_google_api_key()
    url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
    params = {
        "key": key,
        "location": f"{lat},{lng}",
        "keyword": keyword,
        "radius": 1500,  # 1.5 km search radius
    }
    async with httpx.AsyncClient() as client:
        r = await client.get(url, params=params, timeout=10)
        r.raise_for_status()
        data = r.json()
    if data.get("status") not in {"OK", "ZERO_RESULTS"}:
        raise HTTPException(status_code=502, detail=f"Places API error: {data.get('status', 'unknown')}")
    results = []
    for item in data.get("results", [])[:5]:  # top 5 closest
        geom = item.get("geometry", {}).get("location", {})
        if not geom:
            continue
        place_lat = geom["lat"]
        place_lng = geom["lng"]
        distance, bearing = haversine(lat, lng, place_lat, place_lng)
        results.append(
            PlaceResult(
                name=item["name"],
                address=item.get("vicinity", ""),
                lat=place_lat,
                lng=place_lng,
                distanceM=distance,
                bearingDeg=bearing,
                openNow=item.get("opening_hours", {}).get("open_now"),
            )
        )
    return results

async def google_directions(origin: str, destination: str) -> DirectionsResponse:
    key = _require_google_api_key()
    url = "https://maps.googleapis.com/maps/api/directions/json"
    params = {
        "key": key,
        "origin": origin,
        "destination": destination,
        "mode": "walking",
    }
    async with httpx.AsyncClient() as client:
        r = await client.get(url, params=params, timeout=10)
        r.raise_for_status()
        data = r.json()
    if data.get("status") != "OK":
        raise HTTPException(status_code=400, detail=f"Directions API error: {data.get('status', 'unknown')}")

    routes = data.get("routes") or []
    if not routes:
        raise HTTPException(status_code=400, detail="Directions API returned no route.")

    steps = []
    for leg in routes[0].get("legs", []):
        for s in leg.get("steps", []):
            start = s.get("start_location")
            end = s.get("end_location")
            if not start or not end:
                continue
            _, bearing = haversine(
                start["lat"], start["lng"], end["lat"], end["lng"]
            )
            steps.append(
                StepResult(
                    instruction=(
                        s["html_instructions"]
                        .replace("<b>", "")
                        .replace("</b>", "")
                        .replace("&nbsp;", " ")
                    ),
                    distanceM=s["distance"]["value"],
                    bearingDeg=bearing,
                )
            )
    return DirectionsResponse(steps=steps)

# ----------------------------------------------------------------------
# 4️⃣ Routes
# ----------------------------------------------------------------------
@app.get("/places", response_model=List[PlaceResult])
async def get_places(
    lat: float = Query(..., description="Current latitude"),
    lng: float = Query(..., description="Current longitude"),
    q: str = Query(..., description="Search keyword, e.g. pharmacy"),
):
    try:
        return await google_places(lat, lng, q)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail=f"Places request failed: {exc}"
        )

@app.get("/directions", response_model=DirectionsResponse)
async def get_directions(
    origin: str = Query(..., description="lat,lng of start"),
    dest: str = Query(..., description="lat,lng of destination"),
):
    try:
        return await google_directions(origin, dest)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail=f"Directions request failed: {exc}"
        )
