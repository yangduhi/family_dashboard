---
feature_id: FEAT-001
title: 어린이집 등원 준비 대시보드 (아기상어·뽀로로 테마, 차일드 락, 도장·취소, 상태 API)
depends_on:
  - "src/**"
  - "web/**"
  - "tests/**"
  - "contracts/**"
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
- 정적 PWA 자산(`web/index.html`, `web/styles.css`, `web/assets.js`, `web/app.js`, `web/manifest.json`, `web/sw.js`)을 통해 갤럭시 탭 S7 단독으로도 시계·실시간 날씨(Open-Meteo)·카운트다운·4단계 도장 찍기/1.5초 취소·3초 부모 설정(아기상어/뽀로로 전환 및 이미지 교체)이 동작합니다.
- PWA 매니페스트는 192×192 및 512×512 PNG 설치 아이콘을 상대 경로로 제공합니다. 서비스 워커는 앱 경로별로 캐시를 관리하며, 온라인에서 한 번 열면 네트워크 없이도 대시보드를 다시 열 수 있습니다.
- 로컬 HTTP 서버(`app.server`)는 정적 PWA 파일 서빙과 함께 `/api/health`, `/api/state`(`GET`/`POST`)를 제공하고, `tests/test_fullstack.py` 루프백 통합 테스트 및 계약 검증으로 동작을 보증합니다.
