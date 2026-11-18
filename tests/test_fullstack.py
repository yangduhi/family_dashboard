from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

import pytest

from app.server import default_dashboard_state, start_server, validate_dashboard_state


def test_default_and_validate_dashboard_state() -> None:
    state = default_dashboard_state("2026-11-18")
    assert state["theme"] == "babyshark"
    assert state["stepsCompleted"] == [False, False, False, False]
    assert state["lastStampedDate"] == "2026-11-18"
    assert state["departureTime"] == "08:50"

    updated = validate_dashboard_state({**state, "theme": "pororo", "stepsCompleted": [True, False, False, False]})
    assert updated["theme"] == "pororo"
    assert updated["stepsCompleted"] == [True, False, False, False]

    with pytest.raises(ValueError):
        validate_dashboard_state({**state, "theme": "pikachu"})

    with pytest.raises(ValueError):
        validate_dashboard_state({**state, "stepsCompleted": [True, False]})

    with pytest.raises(ValueError):
        validate_dashboard_state({**state, "departureTime": "25:99"})


def test_web_ui_contracts_and_js_logic() -> None:
    root = Path(__file__).resolve().parents[1]
    html = (root / "web" / "index.html").read_text(encoding="utf-8")
    css = (root / "web" / "styles.css").read_text(encoding="utf-8")
    app_js = (root / "web" / "app.js").read_text(encoding="utf-8")
    assets_js = (root / "web" / "assets.js").read_text(encoding="utf-8")
    manifest = json.loads((root / "web" / "manifest.json").read_text(encoding="utf-8"))
    sw_js = (root / "web" / "sw.js").read_text(encoding="utf-8")

    # Top theme badge bar must NOT exist on the main dashboard
    assert "테마 배지" not in html
    assert "top-theme-bar" not in html
    assert "parent-dialog" in html
    assert "아기상어" in html and "뽀로로" in html
    assert "아침 먹기" in assets_js and "세수·양치" in assets_js and "옷 입기" in assets_js and "가방 챙기기" in assets_js
    assert "1500" in app_js and "3000" in app_js
    assert "stamp-slam" in css and "touch-action: none" in css

    # Relative PWA paths for subpath HTTPS hosting (GitHub Pages / Cloudflare Pages)
    assert 'href="./manifest.json"' in html
    assert 'href="./styles.css"' in html
    assert 'src="./app.js"' in html
    assert manifest["start_url"] == "./"
    assert manifest["scope"] == "./"
    assert '"./sw.js"' in app_js and '"./index.html"' in sw_js
    assert {icon["sizes"] for icon in manifest["icons"]} >= {"192x192", "512x512"}
    for icon in manifest["icons"]:
        assert icon["src"].startswith("./") and icon["type"] == "image/png"
        png = (root / "web" / icon["src"]).read_bytes()
        assert png[:8] == b"\x89PNG\r\n\x1a\n"
        width = int.from_bytes(png[16:20], "big")
        height = int.from_bytes(png[20:24], "big")
        assert icon["sizes"] == f"{width}x{height}"
        assert json.dumps(icon["src"]) in sw_js

    node_bin = shutil.which("node")
    assert node_bin is not None, "Node.js is required to test web/app.js ES module logic"

    app_url = (root / "web" / "app.js").resolve().as_uri()
    js_test = f"""
import assert from 'node:assert/strict';
import {{
  UNDO_HOLD_MS,
  PARENT_HOLD_MS,
  normalizeDailyState,
  getActiveStepIndex,
  getLastCompletedIndex,
  applyStamp,
  undoLastStamp,
  computeCountdown,
  buildWeatherTip,
}} from {json.dumps(app_url)};

assert.equal(UNDO_HOLD_MS, 1500);
assert.equal(PARENT_HOLD_MS, 3000);

// 1. Daily reset on date change
const yesterday = {{
  theme: 'pororo',
  stepsCompleted: [true, true, false, false],
  lastStampedDate: '2026-11-17',
}};
const todayReset = normalizeDailyState(yesterday, '2026-11-18');
assert.deepEqual(todayReset.stepsCompleted, [false, false, false, false]);
assert.equal(todayReset.lastStampedDate, '2026-11-18');
assert.equal(todayReset.theme, 'pororo');

// 2. Strict single-active-step stamp & undo guard
let st = normalizeDailyState({{ stepsCompleted: [false, false, false, false], lastStampedDate: '2026-11-18' }}, '2026-11-18');
assert.equal(getActiveStepIndex(st.stepsCompleted), 0);
assert.equal(getLastCompletedIndex(st.stepsCompleted), -1);

// Tapping locked step 2 must NOT stamp
const blocked = applyStamp(st, 2, '2026-11-18');
assert.deepEqual(blocked.stepsCompleted, [false, false, false, false]);

// Tapping active step 0 stamps step 0
st = applyStamp(st, 0, '2026-11-18');
assert.deepEqual(st.stepsCompleted, [true, false, false, false]);
assert.equal(getActiveStepIndex(st.stepsCompleted), 1);
assert.equal(getLastCompletedIndex(st.stepsCompleted), 0);

// Undo reverts the last completed step
st = undoLastStamp(st);
assert.deepEqual(st.stepsCompleted, [false, false, false, false]);
assert.equal(getActiveStepIndex(st.stepsCompleted), 0);

// 3. Countdown clamping (normal & past departure)
const c1 = computeCountdown(new Date(2026, 10, 18, 8, 10, 0), '07:50', '08:50');
assert.equal(c1.remainingMinutes, 40);
assert.equal(c1.isPastDeparture, false);
assert.equal(c1.formattedRemaining, '40분 남았어요');

const c2 = computeCountdown(new Date(2026, 10, 18, 9, 5, 0), '07:50', '08:50');
assert.equal(c2.remainingMinutes, 0);
assert.equal(c2.timeProgressPct, 100);
assert.equal(c2.isPastDeparture, true);

// 4. Weather tip generation
const tipColdRain = buildWeatherTip(7, 5, 11, 70, 20);
assert.ok(tipColdRain.includes('겉옷'));
assert.ok(tipColdRain.includes('우산'));
"""
    proc = subprocess.run(
        [node_bin, "--input-type=module", "-e", js_test],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert proc.returncode == 0, f"JS module unit tests failed:\n{proc.stderr}\n{proc.stdout}"


def test_fullstack_loopback_http_and_ui() -> None:
    root = Path(__file__).resolve().parents[1]
    srv = start_server(root / "web", store={"items": ["seed"]}, port=0)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    opener = build_opener(ProxyHandler({}))
    try:
        base = f"http://127.0.0.1:{srv.server_port}"
        html = opener.open(base + "/", timeout=5).read().decode("utf-8")
        assert "어린이집" in html or "등원" in html

        for asset in ("/styles.css", "/assets.js", "/app.js", "/manifest.json", "/sw.js"):
            resp = opener.open(base + asset, timeout=5)
            assert resp.status == 200
        for size in (192, 512):
            with opener.open(f"{base}/icon-{size}.png", timeout=5) as resp:
                assert resp.status == 200
                assert resp.headers.get_content_type() == "image/png"

        health = json.loads(opener.open(base + "/api/health", timeout=5).read().decode("utf-8"))
        assert health == {
            "ok": True,
            "items": 1,
            "app": "family_dashboard",
            "themes": ["babyshark", "pororo"],
        }

        state = json.loads(opener.open(base + "/api/state", timeout=5).read().decode("utf-8"))
        assert state["theme"] == "babyshark"
        assert state["stepsCompleted"] == [False, False, False, False]

        new_payload = json.dumps(
            {
                **state,
                "theme": "pororo",
                "childName": "서연",
                "stepsCompleted": [True, True, False, False],
            }
        ).encode("utf-8")
        post_req = Request(
            base + "/api/state",
            data=new_payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        saved = json.loads(opener.open(post_req, timeout=5).read().decode("utf-8"))
        assert saved["theme"] == "pororo"
        assert saved["childName"] == "서연"
        assert saved["stepsCompleted"] == [True, True, False, False]

        refetched = json.loads(opener.open(base + "/api/state", timeout=5).read().decode("utf-8"))
        assert refetched["theme"] == "pororo"
        assert refetched["stepsCompleted"] == [True, True, False, False]

        bad_req = Request(
            base + "/api/state",
            data=json.dumps({**state, "theme": "pikachu"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with pytest.raises(HTTPError) as exc_info:
            opener.open(bad_req, timeout=5)
        assert exc_info.value.code == 400
    finally:
        srv.shutdown()
        srv.server_close()
        th.join(timeout=3)

    ev_dir = os.environ.get("PROJECT_CONTROL_EVIDENCE_DIR")
    if ev_dir:
        ev = Path(ev_dir)
        ev.mkdir(parents=True, exist_ok=True)
        (ev / "fullstack_receipt.json").write_text(
            json.dumps(
                {
                    "api_connections": [
                        {
                            "feature_id": "FEAT-001",
                            "stage": "UI_RENDER",
                            "label": "Static UI Bundle (web/index.html)",
                            "status": "PASS",
                            "endpoint": "GET / (web/index.html)",
                            "detail": "HTTP 200 HTML response verified",
                        },
                        {
                            "feature_id": "FEAT-001",
                            "stage": "API_CALL",
                            "label": "Health Endpoint (/api/health)",
                            "status": "PASS",
                            "endpoint": "GET /api/health",
                            "detail": "JSON payload verified",
                        },
                        {
                            "feature_id": "FEAT-001",
                            "stage": "API_CALL",
                            "label": "State Read Endpoint (/api/state)",
                            "status": "PASS",
                            "endpoint": "GET /api/state",
                            "detail": "Default & persisted dashboard state verified",
                        },
                        {
                            "feature_id": "FEAT-001",
                            "stage": "SERVER_STORAGE",
                            "label": "State Update Endpoint (/api/state)",
                            "status": "PASS",
                            "endpoint": "POST /api/state",
                            "detail": "Validated state update & 400 guard verified",
                        },
                    ]
                }
            ),
            encoding="utf-8",
        )
