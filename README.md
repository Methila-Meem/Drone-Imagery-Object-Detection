# Drone Imagery Semantic Segmentation Platform

Full-stack drone imagery analysis workspace for viewing georeferenced raster imagery, uploading multiple images, running detection or segmentation inference, visualizing masks and bounding boxes on a map, reloading persisted history, and exporting backend-generated GeoJSON.

The primary SRS model path is SegFormer-B2. YOLOv8s remains available as an optional comparison detector, and simulated mode is available for fast UI/API verification.

## Tech Stack

- Frontend: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS
- Mapping: MapLibre GL JS 4.x, react-map-gl 7.x, OpenStreetMap raster tiles
- Backend: FastAPI, Python, Pydantic, Uvicorn, SQLite, aiosqlite
- ML: Torch, Torchvision, HuggingFace Transformers, Ultralytics, Pillow, NumPy, OpenCV headless
- Models: `nvidia/segformer-b2-finetuned-ade-512-512`, optional `yolov8s.pt`
- Persistence: SQLite database at `backend/data/drone_imagery.sqlite3`

## Current Features

- Three pre-seeded DJI sample images with stable UUIDs and Kafrul/Dhaka bounds.
- Multi-image JPEG/PNG upload through `POST /api/upload`, with UUID storage filenames, safe display filenames, optional manual SW/NE bounds, and a 50 MB limit.
- SQLite-backed `images` and `detections` tables auto-initialized on FastAPI startup.
- SegFormer-B2 default detection mode with source resizing to max side 1024 before inference.
- SegFormer semantic masks served as static PNGs and rendered as MapLibre image raster overlays.
- YOLOv8s optional tiled detector with an aerial allowlist and bbox-derived overlay PNGs.
- Detection responses include `detection_id`, `image_id`, `model_used`, `inference_time_ms`, dimensions, per-detection `label`, `confidence`, `bbox`, `pixel_area`, `color`, and optional `mask_url`.
- History API with pagination, newest first, and `DELETE /api/history/{detection_id}`.
- Frontend History tab can reload selected detections onto the map or delete a persisted detection after confirmation.
- Backend GeoJSON export through `GET /api/export/geojson/{detection_id}`.
- Confidence slider from `0.00` to `1.00`; the UI filters already-returned detections without rerunning inference.
- Drone raster opacity slider defaults to 85% and supports the full 0% to 100% range.
- Per-class visibility checkboxes, class legend, bbox/result click highlighting, SRS-aligned metrics, and backend GeoJSON export controls are available in the dashboard.
- Simulated detections are scaled to the selected image dimensions so they render across the full image footprint instead of only the top-left of large DJI samples.

## Architecture

```text
frontend/
  app/
    layout.tsx
    page.tsx
    globals.css             Tailwind and MapLibre global CSS
  components/
    Dashboard.tsx           Workflow, upload, detection, history, export UI
    map/
      DroneMap.tsx          Client-only MapLibre map and SVG bbox overlay
  lib/
    api.ts                  Typed API client helpers
    geojson.ts              Legacy helper; backend export is the active path

backend/
  app/
    api/routes/
      health.py
      images.py
      detect.py
      history.py
    db/
      database.py
      image_repo.py
      detection_repo.py
    schemas/
      detection.py
      images.py
      health.py
    services/
      image_registry.py
      simulated_detection.py
      segformer_detection.py
      yolo_service.py
      bbox_utils.py
      overlay_utils.py
    main.py
  static/
    images/
    outputs/
    masks/
  data/

model/
  segformer_service.py      SegFormer-B2 loading, inference, masks, components
```

FastAPI routes stay thin and delegate persistence/model work to services and repositories. Pydantic schemas define backend contracts, and TypeScript types in `frontend/lib/api.ts` mirror them. Map rendering lives in the client-only MapLibre component.

## Setup

Prerequisites:

- Python 3.11 or newer.
- Node.js 20.9 or newer for Next.js 16.

### Backend

```bash
cd backend
python -m venv .venv
```

Activate the virtual environment:

```bash
# Windows PowerShell
.venv\Scripts\activate

# macOS/Linux
source .venv/bin/activate
```

Install and run:

```bash
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

If Next.js starts on `3001`, the default backend CORS settings already include common `localhost` and `127.0.0.1` origins for ports `3000` and `3001`.

## Environment

Frontend backend URL override:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

Backend override:

```env
APP_NAME=Drone Imagery Segmentation API
BACKEND_CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001
```

## API Summary

```http
GET    /health
GET    /api/images
POST   /api/upload
POST   /api/images
GET    /api/images/{image_id}
POST   /api/detect
GET    /api/history?page=1&page_size=20
DELETE /api/history/{detection_id}
GET    /api/export/geojson/{detection_id}
```

### Detect Request

```json
{
  "image_id": "11111111-1111-4111-8111-111111111111",
  "mode": "segformer",
  "confidence_threshold": 0.5
}
```

Supported modes:

- `segformer` default
- `real` legacy alias for SegFormer
- `simulated`
- `yolo`

### Detect Response

```json
{
  "detection_id": "51208757-bd33-4ee4-b36b-008360c5a11c",
  "image_id": "11111111-1111-4111-8111-111111111111",
  "mode": "segformer",
  "model_used": "nvidia/segformer-b2-finetuned-ade-512-512",
  "inference_time_ms": 52878,
  "image_width": 5280,
  "image_height": 3956,
  "mask_url": "http://localhost:8000/static/outputs/51208757-bd33-4ee4-b36b-008360c5a11c_mask.png",
  "detections": [
    {
      "label": "building",
      "confidence": 0.87,
      "bbox": [120, 80, 260, 220],
      "pixel_area": 19600,
      "color": "#dc2626"
    }
  ]
}
```

### GeoJSON Export

`GET /api/export/geojson/{detection_id}` returns `application/geo+json`. Each feature is a polygon generated server-side from persisted detection bboxes and registered image bounds. Feature properties include:

```json
{
  "class": "building",
  "confidence": 0.87,
  "pixel_area": 19600,
  "color": "#dc2626"
}
```

Additional traceability properties such as `detection_id`, `image_id`, and `mode` may also be included.

## Map Rendering

MapLibre GL JS is the active map renderer.

- OSM basemap tiles are configured as a MapLibre raster source.
- The selected drone image is rendered with an image source and raster layer at backend-provided bounds.
- SegFormer masks and YOLO overlay PNGs are rendered as a second image source and raster layer using the same bounds.
- Bounding boxes are drawn in an SVG overlay synchronized with MapLibre viewport changes through `map.project()`.

Leaflet and React-Leaflet are not active dependencies.

## Model Notes

SegFormer integration lives in `model/segformer_service.py` and is wrapped by `backend/app/services/segformer_detection.py`.

- Loads `nvidia/segformer-b2-finetuned-ade-512-512`.
- Uses CUDA when available and CPU otherwise.
- Resizes source imagery to a max side of 1024 before inference.
- Calls `post_process_semantic_segmentation(outputs, target_sizes=[(H, W)])`.
- Uses OpenCV `connectedComponentsWithStats` per class to produce component-level bounding boxes.
- Generates transparent RGBA masks under `backend/static/outputs/`.
- Persists every detection row with image ID, model, detections JSON, mask path, inference time, threshold, and timestamp.

YOLOv8s is optional/extra. It is useful for COCO object classes visible in aerial imagery, but it is not the primary SRS segmentation model.

## Deviation From SRS / Future Scope: LLM Vision Mode

LLM Vision Mode is intentionally deferred for this submission because it requires server-side OpenAI API integration, API key management, and additional prompt/result validation work. SegFormer-B2 is fully implemented as the primary segmentation model required by the SRS. YOLOv8s is included only as an optional extra comparison mode and does not replace SegFormer-B2.

Future work should add a server-only LLM API route, model options such as `gpt-4o-mini` and `gpt-4.1-mini`, structured JSON output validation, and a visible "LLM Vision Mode - Approximate Results" UI banner.

## Known Limitations

- Exact upload footprints still require manual bounds. GeoTIFF or world-file parsing is future work.
- Generated mask and overlay cleanup/retention is not implemented.
- There is no authentication or automated test suite yet.
- CPU SegFormer-B2 inference can be slow; startup warm-up helps model-load latency, but GPU acceleration is recommended.
- ADE labels do not perfectly match custom drone land-cover classes without fine-tuning.

## Verification

Recommended checks before submission:

```bash
cd backend
python -m compileall app ../model
```

```bash
cd frontend
npm run lint
npx tsc --noEmit --incremental false
npm run build
```

Manual flow to verify:

1. Start backend and frontend.
2. Confirm `GET /api/images` lists the three seeded DJI samples.
3. Upload a JPEG or PNG and confirm a fresh UUID image appears in Available Imagery.
4. Run SegFormer or simulated detection.
5. Confirm map raster, optional mask/overlay, and SVG bboxes render.
6. Open History and reload a prior detection onto the map.
7. Delete a disposable history record and confirm it disappears from the History tab.
8. Export GeoJSON and confirm feature properties contain `class`, `confidence`, `pixel_area`, and `color`.
