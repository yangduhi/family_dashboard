"""Local HTTP server for the Galaxy Tab S7 family dashboard PWA and state API."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import socket
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

SUPPORTED_THEMES = ("babyshark", "pororo")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CUSTOM_IMAGE_KEYS = (
    "mascot",
    "mascot_babyshark",
    "mascot_pororo",
    "stamp",
    "stamp_babyshark",
    "stamp_pororo",
    "step1",
    "step2",
    "step3",
    "step4",
)
FIXED_LOCATION: dict[str, Any] = {
    "id": "gangdong-sangil",
    "name": "서울 강동구 상일동",
    "lat": 37.5566,
    "lon": 127.1654,
}

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
}


def default_dashboard_state(today_str: str | None = None) -> dict[str, Any]:
    """Return the initial validated dashboard state for a family tablet."""
    day = today_str or dt.date.today().isoformat()
    return {
        "theme": "babyshark",
        "childName": "채원이",
        "schoolLabel": "어린이집",
        "departureTime": "08:50",
        "prepStartTime": "07:50",
        "stepsCompleted": [False, False, False, False],
        "lastStampedDate": day,
        "location": dict(FIXED_LOCATION),
        "soundEnabled": True,
        "ttsEnabled": True,
        "customImages": {key: None for key in CUSTOM_IMAGE_KEYS},
    }


def _require_str(value: Any, name: str, *, min_len: int = 1, max_len: int = 40) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    stripped = value.strip()
    if len(stripped) < min_len or len(stripped) > max_len:
        raise ValueError(f"{name} length must be between {min_len} and {max_len}")
    return stripped


def validate_dashboard_state(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate incoming dashboard state against contracts/api/dashboard_state.schema.json."""
    if not isinstance(payload, dict):
        raise ValueError("State payload must be a JSON object")

    defaults = default_dashboard_state()
    merged = {**defaults, **payload}

    allowed_top_keys = set(defaults.keys())
    extra_keys = set(merged.keys()) - allowed_top_keys
    if extra_keys:
        raise ValueError(f"Unsupported state fields: {sorted(extra_keys)}")

    theme = merged["theme"]
    if theme not in SUPPORTED_THEMES:
        raise ValueError(f"Invalid theme {theme!r}; expected one of {SUPPORTED_THEMES}")

    child_name = _require_str(merged["childName"], "childName", min_len=1, max_len=20)
    if child_name == "우리 딸":
        child_name = "채원이"
    school_label = _require_str(merged["schoolLabel"], "schoolLabel", min_len=1, max_len=20)

    departure_time = merged["departureTime"]
    if not isinstance(departure_time, str) or not TIME_RE.fullmatch(departure_time):
        raise ValueError(f"Invalid departureTime {departure_time!r}; expected HH:MM")

    prep_start_time = merged["prepStartTime"]
    if not isinstance(prep_start_time, str) or not TIME_RE.fullmatch(prep_start_time):
        raise ValueError(f"Invalid prepStartTime {prep_start_time!r}; expected HH:MM")

    steps = merged["stepsCompleted"]
    if not isinstance(steps, list) or len(steps) != 4 or not all(isinstance(v, bool) for v in steps):
        raise ValueError("stepsCompleted must be an array of 4 booleans")

    last_date = merged["lastStampedDate"]
    if not isinstance(last_date, str) or not DATE_RE.fullmatch(last_date):
        raise ValueError(f"Invalid lastStampedDate {last_date!r}; expected YYYY-MM-DD")

    loc = merged["location"]
    if not isinstance(loc, dict):
        raise ValueError("location must be an object")
    extra_loc_keys = set(loc.keys()) - {"id", "name", "lat", "lon"}
    if extra_loc_keys:
        raise ValueError(f"Unsupported location fields: {sorted(extra_loc_keys)}")
    _require_str(loc.get("id"), "location.id", min_len=1, max_len=32)
    _require_str(loc.get("name"), "location.name", min_len=1, max_len=40)
    lat = loc.get("lat")
    lon = loc.get("lon")
    if isinstance(lat, bool) or not isinstance(lat, (int, float)) or not (-90.0 <= float(lat) <= 90.0):
        raise ValueError("location.lat must be a number in [-90, 90]")
    if isinstance(lon, bool) or not isinstance(lon, (int, float)) or not (-180.0 <= float(lon) <= 180.0):
        raise ValueError("location.lon must be a number in [-180, 180]")

    sound_enabled = merged["soundEnabled"]
    tts_enabled = merged["ttsEnabled"]
    if not isinstance(sound_enabled, bool) or not isinstance(tts_enabled, bool):
        raise ValueError("soundEnabled and ttsEnabled must be booleans")

    raw_images = merged["customImages"]
    if not isinstance(raw_images, dict):
        raise ValueError("customImages must be an object")
    extra_img_keys = set(raw_images.keys()) - set(CUSTOM_IMAGE_KEYS)
    if extra_img_keys:
        raise ValueError(f"Unsupported customImages keys: {sorted(extra_img_keys)}")
    clean_images: dict[str, str | None] = {}
    for key in CUSTOM_IMAGE_KEYS:
        val = raw_images.get(key)
        if val is not None and (not isinstance(val, str) or len(val) > 2_000_000):
            raise ValueError(f"customImages.{key} must be null or a string <= 2MB")
        clean_images[key] = val

    return {
        "theme": theme,
        "childName": child_name,
        "schoolLabel": school_label,
        "departureTime": departure_time,
        "prepStartTime": prep_start_time,
        "stepsCompleted": list(steps),
        "lastStampedDate": last_date,
        "location": dict(FIXED_LOCATION),
        "soundEnabled": sound_enabled,
        "ttsEnabled": tts_enabled,
        "customImages": clean_images,
    }


def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def make_handler(web_dir: Path, store: dict[str, Any], state_file: Path | None = None):
    """Create a request handler serving static PWA files and dashboard state endpoints."""
    web_root = web_dir.resolve()
    if "state" not in store:
        if state_file and state_file.is_file():
            try:
                loaded = json.loads(state_file.read_text(encoding="utf-8"))
                store["state"] = validate_dashboard_state(loaded)
            except (OSError, json.JSONDecodeError, ValueError):
                store["state"] = default_dashboard_state()
        else:
            store["state"] = default_dashboard_state()

    class Handler(BaseHTTPRequestHandler):
        def _send_json(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            req_path = urlparse(self.path).path
            if req_path == "/api/health":
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "items": len(store.get("items", [])),
                        "app": "family_dashboard",
                        "themes": list(SUPPORTED_THEMES),
                    },
                )
                return

            if req_path == "/api/state":
                self._send_json(200, store["state"])
                return

            rel_path = "index.html" if req_path == "/" else unquote(req_path).lstrip("/")
            target = (web_root / rel_path).resolve()
            if not target.is_relative_to(web_root) or not target.is_file():
                self.send_response(404)
                self.end_headers()
                return

            mime = MIME_TYPES.get(target.suffix.lower(), "application/octet-stream")
            body = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self) -> None:
            req_path = urlparse(self.path).path
            if req_path != "/api/state":
                self.send_response(404)
                self.end_headers()
                return

            try:
                content_len = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._send_json(400, {"ok": False, "error": "Invalid Content-Length header"})
                return

            if content_len <= 0 or content_len > 5_000_000:
                self._send_json(400, {"ok": False, "error": "Request body empty or too large"})
                return

            raw = self.rfile.read(content_len)
            try:
                payload = json.loads(raw.decode("utf-8"))
                validated = validate_dashboard_state(payload)
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
                self._send_json(400, {"ok": False, "error": str(exc)})
                return

            store["state"] = validated
            if state_file is not None:
                _atomic_write_json(state_file, validated)
            self._send_json(200, validated)

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            return

    return Handler


def start_server(
    web_dir: Path,
    store: dict[str, Any] | None = None,
    host: str = "127.0.0.1",
    port: int = 0,
    state_file: Path | None = None,
) -> HTTPServer:
    """Start an HTTPServer bound to host:port serving the dashboard web directory."""
    backing_store = store if store is not None else {"items": []}
    return HTTPServer((host, port), make_handler(web_dir, backing_store, state_file=state_file))


def _discover_lan_ips() -> list[str]:
    ips: list[str] = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, family=socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            ip = sock.getsockname()[0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return ips


def default_state_file(project_root: Path) -> Path:
    """Return the default runtime state path outside project-control's work/ ledger."""
    return project_root / ".local" / "dashboard_state.json"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Family Dashboard local server for Galaxy Tab S7")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8080, help="Listen port (default: 8080)")
    parser.add_argument(
        "--state-file",
        default=None,
        help="Runtime state JSON file path (default: .local/dashboard_state.json)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    project_root = Path(__file__).resolve().parents[2]
    web_dir = project_root / "web"
    state_file = Path(args.state_file).expanduser() if args.state_file else default_state_file(project_root)
    server = start_server(web_dir, host=args.host, port=args.port, state_file=state_file)
    actual_port = server.server_port

    print(f"[family_dashboard] 서버 시작: http://127.0.0.1:{actual_port}")
    for ip in _discover_lan_ips():
        print(f"[갤럭시 탭 S7 접속 주소] http://{ip}:{actual_port}")
    print("종료하려면 Ctrl+C 를 누르세요.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
