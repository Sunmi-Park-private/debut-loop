// engine/gate.ts — 관문 카드 사용 해석. 순수 TS(렌더러 의존 0).
import type { MiniGameGrade, Card, CardTemplate, Gauges, GaugeId } from "./types";
import { cardEffect } from "./cards";

/** 관문 미니게임 성적 → 선택 가능 카드 장수 */
export const GATE_PICKS: Record<MiniGameGrade, number> = { perfect: 2, good: 1, clear: 1 };

export function gatePickCount(grade: MiniGameGrade): number {
  return GATE_PICKS[grade];
}

/** 관문에서 선택한 카드들의 효과 합산 → 게이지 델타 */
export function resolveGate(picked: Card[], templates: CardTemplate[]): Partial<Gauges> {
  const out: Partial<Gauges> = {};
  for (const c of picked) {
    const e = cardEffect(c, templates);
    for (const k of Object.keys(e) as GaugeId[]) {
      out[k] = (out[k] ?? 0) + (e[k] ?? 0);
    }
  }
  return out;
}
