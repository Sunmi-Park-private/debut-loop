// engine/types.ts — Lv0 계약(타입). 렌더러/외부 의존 없음.

export type GaugeId = "skill" | "mental" | "reputation" | "bond" | "capital";
export type Gauges = Record<GaugeId, number>;

export type LoopCount = 1 | 2; // 데모: 1회차(당함)·2회차(추적·트루)

export type RoleId =
  | "protagonist"   // 주인공(회귀자)
  | "jealousMember" // 진범 A: 시기질투 멤버 (데모2 미사용, 본선)
  | "antiStaff"     // 진범 B: 안티 직원 (데모2 핵심)
  | "helper"        // 조력자
  | "helper2"       // 조력자2: 온라인 담당 (오디션 영입 슬롯)
  | "mentor"        // 멘토 (오디션 영입 슬롯)
  | "rival"         // 라이벌
  | "fan";          // 팬(평판의 얼굴)

export interface CharacterDef {
  id: string;
  name: string;
  color: string;             // 시그니처 컬러
  eligibleRoles: RoleId[];   // 캐스팅 적합 역할
  weight?: Partial<Record<RoleId, number>>;
  temp?: boolean;            // 임시 후보(가칭·실루엣 표시) — Phase 2에서 정식화
}

// 팀 멤버 슬롯 (오디션 영입·교체 시스템)
export interface MemberSlot {
  characterId: string;
  role: RoleId;
  stat: number;              // 기량 0~100
  joinedWeek: number;
}

export type CastingMap = Partial<Record<RoleId, string>>; // role -> characterId

export interface TicketDef {
  id: string;
  name: string;
  cost: number;
  effect: Effect;
}

// 게이지 증감·플래그·카드·단서 등 비트/티켓의 결과
export interface Effect {
  gauges?: Partial<Gauges>;
  flags?: string[];          // 세울 플래그
  clearFlags?: string[];
  grantTickets?: string[];
  consumeTickets?: string[];
  addClue?: string;          // 데모2 단서 획득
  points?: number;
  joinMember?: { characterId: string; role: RoleId; stat: number }; // 스토리 자동 합류 (유월·보라)
  memberStat?: Record<string, number>; // 특정 멤버 기량 증감 (보라 각성 +20 등)
}

export interface BeatChoice {
  label: string;             // 스와이프 라벨(좌/우)
  effects: Effect;
  hint?: string;             // 기시감 등 연출 힌트
}

/** 2회차 회상 카드 전용 문구 — 지정하지 않으면 1회차 값을 그대로 쓴다.
 *  공통 비트(loop 미지정)는 두 회차에 모두 나오는데, 회상에서는 압축된 문장이
 *  어울릴 때가 있어 문구만 따로 둘 수 있게 한다. 효과(effects)는 나누지 않는다. */
export interface BeatRecall {
  textKey?: string;
  leftLabel?: string;
  rightLabel?: string;
}

export interface Beat {
  id: string;
  act: number;               // 1~5 (프롤로그=0)
  week?: number;             // 특정 주 고정(옵션)
  loop?: LoopCount;          // 회차 전용(없으면 양 회차 공통). loop:1=관찰, loop:2=포착
  training?: boolean;        // 연습 시점 비트 — 카드 대신 연습 메뉴가 열림
  line?: string;             // 스토리 라인 태그 (예: "anti")
  requires?: Requires;       // 진입 조건
  textKey: string;           // 대사(역할 토큰 {antiStaff} 등 포함)
  left: BeatChoice;
  right: BeatChoice;
  isConvergence?: boolean;   // 수렴 앵커
  recall?: BeatRecall;       // 2회차 회상 문구(선택) — 없으면 위 값들을 그대로 쓴다
  /** 이 대사를 건네는 상대의 프로필 이미지 경로 (예: "assets/speaker/d2_w1_yuwol.webp").
   *  카드 상단 가운데에 원형으로 작게 뜬다. 주인공(하루) 대사에는 넣지 않는다. */
  speaker?: string;
}

// 진행 엔진(progress.advance)이 반환하는 이벤트
export type RunEvent =
  | { type: "beat"; beat: Beat; seen: boolean } // 다음 비트(seen=회귀 가속 대상)
  | { type: "regress" }                          // 1회차 종료 → 회귀(강제)
  | { type: "ending"; kind: "true" | "dark" };   // 런 종료(2회차=true 고정, dark=붕괴/본선)

export interface Requires {
  flags?: string[];
  notFlags?: string[];
  castRoles?: RoleId[];      // 특정 역할이 캐스팅돼 있어야
  ownTickets?: string[];
  gauge?: Partial<Record<GaugeId, [number, number]>>; // [min,max]
}

export interface ClueDef {
  id: string;
  label: string;
  week: number;              // 등장 주
}

export interface DifficultyConfig {
  id: "small" | "big";       // 소형(고난도) / 대형(저난도)
  label: string;
  startGauges: Gauges;
  capitalPressurePerWeek: number; // 소형=높음
}

export interface GameConfig {
  totalWeeks: number;        // 24
  debutWeek: number;         // 24
  actWeeks: Record<number, [number, number]>; // 막 -> [시작주,끝주]
  gaugeMin: number;
  gaugeMax: number;
  cluesToBlock: number;      // 데모2: 저지에 필요한 단서 수(4)
  difficulties: Record<"small" | "big", DifficultyConfig>;
}

// 런타임 상태(런 1회) — save는 메타(포토앨범·회귀 기억)로 별도
export interface State {
  week: number;
  act: number;
  gauges: Gauges;
  flags: Set<string>;
  deck: string[];            // 보유 티켓
  casting: CastingMap;
  clues: Set<string>;        // 데모2 확보 단서
  points: number;
  demotions: number;         // 강등 횟수(escalate)
  seed: number;              // 회차 캐스팅 시드
  loopCount: LoopCount;      // 현재 회차 (1|2)
  seenBeats: Set<string>;    // 이전 회차에 본 비트(회귀 가속용)
  played: Set<string>;       // 이번 회차에 진행한 비트
  choices: Record<string, "left" | "right">; // 이번 회차 선택 방향 (회귀 계승 → 빠른 모드 재적용)
  cards: Card[];             // 연습으로 모은 카드 덱 (티켓 deck과 별개)
  members: MemberSlot[];     // 팀 슬롯 (최대 5, [0]=하루) — 회귀 시 리셋
  membersLocked: boolean;    // W18 데뷔조 락인 후 true (영입·교체 불가)
  candidateStats: Record<string, number>; // 후보별 마지막 오디션 기량 (락인 자동충원 근거)
  droppedCandidates: Set<string>; // 보드에서 '버리기'한 후보 — 이번 회차 풀·자동충원 제외
}

// 밸런스 튜닝 노브 (data/tuning.json — 튜닝 에디터로 편집)
export type RhythmJudgeLevel = "loose" | "normal" | "tight"; // 리듬 판정 허용 오차 프리셋
export interface Tuning {
  cardCarryOver: number;     // 회귀 시 계승(생존) 카드 개수 — 앞에서부터 N장
  stopSpeedBase: number;     // STOP 마커 기본 속도
  stopSpeedPerAct: number;   // STOP 막당 가속
  rhythmSpeedMult: number;   // 리듬 속도 배율 (5단계 0.7~1.4 — 낙하·노트 간격 ms = 기본/배율)
  rhythmJudge: RhythmJudgeLevel;
}

// ── 리듬 박자표 (beat.html 에디터) ──
export type RhythmMode = "easy" | "hard"; // easy=2열, hard=3열(중앙 레인 추가)
export interface BeatmapNote { t: number; lane: number } // t=ms, lane 0=좌 1=중앙(hard) 2=우 (easy는 0/1=좌/우)
export interface Beatmap { bpm?: number; notes: BeatmapNote[] }
export type BeatmapSet = Partial<Record<RhythmMode, Beatmap>>;

// ── 카드 덱빌딩 (CARD_SYSTEM.md) ──
export type MiniGameGrade = "perfect" | "good" | "clear"; // 미니게임 성적
export type CardGrade = "common" | "rare" | "epic";       // 카드 레어도
export type TrainingId = "vocal" | "dance" | "promo" | "funds" | "audition" | "bond";
export type CardTemplateId = TrainingId; // 연습 활동 6종에 1:1 대응

export interface CardTemplate {
  id: CardTemplateId;
  name: string;
  icon: string;
  source: TrainingId;
  baseGauges: Partial<Gauges>; // common 기준 효과
}

export interface Card {
  templateId: CardTemplateId;
  grade: CardGrade;
  /** 이 카드가 담당하는 게이지 — 원형이 여러 게이지를 올리면 게이지마다 한 장씩 쪼개 준다.
   *  미지정이면 원형의 모든 게이지를 그대로 갖는 통짜 카드 (구버전 저장 데이터 호환) */
  gauge?: GaugeId;
}

export type CardDeck = Card[]; // 보유 카드(티켓 deck: string[] 과 별개)

// ── 막 통과 관문 (스펙 §5.5) ──
export interface GateDef {
  id: string;                                  // "act2" | "clue4" 등
  trigger: { act?: number; beatId?: string };  // 막 진입 또는 특정 비트 직전
  engine: "rhythm" | "slot" | "dodge";         // 스테이지 게임 3종 (연습하기의 rps/stop/match와 별개)
  skin?: string;                               // 게임별 스킨 변형
  name: string;                                // "센터 대결" 등
  ticket: string;                              // 승리 시 티켓 id (deck push)
  gauges: Partial<Gauges>;                     // 굿(×1.0) 기준 보상
}
