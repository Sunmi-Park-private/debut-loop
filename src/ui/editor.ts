// ui/editor.ts — 개발용 레이아웃 에디터. 치트 메뉴에서 토글.
// 켜면: 화면 최상단에 투명 실드를 깔아 게임 입력을 차단하고, 등록된 컴포넌트를
// 드래그로 이동(겹치면 더 작은 컴포넌트 우선) + 패널에서 x/y 직접 입력 + layout.json 저장.
// 등록(editable)은 에디터 꺼짐 상태에서도 항상 기록 — 켜는 순간 리드로우 없이도 전 항목 편집 가능.
//
// 좌표 외 편집(2026-08 확장):
//   · 텍스트 컴포넌트 → 폰트 크기 + 색상 팔레트
//   · 이미지·영상 컴포넌트 → 배율(scale)
//   · 행을 선택하면 화면의 해당 에셋에 빨간 테두리를 그려 매핑을 보여준다
// 저장 값은 layout.json 항목에 x/y와 함께 들어간다(미설정이면 코드가 그린 그대로).
import { Graphics, Point, Text, type Container, type FederatedPointerEvent } from "pixi.js";
import { setPos, setStyle, pos, dirtyPos, clearSent, hasEntry, onDirty } from "./layout";
import { BASE_W, stageTop, stageHeight } from "./stage";
import { slotIdOf, slotMeta, type UiSkinSlot } from "./uiSkin";

let on = new URLSearchParams(location.search).has("editor");
let redraw: () => void = () => {};
const visible = new Map<string, Container>();

// 같은 레이아웃 키를 여러 자리에서 되풀이해 쓰는 화면이 있다 (카드덱 8칸의 심볼·별·이름…).
// 좌표는 한 벌만 저장하는 게 맞지만, 대표 한 칸만 등록해 두면 나머지 칸을 눌렀을 때
// 그 칸의 조각이 잡히지 않고 바깥 컨테이너(=n칸 전체)가 선택된다.
// 그래서 나머지 인스턴스도 여기 모아 선택·드래그·테두리·스타일에서 함께 다룬다.
const clones = new Map<string, Container[]>();

/** 이름 하나가 가리키는 화면상의 모든 노드 (대표 + 복제) */
const instancesOf = (name: string): Container[] => {
  const out: Container[] = [];
  const p = visible.get(name);
  if (p && !p.destroyed && p.parent) out.push(p);
  for (const c of clones.get(name) ?? []) if (!c.destroyed && c.parent) out.push(c);
  return out;
};

export const editorEnabled = (): boolean => on;

// ── 편집 모드 ⇄ 조작 모드 ────────────────────────────────────────────
// 에디터를 켜면 실드가 게임 입력을 전부 삼켜, 확정·계속 같은 버튼이 눌리지 않아 화면을 진행할 수 없다.
// 조작 모드는 패널·선택·미저장 편집을 그대로 둔 채 실드만 걷어 게임을 원래대로 돌린다.
let interact = false;

/** 게임 입력을 에디터가 가로채는 중인지 — 게임 쪽은 "에디터가 켜졌는지"가 아니라 이 값을 본다 */
export const inputBlocked = (): boolean => on && !interact;

// 모드 변경 구독 — DOM 레이어(메타 팝업 등)가 편집 중인지 알아야 입력을 통과시킬 수 있다
const modeSubs: Array<(editing: boolean) => void> = [];
export function onEditorMode(cb: (editing: boolean) => void): void {
  modeSubs.push(cb);
  cb(inputBlocked()); // 구독 시점의 상태로 한 번 맞춘다
}
function notifyMode(): void {
  for (const cb of modeSubs) cb(inputBlocked());
}

export function setInteractMode(next: boolean): void {
  if (!on || interact === next) return;
  interact = next;
  if (interact) { unmountShield(); unmountGrid(); }
  else { mountShield(); }
  notifyMode();
  refreshPanel();
}

// ` (백틱) = 모드 토글. 입력칸에 포커스가 있으면 무시 — 문구를 치다가 모드가 뒤집히지 않게.
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (!on || e.key !== "`" || e.metaKey || e.ctrlKey || e.altKey) return;
    const a = document.activeElement;
    if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement) return;
    e.preventDefault();
    setInteractMode(!interact);
  });
}

// 토글 훅: 화면이 전체 리드로우 대신 자체 처리(게임 일시정지 등)할 때 등록 — true 반환 시 redraw 생략
let toggleHook: ((on: boolean) => boolean) | null = null;
export function setEditorToggleHook(fn: ((on: boolean) => boolean) | null): void {
  toggleHook = fn;
}

export function setEditorMode(next: boolean): void {
  on = next;
  interact = false; // 에디터를 껐다 켜면 항상 편집 모드부터
  panelEl().style.display = on ? "block" : "none";
  const handled = toggleHook?.(next) ?? false;
  if (!handled) redraw();
  if (on) { mountShield(); refreshPanel(); }
  else { unmountShield(); unmountGrid(); clearHighlight(); }
  notifyMode();
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
  clones.clear();
}

/** 컴포넌트를 에디터 대상으로 등록 — 항상 기록하고, 에디터 켜짐이면 실드 최상단 유지 + 패널 갱신 */
export function editable(name: string, c: Container): void {
  visible.set(name, c);
  (c as unknown as Record<string, string>)[NAME_TAG] = name; // 중첩 판별 표식 (scan이 경계로 삼는다)
  sampleCodeTexts(name, c); // 코드가 쓴 문구를 표본으로 — 매번 달라지면 덮어쓰기를 잠근다
  // 저장된 표시 속성은 이 자리에서 바로 입히지 않고 다음 프레임으로 미룬다.
  //  · 텍스트 자식이 editable() 뒤에 붙는 화면이 있고,
  //  · 부모가 자식보다 먼저 등록되면 아직 자식 표식이 없어 남의 텍스트까지 집는다.
  // 한 프레임 뒤엔 그 화면의 등록이 모두 끝나 있어 소유 관계가 정확해진다.
  if (hasOverride(name)) markStyled(name, c);
  if (on) { if (!interact) mountShield(); refreshPanel(); }
}

/** 이미 등록된 이름의 되풀이 인스턴스 — 패널에는 줄을 하나만 두되,
 *  화면에서는 이 노드도 눌러서 잡히고 테두리·스타일이 같이 적용된다.
 *  대표(editable)를 먼저 등록한 뒤 호출한다. */
export function editableClone(name: string, c: Container): void {
  const arr = clones.get(name);
  if (arr) arr.push(c);
  else clones.set(name, [c]);
  (c as unknown as Record<string, string>)[NAME_TAG] = name; // 바깥 컴포넌트가 이 안을 넘보지 않게
  if (hasOverride(name)) markStyled(name, c);
}

// ── 컴포넌트 내용 분석 ──────────────────────────────────────────────
interface Scan { texts: Text[]; slots: string[]; hasVisual: boolean }

// 등록된 컴포넌트에 이름을 심어 둔다 — 중첩 판별용
const NAME_TAG = "__layoutName";
const nameOf = (n: Container): string | undefined =>
  (n as unknown as Record<string, string | undefined>)[NAME_TAG];

/** 컨테이너 하위를 훑어 텍스트 노드·출처 슬롯·그림 유무를 모은다.
 *  **다른 등록 컴포넌트로 내려가면 멈춘다** — 컴포넌트가 중첩된 경우(gauges_bar ⊃ story_lbl_mental,
 *  card_btn_left ⊃ card_btn_left_text) 같은 텍스트를 둘이 함께 잡으면 덮어쓰기가 서로를 지운다.
 *  가장 안쪽 컴포넌트 하나만 그 텍스트를 소유하게 한다(드래그가 작은 쪽을 고르는 규칙과 동일). */
function scan(c: Container): Scan {
  const texts: Text[] = [];
  const slots: string[] = [];
  let hasVisual = false;
  const walk = (n: Container, isRoot: boolean): void => {
    if (!isRoot && nameOf(n) !== undefined) return; // 다른 컴포넌트의 영역
    const sid = slotIdOf(n);
    if (sid && !slots.includes(sid)) slots.push(sid);
    if (n instanceof Text) { texts.push(n); return; } // 텍스트 내부는 더 볼 것 없음
    if (n.constructor.name !== "Container") hasVisual = true; // Sprite·Graphics·NineSlice 등
    for (const ch of n.children) walk(ch as Container, false);
  };
  walk(c, true);
  return { texts, slots, hasVisual };
}

/** 저장된 표시 속성 적용 — 텍스트는 크기·색, 그 외는 배율 */
/** 문구·크기를 바꾸면 폭이 달라지는데, 코드는 이미 원래 폭 기준으로 좌표를 잡아둔 상태다.
 *  (대부분 `x = (박스폭 - text.width) / 2` 식의 가운데 정렬)
 *  그대로 두면 왼쪽 끝만 고정되고 중심이 밀리므로, 바뀐 폭의 절반만큼 되밀어 중심을 유지한다. */
export function mutateTextKeepingCenter(t: Text, edit: () => void): void {
  const w0 = t.width, h0 = t.height;
  edit();
  t.x += (w0 - t.width) / 2;
  t.y += (h0 - t.height) / 2;
}

// ── 동적 문구 보호 ─────────────────────────────────────────────────
// 스토리 선택지·게이지 수치처럼 코드가 화면마다 새로 쓰는 문구를 덮어쓰면,
// 그 컴포넌트는 모든 비트에서 같은 문구로 고정돼 스토리가 바뀌지 않는다.
// 처음부터 아는 것은 목록으로 막고, 나머지는 실행 중에 문구가 바뀌는지 보고 자동으로 잠근다.
const DYNAMIC_TEXT = /^(card(_text)?$|card_btn_(left|right)(_text)?$|card_replay_|card_seen_note$|story_val_|story_tab$|lobby_cta_(round|sub|run)$|card_deck_item_)/;
/** 그중 스토리 데이터(beats)에서 오는 것 — 비트별 수정은 스토리 에디터(flow.html) 담당 */
const STORY_TEXT = /^(card(_text)?$|card_btn_(left|right)(_text)?$|card_replay_)/;
const dynamicText = new Set<string>();
const codeTexts = new Map<string, string[]>();

/** 코드가 그린 문구를 표본으로 남긴다 — 이전 표본과 다르면 그 컴포넌트는 동적이다.
 *  applyStoredStyle이 다음 프레임에 도는 덕에, 이 시점 값은 아직 코드가 쓴 원본이다. */
function sampleCodeTexts(name: string, c: Container): void {
  if (dynamicText.has(name)) return;
  if (DYNAMIC_TEXT.test(name)) { dynamicText.add(name); return; }
  const cur = scan(c).texts.map((t) => String(t.text));
  const prev = codeTexts.get(name);
  if (prev && prev.length === cur.length && prev.some((v, i) => v !== cur[i])) {
    dynamicText.add(name); // 같은 자리 문구가 바뀌었다 = 코드가 채우는 값
    codeTexts.delete(name);
    return;
  }
  codeTexts.set(name, cur);
}

/** 문구 덮어쓰기를 적용해도 되는 컴포넌트인지.
 *  동적으로 판정됐어도 에디터에서 잠금을 풀었다면(textForce) 사용자의 뜻을 따른다. */
export const textEditable = (name: string): boolean =>
  !dynamicText.has(name) || pos(name).textForce === true;

/** 코드가 채우는 문구인데 사용자가 잠금을 풀어 둔 상태 — 경고를 띄울 대상 */
const isForced = (name: string): boolean => dynamicText.has(name) && pos(name).textForce === true;

/** 이 컴포넌트에 저장된 표시 속성이 하나라도 있는지 */
function hasOverride(name: string): boolean {
  const e = pos(name);
  return e.scale !== undefined || e.fontSize !== undefined || e.color !== undefined || e.texts !== undefined;
}

// 덮어쓰기가 걸린 컴포넌트를 매 프레임 다시 입힌다 — 에디터를 꺼도 동작해야 한다
// (저장된 layout.json은 일반 플레이에도 그대로 적용돼야 하므로).
// 노드를 키로 둔다 — 한 이름이 여러 자리에 되풀이되는 화면(카드덱 8칸)에서 모두 입혀야 하므로.
const styledLive = new Map<Container, string>();
let styleRaf = 0;

/** 스타일만 바꾸는 경우에도 좌표를 먼저 확정한다.
 *  항목이 없던 컴포넌트는 x/y가 비어 저장이 거부되고, setStyle의 기본값(0,0)이 끼면 좌우로 튄다.
 *  지금 화면에 그려진 위치를 그대로 적어 둔다(= 눈에 보이는 변화 없음). */
function ensureCoords(name: string, c: Container): void {
  if (hasEntry(name)) return;
  setPos(name, { x: Math.round(c.x), y: Math.round(c.y) });
}

/** 컴포넌트를 프레임 루프에 올린다 — 적용은 다음 프레임부터(등록이 다 끝난 뒤) */
function markStyled(name: string, node?: Container): void {
  const list = node ? [node] : instancesOf(name);
  let any = false;
  for (const c of list) {
    if (c.destroyed || !c.parent) continue;
    styledLive.set(c, name);
    any = true;
  }
  if (!any) return;
  if (!styleRaf) styleRaf = requestAnimationFrame(pumpStyles);
}

function pumpStyles(): void {
  styleRaf = 0;
  for (const [c, name] of styledLive) {
    if (c.destroyed || !c.parent) { styledLive.delete(c); continue; } // 화면에서 사라진 것 정리
    applyStoredStyle(name, c);
  }
  if (styledLive.size > 0) styleRaf = requestAnimationFrame(pumpStyles);
}

function applyStoredStyle(name: string, c: Container): void {
  const e = pos(name);
  if (e.scale !== undefined && e.scale > 0) c.scale.set(e.scale);
  if (e.fontSize === undefined && e.color === undefined && e.texts === undefined) return;
  const { texts } = scan(c);
  // 등록된 노드가 텍스트 자신이면 그 좌표는 에디터가 소유한다(코드가 pos()로 넣고, 드래그가 덮어쓴다).
  // 이때 중심 보정을 걸면 문구 덮어쓰기로 폭이 바뀔 때마다 저장된 x를 밀어내, 옮겨 저장해도
  // 다음 렌더에서 다시 어긋난다. 보정은 코드가 폭 기준으로 좌표를 잡는 그룹 컴포넌트에만 필요하다.
  const owns = c instanceof Text;
  texts.forEach((t, i) => {
    const edit = (): void => {
      if (e.fontSize !== undefined && e.fontSize > 0) t.style.fontSize = e.fontSize;
      if (e.color !== undefined) t.style.fill = e.color;
      const ov = textEditable(name) ? e.texts?.[i] : undefined; // 동적 문구는 코드 값을 그대로 둔다
      if (typeof ov === "string") t.text = ov;
    };
    if (owns) edit();
    else mutateTextKeepingCenter(t, edit);
  });
}

// ── 선택 하이라이트: 화면의 해당 에셋에 빨간 테두리 ──────────────────
let selected: string | null = null;
let highlight: Graphics | null = null;
let hlRaf = 0;

function clearHighlight(): void {
  if (hlRaf) { cancelAnimationFrame(hlRaf); hlRaf = 0; }
  highlight?.parent?.removeChild(highlight);
  highlight?.destroy();
  highlight = null;
  selected = null; // 안 지우면 에디터를 닫았다 다시 열 때 테두리 없이 "선택됨" 상태로 행이 그려진다
}

/** 선택된 컴포넌트의 화면 경계를 매 프레임 따라다니며 빨간 테두리로 표시.
 *  리드로우로 컨테이너 인스턴스가 바뀌어도 이름으로 다시 찾으므로 끊기지 않는다. */
function paintHighlight(): void {
  hlRaf = requestAnimationFrame(paintHighlight);
  if (!on || !selected) { highlight?.clear(); return; }
  const list = instancesOf(selected);
  const head = list[0];
  if (!head) { highlight?.clear(); return; }
  let root: Container = head;
  while (root.parent) root = root.parent as Container;
  if (!highlight || highlight.destroyed) {
    highlight = new Graphics();
    highlight.eventMode = "none"; // 입력을 가로채지 않는다
  }
  root.addChild(highlight); // 이미 자식이어도 다시 addChild — 매 프레임 최상단으로 재부상시킨다
  highlight.clear();
  // 같은 키를 되풀이해 쓰는 화면은 모든 자리에 테두리를 그린다 — 한 번의 조정이
  // 어디까지 함께 움직이는지 눈으로 보이게.
  for (const c of list) {
    const b = c.getBounds();
    if (b.width <= 0 || b.height <= 0) continue;
    // getBounds()는 전역(화면) 좌표 — 테두리는 root 안에 그리므로 root 로컬로 되돌려야 한다.
    // (스테이지가 화면 비율에 맞춰 스케일/이동돼 있어, 변환 없이 그리면 배율이 한 번 더 먹는다)
    const tl = root.toLocal(new Point(b.x, b.y));
    const br = root.toLocal(new Point(b.x + b.width, b.y + b.height));
    const x = tl.x - 2, y = tl.y - 2;
    const w = br.x - tl.x + 4, h = br.y - tl.y + 4;
    highlight
      .rect(x, y, w, h)
      .fill({ color: 0xff2d2d, alpha: 0.06 })
      .rect(x, y, w, h)
      .stroke({ width: 2, color: 0xff2d2d, alpha: 0.95 });
  }
}

function select(name: string | null): void {
  selected = name;
  if (name && !hlRaf) paintHighlight();
  refreshPanel();
}

// ── 실드: 전화면 투명 레이어 — 게임 입력 차단 + 드래그 처리 (끄면 제거 = 원상복구) ──
let shield: Graphics | null = null;

function mountShield(): void {
  const first = [...visible.values()].find((c) => !c.destroyed && c.parent);
  if (!first) return;
  let root: Container = first;
  while (root.parent) root = root.parent as Container;
  if (shield && shield.parent === root) {
    // 새 화면 요소 위로 재부상. 그리드도 **함께** 올린다 — 실드만 올리면 그리드가
    // 실드와 새로 그려진 요소 밑에 깔려, 화면을 옮길 때마다 격자가 사라진 것처럼 보인다.
    root.addChild(shield);
    paintGrid(); // 화면이 바뀌며 캔버스 크기·위치가 달라졌을 수 있다
    return;
  }
  unmountShield();
  const g = new Graphics().rect(0, stageTop(), BASE_W, stageHeight()).fill({ color: 0xffffff, alpha: 0.001 });
  g.eventMode = "static";
  g.cursor = "move";
  let target: { name: string; c: Container } | null = null;
  let sx = 0, sy = 0, ox = 0, oy = 0;
  g.on("pointerdown", (e: FederatedPointerEvent) => {
    // 포인트를 포함하는 가장 작은 등록 컴포넌트 선택 (겹침 = 안쪽/작은 것 우선)
    // 되풀이 인스턴스도 후보에 넣는다 — 두 번째 카드의 심볼을 눌러도 그 조각이 잡히게
    const cands: Array<[string, Container]> = [...visible];
    for (const [name, list] of clones) for (const c of list) cands.push([name, c]);
    let best: { name: string; c: Container; area: number } | null = null;
    for (const [name, c] of cands) {
      if (c.destroyed || !c.parent) continue;
      const b = c.getBounds();
      if (b.width <= 0 || b.height <= 0) continue;
      if (e.globalX < b.x || e.globalX > b.x + b.width || e.globalY < b.y || e.globalY > b.y + b.height) continue;
      const area = b.width * b.height;
      if (!best || area < best.area) best = { name, c, area };
    }
    target = best;
    if (!best) return;
    select(best.name); // 화면에서 집은 것도 패널에서 선택 상태로
    sx = e.globalX;
    sy = e.globalY;
    ox = best.c.x;
    oy = best.c.y;
  });
  g.on("globalpointermove", (e: FederatedPointerEvent) => {
    if (!target) return;
    // 격자에 붙인다 — Alt를 누른 채 끌면 붙지 않아 1px 단위로 다듬을 수 있다.
    // 이미 저장된 좌표는 건드리지 않는다. 다시 끌 때만 격자로 맞춰진다.
    // 가로는 화면에 그려진 격자와 같은 기준(중앙에서 뻗어 나감)을 써야 보이는 선에 붙는다.
    const snapTo = (v: number, origin: number): number =>
      e.altKey ? Math.round(v) : origin + Math.round((v - origin) / GRID_MINOR) * GRID_MINOR;
    const nx = snapTo(ox + (e.globalX - sx), BASE_W / 2);
    const ny = snapTo(oy + (e.globalY - sy), 0);
    // 좌표는 이름 하나에 한 벌 — 되풀이 인스턴스는 전부 같은 값으로 따라 움직인다
    for (const c of instancesOf(target.name)) { c.x = nx; c.y = ny; }
    setPos(target.name, { x: nx, y: ny });
    refreshPanel();
  });
  const up = (): void => { target = null; };
  g.on("pointerup", up);
  g.on("pointerupoutside", up);
  root.addChild(g);
  shield = g;
  mountGrid();
}

function unmountShield(): void {
  shield?.parent?.removeChild(shield);
  shield?.destroy();
  shield = null;
}

// ── 정렬 그리드 — 편집 모드 표시 + 드래그 기준선 ──────────────────────
// 흰색 베일 대신 선을 쓴다. 디자이너가 색상·농도를 조정하는 중이라, 화면 전체를 덮으면
// 색 판단이 흐려진다. 선은 대부분 픽셀을 원본 그대로 둔다.
const GRID_MINOR = 10;
const GRID_MAJOR = 50;
// 게임 화면이 밝은 파스텔이라 밝은 초록은 묻힌다. 채도 높은 진한 초록을 쓰고 농도를 올린다.
const GRID_COLOR = 0x00c853;
const A_MINOR = 0.3;
const A_MAJOR = 0.6;
const A_CENTER = 0.95;
const A_EDGE = 0.85;
// 그리드는 **DOM 오버레이**다. 예전엔 Pixi 스테이지 안에 그렸는데, 데일리·앨범 같은
// 팝업이 DOM 레이어(z-index 1100)라 캔버스 안에서는 아무리 위로 올려도 그 밑에 깔렸다.
// pointer-events:none 이라 입력은 그대로 실드가 받는다.
const GRID_Z = 1250; // 게임 팝업(1100)·토스트(1200) 위, 에디터 패널(1300) 아래
let gridEl: HTMLCanvasElement | null = null;
let gridResize: (() => void) | null = null;

const hexOf = (n: number, a: number): string =>
  `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;

/** 게임 캔버스 위에 정확히 겹치도록 크기·위치를 맞추고 격자를 다시 그린다 */
function paintGrid(): void {
  const el = gridEl;
  const cv = document.querySelector("canvas");
  if (!el || !cv) return;
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.width = `${r.width}px`;
  el.style.height = `${r.height}px`;
  el.width = Math.max(1, Math.round(r.width * dpr));
  el.height = Math.max(1, Math.round(r.height * dpr));
  const ctx = el.getContext("2d");
  if (!ctx) return;
  // 논리 좌표(430 × stageHeight) → 화면 픽셀
  const sx = (r.width / BASE_W) * dpr;
  const sy = (r.height / stageHeight()) * dpr;
  const top = stageTop();
  const H = stageHeight();
  ctx.clearRect(0, 0, el.width, el.height);
  const line = (x1: number, y1: number, x2: number, y2: number): void => {
    ctx.moveTo((x1 - 0) * sx, (y1 - top) * sy);
    ctx.lineTo((x2 - 0) * sx, (y2 - top) * sy);
  };
  // 세로선은 중앙(x=215)에서 좌우로 뻗어 나간다. 0에서 시작하면 50px 굵은선이 200·250에 서고
  // 중앙선만 215에 홀로 서서, 중앙 옆 간격만 15px로 좁아 보인다(격자가 안 맞는 것처럼).
  const cx = BASE_W / 2;
  const colsAt = (step: number): number[] => {
    const out: number[] = [];
    for (let x = cx; x <= BASE_W; x += step) out.push(x);
    for (let x = cx - step; x >= 0; x -= step) out.push(x);
    return out;
  };
  const majorX = new Set(colsAt(GRID_MAJOR));

  ctx.beginPath();
  for (const x of colsAt(GRID_MINOR)) {
    if (majorX.has(x)) continue;
    line(x, top, x, top + H);
  }
  for (let y = Math.ceil(top / GRID_MINOR) * GRID_MINOR; y <= top + H; y += GRID_MINOR) {
    if (y % GRID_MAJOR === 0) continue;
    line(0, y, BASE_W, y);
  }
  ctx.strokeStyle = hexOf(GRID_COLOR, A_MINOR);
  ctx.lineWidth = 1 * dpr;
  ctx.stroke();

  ctx.beginPath();
  for (const x of majorX) {
    if (x === cx) continue; // 중앙선은 아래에서 더 진하게 따로
    line(x, top, x, top + H);
  }
  for (let y = Math.ceil(top / GRID_MAJOR) * GRID_MAJOR; y <= top + H; y += GRID_MAJOR) {
    line(0, y, BASE_W, y);
  }
  ctx.strokeStyle = hexOf(GRID_COLOR, A_MAJOR);
  ctx.lineWidth = 1.5 * dpr;
  ctx.stroke();

  // 중앙선 — 가운데 정렬 확인용. 반복해서 문제가 된 지점이라 가장 밝게 둔다
  ctx.beginPath();
  line(cx, top, cx, top + H);
  ctx.strokeStyle = hexOf(GRID_COLOR, A_CENTER);
  ctx.lineWidth = 2 * dpr;
  ctx.stroke();

  ctx.beginPath();
  ctx.rect(0, 0, BASE_W * sx, H * sy);
  ctx.strokeStyle = hexOf(GRID_COLOR, A_EDGE);
  ctx.lineWidth = 3 * dpr;
  ctx.stroke();
}

function mountGrid(): void {
  if (!gridEl) {
    const el = document.createElement("canvas");
    el.style.cssText = `position:fixed;z-index:${GRID_Z};pointer-events:none`;
    document.body.appendChild(el);
    gridEl = el;
    gridResize = () => paintGrid();
    window.addEventListener("resize", gridResize);
  }
  paintGrid();
}

function unmountGrid(): void {
  if (gridResize) window.removeEventListener("resize", gridResize);
  gridResize = null;
  gridEl?.remove();
  gridEl = null;
}

// ── 자동 저장 ───────────────────────────────────────────────────────
// 💾를 누르는 걸 잊어 작업이 날아가는 사고를 막는다. 편집이 멎으면 곧바로 파일에 반영하고,
// 부분 저장이라 다른 사람이 저장한 값은 건드리지 않는다. 💾 버튼은 "기다리지 않고 지금" 용도로 남긴다.
const AUTOSAVE_MS = 600;
let saveTimer = 0;
let saving = false;
let retryPending = false; // 마지막 시도가 실패해 재시도가 필요함(finally에서 소비)
let saveStatus = "편집하면 자동 저장됩니다";
let statusEl: HTMLElement | null = null;

function setStatus(s: string): void {
  saveStatus = s;
  if (statusEl) statusEl.textContent = s;
}

async function flushSave(): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
  if (saving) return;
  const changed = dirtyPos();
  const n = Object.keys(changed).length;
  if (n === 0) { setStatus("변경 없음 — 모두 저장됨"); return; }
  saving = true;
  setStatus(`저장 중… (${n}개)`);
  try {
    const r = await fetch("/__layout", { method: "POST", body: JSON.stringify(changed) });
    if (!r.ok) { setStatus(`❌ 저장 실패 — ${await r.text()}`); retryPending = true; return; }
    clearSent(changed); // 보낸 필드만 비운다 — 전송 중 새로 들어온 편집은 남겨 다음 저장에 실린다
    const t = new Date();
    const pad = (v: number): string => String(v).padStart(2, "0");
    setStatus(`✅ ${n}개 저장됨 · ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`);
  } catch {
    setStatus("❌ 저장 실패 (dev 서버 전용)");
    retryPending = true;
  } finally {
    saving = false;
    // 저장 중에 더 편집했으면 이어서, 실패했으면 재시도(둘 다 같은 디바운스 경로를 탄다)
    if (dirtyKeyCount() > 0 || retryPending) { retryPending = false; scheduleSave(); }
  }
}

const dirtyKeyCount = (): number => Object.keys(dirtyPos()).length;

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  setStatus("편집 중…");
  saveTimer = window.setTimeout(() => { saveTimer = 0; void flushSave(); }, AUTOSAVE_MS);
}

onDirty(scheduleSave);

/** 페이지가 사라지기 직전 마지막 밀어내기.
 *  일반 fetch는 언로드 중에 취소되므로 sendBeacon으로 보낸다(브라우저가 배송을 보장).
 *  개발 중 코드 수정 → vite 리로드가 잦은데, 이때 디바운스를 기다리던 편집이 통째로 날아가던 문제. */
function flushBeacon(): void {
  const changed = dirtyPos();
  if (Object.keys(changed).length === 0) return;
  const body = new Blob([JSON.stringify(changed)], { type: "application/json" });
  if (navigator.sendBeacon("/__layout", body)) clearSent(changed);
}
window.addEventListener("beforeunload", flushBeacon);
window.addEventListener("pagehide", flushBeacon);
if (import.meta.hot) {
  // vite가 모듈을 갈아끼우거나 새로고침하기 직전 — 저장되지 않은 편집을 먼저 보낸다
  import.meta.hot.on("vite:beforeFullReload", flushBeacon);
  import.meta.hot.on("vite:beforeUpdate", flushBeacon);
}

// ── DOM 패널 ──
let _panel: HTMLDivElement | null = null;

/** 패널 레이어 — 게임 팝업(1100)·토스트(1200)보다 위, 치트(1401)보다 아래.
 *  패널 DOM은 한 번만 만들고 재사용하므로, 값이 바뀌어도 반영되도록 꺼낼 때마다 다시 못 박는다.
 *  (아래에 깔리면 패널을 누른 클릭이 팝업 오버레이에 떨어져 팝업이 닫혀버린다) */
const PANEL_Z = "1300";

function panelEl(): HTMLDivElement {
  if (_panel) { _panel.style.zIndex = PANEL_Z; return _panel; }
  const p = document.createElement("div");
  // 폭은 화면을 넘어가도 무방 — 행마다 좌표·배율·폰트 컨트롤이 한 줄에 들어가야 한다
  p.style.cssText =
    `position:fixed;top:64px;right:12px;z-index:${PANEL_Z};background:#fff;border:2px solid #ece4f4;` +
    "border-radius:12px;padding:10px 12px;font:12px -apple-system,sans-serif;color:#5b4a70;" +
    "box-shadow:0 8px 24px rgba(167,139,230,.3);width:470px;display:none;max-height:78vh;overflow-y:auto";
  document.body.appendChild(p);
  _panel = p;
  return p;
}

// 텍스트 색상 팔레트 — 게임에서 실제로 쓰는 색 위주
const PALETTE: Array<[string, string]> = [
  ["#5b4a70", "잉크"], ["#a99bc0", "서브"], ["#ffffff", "흰색"], ["#000000", "검정"],
  ["#ff7fb0", "핑크"], ["#9a7fe0", "라벤더"], ["#c9527f", "진한 핑크"], ["#f0a93a", "주황"],
  ["#ffefd8", "별 노랑"], ["#f0c05a", "골드"], ["#ffe4f0", "연핑크"], ["#fff4c9", "크림"],
];

const css = {
  num: "width:52px;padding:2px 4px;border:1px solid #ece4f4;border-radius:6px;font:11px -apple-system,sans-serif",
  tag: "font-size:9.5px;color:#a99bc0;margin-right:2px",
};

function refreshPanel(): void {
  if (!on) return;
  // 패널 안의 컨트롤을 조작하는 중이면 다시 그리지 않는다 — editable()이 매 렌더마다 부르기 때문에
  // 그대로 두면 한 글자 칠 때마다(문구 입력), 값이 바뀔 때마다(x/y/크기 숫자칸) 새 DOM 노드가
  // 만들어져 포커스·커서가 날아가고, 배율 슬라이더는 드래그 중 노드가 뽑혀 나가 조작이 끊기고,
  // 열려 있던 농도 드롭다운은 통째로 사라진다. 다른 디자이너의 에셋 교체 알림도 같은 rebuild를
  // 타므로, 텍스트 하나만 봐서는 안 되고 패널 안의 컨트롤 전체를 보호해야 한다.
  const act = document.activeElement;
  const isPanelControl =
    act instanceof HTMLInputElement || act instanceof HTMLSelectElement || act instanceof HTMLTextAreaElement;
  if (isPanelControl && _panel?.contains(act)) return;
  const p = panelEl();
  p.style.display = "block";
  p.innerHTML = "";
  // 머리말은 스크롤과 무관하게 위에 붙어 있는다 — 목록이 길어지면 ✕와 모드 토글을 찾아
  // 한참 올려야 했다. 패널 좌우 패딩을 음수 마진으로 덮어 스크롤 내용이 뒤로 비쳐 보이지 않게 한다.
  const head = document.createElement("div");
  head.style.cssText =
    "position:sticky;top:-10px;z-index:2;background:#fff;margin:-10px -12px 8px;padding:10px 12px 8px;" +
    "border-bottom:1px solid #ece4f4";
  head.innerHTML =
    "<b>📐 레이아웃 에디터</b><br><small>드래그 · 좌표 입력 · 이름을 누르면 화면에서 " +
    "<span style='color:#ff2d2d;font-weight:700'>빨간 테두리</span>로 표시</small>";
  p.appendChild(head);
  // ✕ 닫기 — 에디터 모드 종료 (치트 메뉴 토글과 동일)
  const close = document.createElement("button");
  close.textContent = "✕";
  close.title = "에디터 닫기";
  close.style.cssText =
    "position:absolute;top:10px;right:12px;width:24px;height:24px;border:1px solid #ece4f4;border-radius:50%;" +
    "background:#f8f4fc;color:#a99bc0;font-weight:700;cursor:pointer;line-height:1";
  close.onclick = () => setEditorMode(false);
  head.appendChild(close);
  // 모드 토글 — 편집(실드·그리드) ⇄ 조작(게임 정상 동작). 상태가 곧 설명이 되게 적는다
  const mode = document.createElement("button");
  mode.style.cssText =
    "width:100%;margin:8px 0 0;padding:8px 10px;border:0;border-radius:9px;cursor:pointer;text-align:left;" +
    "font:12px -apple-system,sans-serif;line-height:1.55;color:#fff;background:" +
    (interact ? "#2fb573" : "#ff7fb0");
  mode.innerHTML = interact
    ? "<b>▶ 조작 중</b> — 화면이 선명합니다<br>" +
      "<span style='opacity:.85;font-size:11px'>게임이 정상 동작합니다 · 드래그로는 못 옮겨요<br>" +
      "<b>`</b> 또는 여기를 눌러 편집으로</span>"
    : "<b>✋ 편집 중</b> — 초록 격자가 보입니다<br>" +
      "<span style='opacity:.85;font-size:11px'>드래그로 옮기고 10px에 붙어요 (Alt = 1px)<br>" +
      "<b>`</b> 또는 여기를 눌러 조작으로 (화면 진행)</span>";
  mode.onclick = () => setInteractMode(!interact);
  head.appendChild(mode); // 모드 토글도 머리말에 — 자주 오가는 컨트롤이라 항상 손에 닿아야 한다
  const rows = [...visible].filter(([, c]) => !c.destroyed && c.parent); // 화면에 남아있는 것만
  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "margin:8px 0 4px;font-size:11.5px;color:#a99bc0;line-height:1.6";
    empty.textContent = "이 화면엔 편집할 컴포넌트가 없어요. 게임(스토리·연습·관문) 화면에서 열면 목록이 나타납니다.";
    p.appendChild(empty);
    return; // 저장 버튼도 생략 — 빈 저장 방지
  }
  for (const [name, c] of rows) {
    p.appendChild(buildRow(name, c));
  }
  const status = document.createElement("div");
  status.style.cssText = "margin-top:8px;font-size:10.5px;color:#a99bc0;text-align:center;line-height:1.5";
  status.textContent = saveStatus;
  statusEl = status;
  p.appendChild(status);
  const save = document.createElement("button");
  save.textContent = "💾 지금 저장";
  save.title = "자동 저장을 기다리지 않고 바로 반영";
  save.style.cssText =
    "margin-top:4px;width:100%;padding:7px;border:0;border-radius:8px;background:#ff7fb0;color:#fff;font-weight:700;cursor:pointer";
  save.onclick = () => { void flushSave(); };
  p.appendChild(save);
}

/** clipboard API가 막힌 컨텍스트(터널 http 등)용 복사 — 화면 밖 textarea + execCommand */
function copyFallback(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** 컴포넌트 한 줄 — 이름(선택) + x/y + 유형별 컨트롤(배율 / 폰트 크기·색) */
function buildRow(name: string, c: Container): HTMLDivElement {
  const info = scan(c);
  const isSel = selected === name;
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "margin:3px 0;padding:4px 6px;border-radius:7px;border:1px solid " +
    (isSel ? "#ff2d2d" : "transparent") + ";background:" + (isSel ? "#fff5f5" : "transparent");

  const head = document.createElement("div");
  head.style.cssText = "display:flex;gap:5px;align-items:center";

  const label = document.createElement("button");
  const icon = info.texts.length > 0 && info.hasVisual ? "🖼🅣 " : info.texts.length > 0 ? "🅣 " : info.hasVisual ? "🖼 " : "◻︎ ";
  label.textContent = icon + name;
  label.title = "클릭하면 화면에서 빨간 테두리로 표시";
  label.style.cssText =
    // flex:1을 주지 않는다 — 라벨이 늘어나면 복사 버튼이 줄 끝까지 밀려 이름에서 멀어진다.
    // 남는 폭은 뒤의 spacer가 먹고, 복사 버튼은 이름 바로 옆에 붙는다.
    "min-width:0;text-align:left;border:0;background:none;padding:2px 0;cursor:pointer;font:600 11.5px -apple-system,sans-serif;" +
    "color:" + (isSel ? "#ff2d2d" : "#5b4a70") + ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  label.onclick = () => select(isSel ? null : name);

  // 이름 복사 — 컴포넌트가 많아져 이름을 눈으로 옮겨 적기 번거로워졌다.
  // (선택은 라벨 클릭이므로, 복사 버튼은 선택을 건드리지 않게 이벤트를 멈춘다)
  const copy = document.createElement("button");
  copy.textContent = "⧉";
  copy.title = "컴포넌트 이름 복사";
  copy.style.cssText =
    "flex-shrink:0;border:0;background:none;padding:2px 3px;cursor:pointer;font-size:11px;color:#c4b8d6";
  copy.onclick = (e) => {
    e.stopPropagation();
    const done = (ok: boolean): void => {
      copy.textContent = ok ? "✓" : "✕";
      copy.style.color = ok ? "#3fb98a" : "#ff6f91";
      setTimeout(() => { copy.textContent = "⧉"; copy.style.color = "#c4b8d6"; }, 900);
    };
    // clipboard API는 보안 컨텍스트(https·localhost)에서만 — 터널 http 접속을 위해 폴백을 둔다
    navigator.clipboard?.writeText(name).then(() => done(true)).catch(() => done(copyFallback(name)))
      ?? done(copyFallback(name));
  };

  const mkNum = (v: number, tag: string, apply: (n: number) => void, step = 1): HTMLSpanElement => {
    const s = document.createElement("span");
    s.style.cssText = "display:inline-flex;align-items:center";
    const t = document.createElement("span");
    t.textContent = tag;
    t.style.cssText = css.tag;
    const i = document.createElement("input");
    i.type = "number";
    i.step = String(step);
    i.value = String(step < 1 ? Math.round(v * 100) / 100 : Math.round(v));
    i.style.cssText = css.num;
    i.onchange = () => apply(Number(i.value));
    s.append(t, i);
    return s;
  };

  const spacer = document.createElement("span");
  spacer.style.cssText = "flex:1";

  head.append(
    label,
    copy,
    spacer,
    // 되풀이 인스턴스(카드덱 8칸 등)도 같이 옮긴다 — 저장되는 좌표는 어차피 한 벌
    mkNum(c.x, "x", (n) => {
      const y = Math.round(c.y);
      for (const t of instancesOf(name)) t.x = n;
      setPos(name, { x: n, y });
    }),
    mkNum(c.y, "y", (n) => {
      const x = Math.round(c.x);
      for (const t of instancesOf(name)) t.y = n;
      setPos(name, { x, y: n });
    }),
  );
  wrap.appendChild(head);

  // 텍스트 컴포넌트 → 폰트 크기 + 색상 팔레트
  if (info.texts.length > 0) {
    const t0 = info.texts[0]!;
    const line = document.createElement("div");
    line.style.cssText = "display:flex;gap:6px;align-items:center;margin-top:3px;padding-left:2px;flex-wrap:wrap";
    const cur = pos(name);
    line.appendChild(mkNum(cur.fontSize ?? Number(t0.style.fontSize), "크기", (n) => {
      if (!(n > 0)) return;
      for (const t of info.texts) mutateTextKeepingCenter(t, () => { t.style.fontSize = n; });
      ensureCoords(name, c);
      setStyle(name, { fontSize: n });
      markStyled(name);
      refreshPanel();
    }));
    const swatches = document.createElement("span");
    swatches.style.cssText = "display:inline-flex;gap:2px;flex-wrap:wrap";
    const curColor = (cur.color ?? "").toLowerCase();
    for (const [hex, title] of PALETTE) {
      const b = document.createElement("button");
      b.title = title;
      b.style.cssText =
        "width:15px;height:15px;border-radius:4px;cursor:pointer;background:" + hex + ";" +
        "border:" + (curColor === hex ? "2px solid #ff2d2d" : "1px solid #d8cce8");
      b.onclick = () => {
        for (const t of info.texts) t.style.fill = hex;
        ensureCoords(name, c);
        setStyle(name, { color: hex });
        markStyled(name);
        refreshPanel();
      };
      swatches.appendChild(b);
    }
    line.appendChild(swatches);
    if (cur.color !== undefined || cur.fontSize !== undefined) {
      const reset = document.createElement("button");
      reset.textContent = "초기화";
      reset.title = "코드 기본값으로 되돌림 (다시 그린 뒤 반영)";
      reset.style.cssText =
        "font-size:10px;padding:1px 6px;border:1px solid #ece4f4;border-radius:6px;background:#f8f4fc;color:#a99bc0;cursor:pointer";
      reset.onclick = () => { ensureCoords(name, c); setStyle(name, { fontSize: undefined, color: undefined }); triggerRedraw(); refreshPanel(); };
      line.appendChild(reset);
    }
    wrap.appendChild(line);
  }

  // 이미지·영상이 들어있으면 배율 — 텍스트만 있는 컴포넌트는 폰트 크기로 조절하므로 제외.
  // 버튼처럼 아트+라벨이 섞인 컴포넌트는 둘 다 노출한다(배율은 라벨까지 함께 커진다).
  if (info.hasVisual) {
    const cur = pos(name);
    const line = document.createElement("div");
    line.style.cssText = "display:flex;gap:6px;align-items:center;margin-top:3px;padding-left:2px";
    const val = cur.scale ?? c.scale.x;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0.2";
    slider.max = "3";
    slider.step = "0.05";
    slider.value = String(val);
    slider.style.cssText = "flex:1;accent-color:#ff7fb0";
    const shown = document.createElement("span");
    shown.textContent = `${val.toFixed(2)}×`;
    shown.style.cssText = "font-size:10.5px;color:#a99bc0;width:38px;text-align:right";
    const apply = (n: number): void => {
      c.scale.set(n);
      ensureCoords(name, c);
      setStyle(name, { scale: n });
      markStyled(name);
      shown.textContent = `${n.toFixed(2)}×`;
    };
    slider.oninput = () => apply(Number(slider.value));
    const tag = document.createElement("span");
    tag.textContent = "배율";
    tag.style.cssText = css.tag;
    line.append(tag, slider, shown);
    if (cur.scale !== undefined) {
      const reset = document.createElement("button");
      reset.textContent = "1×";
      reset.style.cssText =
        "font-size:10px;padding:1px 6px;border:1px solid #ece4f4;border-radius:6px;background:#f8f4fc;color:#a99bc0;cursor:pointer";
      reset.onclick = () => { ensureCoords(name, c); c.scale.set(1); setStyle(name, { scale: undefined }); refreshPanel(); };
      line.appendChild(reset);
    }
    wrap.appendChild(line);
  }

  // 선택 시 매핑 정보 — 어떤 슬롯·파일이 그려졌고 텍스트 내용은 무엇인지
  if (isSel) wrap.appendChild(buildMapping(name, c, info));
  return wrap;
}

// ── 슬롯 직접 편집: 농도 + 파일 교체 (ui.html 에디터와 동일 규칙·엔드포인트) ──
const VID_EXTS = ["mov", "webm", "mp4"]; // 영상 슬롯(slot.vid)만 허용
const IMG_EXTS = ["png", "jpg", "webp"];

/** 업로드 — 검증은 UI 에디터와 동일. 성공 시 서버가 최종 경로를 돌려주고(png→webp 등 변환),
 *  갱신은 dev 서버의 asset-updated 브로드캐스트가 현재 화면에 자동 반영한다. */
async function uploadSlotFile(slot: UiSkinSlot, file: File, btn: HTMLButtonElement): Promise<void> {
  const raw = file.name.split(".").pop()?.toLowerCase() ?? "";
  const ext = raw === "jpeg" ? "jpg" : raw;
  const isVid = VID_EXTS.includes(ext);
  if (isVid && !slot.vid) { alert("이 슬롯은 이미지 전용입니다"); return; }
  if (!isVid && !IMG_EXTS.includes(ext)) { alert(slot.vid ? "png/jpg/webp 또는 mov/webm/mp4만 가능합니다" : "png/jpg/webp만 가능합니다"); return; }
  if (!isVid && file.size > 10 * 1024 * 1024) { alert("10MB 이하만 가능합니다"); return; }
  const label = btn.textContent;
  btn.textContent = "업로드 중…";
  btn.disabled = true;
  try {
    const r = await fetch(`/__skinupload?slot=${slot.id}&ext=${ext}`, { method: "POST", body: file });
    if (!r.ok) { alert(`업로드 실패: ${await r.text()}`); btn.textContent = label; btn.disabled = false; return; }
    slot.file = (await r.text()).trim() || `assets/ui/${slot.id}.${ext}`;
    btn.textContent = "✅ 교체됨";
  } catch {
    alert("업로드 실패 (dev 서버 전용)");
    btn.textContent = label;
  }
  btn.disabled = false;
}

/** 슬롯 컨트롤 한 줄 — 농도 드롭다운 + 파일 교체 버튼 */
function slotControls(slot: UiSkinSlot): HTMLDivElement {
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:6px;align-items:center;margin:4px 0 6px";

  const cap = document.createElement("span");
  cap.textContent = "농도";
  cap.style.cssText = css.tag;

  // 0%=원본, −=진하게(채도 증가), +=연하게(알파 감소) — uiskins.json의 opacity와 같은 값
  const sel = document.createElement("select");
  sel.style.cssText = "padding:2px 4px;border:1px solid #ece4f4;border-radius:6px;font-size:10.5px;cursor:pointer;color:#5b4a70";
  for (let v = -5; v <= 5; v++) {
    const o = document.createElement("option");
    o.value = String(v / 10);
    o.textContent = v === 0 ? "0% (기본)" : v < 0 ? `−${-v * 10}% 진하게` : `+${v * 10}% 연하게`;
    sel.appendChild(o);
  }
  sel.value = String(slot.opacity ?? 0);
  sel.onchange = () => {
    const next = Number(sel.value);
    const prev = slot.opacity ?? 0;
    void fetch("/__uiopacity", { method: "POST", body: JSON.stringify({ slot: slot.id, opacity: next }) })
      .then(async (r) => {
        if (!r.ok) { alert(`농도 저장 실패: ${await r.text()}`); sel.value = String(prev); return; }
        slot.opacity = next; // 화면 반영은 서버의 ui-opacity-updated 브로드캐스트가 처리
      })
      .catch(() => { alert("농도 저장 실패 (dev 서버 전용)"); sel.value = String(prev); });
  };

  const btn = document.createElement("button");
  btn.textContent = "📁 파일 교체";
  btn.title = slot.vid ? "png/jpg/webp · mov/webm/mp4" : "png/jpg/webp · 10MB 이하";
  btn.style.cssText =
    "margin-left:auto;font-size:10.5px;padding:3px 8px;border:1px solid #ece4f4;border-radius:6px;" +
    "background:#f8f4fc;color:#5b4a70;font-weight:600;cursor:pointer";
  // 클릭할 때만 만든다 — 패널은 편집·에셋 알림마다 다시 그려지는데, 매번 body에 하나씩
  // 붙여 두면(이전엔 렌더마다 append) 선택창을 한 번도 안 열어도 고아 노드가 계속 쌓인다.
  btn.onclick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `image/png,image/jpeg,image/webp${slot.vid ? ",video/quicktime,video/webm,video/mp4,.mov,.webm,.mp4" : ""}`;
    input.style.display = "none";
    document.body.appendChild(input); // 파일 선택창이 떠 있는 동안 패널이 다시 그려져도 살아있도록 body에 둔다
    const cleanup = (): void => input.remove();
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void uploadSlotFile(slot, f, btn);
      cleanup(); // 선택했든 안 했든 노드는 남겨두지 않는다
    };
    input.oncancel = cleanup; // 선택창을 취소하면 change가 안 오므로 별도로 처리
    input.click();
  };

  bar.append(cap, sel, btn);
  return bar;
}

/** 문구 입력칸 한 줄 — 실시간 반영 + 되돌리기. 정적/고정 두 경로가 함께 쓴다. */
function buildTextInput(name: string, c: Container, info: Scan, idx: number, t: Text): HTMLDivElement {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:5px;align-items:center;flex:1;min-width:0;margin-top:3px";
  const inp = document.createElement("input");
  inp.type = "text";
  inp.value = String(t.text);
  inp.style.cssText =
    "flex:1;min-width:0;padding:3px 6px;border:1px solid #ece4f4;border-radius:6px;" +
    "font:11.5px -apple-system,sans-serif;color:#5b4a70";
  // 실시간 반영 — 한 글자마다 화면과 layout 메모리에 쓴다 (파일 저장은 자동/💾)
  inp.oninput = () => {
    mutateTextKeepingCenter(t, () => { t.text = inp.value; }); // 중심 유지 — 좌우로 밀리지 않게
    const arr: Array<string | null> = [...(pos(name).texts ?? [])];
    while (arr.length < info.texts.length) arr.push(null);
    arr[idx] = inp.value;
    ensureCoords(name, c);
    setStyle(name, { texts: arr });
    markStyled(name);
  };
  const size = document.createElement("span");
  size.textContent = `${Math.round(Number(t.style.fontSize))}px`;
  size.style.cssText = "font-size:10px;color:#c4b8d6;flex-shrink:0";
  row.append(inp, size);
  if (typeof pos(name).texts?.[idx] === "string") {
    const undo = document.createElement("button");
    undo.textContent = "\u21ba";
    undo.title = "이 문구를 원래대로 되돌림";
    undo.style.cssText =
      "flex-shrink:0;width:20px;height:20px;border:1px solid #ece4f4;border-radius:5px;" +
      "background:#f8f4fc;color:#a99bc0;cursor:pointer;line-height:1";
    undo.onclick = () => {
      const arr: Array<string | null> = [...(pos(name).texts ?? [])];
      arr[idx] = null;
      ensureCoords(name, c);
      setStyle(name, { texts: arr });
      triggerRedraw();
      refreshPanel();
    };
    row.appendChild(undo);
  }
  return row;
}

/** 텍스트 문구 편집 한 줄 — 입력 즉시 화면과 저장값에 반영 */
function textRow(name: string, c: Container, info: Scan, idx: number): HTMLDivElement {
  const t = info.texts[idx]!;
  const line = document.createElement("div");
  line.style.cssText = "display:flex;gap:5px;align-items:center;margin:3px 0";
  const tag = document.createElement("span");
  tag.textContent = "🅣";
  // 코드가 채우는 문구(스토리 선택지·게이지 수치)는 장면마다 값이 달라진다.
  // 자물쇠 은유 대신, 체크하면 무슨 일이 일어나는지 문장으로 적은 스위치 하나로 다룬다.
  // 체크 = layout.json에 textForce가 남고 입력칸이 열린다. 해제 = 덮어쓴 문구까지 지우고 원문 복귀.
  if (dynamicText.has(name)) {
    const box = document.createElement("div");
    box.style.cssText = "margin:3px 0";
    const sw = document.createElement("label");
    sw.style.cssText =
      "display:flex;gap:6px;align-items:flex-start;font-size:10.5px;line-height:1.5;cursor:pointer;" +
      "color:" + (isForced(name) ? "#d64545" : "#a99bc0");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = isForced(name);
    cb.style.cssText = "margin:2px 0 0;accent-color:#ff7fb0;flex-shrink:0";
    cb.onchange = () => {
      if (cb.checked) {
        ensureCoords(name, c);
        setStyle(name, { textForce: true });
        markStyled(name, c);
      } else {
        setStyle(name, { textForce: undefined, texts: undefined }); // 덮어쓴 문구도 함께 제거
        triggerRedraw();
      }
      refreshPanel();
    };
    const cap = document.createElement("span");
    cap.innerHTML = isForced(name)
      ? "<b>모든 장면이 이 문구 하나로 덮여 있습니다</b> — 체크를 풀면 장면별 문구로 돌아갑니다"
      : "예외로 <b>모든 장면을 같은 문구</b>로 덮으려면 체크 (권장하지 않음)";
    sw.append(cb, cap);
    // 어디서 고쳐야 하는지부터 알려준다 — 여기서 고칠 값이 아니다
    const guide = document.createElement("div");
    guide.style.cssText =
      "font-size:10.5px;color:#8a76a8;line-height:1.6;margin-bottom:3px;padding:4px 6px;" +
      "border-radius:5px;background:#f8f4fc";
    guide.innerHTML = STORY_TEXT.test(name)
      ? `이 문구는 <b>장면(비트)마다 다릅니다</b> — 지금은 "${String(t.text).slice(0, 16)}"<br>` +
        `비트별로 고치려면 <a href="/flow.html" target="_blank" style="color:#ff7fb0;font-weight:700">스토리 에디터</a>에서 해당 비트의 <b>라벨</b>을 수정하세요`
      : `게임 상태에 따라 <b>자동으로 채워지는 값</b>입니다 — 지금은 "${String(t.text).slice(0, 16)}"<br>` +
        `여기서 고칠 값이 아니라, 위치·크기·색만 조정하세요`;
    box.appendChild(guide);
    box.appendChild(sw);
    if (!isForced(name)) { line.append(tag, box); return line; }
    // 고정 상태 — 스위치 아래에 입력칸을 붙인다
    box.appendChild(buildTextInput(name, c, info, idx, t));
    line.append(tag, box);
    return line;
  }
  line.append(tag, buildTextInput(name, c, info, idx, t));
  return line;
}

/** 선택된 컴포넌트가 무엇으로 그려졌는지 — UI 스킨 슬롯(파일)과 텍스트 내용 */
function buildMapping(name: string, c: Container, info: Scan): HTMLDivElement {
  const box = document.createElement("div");
  box.style.cssText =
    "margin-top:5px;padding:5px 7px;border-radius:6px;background:#fff;border:1px dashed #ffb3b3;" +
    "font-size:10.5px;color:#8a76a8;line-height:1.65;word-break:break-all";
  const add = (html: string): void => { const d = document.createElement("div"); d.innerHTML = html; box.appendChild(d); };
  if (info.slots.length === 0 && info.texts.length === 0) {
    add("연결된 에셋 없음 — 코드가 그린 벡터 도형입니다");
    return box;
  }
  for (const id of info.slots) {
    const s = slotMeta(id);
    const file = s?.file ? s.file.replace(/^assets\//, "") : "(미업로드 — 폴백)";
    const kind = /\.(mp4|webm|mov)$/i.test(s?.file ?? "") ? "🎬" : "🖼";
    add(`${kind} <b style="color:#5b4a70">${id}</b>${s?.label ? ` · ${s.label}` : ""}<br><span style="color:#a99bc0">${file}</span>`);
    if (s) box.appendChild(slotControls(s)); // 농도 + 파일 교체 (UI 에디터와 같은 규칙)
  }
  // 게이지 바처럼 텍스트가 많은 컴포넌트는 앞쪽만 — 목록이 패널을 다 잡아먹지 않게
  const CAP = 6;
  for (let i = 0; i < Math.min(info.texts.length, CAP); i++) {
    box.appendChild(textRow(name, c, info, i));
  }
  if (info.texts.length > CAP) add(`<span style="color:#c4b8d6">…외 텍스트 ${info.texts.length - CAP}개</span>`);
  return box;
}
