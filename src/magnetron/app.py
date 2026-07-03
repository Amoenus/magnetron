from __future__ import annotations

import base64
import datetime as dt
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

import uvicorn
from fastapi import FastAPI, Form, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field


INFO_HASH_HEX = re.compile(r"^[A-Fa-f0-9]{40}$")
INFO_HASH_BASE32 = re.compile(r"^[A-Z2-7a-z]{32}$")
VALID_ACTIONS = {"index", "download", "both"}
VALID_CONTENT_TYPES = {"unknown", "movie", "tv_show", "ebook", "audiobook", "music", "software", "xxx"}
VALID_CONTENT_SOURCES = {"", "tmdb", "imdb"}

Action = Literal["index", "download", "both"]
PACKAGE_DIR = Path(__file__).resolve().parent
TEMPLATES = Jinja2Templates(directory=PACKAGE_DIR / "templates")
STATIC_DIR = PACKAGE_DIR / "static"
CONFIG_ENV = "MAGNETRON_CONFIG_PATH"
HISTORY_CACHE_TTL_SECONDS = 15
CONFIGURABLE_FIELDS = {
    "bitmagnet_url": ("BITMAGNET_URL", "http://bitmagnet:3333", False, "bitmagnet URL"),
    "bitmagnet_source": ("BITMAGNET_SOURCE", "manual-web", False, "bitmagnet import source"),
    "qbittorrent_url": ("QBITTORRENT_URL", "http://qbittorrent:8080", False, "qBittorrent URL"),
    "qbittorrent_api_key": ("QBITTORRENT_API_KEY", "", True, "qBittorrent API key"),
    "qbittorrent_category": ("QBITTORRENT_CATEGORY", "discord-intake", False, "qBittorrent category"),
    "qbittorrent_tags": ("QBITTORRENT_TAGS", "discord-intake", False, "qBittorrent tags"),
    "default_action": ("DEFAULT_ACTION", "index", False, "default action"),
}


BITMAGNET_SUBMISSIONS_QUERY = """
query MagnetronSubmissions($input: TorrentContentSearchQueryInput!) {
  torrentContent {
    search(input: $input) {
      items {
        id
        infoHash
        contentType
        contentSource
        contentId
        title
        publishedAt
        createdAt
        updatedAt
        seeders
        leechers
        videoResolution
        videoSource
        videoCodec
        torrent {
          name
          magnetUri
          sources {
            key
            name
            importId
            seeders
            leechers
          }
        }
        content {
          type
          source
          id
          title
          releaseYear
          metadataSource {
            key
            name
          }
        }
      }
    }
  }
}
"""


@dataclass(frozen=True)
class Settings:
    port: int
    base_url: str
    bitmagnet_url: str
    bitmagnet_source: str
    qbittorrent_url: str
    qbittorrent_api_key: str
    qbittorrent_category: str
    qbittorrent_tags: str
    default_action: str

    @classmethod
    def from_env(cls) -> "Settings":
        return cls.from_sources(os.environ, load_ui_config(config_path()))

    @classmethod
    def from_sources(cls, env: os._Environ[str] | dict[str, str], persisted: dict[str, str] | None = None) -> "Settings":
        persisted = persisted or {}
        values: dict[str, str] = {}
        for field_name, (env_name, default, _sensitive, _label) in CONFIGURABLE_FIELDS.items():
            values[field_name] = env.get(env_name, persisted.get(field_name, default))

        default_action = values["default_action"].strip().lower()
        if default_action not in VALID_ACTIONS:
            default_action = "index"
        return cls(
            port=int(env.get("PORT", "8080")),
            base_url=env.get("BASE_URL", "http://localhost:8080").rstrip("/"),
            bitmagnet_url=values["bitmagnet_url"].rstrip("/"),
            bitmagnet_source=values["bitmagnet_source"].strip() or "manual-web",
            qbittorrent_url=values["qbittorrent_url"].rstrip("/"),
            qbittorrent_api_key=values["qbittorrent_api_key"],
            qbittorrent_category=values["qbittorrent_category"].strip(),
            qbittorrent_tags=values["qbittorrent_tags"].strip(),
            default_action=default_action,
        )


@dataclass(frozen=True)
class ParsedMagnet:
    magnet: str
    info_hash: str
    name: str


@dataclass
class DownstreamResult:
    ok: bool
    status: int | None
    message: str


@dataclass
class Submission:
    timestamp: str
    action: str
    content_type: str
    content_source: str
    content_id: str
    magnet: str
    info_hash: str
    name: str
    bitmagnet: DownstreamResult | None
    qbittorrent: DownstreamResult | None


@dataclass(frozen=True)
class HistoryItem:
    timestamp: str
    action: str
    content_type: str
    content_source: str
    content_id: str
    magnet: str
    info_hash: str
    name: str
    discovered_title: str
    discovered_source: str
    discovered_id: str
    release_year: str
    video_summary: str
    seeders: int | None
    leechers: int | None
    bitmagnet: DownstreamResult | None
    qbittorrent: DownstreamResult | None
    source: str


@dataclass(frozen=True)
class HistoryResult:
    items: list[HistoryItem]
    status: str
    warning: str = ""


@dataclass(frozen=True)
class ConfigField:
    name: str
    label: str
    value: str
    locked: bool
    sensitive: bool
    env_name: str
    display_value: str


history_cache_lock = threading.Lock()
history_cache: dict[tuple[Settings, int], tuple[float, list[HistoryItem]]] = {}


def config_path() -> Path:
    configured = os.getenv(CONFIG_ENV)
    if configured:
        return Path(configured).expanduser()
    root = os.getenv("XDG_CONFIG_HOME")
    if root:
        return Path(root).expanduser() / "magnetron" / "config.json"
    return Path.home() / ".config" / "magnetron" / "config.json"


def load_ui_config(path: Path) -> dict[str, str]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {k: str(v) for k, v in raw.items() if k in CONFIGURABLE_FIELDS}


def save_ui_config(path: Path, values: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(values, handle, indent=2, sort_keys=True)
        handle.write("\n")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


class IntakeRequest(BaseModel):
    magnet: str = Field(min_length=1)
    action: Action = "index"
    contentType: str = "tv_show"
    contentSource: str = ""
    contentId: str = ""


class RecentSubmissions:
    def __init__(self, limit: int = 50) -> None:
        self._limit = limit
        self._items: list[Submission] = []
        self._lock = threading.Lock()

    def add(self, item: Submission) -> None:
        with self._lock:
            self._items.insert(0, item)
            del self._items[self._limit :]

    def list(self) -> list[Submission]:
        with self._lock:
            return list(self._items)


settings = Settings.from_env()
recent_submissions = RecentSubmissions()
app = FastAPI(
    title="Magnetron",
    description="Manual magnet intake for bitmagnet and qBittorrent.",
    version="0.1.0",
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def current_settings() -> Settings:
    return Settings.from_env()


def config_fields(settings: Settings, env: os._Environ[str] | dict[str, str] = os.environ) -> list[ConfigField]:
    fields: list[ConfigField] = []
    for name, (env_name, _default, sensitive, label) in CONFIGURABLE_FIELDS.items():
        value = str(getattr(settings, name))
        locked = env_name in env
        display_value = "Configured" if sensitive and value else value
        fields.append(
            ConfigField(
                name=name,
                label=label,
                value=value,
                locked=locked,
                sensitive=sensitive,
                env_name=env_name,
                display_value=display_value,
            )
        )
    return fields


def update_persisted_config(form_values: dict[str, str], env: os._Environ[str] | dict[str, str] = os.environ) -> None:
    path = config_path()
    persisted = load_ui_config(path)
    for name, (env_name, default, sensitive, _label) in CONFIGURABLE_FIELDS.items():
        if env_name in env:
            persisted.pop(name, None)
            continue
        raw_value = form_values.get(name, "")
        if sensitive and raw_value == "":
            continue
        value = raw_value if sensitive else raw_value.strip()
        if name == "default_action" and value not in VALID_ACTIONS:
            value = default
        persisted[name] = value
    save_ui_config(path, persisted)


def normalize_info_hash(value: str) -> str:
    if INFO_HASH_HEX.match(value):
        return value.upper()
    if INFO_HASH_BASE32.match(value):
        decoded = base64.b32decode(value.upper())
        return decoded.hex().upper()
    raise ValueError("magnet xt must contain a v1 btih hash in hex or base32 form")


def parse_magnet(magnet: str) -> ParsedMagnet:
    magnet = magnet.strip()
    parsed = urllib.parse.urlparse(magnet)
    if parsed.scheme != "magnet":
        raise ValueError("input must be a magnet link")

    params = urllib.parse.parse_qs(parsed.query)
    info_hash = ""
    for xt in params.get("xt", []):
        if xt.lower().startswith("urn:btih:"):
            info_hash = normalize_info_hash(xt.split(":")[-1])
            break
    if not info_hash:
        raise ValueError("magnet link does not include xt=urn:btih")

    name = params.get("dn", [""])[0].strip()
    return ParsedMagnet(magnet=magnet, info_hash=info_hash, name=name)


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def validate_http_url(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"unsupported URL scheme {parsed.scheme or '(empty)'}; expected http or https")


def request(
    method: str,
    url: str,
    *,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 15,
) -> DownstreamResult:
    try:
        validate_http_url(url)
        req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            payload = response.read(500).decode("utf-8", errors="replace")
            message = payload.strip() or response.reason
            return DownstreamResult(True, response.status, message)
    except urllib.error.HTTPError as exc:
        payload = exc.read(500).decode("utf-8", errors="replace")
        return DownstreamResult(False, exc.code, payload.strip() or exc.reason)
    except (OSError, ValueError) as exc:
        return DownstreamResult(False, None, str(exc))


def request_json(method: str, url: str, body: dict[str, Any], timeout: int = 15) -> dict[str, Any]:
    validate_http_url(url)
    payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        method=method,
        headers={"Content-Type": "application/json", "Connection": "close"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def import_to_bitmagnet(settings: Settings, parsed: ParsedMagnet) -> DownstreamResult:
    return import_to_bitmagnet_with_hint(settings, parsed, "unknown")


def normalize_content_type(value: str) -> str:
    content_type = value.strip().lower()
    return content_type if content_type in VALID_CONTENT_TYPES else "unknown"


def normalize_content_source(value: str) -> str:
    content_source = value.strip().lower()
    return content_source if content_source in VALID_CONTENT_SOURCES else ""


def normalize_content_id(value: str) -> str:
    return value.strip()


def import_to_bitmagnet_with_hint(
    settings: Settings,
    parsed: ParsedMagnet,
    content_type: str,
    content_source: str = "",
    content_id: str = "",
) -> DownstreamResult:
    record: dict[str, Any] = {
        "source": settings.bitmagnet_source,
        "infoHash": parsed.info_hash,
        "publishedAt": now_iso(),
    }
    content_type = normalize_content_type(content_type)
    content_source = normalize_content_source(content_source)
    content_id = normalize_content_id(content_id)
    if content_type != "unknown":
        record["contentType"] = content_type
    if content_source and content_id:
        record["contentSource"] = content_source
        record["contentId"] = content_id
    if parsed.name:
        record["name"] = parsed.name
    body = json.dumps(record, separators=(",", ":")).encode("utf-8")
    return request(
        "POST",
        f"{settings.bitmagnet_url}/import",
        body=body,
        headers={"Content-Type": "application/json", "Connection": "close"},
        timeout=30,
    )


def send_to_qbittorrent(settings: Settings, parsed: ParsedMagnet) -> DownstreamResult:
    if not settings.qbittorrent_api_key:
        return DownstreamResult(False, None, "QBITTORRENT_API_KEY is not configured")
    form = {
        "urls": parsed.magnet,
        "category": settings.qbittorrent_category,
        "tags": settings.qbittorrent_tags,
    }
    body = urllib.parse.urlencode(form).encode("utf-8")
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Api-Key": settings.qbittorrent_api_key,
        "X-API-Key": settings.qbittorrent_api_key,
    }
    return request(
        "POST",
        f"{settings.qbittorrent_url}/api/v2/torrents/add",
        body=body,
        headers=headers,
        timeout=20,
    )


def ready(settings: Settings) -> dict[str, DownstreamResult]:
    return {
        "bitmagnet": request("GET", f"{settings.bitmagnet_url}/status", timeout=5),
        "qbittorrent": request(
            "GET",
            f"{settings.qbittorrent_url}/api/v2/app/version",
            headers={
                "X-Api-Key": settings.qbittorrent_api_key,
                "X-API-Key": settings.qbittorrent_api_key,
            },
            timeout=5,
        ),
    }


def query_bitmagnet_history(settings: Settings, limit: int = 50) -> list[HistoryItem]:
    variables = {
        "input": {
            "limit": limit,
            "page": 1,
            "totalCount": False,
            "facets": {"torrentSource": {"filter": [settings.bitmagnet_source]}},
            "orderBy": [{"field": "updated_at", "descending": True}],
        }
    }
    payload = request_json(
        "POST",
        f"{settings.bitmagnet_url}/graphql",
        {"query": BITMAGNET_SUBMISSIONS_QUERY, "variables": variables},
        timeout=10,
    )
    if payload.get("errors"):
        message = payload["errors"][0].get("message", "bitmagnet GraphQL query failed")
        raise ValueError(message)
    items = payload.get("data", {}).get("torrentContent", {}).get("search", {}).get("items", [])
    return [history_item_from_bitmagnet(item) for item in items]


def cached_bitmagnet_history(settings: Settings, limit: int = 50) -> list[HistoryItem]:
    key = (settings, limit)
    now = time.monotonic()
    with history_cache_lock:
        cached = history_cache.get(key)
        if cached and now - cached[0] < HISTORY_CACHE_TTL_SECONDS:
            return list(cached[1])

    items = query_bitmagnet_history(settings, limit)
    with history_cache_lock:
        history_cache[key] = (time.monotonic(), list(items))
    return items


def history_item_from_bitmagnet(item: dict[str, Any]) -> HistoryItem:
    torrent = item.get("torrent") or {}
    content = item.get("content") or {}
    metadata_source = content.get("metadataSource") or {}
    video_parts = [
        item.get("videoResolution"),
        item.get("videoSource"),
        item.get("videoCodec"),
    ]
    content_source = item.get("contentSource") or content.get("source") or ""
    content_id = item.get("contentId") or content.get("id") or ""
    content_type = item.get("contentType") or content.get("type") or "unknown"
    return HistoryItem(
        timestamp=item.get("updatedAt") or item.get("publishedAt") or item.get("createdAt") or "",
        action="indexed",
        content_type=normalize_content_type(str(content_type)),
        content_source=normalize_content_source(str(content_source)),
        content_id=str(content_id),
        magnet=str(torrent.get("magnetUri") or ""),
        info_hash=str(item.get("infoHash") or ""),
        name=str(torrent.get("name") or item.get("title") or content.get("title") or ""),
        discovered_title=str(content.get("title") or item.get("title") or ""),
        discovered_source=str(metadata_source.get("name") or metadata_source.get("key") or content_source),
        discovered_id=str(content_id),
        release_year=str(content.get("releaseYear") or ""),
        video_summary=" ".join(str(part) for part in video_parts if part),
        seeders=item.get("seeders") if isinstance(item.get("seeders"), int) else None,
        leechers=item.get("leechers") if isinstance(item.get("leechers"), int) else None,
        bitmagnet=DownstreamResult(True, 200, "found in bitmagnet"),
        qbittorrent=None,
        source="bitmagnet",
    )


def history_item_from_submission(submission: Submission) -> HistoryItem:
    return HistoryItem(
        timestamp=submission.timestamp,
        action=submission.action,
        content_type=submission.content_type,
        content_source=submission.content_source,
        content_id=submission.content_id,
        magnet=submission.magnet,
        info_hash=submission.info_hash,
        name=submission.name or "(unnamed)",
        discovered_title="",
        discovered_source="",
        discovered_id="",
        release_year="",
        video_summary="",
        seeders=None,
        leechers=None,
        bitmagnet=submission.bitmagnet,
        qbittorrent=submission.qbittorrent,
        source="local",
    )


def submission_history(settings: Settings, recent: RecentSubmissions) -> HistoryResult:
    local_items = [history_item_from_submission(item) for item in recent.list()]
    try:
        bitmagnet_items = cached_bitmagnet_history(settings)
    except (OSError, urllib.error.URLError, json.JSONDecodeError, ValueError) as exc:
        return HistoryResult(local_items, "local fallback", f"bitmagnet history unavailable: {exc}")

    seen = {item.info_hash for item in bitmagnet_items}
    merged = bitmagnet_items + [item for item in local_items if item.info_hash not in seen]
    merged.sort(key=lambda item: item.timestamp, reverse=True)
    return HistoryResult(merged, "bitmagnet")


def find_history_item(info_hash: str, history: HistoryResult) -> HistoryItem | None:
    normalized = info_hash.strip().upper()
    for item in history.items:
        if item.info_hash.upper() == normalized:
            return item
    return None


def submit_intake(
    settings: Settings,
    recent: RecentSubmissions,
    magnet: str,
    action: str,
    content_type: str = "tv_show",
    content_source: str = "",
    content_id: str = "",
) -> tuple[int, dict[str, Any]]:
    action = action.strip().lower()
    if action not in VALID_ACTIONS:
        return 400, {"error": f"action must be one of {sorted(VALID_ACTIONS)}"}
    content_type = normalize_content_type(content_type)
    content_source = normalize_content_source(content_source)
    content_id = normalize_content_id(content_id)
    if content_id and not content_source:
        return 400, {"error": "contentSource is required when contentId is set"}
    if content_source and not content_id:
        return 400, {"error": "contentId is required when contentSource is set"}
    try:
        parsed = parse_magnet(magnet)
    except ValueError as exc:
        return 400, {"error": str(exc)}

    bitmagnet = (
        import_to_bitmagnet_with_hint(settings, parsed, content_type, content_source, content_id)
        if action in {"index", "both"}
        else None
    )
    qbittorrent = send_to_qbittorrent(settings, parsed) if action in {"download", "both"} else None
    submission = Submission(
        timestamp=now_iso(),
        action=action,
        content_type=content_type,
        content_source=content_source,
        content_id=content_id,
        magnet=parsed.magnet,
        info_hash=parsed.info_hash,
        name=parsed.name,
        bitmagnet=bitmagnet,
        qbittorrent=qbittorrent,
    )
    recent.add(submission)
    ok = all(result.ok for result in [bitmagnet, qbittorrent] if result is not None)
    return (200 if ok else 502), submission_to_dict(submission)


@app.get("/", response_class=HTMLResponse)
def index(request: Request, editInfoHash: str = Query("")) -> HTMLResponse:
    active_settings = current_settings()
    history = submission_history(active_settings, recent_submissions)
    edit_item = find_history_item(editInfoHash, history) if editInfoHash else None
    return render_page(request, active_settings, history, edit_item=edit_item)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "up"}


@app.get("/readyz")
def readyz() -> JSONResponse:
    downstream = ready(current_settings())
    status = 200 if all(item.ok for item in downstream.values()) else 503
    return JSONResponse({k: asdict(v) for k, v in downstream.items()}, status_code=status)


@app.get("/api/intake/recent")
def recent() -> list[dict[str, Any]]:
    history = submission_history(current_settings(), recent_submissions)
    return [history_item_to_dict(item) for item in history.items]


@app.get("/fragments/recent-submissions", response_class=HTMLResponse)
def recent_submissions_fragment(request: Request) -> HTMLResponse:
    history = submission_history(current_settings(), recent_submissions)
    return render_recent_fragment(request, history)


@app.post("/api/intake/magnet")
def intake_magnet(payload: IntakeRequest) -> JSONResponse:
    status, body = submit_intake(
        current_settings(),
        recent_submissions,
        payload.magnet,
        payload.action,
        payload.contentType,
        payload.contentSource,
        payload.contentId,
    )
    return JSONResponse(body, status_code=status)


@app.post("/submit", response_class=HTMLResponse)
def submit_form(
    request: Request,
    magnet: str = Form(...),
    action: str = Form("index"),
    contentType: str = Form("tv_show"),
    contentSource: str = Form(""),
    contentId: str = Form(""),
) -> HTMLResponse:
    active_settings = current_settings()
    status, body = submit_intake(
        active_settings,
        recent_submissions,
        magnet,
        action,
        contentType,
        contentSource,
        contentId,
    )
    notice = body.get("error") or f"Submitted {body['infoHash']}"
    history = submission_history(active_settings, recent_submissions)
    return render_page(request, active_settings, history, notice, status)


@app.get("/settings", response_class=HTMLResponse)
def settings_page(request: Request) -> HTMLResponse:
    active_settings = current_settings()
    return TEMPLATES.TemplateResponse(
        request,
        "settings.html",
        {
            "config_fields": config_fields(active_settings),
            "config_path": str(config_path()),
            "notice": "",
        },
    )


@app.post("/settings", response_class=HTMLResponse)
def save_settings_page(
    request: Request,
    bitmagnet_url: str = Form(""),
    bitmagnet_source: str = Form(""),
    qbittorrent_url: str = Form(""),
    qbittorrent_api_key: str = Form(""),
    qbittorrent_category: str = Form(""),
    qbittorrent_tags: str = Form(""),
    default_action: str = Form("index"),
) -> HTMLResponse:
    update_persisted_config(
        {
            "bitmagnet_url": bitmagnet_url,
            "bitmagnet_source": bitmagnet_source,
            "qbittorrent_url": qbittorrent_url,
            "qbittorrent_api_key": qbittorrent_api_key,
            "qbittorrent_category": qbittorrent_category,
            "qbittorrent_tags": qbittorrent_tags,
            "default_action": default_action,
        }
    )
    active_settings = current_settings()
    return TEMPLATES.TemplateResponse(
        request,
        "settings.html",
        {
            "config_fields": config_fields(active_settings),
            "config_path": str(config_path()),
            "notice": "Settings saved",
        },
    )


def render_page(
    request: Request,
    settings: Settings,
    history: HistoryResult,
    notice: str = "",
    status_code: int = 200,
    edit_item: HistoryItem | None = None,
) -> HTMLResponse:
    return TEMPLATES.TemplateResponse(
        request,
        "index.html",
        {
            "actions": ["index", "download", "both"],
            "content_sources": [
                {"value": "", "label": "None"},
                {"value": "tmdb", "label": "TMDB"},
                {"value": "imdb", "label": "IMDb"},
            ],
            "content_types": [
                {"value": "tv_show", "label": "TV show"},
                {"value": "movie", "label": "Movie"},
                {"value": "unknown", "label": "Unknown"},
                {"value": "music", "label": "Music"},
                {"value": "audiobook", "label": "Audiobook"},
                {"value": "ebook", "label": "Ebook"},
                {"value": "software", "label": "Software"},
            ],
            "default_action": settings.default_action,
            "form_values": form_values(settings, edit_item),
            "edit_item": edit_item,
            "notice": notice,
            "history_status": history.status,
            "history_warning": history.warning,
            "recent": [history_item_view(item) for item in history.items],
        },
        status_code=status_code,
    )


def render_recent_fragment(request: Request, history: HistoryResult, status_code: int = 200) -> HTMLResponse:
    return TEMPLATES.TemplateResponse(
        request,
        "fragments/recent_submissions.html",
        {
            "history_status": history.status,
            "history_warning": history.warning,
            "recent": [history_item_view(item) for item in history.items],
        },
        status_code=status_code,
    )


def form_values(settings: Settings, edit_item: HistoryItem | None = None) -> dict[str, str]:
    if edit_item is None:
        return {
            "magnet": "",
            "action": settings.default_action,
            "contentType": "tv_show",
            "contentSource": "",
            "contentId": "",
        }
    action = edit_item.action if edit_item.action in VALID_ACTIONS else settings.default_action
    return {
        "magnet": edit_item.magnet,
        "action": action,
        "contentType": edit_item.content_type or "tv_show",
        "contentSource": edit_item.content_source,
        "contentId": edit_item.content_id,
    }


def history_item_view(item: HistoryItem) -> dict[str, Any]:
    return {
        "timestamp": item.timestamp,
        "action": item.action,
        "content_type": item.content_type,
        "content_source": item.content_source,
        "content_id": item.content_id,
        "info_hash": item.info_hash,
        "info_hash_short": f"{item.info_hash[:12]}...",
        "magnet": item.magnet,
        "name": item.name or "(unnamed)",
        "discovered_title": item.discovered_title,
        "discovered_source": item.discovered_source,
        "discovered_id": item.discovered_id,
        "release_year": item.release_year,
        "video_summary": item.video_summary,
        "seeders": item.seeders if item.seeders is not None else "n/a",
        "leechers": item.leechers if item.leechers is not None else "n/a",
        "source": item.source,
        "bitmagnet": result_view(item.bitmagnet),
        "qbittorrent": result_view(item.qbittorrent),
    }


def result_view(result: DownstreamResult | None) -> dict[str, Any] | None:
    if result is None:
        return None
    return {
        "message": result.message[:120],
        "status": result.status if result.status is not None else "n/a",
        "status_class": "ok" if result.ok else "fail",
    }


def submission_to_dict(submission: Submission) -> dict[str, Any]:
    return {
        "timestamp": submission.timestamp,
        "action": submission.action,
        "contentType": submission.content_type,
        "contentSource": submission.content_source,
        "contentId": submission.content_id,
        "magnet": submission.magnet,
        "infoHash": submission.info_hash,
        "name": submission.name,
        "bitmagnet": asdict(submission.bitmagnet) if submission.bitmagnet else None,
        "qbittorrent": asdict(submission.qbittorrent) if submission.qbittorrent else None,
    }


def history_item_to_dict(item: HistoryItem) -> dict[str, Any]:
    return {
        "timestamp": item.timestamp,
        "action": item.action,
        "contentType": item.content_type,
        "contentSource": item.content_source,
        "contentId": item.content_id,
        "magnet": item.magnet,
        "infoHash": item.info_hash,
        "name": item.name,
        "discoveredTitle": item.discovered_title,
        "discoveredSource": item.discovered_source,
        "discoveredId": item.discovered_id,
        "releaseYear": item.release_year,
        "videoSummary": item.video_summary,
        "seeders": item.seeders,
        "leechers": item.leechers,
        "source": item.source,
        "bitmagnet": asdict(item.bitmagnet) if item.bitmagnet else None,
        "qbittorrent": asdict(item.qbittorrent) if item.qbittorrent else None,
    }


def main() -> None:
    uvicorn.run(
        "magnetron.app:app",
        host="0.0.0.0",
        port=current_settings().port,
        proxy_headers=True,
    )


if __name__ == "__main__":
    main()
