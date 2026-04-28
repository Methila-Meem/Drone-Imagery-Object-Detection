# Drone Imagery Semantic Segmentation Platform

Monorepo scaffold for a drone imagery analysis workspace. The app lets a user view registered drone imagery on a Leaflet map, upload a replacement image, run simulated or real SegFormer detection, view bounding boxes and optional segmentation masks, and export detection boxes as GeoJSON.

## Stack

- Frontend: Next.js 15, React 19, TypeScript, Tailwind CSS, Leaflet, React-Leaflet
- Backend: FastAPI, Python, Pydantic Settings, Uvicorn
- ML: Torch, HuggingFace Transformers, Pillow, NumPy, OpenCV headless
- Model: `nvidia/segformer-b0-finetuned-ade-512-512`
- Visualization: georeferenced image overlay, bounding boxes, optional transparent mask overlay, GeoJSON export

## Project Structure

```text
backend/
  app/
    api/routes/
    schemas/
    services/
  static/images/
  static/masks/
frontend/
  app/
  components/
  lib/
model/
  segformer_service.py
PROJECT_STATE.md
README.md
```

## Features

- FastAPI backend with health, image registry, upload, and detection endpoints.
- Local image registry with one demo image: `drone_image_001`.
- Replacement image upload through `POST /api/images`.
- Detection modes:
  - `simulated`
  - `real` SegFormer
- Confidence threshold support.
- Real SegFormer detections converted from semantic segmentation masks into bounding boxes.
- Real SegFormer transparent PNG mask generation served from `/static/masks/...`.
- Frontend controls for mode, confidence threshold, mask visibility, run, clear, and GeoJSON export.
- Leaflet map with raster image overlay, mask overlay, and bounding box rectangles.
- Frontend-only GeoJSON export as `detections_<image_id>.geojson`.

## Local Setup

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Useful backend URLs:

```text
GET  http://localhost:8000/health
GET  http://localhost:8000/api/images
POST http://localhost:8000/api/images
POST http://localhost:8000/api/detect
GET  http://localhost:8000/docs
```

Use `localhost` or `127.0.0.1` in the browser. `0.0.0.0` is only a server bind address, not the address to open as a client URL.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend URL:

```text
http://localhost:3000
```

The frontend reads the backend URL from `NEXT_PUBLIC_API_BASE_URL`. If it is not set, it defaults to:

```text
http://localhost:8000
```

## Environment

Create `frontend/.env.local` if your backend runs somewhere else:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

Create `backend/.env` to override backend settings:

```env
APP_NAME=Drone Imagery Segmentation API
BACKEND_CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001
```

## API Examples

### List Images

```http
GET /api/images
```

Example response:

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

### Run Detection

```http
POST /api/detect
```

Simulated request:

```json
{
  "image_id": "drone_image_001",
  "mode": "simulated",
  "confidence_threshold": 0.5
}
```

Real SegFormer request:

```json
{
  "image_id": "drone_image_001",
  "mode": "real",
  "confidence_threshold": 0.5
}
```

Example response:

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

`mask_url` is `null` for simulated detection. Real detection writes generated PNG masks under `backend/static/masks/`, which is ignored by git.

## Frontend Workflow

1. Select a registered image.
2. Optionally upload a replacement drone image.
3. Choose `Simulated` or `Real SegFormer`.
4. Adjust confidence threshold from `0.10` to `0.95`.
5. Run detection.
6. Toggle `Show segmentation mask` when a real mask is available.
7. Export current detections as GeoJSON.

GeoJSON export converts each pixel bbox into a geographic polygon using the registered image bounds. Features include:

- `label`
- `confidence`
- `image_id`
- `mode`

## Notes

- The first real SegFormer run may download HuggingFace model files unless they already exist in `model/.cache/huggingface`.
- The model cache is ignored by git.
- Uploaded images currently replace the single demo image record; multiple persistent image records are not implemented yet.
- Generated mask PNG cleanup is not implemented yet.
- `npm run lint` is not currently wired because this Next.js project has no ESLint config.

## Verification

Recent checks:

```bash
cd backend
.venv\Scripts\python.exe -m compileall app ..\model
```

```bash
cd frontend
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
```

Manual runtime checks have verified:

- `GET /health`
- Simulated detection with `mask_url: null`
- Real SegFormer detection with generated static PNG mask
- Generated mask dimensions match the registered image size
- Frontend at `http://localhost:3000`
- GeoJSON output structure: `FeatureCollection`, `Polygon`, closed rings, finite `[longitude, latitude]` coordinates
