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
  - stamp_audio_offline_and_reduced_motion
  - parent_settings_theme_switch
---
# FEAT-001: 어린이집 등원 준비 대시보드 UI · API · 상태 계약

## 1. 목적과 동작
- 정적 PWA 자산(`web/index.html`, `web/styles.css`, `web/assets.js`, `web/media_store.js`, `web/app.js`, `web/manifest.json`, `web/sw.js`)을 통해 갤럭시 탭 S7 단독으로도 시계·실시간 날씨(서울 강동구 상일동 고정, Open-Meteo)·카운트다운(기본 이름 `채원이`, 어린이집 목표 아이콘)·4단계 도장 찍기(현재 단계 강조 및 비활성 단계 흐림)/1.5초 취소·3초 부모 설정(아기상어/뽀로로 전환, IndexedDB 다중·ZIP 행동 GIF/WebP 랜덤 풀 및 테마별 마스코트·도장·개별 사진 교체)이 동작합니다.
- 상단·진행 트랙·활성 카드 미니 마스코트 3곳은 `테마 전용 마스코트(mascot_<theme>) → 공통 마스코트(mascot) → 내장 SVG` 순으로 적용하며, 도장 배지는 `테마 전용 도장(stamp_<theme>) → 공통 도장(stamp) → 테마 마스코트 합성 도장(.stamp-generated) → 내장 도장 SVG` 순으로 렌더링합니다.
- 4단계 카드 일러스트는 `개별 고정 사진(localStorage) → 현재 테마 IndexedDB 랜덤 풀(앱 열기·테마 전환·하루 변경 시 1회 고정) → 내장 SVG` 순으로 적용하며, 깨진 이미지는 `onerror` 시 내장 SVG로 자동 폴백합니다.
- 일반 도장은 약 120ms 시점에 착지음 한 번을 재생하고 약 310ms에 정착합니다. 다음 행동은 즉시 표시하고 180ms 뒤 짧게 강조합니다. 최초 입력 뒤 320ms 동안 다음 도장을 잠그며, 같은 제스처로 다른 도장이나 취소를 실행할 수 없습니다.
- 하루 첫 전체 완료는 네 도장과 “준비 끝! 이제 출발해요!”를 표시합니다. 마지막 카드의 작은 반짝임은 570ms 안에 끝납니다. 부모 설정에 따라 두 음 징글을 추가합니다. 취소 뒤 재완료와 새로고침에는 첫 축하를 반복하지 않습니다. 취소는 최근 도장만 복원하고 짧은 종이 소리를 재생합니다.
- 효과음 자동 재생, 전체 완료 징글, 화면 움직임 감소를 부모 설정에서 제어합니다. 세 종류의 효과음은 자동 재생이 꺼져 있어도 명시적으로 미리들을 수 있습니다. 시스템 또는 앱의 움직임 감소가 켜져 있으면 정적인 도장과 상태를 표시하고 GIF·WebP 대신 정적 그림을 사용합니다. 징글·움직임 설정과 첫 완료 날짜는 브라우저에 저장합니다. 이전 API 요청의 호환성을 위해 상태의 `ttsEnabled` 필드는 유지하며 브라우저의 도장 피드백은 효과음만 재생합니다.
- 앱과 함께 캐시하는 모노 WAV는 도장 120ms, 취소 90ms, 징글 340ms입니다. 도장음과 종이 소리는 CC0 녹음을 잘라 모노 변환하고 짧게 페이드했습니다. 징글은 두 음으로 새로 제작했습니다. [Stamp · kermite607](https://freesound.org/people/kermite607/sounds/362624/) · [Paper Rustle · BenjaminNelan](https://freesound.org/people/BenjaminNelan/sounds/353125/) · [CC0](https://creativecommons.org/publicdomain/zero/1.0/)
- PWA 매니페스트는 192×192 및 512×512 PNG 설치 아이콘을 상대 경로로 제공합니다. 서비스 워커는 `CACHE_VERSION` 기준으로 앱 경로별 캐시를 관리하며, GitHub Actions 배포 시 커밋 SHA(`sha-<12자리>`)로 캐시 버전을 자동 치환해 태블릿 업데이트를 보장합니다.
- 로컬 HTTP 서버(`app.server`)는 정적 PWA 파일 서빙과 함께 `/api/health`, `/api/state`(`GET`/`POST`)를 제공하며, 실행 상태는 `work/` 관제 원장과 분리된 `.local/dashboard_state.json`(`--state-file`로 변경 가능)에 저장합니다.
- 품질 검증은 `tests/test_fullstack.py`(루프백 통합 테스트, `contracts/api/dashboard_state.schema.json` JSON Schema 정합성, JS 단위 테스트, 배포 워크플로/SW 계약)와 `tests/test_browser_e2e.py`(Playwright Chromium 차일드 락·터치 홀드 해제 회귀·테마 영속성 E2E)로 수행하며, `.github/workflows/deploy-pages.yml`의 `verify` 잡 통과 후에만 `main` 브랜치 Pages 배포(`deploy` 잡)를 실행합니다.
