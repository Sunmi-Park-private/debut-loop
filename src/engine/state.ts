// engine/state.ts — 런 상태 생성/변형/회귀. 순수 TS(렌더러 의존 0).
import type { State, GameConfig, GaugeId, Effect, Tuning, Card } from "./types";
import { clampGauges } from "./gauges";

export const DEFAULT_TUNING: Tuning = {
  cardCarryOver: 3,
  stopSpeedBase: 1.4,
  stopSpeedPerAct: 0.3,
  rhythmSpeedMult: 1,
  rhythmJudge: "normal",
};

/** 회귀 시 계승하는 플래그 접두사 = 기시감(파편 기억) */
export const MEMORY_FLAG_PREFIX = "memory_";

/** 1회차 시작 카드 — 덱이 완전히 비어 있으면 카드가 무엇인지 배울 계기가 없어 한 장만 쥐어준다.
 *  회귀(2회차)는 계승분(cardCarryOver)으로 시작하므로 여기서 다시 주지 않는다. */
export const STARTER_CARDS: Card[] = [
  { templateId: "bond", grade: "common", gauge: "mental" }, // 멘탈 +5
];

type DifficultyId = "small" | "big";

/** 새 런 상태(1회차) 생성 */
export function createState(config: GameConfig, difficultyId: DifficultyId, seed = 0): State {
  const diff = config.difficulties[difficultyId];
  return {
    week: 0,
    act: 0,
    gauges: { ...diff.startGauges },
    flags: new Set<string>(),
    deck: [],
    casting: {},
    clues: new Set<string>(),
    points: 0,
    demotions: 0,
    seed,
    loopCount: 1,
    seenBeats: new Set<string>(),
    played: new Set<string>(),
    choices: {},
    cards: STARTER_CARDS.map((c) => ({ ...c })), // 복사 — 런 간 공유 금지
    members: [{ characterId: "haru", role: "protagonist", stat: 65, joinedWeek: 0 }],
    membersLocked: false,
    candidateStats: {},
    droppedCandidates: new Set<string>(),
  };
}

/** 비트/티켓 선택 효과를 상태에 적용 (in-place) */
export function applyEffect(state: State, e: Effect | undefined, config: GameConfig): void {
  if (!e) return;
  if (e.gauges) {
    for (const k of Object.keys(e.gauges) as GaugeId[]) {
      state.gauges[k] = (state.gauges[k] ?? 0) + (e.gauges[k] ?? 0);
    }
    clampGauges(state.gauges, config);
  }
  e.flags?.forEach((f) => state.flags.add(f));
  e.clearFlags?.forEach((f) => state.flags.delete(f));
  e.grantTickets?.forEach((t) => state.deck.push(t));
  if (e.consumeTickets) {
    const remove = new Set(e.consumeTickets);
    state.deck = state.deck.filter((t) => !remove.has(t));
  }
  if (e.addClue) state.clues.add(e.addClue);
  if (e.points) state.points += e.points;
  if (e.joinMember && !state.membersLocked && state.members.length < 5
    && !state.members.some((m) => m.characterId === e.joinMember?.characterId)) {
    state.members.push({ ...e.joinMember, joinedWeek: state.week });
  }
  if (e.memberStat) {
    for (const m of state.members) {
      const d = e.memberStat[m.characterId];
      if (d !== undefined) m.stat = Math.max(0, Math.min(100, m.stat + d));
    }
  }
}

/**
 * 1회차 종료 → 회귀(2회차 진입).
 * - 기시감(memory_*) 플래그만 계승 (파편 기억 누적)
 * - 카드는 tuning.cardCarryOver 개수만큼 계승 (앞에서부터 N장 — 데이브 더 다이버식, 에디터로 조정)
 * - 단서·게이지·티켓·일반 플래그는 리셋
 * - 이번 회차에 본 비트(played)를 seenBeats에 누적 → 회귀 가속용
 * 결말 고정: 항상 loopCount=2 로만 진입(3회차+는 본선 확장).
 */
export function triggerRegression(
  state: State,
  config: GameConfig,
  difficultyId: DifficultyId,
  tuning: Tuning = DEFAULT_TUNING,
): State {
  const carriedMemory = [...state.flags].filter((f) => f.startsWith(MEMORY_FLAG_PREFIX));
  const seen = new Set<string>([...state.seenBeats, ...state.played]);
  const next = createState(config, difficultyId, state.seed);
  next.loopCount = 2;
  next.seenBeats = seen;
  carriedMemory.forEach((f) => next.flags.add(f));
  const keep = Math.min(state.cards.length, Math.max(0, Math.floor(tuning.cardCarryOver)));
  next.cards = state.cards.slice(0, keep);
  next.choices = { ...state.choices }; // 선택 방향 계승 (빠른 모드 탭 재적용용)
  return next;
}
