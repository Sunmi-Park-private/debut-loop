// engine/router.ts — 회차 필터 + 진입조건 + forward-cursor 라우팅. 순수 TS.
import type { Beat, State, Requires, GaugeId } from "./types";

/** 회차 필터: loop 미지정=공통(양 회차), 지정=해당 회차에서만 노출 */
export function loopOk(beat: Beat, state: State): boolean {
  return beat.loop === undefined || beat.loop === state.loopCount;
}

/** 비트 진입 조건 충족 여부 */
export function meets(state: State, r?: Requires): boolean {
  if (!r) return true;
  if (r.flags && !r.flags.every((f) => state.flags.has(f))) return false;
  if (r.notFlags && r.notFlags.some((f) => state.flags.has(f))) return false;
  if (r.castRoles && !r.castRoles.every((role) => role in state.casting)) return false;
  if (r.ownTickets && !r.ownTickets.every((t) => state.deck.includes(t))) return false;
  if (r.gauge) {
    for (const k of Object.keys(r.gauge) as GaugeId[]) {
      const range = r.gauge[k];
      if (!range) continue;
      const [min, max] = range;
      const v = state.gauges[k];
      if (v < min || v > max) return false;
    }
  }
  return true;
}

export interface PickResult {
  beat: Beat | null;
  cursor: number; // 다음 탐색 시작 위치
  seen: boolean; // 이전 회차에 본 비트인가(회귀 가속 대상)
}

/**
 * cursor부터 순회해 [미진행 + 회차 일치 + 진입조건 충족] 첫 비트 반환.
 * seen=true 면 UI가 회귀 가속(빠른 넘김)을 적용.
 */
export function pickNextBeat(beats: Beat[], state: State, cursor: number): PickResult {
  for (let i = cursor; i < beats.length; i++) {
    const b = beats[i];
    if (!b) continue;
    if (state.played.has(b.id)) continue;
    if (!loopOk(b, state)) continue;
    if (!meets(state, b.requires)) continue;
    return { beat: b, cursor: i + 1, seen: state.seenBeats.has(b.id) };
  }
  return { beat: null, cursor, seen: false };
}

/** 진행 기록 */
export function markPlayed(state: State, beatId: string): void {
  state.played.add(beatId);
}
