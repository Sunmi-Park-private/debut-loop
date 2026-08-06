// engine/deck.ts — 카드 덱 불변 업데이트. 순수 TS(렌더러 의존 0).
import type { CardDeck, Card } from "./types";

/** 카드 획득(연습 보상) */
export function addCard(deck: CardDeck, card: Card): CardDeck {
  return [...deck, card];
}

/** 카드 소모(관문 사용) — 인덱스 다중 제거 */
export function removeCards(deck: CardDeck, indices: number[]): CardDeck {
  const rm = new Set(indices);
  return deck.filter((_, i) => !rm.has(i));
}
