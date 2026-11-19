---
feature_id: FEAT-001
title: 어린이집 등원 준비 대시보드 (아기상어·뽀로로 테마, 차일드 락, 도장·취소, 상태 API)
depends_on:
  - "src/**"
  - "web/**"
  - "tests/**"
  - "contracts/**"
  - ".github/workflows/**"
checks:
  - fullstack_smoke
api_endpoints:
  - "GET / (web/index.html)"
  - "GET /api/health"
  - "GET /api/state"
  - "POST /api/state"
ui_flows:
  - initial_render
  - stamp_and_undo_hold
  - parent_settings_theme_switch
---
# FEAT-001: 어린이집 등원 준비 대시보드 UI · API · 상태 계약

## 1. 목적과 동작
- 정적 PWA 자산(`web/index.html`, `web/styles.css`, `web/assets.js`, `web/media_store.js`, `web/app.js`, `web/manifest.json`, `web/sw.js`)을 통해 갤럭시 탭 S7 단독으로도 시계·실시간 날씨(서울 강동구 상일동 고정, Open-Meteo)·카운트다운·4단계 도장 찍기/1.5초 취소·3초 부모 설정(아기상어/뽀로로 전환, IndexedDB 다중·ZIP 행동 GIF/WebP 랜덤 풀 및 테마별 마스코트·도장·개별 사진 교체)이 동작합니다.
- 상단·진행 트랙·활성 카드 미니 마스코트 3곳은 `테마 전용 마스코트(mascot_<theme>) → 공통 마스코트(mascot) → 내장 SVG` 순으로 적용하며, 도장 배지는 `테마 전용 도장(stamp_<theme>) → 공통 도장(stamp) → 테마 마스코트 합성 도장(.stamp-generated) → 내장 도장 SVG` 순으로 렌더링합니다.
- 4단계 카드 일러스트는 `개별 고정 사진(localStorage) → 현재 테마 IndexedDB 랜덤 풀(앱 열기·테마 전환·하루 변경 시 1회 고정) → 내장 SVG` 순으로 적용하며, 깨진 이미지는 `onerror` 시 내장 SVG로 자동 폴백합니다.
- PWA 매니페스트는 192×192 및 512×512 PNG 설치 아이콘을 상대 경로로 제공합니다. 서비스 워커는 `CACHE_VERSION` 기준으로 앱 경로별 캐시를 관리하며, GitHub Actions 배포 시 커밋 SHA(`sha-<12자리>`)로 캐시 버전을 자동 치환해 태블릿 업데이트를 보장합니다.
- 로컬 HTTP 서버(`app.server`)는 정적 PWA 파일 서빙과 함께 `/api/health`, `/api/state`(`GET`/`POST`)를 제공하며, 실행 상태는 `work/` 관제 원장과 분리된 `.local/dashboard_state.json`(`--state-file`로 변경 가능)에 저장합니다.
- 품질 검증은 `tests/test_fullstack.py`(루프백 통합 테스트, `contracts/api/dashboard_state.schema.json` JSON Schema 정합성, JS 단위 테스트, 배포 워크플로/SW 계약)와 `tests/test_browser_e2e.py`(Playwright Chromium 차일드 락·터치 홀드 해제 회귀·테마 영속성 E2E)로 수행하며, `.github/workflows/deploy-pages.yml`의 `verify` 잡 통과 후에만 `main` 브랜치 Pages 배포(`deploy` 잡)를 실행합니다.
