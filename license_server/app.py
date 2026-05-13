from __future__ import annotations

import os
import secrets
import sqlite3
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
        return [dict(row) for row in rows]


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
            db.commit()
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="License key already exists") from exc
        return row_to_dict(db.execute("SELECT * FROM licenses WHERE license_key = ?", (key,)).fetchone()) or {}


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
        return row


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
