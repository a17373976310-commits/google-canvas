from __future__ import annotations

import os
import json
import secrets
import sqlite3
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field


APP_NAME = "AWEI License Server"
DB_PATH = Path(os.getenv("LICENSE_DB_PATH", "license_server.db"))
ADMIN_TOKEN = os.getenv("LICENSE_ADMIN_TOKEN", "change-me-now")
LEASE_HOURS = int(os.getenv("LICENSE_LEASE_HOURS", "24"))
MODEL_HEALTH_WINDOW_HOURS = int(os.getenv("MODEL_HEALTH_WINDOW_HOURS", "5"))
MODEL_HEALTH_BUCKET_MINUTES = int(os.getenv("MODEL_HEALTH_BUCKET_MINUTES", "5"))
MIN_RUN_CREDITS = int(os.getenv("LICENSE_MIN_RUN_CREDITS", "10"))
EXECUTE_BACKEND_URL = os.getenv("LICENSE_EXECUTE_BACKEND_URL", "http://127.0.0.1:8000/execute")
EXECUTE_BACKEND_TIMEOUT_SECONDS = float(os.getenv("LICENSE_EXECUTE_BACKEND_TIMEOUT_SECONDS", "300"))
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("LICENSE_CORS_ORIGINS", "*").split(",")
    if origin.strip()
]


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_dt(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid datetime format") from exc
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def compare_versions(left: str, right: str) -> int:
    def parts(value: str) -> list[int]:
        result: list[int] = []
        for item in value.split("."):
            digits = "".join(ch for ch in item if ch.isdigit())
            result.append(int(digits or "0"))
        return (result + [0, 0, 0])[:3]

    a = parts(left)
    b = parts(right)
    return (a > b) - (a < b)


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row else None


def lease_until_iso() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=LEASE_HOURS)).replace(microsecond=0).isoformat()


def normalize_nickname(value: str) -> str:
    nickname = (value or "").strip()
    if len(nickname) > 4:
        raise HTTPException(status_code=400, detail="Nickname must be 4 characters or less")
    return nickname


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    if not secrets.compare_digest(x_admin_token or "", ADMIN_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid admin token")


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS licenses (
              license_key TEXT PRIMARY KEY,
              customer_name TEXT NOT NULL,
              contact TEXT DEFAULT '',
              expires_at TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'enabled',
              max_devices INTEGER NOT NULL DEFAULT 1,
              notes TEXT DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS devices (
              device_id TEXT PRIMARY KEY,
              license_key TEXT NOT NULL,
              nickname TEXT DEFAULT '',
              hostname TEXT DEFAULT '',
              os_name TEXT DEFAULT '',
              app_version TEXT DEFAULT '',
              status TEXT NOT NULL DEFAULT 'pending',
              note TEXT DEFAULT '',
              first_seen TEXT NOT NULL,
              approved_at TEXT DEFAULT '',
              last_seen TEXT NOT NULL,
              FOREIGN KEY (license_key) REFERENCES licenses(license_key)
            );

            CREATE TABLE IF NOT EXISTS app_version (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              latest_version TEXT NOT NULL DEFAULT '1.0.0',
              min_version TEXT NOT NULL DEFAULT '1.0.0',
              download_url TEXT DEFAULT '',
              release_notes TEXT DEFAULT '',
              force_update INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_version_history (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              latest_version TEXT NOT NULL DEFAULT '1.0.0',
              min_version TEXT NOT NULL DEFAULT '1.0.0',
              download_url TEXT DEFAULT '',
              release_notes TEXT DEFAULT '',
              force_update INTEGER NOT NULL DEFAULT 0,
              is_current INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS announcements (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              title TEXT NOT NULL,
              body TEXT NOT NULL,
              kind TEXT NOT NULL DEFAULT 'normal',
              scope_license_key TEXT DEFAULT '',
              is_active INTEGER NOT NULL DEFAULT 1,
              pinned INTEGER NOT NULL DEFAULT 0,
              start_at TEXT DEFAULT '',
              end_at TEXT DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS model_providers (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              group_name TEXT NOT NULL DEFAULT 'General',
              provider_type TEXT NOT NULL DEFAULT 'openai-compatible',
              base_url TEXT NOT NULL DEFAULT '',
              api_key_cipher TEXT NOT NULL DEFAULT '',
              supported_models TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'enabled',
              priority INTEGER NOT NULL DEFAULT 100,
              cost_multiplier REAL NOT NULL DEFAULT 1.0,
              notes TEXT DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS model_routes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              model_id TEXT NOT NULL,
              display_name TEXT DEFAULT '',
              model_group TEXT NOT NULL DEFAULT 'chat',
              provider_id INTEGER NOT NULL,
              route_name TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'enabled',
              weight INTEGER NOT NULL DEFAULT 100,
              token_cost INTEGER NOT NULL DEFAULT 0,
              notes TEXT DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(provider_id) REFERENCES model_providers(id)
            );

            CREATE TABLE IF NOT EXISTS model_call_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              route_id INTEGER,
              provider_id INTEGER,
              license_key TEXT DEFAULT '',
              device_id TEXT DEFAULT '',
              model_id TEXT NOT NULL,
              model_group TEXT DEFAULT '',
              node_type TEXT DEFAULT '',
              success INTEGER NOT NULL DEFAULT 0,
              latency_ms INTEGER NOT NULL DEFAULT 0,
              error_code TEXT DEFAULT '',
              error_message TEXT DEFAULT '',
              tokens_charged INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS credit_accounts (
              license_key TEXT PRIMARY KEY,
              balance INTEGER NOT NULL DEFAULT 0,
              reserved_balance INTEGER NOT NULL DEFAULT 0,
              lifetime_granted INTEGER NOT NULL DEFAULT 0,
              lifetime_spent INTEGER NOT NULL DEFAULT 0,
              status TEXT NOT NULL DEFAULT 'enabled',
              updated_at TEXT NOT NULL,
              FOREIGN KEY(license_key) REFERENCES licenses(license_key)
            );

            CREATE TABLE IF NOT EXISTS credit_transactions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              license_key TEXT NOT NULL,
              amount INTEGER NOT NULL,
              reserved_amount INTEGER NOT NULL DEFAULT 0,
              settled_amount INTEGER NOT NULL DEFAULT 0,
              transaction_type TEXT NOT NULL DEFAULT 'adjustment',
              status TEXT NOT NULL DEFAULT 'settled',
              reason TEXT NOT NULL DEFAULT '',
              route_id INTEGER,
              device_id TEXT DEFAULT '',
              model_id TEXT DEFAULT '',
              model_group TEXT DEFAULT '',
              node_type TEXT DEFAULT '',
              request_id TEXT DEFAULT '',
              metadata_json TEXT DEFAULT '',
              updated_at TEXT DEFAULT '',
              created_at TEXT NOT NULL
            );
            """
        )
        device_columns = {
            row["name"]
            for row in db.execute("PRAGMA table_info(devices)").fetchall()
        }
        if "nickname" not in device_columns:
            db.execute("ALTER TABLE devices ADD COLUMN nickname TEXT DEFAULT ''")
        if "approved_at" not in device_columns:
            db.execute("ALTER TABLE devices ADD COLUMN approved_at TEXT DEFAULT ''")
        announcement_columns = {
            row["name"]
            for row in db.execute("PRAGMA table_info(announcements)").fetchall()
        }
        if "deleted_at" not in announcement_columns:
            db.execute("ALTER TABLE announcements ADD COLUMN deleted_at TEXT DEFAULT ''")
        credit_account_columns = {
            row["name"]
            for row in db.execute("PRAGMA table_info(credit_accounts)").fetchall()
        }
        for column_name, column_sql in {
            "reserved_balance": "ALTER TABLE credit_accounts ADD COLUMN reserved_balance INTEGER NOT NULL DEFAULT 0",
            "lifetime_granted": "ALTER TABLE credit_accounts ADD COLUMN lifetime_granted INTEGER NOT NULL DEFAULT 0",
            "lifetime_spent": "ALTER TABLE credit_accounts ADD COLUMN lifetime_spent INTEGER NOT NULL DEFAULT 0",
        }.items():
            if column_name not in credit_account_columns:
                db.execute(column_sql)
        credit_transaction_columns = {
            row["name"]
            for row in db.execute("PRAGMA table_info(credit_transactions)").fetchall()
        }
        for column_name, column_sql in {
            "reserved_amount": "ALTER TABLE credit_transactions ADD COLUMN reserved_amount INTEGER NOT NULL DEFAULT 0",
            "settled_amount": "ALTER TABLE credit_transactions ADD COLUMN settled_amount INTEGER NOT NULL DEFAULT 0",
            "transaction_type": "ALTER TABLE credit_transactions ADD COLUMN transaction_type TEXT NOT NULL DEFAULT 'adjustment'",
            "status": "ALTER TABLE credit_transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'settled'",
            "device_id": "ALTER TABLE credit_transactions ADD COLUMN device_id TEXT DEFAULT ''",
            "model_id": "ALTER TABLE credit_transactions ADD COLUMN model_id TEXT DEFAULT ''",
            "model_group": "ALTER TABLE credit_transactions ADD COLUMN model_group TEXT DEFAULT ''",
            "node_type": "ALTER TABLE credit_transactions ADD COLUMN node_type TEXT DEFAULT ''",
            "request_id": "ALTER TABLE credit_transactions ADD COLUMN request_id TEXT DEFAULT ''",
            "metadata_json": "ALTER TABLE credit_transactions ADD COLUMN metadata_json TEXT DEFAULT ''",
            "updated_at": "ALTER TABLE credit_transactions ADD COLUMN updated_at TEXT DEFAULT ''",
        }.items():
            if column_name not in credit_transaction_columns:
                db.execute(column_sql)
        db.execute(
            """
            INSERT OR IGNORE INTO app_version
              (id, latest_version, min_version, download_url, release_notes, force_update, updated_at)
            VALUES (1, '1.0.0', '1.0.0', '', '', 0, ?)
            """,
            (now_iso(),),
        )
        current_version = row_to_dict(db.execute("SELECT * FROM app_version WHERE id = 1").fetchone())
        history_count = db.execute("SELECT COUNT(*) FROM app_version_history").fetchone()[0]
        if current_version and history_count == 0:
            timestamp = current_version.get("updated_at") or now_iso()
            db.execute(
                """
                INSERT INTO app_version_history
                  (latest_version, min_version, download_url, release_notes, force_update, is_current, created_at, updated_at, deleted_at)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?, '')
                """,
                (
                    current_version.get("latest_version", "1.0.0"),
                    current_version.get("min_version", "1.0.0"),
                    current_version.get("download_url", ""),
                    current_version.get("release_notes", ""),
                    int(current_version.get("force_update", 0) or 0),
                    timestamp,
                    timestamp,
                ),
            )
        current_count = db.execute(
            "SELECT COUNT(*) FROM app_version_history WHERE deleted_at = '' AND is_current = 1"
        ).fetchone()[0]
        if current_count == 0:
            latest_row = db.execute(
                """
                SELECT id FROM app_version_history
                WHERE deleted_at = ''
                ORDER BY updated_at DESC, id DESC
                LIMIT 1
                """
            ).fetchone()
            if latest_row:
                db.execute("UPDATE app_version_history SET is_current = 1 WHERE id = ?", (latest_row["id"],))
        db.commit()


class ActivationRequest(BaseModel):
    license_key: str = Field(min_length=4, max_length=128)
    device_id: str = Field(min_length=8, max_length=256)
    nickname: str = Field(default="", max_length=4)
    hostname: str = ""
    os_name: str = ""
    app_version: str = "1.0.0"


class LicenseCreateRequest(BaseModel):
    customer_name: str = Field(min_length=1, max_length=120)
    contact: str = ""
    expires_at: str
    max_devices: int = Field(default=1, ge=1, le=999)
    notes: str = ""
    license_key: str | None = None
    initial_credits: int = Field(default=0, ge=0)


class LicenseUpdateRequest(BaseModel):
    customer_name: str | None = None
    contact: str | None = None
    expires_at: str | None = None
    status: str | None = None
    max_devices: int | None = Field(default=None, ge=1, le=999)
    notes: str | None = None


class DeviceUpdateRequest(BaseModel):
    status: str | None = None
    note: str | None = None
    nickname: str | None = Field(default=None, max_length=4)


class VersionUpdateRequest(BaseModel):
    latest_version: str = "1.0.0"
    min_version: str = "1.0.0"
    download_url: str = ""
    release_notes: str = ""
    force_update: bool = False


class VersionCreateRequest(VersionUpdateRequest):
    is_current: bool = False


class VersionPatchRequest(BaseModel):
    latest_version: str | None = None
    min_version: str | None = None
    download_url: str | None = None
    release_notes: str | None = None
    force_update: bool | None = None


class AnnouncementCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=4000)
    kind: str = "normal"
    scope_license_key: str = ""
    is_active: bool = True
    pinned: bool = False
    start_at: str = ""
    end_at: str = ""


class AnnouncementUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    body: str | None = Field(default=None, min_length=1, max_length=4000)
    kind: str | None = None
    scope_license_key: str | None = None
    is_active: bool | None = None
    pinned: bool | None = None
    start_at: str | None = None
    end_at: str | None = None


class ModelProviderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    group_name: str = "General"
    provider_type: str = "openai-compatible"
    base_url: str = ""
    api_key: str = ""
    supported_models: str = ""
    status: str = "enabled"
    priority: int = Field(default=100, ge=0, le=10000)
    cost_multiplier: float = Field(default=1.0, ge=0)
    notes: str = ""


class ModelProviderUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    group_name: str | None = None
    provider_type: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    supported_models: str | None = None
    status: str | None = None
    priority: int | None = Field(default=None, ge=0, le=10000)
    cost_multiplier: float | None = Field(default=None, ge=0)
    notes: str | None = None


class ModelRouteCreateRequest(BaseModel):
    model_id: str = Field(min_length=1, max_length=160)
    display_name: str = ""
    model_group: str = "chat"
    provider_id: int = Field(ge=1)
    route_name: str = ""
    status: str = "enabled"
    weight: int = Field(default=100, ge=0, le=10000)
    token_cost: int = Field(default=0, ge=0)
    notes: str = ""


class ModelRouteUpdateRequest(BaseModel):
    model_id: str | None = Field(default=None, min_length=1, max_length=160)
    display_name: str | None = None
    model_group: str | None = None
    provider_id: int | None = Field(default=None, ge=1)
    route_name: str | None = None
    status: str | None = None
    weight: int | None = Field(default=None, ge=0, le=10000)
    token_cost: int | None = Field(default=None, ge=0)
    notes: str | None = None


class ModelCallLogCreateRequest(BaseModel):
    route_id: int | None = None
    provider_id: int | None = None
    provider_name: str = ""
    provider_base_url: str = ""
    license_key: str = ""
    device_id: str = ""
    model_id: str = Field(min_length=1, max_length=160)
    model_group: str = ""
    node_type: str = ""
    success: bool = False
    latency_ms: int = Field(default=0, ge=0)
    error_code: str = ""
    error_message: str = ""
    tokens_charged: int = Field(default=0, ge=0)


class CreditAdjustRequest(BaseModel):
    license_key: str = Field(min_length=4, max_length=128)
    amount: int = Field(ge=-1000000000, le=1000000000)
    reason: str = ""


class ClientCreditBaseRequest(BaseModel):
    license_key: str = Field(min_length=4, max_length=128)
    device_id: str = Field(min_length=8, max_length=256)
    model_id: str = Field(default="", max_length=160)
    model_group: str = ""
    node_type: str = ""
    route_id: int | None = None


class ClientCreditReserveRequest(ClientCreditBaseRequest):
    estimated_credits: int | None = Field(default=None, ge=0)
    request_id: str = ""


class ClientCreditSettleRequest(BaseModel):
    license_key: str = Field(min_length=4, max_length=128)
    device_id: str = Field(min_length=8, max_length=256)
    transaction_id: int = Field(ge=1)
    actual_credits: int | None = Field(default=None, ge=0)
    success: bool = True
    reason: str = ""


class ClientCreditRefundRequest(BaseModel):
    license_key: str = Field(min_length=4, max_length=128)
    device_id: str = Field(min_length=8, max_length=256)
    transaction_id: int = Field(ge=1)
    reason: str = ""


class ClientExecuteRequest(ClientCreditBaseRequest):
    node_id: str = ""
    node_type: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    inputs: dict[str, Any] = Field(default_factory=dict)
    request_id: str = ""


app = FastAPI(title=APP_NAME)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()


def serialize_version(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    item["force_update"] = bool(item.get("force_update", 0))
    item["is_current"] = bool(item.get("is_current", 0))
    return item


def mirror_current_version(db: sqlite3.Connection, version: dict[str, Any]) -> None:
    db.execute(
        """
        UPDATE app_version
        SET latest_version = ?, min_version = ?, download_url = ?, release_notes = ?,
            force_update = ?, updated_at = ?
        WHERE id = 1
        """,
        (
            version.get("latest_version", "1.0.0"),
            version.get("min_version", "1.0.0"),
            version.get("download_url", ""),
            version.get("release_notes", ""),
            1 if version.get("force_update") else 0,
            version.get("updated_at") or now_iso(),
        ),
    )


def get_current_version(db: sqlite3.Connection) -> dict[str, Any]:
    row = row_to_dict(
        db.execute(
            """
            SELECT *
            FROM app_version_history
            WHERE deleted_at = '' AND is_current = 1
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """
        ).fetchone()
    )
    if row:
        return serialize_version(row)
    legacy = row_to_dict(db.execute("SELECT * FROM app_version WHERE id = 1").fetchone()) or {}
    return {
        "id": 1,
        "latest_version": legacy.get("latest_version", "1.0.0"),
        "min_version": legacy.get("min_version", "1.0.0"),
        "download_url": legacy.get("download_url", ""),
        "release_notes": legacy.get("release_notes", ""),
        "force_update": bool(legacy.get("force_update", 0)),
        "is_current": True,
        "created_at": legacy.get("updated_at", now_iso()),
        "updated_at": legacy.get("updated_at", now_iso()),
        "deleted_at": "",
    }


def set_current_version(db: sqlite3.Connection, version_id: int) -> dict[str, Any]:
    row = row_to_dict(
        db.execute(
            "SELECT * FROM app_version_history WHERE id = ? AND deleted_at = ''",
            (version_id,),
        ).fetchone()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Version not found")
    timestamp = now_iso()
    db.execute("UPDATE app_version_history SET is_current = 0 WHERE deleted_at = ''")
    db.execute(
        "UPDATE app_version_history SET is_current = 1, updated_at = ? WHERE id = ?",
        (timestamp, version_id),
    )
    current = row_to_dict(db.execute("SELECT * FROM app_version_history WHERE id = ?", (version_id,)).fetchone()) or {}
    mirror_current_version(db, current)
    return serialize_version(current)


def get_version_info(db: sqlite3.Connection, app_version: str) -> dict[str, Any]:
    version = get_current_version(db)
    latest = version.get("latest_version", "1.0.0")
    minimum = version.get("min_version", "1.0.0")
    update_available = compare_versions(app_version, latest) < 0
    below_minimum = compare_versions(app_version, minimum) < 0
    force_update = bool(version.get("force_update", 0))
    return {
        "current_version": app_version,
        "latest_version": latest,
        "min_version": minimum,
        "download_url": version.get("download_url", ""),
        "release_notes": version.get("release_notes", ""),
        "force_update": force_update,
        "update_available": update_available,
        "must_update": below_minimum or (force_update and update_available),
    }


def normalize_announcement_kind(kind: str) -> str:
    normalized = (kind or "normal").strip()
    if normalized not in {"normal", "important", "maintenance", "warning"}:
        raise HTTPException(status_code=400, detail="Invalid announcement kind")
    return normalized


def validate_optional_window(start_at: str = "", end_at: str = "") -> None:
    if start_at:
        parse_dt(start_at)
    if end_at:
        parse_dt(end_at)


def serialize_announcement(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    item["is_active"] = bool(item.get("is_active", 0))
    item["pinned"] = bool(item.get("pinned", 0))
    return item


def normalize_model_status(status: str) -> str:
    normalized = (status or "enabled").strip()
    if normalized not in {"enabled", "disabled"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    return normalized


def normalize_text(value: str | None, fallback: str = "") -> str:
    return (value if value is not None else fallback).strip()


MODEL_GROUP_ALIASES = {
    "chat": "chat",
    "text": "chat",
    "reason": "chat",
    "reasoning": "chat",
    "conversation": "chat",
    "llm": "chat",
    "对话": "chat",
    "文本": "chat",
    "推理": "chat",
    "image": "image",
    "img": "image",
    "imagen": "image",
    "picture": "image",
    "图像": "image",
    "图片": "image",
    "生图": "image",
    "audio": "audio",
    "voice": "audio",
    "speech": "audio",
    "tts": "audio",
    "音频": "audio",
    "语音": "audio",
    "video": "video",
    "veo": "video",
    "motion": "video",
    "视频": "video",
    "动效": "video",
}


def normalize_model_group(value: str | None = "", fallback_text: str = "") -> str:
    normalized = normalize_text(value, "").lower()
    if normalized in MODEL_GROUP_ALIASES:
        return MODEL_GROUP_ALIASES[normalized]

    text = f"{normalized} {normalize_text(fallback_text, '').lower()}".strip()
    if any(token in text for token in ("image", "img", "imagen", "seedream", "picture", "图像", "图片", "生图")):
        return "image"
    if any(token in text for token in ("audio", "tts", "voice", "speech", "音频", "语音")):
        return "audio"
    if any(token in text for token in ("video", "veo", "motion", "sora", "视频", "动效")):
        return "video"
    return "chat"


def api_key_preview(api_key: str) -> str:
    if not api_key:
        return ""
    if len(api_key) <= 8:
        return "*" * len(api_key)
    return f"{api_key[:4]}...{api_key[-4:]}"


def serialize_model_provider(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    raw_key = item.pop("api_key_cipher", "") or ""
    item["has_api_key"] = bool(raw_key)
    item["api_key_preview"] = api_key_preview(raw_key)
    return item


def serialize_model_route(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    return dict(row)


def ensure_provider_exists(db: sqlite3.Connection, provider_id: int) -> None:
    exists = db.execute("SELECT 1 FROM model_providers WHERE id = ?", (provider_id,)).fetchone()
    if not exists:
        raise HTTPException(status_code=404, detail="Provider not found")


def ensure_credit_account(db: sqlite3.Connection, license_key: str) -> dict[str, Any]:
    license_row = row_to_dict(db.execute("SELECT * FROM licenses WHERE license_key = ?", (license_key,)).fetchone())
    if not license_row:
        raise HTTPException(status_code=404, detail="License not found")

    timestamp = now_iso()
    db.execute(
        """
        INSERT OR IGNORE INTO credit_accounts
          (license_key, balance, reserved_balance, lifetime_granted, lifetime_spent, status, updated_at)
        VALUES (?, 0, 0, 0, 0, 'enabled', ?)
        """,
        (license_key, timestamp),
    )
    account = row_to_dict(db.execute("SELECT * FROM credit_accounts WHERE license_key = ?", (license_key,)).fetchone())
    if not account:
        raise HTTPException(status_code=500, detail="Credit account unavailable")
    return account


def serialize_credit_account(account: dict[str, Any], license_row: dict[str, Any] | None = None) -> dict[str, Any]:
    balance = int(account.get("balance") or 0)
    reserved = int(account.get("reserved_balance") or 0)
    return {
        "license_key": account.get("license_key", ""),
        "customer_name": (license_row or {}).get("customer_name", ""),
        "license_status": (license_row or {}).get("status", ""),
        "balance": balance,
        "reserved_balance": reserved,
        "available_balance": max(0, balance - reserved),
        "lifetime_granted": int(account.get("lifetime_granted") or 0),
        "lifetime_spent": int(account.get("lifetime_spent") or 0),
        "status": account.get("status", "enabled"),
        "updated_at": account.get("updated_at", ""),
    }


def serialize_credit_transaction(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    try:
        item["metadata"] = json.loads(item.get("metadata_json") or "{}")
    except (TypeError, ValueError):
        item["metadata"] = {}
    item.pop("metadata_json", None)
    return item


def attach_credit_to_license(db: sqlite3.Connection, license_row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(license_row)
    account = serialize_credit_account(ensure_credit_account(db, item["license_key"]), item)
    item.update(
        {
            "credit_balance": account["balance"],
            "credit_reserved_balance": account["reserved_balance"],
            "credit_available_balance": account["available_balance"],
            "credit_lifetime_granted": account["lifetime_granted"],
            "credit_lifetime_spent": account["lifetime_spent"],
            "credit_status": account["status"],
            "credit_updated_at": account["updated_at"],
        }
    )
    return item


def grant_initial_credits(db: sqlite3.Connection, license_key: str, amount: int, timestamp: str) -> None:
    if amount <= 0:
        return

    ensure_credit_account(db, license_key)
    db.execute(
        """
        UPDATE credit_accounts
        SET balance = balance + ?,
            lifetime_granted = lifetime_granted + ?,
            updated_at = ?
        WHERE license_key = ?
        """,
        (amount, amount, timestamp, license_key),
    )
    db.execute(
        """
        INSERT INTO credit_transactions
          (license_key, amount, reserved_amount, settled_amount, transaction_type, status,
           reason, route_id, device_id, model_id, model_group, node_type, request_id,
           metadata_json, created_at, updated_at)
        VALUES (?, ?, 0, 0, 'adjustment', 'settled', 'Initial company credits', NULL, '', '', '', '', '', '{}', ?, ?)
        """,
        (license_key, amount, timestamp, timestamp),
    )


def validate_credit_device(db: sqlite3.Connection, license_key: str, device_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    license_row = row_to_dict(db.execute("SELECT * FROM licenses WHERE license_key = ?", (license_key,)).fetchone())
    if not license_row:
        raise HTTPException(status_code=403, detail="License not found")
    if license_row["status"] != "enabled":
        raise HTTPException(status_code=403, detail="License disabled")
    if parse_dt(license_row["expires_at"]) <= datetime.now(timezone.utc):
        raise HTTPException(status_code=403, detail="License expired")

    device_row = row_to_dict(db.execute("SELECT * FROM devices WHERE device_id = ?", (device_id,)).fetchone())
    if not device_row or device_row.get("license_key") != license_key:
        raise HTTPException(status_code=403, detail="Device is not activated for this license")
    if device_row.get("status") != "enabled":
        raise HTTPException(status_code=403, detail="Device not enabled")
    return license_row, device_row


def fallback_credit_cost(node_type: str, model_group: str = "") -> int:
    text = f"{node_type} {model_group}".lower()
    if "video" in text:
        return 100
    if "image" in text:
        return 10
    if "audio" in text or "tts" in text:
        return 5
    return 1


def required_credit_balance(estimated_credits: int) -> int:
    return max(1, int(estimated_credits or 0), MIN_RUN_CREDITS)


def find_billable_model_route(
    db: sqlite3.Connection,
    model_id: str,
    route_id: int | None = None,
    model_group: str = "",
) -> dict[str, Any] | None:
    if route_id:
        return row_to_dict(
            db.execute(
                """
                SELECT model_routes.*,
                  model_providers.name AS provider_name,
                  model_providers.group_name AS provider_group,
                  model_providers.status AS provider_status
                FROM model_routes
                JOIN model_providers ON model_providers.id = model_routes.provider_id
                WHERE model_routes.id = ?
                """,
                (route_id,),
            ).fetchone()
        )

    if not model_id.strip():
        return None

    normalized_group = normalize_model_group(model_group, model_id) if model_group.strip() else ""
    rows = db.execute(
        """
        SELECT model_routes.*,
          model_providers.name AS provider_name,
          model_providers.group_name AS provider_group,
          model_providers.status AS provider_status
        FROM model_routes
        JOIN model_providers ON model_providers.id = model_routes.provider_id
        WHERE model_routes.model_id = ?
          AND model_routes.status = 'enabled'
          AND model_providers.status = 'enabled'
        ORDER BY
          model_routes.weight DESC,
          model_routes.token_cost ASC,
          model_routes.id ASC
        LIMIT 20
        """,
        (model_id.strip(),),
    ).fetchall()
    if normalized_group:
        for row in rows:
            if normalize_model_group(row["model_group"], row["model_id"]) == normalized_group:
                return row_to_dict(row)
    return row_to_dict(rows[0]) if rows else None


def find_executable_model_route(
    db: sqlite3.Connection,
    model_id: str,
    route_id: int | None = None,
    model_group: str = "",
) -> dict[str, Any] | None:
    if route_id:
        return row_to_dict(
            db.execute(
                """
                SELECT model_routes.*,
                  model_providers.name AS provider_name,
                  model_providers.group_name AS provider_group,
                  model_providers.provider_type AS provider_type,
                  model_providers.base_url AS provider_base_url,
                  model_providers.api_key_cipher AS provider_api_key,
                  model_providers.status AS provider_status
                FROM model_routes
                JOIN model_providers ON model_providers.id = model_routes.provider_id
                WHERE model_routes.id = ?
                  AND model_routes.status = 'enabled'
                  AND model_providers.status = 'enabled'
                """,
                (route_id,),
            ).fetchone()
        )

    if not model_id.strip():
        return None

    normalized_group = normalize_model_group(model_group, model_id) if model_group.strip() else ""
    rows = db.execute(
        """
        SELECT model_routes.*,
          model_providers.name AS provider_name,
          model_providers.group_name AS provider_group,
          model_providers.provider_type AS provider_type,
          model_providers.base_url AS provider_base_url,
          model_providers.api_key_cipher AS provider_api_key,
          model_providers.status AS provider_status
        FROM model_routes
        JOIN model_providers ON model_providers.id = model_routes.provider_id
        WHERE model_routes.model_id = ?
          AND model_routes.status = 'enabled'
          AND model_providers.status = 'enabled'
        ORDER BY
          model_routes.weight DESC,
          model_routes.token_cost ASC,
          model_routes.id ASC
        LIMIT 20
        """,
        (model_id.strip(),),
    ).fetchall()
    if normalized_group:
        for row in rows:
            if normalize_model_group(row["model_group"], row["model_id"]) == normalized_group:
                return row_to_dict(row)
    return row_to_dict(rows[0]) if rows else None


def build_credit_quote(db: sqlite3.Connection, payload: ClientCreditBaseRequest) -> dict[str, Any]:
    model_id = payload.model_id.strip()
    model_group = normalize_model_group(payload.model_group, f"{payload.node_type} {model_id}")
    route = find_billable_model_route(db, model_id, payload.route_id, model_group)
    if route and int(route.get("token_cost") or 0) > 0:
        estimated_credits = int(route.get("token_cost") or 0)
    else:
        estimated_credits = fallback_credit_cost(payload.node_type, model_group or (route or {}).get("model_group", ""))

    return {
        "estimated_credits": max(1, estimated_credits),
        "route": {
            "id": route.get("id"),
            "model_id": route.get("model_id", model_id),
            "display_name": route.get("display_name", ""),
            "model_group": route.get("model_group", model_group),
            "route_name": route.get("route_name", ""),
            "token_cost": int(route.get("token_cost") or 0),
        } if route else None,
    }


def find_matching_model_route(db: sqlite3.Connection, payload: ModelCallLogCreateRequest) -> dict[str, Any] | None:
    if payload.route_id:
        return row_to_dict(
            db.execute(
                """
                SELECT model_routes.*, model_providers.base_url AS provider_base_url
                FROM model_routes
                JOIN model_providers ON model_providers.id = model_routes.provider_id
                WHERE model_routes.id = ?
                """,
                (payload.route_id,),
            ).fetchone()
        )

    model_id = payload.model_id.strip()
    base_url = payload.provider_base_url.strip().rstrip("/")
    provider_name = payload.provider_name.strip()
    if base_url:
        row = row_to_dict(
            db.execute(
                """
                SELECT model_routes.*, model_providers.base_url AS provider_base_url
                FROM model_routes
                JOIN model_providers ON model_providers.id = model_routes.provider_id
                WHERE model_routes.model_id = ?
                  AND rtrim(model_providers.base_url, '/') = ?
                ORDER BY
                  CASE WHEN model_routes.status = 'enabled' AND model_providers.status = 'enabled' THEN 0 ELSE 1 END,
                  model_routes.weight DESC,
                  model_routes.id ASC
                LIMIT 1
                """,
                (model_id, base_url),
            ).fetchone()
        )
        if row:
            return row

    if provider_name:
        row = row_to_dict(
            db.execute(
                """
                SELECT model_routes.*, model_providers.base_url AS provider_base_url
                FROM model_routes
                JOIN model_providers ON model_providers.id = model_routes.provider_id
                WHERE model_routes.model_id = ?
                  AND lower(model_providers.name) = lower(?)
                ORDER BY
                  CASE WHEN model_routes.status = 'enabled' AND model_providers.status = 'enabled' THEN 0 ELSE 1 END,
                  model_routes.weight DESC,
                  model_routes.id ASC
                LIMIT 1
                """,
                (model_id, provider_name),
            ).fetchone()
        )
        if row:
            return row

    normalized_group = normalize_model_group(payload.model_group, f"{payload.node_type} {model_id}") if (payload.model_group or payload.node_type) else ""
    rows = db.execute(
        """
        SELECT model_routes.*, model_providers.base_url AS provider_base_url
        FROM model_routes
        JOIN model_providers ON model_providers.id = model_routes.provider_id
        WHERE model_routes.model_id = ?
        ORDER BY
          CASE WHEN ? != '' AND lower(model_routes.model_group) = ? THEN 0 ELSE 1 END,
          CASE WHEN model_routes.status = 'enabled' AND model_providers.status = 'enabled' THEN 0 ELSE 1 END,
          model_routes.weight DESC,
          model_routes.id ASC
        LIMIT 4
        """,
        (model_id, normalized_group, normalized_group),
    ).fetchall()
    if normalized_group:
        exact_rows = [
            row for row in rows
            if normalize_model_group(row["model_group"], row["model_id"]) == normalized_group
        ]
        if len(exact_rows) == 1:
            return row_to_dict(exact_rows[0])
    if len(rows) == 1:
        return row_to_dict(rows[0])
    return None


def record_model_call_log(db: sqlite3.Connection, payload: ModelCallLogCreateRequest) -> dict[str, Any]:
    timestamp = now_iso()
    matched_route = find_matching_model_route(db, payload)
    if payload.route_id and not matched_route:
        raise HTTPException(status_code=404, detail="Route not found")

    provider_id = payload.provider_id
    route_id = payload.route_id
    model_group = payload.model_group.strip()

    if matched_route:
        route_id = int(matched_route["id"])
        provider_id = int(matched_route["provider_id"])
        model_group = model_group or str(matched_route.get("model_group") or "")

    db.execute(
        """
        INSERT INTO model_call_logs
          (route_id, provider_id, license_key, device_id, model_id, model_group, node_type,
           success, latency_ms, error_code, error_message, tokens_charged, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            route_id,
            provider_id,
            payload.license_key.strip(),
            payload.device_id.strip(),
            payload.model_id.strip(),
            model_group,
            payload.node_type.strip(),
            1 if payload.success else 0,
            payload.latency_ms,
            payload.error_code.strip(),
            payload.error_message.strip()[:1000],
            payload.tokens_charged,
            timestamp,
        ),
    )
    return {
        "created": True,
        "created_at": timestamp,
        "route_id": route_id,
        "provider_id": provider_id,
        "matched": bool(matched_route),
    }


def infer_execute_model_id(payload: ClientExecuteRequest) -> str:
    if payload.model_id.strip():
        return payload.model_id.strip()
    config = payload.config or {}
    for key in ("modelId", "model", "chatModelId", "imageModelId", "audioModelId", "videoModelId"):
        value = config.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def infer_execute_model_group(node_type: str, fallback: str = "") -> str:
    if fallback.strip():
        return normalize_model_group(fallback, node_type)
    text = node_type.lower()
    if "image" in text or "imagen" in text:
        return "image"
    if "audio" in text:
        return "audio"
    if "video" in text:
        return "video"
    return "chat"


def normalize_execute_backend_url() -> str:
    value = EXECUTE_BACKEND_URL.strip()
    if not value:
        raise HTTPException(status_code=500, detail="LICENSE_EXECUTE_BACKEND_URL is empty")
    if value.endswith("/execute"):
        return value
    return f"{value.rstrip('/')}/execute"


def read_backend_error(error: urllib.error.HTTPError) -> str:
    body = error.read().decode("utf-8", errors="ignore")
    if not body:
        return f"HTTP {error.code}: {error.reason}"
    try:
        parsed = json.loads(body)
        detail = parsed.get("detail") or parsed.get("message") or parsed.get("error")
        if detail:
            return str(detail)
    except Exception:
        pass
    return body[:1000]


def call_execute_backend(payload: ClientExecuteRequest, route: dict[str, Any]) -> dict[str, Any]:
    config = dict(payload.config or {})
    route_model_id = str(route.get("model_id") or "").strip()
    if route_model_id:
        config["modelId"] = route_model_id

    body = {
        "node_id": payload.node_id or payload.request_id or "",
        "node_type": payload.node_type,
        "config": config,
        "inputs": payload.inputs or {},
        "provider_name": route.get("provider_name") or route.get("route_name") or "Platform Route",
        "api_key": route.get("provider_api_key") or "",
        "base_url": route.get("provider_base_url") or "",
        "chat_protocol": "auto",
        "reasoning_protocol": "auto",
        "image_protocol": "auto",
    }
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        normalize_execute_backend_url(),
        data=data,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "AWEI-License-Proxy/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=EXECUTE_BACKEND_TIMEOUT_SECONDS) as response:
            text = response.read().decode("utf-8", errors="ignore")
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as error:
        raise HTTPException(status_code=error.code, detail=read_backend_error(error)) from error
    except urllib.error.URLError as error:
        raise HTTPException(status_code=502, detail=f"模型执行后端不可用：{error.reason}") from error


def reserve_credit_for_execute(
    db: sqlite3.Connection,
    license_key: str,
    device_id: str,
    payload: ClientExecuteRequest,
    quote: dict[str, Any],
    license_row: dict[str, Any],
) -> tuple[int, int, dict[str, Any]]:
    timestamp = now_iso()
    account = ensure_credit_account(db, license_key)
    if account.get("status") != "enabled":
        raise HTTPException(status_code=402, detail="Credit account disabled")

    estimated = max(1, int(quote.get("estimated_credits") or 1))
    required = required_credit_balance(estimated)
    available = int(account.get("balance") or 0) - int(account.get("reserved_balance") or 0)
    if available < required:
        raise HTTPException(
            status_code=402,
            detail=f"余额不足：本次预计消耗 {estimated} 代币，启动前至少需要 {required} 代币，当前可用 {max(0, available)} 代币",
        )

    route = quote.get("route") or {}
    cursor = db.execute(
        """
        INSERT INTO credit_transactions
          (license_key, amount, reserved_amount, settled_amount, transaction_type, status,
           reason, route_id, device_id, model_id, model_group, node_type, request_id,
           metadata_json, created_at, updated_at)
        VALUES (?, 0, ?, 0, 'reserve', 'reserved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            license_key,
            estimated,
            "Client proxy execution reserve",
            route.get("id"),
            device_id,
            payload.model_id.strip() or route.get("model_id", ""),
            payload.model_group.strip() or route.get("model_group", ""),
            payload.node_type.strip(),
            payload.request_id.strip() or payload.node_id.strip(),
            json.dumps({"quote": quote, "via": "client_execute"}, ensure_ascii=False),
            timestamp,
            timestamp,
        ),
    )
    db.execute(
        """
        UPDATE credit_accounts
        SET reserved_balance = reserved_balance + ?, updated_at = ?
        WHERE license_key = ?
        """,
        (estimated, timestamp, license_key),
    )
    db.commit()
    account = ensure_credit_account(db, license_key)
    return int(cursor.lastrowid), estimated, serialize_credit_account(account, license_row)


def settle_reserved_credit(
    db: sqlite3.Connection,
    license_key: str,
    transaction_id: int,
    actual: int,
    reason: str,
    license_row: dict[str, Any],
) -> dict[str, Any]:
    timestamp = now_iso()
    tx = row_to_dict(
        db.execute(
            "SELECT * FROM credit_transactions WHERE id = ? AND license_key = ?",
            (transaction_id, license_key),
        ).fetchone()
    )
    if not tx or tx.get("status") != "reserved":
        return serialize_credit_account(ensure_credit_account(db, license_key), license_row)

    reserved = int(tx.get("reserved_amount") or 0)
    actual = max(0, int(actual))
    db.execute(
        """
        UPDATE credit_accounts
        SET balance = balance - ?,
            reserved_balance = MAX(0, reserved_balance - ?),
            lifetime_spent = lifetime_spent + ?,
            updated_at = ?
        WHERE license_key = ?
        """,
        (actual, reserved, actual, timestamp, license_key),
    )
    db.execute(
        """
        UPDATE credit_transactions
        SET amount = ?,
            settled_amount = ?,
            status = 'settled',
            transaction_type = 'settlement',
            reason = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (-actual, actual, reason, timestamp, transaction_id),
    )
    db.commit()
    return serialize_credit_account(ensure_credit_account(db, license_key), license_row)


def refund_reserved_credit(
    db: sqlite3.Connection,
    license_key: str,
    transaction_id: int,
    reason: str,
    license_row: dict[str, Any],
) -> dict[str, Any]:
    timestamp = now_iso()
    tx = row_to_dict(
        db.execute(
            "SELECT * FROM credit_transactions WHERE id = ? AND license_key = ?",
            (transaction_id, license_key),
        ).fetchone()
    )
    if not tx or tx.get("status") != "reserved":
        return serialize_credit_account(ensure_credit_account(db, license_key), license_row)

    reserved = int(tx.get("reserved_amount") or 0)
    db.execute(
        """
        UPDATE credit_accounts
        SET reserved_balance = MAX(0, reserved_balance - ?), updated_at = ?
        WHERE license_key = ?
        """,
        (reserved, timestamp, license_key),
    )
    db.execute(
        """
        UPDATE credit_transactions
        SET status = 'refunded',
            reason = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (reason[:1000], timestamp, transaction_id),
    )
    db.commit()
    return serialize_credit_account(ensure_credit_account(db, license_key), license_row)


def build_model_health_summary(db: sqlite3.Connection) -> dict[str, Any]:
    bucket_minutes = max(1, MODEL_HEALTH_BUCKET_MINUTES)
    window_hours = max(1, MODEL_HEALTH_WINDOW_HOURS)
    bucket_seconds = bucket_minutes * 60
    bucket_count = max(1, int((window_hours * 60) / bucket_minutes))
    end_time = datetime.now(timezone.utc).replace(microsecond=0)
    start_time = end_time - timedelta(seconds=bucket_seconds * bucket_count)

    route_rows = db.execute(
        """
        SELECT model_routes.*,
          model_providers.name AS provider_name,
          model_providers.group_name AS provider_group,
          model_providers.base_url AS provider_base_url,
          model_providers.status AS provider_status
        FROM model_routes
        JOIN model_providers ON model_providers.id = model_routes.provider_id
        ORDER BY model_routes.model_group ASC, model_routes.model_id ASC, model_routes.weight DESC, model_routes.id ASC
        """
    ).fetchall()
    routes = [dict(row) for row in route_rows]
    route_map = {int(route["id"]): route for route in routes}
    buckets_by_route: dict[int, list[dict[str, Any]]] = {}
    totals_by_route: dict[int, dict[str, int]] = {}

    for route_id in route_map:
        buckets_by_route[route_id] = [
            {
                "index": index,
                "start_at": (start_time + timedelta(seconds=bucket_seconds * index)).isoformat(),
                "success_count": 0,
                "failure_count": 0,
                "total": 0,
                "avg_latency_ms": 0,
                "_latency_sum": 0,
                "status": "empty",
            }
            for index in range(bucket_count)
        ]
        totals_by_route[route_id] = {"success": 0, "failure": 0, "total": 0, "latency_sum": 0}

    log_rows = db.execute(
        """
        SELECT *
        FROM model_call_logs
        WHERE created_at >= ?
        ORDER BY created_at ASC
        """,
        (start_time.isoformat(),),
    ).fetchall()

    for row in log_rows:
        log = dict(row)
        route_id = log.get("route_id")
        if route_id is None or int(route_id) not in route_map:
            continue
        try:
            created_at = parse_dt(log.get("created_at") or "")
        except HTTPException:
            continue
        index = int((created_at - start_time).total_seconds() // bucket_seconds)
        if index < 0 or index >= bucket_count:
            if 0 <= index <= bucket_count:
                index = bucket_count - 1
            else:
                continue
        success = bool(log.get("success", 0))
        latency_ms = int(log.get("latency_ms", 0) or 0)
        bucket = buckets_by_route[int(route_id)][index]
        bucket["total"] += 1
        bucket["_latency_sum"] += latency_ms
        if success:
            bucket["success_count"] += 1
            totals_by_route[int(route_id)]["success"] += 1
        else:
            bucket["failure_count"] += 1
            totals_by_route[int(route_id)]["failure"] += 1
        totals_by_route[int(route_id)]["total"] += 1
        totals_by_route[int(route_id)]["latency_sum"] += latency_ms

    for route_id, buckets in buckets_by_route.items():
        for bucket in buckets:
            if bucket["total"] > 0:
                success_rate = bucket["success_count"] / bucket["total"]
                bucket["avg_latency_ms"] = round(bucket["_latency_sum"] / bucket["total"])
                if success_rate >= 0.9:
                    bucket["status"] = "ok"
                elif success_rate >= 0.6:
                    bucket["status"] = "warn"
                else:
                    bucket["status"] = "bad"
            del bucket["_latency_sum"]

    groups: dict[str, list[dict[str, Any]]] = {}
    for route in routes:
        route_id = int(route["id"])
        totals = totals_by_route[route_id]
        total_calls = totals["total"]
        success_rate = None if total_calls == 0 else round(totals["success"] / total_calls, 4)
        avg_latency = None if total_calls == 0 else round(totals["latency_sum"] / total_calls)
        model_group = normalize_model_group(route.get("model_group", ""), route.get("model_id", ""))
        route_summary = {
            "id": route_id,
            "model_id": route.get("model_id", ""),
            "display_name": route.get("display_name", ""),
            "model_group": model_group,
            "route_name": route.get("route_name", ""),
            "route_status": route.get("status", "enabled"),
            "provider_id": route.get("provider_id"),
            "provider_name": route.get("provider_name", ""),
            "provider_group": route.get("provider_group", ""),
            "provider_base_url": route.get("provider_base_url", ""),
            "provider_status": route.get("provider_status", "enabled"),
            "weight": route.get("weight", 0),
            "token_cost": route.get("token_cost", 0),
            "success_rate": success_rate,
            "total_calls": total_calls,
            "success_count": totals["success"],
            "failure_count": totals["failure"],
            "avg_latency_ms": avg_latency,
            "buckets": buckets_by_route[route_id],
        }
        groups.setdefault(route_summary["model_group"] or "chat", []).append(route_summary)

    return {
        "generated_at": end_time.isoformat(),
        "window_hours": window_hours,
        "bucket_minutes": bucket_minutes,
        "bucket_count": bucket_count,
        "groups": [
            {"model_group": group_name, "routes": group_routes}
            for group_name, group_routes in groups.items()
        ],
    }


def list_active_announcements(db: sqlite3.Connection, license_key: str = "") -> list[dict[str, Any]]:
    timestamp = now_iso()
    rows = db.execute(
        """
        SELECT *
        FROM announcements
        WHERE is_active = 1
          AND deleted_at = ''
          AND (scope_license_key = '' OR scope_license_key = ?)
          AND (start_at = '' OR start_at <= ?)
          AND (end_at = '' OR end_at >= ?)
        ORDER BY pinned DESC, updated_at DESC, id DESC
        """,
        (license_key, timestamp, timestamp),
    ).fetchall()
    return [serialize_announcement(row) for row in rows]


def validate_license(db: sqlite3.Connection, payload: ActivationRequest) -> dict[str, Any]:
    timestamp = now_iso()
    nickname = normalize_nickname(payload.nickname)
    license_row = row_to_dict(
        db.execute("SELECT * FROM licenses WHERE license_key = ?", (payload.license_key,)).fetchone()
    )
    if not license_row:
        raise HTTPException(status_code=403, detail="License not found")

    if license_row["status"] != "enabled":
        raise HTTPException(status_code=403, detail="License disabled")

    if parse_dt(license_row["expires_at"]) <= datetime.now(timezone.utc):
        raise HTTPException(status_code=403, detail="License expired")

    device_row = row_to_dict(
        db.execute("SELECT * FROM devices WHERE device_id = ?", (payload.device_id,)).fetchone()
    )

    if device_row and device_row["license_key"] != payload.license_key:
        raise HTTPException(status_code=403, detail="Device is bound to another license")

    if device_row and device_row["status"] == "disabled":
        raise HTTPException(status_code=403, detail="Device disabled")

    if not device_row:
        if not nickname:
            raise HTTPException(status_code=400, detail="Nickname required")
        db.execute(
            """
            INSERT INTO devices
              (device_id, license_key, nickname, hostname, os_name, app_version, status, note, first_seen, approved_at, last_seen)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', '', ?, '', ?)
            """,
            (
                payload.device_id,
                payload.license_key,
                nickname,
                payload.hostname,
                payload.os_name,
                payload.app_version,
                timestamp,
                timestamp,
            ),
        )
    else:
        db.execute(
            """
            UPDATE devices
            SET hostname = ?, os_name = ?, app_version = ?, last_seen = ?
            WHERE device_id = ?
            """,
            (payload.hostname, payload.os_name, payload.app_version, timestamp, payload.device_id),
        )
        if nickname and nickname != (device_row.get("nickname") or ""):
            db.execute("UPDATE devices SET nickname = ? WHERE device_id = ?", (nickname, payload.device_id))

    db.commit()
    device_row = row_to_dict(
        db.execute("SELECT * FROM devices WHERE device_id = ?", (payload.device_id,)).fetchone()
    )
    credit_account = serialize_credit_account(ensure_credit_account(db, payload.license_key), license_row)
    db.commit()
    if device_row and device_row["status"] == "pending":
        return {
            "allowed": False,
            "status": "pending",
            "detail": "Activation pending approval",
            "server_time": timestamp,
            "license": license_row,
            "device": device_row,
            "version": get_version_info(db, payload.app_version),
            "announcements": list_active_announcements(db, payload.license_key),
            "credits": credit_account,
        }

    return {
        "allowed": True,
        "status": "enabled",
        "server_time": timestamp,
        "lease_until": lease_until_iso(),
        "license": license_row,
        "device": device_row,
        "version": get_version_info(db, payload.app_version),
        "announcements": list_active_announcements(db, payload.license_key),
        "credits": credit_account,
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"ok": "true", "service": APP_NAME, "time": now_iso()}


@app.post("/client/activate")
def activate(payload: ActivationRequest) -> dict[str, Any]:
    with get_db() as db:
        return validate_license(db, payload)


@app.post("/client/verify")
def verify(payload: ActivationRequest) -> dict[str, Any]:
    with get_db() as db:
        return validate_license(db, payload)


@app.get("/client/update-check")
def update_check(app_version: str = "1.0.0") -> dict[str, Any]:
    with get_db() as db:
        return get_version_info(db, app_version)


@app.get("/client/announcements")
def client_announcements(license_key: str = "") -> list[dict[str, Any]]:
    with get_db() as db:
        return list_active_announcements(db, license_key)


@app.get("/client/model-health")
def client_model_health() -> dict[str, Any]:
    with get_db() as db:
        health = build_model_health_summary(db)
        safe_groups = []
        for group in health["groups"]:
            safe_groups.append(
                {
                    "model_group": group["model_group"],
                    "routes": [
                        {
                            "model_id": route["model_id"],
                            "display_name": route["display_name"],
                            "model_group": route["model_group"],
                            "route_name": route["route_name"],
                            "route_status": route["route_status"],
                            "provider_name": route["provider_name"],
                            "provider_base_url": route["provider_base_url"],
                            "provider_status": route["provider_status"],
                            "success_rate": route["success_rate"],
                            "total_calls": route["total_calls"],
                            "avg_latency_ms": route["avg_latency_ms"],
                            "buckets": [
                                {
                                    "index": bucket["index"],
                                    "status": bucket["status"],
                                    "total": bucket["total"],
                                }
                                for bucket in route["buckets"]
                            ],
                        }
                        for route in group["routes"]
                    ],
                }
            )
        return {
            "generated_at": health["generated_at"],
            "window_hours": health["window_hours"],
            "bucket_minutes": health["bucket_minutes"],
            "bucket_count": health["bucket_count"],
            "groups": safe_groups,
        }


@app.post("/client/model-call-logs")
def client_model_call_log(payload: ModelCallLogCreateRequest) -> dict[str, Any]:
    with get_db() as db:
        result = record_model_call_log(db, payload)
        db.commit()
        return result


@app.get("/client/credits")
def client_credits(license_key: str, device_id: str) -> dict[str, Any]:
    with get_db() as db:
        license_row, _device_row = validate_credit_device(db, license_key, device_id)
        account = ensure_credit_account(db, license_key)
        db.commit()
        return serialize_credit_account(account, license_row)


@app.post("/client/credits/quote")
def client_credit_quote(payload: ClientCreditBaseRequest) -> dict[str, Any]:
    with get_db() as db:
        license_row, _device_row = validate_credit_device(db, payload.license_key, payload.device_id)
        account = ensure_credit_account(db, payload.license_key)
        quote = build_credit_quote(db, payload)
        account_view = serialize_credit_account(account, license_row)
        estimated = int(quote["estimated_credits"])
        required = required_credit_balance(estimated)
        return {
            **quote,
            "required_credits": required,
            "min_run_credits": MIN_RUN_CREDITS,
            "account": account_view,
            "allowed": account_view["status"] == "enabled" and account_view["available_balance"] >= required,
            "shortfall": max(0, required - account_view["available_balance"]),
        }


@app.post("/client/credits/reserve")
def client_credit_reserve(payload: ClientCreditReserveRequest) -> dict[str, Any]:
    timestamp = now_iso()
    with get_db() as db:
        license_row, _device_row = validate_credit_device(db, payload.license_key, payload.device_id)
        account = ensure_credit_account(db, payload.license_key)
        if account.get("status") != "enabled":
            raise HTTPException(status_code=402, detail="Credit account disabled")

        quote = build_credit_quote(db, payload)
        estimated = int(payload.estimated_credits or quote["estimated_credits"])
        estimated = max(1, estimated)
        required = required_credit_balance(estimated)
        available = int(account.get("balance") or 0) - int(account.get("reserved_balance") or 0)
        if available < required:
            raise HTTPException(
                status_code=402,
                detail=f"余额不足：本次预计消耗 {estimated} 代币，启动前至少需要 {required} 代币，当前可用 {max(0, available)} 代币",
            )

        route = quote.get("route") or {}
        cursor = db.execute(
            """
            INSERT INTO credit_transactions
              (license_key, amount, reserved_amount, settled_amount, transaction_type, status,
               reason, route_id, device_id, model_id, model_group, node_type, request_id,
               metadata_json, created_at, updated_at)
            VALUES (?, 0, ?, 0, 'reserve', 'reserved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.license_key,
                estimated,
                "Node execution reserve",
                route.get("id"),
                payload.device_id,
                payload.model_id.strip() or route.get("model_id", ""),
                payload.model_group.strip() or route.get("model_group", ""),
                payload.node_type.strip(),
                payload.request_id.strip(),
                json.dumps({"quote": quote}, ensure_ascii=False),
                timestamp,
                timestamp,
            ),
        )
        db.execute(
            """
            UPDATE credit_accounts
            SET reserved_balance = reserved_balance + ?, updated_at = ?
            WHERE license_key = ?
            """,
            (estimated, timestamp, payload.license_key),
        )
        db.commit()
        account = ensure_credit_account(db, payload.license_key)
        return {
            "transaction_id": int(cursor.lastrowid),
            "reserved_credits": estimated,
            "estimated_credits": estimated,
            "required_credits": required,
            "min_run_credits": MIN_RUN_CREDITS,
            "route": route,
            "account": serialize_credit_account(account, license_row),
        }


@app.post("/client/credits/settle")
def client_credit_settle(payload: ClientCreditSettleRequest) -> dict[str, Any]:
    timestamp = now_iso()
    with get_db() as db:
        license_row, _device_row = validate_credit_device(db, payload.license_key, payload.device_id)
        account = ensure_credit_account(db, payload.license_key)
        tx = row_to_dict(
            db.execute(
                "SELECT * FROM credit_transactions WHERE id = ? AND license_key = ?",
                (payload.transaction_id, payload.license_key),
            ).fetchone()
        )
        if not tx:
            raise HTTPException(status_code=404, detail="Credit transaction not found")
        if tx.get("status") != "reserved":
            account_view = serialize_credit_account(account, license_row)
            return {"already_finalized": True, "transaction": tx, "account": account_view}

        reserved = int(tx.get("reserved_amount") or 0)
        actual = max(0, int(payload.actual_credits if payload.actual_credits is not None else reserved))
        available_after_release = int(account.get("balance") or 0) - (int(account.get("reserved_balance") or 0) - reserved)
        if actual > available_after_release:
            raise HTTPException(status_code=402, detail="Credit balance is insufficient for settlement")

        db.execute(
            """
            UPDATE credit_accounts
            SET balance = balance - ?,
                reserved_balance = MAX(0, reserved_balance - ?),
                lifetime_spent = lifetime_spent + ?,
                updated_at = ?
            WHERE license_key = ?
            """,
            (actual, reserved, actual, timestamp, payload.license_key),
        )
        db.execute(
            """
            UPDATE credit_transactions
            SET amount = ?,
                settled_amount = ?,
                status = ?,
                transaction_type = 'settlement',
                reason = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (-actual, actual, "settled" if payload.success else "failed_settled", payload.reason.strip() or "Node execution settled", timestamp, payload.transaction_id),
        )
        db.commit()
        account = ensure_credit_account(db, payload.license_key)
        return {
            "settled_credits": actual,
            "released_credits": max(0, reserved - actual),
            "account": serialize_credit_account(account, license_row),
        }


@app.post("/client/credits/refund")
def client_credit_refund(payload: ClientCreditRefundRequest) -> dict[str, Any]:
    timestamp = now_iso()
    with get_db() as db:
        license_row, _device_row = validate_credit_device(db, payload.license_key, payload.device_id)
        account = ensure_credit_account(db, payload.license_key)
        tx = row_to_dict(
            db.execute(
                "SELECT * FROM credit_transactions WHERE id = ? AND license_key = ?",
                (payload.transaction_id, payload.license_key),
            ).fetchone()
        )
        if not tx:
            raise HTTPException(status_code=404, detail="Credit transaction not found")
        if tx.get("status") != "reserved":
            return {
                "already_finalized": True,
                "transaction": tx,
                "account": serialize_credit_account(account, license_row),
            }

        reserved = int(tx.get("reserved_amount") or 0)
        db.execute(
            """
            UPDATE credit_accounts
            SET reserved_balance = MAX(0, reserved_balance - ?), updated_at = ?
            WHERE license_key = ?
            """,
            (reserved, timestamp, payload.license_key),
        )
        db.execute(
            """
            UPDATE credit_transactions
            SET status = 'refunded',
                reason = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (payload.reason.strip() or "Node execution failed; reserve refunded", timestamp, payload.transaction_id),
        )
        db.commit()
        account = ensure_credit_account(db, payload.license_key)
        return {
            "refunded_credits": reserved,
            "account": serialize_credit_account(account, license_row),
        }


@app.post("/client/execute")
def client_execute_node(payload: ClientExecuteRequest) -> dict[str, Any]:
    started = time.perf_counter()
    model_id = infer_execute_model_id(payload)
    model_group = infer_execute_model_group(payload.node_type, payload.model_group)
    if not model_id:
        raise HTTPException(status_code=400, detail="缺少模型 ID，无法选择平台线路")

    normalized_payload = ClientExecuteRequest(
        license_key=payload.license_key,
        device_id=payload.device_id,
        model_id=model_id,
        model_group=model_group,
        node_type=payload.node_type,
        route_id=payload.route_id,
        node_id=payload.node_id,
        config=payload.config,
        inputs=payload.inputs,
        request_id=payload.request_id or payload.node_id,
    )

    transaction_id: int | None = None
    reserved_credits = 0
    route: dict[str, Any] | None = None
    license_row: dict[str, Any] | None = None

    with get_db() as db:
        license_row, _device_row = validate_credit_device(db, normalized_payload.license_key, normalized_payload.device_id)
        route = find_executable_model_route(db, model_id, normalized_payload.route_id, model_group)
        if not route:
            raise HTTPException(status_code=404, detail=f"平台还没有为模型 {model_id} 配置可用线路，请先在母版添加模型线路")

        if not str(route.get("provider_base_url") or "").strip():
            raise HTTPException(status_code=400, detail="平台线路缺少 Base URL，请在母版供货商配置中补充")
        if not str(route.get("provider_api_key") or "").strip():
            raise HTTPException(status_code=400, detail="平台线路缺少 API Key，请在母版供货商配置中补充")

        credit_payload = ClientCreditBaseRequest(
            license_key=normalized_payload.license_key,
            device_id=normalized_payload.device_id,
            model_id=model_id,
            model_group=model_group,
            node_type=normalized_payload.node_type,
            route_id=int(route["id"]),
        )
        quote = build_credit_quote(db, credit_payload)
        transaction_id, reserved_credits, account_view = reserve_credit_for_execute(
            db,
            normalized_payload.license_key,
            normalized_payload.device_id,
            normalized_payload,
            quote,
            license_row,
        )

    try:
        result = call_execute_backend(normalized_payload, route)
    except HTTPException as error:
        latency_ms = int((time.perf_counter() - started) * 1000)
        with get_db() as db:
            account_view = refund_reserved_credit(
                db,
                normalized_payload.license_key,
                transaction_id,
                str(error.detail),
                license_row or {},
            ) if transaction_id else serialize_credit_account(ensure_credit_account(db, normalized_payload.license_key), license_row or {})
            record_model_call_log(
                db,
                ModelCallLogCreateRequest(
                    route_id=int(route["id"]) if route else None,
                    provider_id=int(route["provider_id"]) if route else None,
                    license_key=normalized_payload.license_key,
                    device_id=normalized_payload.device_id,
                    model_id=model_id,
                    model_group=model_group,
                    node_type=normalized_payload.node_type,
                    success=False,
                    latency_ms=latency_ms,
                    error_code=f"HTTP_{error.status_code}",
                    error_message=str(error.detail),
                    tokens_charged=0,
                ),
            )
            db.commit()
        raise
    except Exception as error:
        latency_ms = int((time.perf_counter() - started) * 1000)
        with get_db() as db:
            account_view = refund_reserved_credit(
                db,
                normalized_payload.license_key,
                transaction_id,
                str(error),
                license_row or {},
            ) if transaction_id else serialize_credit_account(ensure_credit_account(db, normalized_payload.license_key), license_row or {})
            record_model_call_log(
                db,
                ModelCallLogCreateRequest(
                    route_id=int(route["id"]) if route else None,
                    provider_id=int(route["provider_id"]) if route else None,
                    license_key=normalized_payload.license_key,
                    device_id=normalized_payload.device_id,
                    model_id=model_id,
                    model_group=model_group,
                    node_type=normalized_payload.node_type,
                    success=False,
                    latency_ms=latency_ms,
                    error_code="PROXY_ERROR",
                    error_message=str(error),
                    tokens_charged=0,
                ),
            )
            db.commit()
        raise HTTPException(status_code=502, detail=f"平台代理执行失败：{error}") from error

    latency_ms = int((time.perf_counter() - started) * 1000)
    with get_db() as db:
        account_view = settle_reserved_credit(
            db,
            normalized_payload.license_key,
            transaction_id,
            reserved_credits,
            "Client proxy execution completed",
            license_row or {},
        ) if transaction_id else serialize_credit_account(ensure_credit_account(db, normalized_payload.license_key), license_row or {})
        record_model_call_log(
            db,
            ModelCallLogCreateRequest(
                route_id=int(route["id"]) if route else None,
                provider_id=int(route["provider_id"]) if route else None,
                license_key=normalized_payload.license_key,
                device_id=normalized_payload.device_id,
                model_id=model_id,
                model_group=model_group,
                node_type=normalized_payload.node_type,
                success=True,
                latency_ms=latency_ms,
                tokens_charged=reserved_credits,
            ),
        )
        db.commit()

    return {
        "output": result.get("output"),
        "meta": {
            **(result.get("meta") if isinstance(result.get("meta"), dict) else {}),
            "modelId": model_id,
            "routeId": int(route["id"]) if route else None,
            "routeName": route.get("route_name") if route else "",
            "platformProxy": True,
        },
        "route": {
            "id": int(route["id"]) if route else None,
            "model_id": model_id,
            "display_name": route.get("display_name") if route else "",
            "route_name": route.get("route_name") if route else "",
            "model_group": model_group,
            "token_cost": int(route.get("token_cost") or 0) if route else 0,
        },
        "account": account_view,
        "credits": account_view,
    }


@app.get("/admin", response_class=HTMLResponse)
def admin_page() -> str:
    return """
    <!doctype html>
    <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>AWEI 授权管理</title>
      <style>
        body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #0b0b10; color: #eee; }
        main { max-width: 1120px; margin: 0 auto; padding: 28px; }
        section { border: 1px solid #242436; background: #12121b; border-radius: 12px; padding: 18px; margin: 16px 0; }
        input, textarea, button { border-radius: 8px; border: 1px solid #303048; background: #0b0b10; color: #eee; padding: 9px 10px; }
        button { cursor: pointer; background: #5b5cf6; border-color: #7374ff; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { border-bottom: 1px solid #242436; padding: 10px; text-align: left; vertical-align: top; }
        .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
        .muted { color: #8a8aa0; font-size: 12px; }
        .danger { background: #9f1239; border-color: #be123c; }
      </style>
    </head>
    <body>
      <main>
        <h1>AWEI 授权管理</h1>
        <p class="muted">第一版轻量后台：创建授权、查看设备、禁用客户/电脑、配置版本更新。</p>
        <section>
          <h2>管理员 Token</h2>
          <div class="row">
            <input id="token" placeholder="LICENSE_ADMIN_TOKEN" style="min-width: 360px" />
            <button onclick="loadAll()">加载数据</button>
          </div>
        </section>
        <section>
          <h2>新建授权</h2>
          <div class="row">
            <input id="customer" placeholder="公司名称" />
            <input id="contact" placeholder="联系人/备注" />
            <input id="expires" placeholder="到期时间，如 2027-05-12T00:00:00+00:00" style="min-width: 320px" />
            <input id="maxDevices" type="number" value="3" min="1" style="width: 90px" />
            <button onclick="createLicense()">创建</button>
          </div>
        </section>
        <section><h2>授权列表</h2><div id="licenses"></div></section>
        <section><h2>设备列表</h2><div id="devices"></div></section>
        <section>
          <h2>版本配置</h2>
          <div class="row">
            <input id="latest" placeholder="最新版本 1.0.0" />
            <input id="minimum" placeholder="最低可用版本 1.0.0" />
            <input id="download" placeholder="下载地址" style="min-width: 360px" />
            <input id="force" type="checkbox" />
            <span class="muted">强制更新</span>
          </div>
          <p><textarea id="notes" placeholder="更新说明" style="width:100%; min-height:80px"></textarea></p>
          <button onclick="saveVersion()">保存版本配置</button>
        </section>
      </main>
      <script>
        const token = () => document.getElementById('token').value;
        const headers = () => ({ 'Content-Type': 'application/json', 'X-Admin-Token': token() });
        const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
        async function api(path, options = {}) {
          const res = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
          if (!res.ok) throw new Error(await res.text());
          return res.json();
        }
        async function loadAll() {
          const [licenses, devices, version] = await Promise.all([
            api('/admin/licenses'),
            api('/admin/devices'),
            api('/admin/version'),
          ]);
          document.getElementById('licenses').innerHTML = renderLicenses(licenses);
          document.getElementById('devices').innerHTML = renderDevices(devices);
          latest.value = version.latest_version || '';
          minimum.value = version.min_version || '';
          download.value = version.download_url || '';
          notes.value = version.release_notes || '';
          force.checked = Boolean(version.force_update);
        }
        function renderLicenses(items) {
          return `<table><tr><th>授权码</th><th>客户</th><th>到期</th><th>状态</th><th>设备数</th><th>操作</th></tr>${items.map(item => `
            <tr>
              <td><code>${esc(item.license_key)}</code></td>
              <td>${esc(item.customer_name)}<br><span class="muted">${esc(item.contact)}</span></td>
              <td>${esc(item.expires_at)}</td>
              <td>${esc(item.status)}</td>
              <td>${esc(item.device_count)} / ${esc(item.max_devices)}</td>
              <td><button class="danger" onclick="toggleLicense('${esc(item.license_key)}', '${item.status === 'enabled' ? 'disabled' : 'enabled'}')">${item.status === 'enabled' ? '禁用' : '启用'}</button></td>
            </tr>`).join('')}</table>`;
        }
        function renderDevices(items) {
          return `<table><tr><th>设备</th><th>客户</th><th>状态</th><th>最近在线</th><th>备注</th><th>操作</th></tr>${items.map(item => `
            <tr>
              <td><code>${esc(item.device_id)}</code><br>${esc(item.hostname)} / ${esc(item.os_name)} / v${esc(item.app_version)}</td>
              <td>${esc(item.customer_name)}<br><span class="muted">${esc(item.license_key)}</span></td>
              <td>${esc(item.status)}</td>
              <td>${esc(item.last_seen)}</td>
              <td><input id="note-${esc(item.device_id)}" value="${esc(item.note)}" /></td>
              <td>
                <button onclick="saveDevice('${esc(item.device_id)}', '${esc(item.status)}')">保存备注</button>
                <button class="danger" onclick="toggleDevice('${esc(item.device_id)}', '${item.status === 'enabled' ? 'disabled' : 'enabled'}')">${item.status === 'enabled' ? '禁用' : '启用'}</button>
              </td>
            </tr>`).join('')}</table>`;
        }
        async function createLicense() {
          await api('/admin/licenses', {
            method: 'POST',
            body: JSON.stringify({
              customer_name: customer.value,
              contact: contact.value,
              expires_at: expires.value,
              max_devices: Number(maxDevices.value || 1),
            }),
          });
          await loadAll();
        }
        async function toggleLicense(key, status) {
          await api(`/admin/licenses/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
          await loadAll();
        }
        async function saveDevice(id, status) {
          await api(`/admin/devices/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ status, note: document.getElementById(`note-${id}`).value }),
          });
          await loadAll();
        }
        async function toggleDevice(id, status) {
          await api(`/admin/devices/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ status, note: document.getElementById(`note-${id}`)?.value || '' }),
          });
          await loadAll();
        }
        async function saveVersion() {
          await api('/admin/version', {
            method: 'PUT',
            body: JSON.stringify({
              latest_version: latest.value,
              min_version: minimum.value,
              download_url: download.value,
              release_notes: notes.value,
              force_update: force.checked,
            }),
          });
          await loadAll();
        }
      </script>
    </body>
    </html>
    """


@app.get("/admin/licenses", dependencies=[Depends(require_admin)])
def list_licenses() -> list[dict[str, Any]]:
    with get_db() as db:
        rows = db.execute(
            """
            SELECT licenses.*,
              (SELECT COUNT(*) FROM devices WHERE devices.license_key = licenses.license_key AND devices.status = 'enabled') AS device_count,
              (SELECT COUNT(*) FROM devices WHERE devices.license_key = licenses.license_key AND devices.status = 'pending') AS pending_device_count,
              (SELECT COUNT(*) FROM devices WHERE devices.license_key = licenses.license_key AND devices.status = 'disabled') AS disabled_device_count
            FROM licenses
            ORDER BY created_at DESC
            """
        ).fetchall()
        results = [attach_credit_to_license(db, row) for row in rows]
        db.commit()
        return results


@app.post("/admin/licenses", dependencies=[Depends(require_admin)])
def create_license(payload: LicenseCreateRequest) -> dict[str, Any]:
    parse_dt(payload.expires_at)
    key = payload.license_key or f"AWEI-{secrets.token_urlsafe(18).replace('_', '').replace('-', '')[:20].upper()}"
    timestamp = now_iso()
    with get_db() as db:
        try:
            db.execute(
                """
                INSERT INTO licenses
                  (license_key, customer_name, contact, expires_at, status, max_devices, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'enabled', ?, ?, ?, ?)
                """,
                (
                    key,
                    payload.customer_name,
                    payload.contact,
                    payload.expires_at,
                    payload.max_devices,
                    payload.notes,
                    timestamp,
                    timestamp,
                ),
            )
            ensure_credit_account(db, key)
            grant_initial_credits(db, key, int(payload.initial_credits or 0), timestamp)
            db.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="License key already exists") from exc
        row = db.execute("SELECT * FROM licenses WHERE license_key = ?", (key,)).fetchone()
        return attach_credit_to_license(db, row) if row else {}


@app.patch("/admin/licenses/{license_key}", dependencies=[Depends(require_admin)])
def update_license(license_key: str, payload: LicenseUpdateRequest) -> dict[str, Any]:
    fields: dict[str, Any] = payload.model_dump(exclude_unset=True)
    if "status" in fields and fields["status"] not in {"enabled", "disabled"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    if "expires_at" in fields and fields["expires_at"]:
        parse_dt(fields["expires_at"])
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    fields["updated_at"] = now_iso()
    setters = ", ".join(f"{key} = ?" for key in fields)
    values = list(fields.values()) + [license_key]
    with get_db() as db:
        db.execute(f"UPDATE licenses SET {setters} WHERE license_key = ?", values)
        db.commit()
        row = row_to_dict(db.execute("SELECT * FROM licenses WHERE license_key = ?", (license_key,)).fetchone())
        if not row:
            raise HTTPException(status_code=404, detail="License not found")
        return attach_credit_to_license(db, row)


@app.get("/admin/devices", dependencies=[Depends(require_admin)])
def list_devices() -> list[dict[str, Any]]:
    with get_db() as db:
        rows = db.execute(
            """
            SELECT devices.*,
              licenses.customer_name,
              licenses.status AS license_status,
              licenses.expires_at AS license_expires_at,
              CASE
                WHEN licenses.status != 'enabled' THEN 'license_disabled'
                WHEN devices.status != 'enabled' THEN devices.status
                ELSE 'enabled'
              END AS effective_status
            FROM devices
            LEFT JOIN licenses ON licenses.license_key = devices.license_key
            ORDER BY last_seen DESC
            """
        ).fetchall()
        return [dict(row) for row in rows]


@app.patch("/admin/devices/{device_id}", dependencies=[Depends(require_admin)])
def update_device(device_id: str, payload: DeviceUpdateRequest) -> dict[str, Any]:
    fields = payload.model_dump(exclude_unset=True)
    if "status" in fields and fields["status"] not in {"pending", "enabled", "disabled"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    if "nickname" in fields and fields["nickname"] is not None:
        fields["nickname"] = normalize_nickname(fields["nickname"])
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    if fields.get("status") == "enabled":
        with get_db() as db:
            row = row_to_dict(
                db.execute(
                    """
                    SELECT devices.license_key, devices.status, licenses.max_devices
                    FROM devices
                    JOIN licenses ON licenses.license_key = devices.license_key
                    WHERE devices.device_id = ?
                    """,
                    (device_id,),
                ).fetchone()
            )
            if not row:
                raise HTTPException(status_code=404, detail="Device not found")
            if row["status"] != "enabled":
                enabled_count = db.execute(
                    "SELECT COUNT(*) FROM devices WHERE license_key = ? AND status = 'enabled'",
                    (row["license_key"],),
                ).fetchone()[0]
                if enabled_count >= int(row["max_devices"]):
                    raise HTTPException(status_code=403, detail="Device limit reached")
            fields["approved_at"] = now_iso()
    setters = ", ".join(f"{key} = ?" for key in fields)
    values = list(fields.values()) + [device_id]
    with get_db() as db:
        db.execute(f"UPDATE devices SET {setters} WHERE device_id = ?", values)
        db.commit()
        row = row_to_dict(db.execute("SELECT * FROM devices WHERE device_id = ?", (device_id,)).fetchone())
        if not row:
            raise HTTPException(status_code=404, detail="Device not found")
        return row


@app.delete("/admin/devices/{device_id}", dependencies=[Depends(require_admin)])
def delete_device(device_id: str) -> dict[str, Any]:
    with get_db() as db:
        cursor = db.execute("DELETE FROM devices WHERE device_id = ?", (device_id,))
        db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Device not found")
        return {"deleted": True, "device_id": device_id}


@app.get("/admin/credits/accounts", dependencies=[Depends(require_admin)])
def list_credit_accounts() -> list[dict[str, Any]]:
    with get_db() as db:
        license_rows = db.execute("SELECT * FROM licenses ORDER BY created_at DESC").fetchall()
        results: list[dict[str, Any]] = []
        for license_row in license_rows:
            account = ensure_credit_account(db, license_row["license_key"])
            results.append(serialize_credit_account(account, dict(license_row)))
        db.commit()
        return results


@app.post("/admin/credits/adjust", dependencies=[Depends(require_admin)])
def adjust_credit_account(payload: CreditAdjustRequest) -> dict[str, Any]:
    if payload.amount == 0:
        raise HTTPException(status_code=400, detail="Amount must not be zero")

    timestamp = now_iso()
    with get_db() as db:
        account = ensure_credit_account(db, payload.license_key)
        next_balance = int(account.get("balance") or 0) + payload.amount
        if next_balance < int(account.get("reserved_balance") or 0):
            raise HTTPException(status_code=400, detail="Balance cannot be lower than reserved credits")

        lifetime_field = "lifetime_granted" if payload.amount > 0 else None
        db.execute(
            f"""
            UPDATE credit_accounts
            SET balance = ?,
                {f"{lifetime_field} = {lifetime_field} + ?," if lifetime_field else ""}
                updated_at = ?
            WHERE license_key = ?
            """,
            ([next_balance, abs(payload.amount), timestamp, payload.license_key] if lifetime_field else [next_balance, timestamp, payload.license_key]),
        )
        db.execute(
            """
            INSERT INTO credit_transactions
              (license_key, amount, reserved_amount, settled_amount, transaction_type, status,
               reason, route_id, device_id, model_id, model_group, node_type, request_id,
               metadata_json, created_at, updated_at)
            VALUES (?, ?, 0, ?, 'adjustment', 'settled', ?, NULL, '', '', '', '', '', '{}', ?, ?)
            """,
            (
                payload.license_key,
                payload.amount,
                max(0, -payload.amount),
                payload.reason.strip() or "Admin adjustment",
                timestamp,
                timestamp,
            ),
        )
        db.commit()
        account = ensure_credit_account(db, payload.license_key)
        license_row = row_to_dict(db.execute("SELECT * FROM licenses WHERE license_key = ?", (payload.license_key,)).fetchone())
        return serialize_credit_account(account, license_row)


@app.get("/admin/credits/transactions", dependencies=[Depends(require_admin)])
def list_credit_transactions(license_key: str = "", limit: int = 80) -> list[dict[str, Any]]:
    safe_limit = max(1, min(int(limit or 80), 300))
    with get_db() as db:
        if license_key:
            rows = db.execute(
                """
                SELECT credit_transactions.*, licenses.customer_name
                FROM credit_transactions
                LEFT JOIN licenses ON licenses.license_key = credit_transactions.license_key
                WHERE credit_transactions.license_key = ?
                ORDER BY credit_transactions.id DESC
                LIMIT ?
                """,
                (license_key, safe_limit),
            ).fetchall()
        else:
            rows = db.execute(
                """
                SELECT credit_transactions.*, licenses.customer_name
                FROM credit_transactions
                LEFT JOIN licenses ON licenses.license_key = credit_transactions.license_key
                ORDER BY credit_transactions.id DESC
                LIMIT ?
                """,
                (safe_limit,),
            ).fetchall()
        return [serialize_credit_transaction(row) for row in rows]


@app.get("/admin/version", dependencies=[Depends(require_admin)])
def get_version() -> dict[str, Any]:
    with get_db() as db:
        return get_current_version(db)


@app.put("/admin/version", dependencies=[Depends(require_admin)])
def update_version(payload: VersionUpdateRequest) -> dict[str, Any]:
    timestamp = now_iso()
    with get_db() as db:
        cursor = db.execute(
            """
            INSERT INTO app_version_history
              (latest_version, min_version, download_url, release_notes, force_update, is_current, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?, '')
            """,
            (
                payload.latest_version.strip() or "1.0.0",
                payload.min_version.strip() or "1.0.0",
                payload.download_url.strip(),
                payload.release_notes.strip(),
                1 if payload.force_update else 0,
                timestamp,
                timestamp,
            ),
        )
        current = set_current_version(db, int(cursor.lastrowid))
        db.commit()
        return current


@app.get("/admin/versions", dependencies=[Depends(require_admin)])
def list_versions() -> list[dict[str, Any]]:
    with get_db() as db:
        rows = db.execute(
            """
            SELECT *
            FROM app_version_history
            WHERE deleted_at = ''
            ORDER BY is_current DESC, updated_at DESC, id DESC
            """
        ).fetchall()
        return [serialize_version(row) for row in rows]


@app.post("/admin/versions", dependencies=[Depends(require_admin)])
def create_version(payload: VersionCreateRequest) -> dict[str, Any]:
    timestamp = now_iso()
    with get_db() as db:
        cursor = db.execute(
            """
            INSERT INTO app_version_history
              (latest_version, min_version, download_url, release_notes, force_update, is_current, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?, '')
            """,
            (
                payload.latest_version.strip() or "1.0.0",
                payload.min_version.strip() or "1.0.0",
                payload.download_url.strip(),
                payload.release_notes.strip(),
                1 if payload.force_update else 0,
                timestamp,
                timestamp,
            ),
        )
        if payload.is_current:
            version = set_current_version(db, int(cursor.lastrowid))
        else:
            row = db.execute("SELECT * FROM app_version_history WHERE id = ?", (cursor.lastrowid,)).fetchone()
            version = serialize_version(row) if row else {}
        db.commit()
        return version


@app.patch("/admin/versions/{version_id}", dependencies=[Depends(require_admin)])
def update_version_record(version_id: int, payload: VersionPatchRequest) -> dict[str, Any]:
    fields = payload.model_dump(exclude_unset=True)
    for key in ("latest_version", "min_version", "download_url", "release_notes"):
        if key in fields and fields[key] is not None:
            fields[key] = fields[key].strip()
    if "force_update" in fields and fields["force_update"] is not None:
        fields["force_update"] = 1 if fields["force_update"] else 0
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    fields["updated_at"] = now_iso()
    setters = ", ".join(f"{key} = ?" for key in fields)
    values = list(fields.values()) + [version_id]
    with get_db() as db:
        cursor = db.execute(
            f"UPDATE app_version_history SET {setters} WHERE id = ? AND deleted_at = ''",
            values,
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Version not found")
        row = row_to_dict(db.execute("SELECT * FROM app_version_history WHERE id = ?", (version_id,)).fetchone()) or {}
        if row.get("is_current"):
            mirror_current_version(db, row)
        db.commit()
        return serialize_version(row)


@app.post("/admin/versions/{version_id}/activate", dependencies=[Depends(require_admin)])
def activate_version(version_id: int) -> dict[str, Any]:
    with get_db() as db:
        version = set_current_version(db, version_id)
        db.commit()
        return version


@app.delete("/admin/versions/{version_id}", dependencies=[Depends(require_admin)])
def delete_version(version_id: int) -> dict[str, Any]:
    timestamp = now_iso()
    with get_db() as db:
        row = row_to_dict(
            db.execute(
                "SELECT * FROM app_version_history WHERE id = ? AND deleted_at = ''",
                (version_id,),
            ).fetchone()
        )
        if not row:
            raise HTTPException(status_code=404, detail="Version not found")
        remaining_count = db.execute(
            "SELECT COUNT(*) FROM app_version_history WHERE deleted_at = '' AND id != ?",
            (version_id,),
        ).fetchone()[0]
        if remaining_count == 0:
            raise HTTPException(status_code=400, detail="Cannot delete the only version")
        db.execute(
            """
            UPDATE app_version_history
            SET deleted_at = ?, is_current = 0, updated_at = ?
            WHERE id = ?
            """,
            (timestamp, timestamp, version_id),
        )
        if row.get("is_current"):
            next_row = db.execute(
                """
                SELECT id
                FROM app_version_history
                WHERE deleted_at = ''
                ORDER BY updated_at DESC, id DESC
                LIMIT 1
                """
            ).fetchone()
            if next_row:
                set_current_version(db, int(next_row["id"]))
        db.commit()
        return {"deleted": True, "id": version_id}


@app.get("/admin/announcements", dependencies=[Depends(require_admin)])
def list_announcements() -> list[dict[str, Any]]:
    with get_db() as db:
        rows = db.execute(
            """
            SELECT *
            FROM announcements
            WHERE deleted_at = ''
            ORDER BY pinned DESC, updated_at DESC, id DESC
            """
        ).fetchall()
        return [serialize_announcement(row) for row in rows]


@app.post("/admin/announcements", dependencies=[Depends(require_admin)])
def create_announcement(payload: AnnouncementCreateRequest) -> dict[str, Any]:
    validate_optional_window(payload.start_at, payload.end_at)
    timestamp = now_iso()
    with get_db() as db:
        cursor = db.execute(
            """
            INSERT INTO announcements
              (title, body, kind, scope_license_key, is_active, pinned, start_at, end_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.title.strip(),
                payload.body.strip(),
                normalize_announcement_kind(payload.kind),
                payload.scope_license_key.strip(),
                1 if payload.is_active else 0,
                1 if payload.pinned else 0,
                payload.start_at.strip(),
                payload.end_at.strip(),
                timestamp,
                timestamp,
            ),
        )
        db.commit()
        row = db.execute("SELECT * FROM announcements WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return serialize_announcement(row) if row else {}


@app.patch("/admin/announcements/{announcement_id}", dependencies=[Depends(require_admin)])
def update_announcement(announcement_id: int, payload: AnnouncementUpdateRequest) -> dict[str, Any]:
    fields = payload.model_dump(exclude_unset=True)
    if "kind" in fields and fields["kind"] is not None:
        fields["kind"] = normalize_announcement_kind(fields["kind"])
    if "title" in fields and fields["title"] is not None:
        fields["title"] = fields["title"].strip()
    if "body" in fields and fields["body"] is not None:
        fields["body"] = fields["body"].strip()
    if "scope_license_key" in fields and fields["scope_license_key"] is not None:
        fields["scope_license_key"] = fields["scope_license_key"].strip()
    validate_optional_window(fields.get("start_at") or "", fields.get("end_at") or "")
    if "is_active" in fields:
        fields["is_active"] = 1 if fields["is_active"] else 0
    if "pinned" in fields:
        fields["pinned"] = 1 if fields["pinned"] else 0
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    fields["updated_at"] = now_iso()
    setters = ", ".join(f"{key} = ?" for key in fields)
    values = list(fields.values()) + [announcement_id]
    with get_db() as db:
        cursor = db.execute(f"UPDATE announcements SET {setters} WHERE id = ? AND deleted_at = ''", values)
        db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Announcement not found")
        row = db.execute("SELECT * FROM announcements WHERE id = ?", (announcement_id,)).fetchone()
        return serialize_announcement(row) if row else {}


@app.delete("/admin/announcements/{announcement_id}", dependencies=[Depends(require_admin)])
def delete_announcement(announcement_id: int) -> dict[str, Any]:
    with get_db() as db:
        timestamp = now_iso()
        cursor = db.execute(
            """
            UPDATE announcements
            SET deleted_at = ?, is_active = 0, pinned = 0, updated_at = ?
            WHERE id = ? AND deleted_at = ''
            """,
            (timestamp, timestamp, announcement_id),
        )
        db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Announcement not found")
        return {"deleted": True, "id": announcement_id}


@app.get("/admin/model-providers", dependencies=[Depends(require_admin)])
def list_model_providers() -> list[dict[str, Any]]:
    with get_db() as db:
        rows = db.execute(
            """
            SELECT model_providers.*,
              (SELECT COUNT(*) FROM model_routes WHERE model_routes.provider_id = model_providers.id) AS route_count
            FROM model_providers
            ORDER BY status DESC, priority ASC, updated_at DESC, id DESC
            """
        ).fetchall()
        return [serialize_model_provider(row) for row in rows]


@app.post("/admin/model-providers", dependencies=[Depends(require_admin)])
def create_model_provider(payload: ModelProviderCreateRequest) -> dict[str, Any]:
    timestamp = now_iso()
    with get_db() as db:
        cursor = db.execute(
            """
            INSERT INTO model_providers
              (name, group_name, provider_type, base_url, api_key_cipher, supported_models,
               status, priority, cost_multiplier, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.name.strip(),
                normalize_text(payload.group_name, "General") or "General",
                normalize_text(payload.provider_type, "openai-compatible") or "openai-compatible",
                payload.base_url.strip(),
                payload.api_key.strip(),
                payload.supported_models.strip(),
                normalize_model_status(payload.status),
                payload.priority,
                payload.cost_multiplier,
                payload.notes.strip(),
                timestamp,
                timestamp,
            ),
        )
        db.commit()
        row = db.execute("SELECT * FROM model_providers WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return serialize_model_provider(row) if row else {}


@app.patch("/admin/model-providers/{provider_id}", dependencies=[Depends(require_admin)])
def update_model_provider(provider_id: int, payload: ModelProviderUpdateRequest) -> dict[str, Any]:
    fields = payload.model_dump(exclude_unset=True)
    if "status" in fields and fields["status"] is not None:
        fields["status"] = normalize_model_status(fields["status"])
    for key in ("name", "group_name", "provider_type", "base_url", "supported_models", "notes"):
        if key in fields and fields[key] is not None:
            fields[key] = fields[key].strip()
    if "api_key" in fields:
        fields["api_key_cipher"] = (fields.pop("api_key") or "").strip()
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    fields["updated_at"] = now_iso()
    setters = ", ".join(f"{key} = ?" for key in fields)
    values = list(fields.values()) + [provider_id]
    with get_db() as db:
        cursor = db.execute(f"UPDATE model_providers SET {setters} WHERE id = ?", values)
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Provider not found")
        db.commit()
        row = db.execute("SELECT * FROM model_providers WHERE id = ?", (provider_id,)).fetchone()
        return serialize_model_provider(row) if row else {}


@app.get("/admin/model-routes", dependencies=[Depends(require_admin)])
def list_model_routes() -> list[dict[str, Any]]:
    with get_db() as db:
        rows = db.execute(
            """
            SELECT model_routes.*,
              model_providers.name AS provider_name,
              model_providers.group_name AS provider_group,
              model_providers.status AS provider_status
            FROM model_routes
            JOIN model_providers ON model_providers.id = model_routes.provider_id
            ORDER BY model_routes.model_group ASC, model_routes.model_id ASC, model_routes.weight DESC, model_routes.id DESC
            """
        ).fetchall()
        return [serialize_model_route(row) for row in rows]


@app.post("/admin/model-routes", dependencies=[Depends(require_admin)])
def create_model_route(payload: ModelRouteCreateRequest) -> dict[str, Any]:
    timestamp = now_iso()
    with get_db() as db:
        ensure_provider_exists(db, payload.provider_id)
        cursor = db.execute(
            """
            INSERT INTO model_routes
              (model_id, display_name, model_group, provider_id, route_name, status,
               weight, token_cost, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.model_id.strip(),
                payload.display_name.strip(),
                normalize_model_group(payload.model_group, payload.model_id),
                payload.provider_id,
                payload.route_name.strip(),
                normalize_model_status(payload.status),
                payload.weight,
                payload.token_cost,
                payload.notes.strip(),
                timestamp,
                timestamp,
            ),
        )
        db.commit()
        row = db.execute(
            """
            SELECT model_routes.*,
              model_providers.name AS provider_name,
              model_providers.group_name AS provider_group,
              model_providers.status AS provider_status
            FROM model_routes
            JOIN model_providers ON model_providers.id = model_routes.provider_id
            WHERE model_routes.id = ?
            """,
            (cursor.lastrowid,),
        ).fetchone()
        return serialize_model_route(row) if row else {}


@app.patch("/admin/model-routes/{route_id}", dependencies=[Depends(require_admin)])
def update_model_route(route_id: int, payload: ModelRouteUpdateRequest) -> dict[str, Any]:
    fields = payload.model_dump(exclude_unset=True)
    if "status" in fields and fields["status"] is not None:
        fields["status"] = normalize_model_status(fields["status"])
    for key in ("model_id", "display_name", "model_group", "route_name", "notes"):
        if key in fields and fields[key] is not None:
            fields[key] = fields[key].strip()
    if "model_group" in fields and fields["model_group"] is not None:
        fields["model_group"] = normalize_model_group(
            fields["model_group"],
            fields.get("model_id") or "",
        )
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    fields["updated_at"] = now_iso()
    setters = ", ".join(f"{key} = ?" for key in fields)
    values = list(fields.values()) + [route_id]
    with get_db() as db:
        if "provider_id" in fields and fields["provider_id"] is not None:
            ensure_provider_exists(db, int(fields["provider_id"]))
        cursor = db.execute(f"UPDATE model_routes SET {setters} WHERE id = ?", values)
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Route not found")
        db.commit()
        row = db.execute(
            """
            SELECT model_routes.*,
              model_providers.name AS provider_name,
              model_providers.group_name AS provider_group,
              model_providers.status AS provider_status
            FROM model_routes
            JOIN model_providers ON model_providers.id = model_routes.provider_id
            WHERE model_routes.id = ?
            """,
            (route_id,),
        ).fetchone()
        return serialize_model_route(row) if row else {}


@app.get("/admin/model-health", dependencies=[Depends(require_admin)])
def get_model_health() -> dict[str, Any]:
    with get_db() as db:
        return build_model_health_summary(db)


@app.post("/admin/model-call-logs", dependencies=[Depends(require_admin)])
def create_model_call_log(payload: ModelCallLogCreateRequest) -> dict[str, Any]:
    with get_db() as db:
        result = record_model_call_log(db, payload)
        db.commit()
        return result
