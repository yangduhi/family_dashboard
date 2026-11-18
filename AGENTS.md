# family_dashboard — AGENTS.md

> LLM 작업 진입점 · Project Control 표준 루프 (`0.1.2`)

## 1. 기준 원본과 보기 경계
- 제품 목표: [docs/product/PRD.md](docs/product/PRD.md)
- 기능 명세 원본: `docs/features/FEAT-*.md` (코드 수정 시 `depends_on`·`checks` 대조)
- 관제 설정: [config/workflow.toml](config/workflow.toml)
- 자동 생성 보기(직접 편집 금지): [DASHBOARD.md](DASHBOARD.md), [TASK.md](TASK.md), [docs/INDEX.md](docs/INDEX.md)

## 2. 표준 4단계 검증 루프
작업 요청을 받으면 현재 디렉터리 추측 없이 항상 `--project <절대경로>`를 명시하여 아래 순서로 진행합니다.

1. **`begin`**: `project_control begin --project <abs> --task-id <ID> --title <제목> --request <요청>`
2. **구현 · 자체 테스트**: 코드·계약·기능 명세(`docs/features/*.md`)를 일치시키고 로컬 단위 테스트를 확인합니다.
3. **`verify`**: `project_control verify --project <abs> --task-id <ID>` (격리 후보 스냅샷에서 필수 체크 통과 확인)
4. **`record-review` → `refresh`**:
   - 최신 후보 ID(`CAND-*`)의 파일 해시와 `doc_sha256`을 바인딩해 `record-review`를 기록합니다.
   - `refresh`를 실행해 `DASHBOARD.md`·`TASK.md` 등 파생 뷰를 최신 세대로 게시합니다.

## 3. 완료 및 수락 대기 원칙
- **`WAITING_APPROVAL` 유지:** 에이전트는 `accept`를 대신 확정하지 않습니다. `execution_status = PASS`, `input_integrity = CONFIRMED`, `applicability = CURRENT`, `can_accept = true` 상태까지 맞춘 뒤 VS Code 관제 화면에서 사용자의 **`결정 확정`**을 기다립니다.
- **`work/`·`evidence/` 보호:** 원장과 영수증 JSON을 수동으로 편집해 통과 상태로 조작하지 않습니다.
