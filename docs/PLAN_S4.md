# S4: 관문 카드 선택·적용·소모 (카드 3순위) — 구현 계획

**Goal:** 관문 미니게임 클리어 → **등급만큼(퍼펙트 2·굿/클리어 1) 모은 카드에서 선택** → 효과 합산이 게이지에 적용되고 카드는 소모된다. (CARD_SYSTEM §0·§6 확정 흐름)

## 변경 규칙
- 관문 게이지 보상: gates.json 고정값 → **선택한 카드 효과 합산**(`engine/gate.resolveGate`)으로 대체.
- 티켓·⭐포인트는 등급 기준 유지(GRADE_POINTS).
- 덱이 비었으면: 선택 0장 → 게이지 보상 없음(수집 동기), 티켓·포인트만.
- gates.json `gauges` 필드는 데이터로 유지하되 플로우에서 미사용(치트/폴백 여지).

## Task
1. **컨트롤러 (TDD)**: `resolveGate(grade, pickedIndices: number[])` — 검증(장수 ≤ gatePickCount, 유효 인덱스) + 카드 효과 적용 + removeCards + 티켓/포인트. 적용 델타 반환(bump용).
2. **카드 선택 UI**: 관문 결과 화면 → 카드 픽커(아이콘·이름·★·효과 표시, N장 선택·해제, 확인) → onDone(grade, picked). 빈 덱 안내.
3. **app 배선**: nextBump = 반환 델타. 검증(tsc·테스트·빌드).
