# S3: 연습 메뉴 + 카드 획득 (카드 2순위) — 구현 계획

> REQUIRED SUB-SKILL: superpowers:executing-plans. 체크박스 문법.

**Goal:** 연습 시점(W2·W6·W11)과 상시 🎹 버튼으로 연습 메뉴(활동 6종)가 열리고, 미니게임 성적에 따라 **카드(등급=성적)를 획득**하며 **멘탈 등 소모만** 적용된다(게이지 상승 없음 — 상승은 S4 관문 카드 사용에서).

**Architecture:** 카드 로직은 완성된 순수 엔진(`training.ts`·`deck.ts`·`cards.ts`) 재사용. 컨트롤러에 연습 배선만 추가(TDD). 미니게임 러너는 관문 뷰에서 분리해 연습 뷰와 공유.

## Global Constraints
- 스펙 §5.6: 활동 6종(보컬·안무=STOP / SNS홍보=match(promo) / 알바=STOP / 오디션대비=rps / 휴식=즉시). 성적→카드 등급(perfect=epic/good=rare/clear=common), **클리어는 카드 없음**(목업 규칙), 소모는 고정(TRAIN_DRAIN).
- 카드는 `State.cards: Card[]`(티켓 `deck: string[]`와 별개). 회귀 시 **전부 계승**(로그라이크 성장감 — §8 튜닝 대상).
- 상시 🎹 연습하기 버튼(스탯패널 아래, 목업 패리티) — 멘탈 소모가 자체 견제. 밸런스는 후튜닝.
- 기존 검증 유지: tsc 0 · 테스트 GREEN · 커밋 보류.

## Task 1: 엔진·컨트롤러 배선 (TDD)
- `types.ts`: `State.cards: Card[]` + `Beat.training?: boolean`
- `state.ts`: createState cards:[] · triggerRegression **cards 계승**
- 데이터: `demo2_zeroc.json`에 연습 비트 3개 삽입(W2/W6/W11, `training:true`, 공통 loop) — 멱등 스크립트
- `runController`: `finishTraining(activity, grade|null)` — resolveTraining→addCard(클리어 제외)+drain 적용+비트 소진, `skipTraining()` — 소모 없이 비트 소진. 붕괴 체크.
- 테스트: 카드 적립(등급 매핑)·클리어 무카드·drain만 적용(상승 없음)·계승·skip

## Task 2: 미니게임 러너 분리 (동작 불변)
- `ui/minigames.ts`: runRps/runStop/runMatch를 **엔진 러너**로 추출 — `mountEngine(body, engine, act, skin, ticker, onFinish(grade|null))`. renderGate는 러너 + 관문 결과/실패 화면 래퍼로 유지 (기존 관문 동작·스페이스바 그대로).

## Task 3: 연습 뷰 + 상시 버튼 + 배선
- `ui/training.ts`: `renderTrainingMenu(parent, act, ticker, onPick(activity)|onSkip)` — 활동 6종 그리드(아이콘·이름·카드/소모 라벨) + "← 건너뛰기". 활동 선택→러너 실행→결과 화면(획득 카드 등급 표시: 🎴 보컬 ★★★)→계속. rest(휴식)는 미니게임 없이 즉시 good.
- `app.ts`: `current.training`이면 연습 메뉴 렌더. 스탯패널 아래 **🎹 연습하기 상시 버튼**(현재 카드 위에 오버레이, 완료 후 원래 카드 복귀 — 비트 소진 없음). 헤더에 🎴 카드 수 표시. 치트 "🎹 연습 메뉴".
- layout.json: `practiceBtn`·`training` 좌표.

## Self-Review
- 카드 2순위 DoD(연습→적립+소모, 상승 없음) 전부 커버. 관문 카드 사용은 S4. ✅
- 상시 버튼과 비트 연습의 차이: 비트=진행 소모, 버튼=자유 연습(비트 무관) — 목업과 동일. ✅
