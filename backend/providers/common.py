import json
import http.client
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

try:
    from ..config import (
        ASYNC_TASK_TIMEOUT_SECONDS,
        HTTP_REQUEST_MAX_RETRIES,
        HTTP_REQUEST_TIMEOUT_SECONDS,
    )
except ImportError:
    from config import (
        ASYNC_TASK_TIMEOUT_SECONDS,
        HTTP_REQUEST_MAX_RETRIES,
        HTTP_REQUEST_TIMEOUT_SECONDS,
    )


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


def urlopen_with_optional_timeout(request_or_url: Any):
    timeout = HTTP_REQUEST_TIMEOUT_SECONDS if HTTP_REQUEST_TIMEOUT_SECONDS is not None else 90.0

    if isinstance(request_or_url, str):
        req = urllib.request.Request(request_or_url, headers={"User-Agent": USER_AGENT})
        return urllib.request.urlopen(req, timeout=timeout)

    return urllib.request.urlopen(request_or_url, timeout=timeout)


def should_retry_http_status(status_code: int) -> bool:
    return status_code in (408, 409, 425, 429, 500, 502, 503, 504)


def should_retry_network_error(error: Exception) -> bool:
    message = str(error).lower()
    return (
        isinstance(error, (urllib.error.URLError, TimeoutError, http.client.RemoteDisconnected, ConnectionResetError, BrokenPipeError))
        or "remote end closed connection" in message
        or "connection reset" in message
        or "temporarily unavailable" in message
        or "timed out" in message
        or "timeout" in message
    )


def normalize_base_url(raw: Optional[str]) -> Optional[str]:
    base_url = (raw or "").strip()
    if not base_url:
        return None

    if not base_url.startswith("http"):
        base_url = f"https://{base_url}"

    base_url = base_url.rstrip("/")

    suffixes = [
        "/chat/completions",
        "/completions",
        "/v1/chat/completions",
        "/v1/completions",
        "/pg/chat/completions",
        "/v1/images/generations",
        "/images/generations",
        "/v1/audio/generations",
        "/audio/generations",
        "/v1/videos/generations",
        "/videos/generations",
        "/v1/images/edits",
        "/images/edits",
    ]
    for suffix in suffixes:
        if base_url.endswith(suffix):
            base_url = base_url[: -len(suffix)]
            break

    gemini_suffix_match = re.search(
        r"/v1beta/models/[^/]+:(?:generateContent|streamGenerateContent)$",
        base_url,
        flags=re.I,
    )
    if gemini_suffix_match:
        base_url = base_url[: gemini_suffix_match.start()]

    if base_url.endswith("/v1beta"):
        base_url = base_url[:-7]

    return base_url


def build_provider_api_url(base_url: Optional[str], endpoint_path: str) -> str:
    if not base_url:
        raise ValueError("Base URL is required for API call")

    normalized = base_url.rstrip("/")

    if endpoint_path.startswith("/v"):
        if normalized.endswith("/v1") and endpoint_path.startswith("/v2"):
            return normalized[:-3] + endpoint_path
        if normalized.endswith("/v1") and endpoint_path.startswith("/v1"):
            return normalized[:-3] + endpoint_path
        if "/v" in normalized[-4:]:
            return normalized.rsplit("/", 1)[0] + endpoint_path
        return f"{normalized}{endpoint_path}"

    if normalized.endswith("/v1"):
        return f"{normalized}{endpoint_path}"
    return f"{normalized}/v1{endpoint_path}"


def normalize_protocol_name(protocol: Optional[str], default: str = "auto") -> str:
    value = str(protocol or "").strip().lower()
    return value or default


def looks_like_gemini_model(model: Optional[str]) -> bool:
    value = str(model or "").strip().lower()
    return "gemini" in value


def detect_provider_family(provider_name: Optional[str], base_url: Optional[str]) -> str:
    fingerprint = f"{provider_name or ''} {base_url or ''}".strip().lower()
    if "yunwu" in fingerprint:
        return "yunwu"
    if "bltcy" in fingerprint or "gpt-best" in fingerprint or "gptbest" in fingerprint:
        return "bltcy"
    return "generic"


def provider_prefers_openai_compatible(provider_name: Optional[str], base_url: Optional[str]) -> bool:
    return detect_provider_family(provider_name, base_url) in {"bltcy", "yunwu"}


def looks_like_reasoning_model(model: Optional[str]) -> bool:
    value = str(model or "").strip().lower()
    if not value:
        return False

    if re.search(r"(^|[-_])o[1345]([-.]|$)", value):
        return True

    reasoning_keywords = (
        "reason",
        "thinking",
        "think",
        "r1",
        "gpt-5",
        "deepseek-r1",
        "deepseek-v3.1",
        "claude-3.7",
        "claude-4",
        "sonnet-4",
        "opus-4",
    )
    if any(keyword in value for keyword in reasoning_keywords):
        return True

    return looks_like_gemini_model(model) and "pro" in value


def resolve_chat_protocol(
    model: Optional[str],
    chat_protocol: Optional[str],
    reasoning_protocol: Optional[str],
    provider_name: Optional[str] = None,
    base_url: Optional[str] = None,
) -> str:
    resolved_chat = normalize_protocol_name(chat_protocol, default="auto")
    resolved_reasoning = normalize_protocol_name(reasoning_protocol, default="auto")
    prefer_openai_compatible = provider_prefers_openai_compatible(provider_name, base_url)

    if looks_like_reasoning_model(model) and resolved_reasoning != "inherit-chat":
        if resolved_reasoning == "auto":
            if looks_like_gemini_model(model) and not prefer_openai_compatible:
                return "gemini-native"
            return "openai-responses"
        return resolved_reasoning

    if resolved_chat == "auto":
        if looks_like_gemini_model(model) and not prefer_openai_compatible:
            return "gemini-native"
        return "openai-chat"
    return resolved_chat


def resolve_image_protocol(
    model: Optional[str],
    image_protocol: Optional[str],
    provider_name: Optional[str] = None,
    base_url: Optional[str] = None,
) -> str:
    resolved = normalize_protocol_name(image_protocol, default="auto")
    if resolved == "auto":
        if looks_like_gemini_model(model) and not provider_prefers_openai_compatible(provider_name, base_url):
            return "gemini-native"
        return "openai-images"
    return resolved


def build_gemini_api_url(base_url: Optional[str], model: str, stream: bool = False) -> str:
    normalized = normalize_base_url(base_url)
    if not normalized:
        raise ValueError("Base URL is required for Gemini API call")

    normalized = normalized.rstrip("/")
    for suffix in ("/v1beta", "/v1alpha", "/v1"):
        if normalized.endswith(suffix):
            normalized = normalized[: -len(suffix)]
            break

    action = "streamGenerateContent" if stream else "generateContent"
    model_id = urllib.parse.quote(str(model or "").strip(), safe=":_-.")
    return f"{normalized}/v1beta/models/{model_id}:{action}"


def provider_request_json(
    method: str,
    url: str,
    api_key: str,
    payload: Optional[Dict[str, Any]] = None,
    extra_headers: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
    }
    if extra_headers:
        headers.update(extra_headers)

    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")

    attempts = max(1, HTTP_REQUEST_MAX_RETRIES + 1)
    last_error: Optional[Exception] = None

    for attempt in range(attempts):
        request = urllib.request.Request(url=url, data=data, headers=headers, method=method)
        try:
            with urlopen_with_optional_timeout(request) as response:
                body = response.read().decode("utf-8", errors="ignore")
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            try:
                parsed = json.loads(body) if body else {}
            except Exception:
                parsed = {"message": body}
            if attempt < attempts - 1 and should_retry_http_status(e.code):
                time.sleep(min(2 ** attempt, 3))
                continue
            raise Exception(f"HTTP {e.code}: {parsed}")
        except (urllib.error.URLError, TimeoutError, http.client.RemoteDisconnected, ConnectionResetError, BrokenPipeError) as e:
            last_error = e
            if attempt < attempts - 1 and should_retry_network_error(e):
                time.sleep(min(2 ** attempt, 3))
                continue
            raise Exception(f"Network request failed: {e}")

    raise Exception(f"Network request failed: {last_error}")


def provider_post_multipart_edit(
    url: str,
    api_key: str,
    image_data: Any,
    prompt: str,
    model: str,
    aspect_ratio: Optional[str] = None,
    image_size: Optional[str] = None,
    size: Optional[str] = None,
    quality: Optional[str] = None,
    response_format: Optional[str] = None,
) -> Dict[str, Any]:
    boundary = f"----AICanvas{int(time.time() * 1000)}"
    line = b"\r\n"

    image_items = image_data if isinstance(image_data, list) else [image_data]
    image_items = [item for item in image_items if isinstance(item, (bytes, bytearray)) and item]
    if not image_items:
        raise Exception("Multipart edit requires at least one image")

    def guess_image_mime(data: bytes) -> str:
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if data.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
            return "image/webp"
        if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
            return "image/gif"
        return "image/png"

    body_parts: List[bytes] = []
    body_parts.append(f"--{boundary}".encode("utf-8"))
    body_parts.append(b'Content-Disposition: form-data; name="prompt"')
    body_parts.append(b"")
    body_parts.append(prompt.encode("utf-8"))

    body_parts.append(f"--{boundary}".encode("utf-8"))
    body_parts.append(b'Content-Disposition: form-data; name="model"')
    body_parts.append(b"")
    body_parts.append(model.encode("utf-8"))

    if aspect_ratio:
        body_parts.append(f"--{boundary}".encode("utf-8"))
        body_parts.append(b'Content-Disposition: form-data; name="aspect_ratio"')
        body_parts.append(b"")
        body_parts.append(aspect_ratio.encode("utf-8"))

    if image_size:
        body_parts.append(f"--{boundary}".encode("utf-8"))
        body_parts.append(b'Content-Disposition: form-data; name="image_size"')
        body_parts.append(b"")
        body_parts.append(image_size.encode("utf-8"))

    for field_name, field_value in (
        ("size", size),
        ("quality", quality),
        ("response_format", response_format),
    ):
        if not field_value:
            continue
        body_parts.append(f"--{boundary}".encode("utf-8"))
        body_parts.append(f'Content-Disposition: form-data; name="{field_name}"'.encode("utf-8"))
        body_parts.append(b"")
        body_parts.append(str(field_value).encode("utf-8"))

    for index, item in enumerate(image_items):
        binary = bytes(item)
        mime_type = guess_image_mime(binary)
        ext = mime_type.split("/", 1)[1].replace("jpeg", "jpg")
        body_parts.append(f"--{boundary}".encode("utf-8"))
        body_parts.append(
            f'Content-Disposition: form-data; name="image"; filename="input-{index + 1}.{ext}"'.encode("utf-8")
        )
        body_parts.append(f"Content-Type: {mime_type}".encode("utf-8"))
        body_parts.append(b"")
        body_parts.append(binary)

    body_parts.append(f"--{boundary}--".encode("utf-8"))
    body_parts.append(b"")

    body = line.join(body_parts)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "User-Agent": USER_AGENT,
    }

    attempts = max(1, HTTP_REQUEST_MAX_RETRIES + 1)
    last_error: Optional[Exception] = None

    for attempt in range(attempts):
        request = urllib.request.Request(url=url, data=body, headers=headers, method="POST")
        try:
            with urlopen_with_optional_timeout(request) as response:
                text = response.read().decode("utf-8", errors="ignore")
                return json.loads(text) if text else {}
        except urllib.error.HTTPError as e:
            body_text = e.read().decode("utf-8", errors="ignore")
            if attempt < attempts - 1 and should_retry_http_status(e.code):
                time.sleep(min(2 ** attempt, 3))
                continue
            raise Exception(f"HTTP {e.code}: {body_text}")
        except (urllib.error.URLError, TimeoutError, http.client.RemoteDisconnected, ConnectionResetError, BrokenPipeError) as e:
            last_error = e
            if attempt < attempts - 1 and should_retry_network_error(e):
                time.sleep(min(2 ** attempt, 3))
                continue
            raise Exception(f"Network request failed: {e}")

    raise Exception(f"Network request failed: {last_error}")


def normalize_provider_response(resp: Any) -> Any:
    if hasattr(resp, "model_dump"):
        try:
            return resp.model_dump()
        except Exception:
            return resp
    return resp


def find_first_image_url(obj: Any) -> Optional[str]:
    if isinstance(obj, str):
        value = obj.strip()
        if not value:
            return None

        if "{" in value and "}" in value:
            json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", value, flags=re.S | re.I)
            raw_json_str = json_match.group(1) if json_match else value
            cleaned_json_str = raw_json_str.strip()
            if cleaned_json_str.startswith("{") and cleaned_json_str.endswith("}"):
                try:
                    parsed = json.loads(cleaned_json_str)
                    if isinstance(parsed, dict):
                        found = find_first_image_url(parsed)
                        if found:
                            return found
                except Exception:
                    pass

        value = value.replace("\\/", "/")
        if value.startswith("http://") or value.startswith("https://") or value.startswith("data:image/"):
            return value
        match = re.search(r"https?://[^\s\"'<>]+", value)
        if match:
            return match.group(0).replace("\\/", "/").rstrip("),.;")

        md_img_match = re.search(r"!\[.*?\]\((https?://\S+?)\)", value)
        if md_img_match:
            return md_img_match.group(1).replace("\\/", "/").rstrip("),.;")

        return None

    if isinstance(obj, dict):
        for key in ["url", "output", "image_url", "imageUrl", "src", "result"]:
            found = find_first_image_url(obj.get(key))
            if found:
                return found
        for key in ["b64_json", "b64", "image_base64"]:
            val = obj.get(key)
            if isinstance(val, str) and val.strip():
                raw_val = val.strip().replace("\\/", "/")
                if raw_val.startswith("data:image/"):
                    return raw_val
                return f"data:image/png;base64,{raw_val}"
        for value in obj.values():
            found = find_first_image_url(value)
            if found:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = find_first_image_url(item)
            if found:
                return found
    return None


def extract_task_id(resp: Any) -> Optional[str]:
    resp = normalize_provider_response(resp)
    if not isinstance(resp, dict):
        return None

    direct = resp.get("task_id")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()

    data = resp.get("data")
    if isinstance(data, str) and data.strip():
        return data.strip()
    if isinstance(data, dict):
        tid = data.get("task_id")
        if isinstance(tid, str) and tid.strip():
            return tid.strip()
    return None


def get_task_status(resp: Dict[str, Any]) -> str:
    data = resp.get("data") if isinstance(resp, dict) else None
    status = None
    if isinstance(data, dict):
        status = data.get("status")
    if not status and isinstance(resp, dict):
        status = resp.get("status")
    return str(status or "").upper()


def get_fail_reason(resp: Dict[str, Any]) -> str:
    data = resp.get("data") if isinstance(resp, dict) else None
    if isinstance(data, dict):
        reason = data.get("fail_reason") or data.get("message")
        if reason:
            return str(reason)
    return str(resp.get("message") or "") if isinstance(resp, dict) else ""


def poll_async_task(
    base_url: str,
    api_key: str,
    task_id: str,
    resource: str = "images",
    polling_path: Optional[str] = None,
) -> str:
    if polling_path:
        path = polling_path.replace("{task_id}", task_id)
    else:
        path = f"/{resource}/tasks/{task_id}"

    query_url = build_provider_api_url(base_url, path)
    max_wait_seconds = ASYNC_TASK_TIMEOUT_SECONDS
    interval_seconds = 2
    start = time.time()

    while True:
        try:
            result = provider_request_json("GET", query_url, api_key)
        except Exception as e:
            message = str(e).lower()
            is_transient_timeout = (
                "timed out" in message
                or "timeout" in message
                or "temporarily unavailable" in message
                or "connection reset" in message
                or "remote end closed connection" in message
            )
            if not is_transient_timeout:
                raise
            if max_wait_seconds is not None and (time.time() - start >= max_wait_seconds):
                raise Exception(f"Async {resource} task polling timeout: {e}")
            time.sleep(interval_seconds)
            continue
        status = get_task_status(result)

        if status == "SUCCESS":
            url = find_first_image_url(result)
            if url:
                return url
            raise Exception(f"Async task succeeded but no URL found: {result}")

        if status in ("FAILURE", "FAIL", "FAILED"):
            reason = get_fail_reason(result)
            trace_id = ""
            data = result.get("data") if isinstance(result, dict) else None
            if isinstance(data, dict):
                trace_id = str(data.get("traceid") or data.get("trace_id") or "").strip()
            trace_suffix = f" (traceid: {trace_id})" if trace_id and trace_id not in str(reason) else ""
            raise Exception(f"Async {resource} task failed: {reason or result}{trace_suffix}")

        if max_wait_seconds is not None and (time.time() - start >= max_wait_seconds):
            raise Exception(f"Async {resource} task timeout (waited {int(max_wait_seconds)}s)")

        time.sleep(interval_seconds)


def resolve_image_submission_result(
    resp: Any,
    *,
    base_url: Optional[str],
    api_key: str,
    debug_label: str,
    polling_path: Optional[str] = None,
) -> str:
    normalized = normalize_provider_response(resp)
    direct_output = find_first_image_url(normalized)
    if direct_output:
        return direct_output

    task_id = extract_task_id(normalized)
    if task_id:
        if not base_url:
            raise Exception(f"{debug_label} returned task_id but base_url is missing")
        print(f"DEBUG: {debug_label} accepted async task {task_id}, polling existing task...")
        return poll_async_task(
            base_url,
            api_key,
            task_id,
            resource="images",
            polling_path=polling_path,
        )

    raise Exception(f"{debug_label} returned no image URL, base64 payload, or task_id: {normalized}")
