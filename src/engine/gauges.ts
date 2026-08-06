// engine/gauges.ts — 게이지 clamp/붕괴 판정. 순수 TS(렌더러 의존 0).
import type { Gauges, GameConfig, GaugeId } from "./types";

const IDS: GaugeId[] = ["skill", "mental", "reputation", "bond", "capital"];

/** 모든 게이지를 [gaugeMin, gaugeMax] 로 제한 (in-place) */
export function clampGauges(g: Gauges, config: GameConfig): void {
  for (const k of IDS) {
    g[k] = Math.max(config.gaugeMin, Math.min(config.gaugeMax, g[k]));
  }
}

/** 하나라도 바닥(gaugeMin 이하)이면 붕괴 → 3단 사다리 트리거 대상 */
export function isCollapsed(g: Gauges, config: GameConfig): boolean {
  return IDS.some((k) => g[k] <= config.gaugeMin);
}
