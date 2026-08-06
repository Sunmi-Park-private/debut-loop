// engine/members.ts — 오디션 멤버 영입·교체·락인. 순수 TS(렌더러 의존 0).
// 스펙: docs/superpowers/specs/2026-07-28-audition-member-system-design.md v3
import type { State, CharacterDef, MiniGameGrade, RoleId } from "./types";

export const MAX_MEMBERS = 5;
export const LOCK_WEEK = 18; // week≥18 첫 비트 진입 시 자동충원+락인
export const FIXED_MEMBERS: ReadonlySet<string> = new Set(["haru", "yuwol", "bora"]); // Phase 1 교체 불가
export const PHOTO_BEATS: ReadonlySet<string> = new Set([
  "d2_w3_eval1", "d2_w7_eval2", "d2_w12_meme", "d2_w17_fancam", // 막별 📷 이벤트 → 멤버 점검 윈도우
]);
export const AUDITION_STAT: Record<MiniGameGrade, number> = { perfect: 80, good: 65, clear: 50 };
export const GATE_STAT_DELTA: Record<MiniGameGrade, number> = { perfect: 5, good: 2, clear: -3 };
export const DEFAULT_CANDIDATE_STAT = 50; // 오디션 기록 없는 후보의 자동충원 기준

const AUDITION_ROLES: RoleId[] = ["helper2", "mentor"];
/** 오디션 등장 순서 — 플레이어가 먼저 알게 되는 캐릭터부터 (가칭 캐릭터는 뒤로).
 *  목록에 없는 후보는 뒤쪽에 붙는다 (캐릭터 추가 시 자동 대응) */
export const AUDITION_ORDER: readonly string[] = ["hari", "cyan", "rian", "daon"];
/** 등장 순서 인덱스 — 정렬·선정 공용 (미지정 캐릭터는 목록 뒤) */
export const auditionRank = (characterId: string): number => {
  const i = AUDITION_ORDER.indexOf(characterId);
  return i < 0 ? AUDITION_ORDER.length : i;
};
const clampStat = (v: number): number => Math.max(0, Math.min(100, v));

/** 오디션 후보 풀: helper2·mentor 적합 캐릭터 중 현재 비멤버 (방출자 자동 복귀, '버리기'한 후보 제외).
 *  등장 순서(AUDITION_ORDER)로 정렬 — 오디션·보드 안내 모두 같은 순서를 보게 된다 */
export function candidatePool(chars: CharacterDef[], state: State): CharacterDef[] {
  const inTeam = new Set(state.members.map((m) => m.characterId));
  return chars.filter((c) =>
    !inTeam.has(c.id) && !state.droppedCandidates.has(c.id)
    && c.eligibleRoles.some((r) => AUDITION_ROLES.includes(r)))
    .sort((a, b) => auditionRank(a.id) - auditionRank(b.id));
}

/** 보드에서 후보 '버리기' — 이번 회차 풀·오디션·자동충원에서 제외 (회귀 시 복귀) */
export function dropCandidate(state: State, characterId: string): void {
  if (state.members.some((m) => m.characterId === characterId)) return; // 멤버는 방출(release) 경유
  state.droppedCandidates.add(characterId);
}

/** role 배정: 적합 role 중 미캐스팅 우선, 모두 차 있으면 첫 적합 role(교체 진입용) */
function pickRole(c: CharacterDef, state: State): RoleId | null {
  const fits = c.eligibleRoles.filter((r) => AUDITION_ROLES.includes(r));
  return fits.find((r) => !(r in state.casting)) ?? fits[0] ?? null;
}

/** 영입: 멤버 push + casting 등록 + cast_<id>·cast_role_<role> 플래그 (단서 대체 비트 배타 근거) */
export function recruit(state: State, c: CharacterDef, stat: number): void {
  if (state.membersLocked || state.members.length >= MAX_MEMBERS) return;
  if (state.members.some((m) => m.characterId === c.id)) return;
  const role = pickRole(c, state);
  if (!role) return;
  state.members.push({ characterId: c.id, role, stat: clampStat(stat), joinedWeek: state.week });
  state.casting[role] = c.id;
  state.flags.add(`cast_${c.id}`);
  state.flags.add(`cast_role_${role}`);
  state.candidateStats[c.id] = clampStat(stat);
}

/** 방출: 오디션 슬롯만. casting·플래그 원복 → 후보 풀 자동 복귀 */
export function release(state: State, characterId: string): void {
  if (state.membersLocked || FIXED_MEMBERS.has(characterId)) return;
  const i = state.members.findIndex((m) => m.characterId === characterId);
  if (i < 0) return;
  const [gone] = state.members.splice(i, 1);
  if (!gone) return;
  if (state.casting[gone.role] === characterId) delete state.casting[gone.role];
  state.flags.delete(`cast_${characterId}`);
  state.flags.delete(`cast_role_${gone.role}`);
  state.candidateStats[characterId] = gone.stat; // 최신 기량 보존 (재영입·자동충원 근거)
}

/** W18 락인: 빈 슬롯을 잔여 후보 최고 기량(미기록=50)으로 자동충원 후 잠금 */
export function lockIn(state: State, chars: CharacterDef[]): void {
  if (state.membersLocked) return;
  const byStat = candidatePool(chars, state)
    .sort((a, b) => (state.candidateStats[b.id] ?? DEFAULT_CANDIDATE_STAT) - (state.candidateStats[a.id] ?? DEFAULT_CANDIDATE_STAT));
  for (const c of byStat) {
    if (state.members.length >= MAX_MEMBERS) break;
    recruit(state, c, state.candidateStats[c.id] ?? DEFAULT_CANDIDATE_STAT);
  }
  state.membersLocked = true;
}

/** 막 관문 성적 → 전원 기량 변동 */
export function applyGateStat(state: State, grade: MiniGameGrade): void {
  for (const m of state.members) m.stat = clampStat(m.stat + GATE_STAT_DELTA[grade]);
}

/** 주간 연습 perfect → 전원 +1 (보조 소스) */
export function applyTrainingStat(state: State, grade: MiniGameGrade): void {
  if (grade !== "perfect") return;
  for (const m of state.members) m.stat = clampStat(m.stat + 1);
}
