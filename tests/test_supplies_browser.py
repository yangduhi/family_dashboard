from datetime import date, datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import re
import shutil
import threading
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from app.server import start_server

ROOT = Path(__file__).resolve().parents[1]


def assert_clock_numeral_positions(clock):
    numbers = clock.locator(".clock-number")
    assert numbers.all_text_contents() == [str(hour) for hour in range(1, 13)]
    face = clock.bounding_box()
    boxes = []
    for hour, number in enumerate(numbers.all(), start=1):
        expect(number).to_be_visible()
        expect(number).to_have_css("rotate", "none")
        expect(number).to_have_css("transform", "none")
        box = number.bounding_box()
        left, top = box["x"], box["y"]
        right, bottom = left + box["width"], top + box["height"]
        assert face["x"] <= left < right <= face["x"] + face["width"], hour
        assert face["y"] <= top < bottom <= face["y"] + face["height"], hour
        x = (left + box["width"] / 2 - face["x"]) / face["width"] - 0.5
        y = (top + box["height"] / 2 - face["y"]) / face["height"] - 0.5
        angle = math.radians(30 * hour)
        assert abs(x - 0.42 * math.sin(angle)) < 0.02, hour
        assert abs(y + 0.42 * math.cos(angle)) < 0.02, hour
        for other_left, other_top, other_right, other_bottom in boxes:
            assert right < other_left or other_right < left or bottom < other_top or other_bottom < top, hour
        boxes.append((left, top, right, bottom))


def assert_calendar_weekend_styles(calendar, mobile):
    gray = "rgb(240, 241, 242)"
    cells = calendar.locator("#calendar-days > li:visible").evaluate_all("""cells => cells.map(cell => {
        const label = cell.querySelector('.calendar-date');
        const rect = cell.getBoundingClientRect();
        return {date: label.dateTime, bg: getComputedStyle(cell).backgroundColor,
                labelBg: getComputedStyle(label).backgroundColor, x: rect.x, height: rect.height};
    })""")
    weekdays = set()
    for cell in cells:
        weekday = date.fromisoformat(cell["date"]).weekday()
        weekdays.add(weekday)
        assert (cell["bg"] == gray) == (weekday >= 5), cell
        assert (cell["labelBg"] == gray) == (weekday >= 5), cell
    assert {4, 5, 6} <= weekdays
    assert calendar.evaluate("el => el.scrollWidth === el.clientWidth && el.querySelector('.dialog-body').scrollWidth === el.querySelector('.dialog-body').clientWidth")
    headers = calendar.locator(".calendar-weekdays")
    if mobile:
        expect(headers).to_be_hidden()
        assert len({cell["x"] for cell in cells}) == 1
    else:
        styles = headers.locator("span").evaluate_all("els => els.map(el => getComputedStyle(el).backgroundColor)")
        assert [i for i, color in enumerate(styles) if color == gray] == [0, 6]
        assert len({cell["x"] for cell in cells}) == 7
        assert max(cell["height"] for cell in cells) - min(cell["height"] for cell in cells) <= 1


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
                expect(page.locator("#calendar-button")).to_be_hidden()
                expect(page.locator("#calendar-dialog")).to_be_hidden()
                expect(page.locator("#calendar-days > li")).to_have_count(0)
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
                page.locator('[data-theme-choice="babyshark"]').click()
                expect(page.locator("html")).to_have_attribute("data-theme", "babyshark")
                assert_clock_numeral_positions(page.locator("#clock-face"))
                page.locator('[data-theme-choice="pororo"]').click()
                page.locator("#input-child-name").fill("사용자 호칭")
                page.locator("#btn-save-close").click()
                page.reload()
                expect(page.locator("html")).to_have_attribute("data-theme", "pororo")
                assert_clock_numeral_positions(page.locator("#clock-face"))
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
    fixture["monthlyCalendar"] = {"month": "2026-11", "status": "AVAILABLE", "events": [
        {"date": "2026-11-03", "title": "낙엽 놀이", "audience": "AGE_ONE", "time": "10:00"},
        {"date": "2026-11-03", "title": "동화 산책", "audience": "INCLUDES_ONE"},
        {"date": "2026-11-12", "title": "가족 음악회", "audience": "SHARED"},
        {"date": "2026-11-20", "title": "숲 체험", "audience": "OTHER"},
        {"date": "2026-11-26", "title": "은빛반 미술 활동", "audience": "UNCONFIRMED"},
    ]}
    museum = {"date": "2026-12-07", "title": "박물관 견학", "audience": "UNCONFIRMED"}
    competition = {"date": "2026-12-11", "title": "체육 대회", "audience": "UNCONFIRMED", "time": "10:00"}
    december = {"month": "2026-12", "status": "AVAILABLE", "events": [museum, competition]}
    fixture["nextMonthlyCalendar"] = december
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
                "hourly": {"time": ["2026-11-21T09:00", "2026-11-21T16:00", "2026-11-22T09:00"],
                           "temperature_2m": [10, 13, 25], "apparent_temperature": [8, 11, 24],
                           "precipitation_probability": [0, 80, 99]},
            }))
            ctx.route("https://air-quality-api.open-meteo.com/**", lambda route: route.fulfill(json={}))
            ctx.route(endpoint, lambda route: route.fulfill(headers={"Cache-Control": "no-store"}, **response))
            page = ctx.new_page()
            page.clock.install(time=datetime(2026, 11, 20, 21, 59, tzinfo=timezone.utc))
            page.clock.pause_at(datetime(2026, 11, 20, 22, tzinfo=timezone.utc))
            page.goto(origin)
            page.wait_for_function("navigator.serviceWorker.controller !== null")
            status = page.locator("#supplies-status")
            button = page.get_by_role("button", name="키즈노트", exact=True)
            dialog = page.get_by_role("dialog", name="키즈노트", exact=True)
            calendar_button = dialog.get_by_role("button", name="월간 일정표", exact=True)
            calendar = page.get_by_role("dialog", name="월간 일정표", exact=True)
            expect(status).to_contain_text("전체 20개")
            expect(button).to_be_enabled()
            expect(button).to_have_accessible_description("오늘 표시할 준비물이 있습니다. 상세 내용을 확인해 주세요.")
            assert button.evaluate("el => getComputedStyle(el).boxShadow") != "none"
            expect(page.get_by_text("준비물 19", exact=False)).to_be_hidden()
            clock = page.locator("#clock-face")
            expect(clock).to_have_attribute("aria-label", "현재 시각 오전 7:00")
            assert_clock_numeral_positions(clock)
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
            page.clock.resume()
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
            expect(page.locator("#commute-09")).to_have_text("등원 체감 8°C 강수 0%")
            expect(page.locator("#commute-16")).to_have_text("하원 체감 11°C 강수 80%")
            expect(page.locator(".weather-footer")).not_to_contain_text("상일동")
            expect(page.locator(".weather-zone")).not_to_contain_text("겉옷 챙기기")
            expect(page.locator(".weather-footer").get_by_role("link")).to_have_count(0)
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
            expect(page.locator(".header-actions button")).to_have_count(2)
            expect(page.locator(".header-actions #calendar-button")).to_have_count(0)
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
                assert_clock_numeral_positions(clock)
                assert face["x"] + face["width"] <= button.bounding_box()["x"]
                expect(page.locator("#calendar-button")).to_be_hidden()
            page.set_viewport_size({"width": 1280, "height": 800})
            screenshot_dir = os.environ.get("FAMILY_SUPPLIES_SCREENSHOT_DIR")
            if screenshot_dir:
                page.screenshot(path=Path(screenshot_dir) / "kidsnote-active-1280x800.png")

            button.tap()
            expect(calendar_button).to_have_text("월간 일정표")
            expect(calendar_button.locator("svg")).to_be_visible()
            page.set_viewport_size({"width": 390, "height": 844})
            icon = calendar_button.bounding_box()
            assert icon["width"] >= 44 and icon["height"] >= 44 and icon["x"] + icon["width"] <= 390
            if screenshot_dir:
                page.screenshot(path=Path(screenshot_dir) / "kidsnote-detail-390x844.png")
            week_dates = dialog.locator("#week-days > li time")
            visible_dates = week_dates.all_text_contents()
            detail_body = dialog.locator(".dialog-body")
            scroll_top = detail_body.evaluate("el => { el.scrollTop = 120; return el.scrollTop; }")
            assert scroll_top > 0
            calendar_button.tap()
            expect(calendar).to_be_visible()
            page.keyboard.press("Escape")
            expect(calendar).to_be_hidden()
            expect(calendar_button).to_be_focused()
            expect(week_dates).to_have_text(visible_dates)
            assert detail_body.evaluate("el => el.scrollTop") == scroll_top
            page.keyboard.press("Escape")
            expect(dialog).to_be_hidden()
            expect(button).to_be_focused()
            page.set_viewport_size({"width": 1280, "height": 800})
            button.tap()
            calendar_button.tap()
            expect(calendar).to_be_visible()
            expect(calendar.get_by_role("button", name="닫기")).to_be_focused()
            november_button = calendar.get_by_role("button", name="2026년 11월")
            december_button = calendar.get_by_role("button", name="2026년 12월")
            expect(november_button).to_have_attribute("aria-pressed", "true")
            calendar_days = calendar.locator("#calendar-days > li")
            expect(calendar_days).to_have_count(30)
            expect(calendar.locator(".calendar-weekdays span")).to_have_text(list("일월화수목금토"))
            labels = ["만 1세 전용", "만 1세 포함", "전체 공통", "다른 연령", "대상 미확인"]
            for event, label in zip(fixture["monthlyCalendar"]["events"], labels):
                day = calendar_days.filter(has=page.locator(f'time[datetime="{event["date"]}"]'))
                entry = day.locator(".calendar-event").filter(has_text=event["title"])
                expect(entry.locator(".calendar-audience")).to_have_text(label)
                if "time" in event:
                    expect(entry.locator("time")).to_have_text(event["time"])
                else:
                    expect(entry.locator("time")).to_have_count(0)
            colors = calendar.locator(".calendar-event").evaluate_all("rows => rows.map(r => getComputedStyle(r).backgroundColor)")
            assert len(set(colors[:3])) == 3
            assert calendar_days.nth(2).bounding_box()["y"] == calendar_days.nth(6).bounding_box()["y"]
            assert calendar_days.nth(7).bounding_box()["y"] > calendar_days.first.bounding_box()["y"]
            if screenshot_dir:
                page.screenshot(path=Path(screenshot_dir) / "calendar-1280x800.png")
            dense_events = [
                {"date": "2026-11-03", "title": f"가을 미술 활동 {i + 1} · 나뭇잎으로 우리 동네 꾸미기",
                 "audience": "INCLUDES_ONE", "time": f"10:{i:02d}"} for i in range(12)
            ]
            dense_events[-1].update(ageOneParticipation="CONFIRMED", preparations=[{"label": "어린이 위생장갑"}])
            response.update(json={**fixture, "monthlyCalendar": {**fixture["monthlyCalendar"],
                                  "events": [*fixture["monthlyCalendar"]["events"], *dense_events]}})
            page.clock.fast_forward(31000)
            agenda = calendar.get_by_role("list", name="2026년 11월 3일 화요일 행사 14개")
            expect(agenda.locator(":scope > li")).to_have_count(14)
            audit = []
            for width, height, scale in [(1280, 800, 100), (1024, 640, 200), (390, 844, 200)]:
                page.set_viewport_size({"width": width, "height": height})
                page.evaluate("scale => document.documentElement.style.fontSize = scale + '%'", scale)
                bounds = calendar.evaluate("""dialog => {
                    const cells = [...dialog.querySelectorAll('#calendar-days > li')].filter(el => el.clientHeight);
                    const lists = cells.flatMap(el => [...el.querySelectorAll('.calendar-events')]);
                    const heights = cells.map(el => el.getBoundingClientRect().height);
                    return {minHeight: Math.min(...heights), maxHeight: Math.max(...heights),
                      maxOverflowX: Math.max(...[dialog, dialog.querySelector('.dialog-body'), ...cells, ...lists]
                        .map(el => el.scrollWidth - el.clientWidth))};
                }""")
                audit.append({"width": width, "height": height, "fontPercent": scale, **bounds})
                assert bounds["maxOverflowX"] <= 1, bounds
                if width > 640:
                    assert bounds["maxHeight"] - bounds["minHeight"] <= 1, bounds
                    calendar.get_by_role("button", name="닫기").focus()
                    page.keyboard.press("Tab")
                    expect(agenda).to_be_focused()
                    assert agenda.evaluate("el => el.scrollHeight > el.clientHeight")
                    agenda.press("End")
                    page.wait_for_function("""() => {
                      const el = document.activeElement;
                      return el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
                    }""")
                    page.clock.fast_forward(31000)
                    expect(agenda).to_be_focused()
                    last = agenda.locator(".calendar-event").last
                    assert last.evaluate("""el => el.getBoundingClientRect().bottom <=
                        el.parentElement.getBoundingClientRect().bottom + 1""")
                    expect(last).to_contain_text("10:11")
                    agenda.press("Home")
                    page.wait_for_function("document.activeElement.scrollTop === 0")
                else:
                    assert agenda.evaluate("el => el.scrollHeight === el.clientHeight")
                    last_hint = agenda.get_by_text("사용 예정 · 제출일 미확인")
                    last_hint.scroll_into_view_if_needed()
                    expect(last_hint).to_be_in_viewport()
                    expect(agenda.locator(".calendar-event time").last).to_have_text("10:11")
                if screenshot_dir:
                    page.screenshot(path=Path(screenshot_dir) / f"calendar-dense-{width}x{height}-{scale}.png")
            if screenshot_dir:
                (Path(screenshot_dir) / "calendar-geometry.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")
            page.evaluate("document.documentElement.style.removeProperty('font-size')")
            response.update(json=fixture)
            page.clock.fast_forward(31000)
            expect(calendar.locator(".calendar-event")).to_have_count(5)
            page.set_viewport_size({"width": 390, "height": 844})
            expect(calendar.locator(".calendar-day-long:visible")).to_have_text(
                ["11월 3일 화요일", "11월 12일 목요일", "11월 20일 금요일", "11월 26일 목요일"])
            assert calendar.locator(".dialog-body").evaluate("el => el.scrollWidth === el.clientWidth")
            if screenshot_dir:
                page.screenshot(path=Path(screenshot_dir) / "calendar-390x844.png")
            december_button.tap()
            expect(december_button).to_have_attribute("aria-pressed", "true")
            expect(calendar.locator(".calendar-day-long:visible")).to_have_text(["12월 7일 월요일", "12월 11일 금요일"])
            expect(calendar_days.nth(6)).to_contain_text("박물관 견학")
            expect(calendar_days.nth(10)).to_contain_text("체육 대회")
            expect(calendar_days.nth(10).locator(".calendar-audience")).to_have_text("대상 미확인")
            expect(calendar_days.nth(10).locator(".calendar-event time")).to_have_text("10:00")
            expect(calendar).not_to_contain_text("낙엽 놀이")
            if screenshot_dir:
                page.screenshot(path=Path(screenshot_dir) / "calendar-december-390x844.png")
            page.set_viewport_size({"width": 1280, "height": 800})
            expect(calendar_days).to_have_count(31)
            if screenshot_dir:
                page.screenshot(path=Path(screenshot_dir) / "calendar-december-1280x800.png")

            for snapshot, message in [
                (None, "월간 일정표 미확인"),
                ({"month": "2026-12", "status": "PENDING", "events": []}, "월간 일정표 갱신 대기"),
                (fixture["monthlyCalendar"], "월간 일정표 미확인"),
            ]:
                payload = {key: value for key, value in fixture.items() if key != "nextMonthlyCalendar"}
                if snapshot is not None:
                    payload["nextMonthlyCalendar"] = snapshot
                response.update(json=payload)
                page.clock.fast_forward(31000)
                expect(december_button).to_have_attribute("aria-pressed", "true")
                expect(calendar.get_by_role("status")).to_have_text(message)
                expect(calendar_days).to_have_count(0)
                november_button.tap()
                expect(calendar).to_contain_text("낙엽 놀이")
                december_button.tap()
            untimed = {key: value for key, value in competition.items() if key != "time"}
            response.update(json={**fixture, "nextMonthlyCalendar": {**december, "events": [museum, untimed]}})
            page.clock.fast_forward(31000)
            expect(calendar_days.nth(10)).to_contain_text("체육 대회")
            expect(calendar_days.nth(10).locator(".calendar-event time")).to_have_count(0)
            response.update(json=fixture)
            page.clock.fast_forward(31000)
            expect(calendar_days.nth(10).locator(".calendar-event time")).to_have_text("10:00")
            page.keyboard.press("Escape")
            expect(calendar_button).to_be_focused()
            page.set_viewport_size({"width": 1280, "height": 800})
            calendar_button.press("Enter")
            calendar.get_by_role("button", name="닫기").press("Enter")
            expect(calendar_button).to_be_focused()

            activity = {"date": "2026-11-25", "title": "미술 놀이", "audience": "INCLUDES_ONE",
                     "preparations": [{"label": "앞치마", "dueDate": "2026-11-25"}]}
            verified = {"date": activity["date"], "title": "앞치마", "sourceDate": "2026-11-20",
                        "detail": "미술 놀이에 사용", "kind": "PREPARATION", "status": "VERIFIED"}
            saturday = {"date": "2026-11-07", "title": "토요 놀이", "audience": "AGE_ONE"}
            sunday = {"date": "2026-11-08", "title": "일요 놀이", "audience": "INCLUDES_ONE"}
            response.update(json={**fixture, "weekPreparations": [verified],
                                  "monthlyCalendar": {"month": "2026-11", "status": "NEEDS_REVIEW",
                                      "events": [*fixture["monthlyCalendar"]["events"], activity, saturday, sunday]},
                                  "nextMonthlyCalendar": {**december, "events": [
                                      museum, competition, {**saturday, "date": "2026-12-05"}, {**sunday, "date": "2026-12-06"}]}})
            page.clock.fast_forward(31000)
            supply_day = dialog.locator("#week-days > li").filter(has_text="앞치마")
            expect(supply_day).to_contain_text("제출일 2026-11-25")
            expect(supply_day).not_to_contain_text(re.compile("확인 필요|제출일 미확인"))
            calendar_button.tap()
            expect(calendar.locator("#calendar-status")).to_be_hidden()
            expect(calendar.locator(".calendar-event")).to_have_count(8)
            activity_row = calendar.locator(".calendar-event").filter(has_text="미술 놀이")
            expect(activity_row).to_contain_text("앞치마")
            expect(activity_row).to_contain_text("제출일 2026-11-25")
            expect(activity_row).not_to_contain_text(re.compile("확인 필요|제출일 미확인"))
            expect(calendar.locator(".calendar-event").filter(has_text="은빛반 미술 활동")).to_contain_text("대상 미확인")
            for month, control in [(11, november_button), (12, december_button)]:
                control.tap()
                for width, height in [(1280, 800), (390, 844)]:
                    page.set_viewport_size({"width": width, "height": height})
                    assert_calendar_weekend_styles(calendar, width == 390)
                    for title, label, color in [("토요 놀이", "만 1세 전용", colors[0]), ("일요 놀이", "만 1세 포함", colors[1])]:
                        event = calendar.locator(".calendar-event").filter(has_text=title)
                        expect(event).to_contain_text(label)
                        expect(event).to_have_css("background-color", color)
                    if screenshot_dir:
                        page.screenshot(path=Path(screenshot_dir) / f"calendar-weekends-{month}-{width}x{height}.png")
            page.set_viewport_size({"width": 1280, "height": 800})
            november_button.tap()
            for state, message in [("NEEDS_REVIEW", "아직 확인된 행사가 없습니다"), ("AVAILABLE", "등록된 행사 없음")]:
                response.update(json={**fixture, "monthlyCalendar": {"month": "2026-11", "status": state, "events": []}})
                page.clock.fast_forward(31000)
                expect(calendar.get_by_role("status")).to_have_text(message)
                expect(calendar.locator(".calendar-event")).to_have_count(0)
            response.update(json={**fixture, "monthlyCalendar": {"month": "2026-11", "status": "PENDING", "events": []}})
            page.clock.fast_forward(31000)
            expect(calendar.get_by_role("status")).to_have_text("월간 일정표 갱신 대기")
            expect(calendar_days).to_have_count(0)
            response.update(json={key: value for key, value in fixture.items() if key != "monthlyCalendar"})
            page.clock.fast_forward(31000)
            expect(calendar.get_by_role("status")).to_have_text("월간 일정표 미확인")

            for invalid in (
                {"rawText": "비공개 원문"},
                {"month": "2026-12"},
                {"status": "PENDING"},
                {"events": [{**fixture["monthlyCalendar"]["events"][0], "time": "24:00"}]},
                {"events": [{**fixture["monthlyCalendar"]["events"][0], "rawText": "비공개 원문"}]},
                {"events": [{**fixture["monthlyCalendar"]["events"][0], "preparations": [{"label": "옷", "dueDate": "미정"}]}]},
            ):
                response.update(json={**fixture, "monthlyCalendar": {**fixture["monthlyCalendar"], **invalid}})
                with page.expect_response(endpoint):
                    page.clock.fast_forward(31000)
                expect(calendar.get_by_role("status")).to_have_text("월간 일정표 미확인")
                expect(calendar_days).to_have_count(0)
                expect(page.locator("#supplies-list li")).to_have_count(20)
            december_button.tap()
            expect(calendar_days.nth(10)).to_contain_text("10:00")
            page.keyboard.press("Escape")
            expect(calendar_button).to_be_focused()
            page.keyboard.press("Escape")
            expect(button).to_be_focused()
            response.update(json=fixture)
            page.clock.fast_forward(31000)
            button.tap()
            expect(dialog).to_be_visible()
            close = dialog.get_by_role("button", name="닫기")
            expect(close).to_be_focused()
            today_items = dialog.get_by_role("list", name="오늘 챙길 물품").get_by_role("listitem")
            expect(today_items).to_have_count(20)
            expect(today_items.last).to_contain_text("등원하는 날")
            expect(today_items.last).to_contain_text(fixture["items"][0]["sourceDate"])
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

            bulletin = {"status": "VERIFIED", "date": "2026-11-24", "detail": "10시 시작",
                        "sourceDate": "2026-11-20"}
            activity = {**bulletin, "kind": "PREPARATION", "title": "체험 활동 준비", "detail": "여벌 옷 지참"}
            apron = {**activity, "title": "미술 앞치마", "detail": "소매 있는 앞치마",
                     "date": "2026-11-27", "status": "REVIEW_REQUIRED"}
            prior = {**activity, "title": "도서 반납", "detail": "빌린 책 지참",
                     "date": "2026-11-19", "sourceDate": "2026-11-17"}
            saturday = {**activity, "title": "토요 활동 준비", "date": "2026-11-28"}
            bulletins = [
                {**bulletin, "kind": "EVENT", "title": "인형극"},
                {**bulletin, "kind": "INFORMATION", "title": "출입구 변경", "date": None,
                 "status": "REVIEW_REQUIRED", "detail": "등원 시 정문 이용"},
                activity, apron, saturday,
                {**bulletin, "kind": "PREPARATION", "title": "날짜 미정 준비", "date": None, "status": "REVIEW_REQUIRED"},
                {**bulletin, "kind": "EVENT", "title": "산책", "date": "2026-11-23"},
            ]
            response.update(json={**fixture, "items": fixture["items"][:1], "bulletins": bulletins,
                                  "weekPreparations": [prior, activity, apron, saturday]})
            page.clock.fast_forward(31000)
            expect(status).to_contain_text("전체 1개")
            button.tap()
            preparation = dialog.get_by_role("region", name="준비물", exact=True)
            events = dialog.get_by_role("region", name="일정", exact=True)
            information = dialog.get_by_role("region", name="특이사항", exact=True)
            expect(dialog.locator("#kidsnote-date")).to_have_attribute("datetime", fixture["targetDate"])
            expect(dialog.get_by_role("status")).to_contain_text("오늘 준비물 1개")
            week = dialog.locator("#kidsnote-week")
            grid = week.locator("#week-days")
            days = grid.locator(":scope > li")
            review = week.locator("#week-review-list")

            def expect_week_dates(first_day):
                expect(days).to_have_count(5)
                expect(days.locator("time")).to_have_text(
                    [f"11/{first_day + offset} ({name})" for offset, name in enumerate("월화수목금")]
                )
                for offset in range(5):
                    expect(days.nth(offset).locator("time")).to_have_attribute("datetime", f"2026-11-{first_day + offset}")

            expect(week).to_be_visible()
            expect(week.get_by_role("button")).to_have_count(0)
            expect(week.locator("#week-range")).to_have_count(0)
            expect_week_dates(23)
            expect(week.locator('[aria-current="date"]')).to_have_count(0)
            for offset in (0, 2, 3):
                expect(days.nth(offset)).to_contain_text("등록된 안내 없음")
            expect(days.nth(4)).to_contain_text("확정된 안내 없음")
            expect(days.nth(1)).to_contain_text("체험 활동 준비")
            expect(days.nth(1)).to_contain_text("여벌 옷 지참")
            expect(days.nth(1)).not_to_contain_text("확인 필요")
            expect(grid).not_to_contain_text("미술 앞치마")
            expect(review).to_have_accessible_name("확인할 준비 안내")
            review_item = review.get_by_role("listitem")
            expect(review_item).to_have_count(1)
            for text in ("미술 앞치마", "소매 있는 앞치마", "지참일·조건 확인 필요"):
                expect(review_item).to_contain_text(text)
            grid_box = grid.bounding_box()
            assert grid_box["y"] + grid_box["height"] <= review.bounding_box()["y"]
            upcoming = preparation.get_by_role("list", name="예정된 준비")
            for title in ("날짜 미정 준비", "토요 활동 준비"):
                expect(upcoming).to_contain_text(title)
                expect(week).not_to_contain_text(title)
            for title in ("준비물 0", "인형극", "산책", "출입구 변경"):
                expect(week).not_to_contain_text(title)
            expect(grid).not_to_contain_text("도서 반납")
            expect(upcoming).not_to_contain_text("도서 반납")
            expect(dialog).to_have_css("font-family", re.compile(r'^"Pretendard Variable",'))
            expect(preparation.get_by_role("heading", name="준비물", exact=True)).to_have_css("font-weight", "700")
            note = information.get_by_text("등원 시 정문 이용")
            expect(note).to_have_css("font-weight", "400")
            assert note.evaluate("el => parseFloat(getComputedStyle(el).letterSpacing) / parseFloat(getComputedStyle(el).fontSize)") == -0.02
            expect(preparation.get_by_role("list", name="오늘 챙길 물품")).to_contain_text("1개")
            expect(preparation.get_by_role("list", name="예정된 준비")).to_contain_text("여벌 옷 지참")
            expect(events.get_by_role("listitem").first).to_contain_text("산책")
            expect(events.get_by_role("listitem").last.locator("time")).to_have_attribute("datetime", "2026-11-24")
            expect(information.get_by_role("listitem")).to_contain_text("확인 필요")
            expect(information.get_by_role("listitem")).to_contain_text("등원 시 정문 이용")
            assert preparation.bounding_box()["y"] == events.bounding_box()["y"] == information.bounding_box()["y"]
            boxes = [day.bounding_box() for day in days.all()]
            assert all(a["y"] == b["y"] and a["x"] + a["width"] <= b["x"] for a, b in zip(boxes, boxes[1:]))
            if screenshot_dir:
                page.screenshot(path=Path(screenshot_dir) / "kidsnote-categories-landscape.png")
            page.set_viewport_size({"width": 800, "height": 1280})
            assert preparation.bounding_box()["y"] < events.bounding_box()["y"] < information.bounding_box()["y"]
            if screenshot_dir:
                page.screenshot(path=Path(screenshot_dir) / "kidsnote-categories-portrait.png")
            response.update(json={**response["json"], "weekPreparations": []})
            page.clock.fast_forward(31000)
            expect(days.get_by_text("등록된 안내 없음", exact=True)).to_have_count(5)
            expect(grid).not_to_contain_text("체험 활동 준비")
            expect(review.locator("li")).to_have_count(0)
            expect(upcoming).to_contain_text("체험 활동 준비")
            expect(upcoming).to_contain_text("미술 앞치마")
            page.set_viewport_size({"width": 390, "height": 500})
            boxes = [day.bounding_box() for day in days.all()]
            assert all(a["x"] == b["x"] and a["y"] + a["height"] <= b["y"] for a, b in zip(boxes, boxes[1:]))
            body = dialog.locator(".dialog-body")
            assert body.evaluate("el => el.scrollWidth === el.clientWidth && el.scrollHeight > el.clientHeight")
            box = body.bounding_box()
            x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] - 20
            cdp = ctx.new_cdp_session(page)
            cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
            for delta in range(20, 141, 20):
                cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y - delta}]})
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            page.wait_for_function("document.querySelector('#supplies-dialog .dialog-body').scrollTop > 0", timeout=3000)
            page.keyboard.press("Escape")
            expect(dialog).to_be_hidden()
            expect(button).to_be_focused()
            page.set_viewport_size({"width": 1280, "height": 800})

            response.update(json={**fixture, "items": [], "state": "NEEDS_REVIEW",
                                  "complete": False, "reasonCode": "NO_RESULT_EVIDENCE",
                                  "checkedAt": None, "publishedAt": None, "deadlineState": "MISSED"})
            page.clock.fast_forward(31000)
            expect(status).to_have_text("확인 필요")
            expect(button).not_to_have_class(re.compile(r"\bhas-items\b"))
            button.tap()
            expect(dialog.get_by_role("status")).to_contain_text("확인이 아직 끝나지 않았어요")
            expect(dialog.get_by_role("status")).not_to_contain_text("준비물 없음")
            page.keyboard.press("Escape")

            response.update(json={**fixture, "items": [], "state": "AUTH_REQUIRED", "complete": False,
                                  "checkedAt": None, "publishedAt": None, "deadlineState": "MISSED"})
            page.clock.fast_forward(31000)
            expect(status).to_contain_text("키즈노트 재인증 필요")
            button.tap()
            expect(dialog.get_by_role("status")).to_contain_text("보호자가 키즈노트 인증을 확인해 주세요")
            expect(dialog.get_by_role("link", name="가족 보드 로그인")).to_be_hidden()
            calendar_button.tap()
            expect(calendar.get_by_role("status")).to_have_text("키즈노트 재인증 필요")
            expect(calendar_days).to_have_count(0)
            expect(calendar.locator("#calendar-months")).to_be_hidden()
            page.keyboard.press("Escape")
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
            expect(status).to_have_text("준비물 없음 (보호자 확인)")
            expect(dialog.get_by_role("status")).not_to_contain_text(re.compile("자동 판정|마감|미등록|SOURCE_PROOF"))
            page.keyboard.press("Escape")

            response.update(json={**fixture, "items": fixture["items"][:1], "state": "NEEDS_REVIEW",
                                  "complete": False, "reasonCode": "PLANNED_RECHECK_PENDING",
                                  "checkedAt": "2026-11-19T20:21:00Z", "publishedAt": None, "deadlineState": "MISSED"})
            page.clock.fast_forward(31000)
            expect(status).to_contain_text("확인 필요")
            expect(status).to_contain_text("11/20 05:21 확인")
            expect(status).not_to_contain_text("마감")
            expect(page.locator("#supplies-list li")).to_have_count(1)
            button.tap()
            expect(dialog.locator("#supplies-dialog-status")).to_contain_text("확인 필요")
            page.keyboard.press("Escape")
            expect(dialog).to_be_hidden()

            response.update(json={**fixture, "bulletins": [activity, apron]})
            page.clock.fast_forward(31000)
            expect(status).to_contain_text("전체 20개")
            # Same-day failure retains the verified list and its original timestamp.
            response.update(status=503, json={})
            page.clock.fast_forward(31000)
            expect(status).to_contain_text("이전 확인 결과")
            expect(status).to_contain_text("05:27 확인")
            button.tap()
            expect(dialog).to_be_visible()
            # A family auth failure immediately removes every copy of the items.
            expect(days.nth(1)).to_contain_text("여벌 옷 지참")
            expect(review_item).to_contain_text("미술 앞치마")
            calendar_button.tap()
            expect(calendar).to_contain_text("낙엽 놀이")
            response.update(status=401, json={})
            page.clock.fast_forward(31000)
            expect(status).to_have_text("가족 보드 로그인 필요")
            expect(page.locator("#calendar-button")).to_be_hidden()
            expect(page.locator("#calendar-days > li")).to_have_count(0)
            expect(calendar.get_by_role("status")).to_have_text("가족 보드 로그인 필요")
            page.keyboard.press("Escape")
            expect(close).to_be_focused()
            expect(week).to_be_hidden()
            expect(days).to_have_count(0)
            expect(review.locator("li")).to_have_count(0)
            expect(page.locator("#supplies-list li")).to_have_count(0)
            expect(dialog.get_by_role("status")).to_have_text("가족 보드 로그인 필요")
            expect(dialog.get_by_role("link", name="가족 보드 로그인")).to_be_visible()
            expect(page.locator("#supplies-button")).not_to_have_class(re.compile(r"\bhas-items\b"))
            page.keyboard.press("Escape")

            monday = "2026-11-23"
            page.clock.set_system_time(datetime(2026, 11, 22, 22, tzinfo=timezone.utc))
            response.update(status=200, json={**fixture, "targetDate": monday, "serverNow": "2026-11-22T22:00:00Z",
                                              "items": [{**fixture["items"][0], "applicableDate": monday, "label": "물통"}]})
            page.clock.fast_forward(31000)
            expect(status).to_contain_text("전체 1개")
            button.tap()
            expect_week_dates(23)
            expect(days.locator('[aria-current="date"]')).to_have_attribute("datetime", monday)
            expect(days.first).to_contain_text("오늘")
            expect(days.first).to_contain_text("물통 1개")
            expect(days.first).to_contain_text("등원하는 날")
            calendar_button.tap()
            expect(calendar).to_contain_text("낙엽 놀이")
            response.update(status=503, json={})
            page.clock.fast_forward(18 * 60 * 60 * 1000)
            expect(status).to_contain_text("연결 후 확인")
            expect(calendar.get_by_role("status")).to_contain_text("연결 후 확인")
            expect(calendar_days).to_have_count(0)
            page.keyboard.press("Escape")
            expect(close).to_be_focused()
            expect(dialog.get_by_role("status")).to_contain_text("연결 후 확인")
            page.keyboard.press("Escape")
            expect(button).to_be_focused()
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

            # A December KST target exposes January of the next year even when the current month is absent.
            ctx.unroute(endpoint)
            year_activity = {"date": "2027-01-01", "title": "김장 활동", "audience": "SHARED",
                             "ageOneParticipation": "CONFIRMED", "preparations": [
                                 {"label": "어린이 위생장갑"}, {"label": "앞치마", "dueDate": "2026-12-31"}]}
            year_end = {**fixture, "targetDate": "2026-12-31", "serverNow": "2026-12-30T15:01:00Z",
                        "items": [], "state": "NEEDS_REVIEW", "complete": False, "deadlineState": "PENDING",
                        "checkedAt": None, "publishedAt": None, "nextMonthlyCalendar": {
                            "month": "2027-01", "status": "AVAILABLE",
                            "events": [year_activity, {"date": "2027-01-04", "title": "새해 놀이", "audience": "SHARED"}]}}
            del year_end["monthlyCalendar"]
            away = browser.new_context(timezone_id="America/Los_Angeles", has_touch=True)
            away.route("https://**/*", lambda route: route.abort())
            away.route(endpoint, lambda route: route.fulfill(json=year_end))
            year_page = away.new_page()
            year_page.clock.install(time=datetime(2026, 12, 30, 15, 1, tzinfo=timezone.utc))
            year_page.goto(origin)
            year_page.locator("#supplies-button").tap()
            year_days = year_page.locator("#week-days > li")
            expect(year_days.locator('[aria-current="date"]')).to_have_attribute("datetime", "2026-12-31")
            assert year_page.evaluate("new Date().getDate()") == 30
            expect(year_days.first.locator("time")).to_have_attribute("datetime", "2026-12-28")
            expect(year_days.last.locator("time")).to_have_attribute("datetime", "2027-01-01")
            expect(year_days.nth(3).locator(".week-activity")).to_contain_text("김장 활동 준비물 제출")
            expect(year_days.nth(3).locator(".week-activity")).to_contain_text("앞치마")
            expect(year_days.nth(3).locator(".week-activity")).not_to_contain_text("위생장갑")
            weekly_activity = year_days.last.locator(".week-activity")
            expect(weekly_activity).to_contain_text("김장 활동에 사용")
            expect(weekly_activity).to_contain_text("전체 공통 · 1세 참여 확인")
            expect(weekly_activity.get_by_role("listitem").nth(0)).to_have_text("어린이 위생장갑사용 예정 · 제출일 미확인")
            expect(weekly_activity.get_by_role("listitem").nth(1)).to_have_text("앞치마제출일 2026-12-31")
            expect(year_page.locator("#supplies-list li")).to_have_count(0)
            if screenshot_dir:
                year_page.screenshot(path=Path(screenshot_dir) / "school-week-year-end.png")
            year_page.locator("#calendar-button").tap()
            expect(year_page.get_by_role("button", name="2026년 12월")).to_have_attribute("aria-pressed", "true")
            year_page.get_by_role("button", name="2027년 1월").tap()
            expect(year_page.locator("#calendar-days > li").nth(3)).to_contain_text("새해 놀이")
            january_event = year_page.locator("#calendar-days > li").first.locator(".calendar-event")
            expect(january_event).to_contain_text("1세 참여 확인")
            expect(january_event.get_by_role("listitem").first).to_contain_text("제출일 미확인")
            expect(january_event.get_by_role("listitem").last).to_contain_text("제출일 2026-12-31")
            year_page.keyboard.press("Escape")
            expect(year_page.locator("#calendar-button")).to_be_focused()
            year_page.keyboard.press("Escape")
            expect(year_page.locator("#supplies-button")).to_be_focused()

            # Friday evening in Seoul becomes Saturday while the device still reads Friday.
            year_end.update(targetDate="2027-01-01", serverNow="2027-01-01T14:59:40Z", state="NEEDS_REVIEW",
                            complete=False, deadlineState="MISSED", checkedAt=None, publishedAt=None,
                            monthlyCalendar=year_end.pop("nextMonthlyCalendar"))
            year_page.clock.set_system_time(datetime(2027, 1, 1, 14, 59, 40, tzinfo=timezone.utc))
            year_page.reload()
            year_page.locator("#supplies-button").tap()
            expect(year_days.last.locator("time")).to_have_attribute("aria-current", "date")
            expect(year_days.last).to_contain_text("확인 필요")
            expect(year_days.last).not_to_contain_text("준비물 없음")
            expect(year_days.last).to_contain_text("어린이 위생장갑")
            expect(year_page.locator("#supplies-list li")).to_have_count(0)
            year_end.update(targetDate="2027-01-02", serverNow="2027-01-01T15:00:11Z")
            year_page.clock.fast_forward(31000)
            expect(year_page.locator("#kidsnote-date")).to_have_attribute("datetime", "2027-01-02")
            expect(year_days.first.locator("time")).to_have_attribute("datetime", "2027-01-04")
            expect(year_days.last.locator("time")).to_have_attribute("datetime", "2027-01-08")
            expect(year_days.locator('[aria-current="date"]')).to_have_count(0)
            assert year_page.evaluate("new Date().getDate()") == 1
            away.close()

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
                "hourly": {"time": ["2026-11-22T09:00", "2026-11-21T16:00"],
                           "temperature_2m": [77, 4], "apparent_temperature": [70, 0],
                           "precipitation_probability": [90, 101]},
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
            expect(page.locator("#commute-09")).to_have_text("등원 체감 미확인 강수 미확인")
            expect(page.locator("#commute-16")).to_have_text("하원 체감 0°C 강수 미확인")
            expect(page.locator("#air-grade")).to_have_text("확인 불가")

            ctx.unroute("https://api.open-meteo.com/**")
            page.reload()
            expect(page.locator("#weather-source")).to_have_text("저장된 예보")
            expect(page.locator("#weather-source")).to_be_visible()
            expect(page.locator("#tomorrow-low")).to_have_text("-8°")
            expect(page.locator("#commute-16 [data-feels]")).to_have_text("0°C")
            page.clock.fast_forward(3 * 60 * 60 * 1000 + 1000)
            expect(page.locator("#tomorrow-range")).to_be_hidden()
            expect(page.locator("#weather-temp")).to_be_hidden()
            expect(page.locator("#commute-16 [data-feels]")).to_have_text("미확인")
            expect(page.locator("#tomorrow-condition")).to_have_text("예보 확인 불가")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
