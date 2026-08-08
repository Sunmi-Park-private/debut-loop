# 플로우 에디터 ↔ 게임 실시간 프리뷰 설계

> 작성일 2026-08-08 · 대상 브랜치 `fix/audition-feature`

## 문제

대사 한 줄을 고치려면 이 과정을 반복해야 한다.

1. 플로우 에디터(`flow.html`)에서 문구 수정
2. 💾 저장 → `beats/demo2_zeroc.json` 기록
3. **vite가 파일 변경을 감지해 게임 탭을 통째로 리로드**
4. 프롤로그부터 다시 진행해 해당 장면까지 도달

`beats` 파일만 dev 서버 watch 제외 목록에서 빠져 있어 3번이 발생한다. 다른 데이터 파일 8종
(`layout`·`uiskins`·`backgrounds` 등)은 이미 제외돼 있고, 각자 웹소켓 푸시로 제자리 갱신한다.
확인해야 할 장면이 5막 24주차에 있으면 한 글자 고칠 때마다 30분이 든다.

## 목표

- 플로우 에디터에서 타이핑하면 **저장 없이** 실행 중인 게임 화면에 반영된다
- 반영해도 **새로고침·재시작이 없다** — 장면·커서·게이지·덱·회차가 그대로다
- 화면에 떠 있는 대사는 즉시 바뀌고, **아직 도달하지 않은 장면**도 진입 시 최신본으로 보인다
- 파일 기록은 **저장 버튼을 눌렀을 때만** 한다
- 터널 너머 **다른 기기**(폰·태블릿)에도 반영된다

## 범위

문구만 다룬다 — `textKey`, `left.label`, `right.label`, `left.hint`, `right.hint`.

게이지 효과·분기 조건·비트 추가/삭제는 제외한다. 구조가 바뀌면 진행 커서가 가리키던 비트가
사라질 수 있어 "진행 상태 유지"라는 목표와 충돌한다.

## 왜 이 방식이 성립하는가

- `src/data/index.ts`가 `beats` 배열을 모듈 로드 시 한 번 만들고, `createRunController(beats, …)`가
  그 배열을 **참조로** 들고 있다
- `app.ts`의 `draw()`는 매 렌더마다 현재 비트의 `textKey`·`label`을 **다시 읽는다**
- 커서는 선택했을 때(`advance()`)만 움직인다. `draw()`는 진행을 건드리지 않는다

따라서 **배열 안 객체를 제자리에서 고치고 `triggerRedraw()`만 부르면** 현재 카드가 새 문구로
다시 그려진다. 재시작이 필요 없다.

## 구조

```
플로우 에디터                     dev 서버                      게임 (탭·폰)
 타이핑 ─디바운스 300ms─▶ POST /__beatspreview
                          메모리 오버레이 병합
                                 │
                                 └─ ws: beats-preview ─▶ 오버레이 적용
                                                         beats 배열 제자리 수정
                                                         triggerRedraw()
```

### 오버레이 데이터

```ts
type BeatTextOverlay = Record<string, {
  textKey?: string;
  left?:  { label?: string; hint?: string };
  right?: { label?: string; hint?: string };
}>;
```

바뀐 비트만 담는다. 아직 도달하지 않은 비트도 오버레이에 있으면 진입 시 최신본으로 보인다.

## 컴포넌트

### 1. `beatsPreviewPlugin` — dev 서버 (vite.config.ts)

| 메서드 | 동작 |
|---|---|
| `POST /__beatspreview` | 부분 오버레이를 메모리에 병합 → 전체 오버레이를 ws로 방송 |
| `GET /__beatspreview` | 현재 오버레이 반환 — 게임을 새로고침해도 임시본이 유지되는 근거 |
| `DELETE /__beatspreview` | 오버레이 비우기 (되돌리기) |

상태는 서버 메모리에만 둔다. dev 서버를 재시작하면 사라진다 — 임시본이므로 의도된 동작이다.

`/__beats` 저장이 성공하면 오버레이를 비우고 `beats-committed`를 방송한다.

### 2. `src/ui/beatsPreview.ts` — 게임 클라이언트 (신규)

- 부팅 시 `GET /__beatspreview`로 오버레이를 받아 적용
- ws `beats-preview` 수신 → 적용 후 `triggerRedraw()`
- **원본 값을 별도로 보관**해, 오버레이에서 빠진 필드는 원래 문구로 되돌린다
- ws `beats-committed` 수신 → **적용된 문구를 기준값으로 승격**한다.
  단순히 오버레이를 비우면 메모리에 남은 옛 문구로 화면이 되돌아간다
- 표시등: 화면 우상단 `✎ 미저장 N` 배지. **N = 오버레이에 담긴 비트 수**(필드 수가 아니다).
  누르면 되돌리기(`DELETE`). dev에서만 보인다

핵심 함수는 순수 함수로 분리해 렌더러 없이 테스트한다.

```ts
/** 비트별 원본 문구 스냅샷 — 오버레이에서 빠진 필드를 되돌릴 때 쓴다.
 *  적용 직전의 값을 처음 한 번만 기록하고, 승격(commit) 시 현재 값으로 갱신한다. */
type Baseline = Map<string, { textKey?: string; leftLabel?: string; rightLabel?: string;
                              leftHint?: string; rightHint?: string }>;

applyOverlay(beats: Beat[], overlay: BeatTextOverlay, baseline: Baseline): void
```

### 3. `src/tools/flowEditor.ts`

입력 이벤트에 300ms 디바운스를 걸어 **바뀐 비트만** `POST`한다.
💾 저장 버튼은 지금처럼 전체 문서를 `/__beats`로 보낸다.

### 4. `vite.config.ts` — watch 제외 추가

`'**/src/data/beats/*.json'`을 `server.watch.ignored`에 넣는다.
이것이 "저장하면 프롤로그부터 다시" 문제의 직접적인 해결이다.

## 실패·경계

| 상황 | 동작 |
|---|---|
| 오버레이의 비트 id가 없음 | 그 항목만 무시 |
| dev 서버 재시작 | 오버레이 소멸 (설계상 허용) |
| 프로덕션 빌드 | 미포함 — dev 플러그인 + `import.meta.hot` 가드 |
| 여러 명이 같은 비트를 동시 편집 | 나중에 보낸 쪽이 이긴다. 문구 프리뷰라 손실이 없다 |
| 저장 실패 | 오버레이 유지 + 배지 유지 — 임시본이 사라지지 않는다 |

## 테스트

**유닛** (`tests/beatsPreview.test.ts`)

- `applyOverlay`가 지정한 필드만 바꾸고 나머지를 보존한다
- 오버레이에서 필드가 빠지면 원본 문구로 되돌린다
- 없는 비트 id는 무시한다
- 승격(commit) 후에는 오버레이를 비워도 문구가 유지된다

**수동**

- 노트북 플로우 에디터에서 수정 → 폰 게임 화면에 반영, 진행 상태 유지
- 저장 → 새로고침 없음, 배지만 사라짐, 문구 유지
- 게임 새로고침 → 미저장 임시본이 그대로 보임

## 이 설계가 아닌 것

- 게임을 iframe에 넣은 별도 미리보기 창이 아니다. **실제 게임 화면 그대로**에 반영한다
- 비트 구조 편집(추가·삭제·분기)은 다루지 않는다
- 프로덕션 기능이 아니다. dev 서버에서만 동작한다
