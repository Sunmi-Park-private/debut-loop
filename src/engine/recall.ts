// engine/recall.ts — 2회차 회상 카드가 쓸 문구 결정. 순수 TS(렌더러 의존 0).
//
// 공통 비트는 1회차와 2회차에 모두 나온다. 2회차에서는 회상 카드로 표시되는데,
// 예전에는 1회차 대사를 40자에서 기계적으로 잘라 문장이 중간에 끊겼다.
// 이제 비트마다 회상 문구를 따로 쓸 수 있고, 쓰지 않은 비트는 1회차 문장을 그대로 쓴다.
import type { Beat, LoopCount } from "./types";

/** 빈 문자열·공백만 있는 값은 "지정 안 함"으로 본다 — 칸을 비웠다고 대사가 사라지면 안 된다 */
const pick = (over: string | undefined, base: string): string =>
  over !== undefined && over.trim() !== "" ? over : base;

export interface RecallText { text: string; left: string; right: string }

/** 2회차 회상 카드가 쓸 문구 (미지정 항목은 1회차 값 폴백) */
export function recallOf(beat: Beat): RecallText {
  return {
    text: pick(beat.recall?.textKey, beat.textKey),
    left: pick(beat.recall?.leftLabel, beat.left.label),
    right: pick(beat.recall?.rightLabel, beat.right.label),
  };
}

/** 해당 회차에 실제로 플레이되는 비트 — 회차 전용(loop)이 없으면 두 회차 공통 */
export function beatsOfLoop(beats: Beat[], loop: LoopCount): Beat[] {
  return beats.filter((b) => b.loop === undefined || b.loop === loop);
}

/** 회상 문구가 1회차와 완전히 같은가 — 에디터가 "아직 손대지 않은 비트"를 표시하는 데 쓴다 */
export function recallIsInherited(beat: Beat): boolean {
  const r = recallOf(beat);
  return r.text === beat.textKey && r.left === beat.left.label && r.right === beat.right.label;
}
