# Project State Handoff

Last updated: 2026-04-27

## Project Overview

This repository is a monorepo scaffold for a drone imagery semantic segmentation platform. The intended product is a web workspace where users can view drone imagery on a map, upload imagery, run model inference, and visualize object detection or segmentation results.

Current implementation is an early scaffold with a working FastAPI backend, a working Next.js frontend, a backend health check, CORS configuration, a local image registry, static image serving, and a Leaflet map viewer that renders registered drone imagery as a georeferenced image overlay. Detection now supports both simulated results and real SegFormer semantic segmentation results converted into bounding boxes.

## Tech Stack

- Frontend: Next.js 15, React 19, TypeScript, Tailwind CSS, Leaflet, React-Leaflet
- Backend: FastAPI, Python, Pydantic Settings, Uvicorn
- ML dependencies: Torch, HuggingFace Transformers, Pillow, NumPy, OpenCV headless
- Model: HuggingFace SegFormer `nvidia/segformer-b0-finetuned-ade-512-512`
- Current visualization direction: bounding boxes first, segmentation masks later

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
|   |   +-- services/segformer_detection.py
|   |   +-- services/simulated_detection.py
|   |   +-- main.py
|   +-- static/
|   |   +-- images/
|   |   |   +-- drone_001.jpg
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
|   +-- lib/api.ts
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
- SegFormer inference service: `model/segformer_service.py`
- `POST /api/detect` accepts `image_id`, `mode`, and `confidence_threshold`.
- `mode` is constrained to `"real"` or `"simulated"` and defaults to `"real"`.
- The route validates `image_id` through the image registry and returns `404` for unknown image IDs.
- The request model constrains `confidence_threshold` to `0.0` through `1.0`.
- The response mode is `"real"` or `"simulated"`, matching the request path used.
- Simulated detections include `building`, `vegetation`, `open_land`, and `road/path`.
- Simulated detections are filtered by `confidence_threshold`.
- Real detection lazy-loads SegFormer on first real request.
- Real detection uses CPU by default when CUDA is unavailable.
- Real detection loads `nvidia/segformer-b0-finetuned-ade-512-512` through HuggingFace Transformers.
- Real detection maps useful ADE classes into readable labels: `building`, `vegetation`, `road`, and `earth/ground`.
- Real detection converts segmentation masks into bounding boxes with OpenCV contour extraction.
- Real detection returns the existing detection shape:

```json
{
  "label": "building",
  "confidence": 0.87,
  "bbox": [0, 0, 128, 128]
}
```

- Model-loading and inference failures are surfaced as `503` responses with clear error messages.
- Real detection scales returned bounding boxes to the registered image dimensions so the existing map overlay contract remains stable.

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

- Dynamically loads the map component with SSR disabled.
- Calls the backend health endpoint on mount through `getHealth()`.
- Calls the backend image registry endpoint on mount through `getImages()`.
- Uploads a replacement drone image through `uploadDroneImage()`.
- Runs real SegFormer detection through `runDetection()` by default.
- Shows backend online/offline state in the header.
- Shows an image workflow sidebar with available registered images.
- Shows an upload control that replaces the current demo image.
- Shows a confidence threshold slider and `Run Detection` button.
- Shows a loading spinner while detection is running.
- Stores detection results in React state.
- Provides a `Clear Results` button.
- Selects the first available image by default.
- Shows a `Boxes` metric based on current detection result count and a placeholder `Masks` metric currently `0`.
- Renders the map workspace area.
- Shows clean loading, error, and empty-image states for the image registry.
- Shows a right-side image details panel with `image_id`, image size, and image bounds.
- Shows detection results in the right-side panel with label, confidence, and pixel bbox.
- Displays detection status messages that include the response mode.

`frontend/components/MapViewport.tsx` is a client map component that:

- Uses React-Leaflet.
- Uses a fallback center at Dhaka coordinates `[23.8103, 90.4125]`.
- Loads OpenStreetMap tiles.
- Renders the selected registered drone image with Leaflet `ImageOverlay`.
- Converts backend bounds into Leaflet bounds using southwest and northeast corners.
- Converts detection pixel bboxes from `[x_min, y_min, x_max, y_max]` into Leaflet geographic rectangles using image width, height, and bounds.
- Accounts for top-left image pixel origin by mapping `y=0` to the image north edge.
- Renders detections as Leaflet `Rectangle` overlays aligned to the raster image.
- Shows detection label and confidence in rectangle tooltip/popup UI.
- Fits the map viewport to the selected image bounds.
- Supports normal Leaflet zoom and pan interactions.
- Moves the Leaflet zoom controls to the top-right so they do not overlap the image label.
- Shows a small overlay label with the selected image filename.

`frontend/lib/api.ts` contains the API helper:

- Reads `NEXT_PUBLIC_API_BASE_URL`.
- Falls back to `http://localhost:8000`.
- Exposes `getHealth()` for `GET /health`.
- Exposes typed image metadata models and `getImages()` for `GET /api/images`.
- Exposes `uploadDroneImage()` for multipart `POST /api/images`.
- Exposes typed detection models and `runDetection()` for `POST /api/detect`.
- Detection response mode type is `"real" | "simulated"`.
- `runDetection()` accepts an optional mode and sends `"real"` by default.

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
- Keeps only boxes above the requested confidence threshold.
- Stores HuggingFace model files in `model/.cache/huggingface`.

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

Detection examples:

```json
{
  "image_id": "drone_image_001",
  "mode": "real",
  "confidence_threshold": 0.5
}
```

```json
{
  "image_id": "drone_image_001",
  "mode": "simulated",
  "confidence_threshold": 0.5
}
```

## Implemented

- Monorepo structure with `frontend`, `backend`, and `model`.
- FastAPI backend app with modular routing.
- Health response schema.
- `GET /` and `GET /health`.
- `POST /api/detect` simulated detection endpoint.
- `POST /api/detect` real SegFormer detection mode.
- `POST /api/detect` `mode` field with `"real"` and `"simulated"` support.
- `GET /api/images` image registry endpoint.
- `POST /api/images` replacement image upload endpoint.
- `GET /api/images/{image_id}` image lookup endpoint with `404` handling.
- Pydantic image response schemas.
- Pydantic detection request and response schemas.
- Local image registry service.
- Simulated detection service with registry validation and confidence filtering.
- SegFormer detection wrapper service with registry validation and service error mapping.
- SegFormer model service with lazy model loading, CPU-safe execution, ADE label mapping, confidence filtering, and OpenCV contour-to-bbox extraction.
- Clear `503` API errors when SegFormer loading or inference fails.
- Static file serving at `/static`.
- One registered sample drone image: `drone_image_001`.
- Backend CORS support.
- Next.js frontend with TypeScript and Tailwind CSS.
- Frontend health check against the backend.
- Frontend image registry fetch through `GET /api/images`.
- Frontend drone image upload that replaces `backend/static/images/drone_001.jpg`.
- Frontend real detection request through `POST /api/detect` by default, with typed support for simulated mode.
- Dashboard layout with backend status display.
- Image selector for registered backend images.
- Detection controls with confidence threshold, loading spinner, run button, and clear results button.
- Right-side image metadata panel showing `image_id`, image size, and bounds.
- Right-side detection results panel showing label, confidence, and bbox.
- Loading, error, and empty states for image registry data.
- Leaflet map viewport.
- OpenStreetMap basemap.
- Leaflet `ImageOverlay` rendering of the selected drone image.
- Leaflet `Rectangle` overlays for detection bounding boxes.
- Pixel-to-map bbox conversion aligned to the image raster bounds.
- Map auto-fit to backend-provided image bounds.
- Leaflet zoom controls positioned at the top-right.
- Boxes metric based on current detection results.
- Placeholder metric for `Masks`.
- `.gitignore` excludes `model/.cache/` so downloaded model artifacts are not committed.

## Not Implemented Yet

- Multiple image upload records.
- User-uploaded file metadata persistence beyond replacing the local static image.
- Segmentation endpoint.
- Segmentation mask rendering.
- Result history.
- Database.
- Authentication.
- Tests.
- Frontend UI selector for switching between `real` and `simulated` modes.
- Configurable model/cache settings through backend environment variables.

## Good Next Tasks

Recommended next implementation steps:

1. Add tests for health, image registry responses, upload validation, unknown image IDs, static serving, simulated detection filtering, frontend image loading states, and prediction response formatting.
2. Add configurable map bounds for uploaded images instead of reusing the default sample bounds.
3. Add frontend controls for choosing real versus simulated mode.
4. Add segmentation mask response models and frontend mask rendering after the bounding box flow is stable.
5. Add backend configuration for model name, local cache path, max boxes per label, and minimum contour area.
6. Add automated tests for real-mode error handling with model loading mocked.

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
- `/api/detect` now supports both real SegFormer mode and simulated fallback mode.
- Real SegFormer detection preserves the current API and overlay contract by returning bounding boxes in registered image pixel coordinates.
- Segmentation masks are still backend-internal only; the API returns boxes, not mask payloads.

## Verification Notes

Recent checks after SegFormer integration:

- Backend compile check passed with `.venv\Scripts\python.exe -m compileall app ..\model`.
- Frontend TypeScript check passed with `.\node_modules\.bin\tsc.cmd --noEmit`.
- Simulated route dispatch returned expected filtered detections.
- Real SegFormer inference ran successfully for `drone_image_001` and returned model-generated detections.
- `npm run lint` did not complete because this Next.js project has no ESLint config yet and `next lint` opened an interactive setup prompt.
- Git status could not be checked from the sandbox because Git reported this repository as a dubious ownership directory.

## Git Note

Git status could not be checked from the sandbox because Git reported this repository as a dubious ownership directory for the sandbox user. No global Git configuration was changed.
