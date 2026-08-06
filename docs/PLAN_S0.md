# S0: Pixi 부트 + 스와이프 1화면 관통 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브라우저에서 카드 대사를 보고 좌/우를 선택하면 게이지가 반영되고 다음 비트로 넘어가는, 제출 가능한 최소 플레이 빌드를 만든다.

**Architecture:** 순수 `RunController`(engine 상태 + 엔진 함수 오케스트레이션, 렌더러 의존 0, 유닛테스트 대상)와 Pixi 뷰(`app`/`gaugeBar`/`swipeCard`, 상태 읽기+입력 방출만)를 분리한다. 회귀·엔딩·미니게임·카드는 S1 이후.

**Tech Stack:** TypeScript(strict), PixiJS v8, Vite, Vitest.

## Global Constraints

- `tsconfig`: `strict` + `noUncheckedIndexedAccess` → 배열 인덱스 접근은 항상 `undefined` 가드.
- 아키텍처: `engine/`·`ui/runController.ts`는 **Pixi를 import 하지 않는다**(순수 TS). Pixi는 `ui/app.ts`·`gaugeBar.ts`·`swipeCard.ts`에서만.
- PixiJS **v8** API: `const app = new Application(); await app.init({...}); el.appendChild(app.canvas)`. 텍스트는 `new Text({ text, style })`, 그래픽은 `new Graphics().roundRect(...).fill(...)`.
- 게이지는 0~100 (엔진 `clampGauges`가 보장).
- `vite.config.ts`의 `base: './'` 유지(GitHub Pages 상대경로).
- 엔진/컨트롤러는 vitest 유닛, Pixi 뷰는 수동 검증(`npm run dev`).
- 대사 토큰 `{antiStaff}` 등은 `casting`으로 치환해 표시.
- ⚠️ **git**: debut-loop은 아직 자체 레포가 아님(상위 ~/GitHub 레포에 걸림, Director가 나중에 생성 예정). **각 Task의 커밋 스텝은 레포 생성 전까지 보류** — 코드·테스트 스텝만 진행.

---

## File Structure

- `src/data/index.ts` (Create) — config·beats·cardTemplates·casting 로드 및 타입 부여
- `src/ui/runController.ts` (Create) — 순수 런 오케스트레이션 (`createRunController`)
- `tests/runController.test.ts` (Create) — 컨트롤러 유닛
- `src/ui/gaugeBar.ts` (Modify, 현재 스텁) — 5게이지 렌더 `renderGauges`
- `src/ui/swipeCard.ts` (Modify, 현재 스텁) — 카드+선택 버튼 렌더 `renderCard`
- `src/ui/app.ts` (Modify, 현재 스텁) — 런 루프 `startApp`
- `src/main.ts` (Modify, 현재 스텁) — Pixi 부트

---

### Task 1: 데이터 로더 + 순수 RunController

**Files:**
- Create: `src/data/index.ts`
- Create: `src/ui/runController.ts`
- Test: `tests/runController.test.ts`

**Interfaces:**
- Consumes: `createState`, `applyEffect` (`engine/state`), `pickNextBeat`, `markPlayed` (`engine/router`), 타입 `Beat`·`State`·`GameConfig` (`engine/types`)
- Produces:
  - `createRunController(beats: Beat[], config: GameConfig, difficulty: "small"|"big"): RunController`
  - `interface RunController { readonly state: State; readonly current: Beat | null; choose(dir: "left"|"right"): void; }`
  - `src/data/index.ts` exports: `config: GameConfig`, `beats: Beat[]`, `cardTemplates: CardTemplate[]`, `casting: Record<string,string>`

- [ ] **Step 1: 데이터 로더 작성**

Create `src/data/index.ts`:
```ts
// src/data/index.ts — JSON 데이터 로드 + 타입 부여 (ui 진입점에서 사용)
import configJson from "./config.json";
import beatsJson from "./beats/demo2_zeroc.json";
import cardsJson from "./cards.json";
import type { GameConfig, Beat, CardTemplate } from "../engine/types";

export const config = configJson as unknown as GameConfig;
export const beats = (beatsJson as unknown as { beats: Beat[] }).beats;
export const cardTemplates = cardsJson as unknown as CardTemplate[];
export const casting = (beatsJson as unknown as { casting: Record<string, string> }).casting ?? {};
```

- [ ] **Step 2: 실패하는 테스트 작성**

Create `tests/runController.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createRunController } from "../src/ui/runController";
import type { GameConfig, Beat } from "../src/engine/types";

const cfg: GameConfig = {
  totalWeeks: 24, debutWeek: 24,
  actWeeks: { 0: [0, 0], 1: [1, 4], 2: [5, 10], 3: [11, 18], 4: [19, 23], 5: [24, 24] },
  gaugeMin: 0, gaugeMax: 100, cluesToBlock: 4,
  difficulties: {
    small: { id: "small", label: "소형", startGauges: { skill: 30, mental: 55, reputation: 20, bond: 40, capital: 20 }, capitalPressurePerWeek: 3 },
    big: { id: "big", label: "대형", startGauges: { skill: 40, mental: 60, reputation: 35, bond: 45, capital: 60 }, capitalPressurePerWeek: 1 },
  },
};
const beats: Beat[] = [
  { id: "a", act: 1, textKey: "첫 비트", left: { label: "L", effects: { gauges: { skill: 5 } } }, right: { label: "R", effects: { gauges: { mental: -3 } } } },
  { id: "b", act: 1, textKey: "둘째", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
];

describe("RunController", () => {
  it("생성 시 첫 비트를 current로", () => {
    const c = createRunController(beats, cfg, "small");
    expect(c.current?.id).toBe("a");
    expect(c.state.gauges.skill).toBe(30);
  });
  it("choose(left) → 효과 적용 + 다음 비트로", () => {
    const c = createRunController(beats, cfg, "small");
    c.choose("left");
    expect(c.state.gauges.skill).toBe(35); // 30+5
    expect(c.current?.id).toBe("b");
  });
  it("비트 로드 시 state.week/act 동기화", () => {
    const withWeek: Beat[] = [{ id: "w", act: 2, week: 6, textKey: "", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } }];
    const c = createRunController(withWeek, cfg, "small");
    expect(c.state.act).toBe(2);
    expect(c.state.week).toBe(6);
  });
  it("비트 소진 시 current=null", () => {
    const c = createRunController(beats, cfg, "small");
    c.choose("left");
    c.choose("left");
    expect(c.current).toBeNull();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run tests/runController.test.ts`
Expected: FAIL — `createRunController` not found (`src/ui/runController.ts` 없음)

- [ ] **Step 4: RunController 구현**

Create `src/ui/runController.ts`:
```ts
// ui/runController.ts — 순수 런 오케스트레이션 (Pixi 의존 0). 엔진 상태+함수 배선.
import type { Beat, State, GameConfig } from "../engine/types";
import { createState, applyEffect } from "../engine/state";
import { pickNextBeat, markPlayed } from "../engine/router";

export interface RunController {
  readonly state: State;
  readonly current: Beat | null;
  choose(dir: "left" | "right"): void;
}

export function createRunController(
  beats: Beat[],
  config: GameConfig,
  difficulty: "small" | "big",
): RunController {
  const state = createState(config, difficulty);
  let cursor = 0;
  let current: Beat | null = null;

  const advance = (): void => {
    const pick = pickNextBeat(beats, state, cursor);
    cursor = pick.cursor;
    current = pick.beat;
    if (current) { // 주차/막 동기화 (S1 캘린더·엔딩 판정의 기반)
      state.act = current.act;
      if (current.week !== undefined) state.week = current.week;
    }
  };
  advance(); // 첫 비트 로드

  return {
    get state() { return state; },
    get current() { return current; },
    choose(dir) {
      if (!current) return;
      applyEffect(state, current[dir].effects, config);
      markPlayed(state, current.id);
      advance();
    },
  };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/runController.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: 타입체크**

Run: `npx tsc --noEmit`
Expected: exit 0 (에러 없음)

- [ ] **Step 7: 커밋**

```bash
cd debut-loop
git add src/data/index.ts src/ui/runController.ts tests/runController.test.ts
git commit -m "feat(ui): 데이터 로더 + 순수 RunController (S0)"
```

---

### Task 2: Pixi 부트 + 스탯 패널(게이지) 렌더

**Files:**
- Modify: `src/main.ts` (전체 교체)
- Modify: `src/ui/gaugeBar.ts` (스텁 → 구현)
- Modify: `src/ui/app.ts` (스텁 → 최소 구현: 게이지만)

**Interfaces:**
- Consumes: `config`·`beats` (`data`), `createRunController` (Task 1), 타입 `State`·`GaugeId`
- Produces:
  - `renderGauges(parent: Container, state: State): void`
  - `startApp(app: Application): void`

- [ ] **Step 1: 게이지 렌더 구현**

Replace `src/ui/gaugeBar.ts`:
```ts
// ui/gaugeBar.ts — 5게이지 렌더 (Pixi v8). state 읽기만.
import { Container, Graphics, Text } from "pixi.js";
import type { State, GaugeId } from "../engine/types";

const GAUGES: Array<[GaugeId, string, number]> = [
  ["skill", "실력", 0x6fb8ff],
  ["mental", "멘탈", 0xb39cff],
  ["reputation", "평판", 0xff9ec4],
  ["bond", "유대", 0x6fd8c4],
  ["capital", "자본", 0xf0c05a],
];

export function renderGauges(parent: Container, state: State): void {
  const panel = new Container();
  panel.x = 18;
  panel.y = 16;
  GAUGES.forEach(([id, label, color], i) => {
    const y = i * 22;
    const lbl = new Text({ text: label, style: { fontSize: 12, fill: 0x5b4a70 } });
    lbl.y = y;
    const bg = new Graphics().roundRect(48, y + 2, 200, 10, 5).fill(0xf1eaf6);
    const v = Math.max(0, Math.min(100, state.gauges[id]));
    const fill = new Graphics().roundRect(48, y + 2, (200 * v) / 100, 10, 5).fill(color);
    const num = new Text({ text: String(Math.round(v)), style: { fontSize: 12, fill: 0x5b4a70 } });
    num.x = 256;
    num.y = y;
    panel.addChild(lbl, bg, fill, num);
  });
  parent.addChild(panel);
}
```

- [ ] **Step 2: app.ts 최소 구현 (게이지만)**

Replace `src/ui/app.ts`:
```ts
// ui/app.ts — 런 루프: RunController 상태를 Pixi로 그림.
import { Application, Container } from "pixi.js";
import { createRunController } from "./runController";
import { beats, config } from "../data";
import { renderGauges } from "./gaugeBar";

export function startApp(app: Application): void {
  const ctrl = createRunController(beats, config, "small");
  const root = new Container();
  app.stage.addChild(root);

  function draw(): void {
    root.removeChildren();
    renderGauges(root, ctrl.state);
    // 카드 렌더는 Task 3
  }
  draw();
}
```

- [ ] **Step 3: main.ts Pixi 부트**

Replace `src/main.ts`:
```ts
// main.ts — Pixi 부트스트랩. 로직은 engine, 렌더는 ui.
import { Application } from "pixi.js";
import { startApp } from "./ui/app";

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ width: 430, height: 800, background: "#f8f5fd", antialias: true });
  const el = document.getElementById("app");
  if (!el) throw new Error("#app not found");
  el.appendChild(app.canvas);
  startApp(app);
}

void main();
```

- [ ] **Step 4: 타입체크 + 수동 검증**

Run: `npx tsc --noEmit` → exit 0
Run: `npm run dev` → 브라우저에서 `http://localhost:5173` 열기
Expected: 상단에 5게이지(실력 30·멘탈 55·평판 20·유대 40·자본 20) 바가 파스텔 색으로 표시됨

- [ ] **Step 5: 커밋**

```bash
git add src/main.ts src/ui/app.ts src/ui/gaugeBar.ts
git commit -m "feat(ui): Pixi 부트 + 스탯 패널 게이지 렌더 (S0)"
```

---

### Task 3: 카드 + 선택 입력 → 스와이프 1화면 관통

**Files:**
- Modify: `src/ui/swipeCard.ts` (스텁 → 구현)
- Modify: `src/ui/app.ts` (카드 렌더 + 재그리기 배선)

**Interfaces:**
- Consumes: `renderGauges` (Task 2), `createRunController` (Task 1), `casting` (`data`), 타입 `Beat`
- Produces: `renderCard(parent: Container, beat: Beat, casting: Record<string,string>, onChoose: (dir: "left"|"right") => void): void`

- [ ] **Step 1: 카드 렌더 구현 (대사 + 좌/우 버튼)**

Replace `src/ui/swipeCard.ts`:
```ts
// ui/swipeCard.ts — 카드(대사) + 좌/우 선택 버튼 렌더 (Pixi v8).
import { Container, Graphics, Text } from "pixi.js";
import type { Beat } from "../engine/types";

const sub = (t: string, casting: Record<string, string>): string =>
  t.replace(/\{(\w+)\}/g, (_, k: string) => casting[k] ?? k);

export function renderCard(
  parent: Container,
  beat: Beat,
  casting: Record<string, string>,
  onChoose: (dir: "left" | "right") => void,
): void {
  const card = new Container();
  card.x = 18;
  card.y = 140;

  const bg = new Graphics().roundRect(0, 0, 394, 420, 24).fill(0xffffff).stroke({ width: 2, color: 0xece4f4 });
  const line = new Text({
    text: sub(beat.textKey, casting),
    style: { fontSize: 17, fill: 0x5b4a70, wordWrap: true, wordWrapWidth: 360, lineHeight: 26 },
  });
  line.x = 18;
  line.y = 20;
  card.addChild(bg, line);

  const mkBtn = (label: string, x: number, color: number, dir: "left" | "right"): void => {
    const b = new Container();
    b.x = x;
    b.y = 340;
    const g = new Graphics().roundRect(0, 0, 178, 60, 16).fill(color);
    const t = new Text({ text: label, style: { fontSize: 14, fill: 0xffffff } });
    t.x = 12;
    t.y = 20;
    b.addChild(g, t);
    b.eventMode = "static";
    b.cursor = "pointer";
    b.on("pointertap", () => onChoose(dir));
    card.addChild(b);
  };
  mkBtn("← " + beat.left.label, 18, 0x9a7fe0, "left");
  mkBtn(beat.right.label + " →", 198, 0xff7fb0, "right");

  parent.addChild(card);
}
```

- [ ] **Step 2: app.ts에 카드 렌더 배선**

Replace `src/ui/app.ts`:
```ts
// ui/app.ts — 런 루프: RunController 상태를 Pixi로 그림.
import { Application, Container } from "pixi.js";
import { createRunController } from "./runController";
import { beats, config, casting } from "../data";
import { renderGauges } from "./gaugeBar";
import { renderCard } from "./swipeCard";

export function startApp(app: Application): void {
  const ctrl = createRunController(beats, config, "small");
  const root = new Container();
  app.stage.addChild(root);

  function draw(): void {
    root.removeChildren();
    renderGauges(root, ctrl.state);
    if (ctrl.current) {
      renderCard(root, ctrl.current, casting, (dir) => {
        ctrl.choose(dir);
        draw();
      });
    }
    // current=null(비트 소진) 시 화면은 게이지만 — 엔딩/회귀는 S1
  }
  draw();
}
```

- [ ] **Step 3: 타입체크 + 수동 검증**

Run: `npx tsc --noEmit` → exit 0
Run: `npm run dev` → 브라우저
Expected: 카드에 첫 비트 대사가 보이고, 하단 좌/우 버튼(라벤더/핑크) 탭 시 게이지가 변하며 다음 비트로 넘어감. 여러 장 진행 가능.

- [ ] **Step 4: 빌드 확인 (제출 빌드 검증)**

Run: `npm run build`
Expected: `dist/` 생성, 에러 없음 (GitHub Pages 배포 대상)

- [ ] **Step 5: 커밋**

```bash
git add src/ui/swipeCard.ts src/ui/app.ts
git commit -m "feat(ui): 카드+선택 입력 → 스와이프 1화면 관통 (S0 완료)"
```

---

## Self-Review (기록)

- **스펙 커버리지**: BUILD_ROADMAP S0 DoD("스탯패널+카드+스와이프→applyEffect→게이지 반영→다음 비트")를 Task 1~3이 모두 구현. ✅
- **아키텍처**: `runController`는 Pixi 미import(순수, 테스트됨), Pixi는 app/gaugeBar/swipeCard에만. ✅
- **플레이스홀더**: 없음 — 모든 코드 블록 완전. ✅
- **타입 일관성**: `createRunController`/`RunController`/`renderGauges`/`renderCard` 시그니처가 Task 간 일치. `state.gauges[id]`는 `GaugeId`로 접근(noUncheckedIndexedAccess: `Gauges`는 `Record<GaugeId,number>`라 안전). ✅
- **드래그 스와이프**: S0는 탭 버튼으로 관통(최소 플레이). 실제 드래그 제스처는 **S1~S2 언저리로 당김**(Director 결정 — 장르 정체성·심사 인상, 목업 `bindDrag` 이식).

## 리뷰 반영 이력 (Director 리뷰 2026-07-23)
1. **git**: 자체 레포 없음 발견 → 커밋 스텝 보류(레포는 Director가 나중에 생성)
2. **드래그**: S5 → **S1~S2 언저리**로 당김
3. **week/act 동기화**: RunController가 비트 로드 시 `state.week/act` 갱신 (Task 1에 반영, 테스트 4개)
4. `"small"` 하드코딩·Task 분할: 리뷰 승인, 유지

## 다음 (후속 계획)
- **S1**: `advance` 도입 → 엔딩(`screens`) + 회귀 1→2회차 + 가속(seen) + **드래그 스와이프 이식(목업 bindDrag)**
- **S2**: 미니게임 3엔진 UI(목업 이식) — 관문 배선 (드래그가 S1에서 밀리면 여기서)
- **S3**: 연습 메뉴 + 카드 획득(카드 2순위)
- **S4**: 관문 카드 선택·적용(카드 3순위)
- **S5**: 파스텔 스킨 + 이미지 에셋 + 폴리시
