import base64
import json
import mimetypes
import time
import urllib.parse
import urllib.request
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

try:
    from .config import (
        get_history_assets_dir,
        get_history_index_path,
        get_history_root_dir,
        get_http_request_timeout_seconds,
        get_max_image_history_items,
    )
except ImportError:
    from config import (
        get_history_assets_dir,
        get_history_index_path,
        get_history_root_dir,
        get_http_request_timeout_seconds,
        get_max_image_history_items,
    )


HISTORY_INDEX_LOCK = Lock()


def ensure_history_storage_ready() -> None:
    history_root_dir = get_history_root_dir()
    history_assets_dir = get_history_assets_dir()
    history_index_path = get_history_index_path()

    history_root_dir.mkdir(parents=True, exist_ok=True)
    history_assets_dir.mkdir(parents=True, exist_ok=True)
    if not history_index_path.exists():
        history_index_path.write_text("[]", encoding="utf-8")


def urlopen_with_optional_timeout(request_or_url: Any):
    timeout = get_http_request_timeout_seconds()

    if isinstance(request_or_url, str):
        req = urllib.request.Request(
            request_or_url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                )
            },
        )
        return urllib.request.urlopen(req, timeout=timeout)

    return urllib.request.urlopen(request_or_url, timeout=timeout)


def detect_mime_type_from_source(source: str, fallback: str = "image/png") -> str:
    if source.startswith("data:"):
        header = source.split(",", 1)[0]
        prefix = header[5:]
        mime_type = prefix.split(";", 1)[0].strip()
        if mime_type:
            return mime_type

    guessed, _ = mimetypes.guess_type(source)
    return guessed or fallback


def read_image_bytes(source: str) -> Tuple[bytes, str]:
    value = str(source or "").strip()
    if not value:
        raise ValueError("Image source is empty")

    if value.startswith("http://") or value.startswith("https://"):
        with urlopen_with_optional_timeout(value) as response:
            body = response.read()
            header_mime = ""
            headers = getattr(response, "headers", None)
            if headers is not None:
                if hasattr(headers, "get_content_type"):
                    header_mime = headers.get_content_type() or ""
                elif hasattr(headers, "get"):
                    header_mime = str(headers.get("Content-Type") or "").split(";", 1)[0]
            return body, header_mime or detect_mime_type_from_source(value)

    if value.startswith("data:") and "," in value:
        header, data = value.split(",", 1)
        mime_type = detect_mime_type_from_source(header)
        return base64.b64decode(data), mime_type

    return base64.b64decode(value), detect_mime_type_from_source(value)


def normalize_history_extension(mime_type: str) -> str:
    ext = mimetypes.guess_extension((mime_type or "").split(";", 1)[0].strip().lower()) or ".png"
    if ext == ".jpe":
        return ".jpg"
    if ext == ".svgz":
        return ".svg"
    return ext


def load_history_index_rows() -> List[Dict[str, Any]]:
    ensure_history_storage_ready()
    try:
        raw = get_history_index_path().read_text(encoding="utf-8")
        parsed = json.loads(raw) if raw.strip() else []
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def save_history_index_rows(rows: List[Dict[str, Any]]) -> None:
    ensure_history_storage_ready()
    get_history_index_path().write_text(
        json.dumps(rows, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def remove_history_asset(path_value: Optional[str]) -> None:
    if not path_value:
        return
    try:
        asset_path = get_history_assets_dir() / path_value
        if asset_path.exists():
            asset_path.unlink()
    except Exception:
        return


def write_history_asset(item_id: str, source: Optional[str], kind: str) -> Optional[str]:
    value = str(source or "").strip()
    if not value:
        return None

    image_bytes, mime_type = read_image_bytes(value)
    ext = normalize_history_extension(mime_type)
    file_name = f"{item_id}-{kind}{ext}"
    file_path = get_history_assets_dir() / file_name
    file_path.write_bytes(image_bytes)
    return file_name


def build_history_asset_relative_url(file_name: Optional[str]) -> Optional[str]:
    if not file_name:
        return None
    return f"/history-assets/{urllib.parse.quote(file_name)}"


def localize_generated_image_output(result_output: Optional[str]) -> Optional[str]:
    value = str(result_output or "").strip()
    if not value:
        return None
    try:
        runtime_item_id = f"runtime-{int(time.time() * 1000)}"
        file_name = write_history_asset(runtime_item_id, value, "result")
        localized = build_history_asset_relative_url(file_name)
        return localized or value
    except Exception as asset_err:
        print(f"DEBUG: Failed to localize generated image output: {asset_err}")
        return value


def build_canonical_image_result(result_output: Optional[str]) -> Dict[str, Any]:
    value = str(result_output or "").strip()
    if not value:
        return {
            "primaryUrl": "",
            "urls": [],
            "selectedIndex": 0,
            "sourceKind": "remote-url",
            "localCacheUrl": None,
        }

    if value.startswith("data:image/"):
        source_kind = "data-url"
        local_cache_url = None
    elif value.startswith("/history-assets/"):
        source_kind = "local-cache-url"
        local_cache_url = value
    else:
        source_kind = "remote-url"
        local_cache_url = None

    return {
        "primaryUrl": value,
        "urls": [value],
        "selectedIndex": 0,
        "sourceKind": source_kind,
        "localCacheUrl": local_cache_url,
    }


def serialize_history_row(row: Dict[str, Any]) -> Dict[str, Any]:
    output = dict(row)
    output["sourceImageDataUrl"] = build_history_asset_relative_url(row.get("sourceImageAssetPath"))
    output["resultImageDataUrl"] = build_history_asset_relative_url(row.get("resultImageAssetPath"))
    output.pop("sourceImageAssetPath", None)
    output.pop("resultImageAssetPath", None)
    return output


def trim_history_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    max_image_history_items = get_max_image_history_items()
    if len(rows) <= max_image_history_items:
        return rows

    keep_rows = rows[:max_image_history_items]
    for removed in rows[max_image_history_items:]:
        remove_history_asset(removed.get("sourceImageAssetPath"))
        remove_history_asset(removed.get("resultImageAssetPath"))
    return keep_rows


def list_image_history_rows(limit: int = 300) -> List[Dict[str, Any]]:
    with HISTORY_INDEX_LOCK:
        rows = load_history_index_rows()
    return rows[: max(1, limit)]


def upsert_image_history_row(item: Dict[str, Any]) -> Dict[str, Any]:
    item_id = str(item.get("id") or f"hist-{int(time.time() * 1000)}")

    source_asset_path = write_history_asset(item_id, item.get("sourceImageDataUrl"), "source")
    result_asset_source = item.get("resultImageDataUrl") or item.get("resultImageUrl")
    result_asset_path = write_history_asset(item_id, result_asset_source, "result")

    row = {
        "id": item_id,
        "createdAt": int(item.get("createdAt") or int(time.time() * 1000)),
        "nodeId": str(item.get("nodeId") or ""),
        "providerName": str(item.get("providerName") or "Unknown provider"),
        "providerBaseUrl": str(item.get("providerBaseUrl") or ""),
        "modelId": str(item.get("modelId") or "unknown"),
        "rawPrompt": str(item.get("rawPrompt") or ""),
        "optimizedPrompt": str(item.get("optimizedPrompt") or item.get("rawPrompt") or ""),
        "sourceImageAssetPath": source_asset_path,
        "resultImageAssetPath": result_asset_path,
        "resultImageUrl": str(item.get("resultImageUrl") or ""),
    }

    with HISTORY_INDEX_LOCK:
        rows = load_history_index_rows()
        existing = next(
            (index for index, existing_row in enumerate(rows) if existing_row.get("id") == item_id),
            None,
        )
        if existing is not None:
            remove_history_asset(rows[existing].get("sourceImageAssetPath"))
            remove_history_asset(rows[existing].get("resultImageAssetPath"))
            rows.pop(existing)
        rows.insert(0, row)
        rows.sort(key=lambda history_row: int(history_row.get("createdAt") or 0), reverse=True)
        rows = trim_history_rows(rows)
        save_history_index_rows(rows)

    return row


def delete_image_history_row(item_id: str) -> bool:
    deleted = False
    with HISTORY_INDEX_LOCK:
        rows = load_history_index_rows()
        remaining_rows: List[Dict[str, Any]] = []
        for row in rows:
            if row.get("id") == item_id:
                deleted = True
                remove_history_asset(row.get("sourceImageAssetPath"))
                remove_history_asset(row.get("resultImageAssetPath"))
                continue
            remaining_rows.append(row)
        if deleted:
            save_history_index_rows(remaining_rows)
    return deleted


def clear_image_history_rows() -> None:
    with HISTORY_INDEX_LOCK:
        rows = load_history_index_rows()
        for row in rows:
            remove_history_asset(row.get("sourceImageAssetPath"))
            remove_history_asset(row.get("resultImageAssetPath"))
        save_history_index_rows([])
