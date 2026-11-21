# DOCS — family_dashboard

기준 원본, 파생 보기와 공개 문서의 경계를 정의합니다.

## 1. 문서 계층과 편집 경계
- **기준 원본**: `AGENTS.md`, `docs/product/*.md`, `docs/features/FEAT-*.md`, `docs/system/*.md`, `contracts/api/*.json`, `config/workflow.toml`.
- **자동 생성 보기**: `DASHBOARD.md`, `TASK.md`, `docs/INDEX.md`, `docs/reference/**`, `.context/**`. 직접 편집하지 않고 `project-control refresh`로 갱신합니다.

## 2. 최신성 대조와 수락
- 관리 대상 소스가 바뀌면 관련 `FEAT-*.md`의 `depends_on`과 `checks`를 대조합니다.
- 최신 후보의 `verify`에서 `execution_status=PASS`, `input_integrity=CONFIRMED`, `applicability=CURRENT`, `unclassified_files=[]`를 확인합니다. 파일 해시와 `doc_sha256`에 바인딩한 `record-review` 후 `refresh`합니다.
- 에이전트는 `can_accept=true`인 `WAITING_APPROVAL`까지 준비하고, 최종 `accept`는 사용자가 확정합니다. `work/`·`evidence/` 원장 JSON은 수동으로 조작하지 않습니다.

## 3. 공개 운영 문서와 비공개 이력
- 현재 제품 요구는 [PRD](../product/PRD.md), 기본 UI는 [FEAT-001](../features/FEAT-001-initial.md), 준비물 계약은 [FEAT-002](../features/FEAT-002-kidsnote-supplies.md)를 기준으로 합니다.
- 공개 운영 상태의 기준은 [kidsnote-supplies-activation.md](kidsnote-supplies-activation.md)입니다. 확인된 기능, 실행 환경, 검증 범위와 남은 통과 기준을 기록합니다. 브라우저·실기기·자연 예약 결과를 구분합니다.
- 과거 계획·검수·원본 출처별 판독·상세 실행 영수증은 비공개 이력에서 보존합니다. 공개 문서에서 이전 계획이나 검증 JSON을 현재 상태의 기준으로 연결하지 않습니다. 과거 EGM·Pro 판정과 테스트 수치는 당시 심사 대상에만 적용합니다.
- 공개 문서에는 실제 아동·가족 식별정보, 정밀 위치, 가족 보드 호스트, 계정·금융정보, 비공개 원문·OCR 문장 또는 상세 실행 식별자를 추가하지 않습니다. 허용된 기능·행동·조건·남은 검증만 설명합니다. 개인화 예시는 공개 기본 호칭 `친구야`를 사용합니다.

## 4. 2026년 11월 21일 통합 기록

공개 기본 보드의 태블릿 카드와 도장 개선을 기준으로, 가족용 화면을 만드는 소스·글꼴 라이선스·캐시 갱신·날씨·준비물 상세창과 테스트를 한 작업 사본에 통합했다. 이 소스에서 생성한 가족용 정적 파일 17개는 검증 당시 배포 사본과 바이트가 일치했다. 기능별 현재 기준은 [기본 보드](../features/FEAT-001-initial.md)와 [당일 준비물](../features/FEAT-002-kidsnote-supplies.md)에 있다.

과거 키즈노트 계획·검수·실행 문서 12개는 바이트를 대조해 비공개 이력에 보존했다. 공개 저장소에서는 계정 캐시와 원문 검수 산출물을 제외한다. 작업 트리에만 있는 변경, 관제 후보·실행 영수증 및 복구 자료는 보존한다.
