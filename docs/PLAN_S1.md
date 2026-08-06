# S1: 엔딩 + 회귀 1→2회차 + 가속 + 드래그 스와이프 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox 문법.

**Goal:** 1회차(단서 못 잡음)→사고→회귀→2회차(단서 포착·가속)→트루엔딩까지 브라우저에서 완주 가능하게 한다. 카드에 드래그 스와이프(Reigns 손맛)를 붙인다.

**Architecture:** S0의 `RunController`를 `engine/progress.advance()` 기반으로 확장(순수, TDD). 회차별 노출은 데이터(`loop` 태그)가 결정. Pixi에는 엔딩/회귀 화면(`screens`)과 드래그 제스처만 추가.

**Tech Stack:** 동일 (TS strict, PixiJS v8, Vite, Vitest).

## Global Constraints

- S0와 동일 (엔진·컨트롤러 순수 / Pixi는 ui 뷰 3+1파일 / `noUncheckedIndexedAccess` 가드 / git 커밋 보류).
- **결말 고정**: 비트 소진 시 `resolveRunEnd` — 1회차→regress, 2회차→ending:true. 게이지 붕괴→ending:dark(3단 사다리는 후속).
- 데이터 SSOT: `src/data/beats/demo2_zeroc.json` (목업 임베드는 스냅샷, 수정 대상 아님).

---

## File Structure

- `src/data/beats/demo2_zeroc.json` (Modify) — `loop` 태그 + 1회차 관찰 비트 4개 추가
- `src/ui/runController.ts` (Modify) — advance 기반 + RunEvent/regress 노출
- `tests/runController.test.ts` (Modify) — 회귀·엔딩·가속 테스트 추가
- `tests/data.test.ts` (Create) — **데이터 검증**: 1회차 시뮬→regress·2회차→true
- `src/ui/screens.ts` (Modify, 스텁) — 엔딩/회귀 화면
- `src/ui/swipeCard.ts` (Modify) — 드래그 제스처 + seen 축약 카드
- `src/ui/app.ts` (Modify) — 이벤트 분기 배선

---

### Task 1: RunController v2 — advance/회귀 배선 (TDD)

**Files:**
- Modify: `src/ui/runController.ts`
- Test: `tests/runController.test.ts` (추가)

**Interfaces:**
- Consumes: `advance`, `isFastForward` (`engine/progress`), `triggerRegression` (`engine/state`)
- Produces (v2, S0 시그니처 유지 + 확장):
  - `RunController { state; current; seen: boolean; ended: RunEvent | null; choose(dir); regress(): void; }`

- [ ] **Step 1: 실패 테스트 추가** — `tests/runController.test.ts`에 append:

```ts
describe("RunController v2 (회귀 배선)", () => {
  const loopBeats: Beat[] = [
    { id: "c1", act: 1, textKey: "공통", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
    { id: "o1", act: 1, loop: 1, textKey: "관찰", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
    { id: "k1", act: 4, loop: 2, textKey: "포착", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
  ];
  it("1회차 소진 → ended=regress", () => {
    const c = createRunController(loopBeats, cfg, "small");
    c.choose("left"); // c1
    c.choose("left"); // o1 (k1은 loop2라 안 나옴)
    expect(c.current).toBeNull();
    expect(c.ended).toEqual({ type: "regress" });
  });
  it("regress() → 2회차 재시작, seen 가속, loop2 등장", () => {
    const c = createRunController(loopBeats, cfg, "small");
    c.choose("left"); c.choose("left");
    c.regress();
    expect(c.state.loopCount).toBe(2);
    expect(c.current?.id).toBe("c1");
    expect(c.seen).toBe(true);          // 이전 회차에 본 비트 → 가속
    c.choose("left");                    // c1 (o1은 loop1이라 skip)
    expect(c.current?.id).toBe("k1");
    expect(c.seen).toBe(false);          // 새 비트 → 정독
  });
  it("2회차 소진 → ended=ending:true (결말 고정)", () => {
    const c = createRunController(loopBeats, cfg, "small");
    c.choose("left"); c.choose("left"); c.regress();
    c.choose("left"); c.choose("left");
    expect(c.ended).toEqual({ type: "ending", kind: "true" });
  });
  it("게이지 붕괴 → ended=ending:dark", () => {
    const c = createRunController(loopBeats, cfg, "small");
    c.state.gauges.mental = 1;
    const crash: Beat[] = [{ id: "x", act: 1, textKey: "", left: { label: "L", effects: { gauges: { mental: -50 } } }, right: { label: "R", effects: {} } }];
    const c2 = createRunController(crash, cfg, "small");
    c2.choose("left");
    expect(c2.ended).toEqual({ type: "ending", kind: "dark" });
  });
});
```

- [ ] **Step 2: RED 확인** — `npx vitest run tests/runController.test.ts` → FAIL (`ended`/`regress` 없음)

- [ ] **Step 3: 구현** — `src/ui/runController.ts` 전체 교체:

```ts
// ui/runController.ts — 순수 런 오케스트레이션 (Pixi 의존 0). advance 기반 v2.
import type { Beat, State, GameConfig, RunEvent } from "../engine/types";
import { createState, applyEffect, triggerRegression } from "../engine/state";
import { markPlayed } from "../engine/router";
import { advance, isFastForward } from "../engine/progress";

export interface RunController {
  readonly state: State;
  readonly current: Beat | null;
  readonly seen: boolean;              // 현재 비트가 회귀 가속 대상인가
  readonly ended: RunEvent | null;     // regress | ending 발생 시 세팅
  choose(dir: "left" | "right"): void;
  regress(): void;                     // 회귀 실행 → 2회차 재시작
}

export function createRunController(
  beats: Beat[],
  config: GameConfig,
  difficulty: "small" | "big",
): RunController {
  let state = createState(config, difficulty);
  let cursor = 0;
  let current: Beat | null = null;
  let seen = false;
  let ended: RunEvent | null = null;

  const step = (): void => {
    const r = advance(beats, state, cursor, config);
    cursor = r.cursor;
    if (r.event.type === "beat") {
      current = r.event.beat;
      seen = isFastForward(state, r.event.seen);
      state.act = current.act;
      if (current.week !== undefined) state.week = current.week;
    } else {
      current = null;
      seen = false;
      ended = r.event;
    }
  };
  step();

  return {
    get state() { return state; },
    get current() { return current; },
    get seen() { return seen; },
    get ended() { return ended; },
    choose(dir) {
      if (!current) return;
      applyEffect(state, current[dir].effects, config);
      markPlayed(state, current.id);
      step();
    },
    regress() {
      if (ended?.type !== "regress") return;
      state = triggerRegression(state, config, difficulty);
      cursor = 0;
      ended = null;
      step();
    },
  };
}
```

- [ ] **Step 4: GREEN 확인** — `npx vitest run` → 전체 PASS
- [ ] **Step 5: 타입체크** — `npx tsc --noEmit` → exit 0

---

### Task 2: 데이터 loop 태깅 + 검증 테스트

**Files:**
- Modify: `src/data/beats/demo2_zeroc.json`
- Test: `tests/data.test.ts` (Create)

**태깅 규칙 (§확정 구조):**
- `loop: 2` (2회차 능동 포착·저지·트루): `d2_w4_clue1`, `d2_w8_clue2`, `d2_w13_clue3`, `d2_w22_clue4`, `d2_w22_puzzle`, `d2_w23_prepare`, `d2_w24_block`, `d2_w24_true`
- `loop: 1` (1회차 사고 재현): `d2_w24_dark`
- **1회차 관찰 비트 4개 신규** (`loop: 1`, 단서 스침 — addClue 없음, 기시감 훅만):
  - `d2_w4_obs1` (clue1 위치): "{antiStaff}가 보라의 스케줄만 유독 몰아넣는다. …기분 탓인가." 좌 "뭔가 걸린다"(flags:["seed_doubt"]) / 우 "바쁘신가 보다"
  - `d2_w8_obs2`: "연습 영상이 유출됐다. 누가? …알 방법이 없다." 좌 "찜찜하다"(gauges:{mental:-1}) / 우 "우연이겠지"(gauges:{reputation:-3})
  - `d2_w13_obs3`: "악플이 조직적이다. 시안이 로그를 노려보지만 아직 잡히는 게 없다." 좌 "무언가 있다"(flags:["seed_doubt"]) / 우 "버티자"(gauges:{mental:-2})
  - `d2_w22_obs4`: "무언가 놓치고 있다는 확신. 하지만 증거가 없다 — 시간만 흐른다." 좌 "불안하다"(gauges:{mental:-2}) / 우 "데뷔에 집중"(gauges:{skill:1})
  - 삽입 위치: 각 대응 clue 비트 **바로 앞** (같은 week, forward-cursor 순서 유지)

- [ ] **Step 1: 검증 테스트 작성** — `tests/data.test.ts`:

```ts
// tests/data.test.ts — demo2 데이터 무결성 + 회차 시뮬레이션 (Lv.7 성격)
import { describe, it, expect } from "vitest";
import { beats, config } from "../src/data";
import { createRunController } from "../src/ui/runController";

describe("demo2 데이터", () => {
  it("loop:2 태깅 — 단서·저지·트루", () => {
    const l2 = beats.filter((b) => b.loop === 2).map((b) => b.id);
    for (const id of ["d2_w4_clue1", "d2_w8_clue2", "d2_w13_clue3", "d2_w22_clue4", "d2_w24_block", "d2_w24_true"])
      expect(l2).toContain(id);
  });
  it("1회차 시뮬(좌만 선택) → 단서 0 + regress", () => {
    const c = createRunController(beats, config, "small");
    for (let i = 0; i < 200 && c.current; i++) c.choose("left");
    expect(c.state.clues.size).toBe(0);         // 관찰만 — 포착 불가
    expect(c.ended).toEqual({ type: "regress" });
  });
  it("2회차 시뮬(좌만 선택) → 단서 4 + 트루", () => {
    const c = createRunController(beats, config, "small");
    for (let i = 0; i < 200 && c.current; i++) c.choose("left");
    c.regress();
    for (let i = 0; i < 200 && c.current; i++) c.choose("left");
    expect(c.state.clues.size).toBe(4);
    expect(c.ended).toEqual({ type: "ending", kind: "true" });
  });
});
```

- [ ] **Step 2: RED 확인** (태깅 전이므로 FAIL)
- [ ] **Step 3: JSON 태깅** — python 스크립트로 `loop` 필드 주입 + obs 비트 4개 삽입 (수기 편집 금지, 스크립트로 멱등 처리)
- [ ] **Step 4: GREEN 확인** — 시뮬 통과 안 되면 게이지 붕괴 여부 확인(좌만 선택 시 멘탈 등) → 필요시 obs 비트 효과 수치 조정
- [ ] **Step 5: 타입체크**

---

### Task 3: 엔딩/회귀 화면 (screens) + app 배선

**Files:**
- Modify: `src/ui/screens.ts` (스텁 → 구현)
- Modify: `src/ui/app.ts`

**Interfaces:**
- Produces: `renderEndScreen(parent: Container, event: RunEvent, state: State, onAction: () => void): void`
  - regress: 🌑 "붉은 섬광 — 눈을 뜨니 0시" + 버튼 "다시, 시작하다 ↺" → onAction=ctrl.regress()
  - ending true: 🎤 "데뷔 성공 — 우리가 지켰어" + 버튼 "처음부터 ↺" → onAction=새 런
  - ending dark: 💀 "게이지 붕괴" + 버튼 "다시 도전 ↺" → onAction=새 런

- [ ] **Step 1: screens.ts 구현** (Pixi 텍스트+버튼, gaugeBar와 동일 스타일 톤)
- [ ] **Step 2: app.ts 배선** — draw()에서 `ctrl.ended` 분기: regress→regress 후 draw / ending→새 컨트롤러 생성 후 draw. 상단에 `W주차 · N회차` 표시 추가
- [ ] **Step 3: 타입체크 + 수동 검증** — 빠르게 좌만 눌러 1회차 완주→회귀 화면→2회차→트루 화면

---

### Task 4: 드래그 스와이프 + seen 축약 카드

**Files:**
- Modify: `src/ui/swipeCard.ts`

**동작 (목업 bindDrag 이식, Pixi 이벤트로):**
- 카드 컨테이너 `eventMode:"static"` + `pointerdown/globalpointermove/pointerup`
- 드래그 중: `card.x = 기준 + dx`, `card.rotation = dx * 0.0009`
- `|dx| >= 100` 에서 놓으면 commit → `onChoose(dir)` / 미만이면 원위치
- 좌/우 버튼은 유지(접근성·데스크톱)
- **seen(가속) 카드**: 높이 축소(420→200)·본문 1줄 요약(40자+…)·상단에 "▶▶ 기억 속 장면 — 빠르게 넘기기" 라벨·버튼 라벨만 표시

**Interfaces:**
- `renderCard(parent, beat, casting, onChoose, opts?: { seen?: boolean })` — S0 호출부 호환(opts 옵셔널)

- [ ] **Step 1: 드래그 + seen 파라미터 구현**
- [ ] **Step 2: app.ts에서 `{ seen: ctrl.seen }` 전달**
- [ ] **Step 3: 타입체크 + 전체 테스트 + `npm run build`**
- [ ] **Step 4: 수동 검증** — 드래그로 좌/우 선택, 2회차에서 아는 장면이 축약 카드로 표시

---

## Self-Review (기록)
- S1 DoD("1회차 사고→회귀→2회차 트루 완주") = Task 1(엔진 배선)+2(데이터)+3(화면)이 담당, 드래그(Director 결정로 S1 포함) = Task 4. ✅
- 결말 고정은 엔진(resolveRunEnd)이 보장하므로 데이터 태깅 오류가 있어도 회차 결말은 안 깨짐(테스트로 이중 검증). ✅
- `d2_w24_dark`를 loop:1로 태깅 → 2회차에서 사고 재현 미등장(트루 고정과 정합). ✅
- 시뮬 테스트(좌만/우만)는 게이지 붕괴로 조기 dark 가능 → Task 2 Step 4에 조정 절차 명시. ✅
- 커밋 스텝: 전부 보류(레포 미생성). ✅
