// engine/minigames.ts — 미니게임 판정·스케일·보상. 순수 TS(렌더러 의존 0).
// 스펙: 통합안1 §5.5(관문·등급 배율) · §5.7(막 기준 난이도 스케일)
import type { MiniGameGrade, GateDef, Gauges, GaugeId } from "./types";

/** 짝맞추기 카드 수 (막 기준). 홀수(2막 9)는 조커 1장 포함 */
export const MATCH_CARDS: Record<number, number> = { 1: 6, 2: 6, 3: 9, 4: 9, 5: 9 }; // 그리드 2종(2×3=6장 · 3×3=9장)으로 축소 — 배경판 슬롯과 1:1

/** 타이밍 STOP 횟수 (막 기준) */
export const STOP_ROUNDS: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 4 };

/** 등급 → 보상 배율 / 포인트 */
export const GRADE_REWARD_MULT: Record<MiniGameGrade, number> = { perfect: 1.5, good: 1.0, clear: 0.6 };
export const GRADE_POINTS: Record<MiniGameGrade, number> = { perfect: 3, good: 2, clear: 1 };

export const JOKER = "🃏"; // 홀수 덱의 단독 매칭 카드

// ── 가위바위포즈 (3판 2선) ──
export type RpsHand = 0 | 1 | 2; // 바위·보·가위

export function rpsBeats(a: RpsHand, b: RpsHand): boolean {
  return (a === 0 && b === 2) || (a === 1 && b === 0) || (a === 2 && b === 1);
}

/** 3판 종료 후 승수 → 등급. 2승 미만이면 실패(null, 재도전) */
export function rpsGrade(wins: number): MiniGameGrade | null {
  if (wins >= 3) return "perfect";
  if (wins === 2) return "good";
  return null;
}

// ── 타이밍 STOP ──
/** 중앙 거리(0~50) → 존 판정 */
export function stopZone(dist: number): "perfect" | "good" | "miss" {
  if (dist <= 6) return "perfect";
  if (dist <= 18) return "good";
  return "miss";
}

/** 다회전 종합: miss 하나라도 있으면 실패(null), 전부 perfect=perfect, 그 외 good */
export function stopGrade(zones: Array<"perfect" | "good" | "miss">): MiniGameGrade | null {
  if (zones.includes("miss")) return null;
  return zones.every((z) => z === "perfect") ? "perfect" : "good";
}

// ── 짝맞추기 ──
/** 틀린 횟수 → 등급 (실패 없음) */
export function matchGrade(misses: number): MiniGameGrade {
  if (misses === 0) return "perfect";
  if (misses <= 2) return "good";
  return "clear";
}

/** 덱 생성: count 짝수=쌍만, 홀수=쌍+조커 1장. rand 주입(테스트 재현성) */
export function buildMatchDeck(count: number, symbols: string[], rand: () => number): string[] {
  const pairs = Math.floor(count / 2);
  const deck: string[] = [];
  for (let i = 0; i < pairs; i++) {
    const s = symbols[i % symbols.length] ?? "?";
    const suffix = i >= symbols.length ? String(Math.floor(i / symbols.length)) : ""; // 심볼 부족 시 변형
    deck.push(s + suffix, s + suffix);
  }
  if (count % 2 === 1) deck.push(JOKER);
  // Fisher–Yates (rand 주입)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = deck[i];
    const b = deck[j];
    if (a !== undefined && b !== undefined) {
      deck[i] = b;
      deck[j] = a;
    }
  }
  return deck;
}

// ── 보상 ──
/** 관문 보상: 굿 기준 gauges × 등급 배율(반올림, 최소 1) + 포인트 */
export function gateReward(gate: GateDef, grade: MiniGameGrade): { gauges: Partial<Gauges>; points: number } {
  const mult = GRADE_REWARD_MULT[grade];
  const gauges: Partial<Gauges> = {};
  for (const k of Object.keys(gate.gauges) as GaugeId[]) {
    gauges[k] = Math.max(1, Math.round((gate.gauges[k] ?? 0) * mult));
  }
  return { gauges, points: GRADE_POINTS[grade] };
}

// ── 스테이지 게임 ① 3릴 슬롯 (심볼 3종·와일드 없음: P 11.1% / G 66.7% / C 22.2%) ──
export const SLOT_SYMBOL_COUNT = 3; // 🎤🎵👠 — UI 스킨 소관
export const SLOT_SPINS = 3;        // 라운드당 스핀 수 (리롤 후 수동 확정)

/** 3릴 결과 → 등급: 3일치 perfect / 2일치 good / 그외 clear (꽝 없음 — 최소 clear) */
export function slotGrade(a: number, b: number, c: number): MiniGameGrade {
  if (a === b && b === c) return "perfect";
  if (a === b || b === c || a === c) return "good";
  return "clear";
}

// ── 스테이지 게임 ② 리듬 (좌우 2레인 낙하) ──
export const RHYTHM_MS = 30_000;      // 플레이 길이
export const RHYTHM_TRAVEL_MS = 1600; // 노트 출현→판정선 도달
export const RHYTHM_PERFECT_MS = 80;  // stopZone 시간판
export const RHYTHM_GOOD_MS = 180;
export const RHYTHM_LATE_MS = 200;    // 판정선 지나침 → miss
/** 노트 간격(ms) — 막이 오를수록 촘촘 (1→2막 800 / 2→3막 640) */
export const RHYTHM_NOTE_IV: Record<number, number> = { 2: 800, 3: 640 };

/** 판정 허용 오차 프리셋 (tuning.rhythmJudge) — late(놓침 확정)는 good + 20ms */
export const RHYTHM_JUDGE_PRESETS: Record<"loose" | "normal" | "tight", { perfect: number; good: number }> = {
  loose: { perfect: 120, good: 240 },
  normal: { perfect: RHYTHM_PERFECT_MS, good: RHYTHM_GOOD_MS },
  tight: { perfect: 50, good: 120 },
};

/** 탭 시점 오차 → 판정 (null = 판정창 밖: 허공 탭, 무시). 판정창은 프리셋으로 조정 가능 */
export function rhythmJudge(dtMs: number, perfectMs = RHYTHM_PERFECT_MS, goodMs = RHYTHM_GOOD_MS): "perfect" | "good" | null {
  const a = Math.abs(dtMs);
  if (a <= perfectMs) return "perfect";
  if (a <= goodMs) return "good";
  return null;
}

/** 성공률 (P+G)/전체 → 등급: ≥80% perfect / ≥50% good / 그외 clear */
export function rhythmGrade(perfect: number, good: number, total: number): MiniGameGrade {
  if (total <= 0) return "clear";
  const r = (perfect + good) / total;
  if (r >= 0.8) return "perfect";
  if (r >= 0.5) return "good";
  return "clear";
}

// ── 스테이지 게임 ③ 격자 회피 (Reigns: The Witcher 전투형 — 턴제·대기 없음) ──
export const DODGE_COLS = 5;
export const DODGE_ROWS = 5;
export const DODGE_P_HEARTS = 5; // 플레이어 시작 하트
export const DODGE_E_HEARTS = 3; // 적(진범의 그림자) 하트
export type DodgeTile = "bomb" | "atk" | "heal" | "shield";
/** 타일 스폰 가중치: 💥사보타주 52 / ✨스포트라이트 28 / 💖응원 12 / 🛡매니저 8 */
export const DODGE_SPAWN: Array<[DodgeTile, number]> = [
  ["bomb", 0.52], ["atk", 0.28], ["heal", 0.12], ["shield", 0.08],
];
/** 턴당 2번째 타일 스폰 확률 — 막이 오를수록 증가 (4→5막 0.45 / 5막 저지 0.6) */
export const DODGE_SECOND_TILE: Record<number, number> = { 4: 0.45, 5: 0.6 };

/** 난수 1개(0~1) → 스폰 타일 */
export function dodgePickTile(rand: number): DodgeTile {
  let acc = 0;
  for (const [t, w] of DODGE_SPAWN) {
    acc += w;
    if (rand < acc) return t;
  }
  return "bomb";
}

/** 남은 하트 → 등급 (null = 하트 0: 실패, 재도전 대상) */
export function dodgeGrade(hearts: number): MiniGameGrade | null {
  if (hearts <= 0) return null;
  if (hearts >= DODGE_P_HEARTS) return "perfect";
  if (hearts >= 3) return "good";
  return "clear";
}
