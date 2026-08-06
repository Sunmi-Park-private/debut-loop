# 카드 덱빌딩 시스템 설계 (본 게임)

> 대상: `debut-loop` 정식 게임 코드 (목업 아님)
> 상위 스펙: `아이돌게임_통합안1_스펙_v0.2.md` §3 티켓 · §5.5 관문 · §5.6 연습
> 아키텍처 원칙: **data(JSON) → engine(순수 TS) → ui(Pixi)**

---

## 0. 확정 결정 (Director 승인)
| | 결정 |
|---|------|
| 연습 시 게이지 | **즉시 상승 없음 → 카드만 획득** + **멘탈 소모(견제)는 유지** |
| 관문 카드 사용 | 관문 미니게임 **등급 = 선택 가능 카드 장수** (퍼펙트 2장 / 굿 1장 / 클리어 1장) |
| 카드 등급 | **있음** — 연습 성적이 카드 레어도 결정 (일반/레어/에픽) |

---

## 1. 핵심 루프 (변경)

```
[수집] 연습(막 중, 여러 번)
   연습하기 → 활동 선택 → 미니게임 → 성적(등급)
   → 카드 1장 획득(덱 적립, 등급=성적) + 멘탈 소모
   ※ 게이지 상승은 여기서 일어나지 않음

[사용] 관문(막 끝)
   관문 미니게임 → 성적(등급)
   → 등급만큼 덱에서 카드 선택(퍼펙트 2 / 굿·클리어 1)
   → 선택 카드 효과 합산 → 게이지 적용 (선택 카드는 소모)

→ "연습으로 덱을 쌓고, 관문에서 전략적으로 푼다"는 로그라이크 덱빌딩 루프
```

**전략성**: 미사용 카드는 다음 관문까지 유지 → 약한 관문엔 아끼고 강한 관문(저지 등)에 몰아쓰는 선택. 단 연습은 멘탈을 깎으므로 무한 수집 불가(견제).

---

## 2. 데이터 모델 (Lv.0 Contracts)

```ts
// 카드 등급 (레어도)
type CardGrade = 'common' | 'rare' | 'epic';

// 카드 원형 ID (연습 활동 6종에 대응)
type CardTemplateId = 'vocal' | 'dance' | 'promo' | 'funds' | 'audition' | 'bond';

// 카드 원형 (data/cards.json) — 콘텐츠, 코드 아님
interface CardTemplate {
  id: CardTemplateId;
  name: string;          // "보컬 카드"
  icon: string;          // "🎤"
  baseGauges: Partial<Gauges>;  // common 기준 효과
  source: TrainingId;    // 어느 연습에서 나오는가
}

// 보유 카드 인스턴스 (덱 원소)
interface Card {
  templateId: CardTemplateId;
  grade: CardGrade;
}

type Deck = Card[];

// 상수 (Lv.0)
const GRADE_MULT: Record<CardGrade, number> = { common: 1.0, rare: 1.4, epic: 1.8 };
const TRAIN_GRADE_TO_CARD: Record<MiniGameGrade, CardGrade> =
  { perfect: 'epic', good: 'rare', clear: 'common' };
const GATE_PICKS: Record<MiniGameGrade, number> =
  { perfect: 2, good: 1, clear: 1 };   // 관문 등급 → 선택 장수
```

> `Gauges` / `MiniGameGrade` / `TrainingId` 는 기존 `engine/types.ts`에 이미 있거나 함께 정의.

---

## 3. 카드 구성 (6종 × 3등급)

**base 효과(common 기준)** — 등급 배율(×1.0/1.4/1.8, 반올림) 적용

| 카드 | icon | 출처 연습 | baseGauges (common) | 성격 |
|------|:--:|-----------|---------------------|------|
| 보컬 | 🎤 | vocal | `skill +6` | 실력 특화 |
| 안무 | 💃 | dance | `skill +4, mental +2` | 안정형 실력 |
| 홍보 | 📸 | promo | `reputation +6` | 평판 특화 |
| 자금 | 💰 | funds | `capital +6` | 자원 |
| 오디션 | 🎯 | audition | `skill +4, reputation +3` | 밸런스 |
| 유대 | 🤝 | bond | `mental +5, bond +4` | 회복/관계 |

예) 보컬 카드: common `skill+6` / rare `skill+8` / epic `skill+11`

**연습 시 멘탈 소모(견제, 카드와 별개 고정값)**: 보컬·안무·오디션 `mental −3`, 알바 `mental −2`, SNS `capital −3`, 휴식 소모 없음(회복형).

---

## 4. 엔진 API (Lv.1 Domain · 순수 TS · Pixi 의존 0)

```ts
// engine/cards.ts
function cardEffect(card: Card, templates: CardTemplate[]): Partial<Gauges>;
  // base × GRADE_MULT[grade], 반올림

// engine/deck.ts  (불변 업데이트)
function addCard(deck: Deck, card: Card): Deck;
function removeCards(deck: Deck, indices: number[]): Deck;

// engine/training.ts
function resolveTraining(activity: TrainingId, grade: MiniGameGrade):
  { card: Card; drain: Partial<Gauges> };
  // 카드(grade=TRAIN_GRADE_TO_CARD) 생성 + 소모값 반환 (게이지 상승 없음)

// engine/gate.ts
function gatePickCount(grade: MiniGameGrade): number;         // GATE_PICKS
function resolveGate(picked: Card[], templates): Partial<Gauges>;
  // 선택 카드 효과 합산 → 적용할 게이지 델타
```

**상태 반영은 상위(application/ui)에서**: 엔진은 순수 계산만, `state.deck`/`state.gauges` 변경은 호출측 리듀서가.

---

## 5. 코드 구조 (아키텍처 매핑)

```
src/
  data/
    cards.json          ← 카드 원형 6종 (콘텐츠, 작가/기획 수정 영역)
  engine/               ← 순수 TS, 유닛테스트 대상
    types.ts            ← Card, CardGrade, Deck, 상수 (+기존 Gauges 등)
    cards.ts            ← cardEffect
    deck.ts             ← addCard / removeCards
    training.ts         ← resolveTraining
    gate.ts             ← gatePickCount / resolveGate
  ui/                   ← Pixi
    deckSheet.ts        ← A안: 하단 덱 시트(상하 스와이프/탭 개폐, 스토리 중 수시 열람, ×N 스택)
    minigames.ts 內 픽커 ← P2: 관문 핸드(부채꼴) 카드 선택 — 탭하면 위로 떠오름
    (덱 UI 확정: Director 2026-07-23 — A안+P2 조합. 덱북(C안)은 본선 포토앨범과 함께 확장)
  tests/
    cards.test.ts, deck.test.ts, gate.test.ts
```

---

## 6. 흐름 시퀀스

```
연습:
  ui: 활동 선택 → 미니게임 실행 → grade
  → engine.resolveTraining(activity, grade) → { card, drain }
  → state.deck = addCard(state.deck, card)
  → state.gauges 에 drain 적용
  → ui.deckView 갱신

관문:
  ui: 관문 미니게임 실행 → grade
  → n = engine.gatePickCount(grade)
  → ui.cardPicker(state.deck, n) → picked[]   (n장 선택)
  → delta = engine.resolveGate(picked, templates)
  → state.gauges 에 delta 적용
  → state.deck = removeCards(state.deck, pickedIndices)   (소모)
  → ui 갱신
```

---

## 7. 우선순위 & 구현 순서 (DoD)

| 순위 | 단계 | 산출물 | DoD |
|:--:|------|--------|-----|
| **1** | 엔진 코어 | contracts 타입 + `cards.json` + `cards/deck/training/gate.ts` | 유닛테스트 통과(효과·배율·선택장수·합산) |
| **2** | 연습 연동 | 연습 미니게임 결과 → `resolveTraining` → 덱 적립 + 멘탈 소모 배선 | 연습 시 카드 쌓이고 게이지 상승 없음(멘탈만 감소) 확인 |
| **3** | 관문 연동 | 관문 결과 → `gatePickCount` → `cardPicker` → `resolveGate` → 적용·소모 | 관문서 N장 선택→게이지 반영→덱 감소 확인 |
| **4** | UI | `deckView`(보유 표시) + `cardPicker`(선택 화면, 등급 시각화) | 카드 시각화·선택 인터랙션 완성 |

**원칙**: 1순위는 TDD(엔진 순수 → 테스트 우선). UI(4)는 엔진 완성 후. TUI/텍스트 검증 → GUI 순.

---

## 8. 열린 결정 (튜닝 · 후속)

1. **등급 배율 수치**(1.0/1.4/1.8)와 base 효과값 — 밸런싱 대상
2. **덱 상한** 둘지(예: 12장) / 무한
3. **선택 장수** 퍼펙트 2·굿 1 고정 vs 관문 종류별 차등
4. **중복 카드 처리** — 같은 카드 여러 장 시 시각/스택 표현
5. **회귀 계승**(로그라이크): 회차 넘어 카드 일부 계승 규칙
6. **관문 성적↔카드 배율** 추가 여부(현재는 "장수"로만 반영, 배율 중첩은 보류)

---

## 9. 미니게임 난이도 스케일 (막 기준)

미니게임의 물량·난이도는 **현재 막(act)** 에 비례해 커진다. 관문 미니게임은 **그 관문이 끝나는 막** 기준(예: 포토카드=3막 관문→12개, 단서 대조=4막 관문→16개). 연습 미니게임은 수행 시점의 막 기준.

### 9-1. 짝맞추기(match) — 카드 수
| 막 | 카드 수 | 구성 |
|:--:|:--:|------|
| 1막 | 6 | 3쌍 |
| 2막 | **9** | 4쌍 + **1장 조커/트리오**(홀수 특수 처리) |
| 3막 | 12 | 6쌍 |
| 4막 | 16 | 8쌍 |

> 2막 9개는 짝수 아님 → 1장은 **조커(아무 카드와 매칭)** 또는 **3장 트리오** 로 처리(Director 결정).

### 9-2. 타이밍(STOP) — 횟수 & 증감 폭
| 막 | STOP 횟수 | 회당 게이지 증감 폭 |
|:--:|:--:|------|
| 1막 | 1회 | ± base |
| 2막 | 2회 | ± base × 2 |
| 3막 | 3회 | ± base × 3 |
| 4막 | 4회 | ± base × 4 |

- 막이 오를수록 **횟수↑ + 회당 성공/실패 증감 폭↑** (리스크·리턴 동반 상승) → 후반 고난도·고긴장.
- 5막 저지(STOP)는 미지정 → 4막과 동일(4회) 또는 클라이맥스 특별값으로 튜닝(§8).

### 9-3. Contracts 상수 (Lv.0)
```ts
type Act = 1 | 2 | 3 | 4 | 5;
const MATCH_CARDS:  Record<Act, number> = { 1: 6, 2: 9, 3: 12, 4: 16, 5: 16 };
const STOP_ROUNDS:  Record<Act, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 4 };
const stopSwingMult = (act: Act): number => act;   // 회당 증감 폭 배율 (base × act)
```

> 구현: **2·3순위(연습·관문 연동)** 단계에서 미니게임 실행부가 `act`를 참조해 위 상수로 물량·폭을 결정.
