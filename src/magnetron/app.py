from __future__ import annotations

import base64
import datetime as dt
import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

import uvicorn
from fastapi import FastAPI, Form, Request
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
        default_action = os.getenv("DEFAULT_ACTION", "index").strip().lower()
        if default_action not in VALID_ACTIONS:
            default_action = "index"
        return cls(
            port=int(os.getenv("PORT", "8080")),
            base_url=os.getenv("BASE_URL", "http://localhost:8080").rstrip("/"),
            bitmagnet_url=os.getenv("BITMAGNET_URL", "http://bitmagnet:3333").rstrip("/"),
            bitmagnet_source=os.getenv("BITMAGNET_SOURCE", "manual-web"),
            qbittorrent_url=os.getenv("QBITTORRENT_URL", "http://qbittorrent:8080").rstrip("/"),
            qbittorrent_api_key=os.getenv("QBITTORRENT_API_KEY", ""),
            qbittorrent_category=os.getenv("QBITTORRENT_CATEGORY", "discord-intake"),
            qbittorrent_tags=os.getenv("QBITTORRENT_TAGS", "discord-intake"),
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
    info_hash: str
    name: str
    bitmagnet: DownstreamResult | None
    qbittorrent: DownstreamResult | None


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


def request(
    method: str,
    url: str,
    *,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 15,
) -> DownstreamResult:
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            payload = response.read(500).decode("utf-8", errors="replace")
            message = payload.strip() or response.reason
            return DownstreamResult(True, response.status, message)
    except urllib.error.HTTPError as exc:
        payload = exc.read(500).decode("utf-8", errors="replace")
        return DownstreamResult(False, exc.code, payload.strip() or exc.reason)
    except OSError as exc:
        return DownstreamResult(False, None, str(exc))


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
        info_hash=parsed.info_hash,
        name=parsed.name,
        bitmagnet=bitmagnet,
        qbittorrent=qbittorrent,
    )
    recent.add(submission)
    ok = all(result.ok for result in [bitmagnet, qbittorrent] if result is not None)
    return (200 if ok else 502), submission_to_dict(submission)


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    return render_page(request, settings, recent_submissions.list())


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "up"}


@app.get("/readyz")
def readyz() -> JSONResponse:
    downstream = ready(settings)
    status = 200 if all(item.ok for item in downstream.values()) else 503
    return JSONResponse({k: asdict(v) for k, v in downstream.items()}, status_code=status)


@app.get("/api/intake/recent")
def recent() -> list[dict[str, Any]]:
    return [submission_to_dict(item) for item in recent_submissions.list()]


@app.post("/api/intake/magnet")
def intake_magnet(payload: IntakeRequest) -> JSONResponse:
    status, body = submit_intake(
        settings,
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
    status, body = submit_intake(
        settings,
        recent_submissions,
        magnet,
        action,
        contentType,
        contentSource,
        contentId,
    )
    notice = body.get("error") or f"Submitted {body['infoHash']}"
    return render_page(request, settings, recent_submissions.list(), notice, status)


def render_page(
    request: Request,
    settings: Settings,
    recent: list[Submission],
    notice: str = "",
    status_code: int = 200,
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
            "notice": notice,
            "recent": [submission_view(item) for item in recent],
        },
        status_code=status_code,
    )


def submission_view(submission: Submission) -> dict[str, Any]:
    return {
        "timestamp": submission.timestamp,
        "action": submission.action,
        "info_hash_short": f"{submission.info_hash[:12]}...",
        "name": submission.name or "(unnamed)",
        "bitmagnet": result_view(submission.bitmagnet),
        "qbittorrent": result_view(submission.qbittorrent),
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
        "infoHash": submission.info_hash,
        "name": submission.name,
        "bitmagnet": asdict(submission.bitmagnet) if submission.bitmagnet else None,
        "qbittorrent": asdict(submission.qbittorrent) if submission.qbittorrent else None,
    }


def main() -> None:
    uvicorn.run(
        "magnetron.app:app",
        host="0.0.0.0",
        port=settings.port,
        proxy_headers=True,
    )


if __name__ == "__main__":
    main()
