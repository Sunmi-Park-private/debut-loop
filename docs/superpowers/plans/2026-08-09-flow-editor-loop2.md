# 플로우 에디터 2회차 대사 편집 구현 계획

> 설계: `docs/superpowers/specs/2026-08-09-flow-editor-loop2-design.md`

**목표:** 공통 비트 77개에 2회차 전용 문구를 쓸 수 있게 하고, 에디터를 1회차/2회차 탭으로 나눈다.

**Tech Stack:** TypeScript · PixiJS v8 · Vite dev 플러그인 · Vitest

## Global Constraints

- 기존 95개 비트는 파일을 손대지 않아도 지금과 같이 동작한다 (`recall` 전부 선택적)
- 빈 문자열은 "지정 안 함" — 1회차 값으로 폴백
- 1회차 렌더는 바뀌지 않는다 (`recall`은 `seen` 카드에서만 읽음)
- 선택지 효과(effects)는 회차별로 나누지 않는다
- layout.json 좌표에 영향 없음 — 컴포넌트 구성 불변

---

### Task 1: 데이터 타입과 폴백 규칙

**Files**
- Modify: `src/engine/types.ts`
- Create: `src/engine/recall.ts`
- Test: `tests/recall.test.ts`

`types.ts`

```ts
/** 2회차 회상 카드 전용 문구 — 없으면 1회차 값을 그대로 쓴다 */
export interface BeatRecall {
  textKey?: string;
  leftLabel?: string;
  rightLabel?: string;
}
```

`Beat`에 `recall?: BeatRecall;` 추가.

`src/engine/recall.ts`

```ts
import type { Beat, LoopCount } from "./types";

/** 빈 문자열·공백만 있는 값은 "지정 안 함"으로 본다 — 칸을 비웠다고 대사가 사라지면 안 된다 */
const pick = (over: string | undefined, base: string): string =>
  over !== undefined && over.trim() !== "" ? over : base;

export interface RecallText { text: string; left: string; right: string }

/** 2회차 회상 카드가 쓸 문구 (1회차 값 폴백) */
export function recallOf(beat: Beat): RecallText {
  return {
    text: pick(beat.recall?.textKey, beat.textKey),
    left: pick(beat.recall?.leftLabel, beat.left.label),
    right: pick(beat.recall?.rightLabel, beat.right.label),
  };
}

/** 해당 회차에 실제로 플레이되는 비트 — 1회차는 loop!==2, 2회차는 loop!==1 */
export function beatsOfLoop(beats: Beat[], loop: LoopCount): Beat[] {
  return beats.filter((b) => b.loop === undefined || b.loop === loop);
}

/** 회상 문구가 1회차와 같은가 (에디터 "1회차와 동일" 표시용) */
export function recallIsInherited(beat: Beat): boolean {
  const r = recallOf(beat);
  return r.text === beat.textKey && r.left === beat.left.label && r.right === beat.right.label;
}
```

테스트: 값 있음 / 없음 / 빈 문자열 / 공백만 / 40자 초과 그대로 / `beatsOfLoop` 세 종류 / `recallIsInherited`.

커밋: `feat(engine): 2회차 회상 문구 폴백 규칙`

---

### Task 2: 게임 렌더 반영

**Files**
- Modify: `src/ui/swipeCard.ts`

`seen`일 때 `recallOf(beat)`를 쓰고 40자 축약을 제거한다.

```ts
const rc = seen ? recallOf(beat) : null;
const raw = rc ? rc.text : beat.textKey;
```
`text: raw` (축약 없음). 좌·우 라벨도 `rc?.left ?? beat.left.label` 형태로.

`replay` 모드의 `그때의 선택 — ${beat[replay].label}`도 회상 라벨을 쓴다.

검증: `npx tsc --noEmit`, 131 테스트 통과. 1회차 렌더 경로가 그대로인지 diff로 확인.

커밋: `feat(ui): 2회차 카드가 회상 문구를 쓴다 — 40자 축약 제거`

---

### Task 3: 라이브 프리뷰 전달

**Files**
- Modify: `src/ui/beatsPreview.ts`
- Test: `tests/beatsPreview.test.ts`

`BeatTextPatch`에 `recall?: BeatRecall` 추가, `PreviewBeat`에 `recall?`, 스냅샷에 `recall` 보관.
`applyOverlay`가 다른 필드와 같은 규칙으로 되돌린다 — 패치에 없으면 기준값, 기준값에도 없으면 `delete b.recall`.

테스트 2개 추가: 회상 문구 덮어쓰기, 오버레이에서 빠지면 원복.

커밋: `feat(preview): 회상 문구도 실시간 반영`

---

### Task 4: 에디터 탭

**Files**
- Modify: `src/tools/flowEditor.ts`

상단 바에 탭 두 개. `let tab: LoopCount = 1;`

- `renderTimeline()`이 `beatsOfLoop(beats, tab)`을 그린다. 노드의 `data-i`는 **원본 배열 인덱스**를 유지한다 (편집·삭제가 인덱스로 동작하므로).
- 탭 전환 시 선택 비트가 새 목록에 없으면 `sel = -1`.
- 2회차 탭에서 공통 비트(`!b.loop`)에 `↩︎ 회상` 배지.
- 미편집(`recallIsInherited`) 노드는 `.n-inherit` 클래스로 흐리게 + 좌측 띠.
- 노드 본문 미리보기도 탭에 따라 `recallOf(b).text`를 보여준다.

커밋: `feat(flow): 1회차·2회차 탭`

---

### Task 5: 회상 편집 패널

**Files**
- Modify: `src/tools/flowEditor.ts`

2회차 탭 + 공통 비트일 때만 회상 칸 3개를 그린다. 각 칸 위에 1회차 원문을 읽기 전용
(`disabled`)으로 깐다. 비어 있으면 칸에 `.inherit` 클래스 + `1회차와 동일` 배지.

바인딩: `data-r="textKey" | "leftLabel" | "rightLabel"` → `bt.recall`에 기록.
값이 빈 문자열이면 그 키를 지우고, `recall`이 통째로 비면 `delete bt.recall`.
매 입력마다 `sendPreview()`.

`sendPreview()`의 payload에 `recall: bt.recall` 추가.

`loop: 2` 전용 비트는 지금과 같은 전체 패널.

커밋: `feat(flow): 회상 대사 편집 칸`

---

### Task 6: 검증과 저장

**Files**
- Modify: `src/tools/flowEditor.ts`

`validate()`에 한 줄: `recall`이 있으면 세 항목이 문자열이거나 `undefined`.
저장 직전 빈 `recall` 정리 (Task 5의 삭제 로직이 이미 처리하지만, 외부에서 들어온
파일을 위해 저장 경로에서도 한 번 훑는다).

`$("stats")` 문구에 회상 진행률 추가 — `회상 12/77`.

최종: `npx tsc --noEmit` + 전체 테스트 + 브라우저에서 탭·편집·프리뷰 확인.

커밋: `feat(flow): 회상 검증·진행률`
