// ui/editor.ts — 개발용 레이아웃 에디터. 치트 메뉴에서 토글.
// 켜면: 화면 최상단에 투명 실드를 깔아 게임 입력을 차단하고, 등록된 컴포넌트를
// 드래그로 이동(겹치면 더 작은 컴포넌트 우선) + 패널에서 x/y 직접 입력 + layout.json 저장.
// 등록(editable)은 에디터 꺼짐 상태에서도 항상 기록 — 켜는 순간 리드로우 없이도 전 항목 편집 가능.
import { Graphics, type Container, type FederatedPointerEvent } from "pixi.js";
import { setPos, allPos } from "./layout";
import { BASE_W, stageTop, stageHeight } from "./stage";

let on = new URLSearchParams(location.search).has("editor");
let redraw: () => void = () => {};
const visible = new Map<string, Container>();

export const editorEnabled = (): boolean => on;

// 토글 훅: 화면이 전체 리드로우 대신 자체 처리(게임 일시정지 등)할 때 등록 — true 반환 시 redraw 생략
let toggleHook: ((on: boolean) => boolean) | null = null;
export function setEditorToggleHook(fn: ((on: boolean) => boolean) | null): void {
  toggleHook = fn;
}

export function setEditorMode(next: boolean): void {
  on = next;
  panelEl().style.display = on ? "block" : "none";
  const handled = toggleHook?.(next) ?? false;
  if (!handled) redraw();
  if (on) { mountShield(); refreshPanel(); }
  else unmountShield();
}

export function onRedraw(fn: () => void): void {
  redraw = fn;
}

// 리드로우 훅: 팝업(연습 보드 등)이 열려 있으면 전체 화면 대신 그 화면만 다시 그린다.
// 없으면 배율·농도 변경 때마다 게임 화면이 새로 그려져 팝업이 닫혀버린다.
let redrawHook: (() => void) | null = null;
export function setRedrawHook(fn: (() => void) | null): void {
  redrawHook = fn;
}

/** 현재 화면 재렌더 트리거 — 치트 등 외부에서 상태 변경 후 호출 (게임=draw, 로비=build) */
export function triggerRedraw(): void {
  (redrawHook ?? redraw)();
}

/** 매 draw 시작 시 호출 — 현재 화면의 등록 목록 초기화 */
export function beginFrame(): void {
  visible.clear();
}

/** 컴포넌트를 에디터 대상으로 등록 — 항상 기록하고, 에디터 켜짐이면 실드 최상단 유지 + 패널 갱신 */
export function editable(name: string, c: Container): void {
  visible.set(name, c);
  if (on) { mountShield(); refreshPanel(); }
}

// ── 실드: 전화면 투명 레이어 — 게임 입력 차단 + 드래그 처리 (끄면 제거 = 원상복구) ──
let shield: Graphics | null = null;

function mountShield(): void {
  const first = [...visible.values()].find((c) => !c.destroyed && c.parent);
  if (!first) return;
  let root: Container = first;
  while (root.parent) root = root.parent as Container;
  if (shield && shield.parent === root) { root.addChild(shield); return; } // 새 화면 요소 위로 재부상
  unmountShield();
  const g = new Graphics().rect(0, stageTop(), BASE_W, stageHeight()).fill({ color: 0xffffff, alpha: 0.001 });
  g.eventMode = "static";
  g.cursor = "move";
  let target: { name: string; c: Container } | null = null;
  let sx = 0, sy = 0, ox = 0, oy = 0;
  g.on("pointerdown", (e: FederatedPointerEvent) => {
    // 포인트를 포함하는 가장 작은 등록 컴포넌트 선택 (겹침 = 안쪽/작은 것 우선)
    let best: { name: string; c: Container; area: number } | null = null;
    for (const [name, c] of visible) {
      if (c.destroyed || !c.parent) continue;
      const b = c.getBounds();
      if (b.width <= 0 || b.height <= 0) continue;
      if (e.globalX < b.x || e.globalX > b.x + b.width || e.globalY < b.y || e.globalY > b.y + b.height) continue;
      const area = b.width * b.height;
      if (!best || area < best.area) best = { name, c, area };
    }
    target = best;
    if (!best) return;
    sx = e.globalX;
    sy = e.globalY;
    ox = best.c.x;
    oy = best.c.y;
  });
  g.on("globalpointermove", (e: FederatedPointerEvent) => {
    if (!target) return;
    target.c.x = ox + (e.globalX - sx);
    target.c.y = oy + (e.globalY - sy);
    setPos(target.name, { x: Math.round(target.c.x), y: Math.round(target.c.y) });
    refreshPanel();
  });
  const up = (): void => { target = null; };
  g.on("pointerup", up);
  g.on("pointerupoutside", up);
  root.addChild(g);
  shield = g;
}

function unmountShield(): void {
  shield?.parent?.removeChild(shield);
  shield?.destroy();
  shield = null;
}

// ── DOM 패널 ──
let _panel: HTMLDivElement | null = null;

function panelEl(): HTMLDivElement {
  if (_panel) return _panel;
  const p = document.createElement("div");
  p.style.cssText =
    "position:fixed;top:64px;right:12px;z-index:1000;background:#fff;border:2px solid #ece4f4;" +
    "border-radius:12px;padding:10px 12px;font:12px -apple-system,sans-serif;color:#5b4a70;" +
    "box-shadow:0 8px 24px rgba(167,139,230,.3);min-width:210px;display:none;max-height:70vh;overflow-y:auto";
  document.body.appendChild(p);
  _panel = p;
  return p;
}

function refreshPanel(): void {
  if (!on) return;
  const p = panelEl();
  p.style.display = "block";
  p.innerHTML = "<b>📐 레이아웃 에디터</b><br><small>드래그 또는 좌표 입력</small><hr style='border:none;border-top:1px solid #ece4f4'>";
  // ✕ 닫기 — 에디터 모드 종료 (치트 메뉴 토글과 동일)
  const close = document.createElement("button");
  close.textContent = "✕";
  close.title = "에디터 닫기";
  close.style.cssText =
    "position:absolute;top:8px;right:8px;width:24px;height:24px;border:1px solid #ece4f4;border-radius:50%;" +
    "background:#f8f4fc;color:#a99bc0;font-weight:700;cursor:pointer;line-height:1";
  close.onclick = () => setEditorMode(false);
  p.appendChild(close);
  const rows = [...visible].filter(([, c]) => !c.destroyed && c.parent); // 화면에 남아있는 것만
  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "margin:8px 0 4px;font-size:11.5px;color:#a99bc0;line-height:1.6;max-width:210px";
    empty.textContent = "이 화면엔 편집할 컴포넌트가 없어요. 게임(스토리·연습·관문) 화면에서 열면 목록이 나타납니다.";
    p.appendChild(empty);
    return; // 저장 버튼도 생략 — 빈 저장 방지
  }
  for (const [name, c] of rows) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:4px;align-items:center;margin:4px 0";
    const mk = (v: number, apply: (n: number) => void): HTMLInputElement => {
      const i = document.createElement("input");
      i.type = "number";
      i.value = String(Math.round(v));
      i.style.cssText = "width:56px;padding:2px 4px;border:1px solid #ece4f4;border-radius:6px";
      i.onchange = () => apply(Number(i.value));
      return i;
    };
    const label = document.createElement("span");
    label.textContent = name;
    label.style.cssText = "flex:1;font-weight:600";
    row.append(
      label,
      mk(c.x, (n) => { c.x = n; setPos(name, { x: n, y: Math.round(c.y) }); }),
      mk(c.y, (n) => { c.y = n; setPos(name, { x: Math.round(c.x), y: n }); }),
    );
    p.appendChild(row);
  }
  const save = document.createElement("button");
  save.textContent = "💾 layout.json 저장";
  save.style.cssText =
    "margin-top:8px;width:100%;padding:7px;border:0;border-radius:8px;background:#ff7fb0;color:#fff;font-weight:700;cursor:pointer";
  save.onclick = () => {
    void fetch("/__layout", { method: "POST", body: JSON.stringify(allPos(), null, 2) })
      .then((r) => { save.textContent = r.ok ? "✅ 저장됨" : "❌ 실패(dev 서버 전용)"; })
      .catch(() => { save.textContent = "❌ 실패(dev 서버 전용)"; });
  };
  p.appendChild(save);
}
