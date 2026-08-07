// ui/runController.ts — 순수 런 오케스트레이션 (Pixi 의존 0). v4: 오디션 멤버 배선.
import type { Beat, State, GameConfig, RunEvent, GateDef, MiniGameGrade, Tuning, TrainingId, Gauges, CardTemplate, CharacterDef } from "../engine/types";
import { createState, applyEffect, triggerRegression, DEFAULT_TUNING } from "../engine/state";
import { markPlayed } from "../engine/router";
import { advance, isFastForward } from "../engine/progress";
import { isCollapsed } from "../engine/gauges";
import { GRADE_POINTS } from "../engine/minigames";
import { resolveTraining } from "../engine/training";
import { addCard, removeCards } from "../engine/deck";
import { gatePickCount, resolveGate as sumCardEffects } from "../engine/gate";
import { candidatePool, recruit, release, lockIn, applyGateStat, applyTrainingStat, dropCandidate, PHOTO_BEATS, LOCK_WEEK, AUDITION_STAT } from "../engine/members";
import { cardTemplates, characters, tickets } from "../data";

export interface RunController {
  readonly state: State;
  readonly current: Beat | null;
  readonly seen: boolean;              // 현재 비트가 회귀 가속 대상인가
  readonly ended: RunEvent | null;     // regress | ending 발생 시 세팅
  readonly pendingGate: GateDef | null; // 관문 진행 중이면 세팅 (비트 진행 차단)
  choose(dir: "left" | "right"): void;
  regress(): void;                     // 회귀 실행 → 2회차 재시작
  resolveGate(grade: MiniGameGrade, pickedIndices: number[]): void; // 관문 원샷 클리어 (settle + finish) — 치트·테스트용
  /** 라운드 즉시 정산: 선택 카드 게이지 적용·소모 + ⭐ — 인덱스는 현재 덱 기준. 적용 델타 반환(HUD bump용) */
  settleGateRound(grade: MiniGameGrade, picked: number[]): Partial<Gauges>;
  /** 관문 완료: 티켓 지급(1회) + 진행 재개 — 모든 라운드 정산 후 호출 */
  finishGate(): void;
  retryGate(): void;                   // 관문 실패 재도전 (멘탈 −1)
  skipGate(): void;                    // 관문 종료(포기) — 보상 없이 진행 재개
  forceGate(gate: GateDef): void;      // 개발 치트: 관문 즉시 실행 (실제 플로우 재사용)
  finishTraining(activity: TrainingId, grade: MiniGameGrade): void; // 연습 비트 완료: 카드(클리어 제외)+소모+진행
  skipTraining(): void;                // 연습 비트 건너뛰기 (소모·카드 없이 진행)
  retryTraining(): void;               // 연습 실패 재도전 (멘탈 −1)
  trainFree(activity: TrainingId, grade: MiniGameGrade): void;      // 자유 연습(상시 버튼): 비트 진행 없음
  // ── 오디션 멤버 (📷 이벤트 윈도우 · W18 락인) ──
  readonly memberWindowOpen: boolean;  // 멤버 점검 보드 오픈 (📷 통과 직후 / 락인 연출 1회)
  closeMemberWindow(): void;
  readonly auditionExchangeCost: number;               // 카드→진행권 교환 요구치 (tickets.json cost)
  exchangeAudition(): boolean;                         // 오디션 카드 cost장 소모 → 진행권 지급
  holdAudition(grade: MiniGameGrade): { char: CharacterDef; stat: number } | null; // 진행권 소모 → 풀 랜덤 후보
  recruitCandidate(characterId: string, releaseId?: string): boolean; // 영입 (만석이면 releaseId 방출 후)
  dropCandidate(characterId: string): void; // 보류 후보 '버리기' — 이번 회차 풀에서 제외
}

export function createRunController(
  beats: Beat[],
  config: GameConfig,
  difficulty: "small" | "big",
  gateDefs: GateDef[] = [],
  tuning: Tuning = DEFAULT_TUNING,
): RunController {
  let state = createState(config, difficulty);
  let cursor = 0;
  let current: Beat | null = null;
  let seen = false;
  let ended: RunEvent | null = null;
  let pendingGate: GateDef | null = null;
  const gatesDone = new Set<string>(); // 런(회차) 단위 — regress 시 리셋
  let memberWindow = false;            // 멤버 점검 보드 오픈 상태
  let gateGrade: MiniGameGrade | null = null; // 이번 관문 최고 성적 (완료 시 기량 1회 반영)
  const AUD_COST = tickets.find((t) => t.id === "audition")?.cost ?? 3;
  const GRADE_RANK: Record<MiniGameGrade, number> = { clear: 0, good: 1, perfect: 2 };

  /** 현재 비트에 걸리는 미완료 관문 탐색 (막 진입 or 비트 지정) */
  const checkGates = (): GateDef | null => {
    if (!current) return null;
    for (const g of gateDefs) {
      if (gatesDone.has(g.id)) continue;
      if (g.trigger.act !== undefined && current.act >= g.trigger.act) return g;
      if (g.trigger.beatId !== undefined && g.trigger.beatId === current.id) return g;
    }
    return null;
  };

  /** 라운드 즉시 정산 — 등급 = 선택 가능 장수(초과는 앞에서부터), 카드는 그 자리에서 소모 */
  const doSettleGateRound = (grade: MiniGameGrade, picked: number[]): Partial<Gauges> => {
    if (!pendingGate) return {};
    const allowed = [...new Set(picked)]
      .filter((i) => i >= 0 && i < state.cards.length)
      .slice(0, gatePickCount(grade));
    const chosen = allowed
      .map((i) => state.cards[i])
      .filter((c): c is NonNullable<typeof c> => c !== undefined);
    const delta = sumCardEffects(chosen, cardTemplates); // 선택 카드 효과 합산 → 게이지
    applyEffect(state, { gauges: delta, points: GRADE_POINTS[grade] }, config);
    state.cards = removeCards(state.cards, allowed);
    if (gateGrade === null || GRADE_RANK[grade] > GRADE_RANK[gateGrade]) gateGrade = grade;
    return delta;
  };

  /** 관문 완료 — 티켓 1회 지급 + 성적→전원 기량 변동(1회) + 진행 재개 */
  const doFinishGate = (): void => {
    if (!pendingGate) return;
    applyEffect(state, { grantTickets: [pendingGate.ticket] }, config);
    if (gateGrade) applyGateStat(state, gateGrade);
    gateGrade = null;
    gatesDone.add(pendingGate.id);
    pendingGate = checkGates(); // 같은 비트에 남은 관문 재확인
  };

  const step = (): void => {
    const r = advance(beats, state, cursor, config);
    cursor = r.cursor;
    if (r.event.type === "beat") {
      current = r.event.beat;
      seen = isFastForward(state, r.event.seen);
      state.act = current.act; // 주차/막 동기화 (캘린더·엔딩 판정의 기반)
      if (current.week !== undefined) state.week = current.week;
      if (!state.membersLocked && state.week >= LOCK_WEEK) {
        lockIn(state, characters); // W18 데뷔조 락인: 자동충원 + 확정 연출 1회
        memberWindow = true;
      }
      pendingGate = checkGates();
    } else {
      current = null;
      seen = false;
      ended = r.event;
    }
  };
  step();

  return {
    get state() { return state; },
    get current() { return current; },
    get seen() { return seen; },
    get ended() { return ended; },
    get pendingGate() { return pendingGate; },
    choose(dir) {
      if (!current || pendingGate) return; // 관문 중엔 비트 진행 차단
      state.choices[current.id] = dir;
      applyEffect(state, current[dir].effects, config);
      markPlayed(state, current.id);
      if (PHOTO_BEATS.has(current.id) && !state.membersLocked) memberWindow = true; // 📷 직후 점검 윈도우
      step();
    },
    regress() {
      if (ended?.type !== "regress") return;
      state = triggerRegression(state, config, difficulty, tuning);
      cursor = 0;
      ended = null;
      gatesDone.clear(); // 관문은 회차마다 반복
      memberWindow = false;
      gateGrade = null;
      step();
    },
    resolveGate(grade, pickedIndices) {
      doSettleGateRound(grade, pickedIndices);
      doFinishGate();
    },
    settleGateRound(grade, picked) {
      return doSettleGateRound(grade, picked);
    },
    finishGate() {
      doFinishGate();
    },
    skipGate() {
      if (!pendingGate) return;
      gatesDone.add(pendingGate.id); // 보상 없이 완료 처리
      pendingGate = checkGates();
    },
    forceGate(gate) {
      if (ended) return;
      gatesDone.delete(gate.id); // 재실행 허용
      pendingGate = gate;
    },
    retryGate() {
      if (!pendingGate) return;
      applyRetryPenalty();
    },
    finishTraining(activity, grade) {
      if (!current?.training) return;
      applyTraining(activity, grade);
      markPlayed(state, current.id);
      step();
    },
    skipTraining() {
      if (!current?.training) return;
      markPlayed(state, current.id);
      step();
    },
    retryTraining() {
      // 연습 비트·자유 연습 공용 재도전 페널티
      applyRetryPenalty();
    },
    trainFree(activity, grade) {
      if (ended) return;
      applyTraining(activity, grade);
    },
    get memberWindowOpen() { return memberWindow; },
    closeMemberWindow() { memberWindow = false; },
    get auditionExchangeCost() { return AUD_COST; },
    exchangeAudition() {
      const idxs: number[] = [];
      state.cards.forEach((c, i) => { if (c.templateId === "audition" && idxs.length < AUD_COST) idxs.push(i); });
      if (idxs.length < AUD_COST) return false;
      state.cards = removeCards(state.cards, idxs);
      applyEffect(state, { grantTickets: ["audition"] }, config);
      return true;
    },
    holdAudition(grade) {
      if (state.membersLocked) return null;
      const ti = state.deck.indexOf("audition");
      if (ti < 0) return null;
      const pool = candidatePool(characters, state); // 등장 순서(AUDITION_ORDER)로 정렬돼 옴
      // 미측정(처음 보는) 후보 우선 — 진행권을 여러 장 써서 후보를 전부 만나볼 수 있게.
      // 전원 측정됐으면 기존 후보 재오디션(기량 갱신).
      const fresh = pool.filter((c) => state.candidateStats[c.id] === undefined);
      const pick = fresh.length > 0 ? fresh : pool;
      // 랜덤 대신 등장 순서 선두 — 플레이어가 이미 아는 캐릭터부터 영입 기회를 준다.
      // 재오디션(전원 측정 후)은 순서 선두를 다시 심사 = 기량 갱신 대상도 예측 가능
      const char = pick[0];
      if (!char) return null;
      state.deck.splice(ti, 1); // 진행권 1장만 소모 (consumeTickets는 동일 id 전량 제거라 부적합)
      const stat = Math.max(0, Math.min(100, AUDITION_STAT[grade] + Math.floor(Math.random() * 11) - 5));
      state.candidateStats[char.id] = stat;
      return { char, stat };
    },
    recruitCandidate(characterId, releaseId) {
      if (state.membersLocked) return false;
      const char = characters.find((c) => c.id === characterId);
      if (!char) return false;
      if (state.members.length >= 5) {
        if (!releaseId) return false;
        release(state, releaseId);
        if (state.members.length >= 5) return false; // 방출 실패(고정 멤버 등)
      }
      recruit(state, char, state.candidateStats[characterId] ?? 50);
      return state.members.some((m) => m.characterId === characterId);
    },
    dropCandidate(characterId) {
      dropCandidate(state, characterId);
    },
  };

  /** 연습 결과 반영: 카드(클리어 제외) + 고정 소모. 게이지 상승 없음. */
  function applyTraining(activity: TrainingId, grade: MiniGameGrade): void {
    const r = resolveTraining(activity, grade, cardTemplates);
    // 원형이 올리는 게이지 수만큼 여러 장 (오디션 = 평판 카드 + 실력 카드)
    if (grade !== "clear") for (const card of r.cards) state.cards = addCard(state.cards, card);
    applyEffect(state, { gauges: r.drain }, config);
    applyTrainingStat(state, grade); // perfect → 전원 기량 +1
    checkCollapse();
  }

  /** 재도전 공통 페널티 (멘탈 −1) */
  function applyRetryPenalty(): void {
    applyEffect(state, { gauges: { mental: -1 } }, config);
    checkCollapse();
  }

  function checkCollapse(): void {
    if (isCollapsed(state.gauges, config)) {
      pendingGate = null;
      current = null;
      ended = { type: "ending", kind: "dark" };
    }
  }
}
