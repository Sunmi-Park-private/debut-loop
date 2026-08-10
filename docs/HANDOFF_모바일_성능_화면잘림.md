# 인수인계 — 안드로이드 실기 이슈 (2026-08-10, fix/qa-3rd)

갤럭시 S24 울트라(SM-S928N) 디버그 APK 실측 기준. 두 가지가 미해결이다.

## 1. 화면 좌우 잘림 — 원인 미확정

- 증상: 좌우 끝이 얇게 잘린다.
- **시도했다가 되돌린 것**: `#app`에 안전영역 패딩(`env(safe-area-inset-*)`, 좌우 최소 4px →
  12px)을 주고 그 안쪽 크기로 배율 계산. **효과 없었다** — 좌우 잘린 폭은 그대로면서
  화면만 작아지고 상하까지 잘렸다. 지금은 완전히 원복(여백 0px)했다.
- **이 결과가 알려주는 것**: 잘림의 원인은 "캔버스가 화면보다 커서 넘치는 것"이 아니다.
  여백을 주면 캔버스가 작아지므로 잘림이 줄어야 하는데 그러지 않았다.
- **남은 가설**: ① 배경이 `coverBg`(cover 크롭)라 화면 비율에 따라 좌우가 잘리는 원래 동작
  (위아래 검은 띠를 없애려는 설계) ② 시스템 디스플레이 컷아웃 모드가 창 자체를 잘라 표시.
- **다음 단계**: 잘린 화면 캡처 1장이면 UI가 잘리는지 배경만 잘리는지 판별된다.
  ①이면 사양이므로 배경 크롭 정책을 바꿀지 결정하는 문제이고, ②면 Android 매니페스트의
  `layoutInDisplayCutoutMode`를 조정한다.

## 2. 메모리·버벅임 — 실측 완료, 축소 방식 재시도 필요

### 실측 (스크립트: 이미지 355개를 브라우저로 디코딩해 원본 크기 대 표시 크기 비교)

- GPU 환산 총 **997MB** (ui 434 · char 426 · bg 112 · speaker 25)
- 표시 상한(그려지는 크기 × 2)만 지켜도 **485MB 절감 가능**
- 낭비 1위: 관문 아이콘류가 1254×1254 원본인데 화면에선 80~96px — **15배 과함**.
  `gate-dodge-sym-*`(5) · `gate-note-*`(3) · `gate-match-sym-*`(6) · `gate-polaroid` = 약 90MB

### 실기 계측 (45초 시점)

| | 최초 | 동시 상한 6 | + UI 축소(되돌림) |
|---|---|---|---|
| GL mtrack | 247MB | 338MB | 130MB |
| TOTAL PSS | 425MB | 492MB | 450MB |
| lowmemorykiller | 16회 | 5회 | 1회 |

크래시·에셋 로드 실패·GL 에러는 없다. 순수하게 양 문제이며, 앱이 기기 메모리를 크게
점유해 시스템이 다른 앱을 계속 종료시키는 상태다.

### 되돌린 이유와 다음 시도

- 축소본을 `createImageBitmap` → `Texture.from(bitmap)`으로 만들었더니 **9슬라이스로 그리는
  슬롯이 화면에서 사라졌다** (로비 상단 상태 패널·D-day 카드). `Assets.unload` 제거만으로는
  해결되지 않았다 — 원인은 언로드가 아니라 축소 텍스처 생성 방식이다.
- **다음 시도**: `assets.ts`의 `shrinkSeq`와 같은 경로(**Pixi 렌더러로 RenderTexture에 그려
  축소**)를 쓴다. 이미 캐릭터 시퀀스에서 문제없이 동작 중인 검증된 방식이다.
  - `loadUiSkins(onTick, renderer)`로 렌더러를 넘긴다
  - 대상은 `mode: "stretch"` + 단순 스프라이트 슬롯만. **9slice는 제외**
  - 상한은 슬롯 `size` × 2, 3배 이상 과한 것만
  - `skinNatural`·`skinTrimFill`은 축소 배율(`shrink`)로 보정해야 한다
    (되돌린 커밋에 구현이 남아 있으니 `git log -p src/ui/uiSkin.ts`로 참고)
  - 적용 후 로비·관문·연습 화면 캡처 비교 + 폰 메모리 재측정

## 3. 로딩 순서 (요청 사항)

- `uiSkin.ts`의 `DEFER_SLOT = /^(gate-|train-|audition-|member-|board-|grade-)/` 이 이미
  관문·연습·오디션 아트를 로딩 게이트에서 빼 백그라운드로 받는다.
- 동시 로딩 상한(6)이 들어와서 이제 **요청 순서가 실제로 의미를 갖는다**.
- 더 세밀하게 가려면 `uiskins.json` 슬롯에 `tier`를 넣고 그 순서로 요청한다.
- 주의: 순서 조정은 "언제" 로딩되는지를 바꿀 뿐 **총 메모리는 줄지 않는다**. 메모리는
  지연 로딩(도달하지 않은 화면은 아예 안 올림) 또는 텍스처 축소가 필요하다.

## 4. 빌드 환경 (이번에 정리됨)

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
# SDK는 이미 설치돼 있다 (android-36 · build-tools 36.0.0)
echo "sdk.dir=/opt/homebrew/share/android-commandlinetools" > android/local.properties
npm run apk:debug
```

- 저장소의 `android/local.properties`는 다른 기기 경로를 가리키고 있었다(git 미포함 파일).
- adb: `/opt/homebrew/share/android-commandlinetools/platform-tools/adb`
- 패키지: `com.debutloop.game`
