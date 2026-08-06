# UI 스킨 에디터 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5개 화면 22개 UI 컴포넌트 슬롯에 이미지 스킨을 업로드하는 전체화면 에디터(ui.html)와, 스킨 유무에 따라 벡터↔이미지를 전환하는 런타임을 만든다.

**Architecture:** `src/data/uiskins.json` = 슬롯 SSOT. `src/ui/uiSkin.ts`가 로딩(전 슬롯 tryLoad)과 `skinNode(id,w,h)`(9slice/stretch)를 제공, 각 컴포넌트는 `skinNode(...) ?? 기존 Graphics` 폴백 패턴. 업로드는 기존 bg 업로드 플러그인을 공용 팩토리로 리팩터해 `/__skinupload` 추가. 스펙: `docs/superpowers/specs/2026-07-28-ui-skin-editor-design.md`

**Tech Stack:** TypeScript + PixiJS v8 (NineSliceSprite) + Vite 플러그인 + Vitest.

## Global Constraints

- git 레포 미생성 — 커밋 단계 없음. 빌드는 Director 요청 시에만.
- 주석 한국어·식별자 영어. 작업 디렉토리 `debut-loop`.
- ui.html은 dev 전용(rollup input 미등록). 업로드 png/jpg/webp · 10MB.
- **스킨 미업로드 슬롯은 기존 벡터와 100% 동일 렌더** — 모든 터치포인트는 폴백 필수.
- 실행자 주의: 아래 터치포인트 코드는 앵커 라인 기준 — 지역 변수명이 다르면 해당 파일의 실제 이름에 맞춰 적용.

---

### Task 1: 슬롯 SSOT + 런타임 (`uiskins.json` / `uiSkin.ts` / assets 배선)

**Files:**
- Create: `src/data/uiskins.json`, `src/ui/uiSkin.ts`
- Modify: `src/ui/assets.ts` (loadGameAssets에서 loadUiSkins 호출 + 진행률)
- Test: `tests/uiskins.test.ts`
- Create dir: `public/assets/ui/` (`.gitkeep`)

**Interfaces:**
- Produces: `loadUiSkins(onTick?): Promise<void>`, `skinNode(id: string, w: number, h: number): Container | null`,
  `uiSkinScreens: UiSkinScreen[]` (`{id,label,slots:[{id,label,file,size:[w,h],mode:"stretch"|"9slice",slice?}]}`), `allUiSkinSlots()`

- [ ] **Step 1: uiskins.json 생성** (22슬롯 — 실측 치수)

```json
{
  "_note": "UI 스킨 슬롯 SSOT — ui.html 에디터가 읽음. 이미지가 있으면 skinNode가 교체, 없으면 기존 벡터.",
  "screens": [
    { "id": "lobby", "label": "메인 로비", "slots": [
      { "id": "lobby-start", "label": "START 원형 버튼", "file": "assets/ui/lobby-start.png", "size": [128, 128], "mode": "stretch" },
      { "id": "lobby-icon-daily", "label": "사이드 아이콘 · 데일리", "file": "assets/ui/lobby-icon-daily.png", "size": [48, 48], "mode": "stretch" },
      { "id": "lobby-icon-album", "label": "사이드 아이콘 · 앨범", "file": "assets/ui/lobby-icon-album.png", "size": [48, 48], "mode": "stretch" },
      { "id": "lobby-icon-shop", "label": "사이드 아이콘 · 상점", "file": "assets/ui/lobby-icon-shop.png", "size": [48, 48], "mode": "stretch" },
      { "id": "lobby-icon-settings", "label": "사이드 아이콘 · 설정", "file": "assets/ui/lobby-icon-settings.png", "size": [48, 48], "mode": "stretch" },
      { "id": "lobby-deck-banner", "label": "하단 카드덱 곡선 배너", "file": "assets/ui/lobby-deck-banner.png", "size": [430, 230], "mode": "stretch" }
    ] },
    { "id": "game", "label": "본게임 (스토리)", "slots": [
      { "id": "game-gauge-frame", "label": "게이지 패널 프레임", "file": "assets/ui/game-gauge-frame.png", "size": [344, 140], "mode": "9slice", "slice": 20 },
      { "id": "game-gauge-fill", "label": "게이지 바 채움 (가변 폭)", "file": "assets/ui/game-gauge-fill.png", "size": [200, 10], "mode": "stretch" },
      { "id": "game-card-frame", "label": "스와이프 카드 프레임", "file": "assets/ui/game-card-frame.png", "size": [394, 460], "mode": "9slice", "slice": 24 },
      { "id": "game-btn-left", "label": "좌 선택 버튼", "file": "assets/ui/game-btn-left.png", "size": [178, 60], "mode": "9slice", "slice": 16 },
      { "id": "game-btn-right", "label": "우 선택 버튼", "file": "assets/ui/game-btn-right.png", "size": [178, 60], "mode": "9slice", "slice": 16 },
      { "id": "game-back", "label": "← 로비 버튼", "file": "assets/ui/game-back.png", "size": [66, 26], "mode": "9slice", "slice": 12 }
    ] },
    { "id": "training", "label": "연습하기", "slots": [
      { "id": "train-panel", "label": "보드 패널 프레임", "file": "assets/ui/train-panel.png", "size": [394, 560], "mode": "9slice", "slice": 20 },
      { "id": "train-row", "label": "활동 행 배경", "file": "assets/ui/train-row.png", "size": [166, 70], "mode": "9slice", "slice": 14 },
      { "id": "train-skip", "label": "건너뛰기 배경", "file": "assets/ui/train-skip.png", "size": [166, 28], "mode": "9slice", "slice": 12 }
    ] },
    { "id": "gate", "label": "관문 (유형별 막 게임)", "slots": [
      { "id": "gate-panel", "label": "관문 패널 프레임 (배경 이미지 없을 때)", "file": "assets/ui/gate-panel.png", "size": [394, 600], "mode": "9slice", "slice": 24 },
      { "id": "gate-btn", "label": "공용 버튼 (전 관문 일괄)", "file": "assets/ui/gate-btn.png", "size": [200, 52], "mode": "9slice", "slice": 16 },
      { "id": "gate-note-left", "label": "리듬 노트 · 좌 (🎤 대체)", "file": "assets/ui/gate-note-left.png", "size": [44, 44], "mode": "stretch" },
      { "id": "gate-note-right", "label": "리듬 노트 · 우 (💃 대체)", "file": "assets/ui/gate-note-right.png", "size": [44, 44], "mode": "stretch" },
      { "id": "gate-dodge-tile", "label": "격자 타일", "file": "assets/ui/gate-dodge-tile.png", "size": [56, 56], "mode": "9slice", "slice": 10 }
    ] },
    { "id": "deck", "label": "카드덱", "slots": [
      { "id": "deck-sheet", "label": "덱 시트 헤더(핸들 포함)", "file": "assets/ui/deck-sheet.png", "size": [430, 60], "mode": "9slice", "slice": 18 },
      { "id": "deck-card", "label": "카드 아이템 프레임", "file": "assets/ui/deck-card.png", "size": [82, 138], "mode": "9slice", "slice": 12 }
    ] }
  ]
}
```

- [ ] **Step 2: 실패하는 테스트** — `tests/uiskins.test.ts` (pixi 임포트 없이 json만 검증 — vitest node 환경 안전):

```ts
// tests/uiskins.test.ts — UI 스킨 슬롯 SSOT 정합성 (Lv.6)
import { describe, it, expect } from "vitest";
import uiskins from "../src/data/uiskins.json";

interface Slot { id: string; label: string; file: string; size: [number, number]; mode: string; slice?: number }
const screens = (uiskins as unknown as { screens: Array<{ id: string; slots: Slot[] }> }).screens;
const all = screens.flatMap((s) => s.slots);

describe("uiskins.json", () => {
  it("5화면 · 22슬롯", () => {
    expect(screens.length).toBe(5);
    expect(all.length).toBe(22);
  });
  it("id 유일 + 파일 규약(assets/ui/<id>.*)", () => {
    expect(new Set(all.map((s) => s.id)).size).toBe(22);
    for (const s of all) expect(s.file.startsWith(`assets/ui/${s.id}.`)).toBe(true);
  });
  it("mode 유효 + 9slice는 slice 지정", () => {
    for (const s of all) {
      expect(["stretch", "9slice"]).toContain(s.mode);
      if (s.mode === "9slice") expect(s.slice).toBeGreaterThan(0);
      expect(s.size[0]).toBeGreaterThan(0);
      expect(s.size[1]).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: 실패 확인** — Run: `npx vitest run tests/uiskins.test.ts` / Expected: FAIL(json 없음) → Step 1 이후엔 PASS이므로 json 생성 전에 실행

- [ ] **Step 4: uiSkin.ts 구현**

```ts
// ui/uiSkin.ts — UI 컴포넌트 스킨: uiskins.json 슬롯에 이미지가 있으면 Sprite/NineSlice로 교체 (ui.html 에디터로 업로드).
import { Assets, Container, NineSliceSprite, Sprite, Texture } from "pixi.js";
import uiskinsJson from "../data/uiskins.json";

export interface UiSkinSlot { id: string; label: string; file: string; size: [number, number]; mode: "stretch" | "9slice"; slice?: number }
export interface UiSkinScreen { id: string; label: string; slots: UiSkinSlot[] }
export const uiSkinScreens = (uiskinsJson as unknown as { screens: UiSkinScreen[] }).screens;
export const allUiSkinSlots = (): UiSkinSlot[] => uiSkinScreens.flatMap((s) => s.slots);

const loaded = new Map<string, { tex: Texture; slot: UiSkinSlot }>();

/** 게임 에셋 로딩 시 1회 — 스킨 파일 시도 로드 (미업로드는 스킵 → 벡터 폴백) */
export async function loadUiSkins(onTick?: () => void): Promise<void> {
  for (const slot of allUiSkinSlots()) {
    try {
      loaded.set(slot.id, { tex: await Assets.load<Texture>(slot.file), slot });
    } catch { /* 미업로드 슬롯 */ }
    onTick?.();
  }
}

/** 스킨 노드: 업로드된 스킨이 있으면 크기 맞춘 노드, 없으면 null(호출측이 기존 Graphics 유지) */
export function skinNode(id: string, w: number, h: number): Container | null {
  const hit = loaded.get(id);
  if (!hit) return null;
  if (hit.slot.mode === "9slice") {
    const b = hit.slot.slice ?? 16;
    return new NineSliceSprite({ texture: hit.tex, leftWidth: b, rightWidth: b, topWidth: b, bottomWidth: b, width: w, height: h });
  }
  const s = new Sprite(hit.tex);
  s.width = w;
  s.height = h;
  return s;
}
```

- [ ] **Step 5: assets.ts 배선** — import `{ loadUiSkins, allUiSkinSlots } from "./uiSkin"`, `loadGameAssets`의 total에 `+ allUiSkinSlots().length`, 관문 슬롯 로드 뒤에 `await loadUiSkins(tick);`

- [ ] **Step 6: 디렉토리 + 게이트** — `mkdir -p public/assets/ui && touch public/assets/ui/.gitkeep`, Run: `npx tsc --noEmit && npx vitest run` / Expected: 에러 0, 전체 PASS

---

### Task 2: vite 업로드 플러그인 공용화 (`/__skinupload`)

**Files:**
- Modify: `vite.config.ts` (bgUploadPlugin → imageUploadPlugin 팩토리)

**Interfaces:**
- Produces: `POST /__skinupload?slot=<id>&ext=<png|jpg|webp>` → `public/assets/ui/<slot>.<ext>` + uiskins.json file 갱신. 기존 `/__bgupload` 동작 불변. SAVE_TARGETS에 `/__uiskins` 추가.

- [ ] **Step 1: 팩토리로 리팩터** — 기존 `bgUploadPlugin` 본문을 일반화:

```ts
// 개발용: 에디터 이미지 업로드 팩토리 — public/<dir>/ 기록 + 매니페스트 file 갱신
const IMG_EXTS = ['png', 'jpg', 'webp']
function imageUploadPlugin(route: string, manifestFile: string, dir: string,
  collect: (m: unknown) => Array<{ id: string; file: string }>): Plugin {
  return {
    name: `img-upload:${route}`,
    configureServer(server) {
      server.middlewares.use(route, (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        const q = new URL(req.url ?? '/', 'http://localhost').searchParams
        const slot = q.get('slot') ?? ''
        const ext = q.get('ext') ?? ''
        // slot id 형식 + 확장자 화이트리스트 — 경로는 서버가 조립(클라이언트 경로 입력 없음 → 탈출 차단)
        if (!/^[a-z0-9-]+$/.test(slot) || !IMG_EXTS.includes(ext)) { res.statusCode = 400; res.end('bad params'); return }
        const manifestPath = path.resolve(process.cwd(), manifestFile)
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown
        const entry = collect(manifest).find((s) => s.id === slot)
        if (!entry) { res.statusCode = 400; res.end('unknown slot'); return }
        const chunks: Buffer[] = []
        let size = 0
        req.on('data', (d: Buffer) => {
          size += d.length
          if (size > 10 * 1024 * 1024) { res.statusCode = 413; res.end('too large'); req.destroy(); return }
          chunks.push(d)
        })
        req.on('end', () => {
          if (res.writableEnded) return
          const rel = `${dir}/${slot}.${ext}`
          fs.writeFileSync(path.resolve(process.cwd(), 'public', rel), Buffer.concat(chunks))
          for (const e of IMG_EXTS) { // 같은 슬롯의 다른 확장자 잔재 제거
            if (e === ext) continue
            const p = path.resolve(process.cwd(), `public/${dir}/${slot}.${e}`)
            if (fs.existsSync(p)) fs.unlinkSync(p)
          }
          if (entry.file !== rel) { entry.file = rel; fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n') }
          res.end('ok')
        })
      })
    },
  }
}
type BgManifest = Record<'story' | 'gates' | 'system', Array<{ id: string; file: string }>>
type UiManifest = { screens: Array<{ slots: Array<{ id: string; file: string }> }> }
```

plugins 등록 교체:

```ts
  plugins: [
    editorSavePlugin(),
    imageUploadPlugin('/__bgupload', 'src/data/backgrounds.json', 'assets/bg',
      (m) => { const b = m as BgManifest; return [...b.story, ...b.gates, ...b.system] }),
    imageUploadPlugin('/__skinupload', 'src/data/uiskins.json', 'assets/ui',
      (m) => (m as UiManifest).screens.flatMap((s) => s.slots)),
  ],
```

기존 `bgUploadPlugin` 함수·`BG_EXTS`는 삭제. SAVE_TARGETS에 `'/__uiskins': 'src/data/uiskins.json',` 추가.

- [ ] **Step 2: 검증** — dev 서버 재시작 후:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:5174/__skinupload?slot=nope&ext=png" --data-binary @/dev/null   # 400
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:5174/__bgupload?slot=nope&ext=png" --data-binary @/dev/null     # 400 (기존 라우트 회귀 확인)
npx tsc --noEmit
```

---

### Task 3: 터치포인트 A — 메인 로비 (boot.ts, 6슬롯)

**Files:**
- Modify: `src/ui/boot.ts` (import `{ skinNode } from "./uiSkin"`)

- [ ] **Step 1: START 원형 버튼** (504행 부근, `cta.addChild(circle×2)`):

```ts
    const ctaSkin = skinNode("lobby-start", 128, 128);
    if (ctaSkin) {
      ctaSkin.x = -64;
      ctaSkin.y = -64;
      cta.addChild(ctaSkin);
    } else {
      cta.addChild(
        new Graphics().circle(0, 0, 64).fill(0xff7fb0).stroke({ width: 4, color: 0xffffff }),
        new Graphics().circle(0, 0, 64).stroke({ width: 1.5, color: 0xffd9e9 }),
      );
    }
```

- [ ] **Step 2: 사이드 아이콘 4개** — `ico()` 헬퍼(339행 부근) 원 Graphics 교체 (name: lobby_daily → 슬롯 lobby-icon-daily 규칙):

```ts
      const icoSkin = skinNode(name.replace("lobby_", "lobby-icon-"), 48, 48);
      b.addChild(icoSkin ?? new Graphics().circle(24, 24, 24).fill({ color: 0xffffff, alpha: 0.95 }).stroke({ width: 2, color: 0xece4f4 }));
```

스킨이 있으면 이모지는 겹치므로 `if (!icoSkin) b.addChild(e);` 로 이모지만 조건부(라벨 l은 유지).

- [ ] **Step 3: 하단 카드덱 곡선 배너** (362-370행, sheet 장식):

```ts
    const bannerSkin = skinNode("lobby-deck-banner", W, 230);
    if (bannerSkin) {
      bannerSkin.y = H - 90;
      sheet.addChild(bodyRect, bannerSkin);
    } else {
      sheet.addChild(curveShadow, bodyRect, trim, curve);
    }
```

- [ ] **Step 4: 게이트** — `npx tsc --noEmit && npx vitest run` 에러 0 + dev에서 로비가 기존과 동일(스킨 없음)한지 확인

---

### Task 4: 터치포인트 B — 본게임 (gaugeBar 2 · swipeCard 3 · app 1)

**Files:**
- Modify: `src/ui/gaugeBar.ts`, `src/ui/swipeCard.ts`, `src/ui/app.ts` (각각 `import { skinNode } from "./uiSkin";`)

- [ ] **Step 1: 게이지 패널 프레임** — gaugeBar.ts 49행 부근 패널 bg:

```ts
  const panelH = GAUGES.length * ROW_H + 30;
  const frameSkin = skinNode("game-gauge-frame", 344, panelH);
  if (frameSkin) {
    frameSkin.x = -14;
    frameSkin.y = -10;
    <패널 컨테이너>.addChild(frameSkin);
  } else {
    <기존 roundRect(-14, -10, 344, panelH, 14) Graphics 추가>
  }
```

- [ ] **Step 2: 게이지 바 채움** — drawRows의 fill 생성부(72행 부근):

```ts
      const fw = Math.max(2, (200 * v) / 100);
      const fillSkin = skinNode("game-gauge-fill", fw, 10);
      if (fillSkin) { fillSkin.x = 48; fillSkin.y = y + 2; }
      const fill = fillSkin ?? new Graphics().roundRect(48, y + 2, fw, 10, 5).fill(color);
```

(트랙 bg는 유지 — 채움만 스킨. fill을 참조하는 후속 코드는 Container 타입으로 수용)

- [ ] **Step 3: 카드 프레임 + 좌/우 버튼** — swipeCard.ts:

```ts
  const frame = skinNode("game-card-frame", CARD_W, H);
  const bg = frame ?? new Graphics().roundRect(0, 0, CARD_W, H, 24).fill(0xffffff).stroke({ width: 2, color: 0xece4f4 });
  card.addChild(bg);
```

`mkBtn` 내부(72행 부근):

```ts
    const btnSkin = skinNode(dir === "left" ? "game-btn-left" : "game-btn-right", 178, 60);
    const g = btnSkin ?? new Graphics().roundRect(0, 0, 178, 60, 16).fill(color, seen ? 0.6 : 1);
    b.addChild(g);
```

- [ ] **Step 4: ← 로비 버튼** — app.ts drawBackBtn:

```ts
    const backSkin = skinNode("game-back", 66, 26);
    const g = backSkin ?? new Graphics().roundRect(0, 0, 66, 26, 13).fill(0xf3ecfa).stroke({ width: 1.5, color: 0xe4d8f0 });
```

- [ ] **Step 5: 게이트** — `npx tsc --noEmit && npx vitest run` 에러 0

---

### Task 5: 터치포인트 C — 연습 3 · 관문 5 · 카드덱 2

**Files:**
- Modify: `src/ui/training.ts`, `src/ui/minigames.ts`, `src/ui/deckSheet.ts`

- [ ] **Step 1: 연습 보드** — training.ts: 패널 bg(70-71행, 이중 roundRect):

```ts
  const panelSkin = skinNode("train-panel", W, H);
  const bg = panelSkin ?? new Graphics()
    .roundRect(0, 0, W, H, 20).fill(0xffffff).stroke({ width: 3, color: GOLD })
    .roundRect(4, 4, W - 8, H - 8, 16).stroke({ width: 2, color: 0xf6e3bb });
```

활동 행(140행 부근): `const rowSkin = skinNode("train-row", 166, 70); const rbg = rowSkin ?? new Graphics().roundRect(0, 0, 166, 70, 12).fill(...).stroke(...);`
건너뛰기(162행 부근): skip Text 앞에 배경 삽입:

```ts
    const skipBg = skinNode("train-skip", 166, 28);
    if (skipBg) { skipBg.x = 218; skipBg.y = 8 + ACTIVITIES.length * 76; body.addChild(skipBg); }
```

- [ ] **Step 2: 관문** — minigames.ts:
  - `btn()` 헬퍼(34행): `const skin = skinNode("gate-btn", w, 52); const g = skin ?? new Graphics().roundRect(0, 0, w, 52, 14).fill(color);`
  - 관문 패널 흰 배경(renderGate의 bgTex 폴백 분기): bgTex 없을 때 `skinNode("gate-panel", MG_W, MG_H) ?? 기존 흰 roundRect`
  - 리듬 노트(462행): `RNote.el` 타입을 `Text` → `Container`로 넓히고:

```ts
        const noteSkin = skinNode(n2.lane === 0 ? "gate-note-left" : "gate-note-right", 44, 44);
        const el = noteSkin ?? txt(n2.lane === 0 ? "🎤" : "💃", 30, INK);
```

  - 격자 타일(519행 부근): 셀 생성 시 스킨을 밑에 깔고 상태색 Graphics는 반투명 오버레이로:

```ts
        const tileSkin = skinNode("gate-dodge-tile", CELL, CELL);
        if (tileSkin) { tileSkin.x = x; tileSkin.y = y; <셀 부모>.addChild(tileSkin); cellG.alpha = 0.45; }
```

- [ ] **Step 3: 카드덱** — deckSheet.ts: 핸들(35행): `skinNode("deck-sheet", SCREEN_W, HANDLE_H + 24) ?? 기존 handle Graphics` (grab 막대는 스킨 있으면 생략). 카드(77행): `skinNode("deck-card", cw, 138) ?? 기존 bg Graphics`.

- [ ] **Step 4: 게이트** — `npx tsc --noEmit && npx vitest run` 에러 0 + dev에서 연습/관문/덱 화면이 기존과 동일한지 확인

---

### Task 6: 에디터 페이지 (`ui.html` + `src/tools/uiEditor.ts`)

**Files:**
- Create: `ui.html` (flow.html 패턴, `#ui-editor` + `/src/tools/uiEditor.ts`)
- Create: `src/tools/uiEditor.ts`

- [ ] **Step 1: ui.html** — bg.html과 동일 구조, title "UI 스킨 에디터 — Debut Loop!", div id="ui-editor".

- [ ] **Step 2: uiEditor.ts** — 화면별 대형 섹션 + 큰 슬롯 카드(≈280px), 체커보드 미리보기:

```ts
// tools/uiEditor.ts — UI 스킨 에디터 (dev 전용, ui.html). 화면별 섹션 + 슬롯 카드, 업로드 → /__skinupload.
import { uiSkinScreens, type UiSkinSlot } from "../ui/uiSkin";

const root = document.getElementById("ui-editor")!;
root.innerHTML = `
  <div style="font:14px -apple-system,sans-serif;color:#e8def4;padding:22px 28px;max-width:1560px;margin:0 auto">
    <h1 style="margin:0 0 4px;font-size:19px">🎛 UI 스킨 에디터</h1>
    <p style="margin:0 0 8px;font-size:12px;color:#a08cc0">카드 클릭/드롭 = 업로드 (png/jpg/webp · 10MB) · 업로드 즉시 게임 반영 · 스킨 없는 슬롯은 기존 벡터 유지</p>
    <div id="sections"></div>
  </div>`;
const sections = document.getElementById("sections")!;

const upload = async (id: string, file: File, cell: HTMLElement): Promise<void> => {
  const ext = (file.name.split(".").pop()?.toLowerCase() ?? "") === "jpeg" ? "jpg" : (file.name.split(".").pop()?.toLowerCase() ?? "");
  if (!["png", "jpg", "webp"].includes(ext)) { alert("png/jpg/webp만 가능합니다"); return; }
  if (file.size > 10 * 1024 * 1024) { alert("10MB 이하만 가능합니다"); return; }
  cell.style.opacity = "0.5";
  const r = await fetch(`/__skinupload?slot=${id}&ext=${ext}`, { method: "POST", body: file });
  if (!r.ok) { alert(`업로드 실패: ${await r.text()}`); cell.style.opacity = "1"; return; }
  location.reload();
};

// 투명 PNG 확인용 체커보드
const CHECKER = "background-image:linear-gradient(45deg,#2c1b45 25%,transparent 25%),linear-gradient(-45deg,#2c1b45 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2c1b45 75%),linear-gradient(-45deg,transparent 75%,#2c1b45 75%);background-size:18px 18px;background-position:0 0,0 9px,9px -9px,-9px 0;background-color:#241539";

const mkCell = (slot: UiSkinSlot): HTMLElement => {
  const cell = document.createElement("div");
  cell.style.cssText = "background:#241539;border:2px solid #3a2555;border-radius:14px;overflow:hidden;cursor:pointer";
  const meta = `${slot.size[0]}×${slot.size[1]} · ${slot.mode}${slot.mode === "9slice" ? ` (slice ${slot.slice})` : ""}`;
  cell.innerHTML = `
    <div style="position:relative;height:170px;${CHECKER};display:flex;align-items:center;justify-content:center">
      <img src="/${slot.file}?v=${Date.now()}" style="max-width:88%;max-height:88%;object-fit:contain" />
      <span style="position:absolute;display:none;color:#5f4a80;font-size:12px">미업로드 — 클릭해서 추가</span>
    </div>
    <div style="padding:10px 14px">
      <div style="font-weight:800;font-size:13.5px">${slot.label}</div>
      <div style="font-size:11px;color:#8a76a8;margin-top:3px">${meta} · ${slot.file.split("/").pop()}</div>
    </div>`;
  const img = cell.querySelector("img")!;
  const empty = cell.querySelector("span") as HTMLElement;
  img.onerror = () => { img.style.display = "none"; empty.style.display = "block"; };
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp";
  input.style.display = "none";
  input.onchange = () => { if (input.files?.[0]) void upload(slot.id, input.files[0], cell); };
  cell.appendChild(input);
  cell.onclick = () => input.click();
  cell.ondragover = (e) => { e.preventDefault(); cell.style.borderColor = "#ff7fb0"; };
  cell.ondragleave = () => { cell.style.borderColor = "#3a2555"; };
  cell.ondrop = (e) => {
    e.preventDefault();
    cell.style.borderColor = "#3a2555";
    const f = e.dataTransfer?.files?.[0];
    if (f) void upload(slot.id, f, cell);
  };
  return cell;
};

for (const screen of uiSkinScreens) {
  const sec = document.createElement("div");
  sec.innerHTML = `<h2 style="margin:26px 0 10px;font-size:15px;border-bottom:2px solid #3a2555;padding-bottom:8px">📱 ${screen.label} <small style="color:#8a76a8;font-weight:400">· ${screen.slots.length}개 컴포넌트</small></h2>`;
  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px";
  for (const slot of screen.slots) grid.appendChild(mkCell(slot));
  sec.appendChild(grid);
  sections.appendChild(sec);
}
```

주의: uiEditor는 `../ui/uiSkin`을 임포트하는데 uiSkin이 pixi를 임포트 — 에디터 페이지에서도 동작하지만 무거움. **uiSkin.ts에서 매니페스트 접근(uiSkinScreens·타입)과 pixi 의존(skinNode)을 같은 파일에 두되, 트리셰이킹이 안 되면 에디터 로드가 느려질 뿐 동작엔 문제 없음** — 허용.

- [ ] **Step 3: 게이트** — `npx tsc --noEmit` 에러 0 + `http://localhost:5174/ui.html`에서 5섹션·22카드 렌더 확인 (playwright 스크린샷)

---

### Task 7: 통합 검증

- [ ] **Step 1: 전체 게이트** — `npx tsc --noEmit && npx vitest run` / Expected: 에러 0, 전체 PASS

- [ ] **Step 2: E2E** (scratchpad 스크립트): PIL로 색상 사각형 스킨 생성(예: 노랑 START 128×128, 민트 gate-btn 200×52, 핑크 game-card-frame 394×460) → `/__skinupload`로 업로드 → 게임 진입 스크린샷으로 로비 START·본게임 카드·관문 버튼에 스킨 적용 확인 → **테스트 스킨 삭제 + uiskins.json 원복**

- [ ] **Step 3: 결과 보고** — Post-Implementation Report + ui.html 사용법. 빌드는 요청 대기.
