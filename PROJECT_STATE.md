# Project State Handoff

Last updated: 2026-05-04

## Project Overview

This repository is a monorepo scaffold for a drone imagery semantic segmentation platform. The intended product is a web workspace where users can view drone imagery on a map, upload imagery, run model inference, and visualize object detection or segmentation results.

Current implementation is an early scaffold with a working FastAPI backend, a working Next.js frontend, a backend health check, CORS configuration, a SQLite-backed image registry, filesystem image storage, static image serving, and a hydration-safe MapLibre GL JS map viewer that renders registered drone imagery as a georeferenced image overlay. Detection supports simulated results, real SegFormer semantic segmentation results converted into bounding boxes, and YOLOv8s object detection. Real SegFormer detection generates a transparent semantic segmentation mask PNG, while YOLOv8s generates a transparent bbox-derived overlay PNG. The frontend now follows the SRS workflow: upload, detect, view overlays, filter/toggle classes, reload persisted history, and export backend-generated GeoJSON.

## Tech Stack

- Frontend: Next.js 15, React 19, TypeScript, Tailwind CSS, MapLibre GL JS 4.x, react-map-gl 7.x
- Backend: FastAPI, Python, Pydantic Settings, Uvicorn, SQLite, aiosqlite
- ML dependencies: Torch, Torchvision, HuggingFace Transformers, Ultralytics, Pillow, NumPy, OpenCV headless
- Models: HuggingFace SegFormer `nvidia/segformer-b2-finetuned-ade-512-512`; YOLOv8s `yolov8s.pt`
- Current visualization direction: bounding boxes plus optional SegFormer mask / YOLO overlay

## Repository Structure

```text
.
+-- backend/
|   +-- app/
|   |   +-- api/
|   |   |   +-- router.py
|   |   |   +-- routes/detect.py
|   |   |   +-- routes/history.py
|   |   |   +-- routes/images.py
|   |   |   +-- routes/health.py
|   |   +-- core/config.py
|   |   +-- db/database.py
|   |   +-- db/image_repo.py
|   |   +-- schemas/detection.py
|   |   +-- schemas/images.py
|   |   +-- schemas/health.py
|   |   +-- services/image_registry.py
|   |   +-- services/bbox_utils.py
|   |   +-- services/overlay_utils.py
|   |   +-- services/segformer_detection.py
|   |   +-- services/simulated_detection.py
|   |   +-- services/yolo_service.py
|   |   +-- main.py
|   +-- static/
|   |   +-- images/
|   |   |   +-- drone_001.jpg
|   |   +-- masks/
|   |   |   +-- generated temporary mask PNGs
|   +-- data/
|   |   +-- generated SQLite database, ignored by git
|   +-- .env.example
|   +-- requirements.txt
+-- frontend/
|   +-- app/
|   |   +-- globals.css
|   |   +-- layout.tsx
|   |   +-- page.tsx
|   +-- components/
|   |   +-- Dashboard.tsx
|   |   +-- MapViewport.tsx
|   |   +-- map/
|   |   |   +-- DroneMap.tsx
|   |   |   +-- DroneMap.tsx
|   +-- lib/api.ts
|   +-- lib/geojson.ts
|   +-- .env.example
|   +-- .env.local
|   +-- package.json
+-- model/
|   +-- README.md
|   +-- __init__.py
|   +-- segformer_service.py
+-- README.md
+-- PROJECT_STATE.md
```

## Backend State

The backend app is defined in `backend/app/main.py`.

- Uses a `create_app()` factory.
- Creates a FastAPI app with title from settings and version `0.1.0`.
- Enables Swagger docs at `/docs` and ReDoc at `/redoc`.
- Adds CORS middleware using configured frontend origins.
- Mounts FastAPI `StaticFiles` at `/static`.
- Includes the central API router from `app.api.router`.

Routes currently implemented:

- `GET /`
- `GET /health`
- `POST /api/detect`
- `GET /api/images`
- `POST /api/images`
- `POST /api/upload`
- `GET /api/images/{image_id}`
- `GET /api/history`
- `DELETE /api/history/{detection_id}`
- `GET /api/export/geojson/{detection_id}`

The health routes return:

```json
{
  "status": "ok",
  "service": "backend"
}
```

The image list route returns available SQLite-registered images:

```json
{
  "images": [
    {
      "image_id": "11111111-1111-4111-8111-111111111111",
      "filename": "dji_sample_001.jpg",
      "image_url": "http://localhost:8000/static/images/dji_sample_001.jpg",
      "width": 5280,
      "height": 3956,
      "size_bytes": 10041126,
      "bounds": {
        "north": 23.782,
        "south": 23.778,
        "east": 90.358,
        "west": 90.354
      }
    }
  ]
}
```

Image registry and storage state:

- Registry module: `backend/app/services/image_registry.py`
- SQLite database module: `backend/app/db/database.py`
- Image repository module: `backend/app/db/image_repo.py`
- Runtime database path: `backend/data/drone_imagery.sqlite3`
- The FastAPI startup hook auto-creates `images` and `detections` tables.
- The `images` table now includes an internal `source` column with values such as `seed`, `upload`, and migration-only `legacy`.
- `GET /api/images` lists SQLite image rows only; it does not scan `backend/static/images/` or any upload/static folder as source of truth.
- Startup seeds three stable UUID DJI sample rows:
  - `11111111-1111-4111-8111-111111111111`
  - `22222222-2222-4222-8222-222222222222`
  - `33333333-3333-4333-8333-333333333333`
- Seeded sample bounds use the SRS Kafrul/Dhaka fallback: SW `[90.354, 23.778]`, NE `[90.358, 23.782]`.
- Seed rows are idempotent by stable `image_id`; startup updates the existing seed rows instead of creating duplicates.
- Startup performs a safe development cleanup of legacy DB-only image records: rows marked `legacy` and not matching the three official seed IDs are removed from `images`, along with related detection rows. Actual files in `static/images` are not deleted.
- Pydantic response models: `backend/app/schemas/images.py`
- Seeded sample image files are copied from checked-in `backend/static/images/drone_001.jpg` if missing.
- `POST /api/images` and `POST /api/upload` accept multipart image uploads.
- Uploads accept JPEG and PNG only, including `image/jpeg`, `image/jpg`, `image/pjpeg`, `image/png`, `.jpg`, `.jpeg`, and `.png`; uploads also accept readable DJI MPO-backed `.JPG` files and normalize the first frame to a standard UUID `.jpg`; uploads enforce a `50MB` maximum and return HTTP `422` with a clear reason for invalid image payloads.
- The frontend upload helper posts to `POST /api/upload`.
- Uploads generate a fresh UUID `image_id`.
- Uploaded file paths use UUID filenames under `backend/static/images/` and never trust the original filename for storage paths.
- The original filename is retained only as display metadata in the SQLite row and API response.
- A legacy optional `display_name` field may still exist in the database/API for backward compatibility, but the frontend no longer sends or displays it.
- Upload responses include `image_id`, `filename`, `image_url`, `width`, `height`, `size_bytes`, `bounds`, and `created_at`.
- Images uploaded through `POST /api/upload` are stored as new SQLite rows with fresh UUID `image_id` and internal `source: "upload"`. `POST /api/images` remains as a backend compatibility alias.
- Uploads optionally accept `south`, `west`, `north`, and `east` form fields.
- Manual upload bounds must be provided together and pass latitude/longitude range plus south/west/north/east ordering validation.
- Uploads without manual bounds use the Kafrul/Dhaka fallback bounds.
- The old Bay of Bengal/default demo fallback has been removed.
- Exact corner-level alignment still requires true footprint metadata, such as GeoTIFF bounds, a world file, or manually provided corner coordinates.
- Unknown image IDs return `404` from `GET /api/images/{image_id}`.

Detection API state:

- Route module: `backend/app/api/routes/detect.py`
- Pydantic request/response models: `backend/app/schemas/detection.py`
- Detection service: `backend/app/services/simulated_detection.py`
- Real detection wrapper: `backend/app/services/segformer_detection.py`
- YOLO detection wrapper: `backend/app/services/yolo_service.py`
- SegFormer inference service: `model/segformer_service.py`
- `POST /api/detect` accepts `image_id`, `mode`, and `confidence_threshold`.
- `mode` is constrained to `"simulated"`, `"segformer"`, `"real"` legacy alias, or `"yolo"` and defaults to `"segformer"`.
- The route validates `image_id` through the SQLite-backed image registry and returns `404` for unknown image IDs.
- The request model constrains `confidence_threshold` to `0.0` through `1.0`.
- The response mode is `"simulated"`, `"segformer"`, `"real"`, or `"yolo"`, matching the request path used.
- Simulated detection now returns and persists a `detection_id`, `model_used: "simulated"`, `inference_time_ms`, image dimensions, and serialized detections so the SRS history/export workflow can be verified without slow model inference.
- YOLOv8s detection now persists detection rows with the bbox-derived overlay path under `masks/overlays/...`, enabling history reload and backend GeoJSON export.
- SegFormer responses include SRS fields: `detection_id`, `image_id`, `model_used`, `inference_time_ms`, `image_width`, `image_height`, `detections`, `mask_url`, and optional `mask_base64`.
- SegFormer detection rows are persisted in SQLite with `detection_id`, `image_id`, `model_used`, `detections_json`, `mask_path`, `inference_time_ms`, `confidence_threshold`, and `created_at`.
- Detection items include `label`, `confidence`, `bbox`, `pixel_area`, and `color`.
- The response includes `mask_url`, which is `null` for simulated detection, an absolute static PNG URL for SegFormer masks under `/static/outputs/`, and an absolute static PNG URL for YOLO bbox-derived overlays.
- Simulated detections include `building`, `vegetation`, `open_land`, and `road/path`.
- Simulated detections are filtered by `confidence_threshold`.
- Real detection lazy-loads SegFormer on first real request.
- Real detection uses CPU by default when CUDA is unavailable.
- Real detection loads `nvidia/segformer-b2-finetuned-ade-512-512` through HuggingFace Transformers.
- Real detection starts a background warm-up task through the dedicated SegFormer service; warm-up failures are logged without preventing backend startup so user-facing failures still map to `503`.
- Real detection resizes source imagery to a max side of `2048` before inference while preserving aspect ratio, then scales component boxes back to the registered image size.
- Real detection maps useful ADE classes into readable labels: `building`, `vegetation`, `road`, and `earth/ground`.
- Real detection converts segmentation masks into bounding boxes with OpenCV `connectedComponentsWithStats`, producing one bbox per valid connected component instead of one large contour per class.
- Real detection filters tiny components and suppresses near-whole-image bbox artifacts unless the component itself covers most of the image.
- Real detection creates a colored transparent RGBA segmentation mask from useful target classes above the confidence threshold.
- Real mask PNGs are saved under `backend/static/outputs/{detection_id}_mask.png` and served through the existing FastAPI `/static` mount.
- Generated mask dimensions match the registered source image dimensions.
- Real detection returns the existing detection shape inside the shared response:

```json
{
  "detection_id": "51208757-bd33-4ee4-b36b-008360c5a11c",
  "image_id": "11111111-1111-4111-8111-111111111111",
  "mode": "real",
  "model_used": "nvidia/segformer-b2-finetuned-ade-512-512",
  "inference_time_ms": 52878,
  "image_width": 5280,
  "image_height": 3956,
  "mask_url": "http://localhost:8000/static/outputs/51208757-bd33-4ee4-b36b-008360c5a11c_mask.png",
  "detections": [
    {
      "label": "building",
      "confidence": 0.87,
      "bbox": [0, 0, 128, 128],
      "pixel_area": 8192,
      "color": "#dc2626"
    }
  ]
}
```

- Model-loading and inference failures are surfaced as `503` responses with clear error messages.
- Real detection scales returned bounding boxes to the registered image dimensions so the existing map overlay contract remains stable.
- YOLOv8s detection lazy-loads `yolov8s.pt` through Ultralytics and stores its settings/cache under `model/.cache/ultralytics`.
- YOLOv8s uses tiled inference with `1024` pixel tiles, `20%` overlap, `imgsz=1024`, `iou=0.45`, `max_det=300`, and CUDA when available, otherwise CPU.
- YOLOv8s tile detections are projected back into original image pixel coordinates and merged with NMS.
- YOLOv8s is an optional/extra object detector and does not replace the SRS-required default SegFormer semantic segmentation path.
- YOLOv8s class filtering now uses a strict aerial allowlist instead of a suppression list: `person`, `bicycle`, `car`, `motorcycle`, `bus`, `truck`, and `boat`.
- YOLOv8s rejects every non-allowlisted COCO class before NMS and overlay generation, including common aerial false positives such as `clock`, `book`, `bird`, `cat`, `dog`, `chair`, `traffic light`, furniture, and food classes.
- YOLOv8s applies a service-level minimum confidence threshold plus minimum and maximum bbox area-ratio filters to reduce tiny specks and unrealistic huge boxes.
- YOLOv8s overlay PNGs are generated from bounding boxes, saved under `backend/static/masks/overlays/`, and returned as `mask_url`; these are not true semantic segmentation masks.

History and export API state:

- Route module: `backend/app/api/routes/history.py`
- `GET /api/history` returns paginated persisted detection records joined with image metadata, newest first. Records include `detection_id`, `image_id`, timestamp/creation time, filename, image URL, dimensions, bounds, mode, model name, class count, detected classes, inference time, confidence threshold, detections, and optional mask URL.
- `DELETE /api/history/{detection_id}` deletes a persisted detection row and returns `204`, or `404` for an unknown detection ID.
- The frontend History tab shows explicit `Load` and `Delete` actions for each record.
- Loading a history record reconstructs the selected image, bounds, mask/overlay URL, and detections without rerunning inference.
- Deleting a history record asks for browser confirmation, calls `DELETE /api/history/{detection_id}`, removes the row from local History state, and clears the active map result if that deleted detection was currently loaded.
- `GET /api/export/geojson/{detection_id}` generates GeoJSON server-side from the persisted detection row and registered image bounds.
- Backend GeoJSON features are polygons converted from pixel bboxes using the same top-left pixel-origin and `[longitude, latitude]` coordinate assumptions as the MapLibre overlay.
- Export responses use `application/geo+json` and download filenames in the form `detections_<detection_id>.geojson`.

Backend settings are in `backend/app/core/config.py`.

- Default app name: `Drone Imagery Segmentation API`
- Default environment: `development`
- `BACKEND_CORS_ORIGINS` is read from `.env` as a comma-separated string.
- Default allowed origins include `http://localhost:3000`, `http://localhost:3001`, `http://127.0.0.1:3000`, and `http://127.0.0.1:3001`.

Backend dependencies are pinned in `backend/requirements.txt`, including `aiosqlite==0.20.0`.

Important current limitation: uploaded imagery now persists in SQLite and filesystem storage, but exact georeferenced upload footprints still require manual bounds or future GeoTIFF/world-file parsing. Real detection works, but the first run requires downloading the HuggingFace model unless it already exists in the local model cache.

## Frontend State

The frontend entry page is `frontend/app/page.tsx`, which renders `Dashboard`.

`frontend/components/Dashboard.tsx` is a client component that:

- Dynamically loads `frontend/components/map/DroneMap.tsx` with SSR disabled.
- Calls the backend health endpoint on mount through `getHealth()`.
- Calls the backend image registry endpoint on mount through `getImages()`.
- Uploads a drone image through `uploadDroneImage()` using multipart `FormData`.
- Runs SegFormer detection through `runDetection()` by default.
- Shows backend online/offline state in the header.
- Shows an image workflow sidebar with available registered images.
- Shows an SRS FR-UPLOAD-01 drag-and-drop upload zone powered by `react-dropzone`.
- Upload drop zone accepts JPEG/PNG only and enforces the 50MB maximum before sending.
- Upload drop zone shows user-friendly validation errors for oversized and unsupported files.
- Successful uploads show `filename`, `image_id`, file size, and a thumbnail preview in a compact non-overflowing card.
- The Available Imagery dropdown shows all registered images, including uploaded images and the three seeded DJI images, sorted by `created_at` newest first.
- Available Imagery option labels use `filename — short_image_id`; the selected image details panel shows full `filename` and full `image_id`.
- Shows a vertically stacked detection mode selector for `Simulated`, `SegFormer`, and `YOLOv8s` so labels do not overlap in the narrow sidebar.
- Shows a confidence threshold slider from `0.00` to `1.00`, defaulting to `0.50`.
- Runs inference with threshold `0.00` and performs real-time frontend confidence filtering against the raw detection response without rerunning inference.
- Shows a mode-aware overlay checkbox: `Show segmentation mask` for SegFormer masks and `Show YOLO overlay` for YOLO bbox-derived overlays.
- Shows a loading spinner in controls plus a translucent map busy overlay and result-panel skeleton while detection is running.
- Stores the active raw detection run in React state and derives filtered detections from confidence and class visibility state.
- Stores the latest `mask_url` in React state.
- Stores the selected bbox index in React state so clicking a map bbox highlights the matching detection result row.
- Provides a `Clear Results` button.
- Selects the first available image by default.
- Shows a `Visible` metric as `filtered/total` and an `Overlay` metric based on whether an overlay URL is available.
- Shows a drone image opacity slider from `40%` to `100%`, defaulting to `85%`.
- Renders the map workspace area.
- Shows clean loading, error, and empty-image states for the image registry.
- Shows a right-side image details panel with `image_id`, image size, and image bounds.
- Shows a tabbed right panel with `Results` and `History`.
- Shows class visibility checkboxes that hide/show bbox classes and suppress the composite mask/overlay when all classes are hidden.
- Shows a legend with detected class names, colors, and counts, matching detection-provided colors or the fallback map palette.
- Shows detection results with class name, confidence bar, pixel area, color swatch, model used, inference time, total filtered/returned counts, and total class count.
- Shows an `Export GeoJSON` button for persisted detections.
- Exports GeoJSON by downloading from `GET /api/export/geojson/{detection_id}` instead of using frontend-only GeoJSON as the final source.
- Loads detection history from `GET /api/history`; the History tab provides `Load` and `Delete` buttons for each record.
- Clicking `Load` reloads the image, bounds, mask/overlay URL, and detections onto the MapLibre map.
- Clicking `Delete` confirms with the user, deletes the persisted detection through `DELETE /api/history/{detection_id}`, removes it from the History tab, and clears active detections if needed.
- Displays detection status messages that include the response mode.
- Shows a better empty result state for current confidence and class filters.
- Shows backend/model error states using backend `detail` text when available.
- Uses a state revision counter for uploaded image cache busting instead of `Date.now()` to avoid hydration-sensitive output.
- Main dashboard layout no longer caps the workspace at `max-w-7xl`; it uses a full-width container with responsive page padding so the center map can grow on wide screens.
- Desktop dashboard grid uses `lg:grid-cols-[300px_minmax(0,1fr)_340px]`, giving the left workflow panel about `300px`, the right details/results panel about `340px`, and the map the remaining flexible width.
- Below the `lg` breakpoint, the grid stacks into a single column so the workflow, map, and detail panels remain readable on medium/smaller screens.
- The map container uses `min-h-[560px]` and `lg:min-h-[calc(100vh-112px)]` to keep the map vertically dominant without adding inner padding around the MapLibre canvas.

`frontend/components/MapViewport.tsx` is now a compatibility wrapper around `frontend/components/map/DroneMap.tsx`.

The MapLibre map lives in `frontend/components/map/DroneMap.tsx`.

The map components:

- Uses MapLibre GL JS through `react-map-gl/maplibre`.
- Are loaded only on the client through Next.js dynamic import with `ssr: false`.
- Uses a fallback center at Dhaka coordinates `{ latitude: 23.8103, longitude: 90.4125, zoom: 12 }`.
- Loads OpenStreetMap raster tiles through a MapLibre raster source using `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
- Renders the selected registered drone image through a MapLibre image source plus raster layer.
- Maps image source corners in `[lng, lat]` order as top-left, top-right, bottom-right, bottom-left.
- Renders optional SegFormer mask or YOLO bbox overlay PNGs through a second MapLibre image source plus raster layer at the same coordinates.
- Uses `0.6` mask/overlay raster opacity by default.
- Uses a dashboard-controlled drone image opacity slider defaulting to `0.85`.
- Converts detection pixel bboxes from `[x_min, y_min, x_max, y_max]` into geographic corners using image width, height, and bounds.
- Accounts for top-left image pixel origin by mapping `y=0` to the image north edge.
- Projects bbox geographic corners through `map.project()` and renders synchronized SVG polygons above the MapLibre canvas.
- Reprojects SVG bbox polygons on map load, move, zoom, and resize so boxes remain synced during pan/zoom.
- Observes the map container with `ResizeObserver`; when the dashboard grid or viewport changes size, it calls `map.resize()` and refreshes bbox projection without changing the bounds/projection math.
- Shows each detection label and confidence as an SVG label.
- Clicking an SVG bbox highlights the matching detection panel entry.
- Fits the map viewport to the selected image bounds.
- Supports normal MapLibre zoom and pan interactions.
- Places MapLibre navigation controls at the top-right so they do not overlap the image label.
- Shows a small overlay label with the selected image filename.
- Preserve layer order: OSM base, raster image, mask overlay, bounding boxes.
- Memoizes image coordinates and projected detection geometry and uses `React.memo` on the map component.

`frontend/app/layout.tsx`:

- Imports global styles through `frontend/app/globals.css`.
- Uses `suppressHydrationWarning` on the document root and body to tolerate browser extension attributes such as `cz-shortcut-listen`.

`frontend/app/globals.css`:

- Imports MapLibre CSS globally with `@import "maplibre-gl/dist/maplibre-gl.css";`.
- Sets `.maplibregl-map` to full width and height and removes the canvas focus outline.

`frontend/lib/api.ts` contains the API helper:

- Reads `NEXT_PUBLIC_API_BASE_URL`.
- Falls back to `http://localhost:8000`.
- Exposes `getHealth()` for `GET /health`.
- Exposes typed image metadata models and `getImages()` for `GET /api/images`.
- Exposes `uploadDroneImage()` for multipart `POST /api/upload`.
- Upload helper appends the file with key `file` and only appends bounds if provided.
- Image metadata now includes `size_bytes` and `created_at`; `display_name` remains optional legacy response data only.
- Exposes typed detection models and `runDetection()` for `POST /api/detect`.
- Detection response mode type is `"simulated" | "segformer" | "yolo" | "real"`.
- Detection responses include `detection_id`, `model_used`, `inference_time_ms`, `image_width`, `image_height`, `mask_url`, and optional `mask_base64`.
- Detection items include optional `pixel_area` and `color` fields for SegFormer component results.
- `runDetection()` accepts an optional mode and sends `"segformer"` by default.
- `runDetection()` sends both `mode` and `confidence_threshold`.
- Exposes `getDetectionHistory()` for `GET /api/history`.
- Exposes `deleteDetectionHistoryItem()` for `DELETE /api/history/{detection_id}`.
- Exposes `downloadDetectionGeoJson()` for backend GeoJSON export downloads.
- Detection history items are strongly typed with image metadata, model metadata, detections, mask URL, and `created_at`.
- Detection API error responses parse backend `detail` when available.

`frontend/lib/geojson.ts` still contains the legacy frontend-only GeoJSON helper, but the dashboard no longer uses it as the final export source:

- Builds a valid GeoJSON `FeatureCollection`.
- Converts each detection bbox from pixel coordinates `[x_min, y_min, x_max, y_max]` into a geographic `Polygon`.
- Uses GeoJSON coordinate order `[longitude, latitude]`.
- Closes each polygon ring by repeating the first coordinate as the final coordinate.
- Carries feature properties: `label`, `confidence`, `image_id`, and `mode`.

The local frontend env file currently has:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

## Model Directory State

`model/README.md` says the directory is reserved for SegFormer assets, checkpoints, and model-facing documentation.

Current model-facing files:

- `model/__init__.py`
- `model/segformer_service.py`

`model/segformer_service.py`:

- Defines the SegFormer model name as `nvidia/segformer-b2-finetuned-ade-512-512`.
- Lazy-loads `SegformerImageProcessor` and `SegformerForSemanticSegmentation`.
- Preserves thread-safe model loading with a lock.
- Provides a warm-up call that loads the model and runs a tiny dummy inference.
- Uses `cuda` when available and CPU otherwise.
- Runs semantic segmentation with Torch no-grad inference.
- Resizes input imagery to a max side of `2048` while preserving aspect ratio before inference.
- Uses `processor.post_process_semantic_segmentation(outputs, target_sizes=[(H, W)])`.
- Maps raw class IDs to useful readable labels.
- Uses OpenCV `connectedComponentsWithStats` to emit one bbox per valid connected component.
- Filters tiny components and suppresses near-whole-image bbox artifacts unless component coverage is also very high.
- Builds a transparent RGBA mask image for useful target classes above the requested confidence threshold.
- Resizes the mask image to the registered drone image dimensions with nearest-neighbor sampling.
- Keeps only boxes above the requested confidence threshold.
- Stores HuggingFace model files in `model/.cache/huggingface`.

YOLOv8s service state:

- Backend wrapper: `backend/app/services/yolo_service.py`
- Weights: `yolov8s.pt`
- Library: Ultralytics
- Inference is tiled and bbox coordinates are returned in original image pixel space.
- COCO labels are gated through the aerial allowlist before NMS and overlay generation.
- YOLOv8s is an optional/extra object detector; SegFormer remains the default SRS-compatible model path.
- YOLOv8s allows only aerial-relevant COCO object classes: `person`, `bicycle`, `car`, `motorcycle`, `bus`, `truck`, and `boat`.
- YOLOv8s rejects non-allowlisted classes such as `clock`, `book`, `bird`, `cat`, `dog`, `chair`, `traffic light`, furniture, and food classes.
- YOLOv8s applies a minimum confidence floor and bbox area-ratio filters before NMS.
- YOLO overlay output is a transparent bbox overlay, not semantic segmentation.

`model/.cache/` is ignored by git and may contain downloaded HuggingFace artifacts on local machines.

## How To Run Locally

Backend:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Expected local URLs:

- Frontend: `http://localhost:3000`
- Backend health: `http://localhost:8000/health`
- Image registry: `http://localhost:8000/api/images`
- Static seeded sample images: `http://localhost:8000/static/images/dji_sample_001.jpg`, `dji_sample_002.jpg`, and `dji_sample_003.jpg`
- Backend docs: `http://localhost:8000/docs`
- Generated real detection masks: `http://localhost:8000/static/outputs/<detection_id>_mask.png`

Detection examples:

```json
{
  "image_id": "11111111-1111-4111-8111-111111111111",
  "mode": "real",
  "confidence_threshold": 0.5
}
```

Real detection response example:

```json
{
  "detection_id": "51208757-bd33-4ee4-b36b-008360c5a11c",
  "image_id": "11111111-1111-4111-8111-111111111111",
  "mode": "real",
  "model_used": "nvidia/segformer-b2-finetuned-ade-512-512",
  "inference_time_ms": 52878,
  "image_width": 5280,
  "image_height": 3956,
  "detections": [
    {
      "label": "building",
      "confidence": 0.87,
      "bbox": [0, 0, 128, 128],
      "pixel_area": 8192,
      "color": "#dc2626"
    }
  ],
  "mask_url": "http://localhost:8000/static/outputs/51208757-bd33-4ee4-b36b-008360c5a11c_mask.png",
  "mask_base64": null
}
```

```json
{
  "image_id": "11111111-1111-4111-8111-111111111111",
  "mode": "simulated",
  "confidence_threshold": 0.5
}
```

Exported GeoJSON example:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [90.0003515625, 23.004739583333333],
            [90.00076171875, 23.004739583333333],
            [90.00076171875, 23.004283854166666],
            [90.0003515625, 23.004283854166666],
            [90.0003515625, 23.004739583333333]
          ]
        ]
      },
      "properties": {
        "label": "building",
        "confidence": 0.91,
        "image_id": "11111111-1111-4111-8111-111111111111",
        "mode": "simulated"
      }
    }
  ]
}
```

## Implemented

- Monorepo structure with `frontend`, `backend`, and `model`.
- FastAPI backend app with modular routing.
- Health response schema.
- `GET /` and `GET /health`.
- `POST /api/detect` simulated detection endpoint.
- `POST /api/detect` real SegFormer detection mode.
- `POST /api/detect` YOLOv8s detection mode.
- `POST /api/detect` `mode` field with `"simulated"`, `"segformer"`, `"real"`, and `"yolo"` support.
- `POST /api/detect` includes `mask_url` in responses.
- `GET /api/images` image registry endpoint.
- `POST /api/images` persistent image upload endpoint.
- `POST /api/upload` persistent image upload endpoint alias.
- `GET /api/images/{image_id}` image lookup endpoint with `404` handling.
- `GET /api/history` persisted detection history endpoint.
- `GET /api/export/geojson/{detection_id}` backend GeoJSON export endpoint.
- Pydantic image response schemas.
- Pydantic detection request and response schemas.
- Pydantic detection history response schemas.
- SQLite-backed image registry service.
- SQLite-backed `images` and `detections` tables auto-created on backend startup.
- Image repository layer in `backend/app/db/image_repo.py`.
- Three stable UUID seeded DJI sample image records using Kafrul/Dhaka fallback bounds.
- Internal image row source tracking for `seed`, `upload`, and migration-only `legacy`.
- Startup cleanup for legacy non-seed DB image rows without deleting image files.
- Filesystem image storage for uploads under `backend/static/images/`.
- UUID-based saved filenames for uploaded images.
- JPEG/PNG-only upload validation with `422` invalid-image errors.
- `50MB` upload limit.
- Legacy optional upload `display_name` compatibility in the backend, unused by the frontend.
- Optional manual upload bounds fields: `south`, `west`, `north`, and `east`.
- Simulated detection service with registry validation, confidence filtering, SRS metadata, and SQLite persistence.
- SegFormer detection wrapper service with registry validation and service error mapping.
- SegFormer-B2 model service with lazy thread-safe model loading, CPU-safe execution, ADE label mapping, confidence filtering, and OpenCV connected-component bbox extraction.
- SegFormer input resizing to max side `2048` before inference.
- SegFormer semantic map resizing through `processor.post_process_semantic_segmentation`.
- SegFormer component detections with `pixel_area` and `color`.
- SegFormer mask PNG generation under `backend/static/outputs/{detection_id}_mask.png`.
- SegFormer detection persistence in SQLite `detections`.
- SegFormer background startup warm-up through a tiny dummy inference.
- YOLOv8s tiled inference with strict aerial allowlist filtering, confidence and bbox area-ratio filters, and bbox-derived overlay generation.
- YOLOv8s detection persistence for history/export.
- Shared bbox NMS utility and shared overlay save/render utility.
- Static serving for generated mask PNGs through `/static/masks/...`.
- Clear `503` API errors when SegFormer loading or inference fails.
- Static file serving at `/static`.
- Backend CORS support.
- Next.js frontend with TypeScript and Tailwind CSS.
- Frontend health check against the backend.
- Frontend image registry fetch through `GET /api/images`.
- Frontend drone image upload through persistent backend storage.
- Frontend drag-and-drop upload zone with `react-dropzone`, JPEG/PNG acceptance, 50MB client validation, thumbnail preview, compact uploaded-image metadata summary, and no `display_name` UI.
- Frontend SegFormer detection request through `POST /api/detect` by default, with typed support for simulated and YOLO modes.
- Frontend detection mode selector for `Simulated`, `SegFormer`, and `YOLOv8s`.
- Frontend confidence threshold slider constrained to `0.00` through `1.00`, defaulting to `0.50`.
- Frontend real-time confidence filtering without rerunning inference.
- Hydration-safe client-only MapLibre GL JS map in `frontend/components/map/DroneMap.tsx`.
- Dynamic map import with `ssr: false`.
- Document-level hydration warning suppression for extension-injected root/body attributes.
- Dashboard layout with backend status display.
- Dashboard uses a wider full-width responsive grid: `300px` left panel, flexible MapLibre center, and `340px` right panel on large screens.
- Center map area is visually prioritized with `min-h-[560px]`, `lg:min-h-[calc(100vh-112px)]`, `min-w-0`, rounded border, and shadow.
- Image selector for registered backend images.
- Detection controls with mode selector, confidence threshold, drone image opacity slider, mode-aware overlay toggle, loading spinner, run button, clear results button, and backend export button.
- Backend GeoJSON export for persisted detections through `GET /api/export/geojson/{detection_id}`.
- Backend GeoJSON export converts pixel bounding boxes to geographic polygons using registered image bounds.
- GeoJSON features include `detection_id`, `class`, `confidence`, `image_id`, `mode`, `pixel_area`, and `color`.
- GeoJSON export downloads as `detections_<detection_id>.geojson`.
- Right-side image metadata panel showing `image_id`, image size, and bounds.
- Right-side tabbed results/history panel.
- Right-side detection results panel showing model, inference time, filtered/total count, class count, class name, confidence bar, pixel area, color swatch, and per-item model metadata.
- Per-class visibility toggles for bbox filtering.
- Detected-class legend with class colors and counts.
- History tab backed by `GET /api/history`; `Load` reloads image metadata, detections, and mask/overlay URL onto the map, while `Delete` removes the persisted detection through the backend delete endpoint.
- Better detection empty state for no detections matching current confidence/class filters.
- Detection error state for backend/model failures.
- Loading, error, and empty states for image registry data.
- MapLibre map viewport.
- MapLibre CSS loaded globally from `frontend/app/globals.css`.
- OpenStreetMap raster basemap through MapLibre raster source.
- MapLibre image source and raster layer rendering of the selected drone image.
- MapLibre image source and raster layer rendering of optional SegFormer mask PNGs and YOLO bbox overlay PNGs.
- SVG overlay rendering for detection bounding boxes, synchronized with MapLibre viewport changes through `map.project()`.
- Pixel-to-map bbox conversion aligned to the image raster bounds.
- Map auto-fit to backend-provided image bounds.
- MapLibre navigation controls positioned at the top-right.
- MapLibre container resize is handled through `ResizeObserver` plus `map.resize()` so responsive layout changes do not leave stale canvas dimensions or bbox projections.
- Bbox click selection highlights the matching detection result panel row.
- Detection mode selector adjusted to avoid overlap in the sidebar.
- Boxes metric based on current detection results.
- Overlay metric based on current mask or YOLO overlay availability.
- `.gitignore` excludes `model/.cache/` so downloaded model artifacts are not committed.
- `.gitignore` excludes `backend/static/masks/` so generated mask PNGs are not committed.
- `.gitignore` excludes `backend/static/outputs/` so generated SegFormer output PNGs are not committed.
- `.gitignore` excludes generated backend SQLite data and UUID upload files.

## Not Implemented Yet

- Exact georeferenced upload footprints from GeoTIFF/world-file/manual corner coordinates.
- Segmentation endpoint.
- Authentication.
- Tests.
- Configurable model/cache settings through backend environment variables.
- Mask cleanup or retention policy for generated temporary mask PNGs.
- Automated browser test for MapLibre hydration and map overlay rendering.
- Committed automated browser test for the full upload -> detect -> filter -> history -> backend export workflow. A temporary CDP script was used for verification but not kept in the repo.
- Custom-trained detector or segmenter for target drone land-cover classes such as `building`, `river`, `road`, `open_field`, and `vegetation`.

## Good Next Tasks

Recommended next implementation steps:

1. Add tests for health, image registry responses, upload validation, unknown image IDs, static serving, simulated detection filtering, frontend image loading states, and prediction response formatting.
2. Add GeoTIFF/world-file parsing for exact upload footprints.
3. Add tests for mode selector UI behavior, confidence threshold payloads, zero-detection state, and backend/model error display.
4. Add tests for real detection `mask_url`, generated mask dimensions, static mask serving, and frontend mask overlay toggling.
5. Add tests for backend GeoJSON export filename, FeatureCollection shape, closed polygon rings, and required feature properties.
6. Add cleanup for generated files in `backend/static/masks/` so repeated demos do not accumulate stale PNGs.
7. Add backend configuration for model name, local cache path, max boxes per label, minimum contour area, and mask output directory.
8. Add automated tests for real-mode error handling with model loading mocked.
9. Add Playwright coverage for map rendering, mask toggling, bbox alignment, and mode selector layout at narrow sidebar widths.

## Notes For A New Chat

If starting from a new chat, tell Codex to read this file first, then inspect the files referenced above before making changes.

The project is currently in scaffold stage. The main architectural intent is:

- Keep FastAPI routes thin.
- Keep image metadata access behind the registry service and repository layer.
- Keep model loading and inference in the dedicated model/backend service layers.
- Use typed schemas for all API responses.
- Keep the frontend map component focused on visualization.
- Keep API calls in `frontend/lib/api.ts`.
- Registered image metadata now drives the frontend map overlay through `/api/images`.
- `/api/detect` now supports simulated, SegFormer, and YOLOv8s modes.
- Real SegFormer detection preserves the current API and overlay contract by returning bounding boxes in registered image pixel coordinates.
- Real SegFormer detection now returns `mask_url` for a transparent segmentation PNG.
- Segmentation masks are optional frontend overlays, while bounding boxes remain visible above the mask.
- YOLOv8s overlays use the same `mask_url` frontend path, but are bbox-derived comparison overlays rather than true semantic segmentation masks.
- Tiled YOLO plus strict aerial allowlist filtering improves scale handling and rejects misleading COCO labels, but exact drone land-cover classes still require custom training or a fine-tuned segmentation model.
- GeoJSON export is backend-generated through `/api/export/geojson/{detection_id}`. The legacy `frontend/lib/geojson.ts` helper remains in the repo but is no longer the dashboard export source.
- Backend GeoJSON polygons use the same registered image bounds and top-left pixel-origin assumptions as the map overlay.
- MapLibre rendering lives in `frontend/components/map/DroneMap.tsx` and must remain client-only.
- Keep the MapLibre `Map` stable; avoid adding a changing `key` unless intentionally remounting the map.
- Browser extension hydration attributes are suppressed at the root/body, but app-rendered content should still avoid SSR/client-only value mismatches.

## Verification Notes

Recent checks after SegFormer-B2 SRS pipeline update:

- Dashboard layout widening pass verified: the main container is full-width, desktop grid columns are `300px / minmax(0, 1fr) / 340px`, the map container has a taller responsive height, and side panels use `min-w-0` to prevent overflow compression.
- MapLibre resize safety was added and type-checked: `DroneMap` observes its container with `ResizeObserver`, calls `map.resize()`, and refreshes projected bbox geometry on container size changes.
- Frontend TypeScript check passed with `.\node_modules\.bin\tsc.cmd --noEmit --incremental false` after the layout widening and MapLibre resize changes.
- Frontend production build passed with `npm.cmd run build` after the layout widening and MapLibre resize changes.

- Available Imagery source cleanup verification passed: startup pruned legacy DB image rows and `GET /api/images` returned only the three official seeded DJI rows on a cleaned local DB.
- The three seeded DJI rows used the stable UUIDs `11111111-1111-4111-8111-111111111111`, `22222222-2222-4222-8222-222222222222`, and `33333333-3333-4333-8333-333333333333`, with SRS Kafrul/Dhaka bounds.
- Restart verification passed: starting the backend again did not create duplicate seed rows.
- Upload verification passed through `POST /api/upload`: a new image received a fresh UUID, appeared first in `GET /api/images`, and persisted across restart with internal `source: "upload"`.
- Detection, history, and backend GeoJSON export were rechecked against the uploaded image after the registry cleanup; simulated detection returned 8 detections, `GET /api/history` returned persisted records, and `GET /api/export/geojson/{detection_id}` returned `200` with nonzero GeoJSON bytes.
- Frontend TypeScript check passed with `.\node_modules\.bin\tsc.cmd --noEmit --incremental false` after the dropdown label/source cleanup.
- Frontend production build passed with `npm.cmd run build` after the dropdown label/source cleanup.
- Backend compile check passed with `.venv\Scripts\python.exe -m compileall app ..\model` after the image source migration and cleanup changes.

- SRS frontend gap verification passed after the MapLibre migration using a headless Chrome CDP workflow against backend `127.0.0.1:8001` and frontend `127.0.0.1:3001` because local port `3000` was occupied by a VPN routing service.
- The headless workflow verified the upload dropzone rendered, accepted `dji_sample_001.jpg`, uploaded successfully, and displayed a fresh UUID plus upload metadata.
- The Available Imagery selector showed more than the three seeded samples during verification; the three seeded DJI records remained present.
- The confidence slider was verified with `min=0`, `max=1`, and default value `0.5`.
- Simulated detection was run through the UI with backend persistence; 8 raw detections loaded, the result panel showed `model_used: simulated` and millisecond inference time, and the visible count updated as frontend filters changed.
- Per-class visibility toggles were verified by hiding `building`, reducing rendered SVG bbox polygons from 8 to 6 without rerunning inference.
- The legend displayed detected classes and their palette colors/counts.
- The History tab loaded persisted records from `GET /api/history`; selecting a record reloaded detections onto the map and showed the reload status.
- Backend GeoJSON export was verified from the UI; Chrome downloaded `detections_<detection_id>.geojson` from `GET /api/export/geojson/{detection_id}` with nonzero byte length.
- Direct backend API verification passed for `GET /api/images`, `POST /api/detect` in simulated mode, `GET /api/history`, and `GET /api/export/geojson/{detection_id}`.
- Frontend TypeScript check passed with `.\node_modules\.bin\tsc.cmd --noEmit --incremental false`.
- Frontend production build passed with `npm.cmd run build` after restoring the normal default backend URL.
- Backend compile check passed with `.venv\Scripts\python.exe -m compileall app ..\model`.

- Frontend MapLibre migration installed `maplibre-gl@^4.7.1` and `react-map-gl@^7.1.9`; Leaflet, React-Leaflet, and `@types/leaflet` were removed from frontend dependencies.
- Frontend TypeScript check passed with `.\node_modules\.bin\tsc.cmd --noEmit --incremental false` after replacing Leaflet components with MapLibre.
- Frontend production build passed with `npm.cmd run build` after the MapLibre migration.
- Headless Chrome verification against `http://127.0.0.1:3001` confirmed `.maplibregl-map` and `.maplibregl-canvas` rendered, OSM tile requests were issued to `https://tile.openstreetmap.org/...`, and the selected drone raster was requested from `/static/images/...`.
- Simulated detection browser verification rendered 8 SVG bbox polygons with label/confidence text, confirmed bbox SVG points changed after MapLibre zoom, and confirmed clicking a bbox highlighted one matching detection panel entry.
- YOLO browser verification confirmed the mode label changed to `Show YOLO overlay`, the overlay metric showed an overlay, and a MapLibre mask/overlay image request was made to `/static/masks/overlays/...`.
- Browser console/event verification found no hydration mismatch errors during the MapLibre checks; the only captured warning/error was a missing favicon-style `404`.
- Backend compile check passed with `.venv\Scripts\python.exe -m compileall app ..\model` after YOLO aerial allowlist update.
- Frontend TypeScript check passed with `.\node_modules\.bin\tsc.cmd --noEmit --incremental false` after the mode-aware overlay label update.
- Direct YOLOv8s service verification passed for seeded demo image `11111111-1111-4111-8111-111111111111` at confidence `0.5`: response mode was `yolo`, `model_used` was `yolov8s.pt`, returned labels were only `person`, and blocked false-positive labels `clock`, `book`, `bird`, `cat`, `dog`, `chair`, and `traffic light` were absent.
- SegFormer default preservation was rechecked in `backend/app/schemas/detection.py` and `frontend/lib/api.ts`; both still default detection mode to `segformer`.
- Backend compile check passed with `.venv\Scripts\python.exe -m compileall app ..\model`.
- Frontend TypeScript check passed with `.\node_modules\.bin\tsc.cmd --noEmit --incremental false`.
- Upload endpoint verification passed with a real multipart request using field name `file`.
- JPEG upload to `POST /api/upload` returned `200`, a fresh UUID `image_id`, UUID-based stored filename URL, image dimensions, file size, `created_at`, and fallback Kafrul/Dhaka bounds.
- PNG upload to `POST /api/upload` returned `200`, a fresh UUID `image_id`, UUID-based stored filename URL, image dimensions, file size, `created_at`, and fallback Kafrul/Dhaka bounds.
- Unsupported text upload to `POST /api/upload` returned `422` with detail explaining JPEG/PNG and `.jpg/.jpeg/.png` requirements.
- File larger than `50MB` was rejected with HTTP `422` and detail `Uploaded image exceeds the 50MB limit.`
- A DJI `.JPG` file detected by Pillow as `MPO` uploaded successfully and was normalized to a standard saved JPEG with UUID filename.
- Uploaded images appeared in `GET /api/images`, and the three seeded DJI images still returned readable display names.
- Simulated detection worked against a freshly uploaded image ID, confirming `image_id` remains the detection identifier after upload.
- Available Imagery sorting was verified with all images visible, a new upload appearing first, seeded DJI images still present, and older records remaining selectable.
- Backend startup succeeded and the SegFormer warm-up path ran without blocking health once startup completed.
- `POST /api/detect` accepted JSON containing only `image_id` and `confidence_threshold`, using default `mode: "segformer"`.
- SegFormer response returned `model_used: "nvidia/segformer-b2-finetuned-ade-512-512"`.
- SegFormer response included SRS fields: `detection_id`, `image_id`, `model_used`, `inference_time_ms`, `image_width`, `image_height`, `detections`, `mask_url`, and `mask_base64`.
- SegFormer component detections included `label`, `confidence`, `bbox`, `pixel_area`, and `color`.
- SegFormer returned multiple component bboxes; they did not all span the full image.
- SegFormer mask URL served an actual PNG from `/static/outputs/...` with `200`, `image/png`, and nonzero byte length.
- Latest detection row appeared in SQLite with detection ID, image ID, model name, inference time, confidence threshold, mask path, and serialized detections JSON.
- Warmed CPU SegFormer-B2 inference on the full seeded sample measured about `52.9s`; model load is moved to startup warm-up, but this local CPU path remains above the SRS 10s target without GPU acceleration or a lower inference max side.
- Backend requirements sync passed with `.venv\Scripts\python.exe -m pip install -r requirements.txt` after installing `aiosqlite==0.20.0`.
- Backend `uvicorn app.main:app --host 127.0.0.1 --port 8000` startup succeeded and auto-created the SQLite database.
- `GET /api/images` returned the three seeded sample images with stable UUIDs and Kafrul/Dhaka bounds.
- `POST /api/upload` accepted a JPEG upload, returned a fresh UUID, and saved the image with a UUID filename instead of the original filename.
- Invalid non-image upload to `POST /api/upload` returned HTTP `422`.
- Simulated detection still returned detections for a seeded image ID.
- Frontend production build passed with `npm.cmd run build`.
- Simulated route dispatch returned expected filtered detections and `mask_url: null`.
- Real SegFormer inference ran successfully for `11111111-1111-4111-8111-111111111111`, returned model-generated detections, and returned a static `mask_url`.
- YOLOv8s tiled inference ran successfully for `11111111-1111-4111-8111-111111111111`, returned detections through `mode: "yolo"`, and returned a bbox-derived overlay `mask_url`.
- YOLOv8s overlay was verified as `2048x1536 RGBA`.
- Generated real mask was served successfully from `/static/masks/...` with content type `image/png`.
- Generated real mask was verified as `2048x1536 RGBA`.
- GeoJSON export helper passed frontend TypeScript check.
- A structural GeoJSON validation check passed for `FeatureCollection`, `Polygon`, finite `[longitude, latitude]` coordinates, and closed rings.
- Frontend dev server responded at `http://localhost:3000`.
- `npm run lint` did not complete because this Next.js project has no ESLint config yet and `next lint` opened an interactive setup prompt.
- Git status can be checked with a one-off `git -c safe.directory='D:/Methila_work/Drone Imagery Object Detection' status --short`; direct git commands may still report dubious ownership in the sandbox.

## Git Note

Direct git commands may report dubious ownership because the sandbox user differs from the repository owner. Use a one-off `-c safe.directory='D:/Methila_work/Drone Imagery Object Detection'` flag when inspection is needed. No global Git configuration was changed.
