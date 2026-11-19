# ARCHITECTURE — family_dashboard

모듈 책임, 실행 경계, 데이터 흐름과 핵심 설계 원칙을 요약합니다. 세부 제품 요구사항은 [PRD.md](../product/PRD.md)와 [FEAT-001-initial.md](../features/FEAT-001-initial.md)를 따릅니다.

## 1. 모듈 경계
- **정적 PWA (`web/`)**: 무빌드 Vanilla HTML/CSS/ES Modules로 구성됩니다. 태블릿 단독 실행 시 `localStorage`에 상태와 날씨 캐시를 저장하고 Open-Meteo API를 직접 조회합니다.
- **로컬 미리보기 서버 (`src/app/server.py`)**: Python 표준 라이브러리 `http.server`로 `web/` 정적 파일과 `/api/health`, `/api/state`(`GET`/`POST`)를 제공합니다.
- **API 계약 (`contracts/api/dashboard_state.schema.json`)**: 상태 페이로드 JSON Schema(Draft 2020-12) 기준 원본입니다.
- **배포 파이프라인 (`.github/workflows/deploy-pages.yml`)**: `verify` 잡 통과 후 `main` 브랜치의 `web/`을 `_site/`로 스테이징하고 `sw.js` `CACHE_VERSION`을 커밋 SHA로 치환해 GitHub Pages에 게시합니다.

## 2. 상태 저장 및 원장 격리
- 브라우저 상태 키는 `family_dashboard_state_v1`이며, 로컬 호스트에서만 `/api/state` 동기화를 활성화합니다.
- 로컬 서버 상태 파일 기본 경로는 `.local/dashboard_state.json`이며, `project-control` 관제 원장(`work/`, `evidence/`)과 분리합니다.
