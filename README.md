# Drone Imagery Semantic Segmentation Platform

Monorepo scaffold for a drone imagery semantic segmentation platform.

## Stack

- Frontend: Next.js, TypeScript, Tailwind CSS, Leaflet, React-Leaflet
- Backend: FastAPI, Python, Torch, HuggingFace Transformers
- Model target: SegFormer from HuggingFace
- Visualization target: bounding boxes first, segmentation masks later

## Project Structure

```text
frontend/
backend/
model/
README.md
```

## Local Setup

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Health endpoint:

```text
GET http://localhost:8000/health
```

Use `localhost` or `127.0.0.1` in the browser. `0.0.0.0` is only a server bind address, not the address you should open as a client URL.

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

The frontend reads the backend URL from `NEXT_PUBLIC_API_BASE_URL`.
If it is not set, it defaults to:

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

## Current Scope

Implemented:

- Next.js frontend with TypeScript and Tailwind CSS
- FastAPI backend with modular app structure
- `GET /health`
- CORS support for the frontend
- Frontend health check against the backend
- Leaflet-based map surface prepared for future bounding box visualization

Not implemented yet:

- Detection
- Segmentation inference
- Model loading
- File upload or persistence
