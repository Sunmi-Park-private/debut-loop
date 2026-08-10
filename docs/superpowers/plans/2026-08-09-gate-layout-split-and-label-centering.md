# 관문 레이아웃 분리 · 버튼 문구 가운데 정렬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 버튼 문구가 길이와 무관하게 버튼 이미지 중앙에 놓이게 하고, 관문 5종이 레이아웃 키를 서로 침범하지 않게 분리한다.

**Architecture:** 문구는 Pixi `Text`의 가로 앵커를 0.5로 두어 저장 좌표를 "왼쪽 끝"이 아닌 "중심점"으로 재정의한다. 네 곳에 복사돼 있던 문구 등록 코드는 새 모듈 `src/ui/btnLabel.ts` 한 곳으로 모은다. 관문 키는 포토카드에만 있던 접두사 방식(`lk`/`lpos`)을 관문 id 기준으로 일반화하고, 저장값이 없으면 기존 공용 키를 승계해 화면 배치가 그대로 유지되게 한다.

**Tech Stack:** TypeScript · PixiJS v8 · Vitest · Vite dev 플러그인

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-08-09-gate-layout-split-and-label-centering-design.md`
- 저장값이 없는 컴포넌트는 **분리 전후 화면 배치가 동일해야 한다** (공용 키 승계).
- 화면에 보이는 **문구(카피)는 바뀌면 안 된다.** 저장된 문구 덮어쓰기를 옮길 때도 최종 표시 문구가 같아야 한다.
- 관문 접두사: `act2`→`gate_act2`, `act3`→`gate_act3`, `act4`→`gate_photo`, `clue4`→`gate_clue`, `block`→`gate_block`. 목록에 없는 관문 id는 `gate_<id>`.
- 문구 중앙 앵커 적용 범위는 `btnText()`로 버튼 안 문구를 찾는 경로에 한정한다. `backBtn_text`·`memberBtn_text`·`card_text`·`board_stat_text`·`card_deck_item_name_text`·`train_bubble_text`는 대상이 아니다.
- 커밋 메시지는 한국어 한 줄 요약 + 본문. 푸시·PR은 사용자 지시가 있을 때만 한다.
- 작업 디렉터리는 `/Users/sunmipark/github/debut-loop/.claude/worktrees/qa-3rd` (git worktree). 이 밖으로 `cd` 하지 않는다.
- `git stash`(무인자) 금지 — 스택이 다른 세션과 공유된다.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/ui/btnLabel.ts` | 버튼 안 문구 찾기(`btnText`) + 중앙 앵커 등록(`centerBtnLabel`) | **신규** |
| `src/ui/minigames.ts` | `btnText` 정의 제거·재수출, `chromeLabel`/`chromeLabel2`를 공용 헬퍼로 교체, `lk`/`lpos` 일반화 | 수정 |
| `src/ui/memberBoard.ts` | `btnLabel`·보류 행 미니버튼 문구를 공용 헬퍼로 교체 | 수정 |
| `src/ui/training.ts` | `btnLabel`을 공용 헬퍼로 교체 | 수정 |
| `src/ui/editor.ts` | `mutateTextKeepingCenter`가 앵커 걸린 Text를 건너뛰게 | 수정 |
| `src/ui/layout.ts` | `Pos.center` 필드 + `setStyle` 삭제 키 목록 | 수정 |
| `vite.config.ts` | `/__layout` 허용 필드에 `center` 추가 | 수정 |
| `tests/btnLabel.test.ts` | 관문 접두사 매핑 순수 함수 회귀 테스트 | **신규** |
| `tests/layout.test.ts` | `center` 플래그 저장·삭제 회귀 테스트 | 수정 |

---

### Task 1: 버튼 문구 공용 모듈 + 중앙 앵커

지금 `chromeLabel`(minigames), `chromeLabel2`(minigames), `btnLabel`(memberBoard), `btnLabel`(training) 네 곳에 같은 코드가 복사돼 있다. 이 태스크에서 공용 모듈로 모으고, 동시에 저장 x의 의미를 "왼쪽 끝"에서 "중심점"으로 바꾼다.

핵심 아이디어: `btn()`이 문구를 만들 때 이미 `t.x = (버튼폭 − 문구폭) / 2`로 가운데 정렬해 둔다. 따라서 앵커를 바꾸기 **직전의** `t.x + t.width / 2`가 곧 버튼의 중심 x다. 버튼 폭을 인자로 받을 필요가 없다.

**Files:**
- Create: `src/ui/btnLabel.ts`
- Modify: `src/ui/minigames.ts` (`btnText` 정의를 옮기고 재수출)
- Modify: `src/ui/editor.ts` (`mutateTextKeepingCenter`)
- Test: `tests/btnLabel.test.ts`

**Interfaces:**
- Produces: `btnText(b: Container): Text | null` — 버튼 컨테이너 안의 첫 Text를 깊이 우선으로 찾는다. `pressable()`이 자식을 inner Container로 감싸므로 얕은 탐색으로는 못 찾는다.
- Produces: `centerBtnLabel(key: string, b: Container): void` — 버튼 문구를 중앙 앵커로 만들고 `key`로 레이아웃 등록한다. 저장값이 없으면 현재(가운데 정렬된) 위치를 기본값으로 쓴다.
- Produces: `gateKeyPrefix(gateId: string): string` — 관문 id → 레이아웃 키 접두사. Task 2가 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/btnLabel.test.ts` 를 만든다. 렌더러 없이 검증할 수 있는 순수 함수(`gateKeyPrefix`)만 테스트한다. `centerBtnLabel`은 Pixi 디스플레이 트리가 필요해 단위 테스트 대상이 아니고, Task 4의 E2E에서 확인한다.

```ts
// tests/btnLabel.test.ts — 관문 레이아웃 키 접두사 매핑 (Lv.6)
import { describe, it, expect } from "vitest";
import { gateKeyPrefix } from "../src/ui/btnLabel";

describe("gateKeyPrefix", () => {
  it("관문 5종이 서로 다른 접두사를 갖는다", () => {
    const ids = ["act2", "act3", "act4", "clue4", "block"];
    const prefixes = ids.map(gateKeyPrefix);
    expect(prefixes).toEqual(["gate_act2", "gate_act3", "gate_photo", "gate_clue", "gate_block"]);
    expect(new Set(prefixes).size).toBe(5); // 서로 침범하지 않는다
  });

  it("포토카드는 기존 저장값을 잇도록 gate_photo를 유지한다", () => {
    expect(gateKeyPrefix("act4")).toBe("gate_photo");
  });

  it("목록에 없는 관문도 자동으로 분리된다", () => {
    expect(gateKeyPrefix("act6")).toBe("gate_act6");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/btnLabel.test.ts`
Expected: FAIL — `Failed to resolve import "../src/ui/btnLabel"` (모듈이 아직 없음)

- [ ] **Step 3: 공용 모듈 작성**

`src/ui/btnLabel.ts` 를 새로 만든다.

```ts
// ui/btnLabel.ts — 버튼 안 문구를 레이아웃 에디터에 등록하는 공용 경로.
// 문구는 버튼 이미지 기준 가운데 정렬로 놓인다: Text의 가로 앵커를 0.5로 두어
// 저장 좌표 x가 "글자 왼쪽 끝"이 아니라 "글자 중심"을 뜻하게 한다.
// 그래야 게임마다 라벨 길이가 달라도(관문용 vs 오디션용) 같은 저장값으로 같은 자리에 놓인다.
import { Container, Text } from "pixi.js";
import { pos } from "./layout";
import { editable } from "./editor";

/** 버튼 컨테이너 안의 문구 Text — pressable()이 자식을 inner Container로 감싸므로 깊이 우선으로 찾는다 */
export const btnText = (b: Container): Text | null => {
  for (const c of b.children) {
    if (c instanceof Text) return c;
    const r = btnText(c);
    if (r) return r;
  }
  return null;
};

/** 버튼 안 문구를 중앙 앵커로 등록 — 아트를 바꿔 폭이 달라져도 문구만 따로 미세조정할 수 있다.
 *  기본값은 btn()이 잡아준 가운데 위치라, 저장값이 없으면 지금 배치 그대로다. */
export function centerBtnLabel(key: string, b: Container): void {
  const t = btnText(b);
  if (!t) return;
  // 앵커를 바꾸기 전 위치가 btn()의 가운데 정렬 결과 = 버튼 중심
  const cx = Math.round(t.x + t.width / 2);
  t.anchor.x = 0.5;
  const q = pos(key, { x: cx, y: Math.round(t.y) });
  t.x = q.x;
  t.y = q.y;
  editable(key, t);
}

/** 관문 id → 레이아웃 키 접두사. 관문마다 배경판 아트 비율이 달라 패널 크기가 다르므로
 *  키를 공유하면 한쪽을 맞출 때 다른 쪽이 틀어진다.
 *  포토카드(act4)는 이미 gate_photo_* 로 저장된 값이 많아 그 접두사를 유지한다. */
export function gateKeyPrefix(gateId: string): string {
  const MAP: Record<string, string> = {
    act2: "gate_act2", act3: "gate_act3", act4: "gate_photo",
    clue4: "gate_clue", block: "gate_block",
  };
  return MAP[gateId] ?? `gate_${gateId}`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/btnLabel.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: minigames.ts의 btnText를 새 모듈에서 가져와 재수출**

`src/ui/minigames.ts`에서 기존 `btnText` **정의**를 지우고, 새 모듈에서 가져와 재수출한다. `memberBoard.ts`가 `import { btnText } from "./minigames"` 로 쓰고 있어 재수출로 기존 임포트를 깨지 않는다.

지울 정의 — `src/ui/minigames.ts:61` 부터의 블록 전체:

```ts
export const btnText = (b: Container): Text | null => {
  for (const c of b.children) {
    if (c instanceof Text) return c;
    const r = btnText(c);
    if (r) return r;
  }
  return null;
};
```

대신 파일 상단 import 구역에 추가하고:

```ts
import { btnText, centerBtnLabel } from "./btnLabel";
```

기존 export 자리에 재수출 한 줄을 남긴다:

```ts
export { btnText }; // 이전 위치에서 임포트하던 화면들(memberBoard 등) 호환
```

- [ ] **Step 6: editor.ts의 중심 보정이 앵커 걸린 Text를 건너뛰게**

`src/ui/editor.ts`의 `mutateTextKeepingCenter`를 바꾼다. 앵커가 이미 중심을 유지하는데 보정까지 걸면 이중 적용으로 좌표가 밀려난다.

변경 전:

```ts
export function mutateTextKeepingCenter(t: Text, edit: () => void): void {
  const w0 = t.width, h0 = t.height;
  edit();
  t.x += (w0 - t.width) / 2;
  t.y += (h0 - t.height) / 2;
}
```

변경 후:

```ts
export function mutateTextKeepingCenter(t: Text, edit: () => void): void {
  if (t.anchor.x === 0.5) { edit(); return; } // 앵커가 중심을 잡는 문구 — 보정하면 이중 적용
  const w0 = t.width, h0 = t.height;
  edit();
  t.x += (w0 - t.width) / 2;
  t.y += (h0 - t.height) / 2;
}
```

- [ ] **Step 7: 타입 검사 + 전체 테스트**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 타입 오류 없음, 테스트 149건 통과 (기존 146 + 신규 3)

- [ ] **Step 8: 커밋**

```bash
git add src/ui/btnLabel.ts src/ui/minigames.ts src/ui/editor.ts tests/btnLabel.test.ts
git commit -m "$(cat <<'EOF'
버튼 문구 공용 모듈 — 중앙 앵커 등록 경로 추가

문구 좌표가 "글자 왼쪽 끝"이라 라벨 길이가 달라지면 중심이 밀렸다. Text의 가로
앵커를 0.5로 두어 저장 x가 중심점을 뜻하게 하고, 네 화면에 복사돼 있던 등록
코드를 btnLabel.ts 한 곳으로 모았다. 앵커가 걸린 문구는 에디터의 중심 보정을
건너뛴다 — 앵커와 보정이 함께 걸리면 이중 적용으로 좌표가 밀린다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 네 화면의 문구 등록을 공용 헬퍼로 교체

Task 1이 만든 `centerBtnLabel`을 실제 호출부에 연결한다. 이 태스크가 끝나면 리듬 3종의 하드/이지 버튼 문구가 라벨 길이와 무관하게 버튼 중앙에 놓인다.

**Files:**
- Modify: `src/ui/minigames.ts` (`chromeLabel`, `chromeLabel2`)
- Modify: `src/ui/memberBoard.ts` (`btnLabel`, 보류 행 `mkMini`)
- Modify: `src/ui/training.ts` (`btnLabel`)

**Interfaces:**
- Consumes: `centerBtnLabel(key: string, b: Container): void` (Task 1)
- Consumes: `btnText(b: Container): Text | null` (Task 1) — memberBoard의 보류 행은 버튼을 직접 조립하므로 그대로 쓸 수 있다.

- [ ] **Step 1: minigames.ts의 chromeLabel 교체**

관문 화면의 버튼 문구. `lk()`로 관문별 키를 만든 뒤 공용 헬퍼에 넘긴다.

변경 전:

```ts
  const chromeLabel = (name: string, b: Container): void => {
    const t = btnText(b); // pressable()의 inner 래핑 때문에 얕은 탐색으로는 못 찾는다
    if (!t) return;
    const q = lpos(`${name}_text`, { x: Math.round(t.x), y: Math.round(t.y) });
    t.x = q.x;
    t.y = q.y;
    editable(lk(`${name}_text`), t);
  };
```

변경 후:

```ts
  const chromeLabel = (name: string, b: Container): void => {
    centerBtnLabel(lk(`${name}_text`), b);
  };
```

주의: 기존 코드는 기본값을 공용 키(`lpos`)에서 승계했지만, `centerBtnLabel`은 저장값이 없으면 **런타임에 계산한 버튼 중심**을 쓴다. 문구는 어차피 버튼 중앙이 기본이므로 승계가 필요 없다.

- [ ] **Step 2: minigames.ts의 chromeLabel2 교체**

리듬 게임 시작 버튼(`easy_start_text`·`hard_start_text`) 전용. 관문 접두사를 쓰지 않는다 — 오디션(멤버 보드)에서도 같은 엔진이 쓰여 관문 키가 닿지 않기 때문이다.

변경 전:

```ts
    const chromeLabel2 = (b: Container, key: string): void => {
      const t = btnText(b); // pressable()의 inner 래핑 때문에 얕은 탐색으로는 못 찾는다
      if (!t) return;
      const q = pos(`${key}_text`, { x: Math.round(t.x), y: Math.round(t.y) });
      t.x = q.x;
      t.y = q.y;
      editable(`${key}_text`, t);
    };
```

변경 후:

```ts
    const chromeLabel2 = (b: Container, key: string): void => {
      centerBtnLabel(`${key}_text`, b);
    };
```

- [ ] **Step 3: memberBoard.ts의 btnLabel 교체**

변경 전:

```ts
  const btnLabel = (name: string, b: Container): void => {
    const t = btnText(b); // pressable()의 inner 래핑 때문에 얕은 탐색으로는 못 찾는다
    if (!t) return;
    const q = pos(`${name}_text`, { x: Math.round(t.x), y: Math.round(t.y) });
    t.x = q.x;
    t.y = q.y;
    editable(`${name}_text`, t);
  };
```

변경 후:

```ts
  const btnLabel = (name: string, b: Container): void => {
    centerBtnLabel(`${name}_text`, b);
  };
```

파일 상단 import에 `centerBtnLabel`을 추가한다:

```ts
import { centerBtnLabel } from "./btnLabel";
```

- [ ] **Step 4: memberBoard.ts 보류 행 미니버튼 문구 중앙 앵커**

보류 후보 행의 영입·버리기 버튼은 `btn()`을 쓰지 않고 직접 조립하므로 `centerBtnLabel`을 쓸 수 없다(반복 키라 `hreg`로 등록해야 한다). 앵커만 같은 규칙으로 맞춘다.

변경 전:

```ts
        const t2 = txt(label, 10.5, color, true);
        const tq = pos(`${key}_text`, { x: Math.round((58 - t2.width) / 2), y: 4 });
        t2.x = tq.x;
        t2.y = tq.y;
        b.addChild(t2);
        pressable(b, onTap);
        hreg(`${key}_text`, t2);
```

변경 후:

```ts
        const t2 = txt(label, 10.5, color, true);
        t2.anchor.x = 0.5; // 문구 길이와 무관하게 버튼 중앙 — 저장 x는 중심점
        const tq = pos(`${key}_text`, { x: 29, y: 4 }); // 29 = 미니버튼 폭 58의 중심
        t2.x = tq.x;
        t2.y = tq.y;
        b.addChild(t2);
        pressable(b, onTap);
        hreg(`${key}_text`, t2);
```

- [ ] **Step 5: training.ts의 btnLabel 교체**

변경 전:

```ts
  const btnLabel = (name: string, b: Container): void => {
    const t = btnText(b); // pressable()의 inner 래핑 때문에 얕은 탐색으로는 못 찾는다
    if (!t) return;
    const key = ns ? `${ns}_${name}_text` : `${name}_text`;
    const q = pos(key, { x: Math.round(t.x), y: Math.round(t.y) });
    t.x = q.x;
    t.y = q.y;
    editable(key, t);
  };
```

변경 후:

```ts
  const btnLabel = (name: string, b: Container): void => {
    centerBtnLabel(ns ? `${ns}_${name}_text` : `${name}_text`, b);
  };
```

파일 상단 import에 `centerBtnLabel`을 추가한다:

```ts
import { centerBtnLabel } from "./btnLabel";
```

- [ ] **Step 6: 쓰이지 않게 된 import 정리**

세 파일에서 `btnText`가 더 이상 안 쓰이면 import에서 뺀다. `npx tsc --noEmit`이 미사용 import를 잡지 못할 수 있으니 각 파일에서 `btnText` 문자열을 검색해 남은 사용처가 있는지 확인한다.

Run: `grep -n "btnText" src/ui/minigames.ts src/ui/memberBoard.ts src/ui/training.ts`
Expected: minigames.ts의 import·재수출 2줄만 남는다 (memberBoard·training에는 없어야 한다)

- [ ] **Step 7: 타입 검사 + 전체 테스트**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 타입 오류 없음, 테스트 149건 통과

- [ ] **Step 8: 커밋**

```bash
git add src/ui/minigames.ts src/ui/memberBoard.ts src/ui/training.ts
git commit -m "$(cat <<'EOF'
버튼 문구 등록을 공용 헬퍼로 교체 — 네 화면 일괄

관문·리듬 시작·멤버 보드·연습 결과의 문구 등록이 모두 centerBtnLabel을 지난다.
리듬 3종은 관문용("하드 · 3열 + 보너스")과 오디션용("본선 무대 …") 라벨 길이가
달라 한 저장값으로 맞출 수 없었는데, 중심 기준이라 이제 같은 자리에 놓인다.
보류 행 미니버튼은 btn()을 안 쓰고 직접 조립해 앵커만 같은 규칙으로 맞췄다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 관문 5종 레이아웃 키 분리

지금은 포토카드만 전용 키(`gate_photo_*`)를 쓰고 나머지 네 관문이 `gate`·`gate_title`·`gate_exit`·`gate_pick_*`·`gate_fail_*`를 공유한다. 관문마다 배경판 아트 비율이 달라 패널 크기가 제각각이라, 한쪽을 맞추면 다른 쪽이 틀어진다.

**Files:**
- Modify: `src/ui/minigames.ts` (`renderGate` 안의 `photo`/`lk`/`lpos`)

**Interfaces:**
- Consumes: `gateKeyPrefix(gateId: string): string` (Task 1)

- [ ] **Step 1: lk/lpos를 관문 id 접두사 방식으로 일반화**

`renderGate` 안의 아래 블록을 찾는다.

변경 전:

```ts
  const photo = gate.engine === "slot";
  const lk = (base: string): string => photo ? base.replace(/^gate/, "gate_photo") : base;
  const lpos = (base: string, def: { x: number; y: number }): { x: number; y: number } =>
    photo ? pos(lk(base), pos(base, def)) : pos(base, def);
```

변경 후:

```ts
  const photo = gate.engine === "slot"; // 배경판 폴백 프레임 분기에 계속 쓰인다
  // 관문마다 배경판 아트 비율이 달라 패널 크기(W×PH)가 제각각이다 — 키를 공유하면
  // 한 관문을 맞출 때 다른 관문이 틀어진다. 관문 id로 키를 나누고, 저장값이 없으면
  // 기존 공용 키를 승계해 분리 직후 배치가 그대로 유지되게 한다.
  const pre = gateKeyPrefix(gate.id);
  const lk = (base: string): string => base.replace(/^gate/, pre);
  const lpos = (base: string, def: { x: number; y: number }): { x: number; y: number } =>
    pos(lk(base), pos(base, def));
```

파일 상단 import에 `gateKeyPrefix`를 추가한다 (Task 1에서 `btnText`·`centerBtnLabel`을 가져온 그 줄):

```ts
import { btnText, centerBtnLabel, gateKeyPrefix } from "./btnLabel";
```

- [ ] **Step 2: 주석의 낡은 설명 갱신**

바로 위 주석이 "포토카드만 분리"라고 설명하고 있어 사실과 어긋난다. 아래 두 줄을 지운다.

```ts
  // 포토카드는 배경판 아트 비율로 패널 크기가 달라 다른 관문과 위치를 공유하면 서로 틀어진다.
  // → 전용 키(gate_photo*)로 분리. 미저장 시 공통 키(gate*) 값을 승계해 현재 위치 유지
```

- [ ] **Step 3: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 타입 오류 없음

- [ ] **Step 4: 승계 동작 수동 확인 (dev 서버)**

dev 서버가 5200 포트에서 도는지 확인하고(없으면 `npm run dev:share -- --port 5200 --strictPort`), 브라우저에서 관문을 열어 배치가 분리 전과 같은지 본다. 저장값이 없는 새 키는 공용 키를 승계하므로 화면이 그대로여야 한다.

확인 경로: 로비 START → 게임 화면 → 치트 메뉴(⚙️) → `🥇 센터 대결`. 이어서 `🔍 단서 대조`, `🎤 사보타주 저지`도 같은 방법으로 연다.

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5200/`
Expected: `200`

- [ ] **Step 5: 커밋**

```bash
git add src/ui/minigames.ts
git commit -m "$(cat <<'EOF'
관문 5종 레이아웃 키 분리 — 포토카드 전용 방식을 일반화

관문마다 배경판 아트 비율이 달라 패널 크기가 다른데 gate·gate_title·gate_exit·
카드선택·실패화면 키를 공유해, 4막에서 맞추면 5막이 틀어졌다. 관문 id로 접두사를
나누고(gate_act2_/gate_act3_/gate_photo_/gate_clue_/gate_block_) 저장값이 없으면
기존 공용 키를 승계해 분리 직후 배치는 그대로 유지된다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2b: 가운데 정렬을 에디터 체크박스로 (설계 변경, 2026-08-09)

**변경 이유** — Task 2 리뷰에서 Critical이 나왔다. 이미 저장된 문구 좌표(`easy_start_text` x56, `hard_start_text` x45, `board_held_btn_recruit_text` x15, `board_held_btn_drop_text` x11)가 새 중심점 의미로 읽혀 문구가 왼쪽으로 밀린다. 사용자 결정: **기존 정렬을 그대로 두고, 레이아웃 에디터에 "가운데 정렬" 체크박스를 만들어 필요한 것만 켠다.**

이 방식이 더 낫다. 저장값 일괄 이전이 필요 없어지고(Task 4의 이전 단계 삭제), 디자이너가 버튼별로 고를 수 있고, 체크하는 순간 지금 위치를 중심값으로 환산해 넣으므로 **켜도 문구가 움직이지 않는다.**

기존 `hidden` 체크박스와 똑같은 배선을 따른다. 그때 서버 허용 목록에 필드를 빠뜨려 저장이 400으로 거절되고 "편집 중"이 무한히 깜빡인 사고가 있었으니, **아래 다섯 곳을 모두 건드려야 한다.**

**Files:**
- Modify: `src/ui/layout.ts` (`Pos` 인터페이스, `setStyle`의 삭제 가능 키 목록)
- Modify: `src/ui/editor.ts` (`applyStoredStyle`, `hasOverride`, 패널 체크박스)
- Modify: `vite.config.ts` (`/__layout` 허용 필드, `STYLE_FIELDS`)
- Modify: `src/ui/btnLabel.ts` (무조건 앵커 적용 되돌리기 + 이름 변경)
- Modify: `src/ui/minigames.ts`, `src/ui/memberBoard.ts`, `src/ui/training.ts` (이름 변경 반영)

**Interfaces:**
- Consumes: `pos`, `setStyle` (`src/ui/layout.ts`), `editable`, `ensureCoords`, `markStyled` (`src/ui/editor.ts`)
- Produces: `registerBtnLabel(key: string, b: Container): void` — `centerBtnLabel`을 대신한다. 앵커를 건드리지 않고, 문구를 `key`로 등록만 한다(기본값 = 지금 위치).
- Produces: `layout.json`의 `center?: boolean` 필드 — 켜지면 그 문구는 저장 x를 중심점으로 삼는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/layout.test.ts` 끝에 추가한다. 이 파일은 렌더러 없이 모듈 상태만 검사하는 기존 패턴을 쓴다.

```ts
describe("center 플래그 — 가운데 정렬 체크박스", () => {
  it("setStyle로 켜고 끌 수 있고, 끄면 키가 사라진다", () => {
    setStyle("t_center_flag", { center: true });
    expect(dirtyPos()["t_center_flag"]!["center"]).toBe(true);
    setStyle("t_center_flag", { center: undefined }); // 체크 해제 = 키 삭제
    expect(dirtyPos()["t_center_flag"]!["center"]).toBeNull(); // null = 서버에 삭제 요청
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/layout.test.ts`
Expected: FAIL — `center` 가 `Pos` 타입에 없어 타입 오류, 또는 `setStyle`이 키를 지우지 못해 `toBeNull()` 실패

- [ ] **Step 3: layout.ts에 필드 추가**

`Pos` 인터페이스에 한 줄 넣는다.

```ts
  hidden?: boolean; // 배경판 아트 업로드로 필요 없어진 폴백 프레임 등을 화면에서 끄기 위한 스위치
  center?: boolean; // 켜면 저장 x가 "글자 왼쪽 끝"이 아니라 "글자 중심" — 문구 길이가 달라도 자리가 유지된다
```

`setStyle`의 삭제 가능 키 목록에 `"center"`를 더한다.

```ts
  for (const k of ["scale", "fontSize", "color", "texts", "textForce", "hidden", "center"] as const) {
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/layout.test.ts`
Expected: PASS

- [ ] **Step 5: 서버 허용 필드 추가 (vite.config.ts)**

`layoutSavePlugin`의 `OK` 맵에 넣는다. 빠뜨리면 저장이 400 `unknown field: center`로 거절되고, 클라이언트가 재시도하며 상태 표시가 깜빡인다.

```ts
              hidden: (v) => typeof v === 'boolean', // 에디터 "숨김" 체크박스 (배경판 아트가 대신하는 폴백 끄기)
              center: (v) => typeof v === 'boolean', // 에디터 "가운데 정렬" 체크박스 (저장 x를 글자 중심으로)
```

같은 함수 안의 `STYLE_FIELDS`에도 더한다.

```ts
            const STYLE_FIELDS = ['scale', 'fontSize', 'color', 'texts', 'textForce', 'hidden', 'center']
```

- [ ] **Step 6: 앵커를 저장값에 따라 적용 (editor.ts)**

`applyStoredStyle` 안, `c.visible` 줄 바로 아래에 넣는다. 등록된 노드가 Text 자신일 때만 적용한다 — 그룹으로 등록된 컴포넌트의 자식 문구는 코드가 좌표를 잡으므로 건드리면 안 된다.

```ts
  c.visible = e.hidden !== true;
  if (c instanceof Text) c.anchor.x = e.center === true ? 0.5 : 0; // 가운데 정렬 스위치
```

`hasOverride`에도 더한다 — 켜진 컴포넌트가 매 프레임 다시 적용되게 한다.

```ts
  return e.scale !== undefined || e.fontSize !== undefined || e.color !== undefined || e.texts !== undefined
    || e.hidden !== undefined || e.center !== undefined;
```

- [ ] **Step 7: 패널 체크박스 추가 (editor.ts)**

"숨김" 체크박스 블록 **바로 아래**에 넣는다. 텍스트가 있는 컴포넌트에만 뜨게 하고(`info.texts.length > 0`), 켜고 끌 때 **좌표를 환산해 문구가 그 자리에 머무르게** 한다.

```ts
  // 가운데 정렬 — 켜면 저장 x가 글자 중심을 뜻해, 문구 길이가 달라져도 그 자리에 머문다.
  // 버튼 문구처럼 게임마다 라벨 길이가 다른 곳에 쓴다. 켜고 끌 때 좌표를 환산해 문구가 움직이지 않게 한다.
  if (info.texts.length > 0 && c instanceof Text) {
    const line = document.createElement("div");
    line.style.cssText = "display:flex;gap:5px;align-items:center;margin-top:3px;padding-left:2px";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = pos(name).center === true;
    cb.style.cssText = "accent-color:#ff7fb0;cursor:pointer";
    const lbl = document.createElement("label");
    lbl.textContent = "가운데 정렬";
    lbl.style.cssText = "font-size:10.5px;color:#a99bc0;cursor:pointer";
    lbl.onclick = () => cb.click();
    cb.onchange = () => {
      // 앵커가 바뀌면 같은 x가 다른 자리를 뜻한다 — 지금 보이는 위치를 유지하도록 x를 환산한다
      const half = c.width / 2;
      const nx = Math.round(cb.checked ? c.x + half : c.x - half);
      c.anchor.x = cb.checked ? 0.5 : 0;
      c.x = nx;
      setPos(name, { x: nx, y: Math.round(c.y) });
      setStyle(name, { center: cb.checked || undefined });
      markStyled(name);
    };
    line.append(cb, lbl);
    wrap.appendChild(line);
  }
```

- [ ] **Step 8: btnLabel.ts의 무조건 앵커 되돌리기 + 이름 변경**

`centerBtnLabel`을 `registerBtnLabel`로 바꾸고 앵커 조작을 없앤다. 앵커는 이제 에디터의 체크박스가 결정한다.

```ts
/** 버튼 안 문구를 레이아웃 에디터에 등록 — 아트를 바꿔 폭이 달라져도 문구만 따로 미세조정할 수 있다.
 *  기본값은 btn()이 잡아준 가운데 위치라 저장값이 없으면 지금 배치 그대로다.
 *  문구 길이가 게임마다 달라 자리가 흔들리는 버튼은 에디터의 "가운데 정렬"을 켜면 된다. */
export function registerBtnLabel(key: string, b: Container): void {
  const t = btnText(b);
  if (!t) return;
  const q = pos(key, { x: Math.round(t.x), y: Math.round(t.y) });
  t.x = q.x;
  t.y = q.y;
  editable(key, t);
}
```

- [ ] **Step 9: 호출부 이름 반영**

`centerBtnLabel`을 쓰는 네 곳을 `registerBtnLabel`로 바꾼다: `src/ui/minigames.ts`(import·`chromeLabel`·`chromeLabel2`), `src/ui/memberBoard.ts`(import·`btnLabel`), `src/ui/training.ts`(import·`btnLabel`).

`src/ui/memberBoard.ts`의 보류 행 미니버튼(`mkMini`)은 Task 2에서 `anchor.x = 0.5`와 `x: 29`로 바꿔 놨다. 원래대로 되돌린다.

```ts
        const t2 = txt(label, 10.5, color, true);
        const tq = pos(`${key}_text`, { x: Math.round((58 - t2.width) / 2), y: 4 });
        t2.x = tq.x;
        t2.y = tq.y;
```

Run: `grep -rn "centerBtnLabel" src/`
Expected: 결과 없음

- [ ] **Step 10: 타입 검사 + 전체 테스트**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 타입 오류 없음, 테스트 150건 통과 (기존 149 + 신규 1)

- [ ] **Step 11: 커밋**

```bash
git add src/ui/layout.ts src/ui/editor.ts src/ui/btnLabel.ts src/ui/minigames.ts src/ui/memberBoard.ts src/ui/training.ts vite.config.ts tests/layout.test.ts
git commit -m "$(cat <<'EOF'
가운데 정렬을 에디터 체크박스로 — 필요한 문구만 켠다

문구를 일괄 중앙 앵커로 바꾸면 이미 저장된 좌표(easy_start_text 등)가 중심점으로
재해석돼 왼쪽으로 밀린다. 대신 layout.json에 center 플래그를 두고 레이아웃
에디터에서 문구별로 켜게 했다. 체크하는 순간 지금 위치를 중심값으로 환산해 넣어
켜도 문구가 움직이지 않고, 이후 문구 길이가 달라져도 그 자리를 지킨다.

서버 허용 필드·STYLE_FIELDS에도 함께 등록했다 — hidden 때처럼 빠뜨리면 저장이
400으로 거절되고 재시도가 무한히 돈다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: E2E 검증

저장값 이전은 더 이상 필요 없다 (Task 2b가 체크박스 방식으로 바꿔, 기존 좌표의 의미가 그대로 유지된다). 이 태스크는 앞선 세 태스크의 결과를 실제 화면에서 확인한다.

**Files:**
- Create: `/private/tmp/claude-501/-Users-sunmipark-github-debut-loop/0d3339f7-783e-47f4-b040-fecfbd84eb29/scratchpad/labelcheck.mjs` (검증 스크립트 — 저장소 밖 스크래치패드)

**Interfaces:**
- Consumes: `window.__layoutKeys()` — 현재 화면에 등록된 레이아웃 키 배열
- Consumes: `window.__layoutProbe(name)` — `{ x, y, w, visible, texts: [{ text, x, y, w, wrap, wrapW, fs }] }`

- [ ] **Step 1: dev 서버 확인**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5200/`
Expected: `200`

`200`이 아니면 워크트리에서 `npm run dev:share -- --port 5200 --strictPort` 를 백그라운드로 띄우고 다시 확인한다.

- [ ] **Step 2: 검증 스크립트 작성**

스크래치패드에 아래 파일을 만든다. 워크트리 안에 만들면 저장소가 더러워진다.

```js
import { createRequire } from 'module';
const require = createRequire('/Users/sunmipark/github/debut-loop/.claude/worktrees/qa-3rd/package.json');
const { chromium } = require('playwright-core');

const gate = process.argv[2] ?? '센터 대결';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 500, height: 900 } });
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto('http://localhost:5200/');
const wait = (n) => p.waitForFunction(s => window.__scene === s, n, { timeout: 60000 });
await wait('title');
await p.keyboard.press('Space');
await wait('lobby');
await p.waitForTimeout(800);
const r = await p.evaluate(() => {
  const c = document.querySelector('canvas').getBoundingClientRect();
  return { x: c.x, y: c.y, w: c.width, h: c.height };
});
const cv = (x, y) => [r.x + x / 430 * r.w, r.y + y / 800 * r.h];
await p.mouse.click(...cv(214, 528));
await wait('game');
await p.waitForTimeout(1200);
await p.click('button[title="치트 메뉴"]');
await p.waitForTimeout(300);
await p.evaluate((g) => {
  [...document.querySelectorAll('button')].find(x => x.textContent.includes(g))?.click();
}, gate);
await p.waitForTimeout(300);
await p.mouse.click(10, 10);
await p.waitForTimeout(2000);
for (let i = 0; i < 6; i++) {
  const bub = await p.evaluate(() =>
    [...document.querySelectorAll('div')].some(d => d.style.zIndex === '1100' && d.style.position === 'fixed'));
  if (!bub) break;
  await p.mouse.click(290, 730);
  await p.waitForTimeout(500);
}
const keys = await p.evaluate(() => window.__layoutKeys().filter(k => k.startsWith('gate')));
console.log('GATE KEYS:', JSON.stringify(keys));
const hard = await p.evaluate(() => window.__layoutProbe('hard_start_text'));
console.log('hard_start_text:', JSON.stringify(hard));
await p.screenshot({ path: '/private/tmp/claude-501/-Users-sunmipark-github-debut-loop/0d3339f7-783e-47f4-b040-fecfbd84eb29/scratchpad/label-' + gate + '.png' });
await b.close();
console.log('done');
```

- [ ] **Step 3: 관문 키 분리 확인 — 센터 대결(1→2막)**

Run: `cd /private/tmp/claude-501/-Users-sunmipark-github-debut-loop/0d3339f7-783e-47f4-b040-fecfbd84eb29/scratchpad && node labelcheck.mjs "센터 대결"`

Expected:
- `GATE KEYS`에 `gate_act2`·`gate_act2_title`·`gate_act2_exit`가 있다
- 접두사 없는 `gate`·`gate_title`·`gate_exit`는 **없다**
- `hard_start_text`의 `x`가 45 (기존 저장값 그대로 — Task 2b가 의미를 바꾸지 않았다)

- [ ] **Step 4: 관문 키 격리 확인 — 단서 대조(4막)**

Run: `cd /private/tmp/claude-501/-Users-sunmipark-github-debut-loop/0d3339f7-783e-47f4-b040-fecfbd84eb29/scratchpad && node labelcheck.mjs "단서 대조"`

Expected: `GATE KEYS`에 `gate_clue`·`gate_clue_title`·`gate_clue_exit`가 있고 `gate_act2*`는 없다

- [ ] **Step 5: 가운데 정렬 체크박스 동작 확인**

`?editor` 로 열어 편집 모드에서 `hard_start_text` 행의 "가운데 정렬"을 켰다 껐다 하며, 문구가 제자리에 머무는지 본다. 아래 스크립트를 스크래치패드에 만들어 실행한다.

```js
import { createRequire } from 'module';
const require = createRequire('/Users/sunmipark/github/debut-loop/.claude/worktrees/qa-3rd/package.json');
const { chromium } = require('playwright-core');
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 500, height: 900 } });
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto('http://localhost:5200/?editor');
await p.waitForTimeout(3000);
await p.evaluate(() => {
  [...document.querySelectorAll('button')].find(x => x.textContent.includes('편집 중'))?.click();
  document.querySelectorAll('body > div').forEach(d => {
    if (d.textContent.includes('레이아웃 에디터')) d.style.pointerEvents = 'none';
  });
});
const wait = (n) => p.waitForFunction(s => window.__scene === s, n, { timeout: 60000 });
await wait('title');
await p.keyboard.press('Space');
await wait('lobby');
await p.waitForTimeout(800);
const r = await p.evaluate(() => {
  const c = document.querySelector('canvas').getBoundingClientRect();
  return { x: c.x, y: c.y, w: c.width, h: c.height };
});
const cv = (x, y) => [r.x + x / 430 * r.w, r.y + y / 800 * r.h];
await p.mouse.click(...cv(214, 528));
await wait('game');
await p.waitForTimeout(1200);
await p.click('button[title="치트 메뉴"]');
await p.waitForTimeout(300);
await p.evaluate(() => {
  [...document.querySelectorAll('button')].find(x => x.textContent.includes('센터 대결'))?.click();
});
await p.waitForTimeout(300);
await p.mouse.click(10, 10);
await p.waitForTimeout(2000);
const bounds = () => p.evaluate(() => {
  const pr = window.__layoutProbe('hard_start_text');
  return pr && { x: pr.x, w: pr.texts[0] && pr.texts[0].w };
});
const before = await bounds();
// 편집 모드로 전환 후 "가운데 정렬" 체크
await p.keyboard.press('Backquote');
await p.waitForTimeout(800);
const toggled = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => x.textContent.trim().endsWith('hard_start_text'));
  if (!btn) return 'row not found';
  const row = btn.parentElement.parentElement;
  const boxes = [...row.querySelectorAll('input[type=checkbox]')];
  const lbls = [...row.querySelectorAll('label')].map(l => l.textContent);
  const i = lbls.indexOf('가운데 정렬');
  if (i < 0) return 'checkbox not found: ' + JSON.stringify(lbls);
  boxes[i].click();
  return 'clicked';
});
console.log('toggle:', toggled);
await p.waitForTimeout(600);
const after = await bounds();
console.log('before:', JSON.stringify(before), 'after:', JSON.stringify(after));
await p.screenshot({ path: '/private/tmp/claude-501/-Users-sunmipark-github-debut-loop/0d3339f7-783e-47f4-b040-fecfbd84eb29/scratchpad/center-toggle.png' });
await b.close();
console.log('done');
```

Expected:
- `toggle: clicked` (체크박스를 찾았다)
- `before`의 x와 `after`의 x가 **문구 폭의 절반만큼 차이난다** (앵커가 바뀌었으므로 저장 x는 달라지지만)
- 스크린샷에서 문구가 버튼 안 **같은 자리**에 그대로 있다 — 이것이 이 태스크의 핵심 확인 사항이다

- [ ] **Step 6: 전체 테스트 + 타입 검사**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 타입 오류 없음, 테스트 150건 통과

- [ ] **Step 7: 검증 결과를 보고서에 남긴다**

검증은 스크래치패드 스크립트로만 하므로 저장소에 커밋할 변경이 없다. 위 4개 확인의 실제 출력(관문 키 목록, 토글 전후 좌표)을 보고서 파일에 그대로 붙인다. 커밋할 것이 없으면 커밋하지 않는다.

---

## Self-Review 결과

**스펙 커버리지** — 설계 문서의 요구가 모두 태스크에 대응한다.

| 스펙 항목 | 대응 태스크 |
|---|---|
| 중앙 앵커 + 저장 x = 중심점 | Task 1 Step 3 |
| 중심 보정 건너뛰기 | Task 1 Step 6 |
| 적용 범위 5개 등록 경로 | Task 2 Step 1–5 |
| 제외 대상(backBtn·card_text 등) 미변경 | Task 2 — 해당 파일을 건드리지 않음 |
| 관문 접두사 5종 + 자동 분리 | Task 1 Step 3(`gateKeyPrefix`), Task 3 Step 1 |
| 미저장 시 공용 키 승계 | Task 3 Step 1(`lpos`) |
| 저장값 이전 10개 키 | Task 4 Step 3 |
| 문구 덮어쓰기 일원화(카피 유지) | Task 4 Step 3 후반 |
| 검증 4항목 | Task 3 Step 4, Task 4 Step 5–6 |

**미해결 사항 없음** — 스펙의 "범위 밖"(사이드 팝업 배경판 슬롯, 관문 배경판 아트 교체)은 이 계획에 포함하지 않았다.
