# S2: 미니게임 3엔진 + 막 통과 관문 배선 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. 체크박스 문법.

**Goal:** 막 경계(1→2·2→3·3→4)와 서사 지점(W22 단서대조·W24 저지)에서 관문 미니게임(가위바위포즈/타이밍STOP/짝맞추기)이 뜨고, 등급(퍼펙트/굿/클리어)에 따라 보상이 적용된다.

**Architecture:** 미니게임 **판정 로직은 순수 엔진**(`engine/minigames.ts`, TDD) / **렌더·입력은 Pixi**(`ui/minigames.ts`) / **관문 정의는 데이터**(`data/gates.json`). RunController가 `pendingGate`를 노출하고 UI가 그리는 구조.

**Tech Stack:** 동일.

## Global Constraints
- S0·S1과 동일 + **스펙 §5.5(관문)·§5.7(난이도 스케일)** 준수:
  - 짝맞추기 카드 수(막): 1막 6 / 2막 9(4쌍+조커) / 3막 12 / 4막 16 / 5막 16
  - STOP 횟수(막): 1/2/3/4/4회
  - 등급 배율: 퍼펙트 ×1.5 · 굿 ×1.0 · 클리어 ×0.6 / 포인트 3·2·1
  - 재도전: 실패 시 멘탈 −1 후 반복 가능
- **S2 보상 = 게이지+티켓 직접 적용** (스펙 §5.5 표). S4에서 "카드 선택" 방식으로 대체 예정.
- 관문은 **회차마다 반복**(1·2회차 모두). 단 비트 관문(clue4·block)은 loop:2 비트라 2회차만.

## File Structure
- `src/data/gates.json` (Create) — 관문 5개 정의(막 3 + 비트 2)
- `src/engine/minigames.ts` (Create) — 순수 판정: rps·stop·match 등급, 덱 생성, 스케일 상수
- `tests/minigames.test.ts` (Create)
- `src/engine/types.ts` (Modify) — `GateDef`, `MiniGameGrade` 이미 있음 → GateDef만 추가
- `src/ui/runController.ts` (Modify) — `pendingGate`/`resolveGate(grade)`/`retryGate()` 노출 (TDD)
- `src/ui/minigames.ts` (Create) — Pixi 미니게임 뷰 3종 + 결과/재도전 화면
- `src/ui/app.ts` (Modify) — pendingGate 분기

## Task 1: 순수 미니게임 판정 엔진 (TDD)
`engine/minigames.ts`:
```ts
export const MATCH_CARDS: Record<number, number> = { 1: 6, 2: 9, 3: 12, 4: 16, 5: 16 };
export const STOP_ROUNDS: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 4 };
export const GRADE_REWARD_MULT = { perfect: 1.5, good: 1.0, clear: 0.6 };
export const GRADE_POINTS = { perfect: 3, good: 2, clear: 1 };

export type RpsHand = 0 | 1 | 2; // 바위·보·가위
export function rpsBeats(a: RpsHand, b: RpsHand): boolean;          // a가 b를 이기나
export function rpsGrade(wins: number): MiniGameGrade | null;       // 3판 후: 3승=perfect, 2승=good, <2=null(실패)
export function stopZone(dist: number): "perfect" | "good" | "miss"; // 중앙거리 ≤6=perfect ≤18=good
export function stopGrade(zones: Array<"perfect"|"good"|"miss">): MiniGameGrade | null; // miss 있으면 null, 전부 perfect=perfect, 그 외 good
export function matchGrade(misses: number): MiniGameGrade;           // 0=perfect ≤2=good else clear (match는 실패 없음)
export function buildMatchDeck(count: number, symbols: string[], rand: () => number): string[];
// count 홀수면 마지막 1장 = "🃏"(조커, 단독 매칭). 셔플은 rand 주입(테스트 재현성).
export function gateReward(gate: GateDef, grade: MiniGameGrade): { gauges: Partial<Gauges>; points: number };
```
테스트: 각 판정 경계값 + 조커 덱(9=4쌍+조커) + 보상 배율 반올림.

## Task 2: GateDef 타입 + gates.json + RunController 관문 배선 (TDD)
`types.ts`에:
```ts
export interface GateDef {
  id: string;                 // "act2" | "act3" | "act4" | "clue4" | "block"
  trigger: { act?: number; beatId?: string }; // 막 진입 또는 특정 비트 직전
  engine: "rps" | "stop" | "match";
  skin?: string;              // match: "photo" | "clue"
  name: string;               // "센터 대결" 등
  ticket: string;             // 티켓 id (deck에 push)
  gauges: Partial<Gauges>;    // 굿 기준 보상
}
```
`gates.json` (스펙 §5.5): act2=rps 센터대결(skill4,rep4,오디션진행권) / act3=stop 무대집중(skill4,mental4,지하데뷔권) / act4=match 포토카드(rep4,bond4,포토카드권) / clue4(d2_w22_clue4 직전)=match clue 단서대조(mental4,bond2,단서조각) / block(d2_w24_block 직전)=stop 사보타주저지(skill3,mental3,rep3,트루엔딩게이트).

RunController v3:
```ts
readonly pendingGate: GateDef | null; // 세팅 중이면 current 비트 진행 대기
resolveGate(grade: MiniGameGrade): void; // 보상 적용(gateReward+ticket+points) + 완료 처리
retryGate(): void;                        // 멘탈 −1 (실패 재도전)
```
step()에서 비트 선택 후: `막 상승 && actGate 미완료` 또는 `beatId 일치 && 미완료` → pendingGate 세팅. gatesDone은 **런(회차) 단위 리셋**.
테스트: 막 경계 트리거·비트 트리거(loop2)·보상 적용·재도전 멘탈 감소·회귀 후 재등장.

## Task 3: Pixi 미니게임 뷰 + app 배선
`ui/minigames.ts` — `renderGate(parent, gate, act, ticker, onDone(grade|retry))`:
- **rps**: ✊✋✌️ 3버튼, 3판 2선, 상대 직전 손 표시(목업 이식). 2승 미달 → 실패 화면
- **stop**: 왕복 마커(ticker 구동) + STOP 버튼 × STOP_ROUNDS[act]회, 존 판정 표시
- **match**: MATCH_CARDS[act]장 그리드(3열) + 조커, 뒤집기/짝 판정, 틀림 카운트
- 공통: 파스텔 오버레이 + 결과 화면(등급·보상) → "계속" / 실패 → "재도전(멘탈−1)"
- 레이아웃 에디터 등록: `editable("gate", …)` / `pos("gate")`
`app.ts`: `ctrl.pendingGate` 있으면 renderGate 우선 표시. 치트 "🎮 다음 관문으로"도 추가.

## Self-Review
- §5.5 관문 5개 전부 데이터로 정의, §5.7 스케일 상수 엔진에. ✅
- 판정 순수/렌더 분리 → 판정 전부 TDD. ✅
- S4 전환 시 resolveGate 내부(보상 적용부)만 카드 선택 플로우로 교체 — 인터페이스 유지. ✅
- 커밋 보류(레포 미생성). ✅
