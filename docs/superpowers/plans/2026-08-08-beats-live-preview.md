# 플로우 에디터 실시간 프리뷰 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 플로우 에디터에서 대사를 고치면 저장 없이, 실행 중인 게임 화면에 진행 상태를 유지한 채 즉시 반영한다.

**Architecture:** 플로우 에디터가 바뀐 비트만 dev 서버로 보내고, 서버는 메모리 오버레이에 병합해 웹소켓으로 방송한다. 게임은 `beats` 배열을 제자리에서 고친 뒤 `triggerRedraw()`만 부른다. `RunController`가 배열을 참조로 들고 있고 `draw()`가 매 렌더마다 문구를 다시 읽으므로 커서·게이지·덱이 그대로 유지된다.

**Tech Stack:** TypeScript · Vite dev 플러그인(`server.ws.send`) · PixiJS v8 · Vitest

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-08-08-beats-live-preview-design.md`
- 범위는 **문구만** — `textKey`, `left.label`, `right.label`, `left.hint`, `right.hint`. 게이지·분기·비트 추가/삭제는 다루지 않는다
- **dev 전용** — 프로덕션 빌드에 포함되지 않아야 한다. 클라이언트 코드는 `import.meta.hot` 가드 안에서만 동작한다
- 요청 본문은 반드시 `Buffer.concat(chunks).toString('utf8')`로 디코딩한다. 청크마다 `toString()`하면 한글이 깨진다 (`9356931`에서 고친 버그)
- 서버 오버레이는 **메모리에만** 둔다. dev 서버 재시작 시 소멸이 정상 동작이다
- 기존 ws 이벤트 명명 규칙을 따른다 — `server.ws.send({ type: 'custom', event, data })`
- 커밋 메시지는 한국어, `타입(범위): 요약` 형식

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/ui/beatsPreview.ts` (신규) | 오버레이 적용 순수 로직 + 게임 배선(ws 수신·배지) |
| `tests/beatsPreview.test.ts` (신규) | 오버레이 적용 규칙 검증 |
| `vite.config.ts` (수정) | `beatsPreviewPlugin` 추가, `beats` watch 제외, 저장 시 승격 방송 |
| `src/tools/flowEditor.ts` (수정) | 입력 디바운스 전송, 저장 안내 문구 |
| `src/main.ts` (수정) | 게임 부팅 시 프리뷰 초기화 1줄 |

---

## Task 1: 오버레이 적용 로직 (순수 함수)

렌더러 없이 테스트할 수 있는 핵심 규칙부터 만든다.

**Files:**
- Create: `src/ui/beatsPreview.ts`
- Test: `tests/beatsPreview.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type BeatTextPatch = { textKey?: string; left?: { label?: string; hint?: string }; right?: { label?: string; hint?: string } }`
  - `type BeatTextOverlay = Record<string, BeatTextPatch>`
  - `interface PreviewBeat { id: string; textKey: string; left: { label: string; hint?: string }; right: { label: string; hint?: string } }`
  - `type Baseline = Map<string, BeatSnapshot>`
  - `function applyOverlay(beats: PreviewBeat[], overlay: BeatTextOverlay, baseline: Baseline): void`
  - `function commitBaseline(baseline: Baseline): void`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/beatsPreview.test.ts`:

```ts
// tests/beatsPreview.test.ts — 대사 프리뷰 오버레이 적용 규칙
import { describe, it, expect } from "vitest";
import { applyOverlay, commitBaseline, type PreviewBeat, type Baseline } from "../src/ui/beatsPreview";

const mk = (): PreviewBeat[] => [
  { id: "b1", textKey: "원본 대사", left: { label: "좌" }, right: { label: "우", hint: "힌트" } },
  { id: "b2", textKey: "둘째", left: { label: "A" }, right: { label: "B" } },
];

describe("applyOverlay", () => {
  it("지정한 필드만 바꾸고 나머지는 원본을 유지한다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    applyOverlay(beats, { b1: { textKey: "고친 대사" } }, base);
    expect(beats[0]!.textKey).toBe("고친 대사");
    expect(beats[0]!.left.label).toBe("좌");
    expect(beats[0]!.right.hint).toBe("힌트");
    expect(beats[1]!.textKey).toBe("둘째");
  });

  it("좌우 라벨과 힌트도 덮어쓴다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    applyOverlay(beats, { b1: { left: { label: "새좌" }, right: { hint: "새힌트" } } }, base);
    expect(beats[0]!.left.label).toBe("새좌");
    expect(beats[0]!.right.label).toBe("우");
    expect(beats[0]!.right.hint).toBe("새힌트");
  });

  it("오버레이에서 필드가 빠지면 원본 문구로 되돌린다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    applyOverlay(beats, { b1: { textKey: "임시" } }, base);
    applyOverlay(beats, { b1: { left: { label: "좌2" } } }, base);
    expect(beats[0]!.textKey).toBe("원본 대사");
    expect(beats[0]!.left.label).toBe("좌2");
  });

  it("오버레이가 비면 전부 원본으로 돌아가고 기준값도 지워진다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    applyOverlay(beats, { b1: { textKey: "임시" } }, base);
    applyOverlay(beats, {}, base);
    expect(beats[0]!.textKey).toBe("원본 대사");
    expect(base.size).toBe(0);
  });

  it("없는 비트 id는 조용히 무시한다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    expect(() => applyOverlay(beats, { nope: { textKey: "x" } }, base)).not.toThrow();
    expect(beats[0]!.textKey).toBe("원본 대사");
  });

  it("같은 오버레이를 두 번 적용해도 결과가 같다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    applyOverlay(beats, { b1: { textKey: "임시" } }, base);
    applyOverlay(beats, { b1: { textKey: "임시" } }, base);
    expect(beats[0]!.textKey).toBe("임시");
    applyOverlay(beats, {}, base);
    expect(beats[0]!.textKey).toBe("원본 대사");
  });
});

describe("commitBaseline", () => {
  it("승격 후에는 오버레이를 비워도 적용된 문구가 유지된다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    applyOverlay(beats, { b1: { textKey: "저장된 대사" } }, base);
    commitBaseline(base);
    applyOverlay(beats, {}, base);
    expect(beats[0]!.textKey).toBe("저장된 대사");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run tests/beatsPreview.test.ts`
Expected: FAIL — `Failed to resolve import "../src/ui/beatsPreview"`

- [ ] **Step 3: 최소 구현**

`src/ui/beatsPreview.ts`:

```ts
// ui/beatsPreview.ts — 플로우 에디터의 미저장 대사를 실행 중인 게임에 반영한다 (dev 전용).
// beats 배열을 제자리에서 고치고 다시 그리기만 하므로 진행 상태(커서·게이지·덱)가 유지된다.

/** 한 비트에서 덮어쓸 문구. 없는 필드는 원본을 그대로 둔다. */
export interface BeatTextPatch {
  textKey?: string;
  left?: { label?: string; hint?: string };
  right?: { label?: string; hint?: string };
}
export type BeatTextOverlay = Record<string, BeatTextPatch>;

/** 이 모듈이 다루는 최소 형태 — engine의 Beat가 이 구조를 만족한다 */
export interface PreviewBeat {
  id: string;
  textKey: string;
  left: { label: string; hint?: string };
  right: { label: string; hint?: string };
}

interface BeatSnapshot {
  textKey: string;
  leftLabel: string;
  rightLabel: string;
  leftHint?: string;
  rightHint?: string;
}
/** 덮어쓰기 직전의 원본 문구 — 오버레이에서 빠진 필드를 되돌릴 때 쓴다 */
export type Baseline = Map<string, BeatSnapshot>;

const snap = (b: PreviewBeat): BeatSnapshot => ({
  textKey: b.textKey,
  leftLabel: b.left.label,
  rightLabel: b.right.label,
  leftHint: b.left.hint,
  rightHint: b.right.hint,
});

const setHint = (c: { hint?: string }, v: string | undefined): void => {
  if (v === undefined) delete c.hint;
  else c.hint = v;
};

/** 오버레이를 beats에 제자리 적용. 오버레이에 없는 필드는 기준값(원본)으로 되돌린다.
 *  같은 오버레이를 여러 번 적용해도 결과가 같다(멱등). */
export function applyOverlay(beats: PreviewBeat[], overlay: BeatTextOverlay, baseline: Baseline): void {
  for (const b of beats) {
    const patch = overlay[b.id];
    if (!patch) {
      const s = baseline.get(b.id);
      if (!s) continue;                       // 손댄 적 없는 비트
      b.textKey = s.textKey;
      b.left.label = s.leftLabel;
      b.right.label = s.rightLabel;
      setHint(b.left, s.leftHint);
      setHint(b.right, s.rightHint);
      baseline.delete(b.id);
      continue;
    }
    if (!baseline.has(b.id)) baseline.set(b.id, snap(b)); // 첫 덮어쓰기 직전 상태를 남긴다
    const s = baseline.get(b.id)!;
    b.textKey = patch.textKey ?? s.textKey;
    b.left.label = patch.left?.label ?? s.leftLabel;
    b.right.label = patch.right?.label ?? s.rightLabel;
    setHint(b.left, patch.left?.hint ?? s.leftHint);
    setHint(b.right, patch.right?.hint ?? s.rightHint);
  }
}

/** 저장 성공 — 지금 적용된 문구를 기준값으로 승격한다.
 *  기준값을 비우면 이후 오버레이가 비어도 되돌릴 대상이 없어 현재 문구가 유지된다. */
export function commitBaseline(baseline: Baseline): void {
  baseline.clear();
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/beatsPreview.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 타입체크 + 전체 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: 타입 오류 없음, 기존 120개 + 신규 7개 = 127개 통과

- [ ] **Step 6: 커밋**

```bash
git add src/ui/beatsPreview.ts tests/beatsPreview.test.ts
git commit -m "feat(preview): 대사 오버레이 적용 로직

오버레이에 담긴 필드만 beats에 제자리 적용하고, 빠진 필드는 덮어쓰기 직전
문구로 되돌린다. 저장 시에는 기준값을 비워 현재 문구를 승격한다."
```

---

## Task 2: dev 서버 — 오버레이 보관과 방송

**Files:**
- Modify: `vite.config.ts` (플러그인 추가 · `SAVE_TARGETS` 저장 후 처리 · `server.watch.ignored`)

**Interfaces:**
- Consumes: Task 1의 `BeatTextOverlay` 형태 (서버는 타입을 import하지 않고 같은 JSON 형태를 다룬다)
- Produces:
  - `POST /__beatspreview` — 부분 오버레이 병합 → ws `beats-preview` 방송, 본문 `{ overlay }`
  - `GET /__beatspreview` — `{ overlay }` 반환
  - `DELETE /__beatspreview` — 비우고 ws `beats-preview` 방송(빈 오버레이)
  - ws `beats-committed` — `/__beats` 저장 성공 시 방송, 데이터 없음

- [ ] **Step 1: 플러그인 추가**

`vite.config.ts`의 `editorSavePlugin` 정의 **바로 앞**에 넣는다.

```ts
// dev 편의: 플로우 에디터의 미저장 대사를 게임에 실시간 반영 (문구만).
// 저장 전 임시본이라 파일에 쓰지 않고 서버 메모리에만 둔다 — dev 서버를 재시작하면 사라진다.
// 설계: docs/superpowers/specs/2026-08-08-beats-live-preview-design.md
let beatsOverlay: Record<string, unknown> = {}

function beatsPreviewPlugin(): Plugin {
  return {
    name: 'beats-preview',
    configureServer(server) {
      server.middlewares.use('/__beatspreview', (req, res) => {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ overlay: beatsOverlay }))
          return
        }
        if (req.method === 'DELETE') {
          beatsOverlay = {}
          server.ws.send({ type: 'custom', event: 'beats-preview', data: { overlay: beatsOverlay } })
          res.end('ok')
          return
        }
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        // 청크를 모아 한 번에 디코딩 — 청크마다 toString()하면 한글(3바이트)이 경계에서 깨진다
        const chunks: Buffer[] = []
        req.on('data', (d: Buffer) => { chunks.push(d) })
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          try {
            const patch = JSON.parse(body) as Record<string, unknown>
            if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
              res.statusCode = 400; res.end('bad overlay'); return
            }
            for (const [id, v] of Object.entries(patch)) {
              if (v === null) delete beatsOverlay[id]   // null = 이 비트 되돌리기
              else beatsOverlay[id] = v
            }
            server.ws.send({ type: 'custom', event: 'beats-preview', data: { overlay: beatsOverlay } })
            res.end('ok')
          } catch { res.statusCode = 400; res.end('invalid json') }
        })
      })
    },
  }
}
```

- [ ] **Step 2: 저장 성공 시 승격 방송**

`editorSavePlugin` 안, 파일 기록 직후(`res.end('ok')` 앞)에 넣는다. 라우트가 `/__beats`일 때만 동작한다.

```ts
            if (route === '/__beats') {
              // 파일에 들어갔으니 임시본은 필요 없다. 게임은 이 신호를 받아
              // 지금 화면의 문구를 기준값으로 승격한다 (비우기만 하면 옛 문구로 되돌아간다).
              beatsOverlay = {}
              server.ws.send({ type: 'custom', event: 'beats-committed', data: {} })
            }
```

- [ ] **Step 3: 플러그인 등록**

`plugins:` 배열에서 `editorSavePlugin()` **앞**에 추가한다.

```ts
    beatsPreviewPlugin(),
    editorSavePlugin(),
```

- [ ] **Step 4: beats를 watch 제외에 추가**

`server.watch.ignored` 배열 마지막 줄 뒤에 추가한다.

```ts
        '**/src/data/beats/*.json', // 저장해도 게임을 리로드하지 않는다 — 반영은 프리뷰 채널이 담당
```

- [ ] **Step 5: 서버 동작 확인**

dev 서버가 떠 있는 상태에서:

```bash
curl -s -X POST http://127.0.0.1:5199/__beatspreview \
  -H 'Content-Type: application/json' \
  -d '{"d2_w0_disaster":{"textKey":"프리뷰 확인"}}'
curl -s http://127.0.0.1:5199/__beatspreview
curl -s -X DELETE http://127.0.0.1:5199/__beatspreview
curl -s http://127.0.0.1:5199/__beatspreview
```

Expected: `ok` → `{"overlay":{"d2_w0_disaster":{"textKey":"프리뷰 확인"}}}` → `ok` → `{"overlay":{}}`

한글이 깨지지 않는지 반드시 눈으로 확인한다.

- [ ] **Step 6: 타입체크 + 테스트 + 커밋**

Run: `npx tsc --noEmit && npm test`

```bash
git add vite.config.ts
git commit -m "feat(preview): dev 서버에 대사 오버레이 채널 추가

POST/GET/DELETE /__beatspreview 로 미저장 대사를 메모리에 모으고 ws로 방송한다.
/__beats 저장이 성공하면 오버레이를 비우고 beats-committed를 알린다.
beats 파일을 watch 제외에 넣어 저장해도 게임이 리로드되지 않게 했다."
```

---

## Task 3: 게임 클라이언트 배선과 표시등

**Files:**
- Modify: `src/ui/beatsPreview.ts` (Task 1 파일에 배선부 추가)
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: Task 1의 `applyOverlay` · `commitBaseline`, Task 2의 ws 이벤트
- Produces: `function initBeatsPreview(beats: PreviewBeat[]): void`

- [ ] **Step 1: 배선부 추가**

`src/ui/beatsPreview.ts` 맨 아래에 붙인다.

```ts
// ── 게임 배선 (dev 전용) ────────────────────────────────────────────
const baseline: Baseline = new Map();
let badge: HTMLDivElement | null = null;

function showBadge(n: number): void {
  if (n === 0) { badge?.remove(); badge = null; return; }
  if (!badge) {
    const el = document.createElement("div");
    el.style.cssText =
      "position:fixed;top:10px;right:10px;z-index:1200;background:#ff7fb0;color:#fff;" +
      "font:700 11px -apple-system,sans-serif;padding:5px 10px;border-radius:999px;cursor:pointer;" +
      "box-shadow:0 2px 8px rgba(0,0,0,.25)";
    el.title = "저장되지 않은 대사 수정 — 누르면 되돌립니다";
    el.onclick = () => { void fetch("/__beatspreview", { method: "DELETE" }); };
    document.body.appendChild(el);
    badge = el;
  }
  badge.textContent = `✎ 미저장 ${n}`;
}

/** 게임 부팅 시 1회. dev 서버가 아니면 아무 일도 하지 않는다. */
export function initBeatsPreview(beats: PreviewBeat[]): void {
  if (!import.meta.hot) return;
  const applyAndDraw = (overlay: BeatTextOverlay): void => {
    applyOverlay(beats, overlay, baseline);
    showBadge(Object.keys(overlay).length);
    void import("./editor").then((e) => e.triggerRedraw());
  };
  // 새로고침해도 미저장 임시본이 그대로 보이도록 현재 오버레이를 받아온다
  void fetch("/__beatspreview")
    .then((r) => r.json() as Promise<{ overlay: BeatTextOverlay }>)
    .then((d) => { if (Object.keys(d.overlay).length > 0) applyAndDraw(d.overlay); })
    .catch(() => {});
  import.meta.hot.on("beats-preview", (d: { overlay: BeatTextOverlay }) => { applyAndDraw(d.overlay); });
  import.meta.hot.on("beats-committed", () => {
    commitBaseline(baseline); // 화면 문구는 그대로 두고 배지만 내린다
    showBadge(0);
  });
}
```

- [ ] **Step 2: main.ts에서 초기화**

`src/main.ts`의 `onHotAssetUpdate(...)` 등록 **바로 뒤**에 추가한다. `beats`는 이미 `../data`에서 export되어 있다.

```ts
  initBeatsPreview(beats); // 플로우 에디터 미저장 대사 실시간 반영 (dev 전용)
```

import 두 줄을 파일 상단에 추가한다. `src/main.ts`에는 아직 `./data` import가 없으므로 둘 다 새로 넣는다.

```ts
import { beats } from "./data";
import { initBeatsPreview } from "./ui/beatsPreview";
```

- [ ] **Step 3: 타입체크 + 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: 오류 없음, 127개 통과

- [ ] **Step 4: 수동 확인 — 진행 상태 유지**

게임 탭을 열어 스토리 두어 장면 진행한 뒤, 터미널에서:

```bash
curl -s -X POST http://127.0.0.1:5199/__beatspreview \
  -H 'Content-Type: application/json' \
  -d '{"<현재 비트 id>":{"textKey":"실시간 반영 확인"}}'
```

Expected: 화면 대사가 즉시 바뀐다. **주차·게이지·덱이 그대로**이고 프롤로그로 돌아가지 않는다. 우상단에 `✎ 미저장 1` 배지가 뜬다.

배지를 누르면 원래 대사로 돌아가고 배지가 사라진다.

- [ ] **Step 5: 커밋**

```bash
git add src/ui/beatsPreview.ts src/main.ts
git commit -m "feat(preview): 게임에 대사 프리뷰 수신과 미저장 표시등 배선

부팅 시 현재 오버레이를 받아 적용하고, 이후 ws로 들어오는 변경을 제자리 반영한 뒤
다시 그린다. 저장 신호를 받으면 문구는 두고 기준값만 승격해 배지를 내린다."
```

---

## Task 4: 플로우 에디터 — 타이핑 전송

**Files:**
- Modify: `src/tools/flowEditor.ts`

**Interfaces:**
- Consumes: Task 2의 `POST /__beatspreview`
- Produces: 없음 (최종 사용자 진입점)

- [ ] **Step 1: 전송 함수 추가**

`save()` 함수 **바로 앞**에 넣는다.

```ts
// 타이핑 → 게임에 실시간 반영 (저장 아님). 문구만 보내고, 파일 기록은 💾가 담당한다.
let previewTimer = 0;
function sendPreview(): void {
  const bt = beats[sel];
  if (!bt) return;
  const patch = {
    [bt.id]: {
      textKey: bt.textKey,
      left: { label: bt.left.label, hint: bt.left.hint },
      right: { label: bt.right.label, hint: bt.right.hint },
    },
  };
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    previewTimer = 0;
    void fetch("/__beatspreview", { method: "POST", body: JSON.stringify(patch) }).catch(() => {});
  }, 300);
}
```

- [ ] **Step 2: 문구 입력에 연결**

`data-f` 입력 핸들러에서 문구 세 필드를 다룬 직후에 호출한다. 기존 코드의 이 부분을

```ts
      } else if (f === "textKey") bt.textKey = el.value;
      else if (f === "left.label") bt.left.label = el.value;
      else if (f === "right.label") bt.right.label = el.value;
      renderTimeline();
```

아래로 바꾼다.

```ts
      } else if (f === "textKey") { bt.textKey = el.value; sendPreview(); }
      else if (f === "left.label") { bt.left.label = el.value; sendPreview(); }
      else if (f === "right.label") { bt.right.label = el.value; sendPreview(); }
      renderTimeline();
```

- [ ] **Step 3: 저장 안내 문구 수정**

리로드가 없어졌으므로 기존 안내가 사실과 달라진다. `save()` 안의 성공 토스트를 바꾼다.

```ts
  if (res.ok) toast("💾 저장 완료 — 게임 화면은 그대로 유지됩니다");
```

- [ ] **Step 4: 타입체크 + 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: 오류 없음, 127개 통과

- [ ] **Step 5: 수동 확인 — 전체 흐름**

1. 게임 탭에서 스토리를 몇 장면 진행한다 (주차·게이지를 기억해 둔다)
2. 다른 탭에서 `/flow.html`을 열고 **현재 화면에 떠 있는 비트**의 대사를 고친다
3. 게임 탭 대사가 **0.3초 안에** 바뀌고 주차·게이지·덱이 그대로인지 확인
4. 아직 도달하지 않은 비트를 고친 뒤, 그 장면까지 진행해 수정본이 보이는지 확인
5. 💾 저장 → **새로고침이 일어나지 않고** 문구가 유지되며 배지만 사라지는지 확인
6. 게임 탭을 새로고침 → 저장한 문구가 그대로 보이는지 확인

- [ ] **Step 6: 커밋**

```bash
git add src/tools/flowEditor.ts
git commit -m "feat(preview): 플로우 에디터 타이핑을 게임에 실시간 전송

문구 입력에 300ms 디바운스를 걸어 편집 중인 비트만 보낸다.
저장은 지금처럼 💾가 파일에 기록하고, 이제 게임 리로드가 없다."
```

---

## Self-Review

**1. 스펙 커버리지**

| 스펙 요구 | 담당 |
|---|---|
| 저장 없이 실시간 반영 | Task 4 전송 → Task 2 방송 → Task 3 적용 |
| 진행 상태 유지 (새로고침·재시작 없음) | Task 3 (`triggerRedraw`) + Task 2 Step 4 (watch 제외) |
| 미도달 비트도 진입 시 최신본 | Task 1 — 오버레이가 `beats` 배열 전체에 적용됨 |
| 파일 기록은 저장 버튼만 | Task 2 (오버레이는 메모리) + Task 4 (💾만 `/__beats`) |
| 다른 기기 반영 | Task 2 (`server.ws.send` 전체 방송) |
| 새로고침해도 임시본 유지 | Task 3 Step 1 (부팅 시 `GET`) |
| 저장 시 승격 | Task 2 Step 2 + Task 3 (`commitBaseline`) |
| 표시등 `✎ 미저장 N` | Task 3 Step 1 |
| 되돌리기 | Task 3 (배지 클릭 → `DELETE`) |
| 프로덕션 미포함 | Task 3 (`if (!import.meta.hot) return`) |
| 없는 비트 id 무시 | Task 1 테스트 5 |
| dev 서버 재시작 시 소멸 | Task 2 (메모리 변수) |

빠진 요구 없음.

**2. 플레이스홀더 점검**

"적절히 처리", "TBD", "Task N과 유사" 없음. 모든 코드 단계에 실제 코드가 있다.

**3. 타입 일관성**

- `applyOverlay(beats, overlay, baseline)` — Task 1 정의, Task 3에서 같은 순서로 호출
- `commitBaseline(baseline)` — Task 1 정의, Task 3에서 호출
- `BeatTextOverlay` — Task 1 정의, Task 3 ws 핸들러 타입으로 사용
- ws 이벤트명 `beats-preview` / `beats-committed` — Task 2 발신, Task 3 수신에서 철자 일치
- 엔드포인트 `/__beatspreview` — Task 2·3·4에서 동일

**주의 1** — `PreviewBeat`는 engine의 `Beat`보다 좁은 구조다. `Beat`가 이 형태를 만족하므로 `initBeatsPreview(beats)` 호출이 타입 오류 없이 통과한다. Task 3 Step 3에서 확인한다.

**주의 2** — 플로우 에디터는 현재 `hint` 입력칸이 없다. Task 4는 `bt.left.hint`를 그대로 실어 보내므로 값이 바뀌지 않을 뿐, 동작에 문제는 없다. 나중에 힌트 편집을 추가하면 전송이 자동으로 따라온다.
