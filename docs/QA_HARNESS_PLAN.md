# QA 하네스 구축 실행 계획

> **이 문서의 대상** — 이 작업을 실제로 구현할 에이전트.
> 먼저 `docs/ASSET_EDITOR_PIPELINE.md`를 읽고 오세요. 파이프라인 구조를 안다는 전제로 작성했습니다.
> 작성일 2026-08-06 · 승인 완료(Phase 1+2+3 전체) · **아직 코드 미착수**

---

## 0. 목표

QA 체크리스트(`docs/QA-ASSET-CHECKLIST.md`) 238행 중 **자산 검수 228행**을 사람이 스크린샷으로 판정하는 대신,
**런타임에서 기계적으로 판정**할 수 있게 만든다.

| | 현재 (스크린샷) | 목표 (하네스) |
|---|---|---|
| 화면당 비용 | 이미지 1장 ≈ 1,500~2,500 토큰 | JSON 20~40행 ≈ 300~600 토큰 |
| 25화면 전수 | 5~10만 토큰 | 1~1.5만 토큰 |
| 재현성 | 낮음 (진입 경로 유동적) | 결정적 |
| 정확도 | "3% 눌림"은 눈으로 못 잡음 | 수치로 잡힘 |

**판정 기준 4가지가 전부 Pixi 씬 그래프에서 계산 가능하다는 것**이 이 설계의 근거다.

| 코드 | 기준 | 계산 방법 |
|---|---|---|
| ① | 폴백 아님 | 헬퍼가 `null`을 반환했는지 |
| ② | 비율 정상 | 그려진 비율 ÷ 원본 비율 |
| ③ | 잘림 없음 | 월드 bounds가 화면(430×800) 밖인지 |
| ④ | 배율 반영 | 슬롯 `scale` vs 실제 적용 배율 |

---

## 1. 작업 규약 (반드시 지킬 것)

- **파일별로 제안 → 승인 → 적용.** 한 파일 수정할 때마다 diff를 먼저 보여드리고 Director 승인을 받는다. 여러 파일을 한 번에 고치지 않는다.
- **편집 전 반드시 `Read`.** Director가 소스를 직접 수정 중이라 로컬이 이 문서와 다를 수 있다. **낯선 코드를 되돌리지 말 것** — `git diff`로 내 변경분과 Director의 변경분을 구분한 뒤 손댄다.
- **HARD GATES** — 브랜치 생성·머지·배포·파괴적 작업은 명시적 승인 없이 금지.
- **한국어 존댓말**로 보고한다.
- **빌드는 요청 시에만.** `tsc` + `vitest` + dev 확인까지가 기본.
- 신규 코드는 전부 **`isDevMode()` 게이트 안**에 둔다 → 제출본에 포함되지 않는다.

---

## 2. 현황 (재조사 불필요)

이미 있는 것:

| 위치 | 내용 |
|---|---|
| `src/main.ts:63` | `window.__scene` 부트 단계 마커 (`prologue`/`loading`/`title`/`lobby`/`game`) |
| `src/ui/app.ts:138` | `window.__game = { ctrl(), draw() }` |
| `src/ui/audio.ts:192` | `window.__bgm` |
| `src/ui/devMode.ts` | `isDevMode()` — dev / `VITE_CHEATS=1` / `?dev` |
| `src/ui/editor.ts` | `?editor`, `beginFrame()`, `editable()`, `setRedrawHook()` |
| `src/ui/cheatMenu.ts` | `cheats: Cheat[]` (모듈 내부, **export 안 됨**) |
| `src/ui/app.ts:126` | 관문 5종 치트 등록 (`GATE_LABEL`) |

없는 것 = 이 문서가 만들 것:

1. 슬롯 렌더 계측 (Phase 1)
2. 결정적 진입 + RNG 시드 (Phase 2)
3. 순회 러너 + 리포트 (Phase 3)

부트 흐름 (`src/main.ts:63~85`) — Phase 2에서 손댈 지점:

```ts
mark("prologue");  await playPrologue(app);
mark("loading");   await showLoading(app, progress, assetsPromise, loadingBgPromise);
mark("title");     await showTitle(app, assets.title);
mark("lobby");     let lobbyResult = await showLobby(app, assets);
for (;;) { mark("game"); await startApp(app, assets, lobbyResult === "practice");
           mark("lobby"); lobbyResult = await showLobby(app, assets); }
```

---

# Phase 1 · 슬롯 계측

**핵심 아이디어**: `uiSkin.ts`의 헬퍼는 이미 모든 슬롯 사용의 단일 관문이다. 진입부에 기록 한 줄씩만 넣으면 된다.
슬롯이 없어 `null`을 반환하면 그것이 곧 **폴백 발생 기록**이다.

### Task 1.1 — `src/ui/qaProbe.ts` 신설

- [ ] **Step 1: 파일 생성**

```ts
// ui/qaProbe.ts — QA 하네스: 슬롯 렌더 계측.
// uiSkin 헬퍼가 호출될 때마다 기록하고, window.__qa.slots()로 덤프한다.
// isDevMode()에서만 동작 — 제출본에서는 record가 즉시 반환된다.
import type { Container } from "pixi.js";
import { isDevMode } from "./devMode";

export type SkinHelper = "node" | "fit" | "cover" | "natural" | "tex" | "texTrim";

interface Rec {
  id: string;
  helper: SkinHelper;
  hit: boolean;                      // 슬롯에 아트가 있었나 (false = 폴백)
  box: [number, number] | null;      // 호출측이 넘긴 박스
  src: [number, number] | null;      // 트리밍 후 텍스처 크기
  scale: number;                     // 슬롯 배율
  mode: string | null;               // stretch | 9slice | 3slice | (natural)
  node: Container | null;            // 반환 노드 (bounds 계산용, 직렬화 제외)
}

/** 직렬화 결과 — 러너가 읽는 형태 */
export interface SlotReport {
  id: string;
  helper: SkinHelper;
  fallback: boolean;
  mode: string | null;
  scale: number;
  box: [number, number] | null;
  src: [number, number] | null;
  drawn: [number, number] | null;    // 월드 기준 실제 렌더 크기
  at: [number, number] | null;       // 월드 좌상단 좌표
  squash: number;                    // 0=무왜곡. 0.08 = 8% 눌림/늘어남
  offscreen: boolean;                // 화면(430×800) 밖으로 나갔나
  mounted: boolean;                  // 씬에 실제로 붙었나
}

const SCREEN_W = 430;
const SCREEN_H = 800;

let recs: Rec[] = [];

/** 매 draw 시작 시 초기화 — editor.beginFrame()에서 함께 호출 */
export function qaReset(): void {
  recs = [];
}

/** uiSkin 헬퍼가 호출 — dev가 아니면 즉시 반환 */
export function qaRecord(r: Rec): void {
  if (!isDevMode()) return;
  recs.push(r);
}

/** 현재 화면의 슬롯 렌더 리포트 */
export function qaSlots(): SlotReport[] {
  return recs.map((r) => {
    let drawn: [number, number] | null = null;
    let at: [number, number] | null = null;
    let mounted = false;
    if (r.node && !r.node.destroyed && r.node.parent) {
      mounted = true;
      const b = r.node.getBounds();
      drawn = [Math.round(b.width), Math.round(b.height)];
      at = [Math.round(b.x), Math.round(b.y)];
    }
    // 눌림: 원본 비율 대비 실제 렌더 비율의 어긋남 (비율 유지 헬퍼는 항상 0에 수렴)
    let squash = 0;
    if (r.src && drawn && r.src[1] > 0 && drawn[1] > 0) {
      const srcRatio = r.src[0] / r.src[1];
      const drawnRatio = drawn[0] / drawn[1];
      squash = Math.abs(1 - drawnRatio / srcRatio);
    }
    const offscreen = at !== null && drawn !== null &&
      (at[0] + drawn[0] < 0 || at[1] + drawn[1] < 0 ||
       at[0] > SCREEN_W || at[1] > SCREEN_H);
    return {
      id: r.id, helper: r.helper, fallback: !r.hit, mode: r.mode, scale: r.scale,
      box: r.box, src: r.src, drawn, at,
      squash: Math.round(squash * 1000) / 1000, offscreen, mounted,
    };
  });
}
```

- [ ] **Step 2: 타입 확인** — `npx tsc --noEmit` (아직 아무도 안 부르므로 통과해야 정상)

- [ ] **Step 3: Director에게 diff 보고 후 승인**

---

### Task 1.2 — `src/ui/uiSkin.ts` 계측 훅 6곳

각 헬퍼의 **반환 직전**에 한 줄씩 넣는다. **기존 로직은 건드리지 않는다.**

- [ ] **Step 1: import 추가** (파일 상단, 5행 `videoLoad` import 다음)

```ts
import { qaRecord } from "./qaProbe";
```

- [ ] **Step 2: 헬퍼 6개 계측**

`skinFit`(현재 153행) 기준 패턴 — 나머지도 동일하게 적용한다.

```ts
export function skinFit(id: string, w: number, h: number): Container | null {
  const hit = loaded.get(id);
  if (!hit) {
    qaRecord({ id, helper: "fit", hit: false, box: [w, h], src: null, scale: 1, mode: null, node: null });
    return null;
  }
  const s = Math.min(w / hit.tex.width, h / hit.tex.height) * (hit.slot.scale ?? 1);
  const sp = new Sprite(hit.tex);
  sp.scale.set(s);
  sp.x = (w - hit.tex.width * s) / 2;
  sp.y = (h - hit.tex.height * s) / 2;
  applyDensity(sp, hit.slot);
  const wrap = new Container();
  wrap.addChild(sp);
  qaRecord({ id, helper: "fit", hit: true, box: [w, h],
             src: [hit.tex.width, hit.tex.height], scale: hit.slot.scale ?? 1,
             mode: hit.slot.mode, node: wrap });
  return wrap;
}
```

적용 대상과 `helper` 값:

| 함수 | 현재 위치 | `helper` | 주의 |
|---|---|---|---|
| `skinTex` | 121행 | `"tex"` | Texture 반환 — `node: null`, `src`는 `raw` 크기 |
| `skinTexTrim` | 126행 | `"texTrim"` | 동일. **배율 미적용 경로**라 리포트에서 별도 취급 |
| `skinNatural` | 137행 | `"natural"` | |
| `skinFit` | 153행 | `"fit"` | |
| `skinCover` | 169행 | `"cover"` | 마스크 크롭 → `squash`는 항상 0 근처, 대신 `drawn`이 박스와 같아야 정상 |
| `skinNode` | 187행 | `"node"` | `slot.natural`이면 `skinNatural`로 위임 → **중복 기록 주의**. 위임 전에 return하므로 `skinNode`쪽 기록은 위임 분기 **뒤**에 둔다 |

> **⚠️ `skinNode`의 위임 분기**
> ```ts
> if (hit.slot.natural) return skinNatural(id, w, h);  // 여기서 natural이 기록됨 — node 기록 추가 금지
> ```

- [ ] **Step 3: `npx tsc --noEmit` + `npx vitest run`** (110개 통과 유지)
- [ ] **Step 4: Director 승인**

---

### Task 1.3 — `src/ui/editor.ts` 리셋 연동

- [ ] **Step 1**: `beginFrame()`에 리셋 추가 (현재 46행)

```ts
import { qaReset } from "./qaProbe";

export function beginFrame(): void {
  visible.clear();
  qaReset();          // ← 추가
}
```

> `beginFrame()`은 각 화면 draw 시작 시 호출된다. 이걸 안 부르는 화면이 있으면 슬롯 기록이 누적된다 —
> 러너에서 `mounted: false`가 비정상적으로 많으면 이 케이스를 의심할 것.

- [ ] **Step 2**: 검증 + 승인

---

### Task 1.4 — `window.__qa` 노출

- [ ] **Step 1**: `src/ui/app.ts` 138행의 기존 `__game` 훅 옆에 추가

```ts
(window as unknown as { __qa: unknown }).__qa = {
  scene: () => (window as unknown as { __scene?: string }).__scene ?? null,
  slots: () => qaSlots(),
  defined: () => allUiSkinSlots().map((s) => ({ id: s.id, label: s.label, file: s.file })),
};
```

> `__game`은 `startApp` 안에서 등록되므로 **게임 진입 전(로비·타이틀)에는 없다.**
> `__qa`는 로비에서도 필요하니 **`main.ts`의 부트 시작부**에 등록하는 것을 권한다. 구현 시 판단할 것.

- [ ] **Step 2 · 수동 검증**

```js
// 브라우저 콘솔 (로비에서)
__qa.slots().filter(s => s.fallback).map(s => s.id)   // 이 화면의 폴백 슬롯
__qa.slots().filter(s => s.squash > 0.05)             // 5% 이상 눌린 슬롯
```

- [ ] **Step 3**: Director 승인 → Phase 1 완료 보고

---

# Phase 2 · 결정적 진입

### Task 2.1 — `src/ui/cheatMenu.ts` 프로그램 호출 노출

- [ ] **Step 1**: export 추가 (파일 하단)

```ts
/** QA 하네스용 — 라벨 접두사로 치트 실행. 없으면 false */
export function runCheat(prefix: string): boolean {
  const c = cheats.find((x) => x.label.startsWith(prefix));
  if (!c) return false;
  c.run();
  return true;
}

export function cheatLabels(): string[] {
  return cheats.map((c) => c.label);
}
```

> DOM 버튼 텍스트 매칭이 사라지므로 Playwright 스크립트가 대폭 짧아진다.

- [ ] **Step 2**: 검증 + 승인

### Task 2.2 — `?goto=` 부트 분기

- [ ] **Step 1**: `src/ui/qaGoto.ts` 신설 — 파싱과 목표 정의만 담당

```ts
// ui/qaGoto.ts — QA 하네스: ?goto= 로 특정 화면 직행. isDevMode()에서만 유효.
import { isDevMode } from "./devMode";

export interface GotoSpec { screen: string; arg: string | null; }

export function qaGoto(): GotoSpec | null {
  if (!isDevMode()) return null;
  const raw = new URLSearchParams(location.search).get("goto");
  if (!raw) return null;
  const [screen, arg = null] = raw.split(":");
  return { screen: screen ?? "", arg };
}

/** goto 값 → 실행할 치트 라벨 접두사 */
export const GOTO_CHEAT: Record<string, string> = {
  "gate:act2": "🥇", "gate:act3": "🎯", "gate:act4": "📷",
  "gate:clue4": "🔍", "gate:block": "🎤 사보타주",
  "train": "🎹", "board": "👥", "audition": "🎤 오디션 보기",
};
```

- [ ] **Step 2**: `src/main.ts` 부트 흐름 분기

목표 동작:

| `?goto=` | 도달 화면 |
|---|---|
| `title` | 타이틀에서 정지 |
| `lobby` | 로비 |
| `deck` | 로비 + 카드덱 시트 열림 |
| `game` | 스토리 진행 화면 |
| `train:vocal` 등 | 연습하기 해당 종목 |
| `gate:act2` 등 | 관문 5종 |
| `board` / `audition` | 멤버 점검 / 오디션 무대 |

구현 지침 (정확한 diff는 실제 코드를 보고 작성할 것):

1. `qaGoto()`가 있으면 **프롤로그 건너뛰기** — `playPrologue` 호출 자체를 skip (내부 finish 호출보다 안전)
2. 로딩은 건너뛰지 말 것 — 에셋이 없으면 전부 폴백으로 잡혀 리포트가 오염된다. `showLoading`은 유지
3. `title`이 목표가 아니면 `showTitle`도 skip
4. 로비 이후는 `runCheat()`로 처리 — 치트가 이미 전부 등록돼 있다
5. `mark()` 마커를 유지해 러너가 도달을 확인할 수 있게 할 것

> **⚠️ `showLobby`는 사용자 입력을 기다리는 Promise다.** goto가 게임 진입을 요구하면 로비를 자동 통과시켜야 한다.
> `showLobby(app, assets)`에 옵션 인자를 추가하는 방식과, `main.ts`에서 `Promise.race`로 우회하는 방식이 있다.
> **전자를 권장** — 후자는 로비 리스너가 살아남아 이후 화면의 Space를 가로챌 위험이 있다(오디션 Space 버그와 동일 계열).

- [ ] **Step 3**: 각 goto 값이 실제로 목표 화면에 도달하는지 수동 확인 (`__qa.scene()`)
- [ ] **Step 4**: Director 승인

### Task 2.3 — RNG 시드

- [ ] **Step 1**: `?seed=42` 지원. `Math.random`을 직접 갈아끼우지 말고, 미니게임이 쓰는 난수 진입점을 찾아 시드 가능한 함수로 교체한다.

```ts
// engine/rng.ts (신설 제안)
let s = 0;
export function seedRng(n: number): void { s = n >>> 0; }
export function rnd(): number {           // mulberry32
  s = (s + 0x6D2B79F5) >>> 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
```

> **범위 주의** — 게임 전체의 `Math.random()`을 바꾸면 부작용이 크다.
> **미니게임 결과 판정에 쓰이는 곳만** 교체하고, 나머지는 그대로 둔다. 대상 파일은 `src/engine/minigames.ts` 중심.
> 이 Task는 **비용 대비 효과가 가장 낮다.** Phase 3에서 필요성이 확인되면 그때 해도 된다 — Director와 상의할 것.

---

# Phase 3 · QA 러너

게임 소스가 아닌 **스크립트**다. `scripts/qa-scan.mjs`로 만든다.

### Task 3.1 — 순회 러너

- [ ] **Step 1**: `scripts/qa-scan.mjs` 작성

```js
// QA 스캔 — 화면을 순회하며 슬롯 렌더 리포트를 수집한다.
// 사용: node scripts/qa-scan.mjs            → .shots/qa-report.json
//       node scripts/qa-scan.mjs --shots    → 실패 화면만 스크린샷
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://localhost:5174';
const SHOTS = process.argv.includes('--shots');
const TARGETS = [
  'title', 'lobby', 'deck', 'game',
  'train:vocal', 'train:dance', 'train:promo', 'train:funds', 'train:audition', 'train:bond',
  'gate:act2', 'gate:act3', 'gate:act4', 'gate:clue4', 'gate:block',
  'board', 'audition',
];

mkdirSync('.shots', { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 430, height: 800 } });
const report = { at: new Date().toISOString(), screens: [] };

for (const t of TARGETS) {
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  try {
    await p.goto(`${BASE}/?goto=${encodeURIComponent(t)}&seed=42`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForFunction(() => window.__qa && window.__qa.slots().length > 0, { timeout: 20000 });
    await p.waitForTimeout(600);   // 영상 슬롯 canplay 여유
    const slots = await p.evaluate(() => window.__qa.slots());
    const scene = await p.evaluate(() => window.__qa.scene());
    const bad = slots.filter((s) => s.fallback || s.squash > 0.05 || s.offscreen || !s.mounted);
    report.screens.push({ target: t, scene, total: slots.length, bad, errors: errs });
    if (SHOTS && bad.length) await p.screenshot({ path: `.shots/qa-${t.replace(':', '-')}.png` });
    console.log(`${bad.length ? '⚠️ ' : '✅'} ${t.padEnd(16)} 슬롯 ${String(slots.length).padStart(3)} · 문제 ${bad.length}`);
  } catch (e) {
    report.screens.push({ target: t, error: String(e).slice(0, 300) });
    console.log(`❌ ${t.padEnd(16)} ${String(e).slice(0, 80)}`);
  }
  await p.close();
}
writeFileSync('.shots/qa-report.json', JSON.stringify(report, null, 2));
await b.close();
console.log('\n→ .shots/qa-report.json');
```

> **주의** — 이 프로젝트에는 `playwright`가 없고 **`playwright-core` + 시스템 Chrome**만 있다.
> 반드시 `chromium.launch({ channel: 'chrome' })`을 쓸 것.

- [ ] **Step 2**: dev 서버를 띄운 상태로 실행 → 콘솔 요약이 나오는지 확인
- [ ] **Step 3**: Director 승인

### Task 3.2 — 판정 규칙과 체크리스트 매핑

- [ ] **Step 1**: 임계값을 러너 상단 상수로 노출하고 근거를 주석으로 남긴다

| 판정 | 조건 | 근거 |
|---|---|---|
| 폴백 | `fallback === true` | 슬롯 미업로드 또는 로드 실패. 체크리스트 기준① |
| 눌림 | `squash > 0.05` | 5% 미만은 반올림 오차. `mode === "9slice"`는 **의도된 늘림이므로 제외** |
| 화면 밖 | `offscreen === true` | 기준③ |
| 미부착 | `mounted === false` | 헬퍼는 불렸는데 씬에 안 붙음 = 배선 누락 의심 |
| 배율 미반영 | `helper === "tex" \|\| "texTrim"` 이고 `scale !== 1` | 이 경로는 `scale`이 자동 적용되지 않음 — 호출측이 `skinScale()`을 곱했는지 사람이 확인해야 함 |

- [ ] **Step 2**: 리포트 → 체크리스트 자동 채움 스크립트 (선택)

`docs/QA-ASSET-CHECKLIST.md`의 `슬롯 ID` 열과 리포트를 조인해 `판정` 열을 채운다.
**단, 자동 판정은 기준①②③④에 한정한다.** "예쁜가·톤이 맞는가"는 사람 판단이므로 `판정` 열을 비워 둔다.

- [ ] **Step 3**: Director 승인 → Phase 3 완료 보고

---

## 4. 전체 검증 게이트

각 Phase 종료 시 반드시:

```bash
cd ~/github/debut-loop
npx tsc --noEmit          # 타입
npx vitest run            # 110개 유지 (슬롯 수 변경 없으므로 개수 기대값 손댈 일 없음)
```

그리고 **게임이 정상 동작하는지** 육안 확인 — 하네스가 게임을 망가뜨리지 않았는지가 가장 중요하다.
특히 Phase 1은 `uiSkin.ts`를 건드리므로 **로비·연습·관문 각 1회씩** 들어가 본다.

---

## 5. 롤백

독립 git 저장소가 있으므로 **Task 단위 브랜치 + 커밋**으로 롤백한다. (`.shots/backup/` 수동 복사 규약은 폐기)

```bash
git switch -c qa-harness/phase1-task1   # Task 착수
git diff                                # 승인 전 변경 확인
git restore src/ui/uiSkin.ts            # 되돌리기
```

---

## 6. 예상 비용과 회수

| Phase | 신규/수정 | 분량 |
|---|---|---|
| 1 | `qaProbe.ts` 신설 + `uiSkin.ts` 6곳 + `editor.ts` 1곳 + 훅 노출 | ~150줄 |
| 2 | `qaGoto.ts` 신설 + `main.ts` 분기 + `cheatMenu.ts` export (+ `rng.ts`) | ~80줄 |
| 3 | `scripts/qa-scan.mjs` (게임 소스 아님) | ~120줄 |

**회수 시점** — QA 1회차에 이미 회수된다. 이후 재검수는 `node scripts/qa-scan.mjs` 한 줄이고 비용은 리포트 읽는 값(1~1.5만 토큰)뿐이다.
에셋을 추가할 때마다 돌릴 수 있으므로 **제출 직전 회귀 검사**로도 그대로 쓴다.

---

## 7. 이 하네스가 못 하는 것 (정직하게)

자동 판정은 **"연결됐는가"** 까지다. 아래는 여전히 사람이 봐야 한다.

- 아트가 화면 맥락에 어울리는가 (톤·색·완성도)
- 문구가 아트와 겹쳐 읽히지 않는가 → bounds 교차로 근사는 가능하나 오탐이 많다
- 애니메이션·연출이 의도대로인가
- 영상 슬롯이 **끊김 없이 루프**하는가 (첫 프레임 정지는 `drawn`으로 못 잡음)
- 밸런싱 10행 (체크리스트의 `대분류 = 밸런스`)

따라서 최종 흐름은 **"러너로 228행을 걸러내고, 남은 것과 미적 판단만 사람이 본다"** 가 된다.
