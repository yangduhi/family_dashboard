# API Contracts

이 폴더에 상태와 응답 JSON Schema의 기준 원본을 보관합니다.

- [dashboard_state.schema.json](dashboard_state.schema.json)은 로컬 상태 API와 보드 설정·진행 계약입니다. 공개 기본 호칭은 `친구야`이며 저장된 사용자 호칭을 유지합니다. 로컬 API와 정적 PWA의 브라우저 저장을 구분합니다.
- [supplies.schema.json](supplies.schema.json)은 인증된 가족 보드의 당일 준비물 응답 계약입니다. 공개 기본 보드는 준비물 API를 호출하지 않습니다. 가족 응답은 화면 메모리에만 두고 브라우저 영속 저장소·서비스 워커 캐시에서 제외합니다.

준비물 0건, 자료 부족, 인증 필요와 검증된 `EMPTY`를 구분합니다. 키즈노트 아이콘은 0건이어도 상세 상태를 열 수 있습니다. 적용일·출처·확인 근거는 [FEAT-002](../../docs/features/FEAT-002-kidsnote-supplies.md), 최신 운영 상태와 남은 검증은 [운영 종합](../../docs/system/kidsnote-supplies-activation.md)을 따릅니다. 공개 문서의 예시에 실제 아동·가족·호스트·실행 식별자나 비공개 응답 원문을 넣지 않습니다.
