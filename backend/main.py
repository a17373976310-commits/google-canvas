from fastapi import FastAPI, HTTPException, Body
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import threading
import time
from openai import OpenAI
import base64
import re
try:
    from .config import (
        MAX_CONCURRENT_IMAGE_TASKS,
        OPENAI_MAX_RETRIES,
        OPENAI_TIMEOUT_SECONDS,
        PORT,
        THIRD_PARTY_API_KEY,
        THIRD_PARTY_BASE_URL,
    )
    from .history_routes import router as history_router
    from .batch_routes import router as batch_router
    from .document_routes import router as document_router
    from .history_store import (
        build_canonical_image_result,
        ensure_history_storage_ready,
        get_history_assets_dir,
        localize_generated_image_output,
        read_image_bytes,
    )
    from .providers.common import (
        build_gemini_api_url,
        build_provider_api_url,
        detect_provider_family,
        extract_task_id,
        find_first_image_url,
        looks_like_gemini_model,
        normalize_base_url,
        normalize_provider_response,
        poll_async_task,
        provider_post_multipart_edit,
        provider_prefers_openai_compatible,
        provider_request_json,
        resolve_chat_protocol,
        resolve_image_protocol,
        resolve_image_submission_result,
        urlopen_with_optional_timeout,
    )
    from .prompts import PROMPT_REGISTRY
except ImportError:
    from config import (
        MAX_CONCURRENT_IMAGE_TASKS,
        OPENAI_MAX_RETRIES,
        OPENAI_TIMEOUT_SECONDS,
        PORT,
        THIRD_PARTY_API_KEY,
        THIRD_PARTY_BASE_URL,
    )
    from history_routes import router as history_router
    from batch_routes import router as batch_router
    from document_routes import router as document_router
    from history_store import (
        build_canonical_image_result,
        ensure_history_storage_ready,
        get_history_assets_dir,
        localize_generated_image_output,
        read_image_bytes,
    )
    from providers.common import (
        build_gemini_api_url,
        build_provider_api_url,
        detect_provider_family,
        extract_task_id,
        find_first_image_url,
        looks_like_gemini_model,
        normalize_base_url,
        normalize_provider_response,
        poll_async_task,
        provider_post_multipart_edit,
        provider_prefers_openai_compatible,
        provider_request_json,
        resolve_chat_protocol,
        resolve_image_protocol,
        resolve_image_submission_result,
        urlopen_with_optional_timeout,
    )
    from prompts import PROMPT_REGISTRY
# Semaphore that limits how many heavy image-generation tasks run concurrently.
# When the limit is reached the endpoint immediately returns HTTP 429 instead
# of queuing indefinitely and exhausting memory / upstream rate limits.
_IMAGE_SEMAPHORE = threading.Semaphore(MAX_CONCURRENT_IMAGE_TASKS)


def create_openai_client(api_key: str, base_url: Optional[str]) -> OpenAI:
    kwargs: Dict[str, Any] = {
        "api_key": api_key,
        "base_url": base_url,
        "max_retries": OPENAI_MAX_RETRIES,
    }
    if OPENAI_TIMEOUT_SECONDS is not None:
        kwargs["timeout"] = OPENAI_TIMEOUT_SECONDS
    return OpenAI(**kwargs)

from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="AI Infinite Canvas Backend")

# Enable CORS for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # This app is accessed from localhost and Tailscale-hosted frontend URLs.
    # We don't rely on browser credentials, so wildcard origins are fine here.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

ensure_history_storage_ready()
app.mount("/history-assets", StaticFiles(directory=str(get_history_assets_dir())), name="history-assets")
app.include_router(history_router)
app.include_router(batch_router)
app.include_router(document_router)

# Initialize OpenAI client with generic mapping
# OpenAI client is now initialized dynamically per request in execute_node


class NodeConfig(BaseModel):
    model_config = {"extra": "allow"}  # Allow extra fields from frontend config
    prompt: Optional[str] = None
    systemInstruction: Optional[str] = None
    modelId: Optional[str] = None
    baseUrl: Optional[str] = None
    aspectRatio: Optional[str] = None


class ExecuteRequest(BaseModel):
    node_id: str
    node_type: str
    config: NodeConfig
    inputs: Dict[str, Any] = {}  # Changed from List to Dict
    provider_name: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    chat_protocol: Optional[str] = None
    reasoning_protocol: Optional[str] = None
    image_protocol: Optional[str] = None


class TestProviderRequest(BaseModel):
    provider_name: Optional[str] = None
    api_key: str
    base_url: Optional[str] = None
    model: Optional[str] = None
    chat_protocol: Optional[str] = None
    reasoning_protocol: Optional[str] = None


class TestImageProviderRequest(BaseModel):
    provider_name: Optional[str] = None
    api_key: str
    base_url: Optional[str] = None
    model: Optional[str] = None
    image_protocol: Optional[str] = None
def model_prefers_b64_image_response(model: Optional[str]) -> bool:
    value = str(model or "").strip().lower()
    return value.startswith("nano-banana-2") or value.startswith("gpt-image-2")


def is_gpt_image_2_model(model: Optional[str]) -> bool:
    return str(model or "").strip().lower().startswith("gpt-image-2")


def _round_down_to_multiple(value: float, multiple: int = 16) -> int:
    return max(multiple, int(value // multiple) * multiple)


def resolve_gpt_image_2_size(aspect_ratio: Optional[str], image_size: Optional[str]) -> str:
    raw_size = str(image_size or "").strip().lower()
    if raw_size == "auto":
        return "auto"
    if re.fullmatch(r"\d+x\d+", raw_size):
        width, height = [int(part) for part in raw_size.split("x", 1)]
        ratio = max(width, height) / max(1, min(width, height))
        pixels = width * height
        if (
            max(width, height) <= 3840
            and width % 16 == 0
            and height % 16 == 0
            and ratio <= 3
            and 655360 <= pixels <= 8294400
        ):
            return raw_size

    ratio_text = str(aspect_ratio or "1:1").strip()
    match = re.fullmatch(r"(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)", ratio_text)
    if not match:
        return "1024x1024"

    width_ratio = float(match.group(1))
    height_ratio = float(match.group(2))
    if width_ratio <= 0 or height_ratio <= 0:
        return "1024x1024"

    long_to_short = max(width_ratio, height_ratio) / min(width_ratio, height_ratio)
    if long_to_short > 3:
        return "1024x1024"

    tier = str(image_size or "1K").strip().upper()
    if tier == "4K":
        max_edge = 3840
        max_pixels = 8294400
        if width_ratio >= height_ratio:
            width = max_edge
            height = _round_down_to_multiple(width * height_ratio / width_ratio)
        else:
            height = max_edge
            width = _round_down_to_multiple(height * width_ratio / height_ratio)

        while width * height > max_pixels:
            width = _round_down_to_multiple(width - 16)
            height = _round_down_to_multiple(width * height_ratio / width_ratio)
            if width_ratio < height_ratio:
                height = _round_down_to_multiple(height - 16)
                width = _round_down_to_multiple(height * width_ratio / height_ratio)
        return f"{width}x{height}"

    if tier == "2K":
        if width_ratio == height_ratio:
            return "2048x2048"
        long_edge = 2048
        if width_ratio > height_ratio:
            return f"{long_edge}x{_round_down_to_multiple(long_edge * height_ratio / width_ratio)}"
        return f"{_round_down_to_multiple(long_edge * width_ratio / height_ratio)}x{long_edge}"

    if width_ratio == height_ratio:
        return "1024x1024"
    short_edge = 1024
    if width_ratio > height_ratio:
        return f"{_round_down_to_multiple(short_edge * width_ratio / height_ratio)}x{short_edge}"
    return f"{short_edge}x{_round_down_to_multiple(short_edge * height_ratio / width_ratio)}"


def resolve_gpt_image_2_quality(config: Any) -> Optional[str]:
    raw_quality = (
        getattr(config, "quality", None)
        or getattr(config, "imageQuality", None)
        or getattr(config, "gptImageQuality", None)
    )
    quality = str(raw_quality or "").strip().lower()
    return quality if quality in {"low", "medium", "high", "auto"} else None


def gemini_model_supports_image_size(
    model: Optional[str],
    provider_name: Optional[str] = None,
    base_url: Optional[str] = None,
    image_protocol: Optional[str] = None,
) -> bool:
    value = str(model or "").strip().lower()
    if not value:
        return False

    if resolve_image_protocol(model, image_protocol) != "gemini-native":
        return False

    _provider_family = detect_provider_family(provider_name, base_url)

    unsupported_prefixes = (
        "gemini-2.5-flash-image",
    )
    if any(value.startswith(prefix) for prefix in unsupported_prefixes):
        return False

    supported_prefixes = (
        "gemini-3-pro-image-preview",
        "gemini-3.1-flash-image-preview",
        "gemini-2.0-flash-preview-image-generation",
    )
    return any(value.startswith(prefix) for prefix in supported_prefixes)


def is_doubao_seedream_model(model: Optional[str]) -> bool:
    value = str(model or "").strip().lower()
    return value.startswith("doubao-seedream-")


def provider_supports_async_image_tasks(
    provider_name: Optional[str],
    base_url: Optional[str],
    image_protocol: Optional[str],
) -> bool:
    return (
        str(image_protocol or "").strip().lower() != "gemini-native"
        and bool(base_url)
        and provider_prefers_openai_compatible(provider_name, base_url)
    )


def build_gemini_image_part(source: str) -> Dict[str, Any]:
    image_bytes, mime_type = read_image_bytes(source)
    return {
        "inlineData": {
            "mimeType": mime_type,
            "data": base64.b64encode(image_bytes).decode("utf-8"),
        }
    }


def normalize_gemini_image_size(image_size: Optional[str]) -> Optional[str]:
    value = str(image_size or "").strip()
    if not value:
        return None

    normalized = value.upper().replace(" ", "")
    alias_map = {
        "512": "0.5K",
        "512PX": "0.5K",
        "0.5K": "0.5K",
        "1K": "1K",
        "2K": "2K",
        "4K": "4K",
    }
    return alias_map.get(normalized, value)


def build_gemini_image_config(
    aspect_ratio: Optional[str],
    image_size: Optional[str],
    model: Optional[str] = None,
    provider_name: Optional[str] = None,
    base_url: Optional[str] = None,
    image_protocol: Optional[str] = None,
) -> Dict[str, Any]:
    image_config: Dict[str, Any] = {}

    if aspect_ratio:
        image_config["aspectRatio"] = aspect_ratio

    normalized_size = normalize_gemini_image_size(image_size)
    if normalized_size and gemini_model_supports_image_size(
        model,
        provider_name=provider_name,
        base_url=base_url,
        image_protocol=image_protocol,
    ):
        image_config["imageSize"] = normalized_size

    return image_config
def gemini_generate_content(
    base_url: Optional[str],
    api_key: str,
    model: str,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    url = build_gemini_api_url(base_url, model)
    return provider_request_json("POST", url, api_key, payload)


def extract_text_from_responses_response(resp: Any) -> str:
    direct = getattr(resp, "output_text", None)
    if isinstance(direct, str) and direct.strip():
        return direct.strip()

    normalized = normalize_provider_response(resp)
    if isinstance(normalized, dict):
        output_text = normalized.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            return output_text.strip()

    texts: List[str] = []

    def walk(value: Any):
        if isinstance(value, dict):
            type_name = str(value.get("type") or "").lower()
            text_value = value.get("text")
            if type_name in ("output_text", "text") and isinstance(text_value, str) and text_value.strip():
                texts.append(text_value.strip())
            for nested in value.values():
                walk(nested)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(normalized)
    return "\n\n".join(texts).strip()


def extract_text_from_gemini_response(resp: Any) -> str:
    normalized = normalize_provider_response(resp)
    candidates = normalized.get("candidates") if isinstance(normalized, dict) else None
    if not isinstance(candidates, list):
        return ""

    texts: List[str] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        content = candidate.get("content")
        if not isinstance(content, dict):
            continue
        parts = content.get("parts")
        if not isinstance(parts, list):
            continue
        for part in parts:
            if not isinstance(part, dict):
                continue
            text_value = part.get("text")
            if isinstance(text_value, str) and text_value.strip():
                texts.append(text_value.strip())

    return "\n\n".join(texts).strip()


def extract_image_from_gemini_response(resp: Any) -> Optional[str]:
    normalized = normalize_provider_response(resp)
    candidates = normalized.get("candidates") if isinstance(normalized, dict) else None
    if not isinstance(candidates, list):
        return None

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        content = candidate.get("content")
        if not isinstance(content, dict):
            continue
        parts = content.get("parts")
        if not isinstance(parts, list):
            continue
        for part in parts:
            if not isinstance(part, dict):
                continue
            inline_data = part.get("inlineData") or part.get("inline_data")
            if isinstance(inline_data, dict):
                data = inline_data.get("data")
                if isinstance(data, str) and data.strip():
                    mime_type = inline_data.get("mimeType") or inline_data.get("mime_type") or "image/png"
                    return f"data:{mime_type};base64,{data.strip()}"
            
            text_value = part.get("text")
            if isinstance(text_value, str) and text_value.strip():
                found = find_first_image_url(text_value)
                if found:
                    return found

    return None
def normalize_generation_image_refs(images: List[str]) -> List[str]:
    refs: List[str] = []
    for raw in images:
        if not isinstance(raw, str):
            continue
        value = raw.strip()
        if not value:
            continue

        # Generations API expects url or b64_json strings. Convert data URLs to raw base64.
        if value.startswith("data:") and "," in value:
            value = value.split(",", 1)[1]

        refs.append(value)
    return refs


def decode_image_reference_to_bytes(image_ref: str) -> bytes:
    value = str(image_ref or "").strip()
    if not value:
        raise ValueError("empty image reference")
    if value.startswith("http://") or value.startswith("https://"):
        with urlopen_with_optional_timeout(value) as res:
            return res.read()

    raw_image = value
    if raw_image.startswith("data:") and "," in raw_image:
        raw_image = raw_image.split(",", 1)[1]
    return base64.b64decode(raw_image)


def decode_image_references_to_bytes(images: List[str]) -> List[bytes]:
    image_bytes: List[bytes] = []
    for index, image_ref in enumerate(images):
        try:
            image_bytes.append(decode_image_reference_to_bytes(image_ref))
        except Exception as decode_err:
            raise Exception(f"第 {index + 1} 张参考图解析失败: {decode_err}")
    return image_bytes


def run_doubao_seedream_generation(
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    image_url: Optional[str] = None,
    seed: Optional[int] = None,
    guidance_scale: Optional[float] = None,
    watermark: Optional[bool] = None,
) -> str:
    submit_url = build_provider_api_url(base_url, "/v1/images/generations?async=true")
    payload: Dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "response_format": "b64_json" if model_prefers_b64_image_response(model) else "url",
    }
    if image_url:
        payload["image"] = image_url
        payload["size"] = "adaptive"
    if seed is not None:
        payload["seed"] = seed
    if guidance_scale is not None:
        payload["guidance_scale"] = guidance_scale
    if watermark is not None:
        payload["watermark"] = watermark

    response = provider_request_json("POST", submit_url, api_key, payload)
    return resolve_image_submission_result(
        response,
        base_url=base_url,
        api_key=api_key,
        debug_label="doubao-seedream.images.generate.async",
    )


def run_async_generation(
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    aspect_ratio: Optional[str] = None,
    image_size: Optional[str] = None,
    images: Optional[List[str]] = None,
) -> str:
    submit_url = build_provider_api_url(base_url, "/images/generations?async=true")
    payload = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "response_format": "url",
    }
    if aspect_ratio:
        payload["aspect_ratio"] = aspect_ratio
    if image_size:
        payload["image_size"] = image_size
    if images:
        payload["image"] = images
    submit_result = provider_request_json("POST", submit_url, api_key, payload)
    task_id = extract_task_id(submit_result)
    if not task_id:
        raise Exception(f"Async generation missing task_id: {submit_result}")
    return poll_async_task(base_url, api_key, task_id, resource="images")


def run_async_edit(
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    image_data: bytes,
    aspect_ratio: Optional[str] = None,
    image_size: Optional[str] = None,
) -> str:
    submit_url = build_provider_api_url(base_url, "/images/edits?async=true")
    submit_result = provider_post_multipart_edit(
        submit_url,
        api_key,
        image_data,
        prompt,
        model,
        aspect_ratio=aspect_ratio,
        image_size=image_size,
    )
    task_id = extract_task_id(submit_result)
    if not task_id:
        raise Exception(f"Async edit missing task_id: {submit_result}")
    return poll_async_task(base_url, api_key, task_id, resource="images")


def run_gpt_image_2_generation(
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    size: str,
    quality: Optional[str] = None,
    images: Optional[List[str]] = None,
) -> str:
    payload: Dict[str, Any] = build_gpt_image_2_generation_payload(
        model=model,
        prompt=prompt,
        size=size,
        quality=quality,
        images=images,
    )
    submit_url = build_provider_api_url(base_url, "/v1/images/generations?async=true")
    try:
        response = provider_request_json("POST", submit_url, api_key, payload)
        return resolve_image_submission_result(
            response,
            base_url=base_url,
            api_key=api_key,
            debug_label="gpt-image-2.images.generate.async",
        )
    except Exception as async_err:
        if not should_fallback_from_async_image_error(async_err):
            raise
        sync_url = build_provider_api_url(base_url, "/v1/images/generations")
        response = provider_request_json("POST", sync_url, api_key, payload)
        return resolve_image_submission_result(
            response,
            base_url=base_url,
            api_key=api_key,
            debug_label="gpt-image-2.images.generate.sync-fallback",
        )


def build_gpt_image_2_generation_payload(
    model: str,
    prompt: str,
    size: str,
    quality: Optional[str] = None,
    images: Optional[List[str]] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "response_format": "url",
    }
    if quality:
        payload["quality"] = quality
    if images:
        payload["image"] = images
    return payload


def should_fallback_from_async_image_error(error: Exception) -> bool:
    message = str(error).lower()
    return (
        "async images task failed" in message
        or "async image task failed" in message
        or "消息流出现异常" in message
        or "stream" in message
    )


def run_gpt_image_2_edit(
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    image_data: Any,
    size: str,
    quality: Optional[str] = None,
) -> str:
    submit_url = build_provider_api_url(base_url, "/v1/images/edits?async=true")
    try:
        response = provider_post_multipart_edit(
            submit_url,
            api_key,
            image_data,
            prompt,
            model,
            size=size,
            quality=quality,
            response_format="url",
        )
        return resolve_image_submission_result(
            response,
            base_url=base_url,
            api_key=api_key,
            debug_label="gpt-image-2.images.edit.async",
        )
    except Exception as async_err:
        if not should_fallback_from_async_image_error(async_err):
            raise
        sync_url = build_provider_api_url(base_url, "/v1/images/edits")
        response = provider_post_multipart_edit(
            sync_url,
            api_key,
            image_data,
            prompt,
            model,
            size=size,
            quality=quality,
            response_format="url",
        )
        return resolve_image_submission_result(
            response,
            base_url=base_url,
            api_key=api_key,
            debug_label="gpt-image-2.images.edit.sync-fallback",
        )


@app.post("/test-provider")
def test_provider_connection(request: TestProviderRequest):
    api_key = (request.api_key or "").strip()
    base_url = normalize_base_url(request.base_url)
    model = (request.model or "gpt-4o").strip()

    if not api_key:
        raise HTTPException(status_code=400, detail="API Key 不能为空")

    start_time = time.perf_counter()
    effective_protocol = resolve_chat_protocol(
        model,
        request.chat_protocol,
        request.reasoning_protocol,
        request.provider_name,
        base_url,
    )

    try:
        if effective_protocol == "openai-responses":
            client = create_openai_client(api_key=api_key, base_url=base_url)
            client.responses.create(model=model, input="ping")
        elif effective_protocol == "gemini-native":
            gemini_generate_content(
                base_url,
                api_key,
                model,
                {
                    "contents": [
                        {
                            "role": "user",
                            "parts": [{"text": "ping"}],
                        }
                    ]
                },
            )
        else:
            client = create_openai_client(api_key=api_key, base_url=base_url)
            client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=1,
                temperature=0,
            )
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        return {
            "ok": True,
            "model": model,
            "protocol": effective_protocol,
            "latencyMs": latency_ms,
            "message": "连接正常，可用于节点执行",
        }
    except Exception as e:
        raw = str(e)
        msg = raw.lower()
        code = "UNKNOWN_ERROR"
        user_message = "连接失败，请检查配置"

        if (
            "401" in msg
            or "unauthorized" in msg
            or "invalid api key" in msg
            or "authentication" in msg
        ):
            code = "AUTH_ERROR"
            user_message = "鉴权失败，请检查 API Key 是否正确"
        elif "model" in msg and ("not found" in msg or "does not exist" in msg):
            code = "MODEL_NOT_FOUND"
            user_message = "模型不可用，请检查模型 ID"
        elif "timeout" in msg or "timed out" in msg:
            code = "TIMEOUT"
            user_message = "连接超时，请稍后重试"
        elif "connection" in msg or "name resolution" in msg or "dns" in msg:
            code = "NETWORK_ERROR"
            user_message = "网络连接失败，请检查 Base URL"

        return {
            "ok": False,
            "code": code,
            "model": model,
            "message": user_message,
            "detail": raw,
        }


@app.post("/test-provider-image")
def test_image_provider_connection(request: TestImageProviderRequest):
    api_key = (request.api_key or "").strip()
    base_url = normalize_base_url(request.base_url)
    model = (request.model or "flux-pro").strip()

    if not api_key:
        raise HTTPException(status_code=400, detail="API Key 不能为空")

    start_time = time.perf_counter()
    effective_protocol = resolve_image_protocol(
        model,
        request.image_protocol,
        request.provider_name,
        base_url,
    )

    try:
        if effective_protocol == "gemini-native":
            response = gemini_generate_content(
                base_url,
                api_key,
                model,
                {
                    "contents": [
                        {
                            "role": "user",
                            "parts": [{"text": "Generate a simple test image."}],
                        }
                    ],
                    "generationConfig": {
                        "responseModalities": ["TEXT", "IMAGE"],
                        "imageConfig": {"aspectRatio": "1:1"},
                    },
                },
            )
            img_payload = extract_image_from_gemini_response(response) or find_first_image_url(response)
            if not img_payload:
                raise Exception(f"Gemini image response missing image payload: {response}")
        else:
            if is_gpt_image_2_model(model):
                run_gpt_image_2_generation(
                    base_url=base_url,
                    api_key=api_key,
                    model=model,
                    prompt="test image",
                    size="1024x1024",
                )
            else:
                client = create_openai_client(api_key=api_key, base_url=base_url)
                client.images.generate(
                    model=model,
                    prompt="test image",
                    n=1,
                    response_format="b64_json" if model_prefers_b64_image_response(model) else "url",
                )
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        return {
            "ok": True,
            "model": model,
            "protocol": effective_protocol,
            "latencyMs": latency_ms,
            "message": "图像模型连接正常",
        }
    except Exception as e:
        raw = str(e)
        msg = raw.lower()
        code = "UNKNOWN_ERROR"
        user_message = "图像模型测试失败"

        if (
            "401" in msg
            or "unauthorized" in msg
            or "invalid api key" in msg
            or "authentication" in msg
        ):
            code = "AUTH_ERROR"
            user_message = "鉴权失败，请检查 API Key 是否正确"
        elif "model" in msg and ("not found" in msg or "does not exist" in msg):
            code = "MODEL_NOT_FOUND"
            user_message = "图像模型不可用，请检查模型 ID"
        elif "timeout" in msg or "timed out" in msg:
            code = "TIMEOUT"
            user_message = "连接超时，请稍后重试"
        elif "connection" in msg or "name resolution" in msg or "dns" in msg:
            code = "NETWORK_ERROR"
            user_message = "网络连接失败，请检查 Base URL"

        return {
            "ok": False,
            "code": code,
            "model": model,
            "message": user_message,
            "detail": raw,
        }


@app.get("/health")
async def health_check():
    return {"status": "ok"}


def extract_prompt(text: str) -> str:
    """Pass-through function to return original text as requested."""
    return text.strip() if text else ""


def collect_image_inputs(image_input: Any) -> List[str]:
    results: List[str] = []
    seen = set()

    def push(value: Any):
        if not isinstance(value, str):
            return
        item = value.strip()
        if not item or item in seen:
            return
        seen.add(item)
        results.append(item)

    def walk(value: Any):
        if value is None:
            return
        if isinstance(value, str):
            push(value)
            return
        if isinstance(value, list):
            for item in value:
                walk(item)
            return
        if isinstance(value, dict):
            file_type = value.get("type")
            if file_type == "image":
                push(value.get("url"))
                push(value.get("data"))
                push(value.get("previewData"))

            for key in ("selectedImages", "image", "images", "referenceImages", "embeddedImages"):
                nested = value.get(key)
                if nested is not None:
                    walk(nested)

    walk(image_input)
    return results


def extract_reference_payload_options(image_input: Any) -> Dict[str, Any]:
    if isinstance(image_input, list):
        for item in image_input:
            options = extract_reference_payload_options(item)
            if options:
                return options
        return {}

    if not isinstance(image_input, dict):
        return {}

    has_reference_fields = any(
        key in image_input
        for key in ("referenceMode", "referenceType", "guidancePrompt", "avoidReplication", "useEditMode")
    )
    if not has_reference_fields:
        return {}

    return {
        "reference_mode": str(image_input.get("referenceMode") or "").strip().lower() or None,
        "reference_type": str(image_input.get("referenceType") or "").strip().lower() or None,
        "avoid_replication": bool(image_input.get("avoidReplication", False)),
        "use_edit_mode": bool(image_input.get("useEditMode", False)),
        "guidance_prompt": str(image_input.get("guidancePrompt") or image_input.get("prompt") or "").strip(),
        "reference_summary": str(image_input.get("summary") or "").strip(),
    }


def extract_primary_image_input(image_input: Any) -> Optional[str]:
    images = collect_image_inputs(image_input)
    return images[0] if images else None


def normalize_prompt_text(text: Any) -> str:
    value = str(text or "").strip()
    if not value:
        return ""

    value = re.sub(r"\n{3,}", "\n\n", value).strip()

    # Collapse simple full duplication: "A\n\nA"
    dup_match = re.match(r"^\s*(.+?)\s*(?:\n\s*)+\1\s*$", value, flags=re.S)
    if dup_match:
        value = dup_match.group(1).strip()

    # Collapse exact half-half duplication: "AA"
    if len(value) % 2 == 0:
        half = len(value) // 2
        left = value[:half].strip()
        right = value[half:].strip()
        if left and left == right:
            value = left

    return value


@app.post("/execute")
def execute_node(request: ExecuteRequest):
    # Collect text inputs from all sources
    text_inputs: List[str] = []
    seen_texts = set()

    def push_text(value: Any):
        if isinstance(value, dict):
            file_type = value.get("type")
            if file_type == "xlsx" and "previewData" in value:
                table_data = value["previewData"]
                meta = value.get("meta", {})
                sheet_name = meta.get("sheetName", "Sheet1")
                row_count = meta.get("rowCount", "?")
                col_count = meta.get("columns", "?")
                
                if isinstance(table_data, list) and table_data:
                    md_rows = []
                    for row in table_data:
                        if isinstance(row, list):
                            md_rows.append("| " + " | ".join(str(cell) if cell is not None else "" for cell in row) + " |")
                    if md_rows:
                        text_val = f"附件 {value.get('name', 'Excel文件')} (表: {sheet_name}, 尺寸: {row_count}x{col_count}):\n" + "\n".join(md_rows)
                        if text_val not in seen_texts:
                            seen_texts.add(text_val)
                            text_inputs.append(text_val)
            elif file_type == "generic" or file_type == "video":
                text_val = f"[多媒体附件: {value.get('name', '未命名')} ({value.get('size', 0)} bytes)]"
                if text_val not in seen_texts:
                    seen_texts.add(text_val)
                    text_inputs.append(text_val)
            return

        if not isinstance(value, str):
            return
        normalized = value.strip()
        if not normalized:
            return
        if normalized in seen_texts:
            return
        seen_texts.add(normalized)
        text_inputs.append(normalized)

    # If the handle name is 'prompt', it's a direct text input
    if "prompt" in request.inputs:
        push_text(request.inputs["prompt"])

    # Generic fallback for any other named handles that might contain text
    for key, value in request.inputs.items():
        if isinstance(key, str) and key.startswith("_"):
            continue
        if key != "prompt" and key != "image":
            push_text(value)

    combined_input = "\n\n".join(text_inputs) or request.config.prompt or ""

    # If there's an image input
    image_input = request.inputs.get("image")
    # For unified standard payload
    if isinstance(image_input, dict):
        image_input = image_input.get("url") or image_input.get("data")

    # For utility nodes that don't need API calls, return early
    if request.node_type in ["INPUT", "IMAGE_UPLOAD", "MULTI_IMAGE_UPLOAD", "FILE_UPLOAD", "OUTPUT"]:
        # Return dict output as is for FileUploadNode, else fallback to string
        out = request.inputs.get("default") or request.inputs.get("image") or combined_input or image_input or ""
        return {"output": out}

    # Initialize dynamic OpenAI client (only for AI nodes)
    api_key = (request.api_key or THIRD_PARTY_API_KEY or "").strip()
    base_url = normalize_base_url(request.base_url or THIRD_PARTY_BASE_URL)

    if not api_key:
        raise HTTPException(
            status_code=400, detail="API Key is missing. 请先配置 API 密钥。"
        )

    dynamic_client = create_openai_client(api_key=api_key, base_url=base_url)

    try:
        if request.node_type == "AI_CHAT":  # Updated to AI_CHAT
            model = request.config.modelId or "gpt-4o"
            messages: Any = []
            raw_prompt = str(request.inputs.get("prompt") or request.config.prompt or "").strip()
            if request.config.systemInstruction:
                messages.append(
                    {"role": "system", "content": request.config.systemInstruction}
                )

            # OpenAI compatible vision format if image exists
            user_content: List[Dict[str, Any]] = [{"type": "text", "text": combined_input}]
            if image_input:
                # Handle array input from Multi-Image Upload node
                images_to_send = []
                if isinstance(image_input, list):
                    images_to_send = image_input
                else:
                    images_to_send = [image_input]

                for raw_img in images_to_send:
                    # Handle case where image input was passed as a FileUpload dict (e.g. from generic file, video, or if url wasn't extracted)
                    img = raw_img
                    if isinstance(raw_img, dict):
                        img = raw_img.get("url") or ""
                    
                    if not isinstance(img, str) or not img.strip():
                        continue
                        
                    # Ensure the image has the proper data URL prefix
                    img_url = img
                    if (
                        img
                        and not img.startswith("http")
                        and not img.startswith("data:")
                    ):
                        img_url = f"data:image/png;base64,{img}"

                    user_content.append(
                        {
                            "type": "image_url",
                            "image_url": {"url": img_url, "detail": "auto"},
                        }
                    )

            effective_chat_protocol = resolve_chat_protocol(
                model,
                request.chat_protocol,
                request.reasoning_protocol,
                request.provider_name,
                base_url,
            )
            messages.append({"role": "user", "content": user_content})
            if effective_chat_protocol == "openai-responses":
                response_parts: List[Dict[str, Any]] = []
                text_prompt = combined_input or raw_prompt or ""
                if text_prompt:
                    response_parts.append({"type": "input_text", "text": text_prompt})
                for part in user_content:
                    if not isinstance(part, dict):
                        continue
                    if part.get("type") != "image_url":
                        continue
                    image_url = part.get("image_url")
                    if not isinstance(image_url, dict):
                        continue
                    image_value = str(image_url.get("url") or "").strip()
                    if image_value:
                        response_parts.append({"type": "input_image", "image_url": image_value})

                response = dynamic_client.responses.create(
                    model=model,
                    input=[{"role": "user", "content": response_parts or [{"type": "input_text", "text": "ping"}]}],
                )
                chat_output = extract_text_from_responses_response(response)
            elif effective_chat_protocol == "gemini-native":
                gemini_parts: List[Dict[str, Any]] = []
                text_prompt = combined_input or raw_prompt or ""
                if text_prompt:
                    gemini_parts.append({"text": text_prompt})
                for part in user_content:
                    if not isinstance(part, dict):
                        continue
                    if part.get("type") != "image_url":
                        continue
                    image_url = part.get("image_url")
                    if not isinstance(image_url, dict):
                        continue
                    image_value = str(image_url.get("url") or "").strip()
                    if image_value:
                        gemini_parts.append(build_gemini_image_part(image_value))

                payload: Dict[str, Any] = {
                    "contents": [
                        {
                            "role": "user",
                            "parts": gemini_parts or [{"text": "ping"}],
                        }
                    ]
                }
                if request.config.systemInstruction:
                    payload["systemInstruction"] = {
                        "parts": [{"text": request.config.systemInstruction}]
                    }

                response = gemini_generate_content(base_url, api_key, model, payload)
                chat_output = extract_text_from_gemini_response(response)
            else:
                response = dynamic_client.chat.completions.create(
                    model=model, messages=messages
                )
                chat_output = response.choices[0].message.content
            return {
                "output": chat_output,
                "meta": {
                    "rawPrompt": raw_prompt or combined_input,
                    "optimizedPrompt": str(chat_output or "").strip(),
                    "modelId": model,
                    "protocol": effective_chat_protocol,
                },
            }

        elif request.node_type == "AI_IMAGE":
            # ── Concurrency guard ────────────────────────────────────────────
            # Refuse new generation requests when MAX_CONCURRENT_IMAGE_TASKS
            # slots are all busy.  This prevents unbounded thread-pool growth
            # and upstream rate-limit pile-ups under high load.
            if not _IMAGE_SEMAPHORE.acquire(blocking=False):
                raise HTTPException(
                    status_code=429,
                    detail="服务器繁忙，生图队列已满，请稍后重试",
                )
            try:
                model = request.config.modelId or "flux-pro"
                # Strict prompt source for IMAGE:
                # If a prompt handle is connected, use only that handle. An empty
                # connected prompt should fail instead of falling back to stale config/meta.
                if "prompt" in request.inputs:
                    prompt_source = request.inputs.get("prompt")
                elif "_raw_prompt" in request.inputs:
                    prompt_source = request.inputs.get("_raw_prompt")
                else:
                    prompt_source = request.config.prompt

                final_prompt = normalize_prompt_text(prompt_source)
                if not final_prompt:
                    raise Exception("AI_IMAGE 缺少提示词：请连接 prompt 插槽或在图像节点中填写提示词")

                prompt_template_enabled = bool(getattr(request.config, "enablePromptTemplate", False))
                prompt_template_key = getattr(request.config, "promptTemplate", "free_mode") if prompt_template_enabled else "free_mode"
                if prompt_template_key != "free_mode" and prompt_template_key in PROMPT_REGISTRY:
                    print(f"DEBUG: Executing Visual Engine Prompt Enhancement with rule: {prompt_template_key}")
                    # Keep prompt-template behavior but avoid hidden extra LLM calls.
                    # This guarantees the actual generation only uses the frontend-selected model.
                    final_prompt = PROMPT_REGISTRY[prompt_template_key] + f"\n\n[USER INPUT]\n{final_prompt}"
                    print(f"DEBUG: Prompt template merged directly (no extra optimizer call), length={len(final_prompt)}")

                aspect_ratio = getattr(request.config, "aspectRatio", "1:1") or "1:1"
                img_size = getattr(request.config, "imageSize", "1K")
                raw_prompt = str(prompt_source or "").strip()
                # Support explicit image pass-through from upstream utility nodes.
                passed_images = request.inputs.get("forwardedImages") or image_input
                reference_options = extract_reference_payload_options(passed_images)
                reference_mode = str(
                    getattr(request.config, "referenceMode", None)
                    or reference_options.get("reference_mode")
                    or ""
                ).strip().lower() or None
                reference_type = str(
                    getattr(request.config, "referenceType", None)
                    or reference_options.get("reference_type")
                    or ""
                ).strip().lower() or None
                avoid_replication = bool(
                    getattr(request.config, "avoidReplication", False)
                    or reference_options.get("avoid_replication", False)
                )
                reference_guidance = str(reference_options.get("guidance_prompt") or "").strip()
                if reference_guidance and reference_guidance not in final_prompt:
                    final_prompt = normalize_prompt_text(final_prompt + "\n\n" + reference_guidance)
                elif avoid_replication and "禁止逐像素复刻参考图" not in final_prompt:
                    final_prompt = normalize_prompt_text(
                        final_prompt
                        + "\n\n请只借鉴参考图方向，不要逐像素复刻，不要复制其中的文字、污渍、背景布局、摆位和细节。"
                    )
                source_image = extract_primary_image_input(passed_images)
                actual_images = collect_image_inputs(passed_images)
                is_doubao_seedream = is_doubao_seedream_model(model)
                is_gpt_image_2 = is_gpt_image_2_model(model)
                gpt_image_2_size = resolve_gpt_image_2_size(aspect_ratio, img_size) if is_gpt_image_2 else None
                gpt_image_2_quality = resolve_gpt_image_2_quality(request.config) if is_gpt_image_2 else None
                effective_aspect_ratio = None if is_doubao_seedream else aspect_ratio
                effective_img_size = None if (is_doubao_seedream or is_gpt_image_2) else (img_size if not actual_images else None)
                config_use_edit_mode = getattr(request.config, "useEditMode", None)
                payload_use_edit_mode = reference_options.get("use_edit_mode")
                if config_use_edit_mode is None and payload_use_edit_mode is None:
                    use_edit_mode = len(actual_images) == 1
                else:
                    use_edit_mode = bool(
                        config_use_edit_mode
                        if config_use_edit_mode is not None
                        else payload_use_edit_mode
                    )
                if len(actual_images) != 1:
                    use_edit_mode = False
                if reference_mode in ("weak", "medium"):
                    use_edit_mode = False
                if reference_type and reference_type != "product":
                    use_edit_mode = False
                if avoid_replication:
                    use_edit_mode = False
                if is_doubao_seedream:
                    # Doubao/Seedream image editing is documented on the generations endpoint,
                    # so keep this model family off the generic images.edit path.
                    use_edit_mode = False
                print(f"DEBUG [IMG ROUTING]: passed_images type={type(passed_images).__name__}, truthy={bool(passed_images)}, value(first100)={str(passed_images)[:100] if passed_images else 'None'}")
                image_meta = {
                    "rawPrompt": raw_prompt or final_prompt,
                    "optimizedPrompt": final_prompt,
                    "sourceImage": source_image,
                    "sourceImageCount": len(actual_images),
                    "modelId": model,
                    "promptTemplate": prompt_template_key,
                    "referenceMode": reference_mode,
                    "referenceType": reference_type,
                    "avoidReplication": avoid_replication,
                    "useEditMode": use_edit_mode,
                    "referenceSummary": reference_options.get("reference_summary"),
                    "requestedImageSize": img_size,
                    "resolvedSize": gpt_image_2_size,
                    "quality": gpt_image_2_quality,
                    "providerNativeImageSizing": "adaptive" if is_doubao_seedream and actual_images else None,
                }
                effective_image_protocol = resolve_image_protocol(
                    model,
                    request.image_protocol,
                    request.provider_name,
                    base_url,
                )
                image_meta["protocol"] = effective_image_protocol
                use_async_image_tasks = provider_supports_async_image_tasks(
                    request.provider_name,
                    base_url,
                    effective_image_protocol,
                )
                image_meta["asyncImageTask"] = use_async_image_tasks or is_gpt_image_2
                print(
                    f"DEBUG: Original Prompt Passed (first 100 chars): {final_prompt[:100]}..."
                )

                if effective_image_protocol == "gemini-native":
                    gemini_image_config = build_gemini_image_config(
                        effective_aspect_ratio,
                        effective_img_size,
                        model,
                        provider_name=request.provider_name,
                        base_url=base_url,
                        image_protocol=request.image_protocol,
                    )
                    image_meta["supportsImageSize"] = gemini_model_supports_image_size(
                        model,
                        provider_name=request.provider_name,
                        base_url=base_url,
                        image_protocol=request.image_protocol,
                    )
                    image_meta["resolvedImageSize"] = gemini_image_config.get("imageSize")
                    gemini_parts: List[Dict[str, Any]] = []
                    for actual_image in actual_images:
                        gemini_parts.append(build_gemini_image_part(actual_image))
                    gemini_parts.append({"text": final_prompt})

                    payload: Dict[str, Any] = {
                        "contents": [
                            {
                                "role": "user",
                                "parts": gemini_parts,
                            }
                        ],
                        "generationConfig": {
                            "responseModalities": ["TEXT", "IMAGE"],
                            "imageConfig": gemini_image_config,
                        },
                    }
                    if request.config.systemInstruction:
                        payload["systemInstruction"] = {
                            "parts": [{"text": request.config.systemInstruction}]
                        }

                    response = gemini_generate_content(base_url, api_key, model, payload)
                    result_output = extract_image_from_gemini_response(response) or find_first_image_url(response)
                    if not result_output:
                        raise Exception(f"Gemini image generation returned no image payload: {response}")

                    localized_output = localize_generated_image_output(result_output)
                    return {"output": build_canonical_image_result(localized_output), "meta": image_meta}

                if is_doubao_seedream:
                    image_url: Optional[str] = None
                    if actual_images:
                        first_image = str(actual_images[0] or "").strip()
                        if not (first_image.startswith("http://") or first_image.startswith("https://")):
                            raise Exception("豆包/即梦图生图专用通道只支持公网图片 URL；本地上传图片暂不支持直接传给该模型。")
                        image_url = first_image

                    seed_value = getattr(request.config, "seed", None)
                    try:
                        resolved_seed = int(seed_value) if seed_value not in (None, "", False) else None
                    except Exception:
                        resolved_seed = None

                    guidance_value = getattr(request.config, "guidanceScale", None)
                    try:
                        resolved_guidance_scale = float(guidance_value) if guidance_value not in (None, "", False) else None
                    except Exception:
                        resolved_guidance_scale = None

                    watermark_value = getattr(request.config, "watermark", None)
                    resolved_watermark = None if watermark_value in (None, "") else bool(watermark_value)

                    result_output = run_doubao_seedream_generation(
                        base_url=base_url,
                        api_key=api_key,
                        model=model,
                        prompt=final_prompt,
                        image_url=image_url,
                        seed=resolved_seed,
                        guidance_scale=resolved_guidance_scale,
                        watermark=resolved_watermark,
                    )
                    localized_output = localize_generated_image_output(result_output)
                    return {"output": build_canonical_image_result(localized_output), "meta": image_meta}

                if is_gpt_image_2:
                    if actual_images and not collect_image_inputs(actual_images):
                        raise Exception("gpt-image-2 图像参考解析失败：未提取到有效图片引用")

                    if actual_images:
                        image_data = decode_image_references_to_bytes(actual_images)
                        result_output = run_gpt_image_2_edit(
                            base_url=base_url,
                            api_key=api_key,
                            model=model,
                            prompt=final_prompt,
                            image_data=image_data if len(image_data) > 1 else image_data[0],
                            size=gpt_image_2_size or "1024x1024",
                            quality=gpt_image_2_quality,
                        )
                    else:
                        result_output = run_gpt_image_2_generation(
                            base_url=base_url,
                            api_key=api_key,
                            model=model,
                            prompt=final_prompt,
                            size=gpt_image_2_size or "1024x1024",
                            quality=gpt_image_2_quality,
                        )

                    localized_output = localize_generated_image_output(result_output)
                    return {"output": build_canonical_image_result(localized_output), "meta": image_meta}

                # Single-submit strategy: each execution issues only one image creation request.
                # If the provider replies with a task_id, we poll that same task instead of
                # submitting a second fallback request.
                if actual_images:
                    print(
                        "DEBUG [IMG ROUTING]: "
                        f"actual_images count={len(actual_images)}, "
                        f"use_edit_mode={use_edit_mode}, "
                        f"reference_mode={reference_mode}, "
                        f"first(80)={actual_images[0][:80] if actual_images else 'EMPTY'}"
                    )

                image_params = {
                }
                if effective_aspect_ratio:
                    image_params["aspect_ratio"] = effective_aspect_ratio
                    image_params["aspectRatio"] = effective_aspect_ratio
                if effective_img_size:
                    image_params["image_size"] = effective_img_size
                    image_params["image_size_level"] = effective_img_size
                    image_params["imageSize"] = effective_img_size
                if is_doubao_seedream and actual_images:
                    image_params["size"] = "adaptive"

                if actual_images:
                    refs = normalize_generation_image_refs(actual_images)
                    if len(refs) > 14:
                        print(f"DEBUG: Multi-image refs exceed 14, truncating to first 14 (got {len(refs)})")
                        refs = refs[:14]

                    if not refs:
                        raise Exception("多图参考解析失败：未提取到有效图片引用")

                    if len(refs) == 1 and use_edit_mode:
                        actual_image = actual_images[0]
                        image_data = b""
                        try:
                            if actual_image.startswith("http://") or actual_image.startswith("https://"):
                                with urlopen_with_optional_timeout(actual_image) as res:
                                    image_data = res.read()
                            else:
                                raw_image = actual_image
                                if raw_image.startswith("data:") and "," in raw_image:
                                    raw_image = raw_image.split(",", 1)[1]
                                image_data = base64.b64decode(raw_image)
                        except Exception as decode_err:
                            raise Exception(f"单图编辑前解析输入图片失败: {decode_err}")

                        extra_body_edit = {
                            **image_params,
                            "image_config": image_params,
                            "imageConfig": image_params,
                            "target_aspect_ratio": aspect_ratio,
                        }
                        print(f"DEBUG: Single-submit Image Edit with model={model} and params: {extra_body_edit}")
                        if use_async_image_tasks:
                            result_output = run_async_edit(
                                base_url=base_url,
                                api_key=api_key,
                                model=model,
                                prompt=final_prompt,
                                image_data=image_data,
                                aspect_ratio=effective_aspect_ratio,
                                image_size=effective_img_size,
                            )
                            localized_output = localize_generated_image_output(result_output)
                            return {"output": build_canonical_image_result(localized_output), "meta": image_meta}

                        try:
                            response = dynamic_client.images.edit(
                                image=("input.png", image_data, "image/png"),
                                model=model,
                                prompt=final_prompt,
                                n=1,
                                response_format="b64_json" if model_prefers_b64_image_response(model) else "url",
                                extra_body=extra_body_edit,
                            )
                            result_output = resolve_image_submission_result(
                                response,
                                base_url=base_url,
                                api_key=api_key,
                                debug_label="images.edit",
                            )
                            print(f"DEBUG: images.edit succeeded, output: {result_output[:80]}...")
                            localized_output = localize_generated_image_output(result_output)
                            return {"output": build_canonical_image_result(localized_output), "meta": image_meta}
                        except Exception as img_err:
                            print(f"DEBUG: images.edit failed: {img_err}")
                            raise Exception(f"Image edit failed: {img_err}")

                    extra_body_img = {**image_params}
                    if is_doubao_seedream:
                        extra_body_img["image"] = refs[0] if len(refs) == 1 else refs
                    else:
                        extra_body_img["image_config"] = image_params
                        extra_body_img["imageConfig"] = image_params
                        extra_body_img["target_aspect_ratio"] = aspect_ratio
                        extra_body_img["image"] = refs
                        extra_body_img["images"] = refs
                    print(f"DEBUG: Single-submit image-referenced Generation with model={model} and params: {extra_body_img}")
                    if use_async_image_tasks:
                        sync_output = run_async_generation(
                            base_url=base_url,
                            api_key=api_key,
                            model=model,
                            prompt=final_prompt,
                            aspect_ratio=effective_aspect_ratio,
                            image_size=effective_img_size,
                            images=refs,
                        )
                        localized_output = localize_generated_image_output(sync_output)
                        return {"output": build_canonical_image_result(localized_output), "meta": image_meta}

                    try:
                        sync_response = dynamic_client.images.generate(
                            model=model,
                            prompt=final_prompt,
                            n=1,
                            response_format="b64_json" if model_prefers_b64_image_response(model) else "url",
                            extra_body=extra_body_img
                        )
                        sync_output = resolve_image_submission_result(
                            sync_response,
                            base_url=base_url,
                            api_key=api_key,
                            debug_label="images.generate(image_refs)",
                        )
                        print(f"DEBUG: image-referenced images.generate succeeded, output: {sync_output[:80]}...")
                        localized_output = localize_generated_image_output(sync_output)
                        return {"output": build_canonical_image_result(localized_output), "meta": image_meta}
                    except Exception as sync_img_err:
                        print(f"DEBUG: image-referenced images.generate failed: {sync_img_err}")
                        raise Exception(f"Image generation with references failed: {sync_img_err}")

                extra_body = {
                    **image_params,
                    "image_config": image_params,
                    "imageConfig": image_params,
                    "target_aspect_ratio": aspect_ratio,
                }
                print(
                    f"DEBUG: Single-submit Image Generation with model={model} and params: {extra_body}"
                )
                if use_async_image_tasks:
                    result_output = run_async_generation(
                        base_url=base_url,
                        api_key=api_key,
                        model=model,
                        prompt=final_prompt,
                        aspect_ratio=effective_aspect_ratio,
                        image_size=effective_img_size,
                    )
                    localized_output = localize_generated_image_output(result_output)
                    return {"output": build_canonical_image_result(localized_output), "meta": image_meta}

                try:
                    response = dynamic_client.images.generate(
                        model=model,
                        prompt=final_prompt,
                        n=1,
                        response_format="b64_json" if model_prefers_b64_image_response(model) else "url",
                        extra_body=extra_body,
                    )
                    result_output = resolve_image_submission_result(
                        response,
                        base_url=base_url,
                        api_key=api_key,
                        debug_label="images.generate",
                    )
                    print(
                        f"DEBUG: images.generate succeeded, output: {result_output[:80]}..."
                    )
                    localized_output = localize_generated_image_output(result_output)
                    return {"output": build_canonical_image_result(localized_output), "meta": image_meta}
                except Exception as gen_err:
                    print(f"DEBUG: images.generate failed: {gen_err}")
                    raise Exception(f"Image generation failed: {gen_err}")
            finally:
                # Always release the semaphore slot, regardless of success or failure.
                _IMAGE_SEMAPHORE.release()

        elif request.node_type == "AI_AUDIO":
            model = request.config.modelId or "suno-v3"
            prompt = combined_input or ""
            if not prompt:
                raise Exception("AI_AUDIO 缺少提示词")
            
            try:
                chat_response = dynamic_client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}]
                )
                res_content = chat_response.choices[0].message.content or ""
                
                url_match = re.search(r"(https?://\S+\.(?:mp3|wav|m4a|mp4)(?:\?\S*)?)", res_content)
                if url_match:
                    return {"output": url_match.group(1), "meta": {"modelId": model, "optimizedPrompt": prompt}}
                md_match = re.search(r"\[.*?\]\((https?://\S+?)\)", res_content)
                if md_match:
                    return {"output": md_match.group(1), "meta": {"modelId": model, "optimizedPrompt": prompt}}
                
                any_match = re.search(r"(https?://\S+)", res_content)
                if any_match:
                     return {"output": any_match.group(1), "meta": {"modelId": model, "optimizedPrompt": prompt}}
                return {"output": res_content, "meta": {"modelId": model}}
            except Exception as audio_err:
                print(f"DEBUG: Audio chat fallback failed: {audio_err}. Attempting async generation...")
                if base_url:
                    submit_url = build_provider_api_url(base_url, "/audio/generations?async=true")
                    payload = {"model": model, "prompt": prompt}
                    try:
                        submit_result = provider_request_json("POST", submit_url, api_key, payload)
                        task_id = extract_task_id(submit_result)
                        if task_id:
                            async_url = poll_async_task(base_url, api_key, task_id, resource="audio")
                            return {"output": async_url, "meta": {"modelId": model}}
                        else:
                            return {"output": str(submit_result), "meta": {"modelId": model}}
                    except Exception as e:
                        raise Exception(f"AI_AUDIO 生成失败: {e}")
                raise Exception(f"AI_AUDIO failed: {audio_err}")

        elif request.node_type == "AI_VIDEO":
            model = request.config.modelId or "veo"
            prompt = combined_input or ""
            if not prompt:
                raise Exception("AI_VIDEO 缺少提示词")

            aspect_ratio = getattr(request.config, "aspectRatio", None)
            duration = getattr(request.config, "duration", None)

            refs: List[str] = []
            if image_input:
                if isinstance(image_input, list):
                    refs = normalize_generation_image_refs([img for img in image_input if isinstance(img, str) and img.strip()])
                elif isinstance(image_input, str) and image_input.strip():
                    refs = normalize_generation_image_refs([image_input])

            # Strategy 1: Attempt direct submission to unified video endpoint
            if base_url:
                # Based on 404 error message, the following endpoints are often valid:
                # 1. /v2/videos/generations
                # 2. /v1/video/generations (singular)
                # 3. /v1/images/generations (some providers route video through image API)
                # 4. /videos/generations (OpenAI compatible plural)
                probe_paths = [
                    "/v2/videos/generations",
                    "/v1/video/generations",
                    "/v1/images/generations",
                    "/videos/generations?async=true",
                    "/video/generations?async=true"
                ]
                
                for path in probe_paths:
                    try:
                        submit_url = build_provider_api_url(base_url, path)
                        payload: Dict[str, Any] = {
                            "model": model, 
                            "prompt": prompt,
                            "images": refs if refs else None,
                            "image": refs if refs else None,
                            "aspect_ratio": aspect_ratio,
                        }
                        # ... (removed None values logic handled below)
                        payload = {k: v for k, v in payload.items() if v is not None}
                        
                        if duration:
                            payload["duration"] = str(duration)

                        # sora-2-pro supports HD mode
                        hd = getattr(request.config, "hd", None)
                        if hd is not None:
                            payload["hd"] = bool(hd)

                        # Veo models support enhance_prompt and enable_upsample
                        if model and "veo" in model.lower():
                            payload["enhance_prompt"] = True
                            payload["enable_upsample"] = True

                        print(f"DEBUG: AI_VIDEO probing {submit_url} ...")
                        submit_result = provider_request_json("POST", submit_url, api_key, payload)
                        
                        # Handle async task response
                        task_id = extract_task_id(submit_result)
                        if task_id:
                            print(f"DEBUG: AI_VIDEO task created: {task_id}")
                            # Determine polling path based on creation path
                            p_path = None
                            if "/v2/videos/generations" in path:
                                p_path = f"/v2/videos/generations/{task_id}"
                            elif "images" in path:
                                p_path = f"/images/tasks/{task_id}"
                            elif "/v1/video/generations" in path:
                                p_path = f"/v1/video/tasks/{task_id}"
                            
                            async_url = poll_async_task(base_url, api_key, task_id, polling_path=p_path)
                            return {"output": async_url, "meta": {"modelId": model, "sourceImageCount": len(refs), "via": path}}
                        
                        # If no task_id but result contains a URL directly (sync response)
                        potential_url = find_first_image_url(submit_result)
                        if potential_url:
                            return {"output": potential_url, "meta": {"modelId": model, "via": path}}
                            
                    except Exception as e:
                        print(f"DEBUG: AI_VIDEO probe failed for {path}: {e}")
                        continue

                print("DEBUG: All direct paths failed, attempting chat fallback...")

            # Strategy 2: Chat Completions fallback (Very common for middleware providers routing Sora/Runway)
            try:
                print(f"DEBUG: AI_VIDEO falling back to chat.completions for {model}")
                # For Sora2 Chat format, sometimes params are in prompt prefix
                final_chat_prompt = prompt
                if aspect_ratio or duration:
                    prefix = f"({aspect_ratio or 'default'}, {duration or '10'}s) "
                    final_chat_prompt = prefix + prompt

                chat_messages = []
                user_content: List[Dict[str, Any]] = [{"type": "text", "text": final_chat_prompt}]
                for ref in refs:
                    img_url = ref
                    if not ref.startswith("http"):
                        img_url = f"data:image/png;base64,{ref}"
                    user_content.append({"type": "image_url", "image_url": {"url": img_url}})
                
                chat_messages.append({"role": "user", "content": user_content})

                chat_response = dynamic_client.chat.completions.create(
                    model=model,
                    messages=chat_messages
                )
                res_content = chat_response.choices[0].message.content or ""
                print(f"DEBUG: AI_VIDEO chat fallback response: {res_content[:100]}...")

                # Extract URL from response (Markdown or plain)
                url_match = re.search(r"(https?://\S+\.(?:mp4|webm|mov|m4v)(?:\?\S*)?)", res_content, re.I)
                if not url_match:
                    url_match = re.search(r"!\[.*?\]\((https?://\S+?)\)", res_content) or re.search(r"\[.*?\]\((https?://\S+?)\)", res_content)
                
                if url_match:
                    return {"output": url_match.group(1), "meta": {"modelId": model, "via": "chat_fallback"}}
                
                # If it looks like a task ID or success message, try to find any link
                any_link = re.search(r"(https?://\S+)", res_content)
                if any_link:
                    return {"output": any_link.group(1), "meta": {"modelId": model}}

                return {"output": res_content, "meta": {"modelId": model, "warning": "raw_response"}}
            except Exception as chat_err:
                print(f"DEBUG: AI_VIDEO chat fallback also failed: {chat_err}")
                raise Exception(f"AI_VIDEO 所有生成策略均已失败: {chat_err}")
        else:
            return {"output": combined_input}

    except HTTPException:
        # Re-raise FastAPI exceptions (e.g. 429 rate-limit) unchanged so they
        # are not swallowed and re-wrapped as 500 by the generic handler below.
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    # Honor the hosting platform's assigned port when running in production.
    uvicorn.run(app, host="0.0.0.0", port=PORT)
