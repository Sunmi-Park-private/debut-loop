# 로비 사이드 팝업 — Pixi 이관 설계

> 작성일 2026-08-09 · 대상 브랜치 `fix/qa-2nd`

## 문제

데일리·앨범·상점·설정 네 창이 HTML/CSS로 그려진다. 레이아웃 에디터는 `editable()`로
등록된 **Pixi 컴포넌트만** 다루므로, 이 창들의 배경 프레임·버튼·텍스트는 등록할 대상
자체가 없다. 아트 교체는 UI 에디터로 되지만 **위치·크기·간격은 손댈 수 없다.**

레이어를 정리해도 해결되지 않는다. 구조가 다르기 때문이다.

## 목표

- 네 창을 다른 게임 화면과 같은 방식으로 다룬다 — Pixi 컨테이너 + `editable()` 등록
- 배경·버튼·텍스트가 각각 독립 컴포넌트로 잡히고, 드래그·스냅·그리드가 그대로 먹는다
- 기존 아트 슬롯(`side-*`)을 그대로 쓴다 — 디자이너가 올린 것을 버리지 않는다
- 화면에 보이는 내용·동작은 지금과 같다 (목업 데이터 포함)

## 구조

`src/ui/sidePanels.ts` 하나가 네 탭을 모두 그린다. `training.ts`·`memberBoard.ts`와
같은 패턴 — 딤 + 패널 + 조각별 그룹.

```ts
renderSidePanel(parent, { tab, ticker, onClose })
```

호출부는 로비(`boot.ts`). 지금은 `openMetaMenu(tab)`를 부르지만, 열린 탭을 상태로
들고 `build()`를 다시 돌려 Pixi로 그린다. 다른 화면(멤버 보드·연습)이 쓰는 방식과 같다.

## 컴포넌트 이름

공용 셸:

| 이름 | 내용 |
|---|---|
| `side` | 패널 전체 (위치 앵커) |
| `side_bg` | 패널 프레임 (`side-panel`) |
| `side_title_bar` | 제목 띠 (`side-title-bar`) |
| `side_title_text` | 제목 문구 |
| `side_close_x` | 닫기 ✕ (`side-close-x`) |

탭별:

| 탭 | 이름 |
|---|---|
| 데일리 | `side_daily_head` · `side_daily_grid` · `side_daily_cell(_day/_reward/_today)` · `side_daily_note` |
| 앨범 | `side_album_head` · `side_album_grid` · `side_album_cell(_icon/_text)` |
| 상점 | `side_shop_head` · `side_shop_coin` · `side_shop_purse` · `side_shop_row(_icon/_name/_desc)` · `side_shop_buy(_text)` |
| 설정 | `side_set_sns(_text/_btn)` · `side_set_slider(_label/_track/_knob/_mute)` · `side_set_reset` |

되풀이되는 칸(데일리 7·앨범 12·상점 4)은 **카드덱과 같은 규칙**을 쓴다 — 좌표는
한 벌만 저장하고, 등록은 칸마다 해서 어느 칸을 눌러도 그 조각이 잡힌다
(`editable` + `editableClone`).

## 닫기

`overlay.style.display = "none"` 대신 다른 창과 동일하게 — ✕ 또는 딤 탭이
`onClose()`를 부르고, 호출부가 상태를 내리고 다시 그린다. 편집 모드에서는
딤 탭이 닫지 않는다(실드가 입력을 가져가므로 자연히 그렇게 된다).

## 설정 탭의 슬라이더

DOM `<input type=range>`를 Pixi 위젯으로 대체한다 — 트랙 + 손잡이, 드래그로 값 변경.
볼륨은 지금처럼 `audio.ts`에 실제로 반영하고 저장한다. 음소거 토글은 버튼 하나.

이 탭이 유일하게 새 위젯을 필요로 하므로 마지막에 옮긴다.

## 이관 순서

탭 단위로 넘긴다. 넘기지 않은 탭은 기존 DOM이 계속 뜬다 — 중간 상태에서도 게임이
멀쩡하다.

1. 공용 셸 + 데일리
2. 앨범
3. 상점
4. 설정 (슬라이더 위젯 포함)

## 경계

- 목업 데이터(출석 4일차·앨범 3/12·상점 4종)는 그대로 옮긴다. 실제 저장은 범위 밖
- `side-*` 슬롯은 이름·용도를 바꾸지 않는다
- 토스트는 기존 `toast()`를 계속 쓴다 (DOM, 화면 최상단)
