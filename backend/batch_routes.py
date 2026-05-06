from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

try:
    from .batch_store import (
        delete_agent_batch,
        get_agent_batch,
        get_history_root_dir,
        list_agent_batches,
        update_agent_batch_item,
        upsert_agent_batch,
    )
except ImportError:
    from batch_store import (
        delete_agent_batch,
        get_agent_batch,
        get_history_root_dir,
        list_agent_batches,
        update_agent_batch_item,
        upsert_agent_batch,
    )


router = APIRouter()


class AgentBatchItemPayload(BaseModel):
    id: Optional[str] = None
    title: str = ""
    prompt: str = ""
    aspectRatio: str = "1:1"
    imageSize: str = "1K"
    imageUrls: List[str] = []
    imageRefs: List[str] = []
    status: str = "draft"
    error: str = ""
    result: Optional[Any] = None
    nodeId: str = ""


class AgentBatchPayload(BaseModel):
    id: Optional[str] = None
    batchId: Optional[str] = None
    name: str = "未命名批次"
    summary: str = ""
    requirementText: str = ""
    status: str = "draft"
    modelId: str = ""
    imageModelId: str = ""
    referenceImageCount: int = 0
    referenceImages: List[str] = []
    documentAssets: List[Dict[str, Any]] = []
    fileReadIssues: List[Dict[str, Any]] = []
    items: List[AgentBatchItemPayload] = []
    tasks: Optional[List[AgentBatchItemPayload]] = None
    approvedAt: Optional[int] = None


class AgentBatchItemPatch(BaseModel):
    status: Optional[str] = None
    error: Optional[str] = None
    result: Optional[Any] = None
    nodeId: Optional[str] = None
    title: Optional[str] = None
    prompt: Optional[str] = None
    aspectRatio: Optional[str] = None
    imageSize: Optional[str] = None


@router.get("/agent/batches")
def list_batches(limit: int = 50):
    return {
        "items": list_agent_batches(limit=limit),
        "storageRoot": str(get_history_root_dir()),
    }


@router.get("/agent/batches/{batch_id}")
def get_batch(batch_id: str):
    row = get_agent_batch(batch_id)
    if not row:
        raise HTTPException(status_code=404, detail="Batch not found")
    return {"item": row, "storageRoot": str(get_history_root_dir())}


@router.post("/agent/batches")
def create_or_update_batch(payload: AgentBatchPayload):
    row = upsert_agent_batch(payload.model_dump())
    return {"item": row, "storageRoot": str(get_history_root_dir())}


@router.put("/agent/batches/{batch_id}")
def update_batch(batch_id: str, payload: AgentBatchPayload):
    data = payload.model_dump()
    data["id"] = batch_id
    row = upsert_agent_batch(data)
    return {"item": row, "storageRoot": str(get_history_root_dir())}


@router.delete("/agent/batches/{batch_id}")
def delete_batch(batch_id: str):
    deleted = delete_agent_batch(batch_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Batch not found")
    return {"ok": True, "storageRoot": str(get_history_root_dir())}


@router.patch("/agent/batches/{batch_id}/items/{item_id}")
def patch_batch_item(batch_id: str, item_id: str, payload: AgentBatchItemPatch):
    patch: Dict[str, Any] = {
        key: value
        for key, value in payload.model_dump().items()
        if value is not None
    }
    row = update_agent_batch_item(batch_id, item_id, patch)
    if not row:
        raise HTTPException(status_code=404, detail="Batch item not found")
    return {"item": row, "storageRoot": str(get_history_root_dir())}
