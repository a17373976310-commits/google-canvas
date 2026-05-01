import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv


load_dotenv()


def parse_optional_timeout_seconds(raw: Optional[str], default: str = "0") -> Optional[float]:
    value_raw = raw if raw is not None else default
    text = str(value_raw).strip()
    if not text:
        return None
    try:
        value = float(text)
    except Exception:
        return None
    return value if value > 0 else None


def parse_int(raw: Optional[str], default: int = 0) -> int:
    text = str(raw).strip() if raw is not None else ""
    if not text:
        return default
    try:
        return int(text)
    except Exception:
        return default


OPENAI_TIMEOUT_SECONDS = parse_optional_timeout_seconds(os.getenv("OPENAI_TIMEOUT_SECONDS"), default="120")
ASYNC_TASK_TIMEOUT_SECONDS = parse_optional_timeout_seconds(os.getenv("ASYNC_TASK_TIMEOUT_SECONDS"), default="900")
HTTP_REQUEST_TIMEOUT_SECONDS = parse_optional_timeout_seconds(os.getenv("HTTP_REQUEST_TIMEOUT_SECONDS"), default="90")
OPENAI_MAX_RETRIES = parse_int(os.getenv("OPENAI_MAX_RETRIES"), default=2)
HTTP_REQUEST_MAX_RETRIES = parse_int(os.getenv("HTTP_REQUEST_MAX_RETRIES"), default=3)
MAX_CONCURRENT_IMAGE_TASKS = parse_int(os.getenv("MAX_CONCURRENT_IMAGE_TASKS"), default=10)
THIRD_PARTY_API_KEY = (os.getenv("THIRD_PARTY_API_KEY") or "").strip()
THIRD_PARTY_BASE_URL = (os.getenv("THIRD_PARTY_BASE_URL") or "").strip()
PORT = int(os.getenv("PORT", "8000"))


def get_http_request_timeout_seconds() -> float:
    timeout = parse_optional_timeout_seconds(os.getenv("HTTP_REQUEST_TIMEOUT_SECONDS"), default="90")
    return timeout if timeout is not None else 90.0


def get_max_image_history_items() -> int:
    return parse_int(os.getenv("MAX_IMAGE_HISTORY_ITEMS"), default=300)


def get_default_history_root_dir() -> Path:
    # Prefer /data/uploads (Zeabur persistent volume convention);
    # fall back to a relative ./history dir for local dev.
    if Path("/data/uploads").exists():
        return Path("/data/uploads")
    local = Path("./history")
    local.mkdir(parents=True, exist_ok=True)
    return local


def get_history_root_dir() -> Path:
    return Path(os.getenv("AI_CANVAS_HISTORY_DIR") or get_default_history_root_dir()).expanduser()


def get_history_assets_dir() -> Path:
    return get_history_root_dir() / "images"


def get_history_index_path() -> Path:
    return get_history_root_dir() / "history_index.json"


def get_agent_batches_index_path() -> Path:
    return get_history_root_dir() / "agent_batches.json"
