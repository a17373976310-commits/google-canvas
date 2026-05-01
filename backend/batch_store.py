import json
import time
from threading import Lock
from typing import Any, Dict, List, Optional

try:
    from .config import get_agent_batches_index_path, get_history_root_dir
except ImportError:
    from config import get_agent_batches_index_path, get_history_root_dir


AGENT_BATCH_LOCK = Lock()
MAX_AGENT_BATCHES = 200


def ensure_agent_batch_storage_ready() -> None:
    root = get_history_root_dir()
    root.mkdir(parents=True, exist_ok=True)
    path = get_agent_batches_index_path()
    if not path.exists():
        path.write_text("[]", encoding="utf-8")


def load_agent_batch_rows() -> List[Dict[str, Any]]:
    ensure_agent_batch_storage_ready()
    try:
        raw = get_agent_batches_index_path().read_text(encoding="utf-8")
        parsed = json.loads(raw) if raw.strip() else []
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def save_agent_batch_rows(rows: List[Dict[str, Any]]) -> None:
    ensure_agent_batch_storage_ready()
    get_agent_batches_index_path().write_text(
        json.dumps(rows[:MAX_AGENT_BATCHES], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def now_ms() -> int:
    return int(time.time() * 1000)


def normalize_batch_item(raw: Any, index: int) -> Dict[str, Any]:
    item = raw if isinstance(raw, dict) else {}
    prompt = str(item.get("prompt") or "").strip()
    title = str(item.get("title") or f"任务 {index + 1}").strip() or f"任务 {index + 1}"
    status = str(item.get("status") or "draft").strip() or "draft"
    image_urls = item.get("imageUrls")
    return {
        "id": str(item.get("id") or f"item-{index + 1}"),
        "title": title,
        "prompt": prompt,
        "aspectRatio": str(item.get("aspectRatio") or "1:1").strip() or "1:1",
        "imageSize": str(item.get("imageSize") or "1K").strip() or "1K",
        "imageUrls": image_urls if isinstance(image_urls, list) else [],
        "status": status,
        "error": str(item.get("error") or ""),
        "result": item.get("result"),
        "nodeId": str(item.get("nodeId") or ""),
        "updatedAt": int(item.get("updatedAt") or now_ms()),
    }


def normalize_batch_row(payload: Dict[str, Any], existing: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    timestamp = now_ms()
    batch_id = str(payload.get("id") or payload.get("batchId") or (existing or {}).get("id") or f"batch-{timestamp}")
    raw_items = payload.get("items") or payload.get("tasks") or (existing or {}).get("items") or []
    items = [
        normalize_batch_item(item, index)
        for index, item in enumerate(raw_items if isinstance(raw_items, list) else [])
    ]
    status = str(payload.get("status") or (existing or {}).get("status") or "draft").strip() or "draft"
    reference_images = payload.get("referenceImages")
    if not isinstance(reference_images, list):
        reference_images = (existing or {}).get("referenceImages") if isinstance((existing or {}).get("referenceImages"), list) else []
    document_assets = payload.get("documentAssets")
    if not isinstance(document_assets, list):
        document_assets = (existing or {}).get("documentAssets") if isinstance((existing or {}).get("documentAssets"), list) else []
    reference_image_count = int(
        payload.get("referenceImageCount")
        or len(reference_images)
        or (existing or {}).get("referenceImageCount")
        or 0
    )
    return {
        "id": batch_id,
        "name": str(payload.get("name") or (existing or {}).get("name") or "未命名批次"),
        "summary": str(payload.get("summary") or (existing or {}).get("summary") or ""),
        "requirementText": str(payload.get("requirementText") or (existing or {}).get("requirementText") or ""),
        "status": status,
        "modelId": str(payload.get("modelId") or (existing or {}).get("modelId") or ""),
        "imageModelId": str(payload.get("imageModelId") or (existing or {}).get("imageModelId") or ""),
        "referenceImageCount": reference_image_count,
        "referenceImages": [str(item) for item in reference_images if str(item or "").strip()][:24],
        "documentAssets": document_assets[:12],
        "items": items,
        "createdAt": int((existing or {}).get("createdAt") or payload.get("createdAt") or timestamp),
        "updatedAt": timestamp,
        "approvedAt": payload.get("approvedAt") or (existing or {}).get("approvedAt"),
    }


def summarize_batch(row: Dict[str, Any]) -> Dict[str, Any]:
    items = row.get("items") if isinstance(row.get("items"), list) else []
    status_counts: Dict[str, int] = {}
    for item in items:
        status = str(item.get("status") or "draft")
        status_counts[status] = status_counts.get(status, 0) + 1
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "summary": row.get("summary"),
        "status": row.get("status"),
        "modelId": row.get("modelId"),
        "imageModelId": row.get("imageModelId"),
        "referenceImageCount": row.get("referenceImageCount"),
        "itemCount": len(items),
        "statusCounts": status_counts,
        "createdAt": row.get("createdAt"),
        "updatedAt": row.get("updatedAt"),
    }


def list_agent_batches(limit: int = 50) -> List[Dict[str, Any]]:
    with AGENT_BATCH_LOCK:
        rows = load_agent_batch_rows()
    rows.sort(key=lambda row: int(row.get("updatedAt") or 0), reverse=True)
    return [summarize_batch(row) for row in rows[: max(1, min(limit, MAX_AGENT_BATCHES))]]


def get_agent_batch(batch_id: str) -> Optional[Dict[str, Any]]:
    with AGENT_BATCH_LOCK:
        rows = load_agent_batch_rows()
    return next((row for row in rows if str(row.get("id")) == str(batch_id)), None)


def delete_agent_batch(batch_id: str) -> bool:
    with AGENT_BATCH_LOCK:
        rows = load_agent_batch_rows()
        next_rows = [row for row in rows if str(row.get("id")) != str(batch_id)]
        if len(next_rows) == len(rows):
            return False
        save_agent_batch_rows(next_rows)
        return True


def upsert_agent_batch(payload: Dict[str, Any]) -> Dict[str, Any]:
    with AGENT_BATCH_LOCK:
        rows = load_agent_batch_rows()
        batch_id = str(payload.get("id") or payload.get("batchId") or "")
        existing_index = next(
            (index for index, row in enumerate(rows) if batch_id and str(row.get("id")) == batch_id),
            None,
        )
        existing = rows[existing_index] if existing_index is not None else None
        row = normalize_batch_row(payload, existing=existing)
        if existing_index is not None:
            rows[existing_index] = row
        else:
            rows.insert(0, row)
        rows.sort(key=lambda item: int(item.get("updatedAt") or 0), reverse=True)
        save_agent_batch_rows(rows)
        return row


def update_agent_batch_item(batch_id: str, item_id: str, patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    with AGENT_BATCH_LOCK:
        rows = load_agent_batch_rows()
        batch_index = next((index for index, row in enumerate(rows) if str(row.get("id")) == str(batch_id)), None)
        if batch_index is None:
            return None
        row = rows[batch_index]
        items = row.get("items") if isinstance(row.get("items"), list) else []
        item_index = next((index for index, item in enumerate(items) if str(item.get("id")) == str(item_id)), None)
        if item_index is None:
            return None
        next_item = dict(items[item_index])
        for key in ("status", "error", "result", "nodeId", "title", "prompt", "aspectRatio", "imageSize"):
            if key in patch:
                next_item[key] = patch.get(key)
        next_item["updatedAt"] = now_ms()
        items[item_index] = next_item
        row["items"] = items
        row["updatedAt"] = now_ms()
        statuses = {str(item.get("status") or "draft") for item in items}
        if "running" in statuses:
            row["status"] = "running"
        elif statuses and statuses.issubset({"success"}):
            row["status"] = "success"
        elif "failed" in statuses:
            row["status"] = "partial"
        rows[batch_index] = row
        save_agent_batch_rows(rows)
        return row
