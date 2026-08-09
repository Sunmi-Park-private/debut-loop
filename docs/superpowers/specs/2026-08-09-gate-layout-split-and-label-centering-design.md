# 관문 레이아웃 분리 · 버튼 문구 가운데 정렬 설계

**작성일** 2026-08-09
**대상** 3차 QA — 레이아웃 에디터 정합성

## 배경

디자이너가 레이아웃 에디터로 관문 화면을 맞추는 과정에서 두 가지 문제가 보고됐다.

1. 리듬게임 3종(센터 대결·무대 집중·오디션)에서 `hard_start_text`가 문구 길이에 따라 좌우로 밀린다.
2. 4막(단서 대조)과 5막(사보타주 저지)이 레이아웃 키를 공유해, 한쪽을 맞추면 다른 쪽이 틀어진다.

두 문제의 뿌리는 같다. **하나의 저장값이 서로 크기가 다른 여러 화면에 그대로 적용된다.**

---

## 문제 ① — 버튼 문구가 가운데에서 밀린다

### 원인

`btn()`은 문구를 버튼 폭 기준 가운데에 놓는다(`t.x = (버튼폭 − 문구폭) / 2`). 문구를 별도 키로 등록하는 `chromeLabel`·`chromeLabel2`·`btnLabel`은 그 결과값을 **왼쪽 끝 좌표**로 저장한다.

문구 길이가 달라지면(게임마다 다른 라벨, 에디터로 문구 수정) 왼쪽 끝만 고정되므로 중심이 밀린다. 리듬게임은 관문용 라벨("🔥 하드 · 3열 + 보너스")과 오디션용 라벨("🏆 본선 무대 (3열 · 집중 심사 +3)")의 길이가 달라 같은 저장값으로 두 화면을 동시에 맞출 수 없다.

여기에 이중 덮어쓰기가 겹친다. 현재 `layout.json`에는 `hard_start`(버튼 그룹)와 `hard_start_text`(문구) **양쪽에 문구 덮어쓰기(`texts`)가 저장돼 있다.** `applyStoredStyle`은 그룹으로 등록된 컴포넌트에는 중심 보정(`mutateTextKeepingCenter`)을 걸고, 텍스트 자신으로 등록된 컴포넌트에는 걸지 않는다. 같은 Text에 두 규칙이 번갈아 적용되어 위치가 흔들린다.

### 해결

문구 Text에 **가로 중앙 앵커**(`anchor.x = 0.5`)를 주고, 저장 x를 **중심점**으로 해석한다. 문구가 길어지든 짧아지든 그 점을 중심으로 좌우 대칭이 되므로, 세 리듬게임의 라벨 길이가 달라도 같은 자리에 놓인다. 드래그 미세조정은 중심점을 옮기는 것이 되어 그대로 동작한다.

중심 보정(`mutateTextKeepingCenter`)은 앵커가 이미 중심을 유지하므로 **앵커가 걸린 Text에서는 건너뛴다.** 그대로 두면 앵커와 보정이 각각 중심을 잡으려 해 이중 보정으로 좌표가 밀려난다.

### 적용 범위

`btnText(b)`로 버튼 안 문구를 찾아 등록하는 경로만 바꾼다. 이 경로의 문구는 전부 `btn()`/`abtn()`이 가운데 정렬로 만든 것이라 중심 기준이 자연스럽다.

| 파일 | 함수 | 대상 |
|---|---|---|
| `src/ui/minigames.ts` | `chromeLabel` | 관문 버튼 문구 (카드선택 확인·실패화면 재도전/종료) |
| `src/ui/minigames.ts` | `chromeLabel2` | 리듬 시작 버튼 문구 (`easy_start_text`·`hard_start_text`) |
| `src/ui/memberBoard.ts` | `btnLabel` | 보드·판정결과 버튼 문구 |
| `src/ui/memberBoard.ts` | `mkMini` 내부 등록 | 보류 후보 행 영입/버리기 버튼 문구 |
| `src/ui/training.ts` | `btnLabel` | 연습 결과 버튼 문구 |

**제외 대상** — 아래는 버튼 문구가 아니거나 왼쪽 정렬이 의도된 것이라 건드리지 않는다.

- `backBtn_text`·`memberBtn_text` (app.ts) — `btnText` 경로가 아니고, 디자이너가 선행 공백으로 왼쪽 정렬을 의도해 둔 상태다
- `card_text`(스토리 본문)·`board_stat_text`(게이지 수치)·`card_deck_item_name_text`(카드 이름)·`train_bubble_text`(말풍선)
- `screens.ts`의 `asText` — 버튼 전용이 아닌 범용 등록 경로다
- `swipeCard.ts`의 선택지 버튼 — 문구가 스토리 데이터에서 오고 별도 경로를 쓴다

### 기존 저장값 이전

지금 저장된 x는 왼쪽 끝 기준이라 그대로 두면 문구가 오른쪽으로 문구폭의 절반만큼 밀린다. 문구폭은 폰트·문구에 따라 런타임에 정해져 오프라인에서 정확히 환산할 수 없으므로, **각 버튼의 중심값(버튼폭 ÷ 2)으로 초기화**한다. 디자이너가 넣어둔 좌우 미세조정(실측 ±5px 안팎)은 사라지고, y·크기·색·문구 덮어쓰기는 그대로 유지된다.

| 키 | 버튼 폭 | 새 x |
|---|---|---|
| `easy_start_text` | 220 | 110 |
| `hard_start_text` | 220 | 110 |
| `board_btn_exchange_text` | 186 | 93 |
| `board_btn_hold_text` | 186 | 93 |
| `board_res_btn_recruit_text` | 220 | 110 |
| `board_res_btn_hold_text` | 220 | 110 |
| `board_held_btn_recruit_text` | 58 | 29 |
| `board_held_btn_drop_text` | 58 | 29 |
| `bond_train_res_btn_text` | 180 | 90 |
| `promo_train_res_btn_text` | 180 | 90 |

### 문구 덮어쓰기 일원화

문구는 `*_text` 키 한 곳에서만 관리해야 이중 적용이 사라진다. 버튼 그룹 키에 걸린 `texts`는 지우되, **화면에 보이는 문구는 바뀌지 않아야 한다.** 현재 두 키에 모두 덮어쓰기가 있으면 나중에 적용되는 `*_text` 쪽이 이긴다(등록 순서상 그룹이 먼저, 문구가 나중).

| 키 | 현재 상태 | 처리 |
|---|---|---|
| `hard_start` | `texts: ["하드모드(3열) + 보너스"]` — `hard_start_text`의 `["하드 · 3열 + 보너스"]`에 가려져 화면에 안 나온다 | `texts`만 제거 (보이는 문구 변화 없음) |
| `easy_start` | `texts: ["이지모드 (2열)"]` — `easy_start_text`에는 덮어쓰기가 없어 이 값이 화면에 나온다 | 이 값을 `easy_start_text.texts`로 옮기고 그룹에서 제거 |

즉 그룹 키에만 있던 문구는 옮기고, 양쪽에 있던 문구는 `*_text` 쪽을 남긴다.

---

## 문제 ② — 관문 5종이 레이아웃 키를 공유한다

### 원인

`renderGate`는 포토카드(`gate.engine === "slot"`)에만 전용 키(`gate_photo_*`)를 주고, 나머지 네 관문은 `gate`·`gate_title`·`gate_exit`·`gate_pick_*`·`gate_fail_*`를 공유한다.

그런데 관문마다 배경판 아트 비율이 달라 패널 크기(`W` × `PH`)가 제각각이다. 리듬은 막별 배경판(`gate-rhythm-board-easy` / `gate-rhythm-board-2`), 격자회피는 관문별 배경판(`gate-dodge-tile` / `gate-dodge-tile-block`)을 쓴다. 패널이 다른 크기인데 자식 좌표를 공유하니, 한 관문에서 맞추면 다른 관문이 틀어진다.

### 해결

포토카드에만 있던 `lk()` 접두사 방식을 **관문 id 기준으로 일반화**한다.

| `gate.id` | 관문 | 키 접두사 |
|---|---|---|
| `act2` | 센터 대결 (1→2막) | `gate_act2_` |
| `act3` | 무대 집중 (2→3막) | `gate_act3_` |
| `act4` | 포토카드 촬영 (3→4막) | `gate_photo_` |
| `clue4` | 단서 대조 (4→5막) | `gate_clue_` |
| `block` | 사보타주 저지 (5막) | `gate_block_` |

포토카드는 이미 `gate_photo_*`로 저장된 값이 많아 그 접두사를 그대로 둔다. 나머지 네 관문은 **미저장 시 기존 공용 키 값을 승계**한다(`pos(전용키, pos(공용키, 기본값))`). 따라서 분리 직후 화면은 지금과 똑같이 보이고, 디자이너가 손대는 순간부터 관문별로 갈라진다.

구현은 기존 `lk`/`lpos`의 조건부 분기를 없애고 항상 접두사를 적용하는 형태로 바꾼다.

```ts
const PREFIX: Record<string, string> = {
  act2: "gate_act2", act3: "gate_act3", act4: "gate_photo",
  clue4: "gate_clue", block: "gate_block",
};
const pre = PREFIX[gate.id] ?? `gate_${gate.id}`;   // 새 관문이 생겨도 자동 분리
const lk = (base: string): string => base.replace(/^gate/, pre);
const lpos = (base: string, def: { x: number; y: number }) => pos(lk(base), pos(base, def));
```

`lk("gate")` → `gate_act2`, `lk("gate_pick_desc")` → `gate_act2_pick_desc` 형태가 된다.

### 분리 대상이 아닌 것

미니게임 내부 키는 이미 관문별로 나뉘어 있다. 격자회피는 `ns`로 `clue_*`/`block_*`, 리듬은 모드별 `rhythm2_*`/`rhythm3_*`를 쓴다. 이번 변경은 **관문 껍데기(패널·제목·나가기)와 카드선택·실패 화면**에만 적용된다.

리듬 시작 버튼(`easy_start`·`hard_start`)은 관문이 아니라 엔진 안에 있고 오디션(멤버 보드)에서도 쓰여 관문 접두사가 닿지 않는다. 문제 ①의 중앙 정렬로 세 게임 모두 같은 자리에 맞으므로 분리하지 않는다.

---

## 파일별 변경

| 파일 | 변경 |
|---|---|
| `src/ui/minigames.ts` | `lk`/`lpos`를 관문 id 접두사 방식으로 일반화 · `chromeLabel`·`chromeLabel2`에 중앙 앵커 적용 |
| `src/ui/memberBoard.ts` | `btnLabel`·`mkMini` 문구 등록에 중앙 앵커 적용 |
| `src/ui/training.ts` | `btnLabel` 문구 등록에 중앙 앵커 적용 |
| `src/ui/editor.ts` | `mutateTextKeepingCenter`가 앵커 걸린 Text를 건너뛰게 |
| `src/data/layout.json` | 버튼 문구 10개 키의 x를 버튼 중심값으로 이전 · `easy_start`/`hard_start` 그룹의 `texts` 제거 |

## 검증

1. **승계 확인** — 관문 5종을 차례로 열어 분리 전후 화면 배치가 같은지 본다(저장값이 없으면 공용 키를 물려받으므로 변화가 없어야 한다).
2. **격리 확인** — 4막에서 `gate_title`을 옮겨 저장한 뒤 5막을 열어 5막 제목이 그대로인지 본다.
3. **중앙 정렬 확인** — 리듬 3종(센터 대결·무대 집중·오디션)에서 하드 버튼 문구가 버튼 이미지 중앙에 오는지, 에디터로 문구를 길게 바꿔도 중앙을 유지하는지 본다.
4. `tsc --noEmit` 통과, 기존 테스트 146건 통과.

E2E는 `window.__layoutKeys()`로 등록 키를, `window.__layoutProbe(name)`로 좌표·문구·폭을 읽어 확인한다.

## 범위 밖

- UI 에디터 사이드 팝업 배경판 슬롯 추가 (별도 작업으로 대기 중)
- 관문 배경판 아트 교체·비율 조정
