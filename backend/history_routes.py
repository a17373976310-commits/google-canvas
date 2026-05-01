import time as _time
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

try:
    from .history_store import (
        clear_image_history_rows,
        delete_image_history_row,
        get_history_root_dir,
        list_image_history_rows,
        serialize_history_row,
        upsert_image_history_row,
    )
except ImportError:
    from history_store import (
        clear_image_history_rows,
        delete_image_history_row,
        get_history_root_dir,
        list_image_history_rows,
        serialize_history_row,
        upsert_image_history_row,
    )


router = APIRouter()


class ImageHistoryItemPayload(BaseModel):
    id: str
    createdAt: int
    nodeId: str
    providerName: str
    providerBaseUrl: str
    modelId: str
    rawPrompt: str
    optimizedPrompt: str
    sourceImageDataUrl: Optional[str] = None
    resultImageUrl: str
    resultImageDataUrl: Optional[str] = None


@router.get("/history/images")
def list_image_history(limit: int = 300):
    rows = list_image_history_rows(limit=limit)
    return {
        "items": [serialize_history_row(row) for row in rows],
        "storageRoot": str(get_history_root_dir()),
    }


@router.post("/history/images")
def create_image_history(payload: ImageHistoryItemPayload, background_tasks: BackgroundTasks):
    """Accept history item and immediately return a lightweight item to the caller.

    The heavy part (downloading source/result image bytes and writing them to
    disk) runs as a FastAPI BackgroundTask *after* the HTTP response is sent.
    The caller receives an item dict right away so it can update the UI without
    waiting for disk I/O.
    """
    item_data = payload.model_dump()
    item_id = str(item_data.get("id") or f"hist-{int(_time.time() * 1000)}")

    # Lightweight item returned immediately — no localised asset paths yet,
    # those will be filled in once the background task completes.
    immediate_item = {
        "id": item_id,
        "createdAt": item_data.get("createdAt") or int(_time.time() * 1000),
        "nodeId": item_data.get("nodeId", ""),
        "providerName": item_data.get("providerName", ""),
        "providerBaseUrl": item_data.get("providerBaseUrl", ""),
        "modelId": item_data.get("modelId", ""),
        "rawPrompt": item_data.get("rawPrompt", ""),
        "optimizedPrompt": item_data.get("optimizedPrompt", ""),
        "resultImageUrl": item_data.get("resultImageUrl", ""),
        # sourceImageDataUrl / resultImageDataUrl will be set by the background task
        "sourceImageDataUrl": None,
        "resultImageDataUrl": None,
    }

    # Persist to disk in the background (downloads bytes, writes files, updates index).
    background_tasks.add_task(upsert_image_history_row, item_data)

    return {
        "item": immediate_item,
        "storageRoot": str(get_history_root_dir()),
    }


@router.delete("/history/images/{item_id}")
def delete_image_history(item_id: str):
    deleted = delete_image_history_row(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="History item not found")
    return {"ok": True}


@router.delete("/history/images")
def clear_image_history():
    clear_image_history_rows()
    return {"ok": True}
