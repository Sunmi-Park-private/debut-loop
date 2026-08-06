// ui/layout.ts — 컴포넌트 좌표 SSOT 접근자. 원본은 src/data/layout.json.
import layoutJson from "../data/layout.json";

export interface Pos { x: number; y: number; }

const layout: Record<string, Pos> = { ...(layoutJson as Record<string, Pos>) };

/** 컴포넌트 좌표 조회 — 미등록 이름은 기본값(없으면 (0,0)). 에디터로 저장하면 layout.json이 우선 */
export function pos(name: string, def?: Pos): Pos {
  return layout[name] ?? def ?? { x: 0, y: 0 };
}

export function setPos(name: string, p: Pos): void {
  layout[name] = p;
}

export function allPos(): Record<string, Pos> {
  return layout;
}
