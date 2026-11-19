from __future__ import annotations

import base64
import json
import re
import threading
import zipfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from app.server import start_server

TINY_GIF_BYTES = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
TINY_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)

MOCK_FORECAST_JSON = {
    "current": {"temperature_2m": 9.2, "weather_code": 1},
    "daily": {"temperature_2m_min": [5.0], "temperature_2m_max": [14.0]},
    "hourly": {
        "time": [
            "2026-11-19T07:00",
            "2026-11-19T08:00",
            "2026-11-19T09:00",
            "2026-11-19T12:00",
            "2026-11-19T15:00",
            "2026-11-19T18:00",
        ],
        "temperature_2m": [6.0, 7.5, 9.0, 13.0, 14.0, 10.5],
        "precipitation_probability": [0, 10, 10, 20, 10, 0],
    },
}

MOCK_AIR_JSON = {
    "current": {"pm10": 18.0, "pm2_5": 9.0},
}


def _open_parent_dialog_by_touch(page) -> None:
    lock_btn = page.locator("#parent-lock-btn")
    dialog = page.locator("#parent-dialog")
    lock_box = lock_btn.bounding_box()
    assert lock_box is not None
    lx = lock_box["x"] + lock_box["width"] / 2
    ly = lock_box["y"] + lock_box["height"] / 2

    lock_btn.evaluate(
        """(el, {x, y}) => {
            el.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch',
                button: 0, clientX: x, clientY: y
            }));
        }""",
        {"x": lx, "y": ly},
    )
    expect(dialog).to_have_attribute("open", "", timeout=6000)

    # Release the opening pointer on #parent-dialog (where backdrop listener lives)
    dialog.evaluate(
        """(el, {x, y}) => {
            el.dispatchEvent(new PointerEvent('pointerup', {
                bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch',
                button: 0, clientX: x, clientY: y
            }));
        }""",
        {"x": lx, "y": ly},
    )
    expect(dialog).to_have_attribute("open", "")


def test_browser_child_lock_touch_holds_and_theme_persistence(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[1]
    srv = start_server(
        root / "web",
        store={"items": []},
        state_file=tmp_path / "dashboard_state.json",
        port=0,
    )
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()

    zip_path = tmp_path / "sample_pack.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("아기상어/등원준비/01_breakfast.gif", TINY_GIF_BYTES, compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("뽀로로/등원준비/01_breakfast.gif", TINY_GIF_BYTES, compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("뽀로로/등원준비/02_wash_brush.gif", TINY_GIF_BYTES, compress_type=zipfile.ZIP_DEFLATED)
        zf.writestr("pororo_morning_60/poster/pororo/bag_01.png", TINY_PNG_BYTES, compress_type=zipfile.ZIP_DEFLATED)

    slot_png_path = tmp_path / "custom_wash.png"
    slot_png_path.write_bytes(TINY_PNG_BYTES)

    console_errors: list[str] = []
    page_errors: list[str] = []
    weather_urls: list[str] = []

    try:
        base_url = f"http://127.0.0.1:{srv.server_port}/"
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                has_touch=True,
                service_workers="block",
            )
            # Pre-seed legacy location ('seoul') and stale weather cache to verify auto-migration
            context.add_init_script(
                """() => {
                    if (!sessionStorage.getItem('seeded_legacy_once')) {
                        sessionStorage.setItem('seeded_legacy_once', '1');
                        localStorage.setItem('family_dashboard_state_v1', JSON.stringify({
                            theme: 'babyshark',
                            childName: '우리 딸',
                            schoolLabel: '어린이집',
                            departureTime: '08:50',
                            prepStartTime: '07:50',
                            stepsCompleted: [false, false, false, false],
                            lastStampedDate: '2026-11-18',
                            location: { id: 'seoul', name: '서울 중구', lat: 37.5665, lon: 126.978 }
                        }));
                        localStorage.setItem('family_dashboard_weather_cache_v1', JSON.stringify({
                            locationId: 'seoul',
                            tempC: -99,
                            minTempC: -99,
                            maxTempC: -99,
                            weatherCode: 0,
                            pm10: 10,
                            pm25: 5,
                            precipProb: 0,
                            hourly: [],
                            offline: false
                        }));
                    }
                }"""
            )
            page = context.new_page()
            page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
            page.on("pageerror", lambda err: page_errors.append(str(err)))

            def _mock_open_meteo(route) -> None:
                url = route.request.url
                weather_urls.append(url)
                payload = MOCK_AIR_JSON if "air-quality-api" in url else MOCK_FORECAST_JSON
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(payload),
                )

            page.route("**/*open-meteo.com/**", _mock_open_meteo)

            page.goto(base_url, wait_until="domcontentloaded")
            expect(page.locator("#weather-cond")).to_contain_text("서울 강동구 상일동", timeout=5000)
            expect(page.locator("#cheer-bubble")).to_contain_text("채원이")
            expect(page.locator("#daycare-icon svg")).to_contain_text("어린이집")
            assert any("latitude=37.5566&longitude=127.1654" in u for u in weather_urls), weather_urls

            cards = page.locator(".step-card")
            expect(cards).to_have_count(4)
            card0 = cards.nth(0)
            card1 = cards.nth(1)
            expect(card0).to_have_class(re.compile(r"\bis-active\b"))
            assert float(card0.evaluate("el => getComputedStyle(el).opacity")) == 1.0
            assert float(card1.evaluate("el => getComputedStyle(el).opacity")) < 0.6

            # 1. Child lock: locked cards 2..4 have pointer-events: none and ignore taps
            for idx in (1, 2, 3):
                locked_card = cards.nth(idx)
                pointer_events = locked_card.evaluate("el => getComputedStyle(el).pointerEvents")
                assert pointer_events == "none"
                box = locked_card.bounding_box()
                assert box is not None
                page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)

            expect(card0).to_have_class(re.compile(r"\bis-active\b"))
            expect(page.locator(".step-card.is-done")).to_have_count(0)

            # 2. Tap active step 1 CTA -> step 1 becomes done, step 2 becomes active
            with page.expect_response(
                lambda r: r.url.endswith("/api/state") and r.request.method == "POST" and r.status == 200
            ):
                card0.locator(".stamp-cta-btn").click()

            expect(card0).to_have_class(re.compile(r"\bis-done\b"))
            expect(card1).to_have_class(re.compile(r"\bis-active\b"))

            # 3. Regression (8e8690f): 1.5s undo hold release must NOT re-stamp step 1
            undo_btn = card0.locator(".undo-hold-btn")
            expect(undo_btn).to_be_visible()
            undo_box = undo_btn.bounding_box()
            assert undo_box is not None
            ux = undo_box["x"] + undo_box["width"] / 2
            uy = undo_box["y"] + undo_box["height"] / 2

            undo_btn.evaluate(
                """(el, {x, y}) => {
                    el.dispatchEvent(new PointerEvent('pointerdown', {
                        bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch',
                        button: 0, clientX: x, clientY: y
                    }));
                }""",
                {"x": ux, "y": uy},
            )

            expect(card0).to_have_class(re.compile(r"\bis-active\b"), timeout=5000)
            new_cta = card0.locator(".stamp-cta-btn")
            expect(new_cta).to_be_visible()
            new_cta.evaluate(
                """(el, {x, y}) => {
                    el.dispatchEvent(new PointerEvent('pointerup', {
                        bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch',
                        button: 0, clientX: x, clientY: y
                    }));
                    el.dispatchEvent(new PointerEvent('click', {
                        bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch',
                        button: 0, clientX: x, clientY: y
                    }));
                }""",
                {"x": ux, "y": uy},
            )
            expect(card0).to_have_class(re.compile(r"\bis-active\b"))
            expect(page.locator(".step-card.is-done")).to_have_count(0)

            # 4. Regression (8e8690f): 3s parent hold release keeps dialog open,
            #    fixed location badge shown, ZIP & slot IndexedDB upload works
            _open_parent_dialog_by_touch(page)
            dialog = page.locator("#parent-dialog")
            expect(page.locator("#select-location")).to_have_count(0)
            expect(page.locator("#fixed-location-badge")).to_contain_text("서울 강동구 상일동")

            # Batch ZIP import (1 babyshark, 2 pororo; poster PNG skipped)
            page.locator("#input-batch-media").set_input_files(str(zip_path))
            expect(page.locator("#media-pool-status")).to_contain_text("아기상어 1개 · 뽀로로 2개", timeout=5000)

            # Direct slot multi-file upload (arbitrary filename without step keyword)
            page.locator('input[data-pool-step="step2"]').set_input_files(str(slot_png_path))
            expect(page.locator(".media-pool-card").nth(1)).to_contain_text("1개", timeout=5000)

            # Babyshark only has 1 item per step -> reroll status warns clearly instead of pretending it changed
            page.locator("#btn-reroll-media").click()
            expect(page.locator("#media-pool-status")).to_contain_text("단계별로 1개만 있어 바꿀 다른 그림이 없습니다")

            # Section 6 direct GIF upload with empty MIME preserves data:image/gif (never flattened to JPEG)
            empty_mime_gif = tmp_path / "direct_slot.gif"
            empty_mime_gif.write_bytes(TINY_GIF_BYTES)
            with page.expect_response(
                lambda r: r.url.endswith("/api/state") and r.request.method == "POST" and r.status == 200
            ):
                page.locator('input[data-custom-slot="mascot"]').set_input_files(
                    {
                        "name": "direct_slot.gif",
                        "mimeType": "",
                        "buffer": TINY_GIF_BYTES,
                    }
                )
            saved_mascot = page.evaluate(
                "() => JSON.parse(localStorage.getItem('family_dashboard_state_v1')).customImages.mascot"
            )
            assert saved_mascot.startswith("data:image/gif;base64,"), saved_mascot

            # Close dialog via fresh backdrop pointer press (control check)
            dialog.evaluate(
                """(el) => {
                    el.dispatchEvent(new PointerEvent('pointerdown', {
                        bubbles: true, cancelable: true, pointerId: 10, pointerType: 'touch',
                        button: 0, clientX: 5, clientY: 5
                    }));
                    el.dispatchEvent(new PointerEvent('pointerup', {
                        bubbles: true, cancelable: true, pointerId: 10, pointerType: 'touch',
                        button: 0, clientX: 5, clientY: 5
                    }));
                }"""
            )
            expect(dialog).not_to_have_attribute("open", "")

            # Verify babyshark step1 & step2 render blob: URLs, and stamping step1 keeps step2 URL fixed
            card0_img = card0.locator(".step-art img")
            card1_img = card1.locator(".step-art img")
            expect(card0_img).to_have_attribute("src", re.compile(r"^blob:"))
            expect(card1_img).to_have_attribute("src", re.compile(r"^blob:"))
            card1_blob_before = card1_img.get_attribute("src")

            with page.expect_response(
                lambda r: r.url.endswith("/api/state") and r.request.method == "POST" and r.status == 200
            ):
                card0.locator(".stamp-cta-btn").click()

            expect(card0).to_have_class(re.compile(r"\bis-done\b"))
            assert card1_img.get_attribute("src") == card1_blob_before

            # Re-open parent settings, switch theme to pororo, verify pool switches & persists across reload
            _open_parent_dialog_by_touch(page)
            with page.expect_response(
                lambda r: r.url.endswith("/api/state") and r.request.method == "POST" and r.status == 200
            ):
                dialog.locator('[data-theme-choice="pororo"]').click()
            expect(page.locator("html")).to_have_attribute("data-theme", "pororo")
            expect(page.locator("#media-pool-theme-label")).to_contain_text("뽀로로")
            expect(card0_img).to_have_attribute("src", re.compile(r"^blob:"))
            expect(card1_img).to_have_attribute("src", re.compile(r"^blob:"))
            expect(cards.nth(2).locator(".step-art svg")).to_have_count(1)

            page.locator("#btn-save-close").click()
            expect(dialog).not_to_have_attribute("open", "")

            page.reload(wait_until="domcontentloaded")
            expect(page.locator("html")).to_have_attribute("data-theme", "pororo")
            expect(page.locator("#weather-cond")).to_contain_text("서울 강동구 상일동", timeout=5000)
            expect(cards.nth(0).locator(".step-art img")).to_have_attribute("src", re.compile(r"^blob:"), timeout=5000)
            expect(cards.nth(1).locator(".step-art img")).to_have_attribute("src", re.compile(r"^blob:"), timeout=5000)

            context.close()
            browser.close()
    finally:
        srv.shutdown()
        srv.server_close()
        th.join(timeout=3)

    assert console_errors == [], f"Unexpected browser console errors: {console_errors}"
    assert page_errors == [], f"Unexpected browser page errors: {page_errors}"


def test_browser_broken_image_falls_back_to_svg(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[1]
    srv = start_server(
        root / "web",
        store={"items": []},
        state_file=tmp_path / "dashboard_state.json",
        port=0,
    )
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()

    try:
        base_url = f"http://127.0.0.1:{srv.server_port}/"
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                has_touch=True,
                service_workers="block",
            )
            context.add_init_script(
                """() => {
                    localStorage.setItem('family_dashboard_state_v1', JSON.stringify({
                        theme: 'babyshark',
                        stepsCompleted: [false, false, false, false],
                        lastStampedDate: '2026-11-19',
                        customImages: {
                            mascot: null,
                            stamp: null,
                            step1: null,
                            step2: null,
                            step3: './missing-asset-for-fallback-test.gif',
                            step4: null
                        }
                    }));
                }"""
            )
            page = context.new_page()
            page.route("**/*open-meteo.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(MOCK_FORECAST_JSON)))
            page.route("**/missing-asset-for-fallback-test.gif", lambda r: r.abort())

            page.goto(base_url, wait_until="domcontentloaded")
            step3_art = page.locator(".step-card").nth(2).locator(".step-art")
            expect(step3_art.locator("svg")).to_have_count(1, timeout=5000)
            expect(step3_art.locator("img")).to_have_count(0)

            context.close()
            browser.close()
    finally:
        srv.shutdown()
        srv.server_close()
        th.join(timeout=3)


def test_browser_theme_mascots_and_generated_stamp(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[1]
    srv = start_server(
        root / "web",
        store={"items": []},
        state_file=tmp_path / "dashboard_state.json",
        port=0,
    )
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()

    console_errors: list[str] = []
    page_errors: list[str] = []

    try:
        base_url = f"http://127.0.0.1:{srv.server_port}/"
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                has_touch=True,
                service_workers="block",
            )
            page = context.new_page()
            page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
            page.on("pageerror", lambda err: page_errors.append(str(err)))
            page.route(
                "**/*open-meteo.com/**",
                lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(MOCK_FORECAST_JSON)),
            )

            page.goto(base_url, wait_until="domcontentloaded")
            _open_parent_dialog_by_touch(page)

            # 1. Register common mascot first + babyshark-specific mascot
            with page.expect_response(
                lambda r: r.url.endswith("/api/state") and r.request.method == "POST" and r.status == 200
            ):
                page.locator('input[data-custom-slot="mascot"]').set_input_files(
                    {"name": "common.png", "mimeType": "image/png", "buffer": TINY_PNG_BYTES}
                )
            with page.expect_response(
                lambda r: r.url.endswith("/api/state") and r.request.method == "POST" and r.status == 200
            ):
                page.locator('input[data-custom-slot="mascot_babyshark"]').set_input_files(
                    {"name": "shark.gif", "mimeType": "image/gif", "buffer": TINY_GIF_BYTES}
                )

            # Verify all 3 mascot slots reflect babyshark-specific GIF
            expect(page.locator("#header-mascot img")).to_have_attribute("src", re.compile(r"^data:image/gif;"))
            expect(page.locator("#track-mascot img")).to_have_attribute("src", re.compile(r"^data:image/gif;"))
            expect(page.locator(".step-card.is-active .mini-mascot img")).to_have_attribute(
                "src", re.compile(r"^data:image/gif;")
            )

            # 2. Switch to pororo -> falls back to common mascot (PNG) since pororo-specific is empty
            dialog = page.locator("#parent-dialog")
            with page.expect_response(
                lambda r: r.url.endswith("/api/state") and r.request.method == "POST" and r.status == 200
            ):
                dialog.locator('[data-theme-choice="pororo"]').click()
            expect(page.locator("#header-mascot img")).to_have_attribute("src", re.compile(r"^data:image/png;"))

            # Register pororo-specific mascot -> replaces all 3 mascot slots for pororo
            with page.expect_response(
                lambda r: r.url.endswith("/api/state") and r.request.method == "POST" and r.status == 200
            ):
                page.locator('input[data-custom-slot="mascot_pororo"]').set_input_files(
                    {"name": "pororo.png", "mimeType": "image/png", "buffer": TINY_PNG_BYTES}
                )
            expect(page.locator("#header-mascot img")).to_have_attribute("src", re.compile(r"^data:image/png;"))
            expect(page.locator("#track-mascot img")).to_have_attribute("src", re.compile(r"^data:image/png;"))
            expect(page.locator(".step-card.is-active .mini-mascot img")).to_have_attribute(
                "src", re.compile(r"^data:image/png;")
            )

            # Reset babyshark-specific slot -> pororo-specific & common mascot stay preserved
            with page.expect_response(
                lambda r: r.url.endswith("/api/state") and r.request.method == "POST" and r.status == 200
            ):
                page.locator('button[data-reset-custom-slot="mascot_babyshark"]').click()

            stored_imgs = page.evaluate(
                "() => JSON.parse(localStorage.getItem('family_dashboard_state_v1')).customImages"
            )
            assert stored_imgs["mascot_babyshark"] is None
            assert stored_imgs["mascot_pororo"].startswith("data:image/png;")
            assert stored_imgs["mascot"].startswith("data:image/png;")

            page.locator("#btn-save-close").click()
            expect(dialog).not_to_have_attribute("open", "")

            # 3. Stamp card 1 -> generated stamp badge frames the theme mascot PNG
            with page.expect_response(
                lambda r: r.url.endswith("/api/state") and r.request.method == "POST" and r.status == 200
            ):
                page.locator(".step-card").nth(0).locator(".stamp-cta-btn").click()

            stamp_img = page.locator(".step-card").nth(0).locator(".stamp-generated img")
            expect(stamp_img).to_have_attribute("src", re.compile(r"^data:image/png;"))
            expect(page.locator(".step-card").nth(0).locator(".stamp-generated-banner")).to_have_text("대장 도장 쾅!")

            # 4. Reload persists pororo mascot & generated stamp
            page.reload(wait_until="domcontentloaded")
            expect(page.locator("html")).to_have_attribute("data-theme", "pororo")
            expect(page.locator("#header-mascot img")).to_have_attribute("src", re.compile(r"^data:image/png;"))
            expect(page.locator(".step-card").nth(0).locator(".stamp-generated img")).to_have_attribute(
                "src", re.compile(r"^data:image/png;")
            )

            context.close()
            browser.close()
    finally:
        srv.shutdown()
        srv.server_close()
        th.join(timeout=3)

    assert console_errors == [], f"Unexpected browser console errors: {console_errors}"
    assert page_errors == [], f"Unexpected browser page errors: {page_errors}"
