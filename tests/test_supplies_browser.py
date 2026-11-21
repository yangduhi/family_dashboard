from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shutil
import threading
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from app.server import start_server

ROOT = Path(__file__).resolve().parents[1]


def test_public_pages_shell_never_exposes_private_controls_or_requests(tmp_path):
    server = start_server(ROOT / "web", store={"items": []}, state_file=tmp_path / "state.json", port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}/"
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for width, height in [(1280, 800), (1024, 640)]:
                ctx = browser.new_context(viewport={"width": width, "height": height}, has_touch=True,
                                          service_workers="allow", timezone_id="Asia/Seoul")
                ctx.route("https://**/*", lambda route: route.abort())
                private_requests = []
                ctx.on("request", lambda request: private_requests.append(request.url)
                       if "/api/supplies/" in request.url else None)
                page = ctx.new_page()
                page.clock.install(time=datetime(2026, 11, 20, 22, tzinfo=timezone.utc))
                page.goto(origin)
                page.wait_for_function("navigator.serviceWorker.controller !== null")
                expect(page.locator("#cards-grid .step-card")).to_have_count(4)
                expect(page.locator("#supplies-button")).to_be_hidden()
                expect(page.locator("#supplies-dialog")).not_to_be_visible()
                assert page.locator("html").get_attribute("data-supplies-enabled") != "true"
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                box = page.locator("#parent-lock-btn").bounding_box()
                page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                page.mouse.down()
                page.clock.fast_forward(3100)
                page.mouse.up()
                expect(page.locator("#parent-dialog")).to_be_visible()
                expect(page.locator("#supplies-details")).to_be_hidden()
                expect(page.locator("#supplies-login")).to_be_hidden()
                page.locator("#input-child-name").fill("사용자 호칭")
                page.locator("#btn-save-close").click()
                page.reload()
                assert page.evaluate("JSON.parse(localStorage.getItem('family_dashboard_state_v1')).childName") == "사용자 호칭"
                assert private_requests == []
                ctx.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_supplies_below_settings_with_service_worker_and_safe_fallbacks(tmp_path):
    fixture = json.loads((ROOT / "tests/fixtures/supplies-today.json").read_text(encoding="utf-8"))
    fixture["items"] = [
        {**fixture["items"][0], "label": f"준비물 {i} " + "긴 한글 이름 " * 8, "condition": "등원하는 날"}
        for i in range(20)
    ]
    shell = tmp_path / "web"
    shutil.copytree(ROOT / "web", shell)
    html = shell / "index.html"
    html.write_text(html.read_text(encoding="utf-8").replace('<html ', '<html data-supplies-enabled="true" ', 1), encoding="utf-8")
    server = start_server(shell, store={"items": []}, state_file=tmp_path / "state.json", port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}/"
    endpoint = origin + "api/supplies/today"
    response = {"status": 200, "json": fixture}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1280, "height": 800}, has_touch=True,
                                      service_workers="allow", timezone_id="Asia/Seoul")
            ctx.route("https://**/*", lambda route: route.abort())
            ctx.route("https://api.open-meteo.com/**", lambda route: route.fulfill(json={
                "current": {"time": "2026-11-21T07:00", "temperature_2m": 9, "weather_code": 0},
                "daily": {"time": ["2026-11-21", "2026-11-22"], "weather_code": [0, 3],
                          "temperature_2m_min": [6, -2], "temperature_2m_max": [13, 8]},
                "hourly": {"time": ["2026-11-21T09:00", "2026-11-22T09:00"],
                           "temperature_2m": [10, 25], "precipitation_probability": [0, 99]},
            }))
            ctx.route("https://air-quality-api.open-meteo.com/**", lambda route: route.fulfill(json={}))
            ctx.route(endpoint, lambda route: route.fulfill(headers={"Cache-Control": "no-store"}, **response))
            page = ctx.new_page()
            page.clock.install(time=datetime(2026, 11, 20, 22, tzinfo=timezone.utc))
            page.goto(origin)
            page.wait_for_function("navigator.serviceWorker.controller !== null")
            status = page.locator("#supplies-status")
            button = page.get_by_role("button", name="키즈노트", exact=True)
            dialog = page.get_by_role("dialog", name="키즈노트 당일 준비물")
            expect(status).to_contain_text("전체 20개")
            expect(button).to_be_enabled()
            expect(button).to_have_accessible_description("오늘 표시할 준비물이 있습니다. 상세 내용을 확인해 주세요.")
            assert button.evaluate("el => getComputedStyle(el).boxShadow") != "none"
            expect(page.get_by_text("준비물 19", exact=False)).to_be_hidden()
            clock = page.locator("#clock-face")
            expect(clock).to_have_attribute("aria-label", "현재 시각 오전 7:00")
            assert clock.locator(".clock-number").all_text_contents() == ["12", "3", "6", "9"]
            assert clock.evaluate("""el => [
                el.style.getPropertyValue('--hour-angle'),
                el.style.getPropertyValue('--minute-angle'),
                el.style.getPropertyValue('--second-angle')
            ]""") == ["210deg", "0deg", "0deg"]
            expect(clock).to_have_css("border-top-width", "0px")
            expect(clock).to_have_css("background-color", "rgba(0, 0, 0, 0)")
            expect(clock).to_have_css("box-shadow", "none")
            expect(clock.locator("#header-mascot svg, #header-mascot img")).to_have_css("filter", re.compile(r"^drop-shadow"))
            expect(clock.locator(".clock-hour")).to_have_css("background-color", "rgb(0, 0, 0)")
            expect(clock.locator(".clock-minute")).to_have_css("background-color", "rgb(0, 0, 0)")
            expect(clock.locator(".clock-second")).to_have_css("background-color", "rgb(191, 24, 37)")
            page.clock.fast_forward(1000)
            assert clock.evaluate("el => el.style.getPropertyValue('--second-angle')") == "6deg"
            expect(page.locator(".weather-zone #date-pill")).to_have_text("2026년 11월 21일 토요일")
            expect(page.locator(".weather-zone #date-pill")).to_have_attribute("datetime", "2026-11-21")
            expect(page.locator("#weather-cond")).not_to_contain_text("상일동")
            expect(page.locator("#weather-range")).to_have_text(re.compile(r"^최저 -?\d+° · 최고 -?\d+°$"))
            expect(page.locator("#tomorrow-condition")).to_contain_text("흐림")
            expect(page.locator("#tomorrow-date")).to_have_attribute("datetime", "2026-11-22")
            expect(page.locator("#tomorrow-low")).to_have_text("-2°")
            expect(page.locator("#tomorrow-high")).to_have_text("8°")
            expect(page.locator("#hourly-strip strong").nth(1)).to_have_text("—")
            expect(page.locator("#air-grade")).to_have_text("확인 불가")
            expect(page.locator("#weather-tip-bar")).not_to_contain_text("우산 필요 없어요")
            expect(page.locator("#hourly-strip strong").first).to_have_text("10°")
            assert button.locator("img").evaluate("el => el.complete && el.naturalWidth > 0")
            sizes = page.evaluate("""() => {
              const rect = s => document.querySelector(s).getBoundingClientRect().toJSON();
              return {header: rect('.header-band'), clock: rect('#clock-face'), button: rect('#supplies-button'),
                weather: rect('.weather-zone'), lock: rect('#parent-lock-btn'),
                air: rect('.air-badge'), now: rect('.weather-now'), hourly: rect('.weather-hourly'),
                tomorrow: rect('.weather-tomorrow'),
                width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight};
            }""")
            assert sizes["clock"]["right"] <= sizes["button"]["left"]
            assert sizes["clock"]["left"] - sizes["header"]["left"] <= 24
            assert sizes["clock"]["width"] >= 130 and sizes["button"]["width"] == 44
            assert sizes["weather"]["width"] == 630
            assert sizes["button"]["left"] == sizes["lock"]["left"]
            assert sizes["button"]["top"] >= sizes["lock"]["bottom"] + 8
            assert sizes["weather"]["right"] <= sizes["lock"]["left"]
            assert sizes["lock"]["left"] - sizes["weather"]["right"] <= 18
            assert page.locator(".header-actions > #parent-lock-btn + #supplies-button").count() == 1
            assert page.locator(".weather-zone").evaluate("el => getComputedStyle(el).paddingInlineStart === getComputedStyle(el).paddingInlineEnd")
            expect(page.locator(".weather-zone")).to_have_css("border-top-width", "1px")
            assert sizes["button"]["height"] >= 44
            assert sizes["now"]["right"] <= sizes["hourly"]["left"]
            assert sizes["hourly"]["right"] <= sizes["tomorrow"]["left"]
            assert sizes["air"]["top"] >= sizes["tomorrow"]["bottom"]
            assert sizes["width"] <= 1280 and sizes["height"] <= 800
            for width, height in ((1024, 640), (961, 800), (390, 844)):
                page.set_viewport_size({"width": width, "height": height})
                face = clock.bounding_box()
                assert face["x"] + face["width"] <= button.bounding_box()["x"]
            page.set_viewport_size({"width": 1280, "height": 800})
            screenshot_dir = os.environ.get("FAMILY_SUPPLIES_SCREENSHOT_DIR")
            if screenshot_dir:
                page.screenshot(path=Path(screenshot_dir) / "kidsnote-active-1280x800.png")

            button.tap()
            expect(dialog).to_be_visible()
            close = dialog.get_by_role("button", name="닫기")
            expect(close).to_be_focused()
            expect(dialog.get_by_role("listitem")).to_have_count(20)
            expect(dialog.get_by_role("listitem").last).to_contain_text("등원하는 날")
            expect(dialog.get_by_role("listitem").last).to_contain_text(fixture["items"][0]["sourceDate"])
            if screenshot_dir:
                page.screenshot(path=Path(screenshot_dir) / "kidsnote-detail-1280x800.png")
            close.tap()
            expect(dialog).to_be_hidden()
            expect(button).to_be_focused()

            lock = page.locator("#parent-lock-btn")
            lock.dispatch_event("pointerdown", {"pointerId": 1, "pointerType": "touch", "button": 0})
            page.clock.fast_forward(3100)
            expect(page.locator("#parent-dialog")).to_have_attribute("open", "")
            expect(status).to_be_visible()
            page.keyboard.press("Escape")

            for count in (0, 1, 3):
                response.update(json={**fixture, "items": fixture["items"][:count],
                                      "state": "READY" if count else "EMPTY"})
                page.clock.fast_forward(31000)
                expect(status).to_contain_text(f"전체 {count}개" if count else "준비물 없음")
                expect(page.locator("#supplies-list li")).to_have_count(count)
                assert page.locator(".weather-zone").bounding_box()["width"] == sizes["weather"]["width"]
                if count:
                    expect(button).to_have_class(re.compile(r"\bhas-items\b"))
                else:
                    expect(button).to_be_enabled()
                    assert button.evaluate("el => getComputedStyle(el).boxShadow") == "none"
                    if screenshot_dir:
                        page.screenshot(path=Path(screenshot_dir) / "kidsnote-inactive-1280x800.png")
                    button.tap()
                    expect(dialog.get_by_role("status")).to_contain_text("준비물 없음")
                    expect(dialog.locator("#supplies-list")).to_be_hidden()
                    dialog.get_by_role("button", name="닫기").tap()
                    expect(button).to_be_focused()

            response.update(json={**fixture, "items": [], "state": "NEEDS_REVIEW",
                                  "complete": False, "reasonCode": "NO_RESULT_EVIDENCE",
                                  "checkedAt": None, "publishedAt": None, "deadlineState": "MISSED"})
            page.clock.fast_forward(31000)
            expect(status).to_contain_text("실행 미확인")
            expect(button).not_to_have_class(re.compile(r"\bhas-items\b"))
            button.tap()
            expect(dialog.get_by_role("status")).to_contain_text("확인이 아직 끝나지 않았어요")
            expect(dialog.get_by_role("status")).not_to_contain_text("준비물 없음")
            page.keyboard.press("Escape")

            response.update(json={**fixture, "items": [], "state": "NEEDS_REVIEW",
                                  "complete": False, "reasonCode": "DAILY_DECISION_BLOCKED",
                                  "checkedAt": None, "publishedAt": None, "deadlineState": "MISSED",
                                  "guardianConfirmation": {"source": "GUARDIAN", "sourceDate": "2026-11-20"},
                                  "dailyAssessment": {"blockers": ["SOURCE_PROOF_MISSING"],
                                                      "documentIssues": {"unread": 0, "detailUnverified": 0,
                                                                         "attachmentUnverified": 0,
                                                                         "instructionsUnverified": 1}}})
            page.clock.fast_forward(31000)
            button.tap()
            expect(dialog.get_by_role("status")).to_contain_text("준비물 없음 (보호자 확인)")
            expect(dialog.get_by_role("status")).to_contain_text("자동 판정 마감 미충족")
            expect(dialog.get_by_role("status")).to_contain_text("자료 충분성 검증 미등록")
            page.keyboard.press("Escape")

            response.update(json={**fixture, "items": fixture["items"][:1], "state": "NEEDS_REVIEW",
                                  "complete": False, "reasonCode": "PLANNED_RECHECK_PENDING",
                                  "checkedAt": "2026-11-19T20:21:00Z", "publishedAt": None, "deadlineState": "MISSED"})
            page.clock.fast_forward(31000)
            expect(status).to_contain_text("확인 필요")
            expect(status).to_contain_text("11/20 05:21 확인")
            expect(status).to_contain_text("마감 미충족")
            expect(page.locator("#supplies-list li")).to_have_count(1)
            button.tap()
            expect(dialog.locator("#supplies-dialog-status")).to_contain_text("확인 필요")
            page.keyboard.press("Escape")
            expect(dialog).to_be_hidden()

            response.update(json=fixture)
            page.clock.fast_forward(31000)
            expect(status).to_contain_text("전체 20개")
            # Same-day failure retains the verified list and its original timestamp.
            response.update(status=503, json={})
            page.clock.fast_forward(31000)
            expect(status).to_contain_text("갱신 실패")
            expect(status).to_contain_text("05:27 확인")
            button.tap()
            expect(dialog).to_be_visible()
            # A family auth failure immediately removes every copy of the items.
            response.update(status=401, json={})
            page.clock.fast_forward(31000)
            expect(status).to_have_text("가족 보드 로그인 필요")
            expect(page.locator("#supplies-list li")).to_have_count(0)
            expect(dialog.get_by_role("status")).to_have_text("가족 보드 로그인 필요")
            expect(dialog.get_by_role("link", name="가족 보드 로그인")).to_be_visible()
            expect(page.locator("#supplies-button")).not_to_have_class(re.compile(r"\bhas-items\b"))
            page.keyboard.press("Escape")

            response.update(status=200, json=fixture)
            page.clock.fast_forward(31000)
            expect(status).to_contain_text("전체 20개")
            response.update(status=503, json={})
            page.clock.fast_forward(18 * 60 * 60 * 1000)
            expect(status).to_contain_text("연결 후 확인")
            expect(page.locator("#supplies-list li")).to_have_count(0)
            expect(button).not_to_have_class(re.compile(r"\bhas-items\b"))
            keys = page.evaluate("""async () => {
              const entries = await Promise.all((await caches.keys()).map(async k => (await caches.open(k)).keys()));
              return entries.flat().map(r => r.url);
            }""")
            release = page.locator('meta[name="family-dashboard-release"]').get_attribute("content")
            assert origin + f"supplies.js?release={release}" in keys
            assert origin + f"kidsnote_app_icon.svg?release={release}" in keys
            assert all("/api/" not in url and "/cdn-cgi/" not in url for url in keys)

            ctx.unroute(endpoint)
            ctx.set_offline(True)
            page.reload(wait_until="domcontentloaded")
            expect(clock).to_be_visible()
            assert page.evaluate("""async () => {
                const faces = await document.fonts.load('700 20px "Pretendard Offline"', '준비물');
                return faces.length === 1 && faces[0].status === "loaded";
            }""")
            expect(status).to_contain_text("연결 후 확인")
            expect(page.locator("#supplies-list li")).to_have_count(0)
            button.tap()
            expect(dialog.get_by_role("status")).to_contain_text("연결 후 확인")
            page.keyboard.press("Escape")

            ctx.route(endpoint, lambda route: route.fulfill(status=404))
            ctx.set_offline(False)
            page.reload(wait_until="domcontentloaded")
            expect(status).to_contain_text("연결 후 확인")
            expect(button).to_be_visible()
            expect(button).to_be_enabled()
            expect(button).not_to_have_class(re.compile(r"\bhas-items\b"))

            # A response initiated before midnight cannot put yesterday's list back on screen.
            ctx.unroute(endpoint)
            response.update(status=200, json={**fixture, "serverNow": "2026-11-21T14:59:57Z"})
            ctx.route(endpoint, lambda route: route.fulfill(**response))
            boundary = ctx.new_page()
            boundary.add_init_script("""(() => {
              const fetchWithoutDelay = window.fetch.bind(window);
              window.deferSupplies = true;
              window.fetch = async (...args) => {
                const res = await fetchWithoutDelay(...args);
                if (String(args[0]).endsWith('/api/supplies/today') && window.deferSupplies) {
                  await new Promise(resolve => { window.releaseSupplies = resolve; });
                  delete window.releaseSupplies;
                }
                return res;
              };
            })()""")
            boundary.clock.install(time=datetime(2026, 11, 21, 14, 59, 57, tzinfo=timezone.utc))
            boundary.goto(origin, wait_until="domcontentloaded")
            expect(boundary.locator("#tomorrow-low")).to_have_text("-2°")
            boundary.wait_for_function("typeof window.releaseSupplies === 'function'", timeout=5000)
            boundary.clock.fast_forward(6000)
            expect(boundary.locator("#tomorrow-condition")).to_have_text("예보 확인 불가")
            expect(boundary.locator("#tomorrow-range")).to_be_hidden()
            boundary.evaluate("() => { window.deferSupplies = false; window.releaseSupplies(); }")
            expect(boundary.locator("#supplies-status")).to_contain_text("연결 후 확인")
            expect(boundary.locator("#supplies-list li")).to_have_count(0)

            next_item = {**fixture["items"][0], "label": "물통", "applicableDate": "2026-11-22"}
            response.update(json={**fixture, "serverNow": "2026-11-21T15:00:35Z",
                                  "targetDate": "2026-11-22", "items": [next_item]})
            boundary.clock.fast_forward(31000)
            expect(boundary.locator("#supplies-list li")).to_have_count(1)
            expect(boundary.get_by_role("button", name="키즈노트", exact=True)).to_be_enabled()
            boundary.evaluate("""() => {
              window.deferSupplies = true;
              Object.defineProperty(document, 'hidden', {configurable: true, value: true});
              document.dispatchEvent(new Event('visibilitychange'));
            }""")
            ctx.unroute(endpoint)
            ctx.route(endpoint, lambda route: route.fulfill(status=302, headers={"Location": origin + "login"}))
            boundary.evaluate("""() => {
              Object.defineProperty(document, 'hidden', {configurable: true, value: false});
              document.dispatchEvent(new Event('visibilitychange'));
            }""")
            boundary.wait_for_function("typeof window.releaseSupplies === 'function'", timeout=5000)
            expect(boundary.locator("#supplies-list li")).to_have_count(0)
            boundary.evaluate("() => window.releaseSupplies()")
            expect(boundary.locator("#supplies-status")).to_have_text("가족 보드 로그인 필요")

            # Midnight clears an already-open list and also guards a click before the next poll.
            ctx.unroute(endpoint)
            ctx.route(endpoint, lambda route: route.fulfill(json={**fixture, "serverNow": "2026-11-21T14:59:59Z"}))
            for open_before_midnight in (False, True):
                midnight = ctx.new_page()
                midnight.clock.install(time=datetime(2026, 11, 21, 14, 59, 59, tzinfo=timezone.utc))
                midnight.goto(origin)
                midnight_button = midnight.locator("#supplies-button")
                expect(midnight_button).to_have_class(re.compile(r"\bhas-items\b"))
                midnight_dialog = midnight.locator("#supplies-dialog")
                if open_before_midnight:
                    midnight_button.tap()
                    expect(midnight_dialog).to_be_visible()
                    midnight.clock.fast_forward(1200)
                else:
                    midnight.clock.set_system_time(datetime(2026, 11, 21, 15, 0, 0, 100000, tzinfo=timezone.utc))
                    midnight_button.evaluate("el => el.click()")
                expect(midnight_button).not_to_have_class(re.compile(r"\bhas-items\b"))
                expect(midnight_dialog).to_be_visible()
                expect(midnight_dialog.get_by_role("status")).to_contain_text("연결 후 확인")
                expect(midnight.locator("#supplies-list li")).to_have_count(0)
                midnight.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_installed_family_profile_updates_without_mixing_shell_files(tmp_path):
    source = ROOT / "web"
    template = re.search(r'^const CACHE_VERSION = "([^"]+)";$', (source / "sw.js").read_text(encoding="utf-8"), re.M)[1]
    for version in ("test-old", "test-next"):
        directory = tmp_path / version
        shutil.copytree(source, directory)
        for file in directory.glob("*"):
            if file.suffix not in {".js", ".css", ".html"}:
                continue
            text = file.read_text(encoding="utf-8").replace(f'="{template}"', f'="{version}"')
            text = text.replace(f'?release={template}', f'?release={version}')
            text = text.replace(f'const CACHE_VERSION = "{template}";', f'const CACHE_VERSION = "{version}";')
            if file.name == "index.html":
                text = text.replace('<html ', '<html data-supplies-enabled="true" ', 1)
            file.write_text(text, encoding="utf-8")
    release = {"directory": "test-old", "fault": False, "auth_expired": False}
    failed_asset = threading.Event()
    fixture = (ROOT / "tests/fixtures/supplies-today.json").read_bytes()

    class ReleaseHandler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                          ".js": "text/javascript", ".woff2": "font/woff2", ".wav": "audio/wav",
                          ".svg": "image/svg+xml"}

        def __init__(self, *args):
            super().__init__(*args, directory=tmp_path / release["directory"])

        def log_message(self, *args):
            pass

        def do_GET(self):
            location = urlsplit(self.path)
            if release["auth_expired"] and location.path == "/":
                self.send_response(302)
                self.send_header("Location", "/login")
                self.end_headers()
                return
            if release["fault"] and location.path == "/supplies.js" and location.query == "release=test-next":
                failed_asset.set()
                self.close_connection = True
                return
            if location.path == "/sw.js":
                body = (Path(self.directory) / "sw.js").read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/javascript")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            if location.path == "/api/supplies/today":
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(fixture)
                return
            super().do_GET()

    server = ThreadingHTTPServer(("127.0.0.1", 0), ReleaseHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{server.server_port}/"
    try:
        with sync_playwright() as pw:
            context = pw.chromium.launch_persistent_context(
                str(tmp_path / "s7-profile"), viewport={"width": 1024, "height": 640},
                has_touch=True, timezone_id="Asia/Seoul",
            )
            context.route("https://**/*", lambda route: route.abort())
            page = context.pages[0]
            page.clock.install(time=datetime(2026, 11, 20, 22, tzinfo=timezone.utc))
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(origin)
            page.wait_for_function("navigator.serviceWorker.controller")
            expect(page.locator("#supplies-button")).to_be_enabled()
            page.evaluate("""async () => {
              const stateKey = 'family_dashboard_state_v1';
              localStorage.setItem(stateKey, JSON.stringify({...JSON.parse(localStorage.getItem(stateKey) || '{}'), childName:'테스트 별명'}));
              const { putMediaItems } = await import('./media_store.js?release=test-old');
              const blob = new Blob([Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), ch=>ch.charCodeAt(0))],
                {type:'image/gif'});
              await putMediaItems([{id:'s7-test-gif', theme:'babyshark', step:'step1', relPath:'test.gif',
                displayName:'test.gif', mimeType:'image/gif', blob}]);
            }""")
            release.update(directory="test-next", fault=True)
            page.evaluate("async () => (await navigator.serviceWorker.ready).update()")
            assert failed_asset.wait(5), "The interrupted deployment did not reach its failed asset"
            page.wait_for_function("""async () => {
              const r = await navigator.serviceWorker.ready;
              return !r.installing && !r.waiting;
            }""")
            page.reload(wait_until="domcontentloaded")
            revision = page.locator('meta[name="family-dashboard-release"]')
            expect(revision).to_have_attribute("content", "test-old")
            expect(page.locator("#supplies-button")).to_be_enabled()
            expect(page.locator("#shell-update")).to_be_hidden()
            assert not errors

            release["fault"] = False
            page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow'))")
            # A retry on a continuously open board also covers a reconnect during a failed install.
            page.clock.fast_forward(5 * 60 * 1000)
            expect(page.locator("#shell-update")).to_be_visible()
            page.locator("#shell-update").tap()
            expect(revision).to_have_attribute("content", "test-next")
            expect(page.locator("#supplies-button")).to_be_enabled()
            assert page.evaluate("""async () => {
              const state = JSON.parse(localStorage.getItem('family_dashboard_state_v1'));
              const { loadMediaPoolByTheme } = await import('./media_store.js?release=test-next');
              const pool = await loadMediaPoolByTheme();
              return state.childName==='테스트 별명' &&
                Object.values(pool.babyshark).flat().some(item=>item.id==='s7-test-gif' && item.blob.type==='image/gif');
            }""")
            page.goto(origin + "?open=family&rev=test-next")
            expect(revision).to_have_attribute("content", "test-next")
            expect(page.locator("#supplies-button")).to_be_enabled()
            context.set_offline(True)
            page.goto(origin, wait_until="domcontentloaded")
            expect(revision).to_have_attribute("content", "test-next")
            expect(page.locator("#clock-face")).to_be_visible()
            expect(page.locator("#supplies-button")).not_to_have_class(re.compile(r"\bhas-items\b"))
            page.locator("#supplies-button").tap()
            expect(page.locator("#supplies-dialog-status")).to_contain_text("연결 후 확인")
            page.keyboard.press("Escape")
            context.set_offline(False)
            release["auth_expired"] = True
            page.goto(origin, wait_until="domcontentloaded")
            expect(page).to_have_url(origin + "login")
            assert not errors
            context.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

def test_weather_partial_forecast_and_older_cache(tmp_path):
    server = start_server(ROOT / "web", store={"items": []}, state_file=tmp_path / "state.json", port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/"
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1024, "height": 640}, timezone_id="UTC")
            ctx.route("https://**/*", lambda route: route.abort())
            ctx.route("https://api.open-meteo.com/**", lambda route: route.fulfill(json={
                "current": {"time": "2026-11-21T07:00", "temperature_2m": 7, "weather_code": 42},
                "daily": {"time": ["2026-11-22", "2026-11-21"], "weather_code": [42, 3],
                          "temperature_2m_min": [-8, 2], "temperature_2m_max": [None, 6]},
                "hourly": {"time": ["2026-11-22T09:00"], "temperature_2m": [77]},
            }))
            page = ctx.new_page()
            page.clock.install(time=datetime(2026, 11, 20, 22, 5, tzinfo=timezone.utc))
            page.goto(url)
            expect(page.locator("#date-pill")).to_have_attribute("datetime", "2026-11-21")
            expect(page.locator("#weather-temp")).to_have_text("7°")
            expect(page.locator("#weather-cond")).to_have_text("현재 날씨 미확인")
            expect(page.locator("#weather-range")).to_have_text("최저 2° · 최고 6°")
            expect(page.locator("#tomorrow-low")).to_have_text("-8°")
            expect(page.locator("#tomorrow-high")).to_have_text("—")
            expect(page.locator("#tomorrow-condition")).to_have_text("날씨 미확인")
            expect(page.locator("#hourly-strip strong").first).to_have_text("—")
            expect(page.locator("#air-grade")).to_have_text("확인 불가")

            ctx.unroute("https://api.open-meteo.com/**")
            page.reload()
            expect(page.locator("#weather-source")).to_have_text("저장된 예보")
            expect(page.locator("#weather-source")).to_be_visible()
            expect(page.locator("#tomorrow-low")).to_have_text("-8°")
            page.clock.fast_forward(3 * 60 * 60 * 1000 + 1000)
            expect(page.locator("#tomorrow-range")).to_be_hidden()
            expect(page.locator("#weather-temp")).to_be_hidden()
            expect(page.locator("#tomorrow-condition")).to_have_text("예보 확인 불가")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
