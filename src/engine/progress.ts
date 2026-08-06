// engine/progress.ts — 런 진행 오케스트레이션. 순수 TS(렌더러 의존 0).
// 비트 소진 시 "회차로 결말을 고정": 1회차→회귀, 2회차→트루.
import type { Beat, State, RunEvent, GameConfig } from "./types";
import { pickNextBeat } from "./router";
import { isCollapsed } from "./gauges";

export interface AdvanceResult {
  event: RunEvent;
  cursor: number;
}

/**
 * 결말 고정 규칙:
 * - 1회차 종료 → 무조건 회귀(regress)
 * - 2회차 종료 → 무조건 데뷔 성공(ending:true)
 * (단서·저지 성공 여부와 무관하게 회차가 결말을 강제)
 */
export function resolveRunEnd(state: State): RunEvent {
  return state.loopCount === 1
    ? { type: "regress" }
    : { type: "ending", kind: "true" };
}

/**
 * 한 스텝 진행:
 * 1) 게이지 붕괴면 dark 엔딩(3단 사다리는 후속) — 단 2순위에선 붕괴=dark로만 표시
 * 2) 다음 비트가 있으면 beat
 * 3) 비트 소진이면 회차 기반 결말(resolveRunEnd)
 */
/**
 * 회귀 가속 판정 (빠른 수동 넘김).
 * 2회차에서 이미 본(seen) 비트는 true → UI가 축약 카드로 표시하고 탭 1회로 빠르게 넘김.
 * 새 비트(포착·loop:2)는 false → 정독. (실제 축약 렌더/배속은 UI 트랙 담당)
 */
export function isFastForward(state: State, seen: boolean): boolean {
  return state.loopCount === 2 && seen;
}

export function advance(beats: Beat[], state: State, cursor: number, config: GameConfig): AdvanceResult {
  if (isCollapsed(state.gauges, config)) {
    return { event: { type: "ending", kind: "dark" }, cursor };
  }
  const pick = pickNextBeat(beats, state, cursor);
  if (pick.beat) {
    return { event: { type: "beat", beat: pick.beat, seen: pick.seen }, cursor: pick.cursor };
  }
  return { event: resolveRunEnd(state), cursor };
}
