# Project State Handoff

Last updated: 2026-04-28

## Project Overview

This repository is a monorepo scaffold for a drone imagery semantic segmentation platform. The intended product is a web workspace where users can view drone imagery on a map, upload imagery, run model inference, and visualize object detection or segmentation results.

Current implementation is an early scaffold with a working FastAPI backend, a working Next.js frontend, a backend health check, CORS configuration, a local image registry, static image serving, and a hydration-safe Leaflet map viewer that renders registered drone imagery as a georeferenced image overlay. Detection supports simulated results, real SegFormer semantic segmentation results converted into bounding boxes, and YOLOv8s object detection. Real SegFormer detection generates a transparent semantic segmentation mask PNG, while YOLOv8s generates a transparent bbox-derived overlay PNG. Detection results can be exported from the frontend as GIS-friendly GeoJSON polygons.

## Tech Stack

- Frontend: Next.js 15, React 19, TypeScript, Tailwind CSS, Leaflet, React-Leaflet
- Backend: FastAPI, Python, Pydantic Settings, Uvicorn
- ML dependencies: Torch, Torchvision, HuggingFace Transformers, Ultralytics, Pillow, NumPy, OpenCV headless
- Models: HuggingFace SegFormer `nvidia/segformer-b0-finetuned-ade-512-512`; YOLOv8s `yolov8s.pt`
- Current visualization direction: bounding boxes plus optional SegFormer mask / YOLO overlay

## Repository Structure

```text
.
+-- backend/
|   +-- app/
|   |   +-- api/
|   |   |   +-- router.py
|   |   |   +-- routes/detect.py
|   |   |   +-- routes/images.py
|   |   |   +-- routes/health.py
|   |   +-- core/config.py
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
|   |   |   +-- RasterOverlay.tsx
|   |   |   +-- DetectionBoxes.tsx
|   |   |   +-- MaskOverlay.tsx
|   |   |   +-- FitBounds.tsx
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
- `GET /api/images/{image_id}`

The health routes return:

```json
{
  "status": "ok",
  "service": "backend"
}
```

The image list route returns available locally registered images:

```json
{
  "images": [
    {
      "image_id": "drone_image_001",
      "filename": "drone_001.jpg",
      "image_url": "http://localhost:8000/static/images/drone_001.jpg",
      "width": 2048,
      "height": 1536,
      "bounds": {
        "north": 23.005,
        "south": 23.0,
        "east": 90.006,
        "west": 90.0
      }
    }
  ]
}
```

Image registry state:

- Registry module: `backend/app/services/image_registry.py`
- Pydantic response models: `backend/app/schemas/images.py`
- Registered image ID: `drone_image_001`
- Stored file: `backend/static/images/drone_001.jpg`
- Static URL path: `/static/images/drone_001.jpg`
- Dimensions: `2048x1536`
- Default map bounds: north `23.005`, south `23.000`, east `90.006`, west `90.000`
- `POST /api/images` accepts a multipart image upload, stores it as `backend/static/images/drone_001.jpg`, converts it to JPEG, updates the registered image dimensions, and keeps the same default map bounds.
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
- The route validates `image_id` through the image registry and returns `404` for unknown image IDs.
- The request model constrains `confidence_threshold` to `0.0` through `1.0`.
- The response mode is `"simulated"`, `"segformer"`, `"real"`, or `"yolo"`, matching the request path used.
- The response includes `mask_url`, which is `null` for simulated detection, an absolute static PNG URL for SegFormer masks, and an absolute static PNG URL for YOLO bbox-derived overlays.
- Simulated detections include `building`, `vegetation`, `open_land`, and `road/path`.
- Simulated detections are filtered by `confidence_threshold`.
- Real detection lazy-loads SegFormer on first real request.
- Real detection uses CPU by default when CUDA is unavailable.
- Real detection loads `nvidia/segformer-b0-finetuned-ade-512-512` through HuggingFace Transformers.
- Real detection maps useful ADE classes into readable labels: `building`, `vegetation`, `road`, and `earth/ground`.
- Real detection converts segmentation masks into bounding boxes with OpenCV contour extraction.
- Real detection creates a colored transparent RGBA segmentation mask from useful target classes above the confidence threshold.
- Real mask PNGs are saved under `backend/static/masks/` and served through the existing FastAPI `/static` mount.
- Generated mask dimensions match the registered source image dimensions.
- Real detection returns the existing detection shape inside the shared response:

```json
{
  "image_id": "drone_image_001",
  "mode": "real",
  "mask_url": "http://localhost:8000/static/masks/drone_image_001_mask_0_50_<uuid>.png",
  "detections": [
    {
      "label": "building",
      "confidence": 0.87,
      "bbox": [0, 0, 128, 128]
    }
  ]
}
```

- Model-loading and inference failures are surfaced as `503` responses with clear error messages.
- Real detection scales returned bounding boxes to the registered image dimensions so the existing map overlay contract remains stable.
- YOLOv8s detection lazy-loads `yolov8s.pt` through Ultralytics and stores its settings/cache under `model/.cache/ultralytics`.
- YOLOv8s uses tiled inference with `1024` pixel tiles, `20%` overlap, `imgsz=1024`, `iou=0.45`, `max_det=300`, and CUDA when available, otherwise CPU.
- YOLOv8s tile detections are projected back into original image pixel coordinates and merged with NMS.
- YOLOv8s class filtering suppresses common misleading COCO false positives in aerial imagery, including `bench`, `potted plant`, and furniture-like classes.
- YOLOv8s overlay PNGs are generated from bounding boxes, saved under `backend/static/masks/overlays/`, and returned as `mask_url`; these are not true semantic segmentation masks.

Backend settings are in `backend/app/core/config.py`.

- Default app name: `Drone Imagery Segmentation API`
- Default environment: `development`
- `BACKEND_CORS_ORIGINS` is read from `.env` as a comma-separated string.
- Default allowed origin is `http://localhost:3000`.

Backend dependencies are pinned in `backend/requirements.txt`.

Important current limitation: the backend still does not persist uploaded-file metadata beyond the local static replacement image. The only registry record currently available is `drone_image_001`. Real detection works, but the first run requires downloading the HuggingFace model unless it already exists in the local model cache.

## Frontend State

The frontend entry page is `frontend/app/page.tsx`, which renders `Dashboard`.

`frontend/components/Dashboard.tsx` is a client component that:

- Dynamically loads `frontend/components/map/DroneMap.tsx` with SSR disabled.
- Calls the backend health endpoint on mount through `getHealth()`.
- Calls the backend image registry endpoint on mount through `getImages()`.
- Uploads a replacement drone image through `uploadDroneImage()`.
- Runs SegFormer detection through `runDetection()` by default.
- Shows backend online/offline state in the header.
- Shows an image workflow sidebar with available registered images.
- Shows an upload control that replaces the current demo image.
- Shows a vertically stacked detection mode selector for `Simulated`, `SegFormer`, and `YOLOv8s` so labels do not overlap in the narrow sidebar.
- Shows a confidence threshold slider from `0.10` to `0.95` and a `Run Detection` button.
- Shows a `Show segmentation mask` checkbox that becomes useful when a real detection response includes `mask_url`.
- Shows a loading spinner while detection is running.
- Stores detection results in React state.
- Stores the latest `mask_url` in React state.
- Provides a `Clear Results` button.
- Selects the first available image by default.
- Shows a `Boxes` metric based on current detection result count and a `Masks` metric based on whether a mask URL is available.
- Renders the map workspace area.
- Shows clean loading, error, and empty-image states for the image registry.
- Shows a right-side image details panel with `image_id`, image size, and image bounds.
- Shows detection results in the right-side panel with label, confidence, pixel bbox, current mode, and number of detections returned.
- Shows an `Export GeoJSON` button when detections are available.
- Exports current detections as `detections_<image_id>.geojson`, for example `detections_drone_image_001.geojson`.
- Displays detection status messages that include the response mode.
- Shows a better empty result state: `No detections found above this threshold.`
- Shows backend/model error states using backend `detail` text when available.
- Uses a state revision counter for uploaded image cache busting instead of `Date.now()` to avoid hydration-sensitive output.

`frontend/components/MapViewport.tsx` is now a compatibility wrapper around `frontend/components/map/DroneMap.tsx`.

The Leaflet map is split into client-only components under `frontend/components/map/`:

- `DroneMap.tsx`: owns `MapContainer`, OSM `TileLayer`, zoom control, map label, and layer composition.
- `RasterOverlay.tsx`: renders the selected drone image as a Leaflet `ImageOverlay`.
- `MaskOverlay.tsx`: renders optional SegFormer mask or YOLO bbox overlay PNG as a non-interactive `ImageOverlay`.
- `DetectionBoxes.tsx`: converts pixel bboxes into Leaflet rectangles and renders tooltips/popups.
- `FitBounds.tsx`: calls `useMap()` and fits the map to selected image bounds.

The map components:

- Uses React-Leaflet.
- Are loaded only on the client through Next.js dynamic import with `ssr: false`.
- Uses a fallback center at Dhaka coordinates `[23.8103, 90.4125]`.
- Loads OpenStreetMap tiles.
- Renders the selected registered drone image with Leaflet `ImageOverlay`.
- Renders an optional transparent segmentation mask `ImageOverlay` when `mask_url` is present and mask visibility is enabled.
- Sets the mask overlay to `interactive={false}` so it does not block map interaction.
- Converts backend bounds into Leaflet bounds using southwest and northeast corners.
- Converts detection pixel bboxes from `[x_min, y_min, x_max, y_max]` into Leaflet geographic rectangles using image width, height, and bounds.
- Accounts for top-left image pixel origin by mapping `y=0` to the image north edge.
- Renders detections as Leaflet `Rectangle` overlays aligned to the raster image.
- Keeps detection rectangle overlays visible above the mask overlay.
- Shows detection label and confidence in rectangle tooltip/popup UI.
- Fits the map viewport to the selected image bounds.
- Supports normal Leaflet zoom and pan interactions.
- Moves the Leaflet zoom controls to the top-right so they do not overlap the image label.
- Shows a small overlay label with the selected image filename.
- Preserve layer order: OSM base, raster image, mask overlay, bounding boxes.
- Memoize image bounds and detection bounds and use `React.memo` on map subcomponents.

`frontend/app/layout.tsx`:

- Imports global styles through `frontend/app/globals.css`.
- Uses `suppressHydrationWarning` on the document root and body to tolerate browser extension attributes such as `cz-shortcut-listen`.

`frontend/app/globals.css`:

- Imports Leaflet CSS globally with `@import "leaflet/dist/leaflet.css";`.
- Sets `.leaflet-container` to full width and height.

`frontend/lib/api.ts` contains the API helper:

- Reads `NEXT_PUBLIC_API_BASE_URL`.
- Falls back to `http://localhost:8000`.
- Exposes `getHealth()` for `GET /health`.
- Exposes typed image metadata models and `getImages()` for `GET /api/images`.
- Exposes `uploadDroneImage()` for multipart `POST /api/images`.
- Exposes typed detection models and `runDetection()` for `POST /api/detect`.
- Detection response mode type is `"simulated" | "segformer" | "yolo" | "real"`.
- Detection responses include `mask_url: string | null`.
- `runDetection()` accepts an optional mode and sends `"segformer"` by default.
- `runDetection()` sends both `mode` and `confidence_threshold`.
- Detection API error responses parse backend `detail` when available.

`frontend/lib/geojson.ts` contains frontend-only GeoJSON export helpers:

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

- Defines the SegFormer model name as `nvidia/segformer-b0-finetuned-ade-512-512`.
- Lazy-loads `SegformerImageProcessor` and `SegformerForSemanticSegmentation`.
- Uses `cuda` when available and CPU otherwise.
- Runs semantic segmentation with Torch no-grad inference.
- Maps raw class IDs to useful readable labels.
- Extracts contours with OpenCV and converts mask regions into bounding boxes.
- Builds a transparent RGBA mask image for useful target classes above the requested confidence threshold.
- Resizes the mask image to the registered drone image dimensions with nearest-neighbor sampling.
- Keeps only boxes above the requested confidence threshold.
- Stores HuggingFace model files in `model/.cache/huggingface`.

YOLOv8s service state:

- Backend wrapper: `backend/app/services/yolo_service.py`
- Weights: `yolov8s.pt`
- Library: Ultralytics
- Inference is tiled and bbox coordinates are returned in original image pixel space.
- COCO labels known to produce misleading aerial false positives are filtered before NMS and overlay generation.
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
- Static sample image: `http://localhost:8000/static/images/drone_001.jpg`
- Backend docs: `http://localhost:8000/docs`
- Generated real detection masks: `http://localhost:8000/static/masks/<mask_filename>.png`

Detection examples:

```json
{
  "image_id": "drone_image_001",
  "mode": "real",
  "confidence_threshold": 0.5
}
```

Real detection response example:

```json
{
  "image_id": "drone_image_001",
  "mode": "real",
  "detections": [
    {
      "label": "building",
      "confidence": 0.87,
      "bbox": [0, 0, 128, 128]
    }
  ],
  "mask_url": "http://localhost:8000/static/masks/drone_image_001_mask_0_50_<uuid>.png"
}
```

```json
{
  "image_id": "drone_image_001",
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
        "image_id": "drone_image_001",
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
- `POST /api/images` replacement image upload endpoint.
- `GET /api/images/{image_id}` image lookup endpoint with `404` handling.
- Pydantic image response schemas.
- Pydantic detection request and response schemas.
- Local image registry service.
- Simulated detection service with registry validation and confidence filtering.
- SegFormer detection wrapper service with registry validation and service error mapping.
- SegFormer model service with lazy model loading, CPU-safe execution, ADE label mapping, confidence filtering, and OpenCV contour-to-bbox extraction.
- SegFormer mask PNG generation for useful ADE-derived classes.
- YOLOv8s tiled inference with class filtering and bbox-derived overlay generation.
- Shared bbox NMS utility and shared overlay save/render utility.
- Static serving for generated mask PNGs through `/static/masks/...`.
- Clear `503` API errors when SegFormer loading or inference fails.
- Static file serving at `/static`.
- One registered sample drone image: `drone_image_001`.
- Backend CORS support.
- Next.js frontend with TypeScript and Tailwind CSS.
- Frontend health check against the backend.
- Frontend image registry fetch through `GET /api/images`.
- Frontend drone image upload that replaces `backend/static/images/drone_001.jpg`.
- Frontend SegFormer detection request through `POST /api/detect` by default, with typed support for simulated and YOLO modes.
- Frontend detection mode selector for `Simulated`, `SegFormer`, and `YOLOv8s`.
- Frontend confidence threshold slider constrained to `0.10` through `0.95`.
- Hydration-safe client-only Leaflet map split into `frontend/components/map/`.
- Dynamic map import with `ssr: false`.
- Document-level hydration warning suppression for extension-injected root/body attributes.
- Dashboard layout with backend status display.
- Image selector for registered backend images.
- Detection controls with mode selector, confidence threshold, mask toggle, loading spinner, run button, and clear results button.
- Frontend-only GeoJSON export for current detection results.
- GeoJSON export converts pixel bounding boxes to geographic polygons using registered image bounds.
- GeoJSON features include `label`, `confidence`, `image_id`, and `mode`.
- GeoJSON export downloads as `detections_<image_id>.geojson`.
- Right-side image metadata panel showing `image_id`, image size, and bounds.
- Right-side detection results panel showing current mode, returned count, label, confidence, and bbox.
- Better detection empty state for no detections above the threshold.
- Detection error state for backend/model failures.
- Loading, error, and empty states for image registry data.
- Leaflet map viewport.
- Leaflet CSS loaded globally from `frontend/app/globals.css`.
- OpenStreetMap basemap.
- Leaflet `ImageOverlay` rendering of the selected drone image.
- Leaflet `ImageOverlay` rendering of optional segmentation mask PNGs.
- Leaflet `Rectangle` overlays for detection bounding boxes.
- Pixel-to-map bbox conversion aligned to the image raster bounds.
- Map auto-fit to backend-provided image bounds.
- Leaflet zoom controls positioned at the top-right.
- Detection mode selector adjusted to avoid overlap in the sidebar.
- Boxes metric based on current detection results.
- Masks metric based on current mask availability.
- `.gitignore` excludes `model/.cache/` so downloaded model artifacts are not committed.
- `.gitignore` excludes `backend/static/masks/` so generated mask PNGs are not committed.

## Not Implemented Yet

- Multiple image upload records.
- User-uploaded file metadata persistence beyond replacing the local static image.
- Segmentation endpoint.
- Result history.
- Database.
- Authentication.
- Tests.
- Configurable model/cache settings through backend environment variables.
- Mask cleanup or retention policy for generated temporary mask PNGs.
- Automated browser test that clicks `Export GeoJSON` and validates the downloaded file.
- Automated browser test for Leaflet hydration and map overlay rendering.
- Custom-trained detector or segmenter for target drone land-cover classes such as `building`, `river`, `road`, `open_field`, and `vegetation`.

## Good Next Tasks

Recommended next implementation steps:

1. Add tests for health, image registry responses, upload validation, unknown image IDs, static serving, simulated detection filtering, frontend image loading states, and prediction response formatting.
2. Add configurable map bounds for uploaded images instead of reusing the default sample bounds.
3. Add tests for mode selector UI behavior, confidence threshold payloads, zero-detection state, and backend/model error display.
4. Add tests for real detection `mask_url`, generated mask dimensions, static mask serving, and frontend mask overlay toggling.
5. Add tests for GeoJSON export filename, FeatureCollection shape, closed polygon rings, and required feature properties.
6. Add cleanup for generated files in `backend/static/masks/` so repeated demos do not accumulate stale PNGs.
7. Add backend configuration for model name, local cache path, max boxes per label, minimum contour area, and mask output directory.
8. Add automated tests for real-mode error handling with model loading mocked.
9. Add Playwright coverage for map rendering, mask toggling, bbox alignment, and mode selector layout at narrow sidebar widths.

## Notes For A New Chat

If starting from a new chat, tell Codex to read this file first, then inspect the files referenced above before making changes.

The project is currently in scaffold stage. The main architectural intent is:

- Keep FastAPI routes thin.
- Keep local image metadata in the registry service until a real database is introduced.
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
- Tiled YOLO plus class filtering improves scale handling and suppresses misleading COCO labels, but exact drone land-cover classes still require custom training or a fine-tuned segmentation model.
- GeoJSON export is frontend-only and lives in `frontend/lib/geojson.ts`.
- GeoJSON polygons use the same registered image bounds and top-left pixel-origin assumptions as the map overlay.
- Leaflet rendering lives in `frontend/components/map/` and must remain client-only.
- Keep `MapContainer` stable; avoid adding a changing `key` unless intentionally remounting the map.
- Browser extension hydration attributes are suppressed at the root/body, but app-rendered content should still avoid SSR/client-only value mismatches.

## Verification Notes

Recent checks after map hydration and documentation updates:

- Backend compile check passed with `.venv\Scripts\python.exe -m compileall app ..\model`.
- Frontend TypeScript check passed with `.\node_modules\.bin\tsc.cmd --noEmit --incremental false`.
- Frontend production build passed with `npm.cmd run build`.
- Simulated route dispatch returned expected filtered detections and `mask_url: null`.
- Real SegFormer inference ran successfully for `drone_image_001`, returned model-generated detections, and returned a static `mask_url`.
- YOLOv8s tiled inference ran successfully for `drone_image_001`, returned detections through `mode: "yolo"`, and returned a bbox-derived overlay `mask_url`.
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
