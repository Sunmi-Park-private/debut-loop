# 오디션 컨셉 B-1("심사석의 하루" 문구판) + 로직 보정 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **개정 (2026-08-02)**: Director 결정으로 컨셉이 **B-1 축소 채택** (스펙 §7). 화면·연출은 기존 리듬게임 구조 그대로, 스토리(코드 텍스트)만 "심사석의 하루"로 교체. 원안 B의 연출 슬롯 6종(노트·심사선·판정 팝·심사석)과 실루엣은 보류 — 이 계획에서 제외.

**Goal:** 오디션 스토리를 "심사위원 시점(킬포인트 포착)" 문구로 교체하고, 컨셉과 무관한 게임플레이 신뢰 보정 7건과 신규 UI 스킨 슬롯 8종(보드 5 + 등급 스탬프 3)·배선을 구현한다.

**Architecture:** 리듬 엔진(runRhythm)·판정 로직·연출은 그대로 두고 `EngineOpts.audition` 플래그 하나로 문구만 분기한다. 보드(memberBoard.ts)는 기존 "스킨 있으면 교체, 없으면 벡터 유지" 패턴(skinNode ?? Graphics)으로 신규 슬롯 5종을 배선한다. 등급 스탬프는 관문 결과와 오디션 결과가 같은 슬롯(grade-*)을 공용한다.

**Tech Stack:** TypeScript + PixiJS v8 + Vite. 테스트 Vitest, 스모크 playwright-core.

**Spec:** `docs/superpowers/specs/2026-08-02-audition-concept-b-judge-design.md` — **§7(B-1)이 구현 기준**

## Global Constraints

- **git 없음**: 이 레포는 git 저장소가 아니다. 커밋 스텝 없음 — 각 태스크는 검증 실행(`npx tsc --noEmit && npx vitest run`)으로 마감한다. 파일 삭제·덮어쓰기 전 반드시 Read.
- **검증 게이트**: 모든 태스크 후 `npx tsc --noEmit && npx vitest run` — 테스트 8파일 109개 전부 통과 유지.
- **버튼류 9slice 금지** (팀 규칙). 신규 슬롯은 `stretch`(박스 채움) 또는 배선에서 `skinFit`(비율 유지)만 사용. `natural` 플래그는 신규 슬롯에 쓰지 않는다.
- **문구는 스펙 §7(B-1) 표를 기준으로** 사용 — 이 계획의 코드 블록에 적힌 문자열이 최종본이다 (한 표 항목이 두 UI 요소로 나뉜 곳은 의미 보존 분배, 그 외 임의 수정 금지).
- **vite.config.ts 수정 금지 · dev 서버(5174, 실행 중) 재시작 금지.** uiskins.json에 슬롯을 추가하면 열린 탭은 새로고침해야 보인다(정상).
- **4순위 범위 제외**: 보류 vs 영입 긴장 부여 · 실패 페널티 · 기량 리롤 차단은 이 계획에서 구현하지 않는다 (스펙 §6 미결).
- **B-1 축소 (스펙 §7)**: 컨셉 전용 아트 슬롯 0종 — 노트·판정선·레인·모드 버튼 아트는 기존 그대로, 무대 분위기는 기존 배경판 영상(gate-rhythm-board-easy)이 담당.

## 파일 구조 (전체 조감)

| 파일 | 역할 | 이 계획에서의 변경 |
|---|---|---|
| `src/ui/memberBoard.ts` | 멤버 점검 보드·오디션 진입·결과 | 로직 보정 4건, B-1 제목·캡션 문구, 보드 스킨 5종+X 배선 |
| `src/ui/minigames.ts` | 미니게임 엔진(runRhythm)·관문 결과 | `EngineOpts.audition` + 심사 문구 분기, 등급 스탬프 |
| `src/ui/app.ts` | 게임 루프·화면 배선 | 멤버 보드 수동 진입 버튼, 가이드 문구 보정 |
| `src/data/uiskins.json` | UI 스킨 슬롯 SSOT (현재 95슬롯) | +8슬롯 → 103 |
| `tests/uiskins.test.ts` | 슬롯 정합성 테스트 | 카운트 95→103 |

---

### Task 1: 보드 로직 보정 — 교환 가드·버리기 확인·안내 3종 (memberBoard.ts)

지적 ⑥(후보 0명 교환 가드), ⑧(버리기 확인), ④(재심사 리스크 안내), ⑤(교환 트레이드오프 토스트), ⑦(W18 가치·타이밍 안내).

**Files:**
- Modify: `src/ui/memberBoard.ts` (showBoard 내부, 현재 118~270행)

**Interfaces:**
- Consumes: `ctrl.exchangeAudition(): boolean`, `ctrl.dropCandidate(id)`, `candidatePool(characters, s)` — 기존 그대로.
- Produces: 없음 (내부 UI 로직만).

- [ ] **Step 1: ⑥ 교환 버튼에 후보 풀 조건 추가**

`showBoard` 내 (현재 246행 부근):

```ts
// 변경 전
const canEx = audCards >= cost;
```
```ts
// 변경 후 — 후보가 없으면 진행권이 죽은 자원이 되므로 교환도 막는다
const canEx = audCards >= cost && pool.length > 0;
```

같은 버튼의 onTap 실패 토스트(현재 249행)를 사유별로:

```ts
// 변경 전
else toast(`오디션 카드가 ${cost - audCards}장 더 필요해요 — 연습 '오디션 대비'에서 획득`);
```
```ts
// 변경 후
else toast(pool.length === 0
  ? "영입할 후보가 없어요 — 진행권으로 바꿔도 쓸 곳이 없어요"
  : `오디션 카드가 ${cost - audCards}장 더 필요해요 — 연습 '오디션 대비'에서 획득`);
```

- [ ] **Step 2: ⑤ 교환 성공 시 트레이드오프 토스트**

교환 버튼 onTap 성공 분기(현재 248행):

```ts
// 변경 전
if (ctrl.exchangeAudition()) { opts.onChanged(); showBoard(); }
```
```ts
// 변경 후 — 오디션 카드는 관문에서 평판+5·실력+1로도 쓰이는 실전 카드 (cards.json audition 템플릿)
if (ctrl.exchangeAudition()) {
  toast("진행권 +1 — 카드 3장 소모 (관문에서도 쓸 수 있던 카드예요)");
  opts.onChanged();
  showBoard();
}
```

- [ ] **Step 3: ⑦ 기량 캡션에 W18 자동충원 대비 가치·타이밍 명시**

`statCap`(현재 163행):

```ts
// 변경 전
const statCap = txt("기량(0~100): 무대(막 관문) 성적으로 오르내려요 · W18 데뷔조 확정의 기준", 10, SUB);
```
```ts
// 변경 후 — 오디션의 실제 가치(자동충원 50 초과 확보)와 마지막 기회(W17 📷)를 전달
const statCap = txt("기량: 무대 성적으로 변동 · W18 자동충원은 기량 50 — 오디션은 그보다 나은 멤버를 미리 확보 (마지막 점검 W17)", 10, SUB);
```

- [ ] **Step 4: ④ 전원 측정 상태에서 재심사 리스크 안내**

`poolT`(현재 240행) — `fresh`가 비었을 때 문구 교체:

```ts
// 변경 전
const poolT = txt(`아직 못 만난 후보: ${fresh.map((c) => c.temp ? `${c.name}?` : c.name).join(" · ") || "없음"}   ·   🎯 카드 ${audCards} · 🎫 진행권 ${ticketN}`, 11, SUB);
```
```ts
// 변경 후 — 재오디션 = 기량 '갱신'(하락 가능)임을 알린다
const poolT = txt(fresh.length > 0
  ? `아직 못 만난 후보: ${fresh.map((c) => c.temp ? `${c.name}?` : c.name).join(" · ")}   ·   🎯 카드 ${audCards} · 🎫 진행권 ${ticketN}`
  : `모든 후보를 만났어요 — 재오디션은 재심사 (기량이 다시 측정돼 오르내려요)   ·   🎯 카드 ${audCards} · 🎫 진행권 ${ticketN}`, 11, SUB);
```

- [ ] **Step 5: ⑧ [버리기] 2-tap 확인**

보류 후보 행의 mkMini "버리기"(현재 213행) — 첫 탭은 경고 토스트, 두 번째 탭에 실행:

```ts
// 변경 전
row.addChild(mkMini("버리기", rw - 64, 0x8a76a8, 0xefe9f6, () => {
  ctrl.dropCandidate(c.id);
  toast(`${c.name} — 후보에서 내보냈어요 (이번 회차에는 다시 만날 수 없어요)`);
  showBoard();
}));
```
```ts
// 변경 후 — 회차 내 복구 불가 행동이라 2-tap 확인 (기존 토스트 패턴 재사용)
let dropArmed = false;
row.addChild(mkMini("버리기", rw - 64, 0x8a76a8, 0xefe9f6, () => {
  if (!dropArmed) {
    dropArmed = true;
    toast(`한 번 더 누르면 ${c.name}를 내보내요 — 이번 회차엔 다시 만날 수 없어요`);
    return;
  }
  ctrl.dropCandidate(c.id);
  toast(`${c.name} — 후보에서 내보냈어요`);
  showBoard();
}));
```

주의: `dropArmed`는 held 후보 for-loop 안(각 행 클로저)에 선언 — 행마다 독립.

- [ ] **Step 6: 검증 실행**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 타입 에러 0, 테스트 109개 통과.

---

### Task 2: 보드 수동 진입점 + 가이드 문구 보정 (app.ts)

지적 ⑩(유저가 원할 때 보드를 못 엶) + ⑤ 후속(가이드의 "교환한 카드는 관문에선 못 써" 모호 문구).

**Files:**
- Modify: `src/ui/app.ts` (drawBackBtn 243~262행, draw()의 c.current 분기 365~371행, guideSeq 316~320행, memberBoardForced 주석 33행)

**Interfaces:**
- Consumes: 기존 모듈 변수 `memberBoardForced`, `draw()`, `pos`, `editable`, `skinNatural`(이미 import됨 — 250행에서 사용 중).
- Produces: 레이아웃 키 `"memberBtn"` (layout.json 자동 저장 대상).

- [ ] **Step 1: 멤버 보드 진입 버튼 함수 추가**

`drawBackBtn` 함수 바로 아래에 추가:

```ts
function drawMemberBtn(): void {
  // 멤버 점검 보드 수동 진입 — 📷 비트를 기다리지 않고 진행권·후보를 확인 (락인 후에도 열람 가능)
  const b = new Container();
  const p = pos("memberBtn", { x: 336, y: 122 }); // backBtn(21,122) 오른쪽 끝 대칭
  b.x = p.x;
  b.y = p.y;
  const g = skinFit("game-back", 93, 26)
    ?? skinNatural("ui-back", 93, 26)
    ?? new Graphics().roundRect(0, 0, 72, 26, 13).fill(0xf3ecfa).stroke({ width: 1.5, color: 0xe4d8f0 });
  const t = new Text({ text: "👥 멤버", style: { fontSize: 11.5, fill: 0x8a76a8, fontWeight: "bold" } });
  t.x = 10;
  t.y = 6;
  b.addChild(g, t);
  b.eventMode = "static";
  b.cursor = "pointer";
  b.on("pointertap", () => { memberBoardForced = true; draw(); });
  root.addChild(b);
  editable("memberBtn", b);
}
```

- [ ] **Step 2: 스토리 카드 화면에서 호출**

draw()의 `c.current` 분기(현재 371행) `drawBackBtn();` 바로 다음 줄에:

```ts
      drawBackBtn();
      drawMemberBtn(); // 👥 멤버 보드 수동 진입 (지적 ⑩)
```

- [ ] **Step 3: memberBoardForced 주석 갱신**

33행:

```ts
// 변경 전
let memberBoardForced = false;          // 👥 멤버 보드 강제 오픈 (치트 전용)
```
```ts
// 변경 후
let memberBoardForced = false;          // 👥 멤버 보드 강제 오픈 (👥 멤버 버튼·치트 공용)
```

- [ ] **Step 4: 가이드 문구 명확화 (⑤)**

guideSeq "memberBoard2" 2번째 줄(현재 318행):

```ts
// 변경 전
["yuwol", "🎯 <b>오디션 카드</b>는 연습 '오디션 대비'에서 받아. <b>3장 모으면 🎫 진행권</b>으로 교환! 대신 교환한 카드는 관문에선 못 써."],
```
```ts
// 변경 후 — 카드가 원래 관문에서도 쓰이는 자원임을 명시 (교환=트레이드오프)
["yuwol", "🎯 <b>오디션 카드</b>는 연습 '오디션 대비'에서 받아. 관문에서도 쓸 수 있는 카드지만, <b>3장 모으면 🎫 진행권</b>으로 바꿀 수 있어 — 어디에 쓸지는 선택!"],
```

- [ ] **Step 5: 검증 실행**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 타입 에러 0, 테스트 109개 통과.

---

### Task 3: EngineOpts.audition 플래그 + B-1 문구 교체 (minigames.ts, memberBoard.ts)

스펙 §7(B-1) 문구 체계 적용 — 지적 ③(인과)·⑨(하드 보너스 명시)·⑪(정체성, 문구 수준)의 해결. **코드 텍스트만 교체, 노트·판정선·레인·버튼 아트·연출은 기존 그대로.**

**Files:**
- Modify: `src/ui/minigames.ts` (EngineOpts 224~235행, runRhythm 988~, desc 998행, record 1054~1064행, 모드 버튼 1086~1089행)
- Modify: `src/ui/memberBoard.ts` (showAudition 제목 311행, mountEngine 호출 322행, showResult 캡션 359·370행)

**Interfaces:**
- Produces: `EngineOpts.audition?: boolean` — 현재 소비처는 runRhythm 내부 문구 분기뿐 (원안 B 승격 시 연출 분기가 같은 플래그를 재사용).

- [ ] **Step 1: EngineOpts에 audition 플래그**

```ts
export interface EngineOpts {
  engine: "rps" | "stop" | "match" | "rhythm" | "slot" | "dodge";
  act: number;
  skin?: string;
  audition?: boolean;                              // 오디션(심사석) 컨텍스트 — 리듬 문구를 심사 테마로 (B-1: 문구만)
  poseTex?: Texture | null;
  // ...이하 기존 필드 유지
```

- [ ] **Step 2: runRhythm에 aud 플래그·설명줄 분기**

`runRhythm` 함수 시작부(990행 `const mult` 위)에:

```ts
    const aud = opts.audition === true; // 심사석 컨셉 (오디션 전용 문구·스킨)
```

desc(998행):

```ts
// 변경 전
desc("판정선에 노트가 닿을 때 해당 레인 탭 · 시작 전에 모드를 골라요");
```
```ts
// 변경 후 — B-1: "킬포인트"는 문구로만 해석 (판정선 명칭은 기존 유지)
desc(aud ? "후보의 킬포인트가 판정선에 닿는 순간 체크! · 시작 전에 무대를 골라요"
  : "판정선에 노트가 닿을 때 해당 레인 탭 · 시작 전에 모드를 골라요");
```

- [ ] **Step 3: 모드 버튼 라벨 분기 (⑨ — 보너스 조건·값 명시)**

1086~1089행:

```ts
// 변경 전
const easyBtn = btn("▶ 이지 · 2열  (Space)", 220, PINK, () => begin(2), "gate-rhythm-easy");
easyBtn.y = 252;
const hardBtn = btn("🔥 하드 · 3열 + 보너스", 220, LAV, () => begin(3), "gate-rhythm-hard");
```
```ts
// 변경 후 — 오디션은 심사 테마 라벨 + 보너스 조건(good 이상 +3) 명시. 버튼 아트(스킨 id)는 기존 그대로.
// Space 단축키(begin(2))는 코드 유지 — 라벨에서만 생략 (스펙 §7 verbatim)
const easyBtn = btn(aud ? "🎪 쇼케이스 (2열)" : "▶ 이지 · 2열  (Space)", 220, PINK, () => begin(2), "gate-rhythm-easy");
easyBtn.y = 252;
const hardBtn = btn(aud ? "🏆 본선 무대 (3열 · 집중 심사 +3)" : "🔥 하드 · 3열 + 보너스", 220, LAV, () => begin(3), "gate-rhythm-hard");
```

- [ ] **Step 4: 판정 팝 문구 분기 (popFx 텍스트만 — 스킨·시그니처 변경 없음)**

record(1054~1057행):

```ts
// 변경 전
if (kind === "m") { m++; combo = 0; popFx(lane, "MISS", 0xe86a8a); }
else if (kind === "p") { p++; combo++; popFx(lane, "PERFECT", 0x3fb98a); }
else { g++; combo++; popFx(lane, "GOOD", 0xf0a93a); }
```
```ts
// 변경 후 — 심사 테마 팝 (B-1: 텍스트만, popFx 시그니처 불변)
if (kind === "m") { m++; combo = 0; popFx(lane, aud ? "놓쳤다…" : "MISS", 0xe86a8a); }
else if (kind === "p") { p++; combo++; popFx(lane, aud ? "포착!" : "PERFECT", 0x3fb98a); }
else { g++; combo++; popFx(lane, aud ? "체크" : "GOOD", 0xf0a93a); }
```

- [ ] **Step 5: memberBoard showAudition 제목·마운트·결과 캡션**

311행 제목:

```ts
// 변경 전
const t = txt("🎤 신인 오디션 — 무대 위 승부", 15, INK, true);
```
```ts
// 변경 후
const t = txt("📋 신인 오디션 — 심사석에 앉다", 15, INK, true);
```

mountEngine 호출(322행 `engine: "rhythm",` 다음 줄에):

```ts
    mountEngine(gameArea, {
      engine: "rhythm", // 오디션 = 무대 리듬게임 (연습 '오디션 대비'의 rps와 차별화)
      audition: true,   // 심사석 컨셉 (B-1) — 리듬 문구를 심사 테마로
      act: ctrl.state.act,
```

showResult(359·370행):

```ts
// 변경 전 (359행)
const st = txt(`기량 ${r.stat}`, 13, 0xc9527f, true);
```
```ts
// 변경 후 — 스펙 §7: "심사 결과: 기량 N — 포착률이 높을수록 진짜 실력이 보여요"를 st+cap 두 요소로 분배
const st = txt(`심사 결과: 기량 ${r.stat}`, 13, 0xc9527f, true);
```
```ts
// 변경 전 (370~372행 cap의 비만석 문구)
: "영입하면 빈 슬롯에 합류 · 기량은 이후 무대 성적으로 계속 변해요", 10.5, SUB);
```
```ts
// 변경 후
: "포착률이 높을수록 진짜 실력이 보여요 · 영입하면 빈 슬롯에 합류", 10.5, SUB);
```

- [ ] **Step 6: 검증 실행**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 타입 에러 0, 테스트 109개 통과.

---

### Task 4: uiskins.json 신규 슬롯 8종 + 테스트 카운트 (95→103)

B-1 축소: 심사 연출 슬롯(audition-note/line/judge-pop×3/desk)은 **추가하지 않는다** (스펙 §7 — 컨셉 전용 신규 슬롯 0종). 보드 개선 5종 + 관문 공용 등급 스탬프 3종만.

**Files:**
- Modify: `src/data/uiskins.json` (audition 섹션에 5종, gate 섹션에 3종)
- Test: `tests/uiskins.test.ts` (카운트 95→103)

**Interfaces:**
- Produces: 슬롯 id 8종 — Task 5·6의 배선이 이 id들을 참조한다: `audition-head`, `member-stat-bar`, `audition-banner`, `audition-held-row`, `audition-btn-mini`, `grade-perfect`, `grade-good`, `grade-clear`.

- [ ] **Step 1: 테스트 카운트를 먼저 103으로 올려 실패 확인**

`tests/uiskins.test.ts`의 세 곳:

```ts
it("7화면 · 103슬롯", () => {
  expect(screens.length).toBe(7);
  expect(all.length).toBe(103); // 오디션 B-1: 보드 5종 + 등급 스탬프 3종 (2026-08-02)
});
```
```ts
expect(new Set(all.map((s) => s.id)).size).toBe(103);
```

Run: `npx vitest run tests/uiskins.test.ts`
Expected: FAIL — `expected 95 to be 103`.

- [ ] **Step 2: audition 섹션(id: "audition")의 slots 배열 끝에 5종 추가**

기존 마지막 슬롯(`audition-btn-sub`) 뒤에:

```json
        {
          "id": "audition-head",
          "label": "보드 헤더 바 (제목·주차 텍스트는 코드)",
          "file": "assets/ui/audition-head.png",
          "size": [388, 46],
          "mode": "stretch"
        },
        {
          "id": "member-stat-bar",
          "label": "기량 게이지 트랙 (채움·숫자는 코드)",
          "file": "assets/ui/member-stat-bar.png",
          "size": [110, 8],
          "mode": "stretch",
          "small": true
        },
        {
          "id": "audition-banner",
          "label": "상황 안내 배너 (다음 할 일 1줄)",
          "file": "assets/ui/audition-banner.png",
          "size": [366, 28],
          "mode": "stretch"
        },
        {
          "id": "audition-held-row",
          "label": "보류 후보 행 배경",
          "file": "assets/ui/audition-held-row.png",
          "size": [366, 34],
          "mode": "stretch"
        },
        {
          "id": "audition-btn-mini",
          "label": "미니 버튼 (영입·버리기 — 텍스트는 코드)",
          "file": "assets/ui/audition-btn-mini.png",
          "size": [58, 24],
          "mode": "stretch",
          "small": true
        }
```

- [ ] **Step 3: gate 섹션(id: "gate")의 slots 배열 끝에 등급 스탬프 3종 추가**

```json
        {
          "id": "grade-perfect",
          "label": "등급 스탬프 · PERFECT (관문 결과·오디션 결과 공용)",
          "file": "assets/ui/grade-perfect.png",
          "size": [180, 64],
          "mode": "stretch",
          "small": true
        },
        {
          "id": "grade-good",
          "label": "등급 스탬프 · GOOD (관문 결과·오디션 결과 공용)",
          "file": "assets/ui/grade-good.png",
          "size": [180, 64],
          "mode": "stretch",
          "small": true
        },
        {
          "id": "grade-clear",
          "label": "등급 스탬프 · CLEAR (관문 결과·오디션 결과 공용)",
          "file": "assets/ui/grade-clear.png",
          "size": [180, 64],
          "mode": "stretch",
          "small": true
        }
```

- [ ] **Step 4: 검증 실행**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 타입 에러 0, 테스트 109개 통과 (uiskins 카운트 103 일치).

---

### Task 5: 보드 스킨 5종 + X 버튼 배선 (memberBoard.ts)

기존 벡터를 "스킨 있으면 교체" 패턴으로. 미업로드 시 현재 모습 그대로(기능 회귀 0).

**Files:**
- Modify: `src/ui/memberBoard.ts`

**Interfaces:**
- Consumes: Task 4 슬롯 id 5종 + `ui-close-x`(공용). `skinNode`/`skinNatural`은 이미 import됨(10행 `import { skinNode, skinTex } from "./uiSkin";` → `skinNatural` 추가 필요).

- [ ] **Step 1: import 확장**

```ts
import { skinNode, skinNatural, skinTex } from "./uiSkin";
```

- [ ] **Step 2: 헤더 바 (audition-head)**

54행 head 생성부:

```ts
// 변경 전
const head = new Graphics().roundRect(3, 3, W - 6, 46, 14).fill(0xffe9f3);
```
```ts
// 변경 후 — 스킨 우선, 없으면 기존 분홍 바 (제목·주차 텍스트는 그대로 위에 얹힘)
const headSkin = skinNode("audition-head", W - 6, 46);
if (headSkin) { headSkin.x = 3; headSkin.y = 3; }
const head = headSkin ?? new Graphics().roundRect(3, 3, W - 6, 46, 14).fill(0xffe9f3);
```

(`panel.addChild(head, title, wk);`는 그대로 — head가 Container여도 동작.)

- [ ] **Step 3: 기량 게이지 트랙 (member-stat-bar)**

memberRow 내 트랙(101행):

```ts
// 변경 전
row.addChild(new Graphics().roundRect(bx, 24, barW, 8, 4).fill(0xefe9f6));
```
```ts
// 변경 후 — 트랙만 스킨, 채움(3색)·숫자는 수치 표현이라 코드 유지
const track = skinNode("member-stat-bar", barW, 8);
if (track) { track.x = bx; track.y = 24; row.addChild(track); }
else row.addChild(new Graphics().roundRect(bx, 24, barW, 8, 4).fill(0xefe9f6));
```

- [ ] **Step 4: 안내 배너 (audition-banner)**

taskBg(231행):

```ts
// 변경 전
const taskBg = new Graphics().roundRect(14, y + 4, W - 28, 28, 10).fill(0xfff3f8).stroke({ width: 1.5, color: 0xffd3e4 });
```
```ts
// 변경 후
const bannerSkin = skinNode("audition-banner", W - 28, 28);
if (bannerSkin) { bannerSkin.x = 14; bannerSkin.y = y + 4; }
const taskBg = bannerSkin ?? new Graphics().roundRect(14, y + 4, W - 28, 28, 10).fill(0xfff3f8).stroke({ width: 1.5, color: 0xffd3e4 });
```

- [ ] **Step 5: 보류 후보 행 (audition-held-row)**

held 루프 내 행 배경(187행):

```ts
// 변경 전
row.addChild(new Graphics().roundRect(0, 0, rw, 34, 10).fill(0xfdf8ff).stroke({ width: 1.5, color: 0xe0d2f0 }));
```
```ts
// 변경 후
row.addChild(skinNode("audition-held-row", rw, 34)
  ?? new Graphics().roundRect(0, 0, rw, 34, 10).fill(0xfdf8ff).stroke({ width: 1.5, color: 0xe0d2f0 }));
```

- [ ] **Step 6: 미니 버튼 (audition-btn-mini)**

mkMini(193~206행) 배경:

```ts
// 변경 전
b.addChild(new Graphics().roundRect(0, 0, 58, 24, 8).fill(fill));
```
```ts
// 변경 후 — 스킨 1종 공용, 색 구분은 텍스트 색으로 유지
b.addChild(skinNode("audition-btn-mini", 58, 24) ?? new Graphics().roundRect(0, 0, 58, 24, 8).fill(fill));
```

- [ ] **Step 7: 보드 우상단 X 버튼 (ui-close-x 재사용 — training.ts xBtn 패턴)**

renderMemberBoard 끝부분, `editable("board", panel);`(48행) 아래에 추가:

```ts
  // 우상단 X — 다른 팝업(연습 등)과 동일한 닫기 관례 (ui-close-x 공용 스킨, 없으면 벡터)
  const xBtn = new Container();
  const xSkin = skinNatural("ui-close-x", 36, 36);
  if (xSkin) xBtn.addChild(xSkin);
  else {
    xBtn.addChild(new Graphics().circle(18, 18, 15).fill(0xf3ecfa).stroke({ width: 1.5, color: 0xe4d8f0 }));
    const xt = txt("✕", 14, 0x8a76a8, true);
    xt.x = 18 - xt.width / 2;
    xt.y = 18 - xt.height / 2;
    xBtn.addChild(xt);
  }
  const xp = pos("board_close_x", { x: W - 46, y: -44 });
  xBtn.x = xp.x;
  xBtn.y = xp.y;
  xBtn.eventMode = "static";
  xBtn.cursor = "pointer";
  xBtn.on("pointertap", opts.onClose);
  panel.addChild(xBtn);
  editable("board_close_x", xBtn);
```

- [ ] **Step 8: 검증 실행**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 타입 에러 0, 테스트 109개 통과.

---

### Task 6: 등급 스탬프 공용 배선 (관문 결과 + 오디션 결과)

**Files:**
- Modify: `src/ui/minigames.ts` (관문 카드 선택 화면의 등급 표시, 현재 1540~1545행)
- Modify: `src/ui/memberBoard.ts` (showResult 등급 표시, 현재 345~349행)

**Interfaces:**
- Consumes: Task 4의 `grade-perfect/good/clear`, `skinFit`.

- [ ] **Step 1: 관문 결과(카드 선택 화면) 스탬프**

minigames.ts 1540~1545행:

```ts
// 변경 전
const GN: Record<MiniGameGrade, string> = { perfect: "PERFECT ✨", good: "GOOD 👍", clear: "CLEAR ✔" };
const n = gatePickCount(grade);
const t1 = txt(`${GN[grade]}`, 22, INK, true);
t1.x = (W - t1.width) / 2;
t1.y = 8;
body.addChild(t1);
```
```ts
// 변경 후 — 스탬프 슬롯 업로드 시 이미지, 없으면 기존 텍스트
const GN: Record<MiniGameGrade, string> = { perfect: "PERFECT ✨", good: "GOOD 👍", clear: "CLEAR ✔" };
const n = gatePickCount(grade);
const stamp = skinFit(`grade-${grade}`, 180, 64);
if (stamp) {
  stamp.x = (W - 180) / 2;
  stamp.y = 0;
  body.addChild(stamp);
} else {
  const t1 = txt(`${GN[grade]}`, 22, INK, true);
  t1.x = (W - t1.width) / 2;
  t1.y = 8;
  body.addChild(t1);
}
```

- [ ] **Step 2: 오디션 결과 스탬프 (memberBoard showResult)**

345~349행:

```ts
// 변경 전
const GN: Record<MiniGameGrade, string> = { perfect: "PERFECT ✨", good: "GOOD 👍", clear: "CLEAR ✔" };
const g1 = txt(GN[grade], 22, INK, true);
g1.x = (W - g1.width) / 2;
g1.y = 20;
body.addChild(g1);
```
```ts
// 변경 후 — 관문과 같은 grade-* 슬롯 공용 (심사표 스탬프)
const GN: Record<MiniGameGrade, string> = { perfect: "PERFECT ✨", good: "GOOD 👍", clear: "CLEAR ✔" };
const stamp = skinFit(`grade-${grade}`, 180, 64);
if (stamp) {
  stamp.x = (W - 180) / 2;
  stamp.y = 8;
  body.addChild(stamp);
} else {
  const g1 = txt(GN[grade], 22, INK, true);
  g1.x = (W - g1.width) / 2;
  g1.y = 20;
  body.addChild(g1);
}
```

memberBoard.ts import에 `skinFit` 추가 (Task 5 Step 1의 라인을 확장):

```ts
import { skinFit, skinNatural, skinNode, skinTex } from "./uiSkin";
```

참고(범위 외): minigames.ts 900행 부근 연습 결과 화면에도 같은 GN 텍스트가 있으나, 스펙 공용 범위는 "관문 결과·오디션 결과"까지 — 연습 화면은 건드리지 않는다.

- [ ] **Step 3: 검증 실행**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 타입 에러 0, 테스트 109개 통과.

---

### Task 7: 통합 스모크 검증 (Playwright)

**Files:**
- Create(임시): `debut-loop/audsmoke.tmp.mjs` — 실행 후 삭제.

- [ ] **Step 1: 스모크 스크립트 작성·실행**

dev 서버(5174)가 실행 중이어야 한다. debut-loop 루트에 아래 파일을 만들고 `node audsmoke.tmp.mjs`:

```js
import { chromium } from 'playwright-core';
const OUT = '/tmp/aud-smoke';
import { mkdirSync } from 'fs';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '<playwright chromium 경로>' });
const p = await b.newPage({ viewport: { width: 430, height: 800 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
const scene = (s) => p.waitForFunction(`window.__scene === "${s}"`, null, { timeout: 30000 });
const domClick = (label) => p.evaluate((l) => {
  const t = [...document.querySelectorAll('button')].find((x) => x.textContent && x.textContent.includes(l) && !x.disabled);
  if (t) { t.click(); return true; }
  return false;
}, label);
await p.goto('http://localhost:5174/');
await scene('prologue');
await p.mouse.click(380, 30);            // 건너뛰기
await scene('title');
await p.waitForTimeout(1200);
await p.keyboard.press('Space');          // 타이틀 → 로비
await scene('lobby');
await p.waitForTimeout(1200);
await p.mouse.click(213, 575);            // 1회차 시작
await scene('game');
await p.waitForTimeout(2000);
for (let i = 0; i < 5; i++) { await p.mouse.click(215, 400); await p.waitForTimeout(500); }
await p.screenshot({ path: `${OUT}/1-story.png` });   // 👥 멤버 버튼 확인 (Task 2)
// 👥 멤버 버튼 수동 진입 검증 (⑩) — 기본 앵커 (336,122), 버튼 중심 근처 클릭 → 보드 오픈 → X로 닫기
await p.mouse.click(372, 135);
await p.waitForTimeout(1000);
await p.screenshot({ path: `${OUT}/1b-manual-board.png` }); // 보드가 열렸는지 확인
await p.mouse.click(367, 105);            // 보드 우상단 X (Task 5) — 닫히면 스토리 화면 복귀
await p.waitForTimeout(800);
await domClick('⚙'); await p.waitForTimeout(400);
await domClick('오디션 재료'); await p.waitForTimeout(800);
await domClick('⚙'); await p.waitForTimeout(400);
await domClick('멤버 보드 열기'); await p.waitForTimeout(1000);
for (let i = 0; i < 4; i++) { await p.mouse.click(250, 650); await p.waitForTimeout(600); } // 가이드 넘기기
await p.screenshot({ path: `${OUT}/2-board.png` });   // 보정 문구·X 버튼 확인 (Task 1·5)
await p.mouse.click(305, 608);            // 🎤 오디션 개최
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/3-judge-start.png` }); // 심사 문구(제목·설명줄·모드 버튼) 확인 (Task 3)
await p.mouse.click(215, 486);            // 쇼케이스(2열) 시작
await p.waitForTimeout(4000);
await p.screenshot({ path: `${OUT}/4-playing.png` }); // 판정 팝 문구(포착!/체크/놓쳤다…) 확인 (Task 3)
for (let i = 0; i < 20; i++) { await p.keyboard.press(i % 2 ? 'ArrowLeft' : 'ArrowRight'); await p.waitForTimeout(400); }
await p.waitForTimeout(22000);
await p.screenshot({ path: `${OUT}/5-result.png` });  // 결과 캡션(심사 결과) 확인 (Task 3·6)
console.log('pageerrors:', errs.length ? errs.join(' | ') : 'none');
await b.close();
```

Expected: `pageerrors: none` 출력. 스크린샷 5장에서 순서대로 ① 스토리 화면 우상단 "👥 멤버" 버튼, ② 보드의 새 문구(기량 캡션·재심사 안내), ③ "📋 신인 오디션 — 심사석에 앉다" 제목 + "후보의 킬포인트가 판정선에 닿는 순간 체크!" 설명줄 + "🎪 쇼케이스 (2열)/🏆 본선 무대 (3열 · 집중 심사 +3)" 버튼(아트는 기존), ④ "포착!/체크/놓쳤다…" 판정 팝(노트·판정선·레인은 기존 그대로), ⑤ "심사 결과: 기량 N" 캡션을 눈으로 확인.

Expected 추가: `1b-manual-board.png`에서 👥 버튼 탭으로 멤버 점검 보드가 열려 있고, X 탭 후 스토리 화면으로 복귀했는지 확인 (⑩·Task 5 X 배선 검증).

- [ ] **Step 2: 임시 스크립트 삭제**

Run: `rm debut-loop/audsmoke.tmp.mjs`

---

## 잔여·후속 (이 계획 범위 외)

- **원안 B 연출 승격 (보류)**: 킬포인트 노트(✨)·심사선·판정 팝 스킨·심사석 프레임·후보 실루엣 — 스펙 §3~4 원안. 여력 생기면 `EngineOpts.audition` 플래그를 그대로 재사용해 승격 (배선 요지: meta() aud 분기로 노트 슬롯 교체, popFx에 skinId 옵션 추가, begin() 판정선을 audition-line 우선 폴백, 심사석은 배경판 위 z에 하단 오버레이, 실루엣은 후보 stage 스킨 brightness-0).
- **4순위 로직**: 보류 vs 영입 긴장 부여 · 실패 페널티 · 기량 리롤 차단 — 스펙 §6, 별도 브레인스토밍 후 설계.
- **연습 결과 화면 등급 스탬프**: minigames.ts 900행 부근 — 필요 시 같은 `grade-*` 패턴 적용.
- **디자이너 안내**: 새 슬롯 8종은 UI 에디터(ui.html) 오디션·관문 섹션에 나타남 — 열린 탭은 새로고침 1회 필요. 등급 스탬프는 skinFit(비율 유지)이라 캔버스 여백 없이 아트 영역만 그려도 됨.
