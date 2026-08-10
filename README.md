# Debut Loop!

> Reigns식 스와이프 선택 × 로그라이크 아이돌 육성 게임
> NAN 2026 (NHN GAME × AI 해커톤) 출품작

한 번의 런은 24주. 매주 스와이프로 선택하고, 게이지를 관리하고,
게이트를 통과해 데뷔를 향한다. 실패하면 회귀해 다음 런을 시작한다.

## 실행

**Node 20~24가 필요합니다** (`.nvmrc`에 22 고정). Node 25 이상에서는
빌드 도구(esbuild)가 동작하지 않습니다.

```bash
nvm use          # 또는 Node 22 사용
npm install
npm run dev      # 개발 서버 (localhost:5173)
npm run build    # 타입체크 + 프로덕션 빌드
npm run test     # 유닛 테스트
```

에셋이 저장소에 포함되어 있어 clone 후 바로 실행됩니다.

### 모바일 빌드

```bash
npm run apk:debug      # 안드로이드 APK (치트 메뉴 포함 — 팀 테스트용)
npm run apk:release    # 안드로이드 APK (치트 제외 — 제출·외부 공유용)
npm run build:single   # 단일 HTML (로컬 파일로 실행)
```

빌드된 APK는 에디터 허브(`/editor.html`) 우측 상단에서 바로 내려받을 수 있습니다.

JDK와 안드로이드 SDK가 필요합니다. Android Studio를 설치하면 둘 다 들어오고,
SDK 경로는 `android/local.properties`(git 미포함)에 적습니다.

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties
```

## 아키텍처

```
data (콘텐츠·JSON)  →  engine (순수 TS, 렌더러 의존 0)  →  ui (Pixi 렌더)
```

의존은 한 방향으로만 흐릅니다.

- **`engine/`은 Pixi를 import하지 않습니다.** 순수 로직이라 렌더러 없이
  유닛 테스트가 가능하고, 렌더러 교체가 자유롭습니다.
- **`data/`는 코드가 아닙니다.** `beats/*.json`만 채우면 코드 수정 없이
  스토리가 추가됩니다.
- **`ui/`는 engine 상태를 그리기만 합니다.**

### 폴더

```
src/
  data/        시나리오·채보·스킨 JSON + 로더
  engine/      상태·게이지·진행·판정·육성      (순수 TS)
  ui/          렌더 기반 · 게임플레이 · 미니게임 · 메타
  tools/       콘텐츠 에디터 7종 (dev 전용)
  subgames/    데모 단서 분석 (미구현)
public/assets/ 배경·캐릭터·UI·음원
tests/         engine·ui 유닛 (12 spec · 150 케이스)
docs/          설계 문서 · 계획 · QA 체크리스트
mockup/        단독 HTML 프로토타입
```

미구현 스텁: `engine/{casting,clues,failure,save}`, `ui/{calendar,deck}`,
`subgames/clueAnalysis` — 확장을 위해 자리를 잡아둔 모듈입니다.

## 스택

TypeScript · PixiJS v8 · Vite · Vitest · Capacitor(안드로이드/iOS)

## 에셋 제작

- **이미지·영상** — GPT로 생성한 뒤 After Effects로 편집
- **배경음악** — Suno로 생성

## 콘텐츠 에디터

dev 서버에서 브라우저로 콘텐츠를 편집해 `src/data/*.json`에 바로 저장합니다.
코드를 고치지 않고 스토리·채보·스킨을 확장하기 위한 도구입니다.

| URL | 편집 대상 |
|---|---|
| `/editor.html` | 에디터 허브 |
| `/flow.html` | 스토리 비트 분기 |
| `/beat.html` | 리듬 채보 |
| `/char.html` `/ui.html` `/bg.html` | 캐릭터·UI·배경 슬롯 |
| `/bgm.html` | 음원 |

허브에서는 최신 APK(치트 포함/제외)와 iOS 프로젝트 zip도 내려받을 수 있습니다.

dev 서버에서 ⚙️ 치트 메뉴와 레이아웃 에디터가 자동 활성화됩니다.
프로덕션 빌드에서는 숨겨지며 `?dev=1`로 켤 수 있습니다.

## 에셋 규약

파일을 아래 경로·이름으로 넣으면 코드 수정 없이 자동 반영됩니다
(없으면 플레이스홀더 표시).

```
public/assets/bg/<name>.png            # 배경
public/assets/char/<id>_bust.png       # 상반신 초상 (카드 상단)
public/assets/char/<id>_stand.png      # 전신 스탠딩 (연습 보드)
public/assets/char/<id>_idle_0001.png  # idle PNG 시퀀스 (4자리 연번)
```

슬롯 목록과 프레임 수는 `src/data/assets.json`에서 관리합니다.

**알파 영상은 두 벌**을 둡니다. Chrome/Android WebView는 VP9 알파(`.webm`),
WebKit(iOS/Safari)은 HEVC 알파(`.mov`)만 재생하므로 `ui/videoLoad.ts`가
런타임에 엔진별로 선택합니다.

## 게임 설계

- **진범**은 안티 직원. 1회차엔 알 수 없고, **단서 4개**를 능동적으로
  포착하면 5막 저지 루트가 열립니다. 못 모으면 데뷔 사고 → 다크 엔딩 → 회귀.
- **게이지**: 실력 · 멘탈 · 평판 · 유대 + **자본**(난이도). 소형사라 고난도.
- **실패 3단**: 강등 → 패자부활전 → 최종 탈락(회귀). 1런 = 24주, W24 데뷔.

시나리오는 `data/beats/*.json`으로 분리되어 있어, 코드 수정 없이 다른 시나리오를
추가할 수 있습니다. 현재 구현된 것은 「소형사 안티 미스터리」 한 편입니다.

자세한 설계는 [`docs/`](docs/)를 참고하세요.
