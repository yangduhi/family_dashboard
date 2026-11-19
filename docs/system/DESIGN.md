# DESIGN — family_dashboard

갤럭시 탭 S7(16:10 가로) 환경의 정보 우선순위, 터치 가드, 테마 및 시각 하니스 기준을 요약합니다. 상세 설계는 [2026-11-18-family-dashboard-design.md](../superpowers/specs/2026-11-18-family-dashboard-design.md)를 참고합니다.

## 1. 화면 우선순위와 차일드 락
- 상단 시계·날씨·카운트다운 헤더, 중앙 진행 트랙(어린이집 간판 목표 아이콘), 하단 4단계 카드 순으로 단일 화면(무스크롤)에 배치합니다.
- 현재 활성 단계 카드(`.is-active`)는 5px 강조 테두리·미세 확대·발광으로 부각하고, 대기 카드(`.is-locked`)와 완료 카드(`.is-done`)는 투명도와 채도를 낮춰 아이 시선이 현재 단계에 집중되게 합니다(4단계 모두 완료 시 전체 밝기 복원).
- `.dashboard-shell`은 `pointer-events: none`으로 잠그고, 현재 활성 카드의 `[👆 완료! 도장 찍기]`, 직전 완료 카드의 1.5초 취소 버튼, 우측 상단 3초 부모 설정 자물쇠(`🔒`)에만 상호작용을 허용합니다.
- 터치 해제 시 오동작 방지를 위해 완료 버튼은 `pointerId` 일치 여부를 검사하고, 부모 설정 모달은 백드롭에서 시작된 포인터만 닫힘을 허용합니다.

## 2. 테마와 하니스 연결
- `babyshark`(기본)와 `pororo` 테마 전환은 부모 설정 모달 내부로 은닉하며, 마스코트 3곳(`#header-mascot`, `#track-mascot`, `.mini-mascot`)은 `object-fit: contain`으로 잘림 없이 표시합니다.
- 마스코트·도장은 테마 전용 슬롯(`mascot_<theme>`, `stamp_<theme>`)과 기존 공통 슬롯(`mascot`, `stamp`) 폴백을 지원하고, 카드 일러스트는 `개별 고정 사진 → 테마별 IndexedDB 랜덤 GIF/WebP(앱 열기·테마 전환·하루 변경 시 1회 고정) → 내장 SVG` 순으로 렌더링하며 오류 시 내장 SVG로 폴백합니다.
- 현재 `config/workflow.toml`의 시각 픽셀 비교(`harness.screens`)는 기준선(B0) 승격 전까지 `NOT_APPLICABLE`로 두고 Playwright 브라우저 E2E로 상호작용 회귀를 검증합니다.
