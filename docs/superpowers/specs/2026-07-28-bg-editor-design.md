# 배경 이미지 에디터 — 설계

- 날짜: 2026-07-28
- 상태: Director 승인 (구현 전)
- 대상: Debut Loop! (debut-loop)

## 목적

게임 내 배경이 바뀌어야 하는 시점(장소)마다 슬롯을 정의하고, 전체화면 웹 에디터(그리드)에서 슬롯별로 이미지를 업로드하면 실제 게임에 반영되게 한다. 현재는 스토리 전체가 배경 한 장(practice.png)이고 전환 시스템 자체가 없다 — 이 프로젝트는 에디터 + 배경 전환 시스템을 함께 만든다.

## 결정 사항 (Director 확정)

- 스토리 배경 전환: **막 단위 + 프롤로그만 장면 세분화** (프롤로그-01 참사 무대 / 프롤로그-02 기획사 문 앞)
- 슬롯은 **고정** — backgrounds.json으로 관리, 에디터는 이미지 업로드/교체만
- 에디터는 dev 전용 전체화면 페이지 (`bg.html`, flow.html 패턴)

## A. 슬롯 정의 — `src/data/backgrounds.json` (신규 SSOT)

```json
{
  "_note": "배경 슬롯 SSOT — bg.html 에디터가 읽고, 게임이 트리거로 전환. file이 없거나 미업로드면 기존 기본 배경 폴백.",
  "story": [
    { "id": "prologue-01", "label": "프롤로그-01 · 참사 무대", "beatIds": ["d2_w0_disaster"], "file": "assets/bg/prologue-01.png" },
    { "id": "prologue-02", "label": "프롤로그-02 · 기획사 문 앞", "beatIds": ["d2_w0_rewind", "d2_w0_rewind2"], "file": "assets/bg/prologue-02.png" },
    { "id": "act1", "label": "1막 · 연습생 일상 (W1–4)", "act": 1, "file": "assets/bg/act1.png" },
    { "id": "act2", "label": "2막 (W5–10)", "act": 2, "file": "assets/bg/act2.png" },
    { "id": "act3", "label": "3막 (W11–18)", "act": 3, "file": "assets/bg/act3.png" },
    { "id": "act4", "label": "4막 (W19–23)", "act": 4, "file": "assets/bg/act4.png" },
    { "id": "act5", "label": "5막 · 데뷔 주 (W24)", "act": 5, "file": "assets/bg/act5.png" }
  ],
  "gates": [
    { "id": "gate-act2", "label": "리듬게임 · 센터 대결 (2막)", "gateId": "act2", "file": "assets/bg/gate-act2.png" },
    { "id": "gate-act3", "label": "리듬게임 · 무대 집중 (3막)", "gateId": "act3", "file": "assets/bg/gate-act3.png" },
    { "id": "gate-act4", "label": "슬롯 · 포토카드 촬영 (4막)", "gateId": "act4", "file": "assets/bg/gate-act4.png" },
    { "id": "gate-clue4", "label": "격자 · 단서 대조 (4→5막)", "gateId": "clue4", "file": "assets/bg/gate-clue4.png" },
    { "id": "gate-block", "label": "격자 · 사보타주 저지 (5막)", "gateId": "block", "file": "assets/bg/gate-block.png" }
  ],
  "system": [
    { "id": "title", "label": "타이틀 화면", "file": "assets/bg/title.png" },
    { "id": "loading", "label": "로딩 화면", "file": "assets/bg/loading.png" }
  ]
}
```

- 파일 확장자는 업로드 파일에 따라 png/jpg/webp — 업로드 시 서버가 file 필드를 실제 확장자로 갱신.
- system 슬롯(title/loading): `assets.ts`가 **backgrounds.json system 슬롯의 file을 우선 로드**하고, 없으면 기존 assets.json 경로로 폴백 — 확장자가 바뀌어도 assets.json을 건드릴 필요 없음.
- 게임에서의 로드: `data/index.ts`에 `export const backgrounds` 추가 (다른 JSON과 동일 패턴).

## B. 배경 선택 규칙 (게임 런타임)

`pickBgSlot(beat, storySlots)` 순수 함수 (`src/ui/bgSlots.ts` 신규):

1. `beatIds`에 현재 비트 id가 포함된 슬롯 우선
2. 없으면 `act ≤ 현재 비트 act` 중 act가 가장 큰 슬롯
3. 없으면 null → 기존 기본 배경(assets.json background)

관문: `gateId === 관문 id` 슬롯 → 없으면 기존 엔진별 파일(gate_rhythm.jpg 등) 폴백.
**이미지 파일이 아직 없는 슬롯은 로드 실패 → 폴백** — 슬롯을 하나씩 채워도 안전.

## C. 게임 반영 — `app.ts` / `assets.ts` / `minigames.ts`

- `startApp`: 배경 Sprite를 1회 생성해 유지. `draw()`에서 `pickBgSlot` 계산 → 슬롯이 바뀌면 `Assets.load`(캐시됨)로 lazy load 후 텍스처 교체 + 300ms 페이드. 로드 실패 시 기본 배경 유지.
- 관문 배경: `assets.gateBg(engine)` 호출부를 관문 id 우선 조회로 확장 (`gateBg(gateId, engine)` — id 슬롯 파일 시도 → 엔진 기본 폴백).
- 타이틀/로딩: `assets.ts`가 backgrounds.json system 슬롯 file 우선 → assets.json 폴백 순서로 로드.

## D. 에디터 — `bg.html` + `src/tools/bgEditor.ts` (dev 전용)

- **하나의 장표(단일 페이지)에 전 슬롯을 그리드로 쫙 펼침** — 섹션 분할 없음. 정렬은 게임 진행 순서:
  프롤로그-01 → 프롤로그-02 → 1막 → 리듬-2막 → 2막 → 리듬-3막 → 3막 → 슬롯-4막 → 4막 → 격자-단서 → 5막 → 격자-저지 → 타이틀 → 로딩
- 그리드 열: **기본 5열**, 반응형 — `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))` 로 뷰포트에 따라 열이 늘거나 줄어듦 (약 1200px 폭에서 5열).
- 각 카드: 9:16 미리보기(현재 파일 + 캐시버스트 쿼리), 하단 라벨, 분류 칩(스토리/관문/시스템), 트리거 요약(예: "비트 d2_w0_disaster", "act ≥ 3"), 파일 상태(해상도×용량 / "미업로드").
- 업로드: 카드 클릭 = 파일 선택, 카드 위 드래그&드롭 지원. png/jpg/webp, 10MB 제한(클라이언트+서버 이중).
- 업로드 성공 → 썸네일 즉시 갱신. vite가 public/ 변경을 감지해 게임 탭 자동 리로드 → 실게임 반영.
- 빌드에는 포함되지 않음 (rollup input에 bg.html 미등록 — flow.html과 동일).

## E. 저장 — vite 플러그인 확장 (`vite.config.ts`)

- `/__bgupload?slot=<id>&ext=<png|jpg|webp>` POST 바이너리:
  1. slot id가 backgrounds.json에 존재하는지 검증 (경로는 서버가 `public/assets/bg/<slot>.<ext>`로 직접 구성 — 클라이언트 경로 입력 없음 → 경로 탈출 원천 차단)
  2. 용량 ≤ 10MB, ext 화이트리스트
  3. 파일 기록 + backgrounds.json의 해당 슬롯 file 필드를 새 확장자로 갱신 (기존 다른 확장자 파일은 삭제)
- 기존 `/__backgrounds` JSON 저장 라우트도 SAVE_TARGETS에 추가 (에디터 외 수동 편집용).
- 업로드 이미지는 public/ 소속 — 커밋 시 APK·단일 HTML 빌드에 그대로 포함.

## F. 테스트

- `pickBgSlot` 유닛: beatId 우선, act 이하 최대, 프롤로그(act0)에서 beatId 미일치 시 null, 관문 id 조회.
- 업로드 엔드포인트: 존재하지 않는 slot 400, ext 화이트리스트 밖 400, 초과 용량 413 (dev 서버 대상 수동/스크립트).
- 수동: 에디터에서 업로드 → 게임 해당 장면 배경 교체 확인 (playwright 스크린샷).

## 범위 밖 (기록만)

- 에디터에서 슬롯 추가/삭제 (고정 슬롯 확정 — 새 시점 필요 시 backgrounds.json에 추가)
- 배경 전환 연출 고급화 (지금은 300ms 페이드만)
- 캐릭터/오디오 에셋 에디터로의 확장
