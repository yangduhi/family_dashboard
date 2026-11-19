# QUALITY — family_dashboard

실행 결과·입력 무결성·현재 적용성 기준과 런타임 분담을 정의합니다. 상세 체크 선언은 [config/workflow.toml](../../config/workflow.toml)을 기준으로 합니다.

## 1. 런타임 역할 분담
- **관제 CLI (`project-control 0.1.2`)**: `${LOCALAPPDATA}\ProjectControl\runtimes\0.1.2\Scripts\python.exe` (VS Code 태스크 및 `begin`/`verify`/`record-review`/`refresh` 실행).
- **프로젝트 검증·서버 (`.venv`)**: 프로젝트 로컬 `.venv/Scripts/python.exe`(`pyproject.toml` `dev` 의존성: `pytest`, `jsonschema`, `playwright`).

## 2. 필수 검증 명령 및 통과 기준
- 로컬/격리 후보 체크(`fullstack_smoke`): `python -m pytest tests -q -p no:cacheprovider`
  - `tests/test_fullstack.py`: 상태 유효성, JSON Schema 양방향 정합성, Node.js ES Module 단위 테스트, 루프백 HTTP/API 통합 및 `fullstack_receipt.json` 생성, 배포 워크플로·SW 계약 검증.
  - `tests/test_browser_e2e.py`: Playwright Chromium(1280×800, 터치, SW 차단, Open-Meteo 모킹) 차일드 락·터치 홀드 해제 회귀·테마 영속성 및 콘솔/페이지 에러 0건.
- 원격 CI 게이트: `.github/workflows/deploy-pages.yml`의 `verify` 잡이 실패하면 `deploy` 잡은 실행되지 않습니다.
