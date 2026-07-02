from __future__ import annotations

import base64
import datetime as dt
import html
import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


INFO_HASH_HEX = re.compile(r"^[A-Fa-f0-9]{40}$")
INFO_HASH_BASE32 = re.compile(r"^[A-Z2-7a-z]{32}$")
VALID_ACTIONS = {"index", "download", "both"}
VALID_CONTENT_TYPES = {"unknown", "movie", "tv_show", "ebook", "audiobook", "music", "software", "xxx"}
VALID_CONTENT_SOURCES = {"", "tmdb", "imdb"}


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
    xt_values = params.get("xt", [])
    info_hash = ""
    for xt in xt_values:
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
    record: dict[str, Any] = {
        "source": settings.bitmagnet_source,
        "infoHash": parsed.info_hash,
        "publishedAt": now_iso(),
    }
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


def render_page(settings: Settings, recent: list[Submission], notice: str = "") -> str:
    rows = "\n".join(
        "<tr>"
        f"<td>{html.escape(item.timestamp)}</td>"
        f"<td>{html.escape(item.action)}</td>"
        f"<td><code>{html.escape(item.info_hash[:12])}...</code></td>"
        f"<td>{html.escape(item.name or '(unnamed)')}</td>"
        f"<td>{render_result(item.bitmagnet)}</td>"
        f"<td>{render_result(item.qbittorrent)}</td>"
        "</tr>"
        for item in recent
    )
    action_options = "\n".join(
        f'<option value="{action}" {"selected" if action == settings.default_action else ""}>{action}</option>'
        for action in ["index", "download", "both"]
    )
    content_type_options = "\n".join(
        f'<option value="{value}" {"selected" if value == "tv_show" else ""}>{label}</option>'
        for value, label in [
            ("tv_show", "TV show"),
            ("movie", "Movie"),
            ("unknown", "Unknown"),
            ("music", "Music"),
            ("audiobook", "Audiobook"),
            ("ebook", "Ebook"),
            ("software", "Software"),
        ]
    )
    content_source_options = "\n".join(
        f'<option value="{value}">{label}</option>'
        for value, label in [
            ("", "None"),
            ("tmdb", "TMDB"),
            ("imdb", "IMDb"),
        ]
    )
    notice_html = f'<p class="notice">{html.escape(notice)}</p>' if notice else ""
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Magnetron</title>
  <style>
    body {{ margin: 0; font-family: system-ui, sans-serif; background: #111827; color: #e5e7eb; }}
    main {{ max-width: 1080px; margin: 0 auto; padding: 32px 20px; }}
    h1 {{ font-size: 28px; margin: 0 0 24px; }}
    form {{ display: grid; gap: 12px; margin-bottom: 28px; }}
    textarea, select, input, button {{ font: inherit; border-radius: 6px; border: 1px solid #4b5563; }}
    textarea, select, input {{ background: #030712; color: #f9fafb; padding: 10px; }}
    textarea {{ min-height: 120px; resize: vertical; }}
    button {{ justify-self: start; background: #0f766e; color: white; border: 0; padding: 10px 16px; cursor: pointer; }}
    table {{ width: 100%; border-collapse: collapse; background: #030712; }}
    th, td {{ border-bottom: 1px solid #374151; padding: 10px; text-align: left; vertical-align: top; }}
    th {{ color: #9ca3af; font-size: 13px; }}
    code {{ color: #93c5fd; }}
    .notice {{ background: #1f2937; border-left: 4px solid #0f766e; padding: 10px 12px; }}
    .ok {{ color: #86efac; }}
    .fail {{ color: #fca5a5; }}
  </style>
</head>
<body>
<main>
  <h1>Magnetron</h1>
  {notice_html}
  <form method="post" action="/submit">
    <label for="magnet">Magnet link</label>
    <textarea id="magnet" name="magnet" required></textarea>
    <label for="action">Action</label>
    <select id="action" name="action">{action_options}</select>
    <label for="contentType">Content type</label>
    <select id="contentType" name="contentType">{content_type_options}</select>
    <label for="contentSource">Known ID source</label>
    <select id="contentSource" name="contentSource">{content_source_options}</select>
    <label for="contentId">Known ID</label>
    <input id="contentId" name="contentId" placeholder="89180 or tt1234567">
    <button type="submit">Submit</button>
  </form>
  <h2>Recent submissions</h2>
  <table>
    <thead><tr><th>Time</th><th>Action</th><th>Info hash</th><th>Name</th><th>bitmagnet</th><th>qBittorrent</th></tr></thead>
    <tbody>{rows}</tbody>
  </table>
</main>
</body>
</html>"""


def render_result(result: DownstreamResult | None) -> str:
    if result is None:
        return ""
    klass = "ok" if result.ok else "fail"
    status = result.status if result.status is not None else "n/a"
    return f'<span class="{klass}">{status}</span> {html.escape(result.message[:120])}'


class Handler(BaseHTTPRequestHandler):
    settings: Settings
    recent: RecentSubmissions

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)

    def do_GET(self) -> None:
        if self.path == "/" or self.path.startswith("/?"):
            self.respond_html(render_page(self.settings, self.recent.list()))
            return
        if self.path == "/healthz":
            self.respond_json({"status": "up"})
            return
        if self.path == "/readyz":
            downstream = ready(self.settings)
            status = HTTPStatus.OK if all(item.ok for item in downstream.values()) else HTTPStatus.SERVICE_UNAVAILABLE
            self.respond_json({k: asdict(v) for k, v in downstream.items()}, status=status)
            return
        if self.path == "/api/intake/recent":
            self.respond_json([submission_to_dict(item) for item in self.recent.list()])
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if self.path == "/submit":
            data = self.read_form()
            status, payload = self.handle_submission(
                data.get("magnet", ""),
                data.get("action", self.settings.default_action),
                data.get("contentType", "tv_show"),
                data.get("contentSource", ""),
                data.get("contentId", ""),
            )
            notice = payload.get("error") or f"Submitted {payload['infoHash']}"
            self.respond_html(render_page(self.settings, self.recent.list(), notice), status=status)
            return
        if self.path == "/api/intake/magnet":
            try:
                data = json.loads(self.read_body().decode("utf-8"))
            except json.JSONDecodeError:
                self.respond_json({"error": "invalid JSON"}, status=HTTPStatus.BAD_REQUEST)
                return
            status, payload = self.handle_submission(
                str(data.get("magnet", "")),
                str(data.get("action", self.settings.default_action)),
                str(data.get("contentType", "tv_show")),
                str(data.get("contentSource", "")),
                str(data.get("contentId", "")),
            )
            self.respond_json(payload, status=status)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def handle_submission(
        self,
        magnet: str,
        action: str,
        content_type: str = "tv_show",
        content_source: str = "",
        content_id: str = "",
    ) -> tuple[HTTPStatus, dict[str, Any]]:
        action = action.strip().lower()
        if action not in VALID_ACTIONS:
            return HTTPStatus.BAD_REQUEST, {"error": f"action must be one of {sorted(VALID_ACTIONS)}"}
        content_type = normalize_content_type(content_type)
        content_source = normalize_content_source(content_source)
        content_id = normalize_content_id(content_id)
        if content_id and not content_source:
            return HTTPStatus.BAD_REQUEST, {"error": "contentSource is required when contentId is set"}
        if content_source and not content_id:
            return HTTPStatus.BAD_REQUEST, {"error": "contentId is required when contentSource is set"}
        try:
            parsed = parse_magnet(magnet)
        except ValueError as exc:
            return HTTPStatus.BAD_REQUEST, {"error": str(exc)}

        bitmagnet = (
            import_to_bitmagnet_with_hint(self.settings, parsed, content_type, content_source, content_id)
            if action in {"index", "both"}
            else None
        )
        qbittorrent = send_to_qbittorrent(self.settings, parsed) if action in {"download", "both"} else None
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
        self.recent.add(submission)
        ok = all(result.ok for result in [bitmagnet, qbittorrent] if result is not None)
        return (
            HTTPStatus.OK if ok else HTTPStatus.BAD_GATEWAY,
            submission_to_dict(submission),
        )

    def read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(length)

    def read_form(self) -> dict[str, str]:
        body = self.read_body().decode("utf-8")
        values = urllib.parse.parse_qs(body)
        return {k: v[0] for k, v in values.items()}

    def respond_html(self, body: str, status: HTTPStatus = HTTPStatus.OK) -> None:
        payload = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def respond_json(self, value: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        payload = json.dumps(value, default=asdict).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


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
    settings = Settings.from_env()
    Handler.settings = settings
    Handler.recent = RecentSubmissions()
    server = ThreadingHTTPServer(("0.0.0.0", settings.port), Handler)
    print(f"magnetron listening on :{settings.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
