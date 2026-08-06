# 오디션 멤버 영입·교체 시스템 구현 계획 (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (인라인). git 레포 미생성 — 커밋 단계 전부 보류(Director가 레포 생성 후 일괄).

**Goal:** 오디션 카드 3장→진행권 교환, 📷 이벤트 후 멤버 점검 보드에서 오디션 개최·영입·교체, W18 자동충원+락인. 시안·하리는 후보 풀로 이동하고 서사는 role 토큰({helper2}/{mentor})으로 치환.

**Architecture:** 순수 엔진(engine/members.ts) + 컨트롤러 배선(runController) + 데이터 개편(beats/characters/tickets JSON) + 보드 UI(ui/memberBoard.ts, training.ts 패턴). 스펙: `docs/superpowers/specs/2026-07-28-audition-member-system-design.md` v3.

**Tech Stack:** TypeScript + PixiJS v8 + Vitest. dev 서버 5174.

## Global Constraints

- 스펙 v3의 결정 사항 전부 (Phase 1 = 오디션 슬롯 간 교체만, 하루·유월·보라 고정)
- 기량: 오디션 P80/G65/C50±5 · 막 관문 P+5/G+2/C−3 전원 · 연습 perfect +1 · clamp 0~100
- 락인: **week≥18 첫 비트 진입 시** 자동충원(잔여 후보 최고 기량)+membersLocked
- 교환 요구치는 `tickets.json`의 audition `cost`(=3)에서 읽기
- 영입 플래그: `cast_<characterId>` + `cast_role_<role>` 동시 기록
- 토큰화 비트 텍스트는 **조사(이/가) 충돌 회피** — 콜론·호칭 없는 문형으로 재작성 (후보 이름이 치환되므로)
- 커밋 금지(레포 미생성), 각 태스크 끝 `npx vitest run` + `npx tsc --noEmit`

---

### Task 1: 엔진 — 타입·상태·members.ts (TDD)

**Files:** Modify `src/engine/types.ts`, `src/engine/state.ts` / Create `src/engine/members.ts`, `tests/members.test.ts`

**Interfaces (Produces):**
```ts
// types.ts 추가
export interface MemberSlot { characterId: string; role: RoleId; stat: number; joinedWeek: number }
// RoleId에 "helper2" 추가, CharacterDef에 temp?: boolean (임시 후보 실루엣)
// Effect에 joinMember?: { characterId: string; role: RoleId; stat: number }
//        memberStat?: Record<string, number>  // 특정 멤버 기량 증감 (보라 각성 +20)
// State에 members: MemberSlot[]; membersLocked: boolean; candidateStats: Record<string, number>
```
```ts
// engine/members.ts (순수 TS)
export const LOCK_WEEK = 18;
export const FIXED_MEMBERS: ReadonlySet<string>; // haru·yuwol·bora
export const PHOTO_BEATS: ReadonlySet<string>;   // d2_w3_eval1·d2_w7_eval2·d2_w12_meme·d2_w17_fancam
export const AUDITION_STAT: Record<MiniGameGrade, number>; // 80/65/50
export const GATE_STAT_DELTA: Record<MiniGameGrade, number>; // +5/+2/−3
export function candidatePool(chars: CharacterDef[], state: State): CharacterDef[]; // helper2|mentor 적합 ∧ 비멤버
export function recruit(state: State, c: CharacterDef, stat: number): void; // role 배정+casting+cast_* 플래그
export function release(state: State, characterId: string): void; // 오디션 슬롯만, 풀 복귀(casting·플래그 해제)
export function lockIn(state: State, chars: CharacterDef[]): void; // 자동충원(candidateStats 최고, 기본 50)+locked
export function applyGateStat(state: State, grade: MiniGameGrade): void;    // 전원, clamp
export function applyTrainingStat(state: State, grade: MiniGameGrade): void; // perfect만 +1
```

- [x] Step 1: types.ts 추가 (위 정의 그대로)
- [x] Step 2: state.ts — createState에 `members: [{ characterId: "haru", role: "protagonist", stat: 65, joinedWeek: 0 }], membersLocked: false, candidateStats: {}`; applyEffect에 joinMember(중복·만석·락 가드, joinedWeek=state.week)·memberStat 처리; triggerRegression은 createState 재생성이라 자동 리셋(검증만)
- [x] Step 3: tests/members.test.ts 작성 — recruit가 casting/cast_플래그/members를 세움, release가 원복+FIXED 거부, lockIn이 최고 기량 자동충원+locked, applyGateStat clamp(0·100), applyTrainingStat perfect만, candidatePool이 멤버 제외, 회귀 후 멤버 리셋. 실패 확인
- [x] Step 4: members.ts 구현 → 테스트 통과. role 배정 = eligibleRoles 중 helper2|mentor이며 미캐스팅인 첫 역할, 없으면 helper2|mentor 중 첫 적합 역할

### Task 2: 데이터 — 비트 개편 + characters/tickets + data/index

**Files:** Modify `src/data/beats/demo2_zeroc.json`, `src/data/characters.json`, `src/data/tickets.json`, `src/data/index.ts`

- [x] characters.json: cyan eligibleRoles→`["helper2","fan"]`; 추가 `{"id":"rian","name":"리안","color":"#7FBFD6","eligibleRoles":["helper2","mentor"],"temp":true}`, `{"id":"daon","name":"다온","color":"#D6A57F","eligibleRoles":["helper2","mentor"],"temp":true}`
- [x] tickets.json: audition `cost` 4→3, effect는 `{}`(소모는 컨트롤러가 직접 — 기존 slot_open은 죽은 플래그)
- [x] data/index.ts: `export const characters`, `export const tickets` 추가 (characters.json/tickets.json import)
- [x] beats 편집 (배열 순서 유지, 정규 비트가 대체 비트보다 앞):
  1. `d2_w1_yuwol` 좌·우 effects에 `"joinMember":{"characterId":"yuwol","role":"helper","stat":70}`
  2. 신규 `d2_w1_ticket` (d2_w1_yuwol 뒤): {antiStaff} 진행권 지급, 좌·우 모두 `grantTickets:["audition"]`
  3. `d2_w2_cyan`·`d2_w2_hari` 삭제
  4. `d2_w3_bora` 좌·우에 `"joinMember":{"characterId":"bora","role":"helper","stat":60}` — role 충돌 없음(helper는 casting 미사용 슬롯, joinMember는 casting을 건드리지 않음)
  5. `d2_w17_fancam` 좌 effects에 `"memberStat":{"bora":20}` (각성 +20)
  6. `d2_w4_photo` 문구: "팀의 뼈대가 모였다. 첫 팀 사진 — 남은 자리는 우리 눈으로 채운다."
  7. helper2 토큰화(+requires.castRoles:["helper2"] 병합, 조사 회피 문형): d2_w5_cyan_online, d2_w8_cyan_guard, d2_w11_cyan_rap, d2_w13_obs3, d2_w13_clue3, d2_w21_team_join(문구 "{helper2}·유월…")
  8. mentor 토큰화(+castRoles:["mentor"]): d2_w6_hari_tip, d2_w10_hari_warn, d2_w14_hari_save, d2_w19_hari_probe, d2_w21_hari_dig, d2_w22_clue4
  9. `d2_w13_cyan_reveal` requires.flags → `["seed_cyan","cast_cyan"]` (문구는 시안 고유 유지)
  10. 대체 비트 신규(각 정규 비트 바로 뒤): `d2_w13_clue3_alt` (loop2, notFlags:["cast_role_helper2","clue_astroturf"], 하루·유월 직접 로그 분석, 효과 동일) / `d2_w21_team_join_alt` (flags:["team_investigate"], notFlags:["cast_role_helper2"], 유월 단독) / `d2_w22_clue4_alt` (loop2·isConvergence, flags 3단서, notFlags:["cast_role_mentor","clue_mastermind"], 루나 제보, 효과 동일)
- [x] 검증: `npx tsc --noEmit` + 전체 vitest (기존 86 유지)

### Task 3: runController 배선 (TDD)

**Files:** Modify `src/ui/runController.ts`, `tests/runController.test.ts`

**Interfaces (Produces):**
```ts
readonly memberWindowOpen: boolean;      // 📷 비트 통과 직후 true (락 후엔 락인 연출 1회)
closeMemberWindow(): void;
auditionExchangeCost: number;            // tickets의 audition cost
exchangeAudition(): boolean;             // 오디션 카드 cost장 소모 → deck.push("audition")
holdAudition(grade: MiniGameGrade): CharacterDef | null; // 진행권 소모, 풀 랜덤 후보+기량 산정(candidateStats 기록)
recruitCandidate(characterId: string, releaseId?: string): void; // 만석 시 releaseId 필수(오디션 슬롯)
```

- [x] Step 1: 테스트 — 📷 비트 choose 후 memberWindowOpen; week≥18 step에서 락인+자동충원; exchange가 audition 카드 3장 소모+티켓 지급(부족 시 false); holdAudition이 티켓 소모+후보 반환; 관문 resolveGate 후 전원 기량 변동; finishTraining perfect 시 +1. 실패 확인
- [x] Step 2: 구현 — choose()에서 PHOTO_BEATS && !locked → window=true; step()에서 week≥18 && !locked → lockIn+락인 연출용 window=true 1회; doFinishGate에 grade 전달(resolveGate/finishGate(grade?) 시그니처 확장, applyGateStat); applyTraining에 applyTrainingStat; 신규 메서드들(멤버 조작은 members.ts 위임). regress 시 window 리셋
- [x] Step 3: 전체 vitest 통과

### Task 4: UI — 멤버 보드 + 오디션 씬 + 토큰 렌더 병합

**Files:** Create `src/ui/memberBoard.ts` / Modify `src/ui/app.ts`

- [x] memberBoard.ts: training.ts 패턴(dim+패널+헤더). 뷰 3개 — ①점검: 슬롯 5개(이름·role 라벨·기량 막대, 고정 멤버 "데뷔조 핵심" 배지, temp 후보 실루엣 톤)+후보 풀+[🎴×N → 진행권 교환]+[🎤 오디션 개최]+닫기; 락인 시 "🎉 데뷔조 확정" 배너만+닫기 ②오디션: mountEngine rps 재사용, 타이틀 "🎤 신인 오디션 — 무대 위 승부" ③결과: 후보 카드(이름·기량)+[영입]/[보류]; 만석이면 영입 → 오디션 슬롯 멤버 중 방출 선택 후 교체. onChanged로 HUD 갱신
- [x] app.ts: draw 우선순위 — freeTraining 다음, 주간 연습 앞에 `if (c.memberWindowOpen) { renderMemberBoard(...); return; }`; renderCard casting 병합 `{...casting, ...castingNames(c.state.casting)}` (characters로 id→이름, helper2/mentor 토큰); 치트 "🎤 오디션 재료 (카드3+진행권)" 추가(gameOnly)
- [x] 검증: tsc + vitest

### Task 5: 전체 검증 (E2E)

- [x] `npx vitest run` 전체 + `npx tsc --noEmit`
- [x] playwright-core(chrome headless 430×800) E2E: 게임 진입 → 치트로 재료 지급 → W3 📷 통과 → 보드 오픈 확인 → 교환·오디션·영입 → (치트 진행) week18 락인 확인
- [x] 콘텐츠 경로: 미영입 런에서 clue3_alt/clue4_alt 도달 가능 확인 (라우터 유닛으로 대체 가능)

## Self-Review
- 스펙 v3 전 항목 커버 (A→T1, B→T2/T3, C→T4, D→T2, E→T1/T2/T4, F→T5) ✓
- 시그니처 일관성: members.ts ↔ controller ↔ board ✓
- 플레이스홀더 없음 ✓
