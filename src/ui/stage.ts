// ui/stage.ts — 논리 스테이지 크기 SSOT. 콘텐츠는 항상 430×800 좌표계에 그리고,
// 세로가 더 긴 기기는 캔버스 높이를 늘려(main.ts) 배경만 위아래로 블리드시킨다.
// 전체 화면을 덮어야 하는 것(배경·딤·플래시)은 fullRect()/coverBg()를 쓸 것.
import { Graphics, Sprite, type Texture } from "pixi.js";

export const BASE_W = 430;
export const BASE_H = 800;

let extra = 0; // 캔버스 논리 높이 − BASE_H (main.ts fit에서 갱신)
export function setStageExtra(e: number): void { extra = Math.max(0, e); }

/** 콘텐츠(0..800) 좌표계에서 캔버스 최상단 y (0 또는 음수) */
export function stageTop(): number { return -extra / 2; }
/** 캔버스 논리 높이 (BASE_H + 블리드 여분) */
export function stageHeight(): number { return BASE_H + extra; }

/** 캔버스 전체를 덮는 rect (배경색·딤·플래시용) */
export function fullRect(color: number, alpha?: number): Graphics {
  const g = new Graphics().rect(0, stageTop(), BASE_W, stageHeight());
  return alpha === undefined ? g.fill(color) : g.fill({ color, alpha });
}

/** 캔버스 전체를 덮는 배경 스프라이트 — cover(넘치는 축 크롭). 소스는 전 기기 커버용 1080×2400 블리드 전제 */
export function coverBg(tex: Texture): Sprite {
  const spr = new Sprite(tex);
  const s = Math.max(BASE_W / tex.width, stageHeight() / tex.height);
  spr.scale.set(s);
  spr.x = (BASE_W - tex.width * s) / 2;
  spr.y = stageTop() + (stageHeight() - tex.height * s) / 2;
  return spr;
}
