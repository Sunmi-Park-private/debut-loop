// engine/training.ts — 연습 결과 해석(카드 획득 + 멘탈 등 소모). 순수 TS.
import type { TrainingId, MiniGameGrade, CardGrade, Card, Gauges } from "./types";

/** 연습 미니게임 성적 → 획득 카드 등급 */
export const TRAIN_GRADE_TO_CARD: Record<MiniGameGrade, CardGrade> = {
  perfect: "epic",
  good: "rare",
  clear: "common",
};

/** 연습별 소모(견제, 등급 무관 고정) — 게이지 상승은 카드로만, 여기선 소모만 */
export const TRAIN_DRAIN: Record<TrainingId, Partial<Gauges>> = {
  vocal: { mental: -3 },
  dance: { mental: -3 },
  audition: { reputation: -3 }, // 오디션 보러 다니는 활동 공백 = 평판 견제 (멘탈 소모 4곳 편중 해소)
  funds: { mental: -2 },
  promo: { capital: -3 },
  bond: {}, // 휴식=회복형, 소모 없음
};

export interface TrainingResult {
  card: Card;
  drain: Partial<Gauges>;
}

/**
 * 연습 수행 결과:
 * - 카드 획득(등급 = 성적) → 덱 적립 대상
 * - drain(고정 소모) → 게이지 적용 대상
 * ※ 게이지 상승은 없음(상승은 관문에서 카드 사용 시).
 */
export function resolveTraining(activity: TrainingId, grade: MiniGameGrade): TrainingResult {
  return {
    card: { templateId: activity, grade: TRAIN_GRADE_TO_CARD[grade] },
    drain: TRAIN_DRAIN[activity],
  };
}
