// engine/cards.ts — 카드 효과 계산. 순수 TS(렌더러 의존 0).
import type { Card, CardTemplate, CardTemplateId, CardGrade, Gauges, GaugeId } from "./types";

/** 등급 배율: 카드 효과 = baseGauges × mult (반올림) */
export const GRADE_MULT: Record<CardGrade, number> = { common: 1.0, rare: 1.4, epic: 1.8 };

/** 카드 인스턴스의 실제 게이지 효과 (원형 baseGauges × 등급 배율).
 *  card.gauge가 있으면 그 게이지 몫만 — 원형이 여러 게이지를 올릴 때 게이지별로 쪼갠 카드 */
export function cardEffect(card: Card, templates: CardTemplate[]): Partial<Gauges> {
  const t = templates.find((x) => x.id === card.templateId);
  if (!t) return {};
  const mult = GRADE_MULT[card.grade];
  const keys = card.gauge
    ? (card.gauge in t.baseGauges ? [card.gauge] : [])
    : (Object.keys(t.baseGauges) as GaugeId[]);
  const out: Partial<Gauges> = {};
  for (const k of keys) {
    out[k] = Math.round((t.baseGauges[k] ?? 0) * mult);
  }
  return out;
}

/** 원형이 올리는 게이지 목록 — 효과가 큰 순 (카드를 몇 장으로 쪼갤지 결정) */
export function templateGauges(t: CardTemplate): GaugeId[] {
  return (Object.entries(t.baseGauges) as Array<[GaugeId, number]>)
    .filter(([, v]) => (v ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([g]) => g);
}

/** 원형·등급 → 실제로 덱에 들어가는 카드들. 게이지마다 한 장이라
 *  "평판 5 · 실력 1"인 오디션은 두 장, 게이지가 하나뿐인 보컬은 한 장 */
export function makeCards(templateId: CardTemplateId, grade: CardGrade, templates: CardTemplate[]): Card[] {
  const t = templates.find((x) => x.id === templateId);
  if (!t) return [];
  return templateGauges(t).map((gauge) => ({ templateId, grade, gauge }));
}
