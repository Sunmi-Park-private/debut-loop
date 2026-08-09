// ui/layout.ts — 컴포넌트 좌표·표시 속성 SSOT 접근자. 원본은 src/data/layout.json.
import layoutJson from "../data/layout.json";

/** 컴포넌트 항목. x/y는 항상 있고, 나머지는 레이아웃 에디터에서 지정했을 때만 존재한다.
 *  - scale    : 이미지·영상 컴포넌트 배율 (1 = 원본)
 *  - fontSize : 텍스트 컴포넌트 폰트 크기(px)
 *  - color    : 텍스트 색상 "#rrggbb"
 *  - texts    : 텍스트 문구 덮어쓰기. 컴포넌트 안 텍스트 노드 순서대로, null=덮지 않음.
 *               게이지 수치처럼 코드가 매번 새로 쓰는 문구는 덮으면 값이 고정되니 주의.
 *  - textForce : 코드가 채우는 문구인데도 덮어쓰기를 쓰겠다고 명시한 표시(에디터에서 잠금 해제).
 *                이 값이 없으면 동적 문구 컴포넌트의 texts는 무시된다.
 *  모두 미설정이면 코드가 그린 그대로 둔다(하위 호환 — 기존 layout.json은 x/y만 있다). */
export interface Pos {
  x: number; y: number;
  scale?: number; fontSize?: number; color?: string;
  texts?: Array<string | null>;
  textForce?: boolean;
}

const layout: Record<string, Pos> = { ...(layoutJson as Record<string, Pos>) };

// 이번 세션에 실제로 건드린 키 → 그 안에서 건드린 **속성 이름**까지 기록한다.
// 키 단위로만 보내면, 같은 컴포넌트를 A는 위치·B는 색으로 만졌을 때
// A가 들고 있던 낡은 색까지 함께 실려 나가 B의 색을 되돌린다.
const dirty = new Map<string, Set<string>>();

// 값이 바뀔 때마다 알린다 — 에디터가 이걸 받아 자동 저장을 예약한다.
// 편집 경로가 여러 곳(드래그·입력칸·팔레트·슬라이더)이라, 각자 부르는 대신 여기 한 곳에 건다.
let dirtyCb: (() => void) | null = null;
export function onDirty(cb: () => void): void { dirtyCb = cb; }

function mark(name: string, fields: string[]): void {
  const s = dirty.get(name) ?? new Set<string>();
  for (const f of fields) s.add(f);
  dirty.set(name, s);
  dirtyCb?.();
}

/** 컴포넌트 좌표 조회 — 미등록 이름은 기본값(없으면 (0,0)). 에디터로 저장하면 layout.json이 우선 */
export function pos(name: string, def?: Pos): Pos {
  return layout[name] ?? def ?? { x: 0, y: 0 };
}

export function setPos(name: string, p: Pos): void {
  layout[name] = { ...layout[name], ...p };
  mark(name, Object.keys(p));
}

/** 표시 속성만 갱신 — 좌표는 건드리지 않는다. undefined를 넘기면 해당 키를 지운다(코드 기본값 복귀) */
export function setStyle(name: string, patch: Partial<Omit<Pos, "x" | "y">>): void {
  const cur = layout[name] ?? { x: 0, y: 0 };
  const next: Pos = { ...cur, ...patch };
  for (const k of ["scale", "fontSize", "color", "texts", "textForce"] as const) {
    if (patch[k] === undefined && k in patch) delete next[k];
  }
  // 전부 null인 덮어쓰기 배열은 의미가 없으니 키째 제거 (저장 파일이 지저분해지지 않게)
  if (next.texts && next.texts.every((v) => v === null)) delete next.texts;
  layout[name] = next;
  mark(name, Object.keys(patch));
}

/** 이번 세션에 건드린 **속성만** 담아 보낸다. 값이 사라진 속성(초기화)은 null로 보내 서버가 지운다.
 *  안 건드린 속성은 전송되지 않으므로 다른 사람이 저장한 값이 되돌아가지 않는다. */
export function dirtyPos(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, fields] of dirty) {
    const cur = layout[name] as Record<string, unknown> | undefined;
    const patch: Record<string, unknown> = {};
    for (const f of fields) patch[f] = cur?.[f] ?? null; // null = 이 속성 삭제
    out[name] = patch;
  }
  return out;
}

export function clearDirty(): void {
  dirty.clear();
}

/** dirtyPos()가 돌려준 스냅샷 중 실제로 전송에 성공한 필드만 지운다.
 *  clearDirty()처럼 맵 전체를 비우면, fetch가 날아가 있는 동안 들어온 새 편집(다른 필드거나
 *  같은 필드의 재수정)까지 함께 사라져 저장되지 않은 채 유실된다.
 *
 *  같은 필드를 전송 중에 또 고친 경우가 까다롭다 — mark()는 이미 dirty인 필드 이름에는
 *  아무 표시도 남기지 않으므로(Set이라 이름만 기억), 필드 이름만 보고 지우면 그 재수정이
 *  통째로 사라진다. 그래서 이름이 아니라 **값**으로 판단한다: 지금 layout에 있는 값이
 *  보낸 값과 여전히 같을 때만 "그 사이에 아무도 안 건드렸다"고 보고 지운다. 값이 달라졌으면
 *  전송 중에 또 고친 것이므로 dirty로 남겨 다음 저장(finally의 재예약)에 실리게 한다.
 *  texts는 배열이라 JSON 문자열로 비교한다. */
export function clearSent(sent: Record<string, Record<string, unknown>>): void {
  for (const name of Object.keys(sent)) {
    const s = dirty.get(name);
    if (!s) continue;
    const cur = layout[name] as Record<string, unknown> | undefined;
    for (const [f, v] of Object.entries(sent[name]!)) {
      if (JSON.stringify(cur?.[f] ?? null) === JSON.stringify(v)) s.delete(f);
    }
    if (s.size === 0) dirty.delete(name);
  }
}

/** layout.json에 이 컴포넌트 항목이 이미 있는지 (없으면 코드 기본 좌표로 그려지는 중) */
export function hasEntry(name: string): boolean {
  return layout[name] !== undefined;
}
