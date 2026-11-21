# 어린이집 등원 준비 가족 대시보드 (`family_dashboard`) Implementation Plan

> 2026년 11월 18일 작성한 초기 설계 기록입니다. 현재 동작과 인수 조건은 [제품 요구사항](../../product/PRD.md)과 [키즈노트 기능 명세](../../features/FEAT-002-kidsnote-supplies.md)를 따릅니다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 갤럭시 탭 S7(16:10 가로 화면)에서 단독(PWA) 및 로컬 서버 겸용으로 동작하며, 차일드 락·'쾅!' 도장 성취 효과·1.5초 롱프레스 도장 취소·부모 설정 내 아기상어/뽀로로 테마 전환 및 일반 사진(`PNG`/`JPG`) 교체를 지원하는 어린이집 등원 준비 대시보드 앱을 `project-control` 기준으로 구축한다.

**Architecture:** `D:\vscode\project-control`의 `fullstack` 템플릿으로 `D:\vscode\family_dashboard`를 초기화하고, 브라우저 단독 실행이 가능한 정적 PWA(`web/index.html`, `web/styles.css`, `web/assets.js`, `web/app.js`, `web/manifest.json`, `web/sw.js`)와 Python 표준 라이브러리 HTTP 서버(`src/app/server.py`)를 결합한다. 모든 도장·설정·커스텀 이미지 상태는 브라우저 `localStorage`를 기본 원본으로 삼고 로컬 서버 `/api/state`와도 선택적으로 동기화하여 PC 없이 탭 S7 단독으로도 100% 작동하게 한다.

**Tech Stack:** Python 3.11 (`http.server`, `pytest`), HTML5, CSS3 (Grid/Flexbox, `touch-action: none`, Keyframe Animations), Vanilla JavaScript ES Modules, Web Audio API, Web Speech API (`speechSynthesis`), Open-Meteo Weather & Air Quality API, PWA (`manifest.json`, Service Worker).

**Spec:** [2026-11-18-family-dashboard-design.md](../specs/2026-11-18-family-dashboard-design.md)

## Global Constraints

- `project-control init`은 대상 폴더(`D:\vscode\family_dashboard`)에 `.git` 외 파일이 있으면 `PRESERVED_EXISTING`으로 중단하므로, 반드시 빈 폴더 상태에서 `init --template fullstack`을 가장 먼저 실행한다.
- 불필요한 상단 테마 배지 바(`[테마 배지: 🦈 아기상어 등원 대시보드]`)는 두지 않고, 시계·날씨 상단 헤더부터 바로 시작하며 우측 상단 모서리에만 작은 부모 설정 자물쇠(`🔒`)를 배치한다.
- `[🦈 아기상어 | 🐧 뽀로로]` 테마 전환 스위치는 메인 화면에 노출하지 않고 **🔒 부모 설정(3초 길게 누르기)** 내부에 숨긴다.
- 아이가 단일 탭으로 조작 가능한 영역은 **현재 순서(`ACTIVE`) 카드의 `[👆 완료! 도장 찍기]` 버튼 단 1곳**으로 제한한다.
- 실수로 찍은 도장을 되돌릴 수 있도록 **가장 최근 완료된 카드(및 4단계 완료 축하 배너)에 `[↩ 도장 취소 (1.5초 꾹)]` 롱프레스 버튼**을 두고, 부모 설정 안에도 `[↩ 방금 도장 1단계 취소]` 및 `[🔄 오늘 도장 전체 초기화]` 버튼을 제공한다.
- 4단계 준비 동작 및 아기상어·뽀로로 마스코트/왕도장 SVG를 기본 내장하고, 부모 설정에서 일반 이미지(`PNG`, `JPG`, `GIF`, `WEBP`, `SVG`)로 교체할 수 있게 한다.

## Review Focus

1. **아이가 완료된 카드나 도장 취소 버튼을 짧게 연타하는 경우:** 단순 탭이나 1.5초 미만의 터치로는 절대 도장이 취소되지 않고, 1.5초 이상 연속 홀드할 때만 마지막 완료 단계 1개가 취소되어야 한다 (Task 4 테스트 반영).
2. **날짜가 바뀌어 다음 날 아침에 앱을 켠 경우:** 저장된 `lastStampedDate`가 오늘(`YYYY-MM-DD`)과 다르면 자동으로 도장 진행 상태가 `[false, false, false, false]`(`0/4`)로 초기화되어야 한다 (Task 4 테스트 반영).
3. **출발 목표 시각(`08:50`)이 이미 지났거나 자정 전후인 경우:** 남은 시간 카운트다운이 음수(`-15분 남았어요`)로 깨지지 않고 `"출발 시간이에요! (0분)"` 및 진행률 100%로 안전하게 클램핑되어야 한다 (Task 4 테스트 반영).
4. **태블릿 오프라인 또는 날씨 API 응답 실패/지연 시:** 기본 날씨 데이터 또는 마지막 캐시 날씨를 즉시 표시하여 시계와 4단계 도장 카드 동작이 멈추지 않아야 한다 (Task 2, Task 4 테스트 반영).
5. **부모 설정에서 대용량 일반 사진(`JPG`/`PNG`)을 선택했을 때 `localStorage` 용량 초과 방지:** 브라우저 내 캔버스 리사이즈(최대 512px) 후 Data URL로 저장하여 저장소 오류 없이 즉시 반영되어야 한다 (Task 4 반영).

---

### Task 1: `project-control` 워크스페이스 초기화 및 기준 문서·계약 수립

**Files:**
- Create (via `project-control init`): `D:\vscode\family_dashboard\*`
- Create: `D:\vscode\family_dashboard\docs\superpowers\specs\2026-11-18-family-dashboard-design.md`
- Create: `D:\vscode\family_dashboard\docs\superpowers\plans\2026-11-18-family-dashboard-plan.md`
- Modify: `D:\vscode\family_dashboard\config\workflow.toml`
- Modify: `D:\vscode\family_dashboard\docs\product\PRD.md`
- Modify: `D:\vscode\family_dashboard\docs\features\FEAT-001-initial.md`
- Create: `D:\vscode\family_dashboard\contracts\api\dashboard_state.schema.json`

**Interfaces:**
- Produces:
  - Governed workspace `D:\vscode\family_dashboard` with active task `TASK-001`
  - JSON Schema `contracts/api/dashboard_state.schema.json` defining `{ theme: "babyshark" | "pororo", childName: string, departureTime: string, prepStartTime: string, stepsCompleted: boolean[4], lastStampedDate: string }`
  - `FEAT-001` feature spec declaring `depends_on: ["src/**", "web/**", "tests/**", "contracts/**"]` and `checks: ["fullstack_smoke"]`

- [ ] **Step 1: Run `project-control init --template fullstack` on empty `D:\vscode\family_dashboard`**

Run: `D:\vscode\project-control\.venv\Scripts\python.exe -m project_control init --project D:\vscode\family_dashboard --template fullstack`
Expected: JSON output with `"status": "CREATED"`

- [ ] **Step 2: Configure Python environment in `config/workflow.toml` and start `TASK-001`**

Point `python_executable` in `D:\vscode\family_dashboard\config\workflow.toml` to `D:/vscode/project-control/.venv/Scripts/python.exe` (or create local `.venv` junction) so `project-control verify` executes `pytest` reliably in isolated candidate snapshots. Then run:
Run: `D:\vscode\project-control\.venv\Scripts\python.exe -m project_control begin --project D:\vscode\family_dashboard --task-id TASK-001 --title "갤럭시 탭 S7 어린이집 등원 대시보드(아기상어·뽀로로 2종) 초기 구축" --request "갤럭시 탭 S7 가로 화면용 어린이집 등원 준비 가족 대시보드(아기상어·뽀로로 테마, 차일드락, 쾅 도장 효과, 1.5초 도장 취소, 부모 설정 내 테마·사진 변경) 제작"`
Expected: JSON output with `"state": "COMPLETED"`

- [ ] **Step 3: Copy design spec & plan into `docs/superpowers/` and update `PRD.md`, `FEAT-001-initial.md`, and `contracts/api/dashboard_state.schema.json`**

Update `docs/product/PRD.md` and `docs/features/FEAT-001-initial.md` with the approved spec requirements and API endpoints (`GET /`, `GET /api/health`, `GET /api/state`, `POST /api/state`).

- [ ] **Step 4: Verify doctor status**

Run: `D:\vscode\project-control\.venv\Scripts\python.exe -m project_control doctor --project D:\vscode\family_dashboard`
Expected: `"status": "READY"`

---

### Task 2: 백엔드 서버 (`src/app/server.py`) — 정적 PWA 서빙 및 상태/헬스 API

**Files:**
- Modify: `D:\vscode\family_dashboard\src\app\server.py`
- Test: `D:\vscode\family_dashboard\tests\test_fullstack.py`

**Interfaces:**
- Consumes: `contracts/api/dashboard_state.schema.json`
- Produces:
  - `default_dashboard_state() -> dict[str, Any]`
  - `validate_dashboard_state(payload: dict[str, Any]) -> dict[str, Any]`
  - `start_server(web_dir: Path, store: dict[str, Any] | None = None, host: str = "127.0.0.1", port: int = 0) -> HTTPServer`
  - Endpoints:
    - `GET /` and `GET /<static_asset>` (serves `.html`, `.css`, `.js`, `.json`, `.svg`, `.png`, `.jpg`, `.webp` with UTF-8/proper MIME types and `Cache-Control: no-cache`)
    - `GET /api/health` → `{"ok": True, "app": "family_dashboard", "themes": ["babyshark", "pororo"]}`
    - `GET /api/state` → returns current dashboard state dictionary
    - `POST /api/state` → validates and updates `theme`, `childName`, `departureTime`, `prepStartTime`, `stepsCompleted`, `lastStampedDate`

- [ ] **Step 1: Write the failing server & API tests in `tests/test_fullstack.py`**

```python
def test_server_serves_static_assets_and_validates_state() -> None:
    root = Path(__file__).resolve().parents[1]
    srv = start_server(root / "web", port=0)
    # Assert GET /api/health returns themes ["babyshark", "pororo"]
    # Assert GET /api/state returns default state with 4 stepsCompleted == [False, False, False, False]
    # Assert POST /api/state with theme="pororo" and stepsCompleted=[True, False, False, False] persists
    # Assert POST /api/state with invalid theme="pikachu" returns HTTP 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `D:\vscode\project-control\.venv\Scripts\python.exe -m pytest D:\vscode\family_dashboard\tests\test_fullstack.py -q`
Expected: FAIL

- [ ] **Step 3: Implement `src/app/server.py` with CLI runner (`python -m app.server --host 0.0.0.0 --port 8080`)**

Implement static MIME serving for PWA assets, `GET /api/health`, `GET/POST /api/state` validation, and a `__main__` entrypoint that prints the local Wi-Fi IP address for Galaxy Tab S7 connection.

- [ ] **Step 4: Run test to verify it passes**

Run: `D:\vscode\project-control\.venv\Scripts\python.exe -m pytest D:\vscode\family_dashboard\tests\test_fullstack.py -q`
Expected: PASS

---

### Task 3: 아기상어·뽀로로 2종 테마 그래픽(`web/assets.js`) 및 키오스크 스타일(`web/styles.css`)

**Files:**
- Create: `D:\vscode\family_dashboard\web\assets.js`
- Create: `D:\vscode\family_dashboard\web\styles.css`
- Create: `D:\vscode\family_dashboard\web\manifest.json`
- Create: `D:\vscode\family_dashboard\web\sw.js`

**Interfaces:**
- Produces:
  - `THEMES` in `web/assets.js`:
    - `babyshark`: `{ id: "babyshark", name: "아기상어", mascotSvg, stampSvg, stampTitle: "참 잘했어요! 쾅!", cheerPrefix: "뚜루루 뚜루~", particleType: "bubble", steps: [...] }`
    - `pororo`: `{ id: "pororo", name: "뽀로로", mascotSvg, stampSvg, stampTitle: "대장 도장 쾅!", cheerPrefix: "노는 게 제일 좋아~", particleType: "star", steps: [...] }`
  - `STEP_ILLUSTRATIONS` in `web/assets.js`: high-detail SVG illustrations for `step1` (아침 먹기), `step2` (세수·양치), `step3` (옷 입기), `step4` (가방 챙기기) + `daycareSvg` (어린이집 건물 아이콘).
  - `web/styles.css`:
    - 16:10 Galaxy Tab S7 viewport layout (`100vw × 100dvh`, `overflow: hidden`, `user-select: none`, `touch-action: none`)
    - No top theme badge bar; 3-row grid: Header (Clock + Weather + subtle top-right `🔒` hold button) → Progress Countdown Bar → 4 Step Cards
    - Theme CSS variables (`[data-theme="babyshark"]`, `[data-theme="pororo"]`)
    - Keyframe animations: `@keyframes stamp-slam` (`scale(2.6) -> scale(1.0)`), `@keyframes card-shake`, `@keyframes float-particle`

- [ ] **Step 1: Create `web/assets.js` with built-in SVG illustrations for Baby Shark, Pororo, and the 4 preparation cards**

Include rich, colorful inline SVG artwork for both themes and all 4 steps so the user needs zero external files to run the app.

- [ ] **Step 2: Create `web/styles.css`, `web/manifest.json`, and `web/sw.js`**

Configure `manifest.json` with `"display": "fullscreen"`, `"orientation": "landscape"`, and `sw.js` for offline caching of the HTML/CSS/JS shell.

---

### Task 4: 대시보드 코어 로직 (`web/app.js`, `web/index.html`) — 차일드 락 · '쾅!' 도장 · 1.5초 취소 · 부모 설정

**Files:**
- Modify: `D:\vscode\family_dashboard\web\index.html`
- Create: `D:\vscode\family_dashboard\web\app.js`
- Modify: `D:\vscode\family_dashboard\tests\test_fullstack.py`

**Interfaces:**
- Consumes: `THEMES`, `STEP_ILLUSTRATIONS` from `./assets.js`
- Produces (exported in `web/app.js` for both browser & unit tests):
  - `normalizeDailyState(state, todayStr)` — resets `stepsCompleted` to `[false, false, false, false]` when `lastStampedDate !== todayStr`
  - `getActiveStepIndex(stepsCompleted)` — returns first `false` index (`0..3`) or `-1` when all 4 are done
  - `applyStamp(state, stepIndex, todayStr)` — only stamps if `stepIndex === getActiveStepIndex(state.stepsCompleted)` (strict single-touch-zone guard)
  - `undoLastStamp(state)` — reverts the highest `true` index in `stepsCompleted` back to `false`
  - `computeCountdown(nowDate, prepStartTime, departureTime)` — returns `{ remainingMinutes, timeProgressPct, isPastDeparture, formattedRemaining }`
  - `buildWeatherTip(tempC, minTempC, maxTempC, precipProb, pm25)` — generates Korean daycare outfit & umbrella advice (`"아침 8° 쌀쌀 — 아이 겉옷 챙기기"`, `"비 확률 60% — 우산 챙기기"` 등)
  - Interactive UI bindings in `web/index.html` + `web/app.js`:
    - Active card `[👆 완료! 도장 찍기]` button → triggers `applyStamp`, slam animation, Web Audio `'쾅!'` + fanfare, and Korean TTS cheer
    - Last completed card `[↩ 도장 취소 (1.5초 꾹)]` button → requires 1500ms continuous pointer hold (with SVG progress ring) before calling `undoLastStamp`; short taps do nothing
    - Top-right `[🔒]` button → requires 3000ms continuous pointer hold to open Parent Settings modal
    - Parent Settings modal → `[🦈 아기상어 | 🐧 뽀로로]` theme switcher, `[↩ 방금 도장 1단계 취소]`, `[🔄 오늘 도장 전체 초기화]`, child name & departure time inputs, neighborhood weather selector, custom image (`PNG`/`JPG`/`WEBP`/`SVG`) upload with canvas resize (`<= 512px`)

- [ ] **Step 1: Add DOM/logic verification tests in `tests/test_fullstack.py`**

Verify that `web/index.html` and `web/app.js` contain no top theme badge bar, expose the 4 steps (`아침 먹기`, `세수·양치`, `옷 입기`, `가방 챙기기`), enforce the 1500ms undo hold and 3000ms parent lock hold, and include both `babyshark` and `pororo` themes.

- [ ] **Step 2: Implement `web/index.html` and `web/app.js`**

Write clean, modular ES module code in `web/app.js` and semantic structure in `web/index.html`.

- [ ] **Step 3: Run `pytest` suite to verify all unit and HTTP integration checks pass**

Run: `D:\vscode\project-control\.venv\Scripts\python.exe -m pytest D:\vscode\family_dashboard\tests -q`
Expected: PASS

---

### Task 5: 실제 브라우저 렌더링 점검 및 `project-control` 4단계 검증 루프 완료

**Files:**
- Modify: `D:\vscode\family_dashboard\docs\features\FEAT-001-initial.md`
- Update (via `project-control`): `D:\vscode\family_dashboard\DASHBOARD.md`, `D:\vscode\family_dashboard\TASK.md`, `D:\vscode\family_dashboard\docs\INDEX.md`

- [ ] **Step 1: Run `project-control verify` on `TASK-001`**

Run: `D:\vscode\project-control\.venv\Scripts\python.exe -m project_control verify --project D:\vscode\family_dashboard --task-id TASK-001`
Expected: `"execution_status": "PASS"`, `"input_integrity": "CONFIRMED"`

- [ ] **Step 2: Bind candidate hashes with `record-review` and run `refresh`**

Create review payload JSON binding the latest `CAND-*` and `doc_sha256` for `docs/features/FEAT-001-initial.md`, then run `record-review` and `refresh`:
Run: `D:\vscode\project-control\.venv\Scripts\python.exe -m project_control refresh --project D:\vscode\family_dashboard`
Expected: `TASK.md` and `DASHBOARD.md` show `WAITING_APPROVAL`, `can_accept: true`

- [ ] **Step 3: Visually inspect the live rendered app at Galaxy Tab S7 resolution (1280×800 / 2560×1600 16:10) across both Baby Shark and Pororo themes**

Verify the layout, stamp slam animation, 1.5s undo hold, and 3s parent settings modal (theme toggle & photo upload).
