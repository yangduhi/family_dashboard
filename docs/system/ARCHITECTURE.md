# ARCHITECTURE — family_dashboard

모듈 책임, 실행 경계, 데이터 흐름과 핵심 설계 원칙을 요약합니다. 세부 제품 요구사항은 [PRD.md](../product/PRD.md)와 [FEAT-001-initial.md](../features/FEAT-001-initial.md)를 따릅니다.

## 1. 모듈 경계
- **정적 PWA (`web/`)**: 무빌드 Vanilla HTML/CSS/ES Modules로 구성됩니다. `assets.js`는 고정 날씨 좌표(`FIXED_LOCATION`, 서울 강동구 상일동)와 내장 SVG를 제공하고, `media_store.js`는 브라우저 `IndexedDB`(`family_dashboard_media_v1`)에 테마×행동별 GIF/WebP `Blob`을 보관하며 `File.slice()` 기반 무의존 ZIP 파싱과 세션 랜덤 선택을 담당합니다.
- **로컬 미리보기 서버 (`src/app/server.py`)**: Python 표준 라이브러리 `http.server`로 `web/` 정적 파일과 `/api/health`, `/api/state`(`GET`/`POST`)를 제공하며 `location` 필드를 `FIXED_LOCATION`으로 정규화합니다.
- **API 계약 (`contracts/api/dashboard_state.schema.json`)**: 상태 페이로드 JSON Schema(Draft 2020-12) 기준 원본입니다.
- **배포 파이프라인 (`.github/workflows/deploy-pages.yml`)**: `verify` 잡 통과 후 `main` 브랜치의 `web/`을 `_site/`로 스테이징하고 `sw.js` `CACHE_VERSION`을 커밋 SHA로 치환해 GitHub Pages에 게시합니다.

## 2. 상태 저장 및 원장 격리
- 브라우저 설정·진행 상태는 `localStorage`(`family_dashboard_state_v1`), 날씨 캐시는 `locationId` 검증을 거친 `family_dashboard_weather_cache_v1`, 대용량 캐릭터 GIF/WebP 원본은 `IndexedDB`에 분리 저장해 공개 저장소에 저작권 자산을 올리지 않습니다.
- 로컬 서버 상태 파일 기본 경로는 `.local/dashboard_state.json`이며, `project-control` 관제 원장(`work/`, `evidence/`)과 분리합니다.
