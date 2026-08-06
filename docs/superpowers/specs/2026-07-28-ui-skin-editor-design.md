# 화면 UI 스킨 에디터 — 설계

- 날짜: 2026-07-28
- 상태: Director 승인 (구현 전)
- 대상: Debut Loop! (debut-loop)

## 목적

버튼·배너·아이콘·게이지바 등 Graphics(벡터)로 그려진 UI 컴포넌트에 이미지 스킨을 입힐 수 있게 한다. 전체화면 웹 에디터(ui.html)에서 화면별 슬롯에 이미지를 업로드하면 실제 게임에 즉시 반영. 스킨이 없는 슬롯은 기존 벡터 그대로 — 점진 적용 안전.

## 결정 사항 (Director 확정)

- 슬롯 22개 (아래 인벤토리) — 고정, 에디터는 업로드/교체만
- 에디터 형태: **화면별 대형 섹션 5개 + 큰 슬롯 카드(≈280px)** (스크린샷 핫스팟 방식 아님)
- 버튼·프레임류 = **9-slice**(NineSliceSprite, 모서리 보존), 아이콘·노트류 = stretch

## A. 슬롯 인벤토리 (5화면 · 22슬롯)

| 화면 | 슬롯 id | 컴포넌트 | mode |
|---|---|---|---|
| 메인 로비 | lobby-start | START 원형 버튼 (128×128) | stretch |
| | lobby-icon-daily / album / shop / settings | 사이드 아이콘 4개 (46×46) | stretch |
| | lobby-deck-banner | 하단 카드덱 시트 헤더 | 9slice |
| 본게임 | game-gauge-frame | 게이지 패널 프레임 | 9slice |
| | game-gauge-fill | 게이지 바 채움 (가변 폭 스트레치) | stretch |
| | game-card-frame | 스와이프 카드 프레임 | 9slice |
| | game-btn-left / game-btn-right | 좌/우 선택 버튼 (178×60) | 9slice |
| | game-back | ← 로비 버튼 (66×26) | 9slice |
| 연습하기 | train-panel | 보드 패널 프레임 | 9slice |
| | train-row | 활동 행 배경 | 9slice |
| | train-skip | 건너뛰기 텍스트 영역 배경 | 9slice |
| 관문(막 게임) | gate-panel | 관문 패널 프레임 (394×600) | 9slice |
| | gate-btn | 공용 버튼(btn 헬퍼 — 전 관문 버튼 일괄) | 9slice |
| | gate-note-left / gate-note-right | 리듬 노트 🎤/💃 대체 | stretch |
| | gate-dodge-tile | 격자 타일 | 9slice |
| 카드덱 | deck-card | 카드 아이템 프레임 | 9slice |
| | deck-sheet | 시트 배경(핸들 포함) | 9slice |

- 정확한 픽셀 치수는 구현 시 각 컴포넌트 코드 실측값을 uiskins.json `size: [w,h]`에 기록 (에디터 카드에 표시).
- 파일 규약: `public/assets/ui/<슬롯id>.<ext>` (png/jpg/webp).

## B. 데이터 — `src/data/uiskins.json` (신규 SSOT)

```json
{ "screens": [ { "id": "lobby", "label": "메인 로비", "slots": [
  { "id": "lobby-start", "label": "START 원형 버튼", "file": "assets/ui/lobby-start.png", "size": [128, 128], "mode": "stretch" }, ...
] }, ... ] }
```
9slice 슬롯은 `"mode": "9slice", "slice": 16` (모서리 px, 슬롯별 조정 가능).

## C. 런타임 — `src/ui/uiSkin.ts` (신규)

- `loadUiSkins(onTick?)`: 22개 파일 시도 로드(실패=null) → 모듈 Map. `loadGameAssets`에서 호출(진행률 포함).
- `skinNode(id, w, h): Container | null`: 스킨 있으면 크기 맞춘 노드(9slice=NineSliceSprite / stretch=Sprite), 없으면 null.
- 컴포넌트 호출부 패턴: `const skin = skinNode(id, w, h); if (skin) parent.addChild(skin); else <기존 Graphics>`. 게이지 채움처럼 가변 폭은 매 렌더 폭으로 skinNode 호출.

## D. 게임 코드 터치포인트

`boot.ts`(로비 6) · `gaugeBar.ts`(2) · `swipeCard.ts`(카드 프레임+좌/우 버튼 3) · `app.ts`(← 버튼 1) · `training.ts`(3) · `minigames.ts`(관문 5) · `deckSheet.ts`(2). 전부 "스킨 있으면 교체" 폴백 패턴 — 기존 텍스트/아이콘은 스킨 위에 그대로 얹힘.

## E. 에디터 — `ui.html` + `src/tools/uiEditor.ts` (dev 전용)

- 화면별 대형 섹션 5개(제목 + 설명), 섹션 안에 슬롯 카드 그리드 `repeat(auto-fill, minmax(280px, 1fr))` — bg 에디터보다 카드 큼.
- 슬롯 카드: 체커보드 배경 위 스킨 미리보기(투명 PNG 확인용), 라벨, 실치수·mode(9slice면 slice값), 미업로드 표시, 클릭/드롭 업로드.
- 업로드 성공 → 리로드(게임 탭도 vite가 자동 리로드).

## F. 저장 — vite 플러그인 일반화

기존 bgUploadPlugin을 **공용 팩토리 `imageUploadPlugin(route, manifestPath, publicDir, collect)`** 로 리팩터:
- `/__bgupload` → `src/data/backgrounds.json` + `public/assets/bg/` (기존 동작 유지)
- `/__skinupload` → `src/data/uiskins.json` + `public/assets/ui/` (screens[].slots[] 평탄화로 슬롯 탐색)
- 검증 공유: slot id 정규식·확장자 화이트리스트·10MB·경로 서버 조립. SAVE_TARGETS에 `/__uiskins` 추가.

## G. 테스트

- uiskins.json 정합성(슬롯 22·id 유일·mode 유효) 유닛 + skinNode 폴백(스킨 없음 → null) 유닛.
- 색상 사각형 테스트 스킨 업로드 → 5개 화면 playwright 스크린샷으로 적용 확인 → 원복.
- `/__skinupload` 거부 케이스(unknown slot·확장자·경로) 400.

## 범위 밖 (기록만)

- 에디터에서 슬롯 추가/삭제, slice 값 GUI 편집 (uiskins.json 직접 수정으로 충분)
- 호버/눌림 상태별 스킨 (단일 이미지만 — 필요 시 후속)
- 폰트/텍스트 스타일 스킨
