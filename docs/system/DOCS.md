# DOCS — family_dashboard

기준 원본, 파생 보기, 변경 영향 탐지 및 완료 차단 조건을 정의합니다.

## 1. 문서 계층과 편집 경계
- **기준 원본 (직접 관리)**: `AGENTS.md`, `docs/product/*.md`, `docs/features/FEAT-*.md`, `docs/system/*.md`, `contracts/api/*.json`, `config/workflow.toml`.
- **자동 생성 보기 (직접 편집 금지)**: `DASHBOARD.md`, `TASK.md`, `docs/INDEX.md`, `docs/reference/**`, `.context/**` (`project-control refresh`로만 갱신).

## 2. 최신성 대조 및 완료 차단 조건
- 관리 대상 파일(`src/**`, `web/**`, `tests/**`, `contracts/**`, `.github/workflows/**`)이 변경되면 `FEAT-001`의 `depends_on`에 따라 문서 영향이 탐지됩니다.
- 최신 후보(`CAND-*`)에 대해 `verify` 통과(`execution_status=PASS`, `input_integrity=CONFIRMED`, `applicability=CURRENT`, `unclassified_files=[]`) 후, 해당 파일 해시와 `doc_sha256`을 바인딩한 `record-review`와 `refresh`를 완료해야 `can_accept=true`(`WAITING_APPROVAL`) 상태가 됩니다.
- `work/`와 `evidence/` 원장 JSON은 수동 편집하지 않으며, 최종 `accept`는 사용자가 관제 화면에서 확정합니다.
