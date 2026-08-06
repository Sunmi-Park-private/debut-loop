// engine/cards.ts — 카드 효과 계산. 순수 TS(렌더러 의존 0).
import type { Card, CardTemplate, CardGrade, Gauges, GaugeId } from "./types";

/** 등급 배율: 카드 효과 = baseGauges × mult (반올림) */
export const GRADE_MULT: Record<CardGrade, number> = { common: 1.0, rare: 1.4, epic: 1.8 };

/** 카드 인스턴스의 실제 게이지 효과 (원형 baseGauges × 등급 배율) */
export function cardEffect(card: Card, templates: CardTemplate[]): Partial<Gauges> {
  const t = templates.find((x) => x.id === card.templateId);
  if (!t) return {};
  const mult = GRADE_MULT[card.grade];
  const out: Partial<Gauges> = {};
  for (const k of Object.keys(t.baseGauges) as GaugeId[]) {
    out[k] = Math.round((t.baseGauges[k] ?? 0) * mult);
  }
  return out;
}
