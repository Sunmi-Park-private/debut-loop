// ui/runStatus.ts — 런 진행 표기 SSOT. 로비 상태 패널과 본스토리 상단 탭이 같은 계산·같은 문구를 쓴다.
// 화면마다 따로 계산하다 D-day 단위가 갈라진 적이 있어(로비=일, 스토리=주) 여기로 모았다.

export interface RunStatus {
  loop: number;      // 회차
  week: number;      // 현재 주차
  debutWeek: number; // 데뷔 주차
  cards: number;     // 보유 카드 장수
  clues?: number;    // 단서 (0이면 미표시)
}

/** 데뷔까지 남은 **주**. 게임이 주차로 진행하므로 D-day도 주 단위다 */
export const ddayWeeks = (debutWeek: number, week: number): number => Math.max(0, debutWeek - week);

/** 상단 진행 표기 한 줄 — "N회차 · Wn · D-n · 카드 N (· 🔍 n/4)" */
export function statusLine(s: RunStatus): string {
  const clue = s.clues && s.clues > 0 ? ` · 🔍 ${s.clues}/4` : "";
  return `${s.loop}회차 · W${s.week} · D-${ddayWeeks(s.debutWeek, s.week)} · 카드 ${s.cards}${clue}`;
}
