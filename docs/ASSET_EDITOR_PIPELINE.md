# 에셋 업로드 → 게임 반영 → 레이아웃 조정 파이프라인

> **이 문서의 대상** — DEBUT LOOP! 프로젝트를 처음 맡는 에이전트.
> 디자이너가 에디터에서 이미지를 올리면 그것이 어떻게 실제 게임 화면에 붙고, 위치·크기를 어떻게 조정하는지의 전 과정을 다룬다.
> 작성 기준일 2026-08-06

---

## 0. 프로젝트 기본 정보

| 항목 | 값 |
|---|---|
| 경로 | `~/github/debut-loop` |
| 스택 | TypeScript + PixiJS v8 + Vite + Capacitor(Android) |
| dev 서버 | `nohup npx vite --port 5174 --strictPort &` → `http://localhost:5174` |
| 화면 기준 | 430 × 800 (모바일 세로) — 코드 전역에서 `W=430`, `H=800` |
| git | 독립 저장소 `Sunmi-Park-private/debut-loop` (public). 기본 브랜치 `main`, PR 단위로 커밋 이력 유지 |
| 외부 공유 | `cloudflared tunnel --url http://localhost:5174` (vite `allowedHosts`에 `.trycloudflare.com` 허용됨) |

> 터널로 접속하면 HMR 소켓이 안 붙는다. 값을 바꾼 뒤에는 **새로고침 + 해당 화면 재진입**이 필요하다.

---

## 1. 전체 그림

```
[디자이너]                      [vite dev 플러그인]                [게임 런타임]
 ui.html 에서                    POST /__skinupload                 uiSkin.ts
 슬롯에 PNG 드롭   ──────────▶   ├ public/assets/ui/<id>.png 저장  ──▶  skinFit(id, w, h)
                                 ├ uiskins.json 의 file 필드 갱신        → Container 반환
                                 └ ws 푸시(asset-updated)               → 화면에 배치
                                                                            │
 게임 ⚙️ 치트 메뉴                POST /__layout                          editable(name, c)
 → 레이아웃 에디터  ──────────▶   src/data/layout.json 통째 교체   ◀──── pos(name, default)
   드래그로 위치 조정
```

핵심은 **세 개의 SSOT 파일**이다.

| 파일 | 무엇을 담나 | 누가 쓰나 |
|---|---|---|
| `src/data/uiskins.json` | UI 슬롯 정의 141개 (id·label·file·size·mode·scale·opacity) | ui.html 에디터 |
| `src/data/layout.json` | 컴포넌트 좌표 `{name: {x, y}}` | 게임 내 레이아웃 에디터 |
| `src/data/backgrounds.json` · `charskins.json` | 배경 17슬롯 · 캐릭터 스킨 121슬롯 | bg.html · char.html |

---

## 2. 에디터 목록

| URL | 용도 | 저장 엔드포인트 |
|---|---|---|
| `/ui.html` | **UI 스킨 슬롯** — 업로드·배율·농도 | `/__skinupload` `/__uiscale` `/__uiopacity` |
| `/bg.html` | 배경(막별·시스템) — 이미지/영상/시퀀스 | `/__bgupload` `/__bgseq` `/__backgrounds` |
| `/char.html` | 캐릭터 스킨(전신·표정·시퀀스) | `/__charupload` `/__charseq` `/__charscale` |
| `/bgm.html` | BGM·효과음 | `/__bgmupload` |
| `/beat.html` · `/flow.html` | 리듬 박자표 · 스토리 비트 플로우 | `/__beatmaps` `/__beats` |
| **게임 화면 우하단 ⚙️** | **레이아웃 에디터**(좌표) + 튜닝 + 치트 | `/__layout` `/__tuning` |

---

## 3. 1단계 — 슬롯 정의 (`uiskins.json`)

슬롯이 없으면 업로드할 자리도 없다. 새 아트를 받으려면 먼저 슬롯을 만든다.

```jsonc
{
  "id": "gate-stop-btn",                    // ^[a-z0-9-]+$ — 파일명이 되므로 규칙 엄격
  "label": "알바 · STOP 버튼 (업로드 시 라벨 문구 미표시) — 1배율=원본 크기",
  "file": "assets/ui/gate-stop-btn.png",    // 업로드 시 서버가 자동으로 채움. 비어 있으면 미업로드
  "size": [120, 120],                       // 코드가 넘기는 기준 박스 (실제 표시 크기와 다를 수 있음)
  "mode": "stretch",                        // stretch | 9slice | 3slice
  "small": true,                            // 에디터에서 셀을 작게 표시
  "scale": 0.35,                            // 에디터 배율 드롭다운 값 (0.1~2.0)
  "natural": true,                          // 1배율 = 원본 픽셀 크기로 표시
  "vid": true                               // mp4/webm 업로드 허용
}
```

**`label` 작성 규칙** — 에디터 UI가 `" · "` 앞부분으로 그룹(구분선)을 만든다.
`"알바 · STOP 버튼"` → **알바** 그룹에 STOP 버튼이 들어간다. 같은 화면 안에서 종목 순서대로 배치할 것.

**⚠️ 버튼류에 `9slice` 금지.** Director가 명시적으로 정한 규칙이다. 버튼은 원본 비율 그대로 표시한다.

슬롯을 추가·삭제하면 `tests/uiskins.test.ts`의 개수 기대값도 함께 고쳐야 한다(현재 141).

---

## 4. 2단계 — 업로드가 실제로 하는 일

`vite.config.ts`의 `assetUploadPlugin`이 처리한다. 알아둘 동작:

1. `slot` id 형식과 확장자를 화이트리스트로 검증 (경로는 서버가 조립 → 경로 탈출 차단)
2. `public/assets/ui/<slot>.<ext>` 로 저장
3. `postProcess` 훅 실행 — 배경은 `fitBgSize`가 **1080×2400으로 cover 리사이즈+중앙 크롭**, `.mov`는 알파 webm 변환
4. **같은 슬롯의 다른 확장자 잔재 삭제** (폴백 오염 방지). 단:
   - 영상 업로드 시 기존 이미지는 **폴백 원본으로 보존**
   - `webm` + `mov` 쌍은 iOS HEVC 알파용이라 함께 유지
5. 매니페스트의 `file` 필드 갱신 + 모듈 캐시 무효화
6. 접속한 **모든 클라이언트에 ws 푸시**(`asset-updated`) → 터널로 붙은 폰까지 제자리 갱신

`DELETE`는 "슬롯 비우기"다. 현재 연결된 타입만 지우고 반대 타입(폴백 쌍)은 남긴다.

---

## 5. 3단계 — 코드 배선 (`src/ui/uiSkin.ts`)

업로드만으로는 화면에 안 나온다. **어떤 헬퍼로 그릴지 코드가 정해야 한다.**

| 헬퍼 | 동작 | 언제 쓰나 |
|---|---|---|
| `skinNode(id, w, h)` | 슬롯의 `mode`대로 stretch / 9slice / 3slice | 프레임·패널 (늘어나도 되는 것) |
| `skinFit(id, w, h)` | **contain** — 박스 안에 비율 유지로 담고 중앙 정렬 | **기본값.** 버튼·아이콘·배경판 대부분 |
| `skinCover(id, w, h)` | cover + 마스크 크롭 | 화면 전체 배경 |
| `skinNatural(id, w, h)` | 1배율 = 원본 픽셀 | 원본 크기를 지켜야 하는 것 |
| `skinTex(id)` / `skinTexTrim(id)` | 원본 Texture 반환 — **배율(`scale`) 미적용** | 직접 Sprite를 만들 때 |
| `skinScale(id)` | 슬롯의 배율값만 조회 | `skinTex` 계열과 **반드시 짝으로** |

모든 헬퍼는 **슬롯이 비어 있으면 `null`을 반환**한다. 호출부는 항상 벡터 폴백을 준비해야 한다.

```ts
const art = skinFit("gate-stop-btn", 120, 120);
if (art) { art.x = x; art.y = y; parent.addChild(art); }
else parent.addChild(new Graphics().roundRect(x, y, 120, 44, 10).fill(0xff7fb0)); // 폴백
```

### 표시 방식 3분류 — 이 프로젝트에서 가장 자주 나온 문제

| 방식 | 결과 | 헬퍼 |
|---|---|---|
| ① **채우기** | 박스를 꽉 채움 → **비율이 다르면 눌림** | `skinNode`(stretch/9slice) |
| ② **담기** | 박스 안에 비율 유지 → 여백 생김 | `skinFit` |
| ③ **박스를 아트에 맞춤** | 폭 고정 + 높이를 아트 비율로 도출 → 눌림도 여백도 없음 | `skinTexTrim`으로 비율 계산 후 배치 |

```ts
// ③ 예시 — 카드덱 배너
const tex = skinTexTrim("lobby-deck-banner");
const h = tex ? Math.round(W * (tex.height / tex.width)) : 230;  // 폭 고정, 높이 도출
const node = skinNode("lobby-deck-banner", W, h);
```

> **🕳 trimAlpha 함정** — 로더가 투명 여백을 자동 크롭한다. 1024×1024 정사각 PNG여도 실제 아트가 644×754면
> `stretch`로 48×48에 넣는 순간 세로로 눌린다. **"업로드했는데 눌려 보인다"의 원인 대부분이 이것**이고, 답은 `skinFit`이다.

### 동적 슬롯 id

일부 슬롯은 템플릿 문자열로 만들어진다. 텍스트 검색으로는 "미배선"으로 오판하기 쉬우니 주의.

```ts
skinFit(`grade-${grade}`, 180, 64)          // grade-perfect / -good / -clear
skinFit(`gate-match-sym-${n + 1}`, ...)     // 짝맞추기 심볼 1~8
skinFit(`member-icon-${characterId}`, ...)  // 멤버 프로필 7종
skinFit(name.replace("lobby_", "lobby-icon-"), 48, 48)  // 로비 사이드 아이콘
```

---

## 6. 4단계 — 레이아웃 에디터 연결

**슬롯을 그렸다고 끝이 아니다.** Director가 위치를 직접 조정하려면 `editable`로 등록해야 한다.

### 기본 패턴

```ts
import { pos } from "./layout";
import { editable, beginFrame } from "./editor";

beginFrame();                                 // 매 draw 시작 시 등록 목록 초기화

const g = new Container();
const p = pos("lobby_deck_title", { x: 0, y: 0 });   // 저장값 없으면 기본값
g.x = p.x; g.y = p.y;
g.addChild(child);
parent.addChild(g);
editable("lobby_deck_title", g);              // 에디터에 등록
```

실무에서는 이 3줄을 헬퍼로 감싼다.

```ts
// boot.ts — 시트 내부 조각용
const dgrp = (name: string, child: Container): Container => {
  const g = new Container();
  const q = pos(name, { x: 0, y: 0 });
  g.x = q.x; g.y = q.y;
  g.addChild(child);
  sheet.addChild(g);
  editable(name, g);
  return g;
};
```

### 네임스페이스(`ns`)와 폴백 승계

같은 화면이 종목별로 다른 좌표를 가져야 할 때 `ns`를 접두어로 붙인다 (`vocal_`, `funds_`, `clue_`, `block_`).
아직 저장값이 없으면 공통 키의 좌표를 물려받게 하는 것이 `grpFb`다.

```ts
const grpFb = (name, fallbackName, ...items) => {
  const key = ns ? `${ns}_${name}` : name;
  const p = allPos()[key] ?? pos(fallbackName, { x: 0, y: 0 });  // 저장값 없으면 공통 키 승계
  ...
};
```

### 두 개의 훅 — 이걸 모르면 "에디터 켜면 화면이 튕긴다"

| 훅 | 문제 | 해결 |
|---|---|---|
| `setEditorToggleHook(fn)` | 에디터 토글 시 전체 리드로우가 일어나 게임이 리셋 | `true` 반환하면 리드로우 생략 |
| `setRedrawHook(fn)` | 배율·농도를 바꾸면 **화면 전체가 다시 그려져 팝업이 닫힘** | 현재 화면만 다시 그리는 함수를 등록 |

```ts
// 팝업(연습 보드 등)을 열 때
setRedrawHook(() => drawThisScreenOnly());
// 닫을 때 반드시 해제
setRedrawHook(null);
```

**화면을 새로 만들 때마다 `setRedrawHook`을 등록해야 한다.** 연습(게임/결과/실패), 관문(라운드/카드선택/실패), 멤버 점검(5뷰)이 각각 자기 재렌더를 등록하고 있다.

### 정렬 보정은 컨테이너 **안**에서

```ts
// ❌ 매 렌더마다 폭 절반씩 밀린다 — story_tab 좌표가 저장 안 되던 실제 버그
tab.x = pos("story_tab").x - tab.width / 2;

// ✅ 그룹은 저장 좌표 그대로, 정렬은 자식이 담당
const box = new Container();
box.x = pos("story_tab").x;
tab.x = -tab.width / 2;
box.addChild(tab);
editable("story_tab", box);
```

---

## 7. 함정 모음 (전부 실제로 겪은 것)

1. **`uiskins.json` / `layout.json`은 vite watch 제외 대상이다.**
   에디터 저장은 ws 푸시로 즉시 반영되지만, **파일을 직접 수정하면 dev 서버를 재시작해야 반영된다.**
   (제외 이유: 저장할 때마다 전체 리로드 → 프롤로그 리셋 방지)

2. **`layout.json`은 Director 소유다.** 임의로 고치지 말 것. 초기화가 필요하면 승인을 받고, 반드시 백업(`.shots/layout-backup*.json`)을 남긴다.

3. **"배율이 안 먹는다"의 두 가지 원인**
   - 슬롯이 비어 있어 벡터 폴백이 그려지는 중 (폴백은 배율과 무관)
   - `skinTex`/`skinTexTrim` 경로라 `scale`이 적용 안 됨 → `skinScale(id)`를 직접 곱해야 한다

4. **좌표를 옮겼는데 안 움직인다** → 그 컴포넌트가 부모 그룹에만 `editable`돼 있고 개별 등록이 없는 경우. 조각별로 쪼개 등록한다.

5. **일괄 수정 금지.** 슬롯 60개를 한 번에 손보는 sweep은 거절된 이력이 있다. 지적된 것부터 하나씩.

6. **텍스트 레이어는 최상단으로.** 게임 설명 문구는 배경판·트랙에 가려지기 쉽다. `body.addChild(g)`를 마지막에 한 번 더 호출해 재부상시키는 패턴을 쓴다.

7. **문구는 이미지가 아니라 코드로.** 로컬라이징 대비. 아트에서 글자를 지우고 코드로 그린다. 색상 상수는 목업 픽셀 실측값을 쓴다(`HINT_PINK`, `HINT_GOLD` 등).

8. **영상 슬롯** — mp4/webm. iOS는 WebKit 3중 함정이 있다(Pixi 로더 행·VP9 알파 미지원·WebGL 알파 소실). 알파 영상은 **webm + HEVC mov 이중 인코딩**이 필요하다(`-pix_fmt bgra`).

---

## 8. 검증 절차

```bash
cd ~/github/debut-loop
npx tsc --noEmit      # 타입
npx vitest run        # 유닛 (현재 110개)
```

화면 확인은 Playwright로 한다. `playwright`는 없고 **`playwright-core` + 시스템 Chrome**을 쓴다.

```js
import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 430, height: 800 } });
await p.goto('http://localhost:5174/', { waitUntil: 'networkidle' });
// 프롤로그 건너뛰기 → Space → 로비 → Space → 게임
for (let i = 0; i < 8; i++) { await p.mouse.click(383, 96); await p.waitForTimeout(250); }
await p.keyboard.press('Space');
// 치트 메뉴: button[title="치트 메뉴"] 를 dispatchEvent로 클릭
await p.screenshot({ path: '.shots/check.png' });
```

**임시 조작은 반드시 원복한다.** 테스트용으로 바꾼 배율·상수·아트 파일을 그대로 두지 말 것.

---

## 9. 게임 내 진입 경로 (검증용)

우하단 **⚙️ 치트 메뉴** — 게임(회차) 진입 후에만 활성화되는 항목이 있다.

| 목적 | 경로 |
|---|---|
| 레이아웃 에디터 | ⚙️ → 레이아웃 에디터 토글 (URL에 `?editor` 를 붙여도 켜짐) |
| 연습하기 6종 | ⚙️ → `🎹 연습 메뉴` |
| 관문 5막 | ⚙️ → `🥇 센터 대결` / `🎯 무대 집중` / `📷 포토카드` / `🔍 단서 대조` / `🎤 사보타주 저지` |
| 멤버 점검 | ⚙️ → `👥 멤버 보드 열기` |
| 오디션 | ⚙️ → `🎤 오디션 재료` → `🎤 오디션 보기` |
| 2회차 | ⚙️ → `⏩ 1회차 완주 → 회귀 화면` → 정속/빠른 모드 선택 |

---

## 10. 신규 슬롯 추가 — end-to-end 체크리스트

- [ ] 1. `uiskins.json`에 슬롯 추가 (`id` 규칙, `label`은 `"그룹 · 이름"` 형식, 필요 시 `small`/`natural`/`vid`)
- [ ] 2. `tests/uiskins.test.ts`의 슬롯 개수 기대값 갱신
- [ ] 3. **dev 서버 재시작** (uiskins.json은 watch 제외)
- [ ] 4. `/ui.html`에서 슬롯이 보이는지 확인
- [ ] 5. 코드 배선 — 적절한 헬퍼 선택(대부분 `skinFit`), 폴백 유지
- [ ] 6. `pos` + `editable`로 레이아웃 에디터 등록 (조각 단위로 쪼갤 것)
- [ ] 7. 그 화면에 `setRedrawHook` 등록 여부 확인
- [ ] 8. `npx tsc --noEmit` + `npx vitest run`
- [ ] 9. Playwright로 실제 화면 캡처 확인
- [ ] 10. Director에게 보고 — 무엇을 어떻게 표시했는지(3분류 중 무엇), 배율 기본값

---

## 11. 협업 규칙

- **Director(Sunmi)의 승인 없이 실행하지 않는다.** 특히 브랜치 생성·머지·배포·파괴적 작업.
- **한국어 존댓말**로 대화한다.
- **빌드(APK·단일 HTML)는 요청받았을 때만.** 코드 수정 후 선제 빌드 금지 — `tsc`·`vitest`·dev 확인까지가 기본.
- **Director가 소스를 직접 수정 중이다.** 편집 전 반드시 `Read`하고, 낯선 코드를 되돌리지 말 것 — `git diff`로 Director의 미커밋 변경분을 먼저 확인한다.
- **APK 용량 상한은 2GB.** 용량 절감 제안은 불필요하며 화질·성능을 우선한다.

---

## 12. 참고 문서

| 문서 | 내용 |
|---|---|
| `docs/QA-ASSET-CHECKLIST.md` | 자산 적용 QA 체크리스트 238행 (슬롯별 검수 항목·미업로드 목록·미배선 목록) |
| `docs/사전과제_최종_제출_체크리스트.md` | 해커톤 제출물 5종 체크리스트 + 현재 준비 상태 |
| `docs/BUILD_ROADMAP.md` · `CARD_SYSTEM.md` · `REGRESSION_LOOP.md` | 게임 설계 |
| `~/Downloads/claude-artifacts/index.html` | 목업·와이어프레임 14건 (오프라인 열람 가능) |
