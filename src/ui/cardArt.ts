// ui/cardArt.ts — 카드 공통 표기: 판정등급 별과 게이지 심볼.
// 카드 프레임(train-result-card)은 덱·연습 결과·관문 선택이 함께 쓰지만 획득 경로가 제각각이라,
// 등급과 게이지 종류는 텍스트(★·이모지) 대신 전용 아트로 구분한다. 아트 미업로드 시에만 텍스트로 폴백.
import { Container, Text } from "pixi.js";
import type { Card, CardGrade, GaugeId } from "../engine/types";
import { cardEffect } from "../engine/cards";
import { cardTemplates } from "../data";
import { skinFit } from "./uiSkin";

export const STARS: Record<CardGrade, string> = { epic: "★★★", rare: "★★", common: "★" };
const STAR_COLOR = 0xf0a93a;

/** 등급별 별 아트 슬롯 */
const STAR_SLOT: Record<CardGrade, string> = { common: "train-star-1", rare: "train-star-2", epic: "train-star-3" };
/** 게이지 심볼 아트 슬롯 */
const SYM_SLOT: Record<GaugeId, string> = {
  skill: "train-sym-skill", mental: "train-sym-mental", reputation: "train-sym-reputation",
  bond: "train-sym-bond", capital: "train-sym-capital",
};

/** 판정등급 별 — boxW×boxH 안에 중앙 정렬된 컨테이너. 아트가 없으면 ★ 텍스트로 같은 박스를 채운다 */
export function starNode(grade: CardGrade, boxW: number, boxH: number, textSize = 10): Container {
  const art = skinFit(STAR_SLOT[grade], boxW, boxH);
  if (art) return art; // skinFit이 이미 박스 중앙에 맞춰 놓는다
  const wrap = new Container();
  const t = new Text({ text: STARS[grade], style: { fontSize: textSize, fill: STAR_COLOR, fontWeight: "bold" } });
  t.x = (boxW - t.width) / 2;
  t.y = (boxH - t.height) / 2;
  wrap.addChild(t);
  return wrap;
}

/** 카드가 올려주는 게이지 목록 — 값이 큰 순 */
export function cardGauges(card: Card): GaugeId[] {
  return (Object.entries(cardEffect(card, cardTemplates)) as Array<[GaugeId, number]>)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g);
}

/** 카드를 대표하는 게이지 — 쪼갠 카드면 담당 게이지, 통짜면 효과가 가장 큰 것 */
export function cardMainGauge(card: Card): GaugeId | null {
  return card.gauge ?? cardGauges(card)[0] ?? null;
}

/** 대표 게이지 심볼 — boxW 안에 가로 중앙 정렬. 아트가 없으면 null (호출측이 이모지로 폴백).
 *  부수 효과까지 나열하면 82px 카드가 빽빽해지고, 실력처럼 여러 카드에 조금씩 붙는 게이지가
 *  모든 카드에 같은 심볼을 달아 카드끼리 구분이 안 된다. 그래서 대표 하나만 크게 보여준다. */
export function gaugeSymbol(card: Card, boxW: number, size: number): Container | null {
  const g = cardMainGauge(card);
  if (!g) return null;
  const art = skinFit(SYM_SLOT[g], size, size);
  if (!art) return null;
  art.x = (boxW - size) / 2;
  return art;
}
