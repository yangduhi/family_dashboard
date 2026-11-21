from __future__ import annotations

import base64
import io
import json
import os
import re
import shutil
import subprocess
import threading
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

import pytest
from jsonschema import Draft202012Validator

from app.server import (
    FIXED_LOCATION,
    build_parser,
    default_dashboard_state,
    default_state_file,
    start_server,
    validate_dashboard_state,
)


def test_default_and_validate_dashboard_state() -> None:
    state = default_dashboard_state("2026-11-18")
    assert state["theme"] == "babyshark"
    assert state["childName"] == "친구야"
    assert state["stepsCompleted"] == [False, False, False, False]
    assert state["lastStampedDate"] == "2026-11-18"
    assert state["departureTime"] == "08:50"
    assert state["location"] == FIXED_LOCATION

    updated = validate_dashboard_state({**state, "theme": "pororo", "stepsCompleted": [True, False, False, False]})
    assert updated["theme"] == "pororo"
    assert updated["stepsCompleted"] == [True, False, False, False]
    assert updated["location"] == FIXED_LOCATION

    migrated = validate_dashboard_state(
        {
            **state,
            "childName": "우리 딸",
            "location": {"id": "seoul", "name": "서울 중구", "lat": 37.5665, "lon": 126.9780},
        }
    )
    assert migrated["childName"] == "친구야"
    assert validate_dashboard_state({**state, "childName": "우리 딸"})["childName"] == "친구야"
    assert validate_dashboard_state({**state, "childName": "별이"})["childName"] == "별이"
    assert migrated["location"] == FIXED_LOCATION

    with pytest.raises(ValueError):
        validate_dashboard_state({**state, "theme": "pikachu"})

    with pytest.raises(ValueError):
        validate_dashboard_state({**state, "stepsCompleted": [True, False]})

    with pytest.raises(ValueError):
        validate_dashboard_state({**state, "departureTime": "25:99"})


def test_schema_contract_alignment() -> None:
    root = Path(__file__).resolve().parents[1]
    schema = json.loads((root / "contracts" / "api" / "dashboard_state.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)

    base = default_dashboard_state("2026-11-19")
    valid_variants = [
        base,
        validate_dashboard_state(
            {
                **base,
                "theme": "pororo",
                "childName": "서연",
                "schoolLabel": "유치원",
                "stepsCompleted": [True, True, False, False],
                "soundEnabled": False,
                "ttsEnabled": False,
                "location": dict(FIXED_LOCATION),
                "customImages": {**base["customImages"], "mascot": "data:image/png;base64,AAAA"},
            }
        ),
    ]
    for payload in valid_variants:
        assert validator.is_valid(payload), list(validator.iter_errors(payload))
        assert validate_dashboard_state(payload) == payload

    # Legacy location & legacy 6-key customImages payloads normalize cleanly to 10 keys + FIXED_LOCATION
    busan_migrated = validate_dashboard_state(
        {
            **base,
            "location": {"id": "busan", "name": "부산 해운대구", "lat": 35.1631, "lon": 129.1636},
            "customImages": {
                "mascot": "data:image/png;base64,BBBB",
                "stamp": None,
                "step1": None,
                "step2": None,
                "step3": None,
                "step4": None,
            },
        }
    )
    assert busan_migrated["location"] == FIXED_LOCATION
    assert busan_migrated["customImages"]["mascot"] == "data:image/png;base64,BBBB"
    assert busan_migrated["customImages"]["mascot_babyshark"] is None
    assert busan_migrated["customImages"]["mascot_pororo"] is None
    assert busan_migrated["customImages"]["stamp_babyshark"] is None
    assert busan_migrated["customImages"]["stamp_pororo"] is None
    assert validator.is_valid(busan_migrated)

    invalid_full_payloads = [
        {**base, "theme": "pikachu"},
        {**base, "stepsCompleted": [True, False]},
        {**base, "departureTime": "25:99"},
        {**base, "extraTopField": True},
        {**base, "location": {**base["location"], "lat": 95.0}},
        {**base, "location": {**base["location"], "lon": -181.0}},
        {**base, "location": {**base["location"], "extra": "nope"}},
        {**base, "customImages": {**base["customImages"], "unknownSlot": None}},
        {**base, "customImages": {**base["customImages"], "mascot": "a" * 2_000_001}},
    ]
    for bad in invalid_full_payloads:
        assert not validator.is_valid(bad), f"Schema unexpectedly accepted invalid payload: {bad}"
        with pytest.raises(ValueError):
            validate_dashboard_state(bad)

    # Intentional server-side normalization boundaries beyond static JSON Schema
    merged_partial = validate_dashboard_state({"theme": "pororo", "childName": "  하윤  "})
    assert merged_partial["theme"] == "pororo"
    assert merged_partial["childName"] == "하윤"
    assert validator.is_valid(merged_partial)

    with pytest.raises(ValueError):
        validate_dashboard_state({**base, "childName": "   "})


def test_deploy_workflow_and_sw_cache_contract() -> None:
    root = Path(__file__).resolve().parents[1]
    sw_js = (root / "web" / "sw.js").read_text(encoding="utf-8")
    updated, count = re.subn(
        r'^const CACHE_VERSION = "[^"]+";$',
        'const CACHE_VERSION = "sha-abcdef123456";',
        sw_js,
        flags=re.MULTILINE,
    )
    assert count == 1
    assert 'const CACHE_VERSION = "sha-abcdef123456";' in updated
    assert "const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;" in sw_js
    html = (root / "web" / "index.html").read_text(encoding="utf-8")
    # v12 caches navigations containing the old marker. Do not let it cache versioned HTML.
    assert '<meta name="family-dashboard-shell" content="1">' not in html
    assert '<meta name="family-dashboard-shell" content="2">' in html and 'family-dashboard-shell" content="2"' in sw_js

    workflow = (root / ".github" / "workflows" / "deploy-pages.yml").read_text(encoding="utf-8")
    assert re.search(r"^permissions:\s*\{\}\s*$", workflow, flags=re.MULTILINE)
    assert re.search(r"^\s{2}verify:\s*$", workflow, flags=re.MULTILINE)
    assert "pytest tests" in workflow
    assert re.search(r"^\s{2}deploy:\s*$", workflow, flags=re.MULTILINE)
    assert re.search(r"^\s{4}needs:\s*verify\s*$", workflow, flags=re.MULTILINE)
    assert "refs/heads/main" in workflow
    assert "version_line.finditer" in workflow
    assert 'text.replace(f"?release={template}", f"?release={release}")' in workflow
    assert 'family-dashboard-release' in workflow
    # Upload artifact in verify job before deploy job starts to avoid Pages artifact indexing race
    deploy_job = re.search(r"^\s{2}deploy:\s*$", workflow, flags=re.MULTILINE)
    assert deploy_job is not None
    assert workflow.index("actions/upload-pages-artifact@") < deploy_job.start()
    assert deploy_job.start() < workflow.index("actions/deploy-pages@")


def test_server_default_state_file_and_cli_override() -> None:
    root = Path(__file__).resolve().parents[1]
    state_path = default_state_file(root)
    assert state_path == root / ".local" / "dashboard_state.json"
    assert "work" not in state_path.relative_to(root).parts

    default_args = build_parser().parse_args([])
    assert default_args.state_file is None

    custom_args = build_parser().parse_args(["--state-file", "custom_state.json", "--port", "9090"])
    assert custom_args.state_file == "custom_state.json"
    assert custom_args.port == 9090


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
    assert "select-location" not in html and "selectLocation" not in app_js
    assert "fixed-location-badge" in html and "서울 강동구 상일동" in html
    assert "media-pool-grid" in html and "서울 강동구 상일동" in assets_js
    assert "친구야" in html and "어린이집" in assets_js
    assert "아기상어" in html and "뽀로로" in html
    assert "아침 먹기" in assets_js and "세수·양치" in assets_js and "옷 입기" in assets_js and "가방 챙기기" in assets_js
    assert "1500" in app_js and "3000" in app_js
    assert "stamp-land" in css and "touch-action: none" in css and "grayscale(" in css
    assert "data-reduced-motion" in css

    # Relative PWA paths for subpath HTTPS hosting (GitHub Pages / Cloudflare Pages)
    assert 'href="./manifest.json"' in html
    release = re.search(r'^const CACHE_VERSION = "([^"]+)";$', sw_js, re.M)[1]
    assert f'href="./styles.css?release={release}"' in html
    assert f'src="./app.js?release={release}"' in html
    assert manifest["start_url"] == "./"
    assert manifest["scope"] == "./"
    assert '"./sw.js"' in app_js and '"./index.html"' in sw_js and '"./media_store.js"' in sw_js
    for audio_asset in ("stamp-audio.js", "audio/stamp.wav", "audio/paper.wav", "audio/ready.wav"):
        assert json.dumps(f"./{audio_asset}") in sw_js
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

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as zf:
        zf.writestr("아기상어/등원준비/01_breakfast.gif", b"GIF89a-shark-1", compress_type=zipfile.ZIP_STORED)
        zf.writestr("pororo_morning_60/webp/crong/dress_01.webp", b"RIFF0000WEBP-crong", compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("pororo_morning_60/poster/crong/dress_01.png", b"PNG-POSTER", compress_type=zipfile.ZIP_DEFLATED)
    zip_b64 = base64.b64encode(zip_buf.getvalue()).decode("ascii")

    app_url = (root / "web" / "app.js").resolve().as_uri()
    media_url = (root / "web" / "media_store.js").resolve().as_uri()
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
  resolveUploadedImageMime,
  resolveThemeMascotUrl,
  resolveThemeStampUrl,
}} from {json.dumps(app_url)};
import {{
  buildMediaRecordId,
  classifyMediaPath,
  parseZipEntries,
  pickRandomFromPool,
  buildStepMediaSelection,
}} from {json.dumps(media_url)};

assert.equal(UNDO_HOLD_MS, 1500);
assert.equal(PARENT_HOLD_MS, 3000);

// 1. Daily reset on date change & fixed location + childName migration
const yesterday = {{
  theme: 'pororo',
  childName: '우리 딸',
  stepsCompleted: [true, true, false, false],
  lastStampedDate: '2026-11-17',
  location: {{ id: 'seoul', name: '서울 중구', lat: 37.5665, lon: 126.978 }},
}};
const todayReset = normalizeDailyState(yesterday, '2026-11-18');
assert.deepEqual(todayReset.stepsCompleted, [false, false, false, false]);
assert.equal(todayReset.lastStampedDate, '2026-11-18');
assert.equal(todayReset.theme, 'pororo');
assert.equal(todayReset.childName, '친구야');
assert.deepEqual(todayReset.location, {{
  id: 'gangdong-sangil',
  name: '서울 강동구 상일동',
  lat: 37.5566,
  lon: 127.1654,
}});

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

// 5. Media path classification & collision-free IDs
const cPororo = classifyMediaPath('pororo_morning_60/webp/pororo/breakfast_01.webp');
const cCrong = classifyMediaPath('pororo_morning_60/webp/crong/breakfast_01.webp');
assert.equal(cPororo.theme, 'pororo');
assert.equal(cPororo.step, 'step1');
assert.equal(cPororo.mimeType, 'image/webp');
assert.notEqual(
  buildMediaRecordId(cPororo.theme, cPororo.step, cPororo.relPath),
  buildMediaRecordId(cCrong.theme, cCrong.step, cCrong.relPath)
);

const cShark = classifyMediaPath('아기상어/등원준비/02_wash_brush.gif');
assert.equal(cShark.theme, 'babyshark');
assert.equal(cShark.step, 'step2');
assert.equal(cShark.mimeType, 'image/gif');

assert.equal(classifyMediaPath('pororo_morning_60/poster/pororo/bag_01.png'), null);
assert.equal(classifyMediaPath('posters/daddy_shark_breakfast_v01.png'), null);
for (const shark of ['아빠상어', '엄마상어', '할머니상어', '할아버지상어']) {{
  const media = classifyMediaPath(`${{shark}}/01_아침먹기/01_spoon.webp`, 'pororo');
  assert.equal(media.theme, 'babyshark');
  assert.equal(media.step, 'step1');
}}
assert.equal(classifyMediaPath('.DS_Store'), null);
assert.equal(classifyMediaPath('__MACOSX/pororo/._bag_01.gif'), null);

// 6. Random pool selection
assert.equal(pickRandomFromPool([]), null);
assert.deepEqual(pickRandomFromPool([{{ id: 'a' }}]), {{ id: 'a' }});
const picked = pickRandomFromPool([{{ id: 'a' }}, {{ id: 'b' }}], () => 0.0, 'a');
assert.equal(picked.id, 'b');

const sel = buildStepMediaSelection(
  {{ step1: [{{ id: 's1' }}], step2: [], step3: [{{ id: 's3a' }}, {{ id: 's3b' }}], step4: [] }},
  () => 0.0,
  {{ step3: {{ id: 's3a' }} }}
);
assert.equal(sel.step1.id, 's1');
assert.equal(sel.step2, null);
assert.equal(sel.step3.id, 's3b');
assert.equal(sel.step4, null);

// 7. Zero-dep ZIP parser (Stored + Deflate + UTF-8 Korean + pre-filter)
const zipBytes = Uint8Array.from(Buffer.from({json.dumps(zip_b64)}, 'base64'));
const parsedEntries = [];
for await (const entry of parseZipEntries(zipBytes, {{ shouldReadEntry: (p) => classifyMediaPath(p) !== null }})) {{
  parsedEntries.push({{
    path: entry.path,
    text: Buffer.from(entry.bytes).toString('utf8'),
  }});
}}
assert.equal(parsedEntries.length, 2);
assert.equal(parsedEntries[0].path, '아기상어/등원준비/01_breakfast.gif');
assert.equal(parsedEntries[0].text, 'GIF89a-shark-1');
assert.equal(parsedEntries[1].path, 'pororo_morning_60/webp/crong/dress_01.webp');
assert.equal(parsedEntries[1].text, 'RIFF0000WEBP-crong');

// 8. Empty MIME type extension fallback for direct slot uploads
assert.equal(resolveUploadedImageMime({{ name: 'dance.GIF', type: '' }}), 'image/gif');
assert.equal(resolveUploadedImageMime({{ name: 'clip.webp', type: '' }}), 'image/webp');
assert.equal(resolveUploadedImageMime({{ name: 'icon.svg', type: '' }}), 'image/svg+xml');
assert.equal(resolveUploadedImageMime({{ name: 'photo.jpg', type: 'image/jpeg' }}), 'image/jpeg');

// 9. Theme-scoped mascot & stamp precedence with common fallback
const themedState = {{
  theme: 'babyshark',
  customImages: {{
    mascot: 'data:image/png;base64,COMMON_M',
    mascot_babyshark: 'data:image/png;base64,SHARK_M',
    mascot_pororo: null,
    stamp: 'data:image/png;base64,COMMON_S',
    stamp_babyshark: null,
    stamp_pororo: 'data:image/png;base64,PORORO_S',
  }},
}};
assert.equal(resolveThemeMascotUrl(themedState, 'babyshark'), 'data:image/png;base64,SHARK_M');
assert.equal(resolveThemeMascotUrl(themedState, 'pororo'), 'data:image/png;base64,COMMON_M');
assert.equal(resolveThemeStampUrl(themedState, 'babyshark'), 'data:image/png;base64,COMMON_S');
assert.equal(resolveThemeStampUrl(themedState, 'pororo'), 'data:image/png;base64,PORORO_S');
assert.equal(resolveThemeMascotUrl({{ theme: 'pororo', customImages: {{}} }}), null);
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

        for asset in ("/styles.css", "/assets.js", "/media_store.js", "/app.js", "/manifest.json", "/sw.js"):
            resp = opener.open(base + asset, timeout=5)
            assert resp.status == 200
        for effect in ("stamp", "paper", "ready"):
            with opener.open(f"{base}/audio/{effect}.wav", timeout=5) as resp:
                assert resp.headers.get_content_type() == "audio/wav"
                assert resp.read(4) == b"RIFF"
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
