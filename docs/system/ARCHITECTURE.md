# ARCHITECTURE — family_dashboard

모듈 책임과 데이터 경계를 정의합니다. 제품 계약은 [PRD](../product/PRD.md), 기본 보드는 [FEAT-001](../features/FEAT-001-initial.md), 가족 준비물은 [FEAT-002](../features/FEAT-002-kidsnote-supplies.md)를 따릅니다.

## 1. 모듈 경계
- **정적 PWA (`web/`)**: Vanilla HTML/CSS/ES Modules로 구성합니다. `assets.js`는 설정된 서울 지역의 `FIXED_LOCATION`과 내장 그림을 제공합니다. `media_store.js`는 테마·행동별 GIF/WebP와 ZIP 가져오기, 세션별 랜덤 선택을 담당합니다. 공개 기본 호칭은 `친구야`이며 사용자 호칭은 부모 설정에서 편집합니다.
- **로컬 미리보기 서버 (`src/app/server.py`)**: Python 표준 라이브러리로 정적 파일과 `/api/health`, `/api/state`를 제공합니다. 상태의 위치는 `FIXED_LOCATION`으로 정규화합니다.
- **상태 계약**: [dashboard_state.schema.json](../../contracts/api/dashboard_state.schema.json)을 기준으로 합니다.
- **공개 배포**: [배포 워크플로](../../.github/workflows/deploy-pages.yml)의 `verify` 통과 후 정적 `web/`을 게시합니다. HTML·모듈·CSS·글꼴·효과음과 서비스 워커 버전의 일관성은 배포 검증 대상이며, CI 통과만으로 기존 설치의 갱신을 확정하지 않습니다.

## 2. 상태 저장과 업데이트
- 브라우저 설정·진행은 `localStorage`, GIF/WebP는 `IndexedDB`에 저장합니다. 날씨 캐시는 위치·서울 적용일·유효 시간을 대조합니다. 사용자 호칭은 기본값 변경으로 덮어쓰지 않습니다.
- 공개 보드와 인증된 가족 보드는 별도 출처이므로 브라우저 저장소와 설치 아이콘도 다릅니다. 출처 전환과 동일 출처 업데이트를 구분합니다. 동일 출처 업데이트는 설정과 GIF를 보존해야 합니다.
- 로컬 서버의 `.local/dashboard_state.json`은 관제 원장인 `work/`·`evidence/`와 분리합니다.

## 3. 가족 준비물 경계
- 가족 셸의 `web/supplies.js`만 같은 출처의 가족 API를 조회합니다. 오른쪽 위 설정 아래 키즈노트 아이콘은 목록·조회 상태·로그인 안내를 열고, 표시할 항목이 있으면 강조합니다. 0건이어도 상태를 열 수 있습니다. 공개 Pages 셸은 준비물 API를 호출하지 않습니다.
- 준비물 결과는 화면 메모리에만 둡니다. 준비물 API와 로그인 응답은 서비스 워커와 브라우저 영속 캐시 대상에서 제외합니다. 정적 셸만 캐시합니다.
- 수집·분석·검토 DB는 비공개 백엔드가 담당합니다. 검토 DB 적재와 가족 API 게시를 구분하며, 원문·OCR 문장·아동 및 금융 식별정보를 공개 코드·문서·로그에 넣지 않습니다. 외부 분석은 별도로 승인된 비식별 범위에 한정합니다.
- 승인 범위의 본문 전체·원본 전체 프레임·적용 대상·날짜·정정·취소를 확인해야 당일 판정을 확정합니다. 자료 부족, 보호자 확인, 검증된 `EMPTY`는 서로 다른 근거입니다. 현재 운영 상태와 남은 검증은 [운영 종합](kidsnote-supplies-activation.md)에서 관리합니다.
