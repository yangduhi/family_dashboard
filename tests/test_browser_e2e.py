from __future__ import annotations

import json
import re
import threading
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from app.server import start_server

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

            def _mock_open_meteo(route) -> None:
                url = route.request.url
                payload = MOCK_AIR_JSON if "air-quality-api" in url else MOCK_FORECAST_JSON
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(payload),
                )

            page.route("**/*open-meteo.com/**", _mock_open_meteo)

            with page.expect_response(
                lambda r: r.url.endswith("/api/state") and r.request.method == "GET" and r.status == 200
            ):
                page.goto(base_url, wait_until="domcontentloaded")

            cards = page.locator(".step-card")
            expect(cards).to_have_count(4)
            card0 = cards.nth(0)
            card1 = cards.nth(1)
            expect(card0).to_have_class(re.compile(r"\bis-active\b"))

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

            # 4. Regression (8e8690f): 3s parent hold release must keep dialog open,
            #    theme switch persists, and a fresh backdrop pointer press closes it
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

            # Switch theme to pororo and wait for state persistence
            with page.expect_response(
                lambda r: r.url.endswith("/api/state") and r.request.method == "POST" and r.status == 200
            ):
                dialog.locator('[data-theme-choice="pororo"]').click()
            expect(page.locator("html")).to_have_attribute("data-theme", "pororo")

            # Control check: a fresh backdrop pointerdown + pointerup outside dialog closes it
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

            # Reload and verify theme persistence
            page.reload(wait_until="domcontentloaded")
            expect(page.locator("html")).to_have_attribute("data-theme", "pororo")

            context.close()
            browser.close()
    finally:
        srv.shutdown()
        srv.server_close()
        th.join(timeout=3)

    assert console_errors == [], f"Unexpected browser console errors: {console_errors}"
    assert page_errors == [], f"Unexpected browser page errors: {page_errors}"
