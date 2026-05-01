# Deployment Guide

This repository deploys best as:

- Frontend on Vercel
- Backend on Render with a persistent disk

## Zeabur deployment

This project can also be deployed on Zeabur as two services:

- Frontend: Static site from the repository root
- Backend: Python service from `backend`

Recommended Zeabur setup:

### Frontend service

- Service type: Static site
- Root directory: repository root
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`

Required frontend environment values:

- `VITE_BACKEND_URL=https://your-backend.zeabur.app`
- `VITE_DEV_MODE_PASSWORD=your-password`
- `VITE_NODE_VAULT_PASSWORD=your-password`
- `VITE_EXECUTE_TIMEOUT_MS=0`
- `VITE_GEMINI_API_KEY=` only if you want browser-side Gemini calls

### Backend service

- Service type: Python
- Root directory: `backend`
- Install command: `pip install -r requirements.txt`
- Start command: `python main.py`
- Health check path: `/health`

Required backend environment values:

- `THIRD_PARTY_API_KEY=your_actual_provider_api_key`

Recommended backend environment values:

- `THIRD_PARTY_BASE_URL=https://api.openai.com/v1`
- `AI_CANVAS_HISTORY_DIR=/data/uploads`
- `ASYNC_TASK_TIMEOUT_SECONDS=0`
- `OPENAI_TIMEOUT_SECONDS=120`
- `HTTP_REQUEST_TIMEOUT_SECONDS=60`
- `OPENAI_MAX_RETRIES=1`
- `MAX_IMAGE_HISTORY_ITEMS=300`

Persistent storage:

- Attach a Zeabur volume to the backend service
- Mount it to `/data`
- Keep `AI_CANVAS_HISTORY_DIR=/data/uploads` so image history survives redeploys

Deployment order:

1. Deploy the backend first
2. Verify `https://your-backend.zeabur.app/health`
3. Put that backend URL into the frontend `VITE_BACKEND_URL`
4. Deploy the frontend

## Why this setup

- The frontend is a Vite static app that builds to `dist`.
- The backend is a long-running FastAPI service.
- The backend stores image history on disk, so it needs persistent storage.

## 1. Deploy the backend to Render

Use the root-level `render.yaml` blueprint.

Important settings already prepared:

- `rootDir: backend`
- build command: `pip install -r requirements.txt`
- start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- health check: `/health`
- persistent disk mount path: `/opt/render/project/src/storage`

Required Render environment values:

- `THIRD_PARTY_API_KEY`: your model provider API key

Preconfigured defaults:

- `THIRD_PARTY_BASE_URL=https://api.openai.com/v1`
- `AI_CANVAS_HISTORY_DIR=/opt/render/project/src/storage`
- `OPENAI_TIMEOUT_SECONDS=120`
- `HTTP_REQUEST_TIMEOUT_SECONDS=60`
- `OPENAI_MAX_RETRIES=1`
- `MAX_IMAGE_HISTORY_ITEMS=300`

Render notes:

- A persistent disk requires a paid web service plan.
- The blueprint uses `starter` because free services cannot attach disks.

After deploy, confirm the backend health endpoint works:

```text
https://your-render-backend.onrender.com/health
```

It should return:

```json
{"status":"ok"}
```

## 2. Deploy the frontend to Vercel

The root-level `vercel.json` is prepared for SPA deep links.

Expected Vercel project settings:

- framework preset: Vite
- build command: `npm run build`
- output directory: `dist`
- root directory: repository root

Set these frontend environment variables in Vercel:

- `VITE_BACKEND_URL=https://your-render-backend.onrender.com`
- `VITE_DEV_MODE_PASSWORD=your-password`
- `VITE_NODE_VAULT_PASSWORD=your-password`
- `VITE_EXECUTE_TIMEOUT_MS=0`
- `VITE_GEMINI_API_KEY=` only if you want direct Gemini calls from the browser

## 3. Deployment order

1. Deploy Render backend first
2. Copy the Render service URL
3. Add it to Vercel as `VITE_BACKEND_URL`
4. Deploy Vercel frontend

## 4. Local env templates

- Frontend template: `.env.example`
- Backend template: `backend/.env.example`

## 5. Common issue

If image history appears to work but disappears after a redeploy, verify that:

- the Render service is not on the free plan
- the persistent disk is attached
- `AI_CANVAS_HISTORY_DIR` still points to `/opt/render/project/src/storage`
