// ui/sidePanels.ts — 로비 사이드 팝업(데일리·앨범·상점·설정)의 Pixi 판.
// 예전엔 HTML/CSS로 그려서 레이아웃 에디터가 손댈 수 없었다(등록할 Pixi 대상이 없음).
// 다른 게임 화면과 같은 패턴 — 딤 + 패널 + 조각별 그룹 + editable() 등록.
// 아트는 기존 side-* 슬롯을 그대로 쓴다.
import { Color, Container, Graphics, Text, type ColorSource, type Ticker } from "pixi.js";
import { pos } from "./layout";
import { editable, editableClone } from "./editor";
import { fullRect } from "./stage";
import { skinFit, skinNode } from "./uiSkin";
import { pressable } from "./press";
import { easeIn, easeOut, easeInOut, lerp } from "./ease";
import { toast } from "./metaMenu";
import { bgmVolume, setBgmVolume, bgmMuted, setBgmMuted } from "./audio";

export type SideTab = "daily" | "album" | "shop" | "settings";

/** Pixi로 옮긴 탭 — 여기 없는 탭은 호출부가 기존 DOM 팝업을 띄운다 */
export const PIXI_TABS = new Set<SideTab>(["daily", "album", "shop", "settings"]);

const W = 360;  // 패널 폭 — DOM 판(360px)과 같게 잡아 아트가 그대로 맞는다
const INK = 0x5b4a70;
const SUB = 0xa99bc0;
const PINK = 0xff7fb0;
const LINE = 0xece4f4;

const TITLE: Record<SideTab, string> = {
  daily: "🎁 데일리 보상", album: "📔 포토앨범", shop: "🛍 상점", settings: "⚙️ 설정",
};

/** 목업 상태 — 실제 저장은 범위 밖 (DOM 판과 같은 값) */
// justClaimed = 방금 수령한 날짜 — 다시 그린 뒤 그날 추가 보너스 상자를 한 번 돌리는 데만 쓴다
const mock = { dailyClaimed: false, dailyDay: 1, justClaimed: 0 };

/** 목업 출석 날짜 넘기기 — 치트에서 부른다 (게이지 점이 하나씩 차는 걸 확인용) */
export function advanceMockDailyDay(): number {
  mock.dailyDay = mock.dailyDay >= 7 ? 1 : mock.dailyDay + 1;
  mock.dailyClaimed = false;
  return mock.dailyDay;
}
const mockSns: Record<"google" | "apple", boolean> = { google: false, apple: false };
let mockSfx = 70;        // 효과음은 아직 실제 배선이 없다 (목업)
let mockSfxMuted = false;

// ── 수령 모션 ── 카드덱과 같은 손맛을 쓴다 (곡선·시간 모두 cardDeckSheet와 같은 값).
// 받을 수 있는 날 = 좌우로 한 바퀴 도는 뒤집기, 아직 못 받는 날 = 살짝 떠올랐다 제자리.
const FLIP_HALF = 130; // 반바퀴(ms) — 폭이 0이 되는 지점
const LIFT_DY = 14;
const LIFT_DUR = 150;

const tween = (dur: number, node: Container, step: (t: number) => void, done?: () => void): void => {
  const t0 = performance.now();
  const frame = (now: number): void => {
    if (node.destroyed) return; // 창이 닫혀 컨테이너가 사라졌으면 중단
    const t = Math.min(1, (now - t0) / dur);
    step(t);
    if (t < 1) requestAnimationFrame(frame);
    else done?.();
  };
  requestAnimationFrame(frame);
};

/** 좌우로 한 바퀴 — 폭을 0까지 좁혔다가 다시 편다 (음수 배율이 없어 그림이 뒤집히지 않는다) */
const spinNode = (node: Container, done?: () => void): void => {
  tween(FLIP_HALF, node, (t) => { node.scale.x = 1 - easeIn(t); }, () => {
    tween(FLIP_HALF, node, (t) => { node.scale.x = easeOut(t); }, () => {
      node.scale.x = 1;
      done?.();
    });
  });
};

/** 살짝 떠올랐다 제자리 — 스토리 카드덱의 반응과 같다 */
const liftNode = (node: Container): void => {
  const home = node.y;
  tween(LIFT_DUR, node, (t) => { node.y = lerp(home, home - LIFT_DY, easeInOut(t)); }, () => {
    tween(LIFT_DUR, node, (t) => { node.y = lerp(home - LIFT_DY, home, easeInOut(t)); }, () => { node.y = home; });
  });
};

const txt = (s: string, size: number, fill: number, bold = false): Text =>
  new Text({ text: s, style: { fontSize: size, fill, fontWeight: bold ? "bold" : "normal" } });

export interface SidePanelOpts {
  tab: SideTab;
  ticker: Ticker;
  onClose: () => void;
  /** 내용이 바뀌어 다시 그려야 할 때 (출석 수령 등) */
  onRedraw: () => void;
}

export function renderSidePanel(parent: Container, opts: SidePanelOpts): void {
  const dim = fullRect(0x5b4a70, 0.4);
  dim.eventMode = "static"; // 뒤 화면(로비) 클릭 차단 — 닫기는 X 버튼으로만.
  // 예전엔 딤 탭도 닫기였는데, 창 안을 조작하다 살짝 빗나가면 창이 닫혀버렸다.
  parent.addChild(dim);

  const panel = new Container();
  const p = pos("side", { x: Math.round((430 - W) / 2), y: 210 });
  panel.x = p.x;
  panel.y = p.y;
  parent.addChild(panel);
  editable("side", panel);

  /** 조각 그룹 — 저장 좌표(기본값=코드가 잡은 자리) + 에디터 등록 */
  const grp = (name: string, x: number, y: number, ...items: Container[]): Container => {
    const g = new Container();
    const q = pos(name, { x, y });
    g.x = q.x;
    g.y = q.y;
    if (items.length > 0) g.addChild(...items);
    panel.addChild(g);
    editable(name, g);
    return g;
  };

  // 되풀이되는 칸은 카드덱과 같은 규칙 — 좌표는 한 벌, 등록은 칸마다
  const registered = new Set<string>();
  const reg = (name: string, c: Container): void => {
    if (registered.has(name)) editableClone(name, c);
    else { registered.add(name); editable(name, c); }
  };

  // 탭마다 내용 높이가 다르다 — 앨범 4줄(132+9)·상점 4줄(56+9)이 들어가야 한다
  // 데일리는 배경판 아트(955×1647) 비율에 맞춘 높이 — 폭 360 기준 621.
  // 박스가 아트보다 낮으면 skinFit이 높이에 맞춰 축소해 패널이 반쪽만 차던 문제.
  const BODY_H: Record<SideTab, number> = { daily: 621, album: 664, shop: 362, settings: 330 };
  const bodyH = BODY_H[opts.tab];

  // ── 공용 셸 ──
  // 배경판은 탭 전용 아트가 있으면 그걸 쓰고(원본 비율 유지), 없으면 공용 프레임(9슬라이스라
  // 늘어나는 게 맞다) → 벡터 순으로 내려간다. 탭마다 내용 높이가 달라 한 장으로는 안 맞는다.
  const BG_SLOT: Record<SideTab, string> = {
    daily: "side-daily-bg", album: "side-album-bg", shop: "side-shop-bg", settings: "side-settings-bg",
  };
  const tabBgArt = skinFit(BG_SLOT[opts.tab], W, bodyH); // 탭 전용 아트 (없으면 null → 공용 프레임)
  const onArt = tabBgArt !== null; // 탭 전용 배경판 위에 그리는 중 — 조각 배치가 아트 칸을 따른다
  const bg = tabBgArt
    ?? skinNode("side-panel", W, bodyH)
    ?? new Graphics().roundRect(0, 0, W, bodyH, 20).fill(0xffffff).stroke({ width: 2, color: LINE });
  // 배경판만 탭별 키 — 아트 비율이 탭마다 달라 한 좌표로는 못 맞춘다.
  // 저장값이 없으면 지금까지 쓰던 공용 키(side_bg) 값을 물려받아, 분리 직후 배치는 그대로다.
  const BG_KEY: Record<SideTab, string> = {
    daily: "side_daily_bg", album: "side_album_bg", shop: "side_shop_bg", settings: "side_set_bg",
  };
  const bgKey = BG_KEY[opts.tab];
  const bgP = pos(bgKey, pos("side_bg", { x: 0, y: 0 }));
  grp(bgKey, bgP.x, bgP.y, bg);

  const bar = skinFit("side-title-bar", W - 24, 34);
  if (bar) grp("side_title_bar", 12, 12, bar);

  const title = txt(TITLE[opts.tab], 15, INK, true);
  grp("side_title_text", 18, 18, title);

  const xBtn = new Container();
  const xArt = skinFit("side-close-x", 28, 28);
  if (xArt) xBtn.addChild(xArt);
  else {
    xBtn.addChild(new Graphics().circle(14, 14, 13).fill(0xf3ecfa).stroke({ width: 1.5, color: LINE }));
    const xt = txt("✕", 13, 0x8a76a8, true);
    xt.x = 14 - xt.width / 2;
    xt.y = 14 - xt.height / 2;
    xBtn.addChild(xt);
  }
  pressable(xBtn, opts.onClose);
  grp("side_close_x", W - 42, 14, xBtn);

  if (opts.tab === "daily") renderDaily();
  else if (opts.tab === "album") renderAlbum();
  else if (opts.tab === "shop") renderShop();
  else renderSettings();

  // ── 🎁 데일리 보상 ──
  function renderDaily(): void {
    const head = txt("출석 보상 · 매일 접속하고 보상을 받아요", 11, SUB);
    // 아트가 있으면 제목("DAILY BONUS") 아래 빈 영역으로 — 기본 위치는 아트 제목과 겹친다
    grp("side_daily_head", onArt ? Math.round((W - head.width) / 2) : 18, onArt ? 94 : 48, head);

    // 배경판 아트(955×1647)에 DAY 1~7 칸이 그려져 있다 — 그 칸 실측을 표시 좌표로 환산해 얹는다
    // (폭 360 기준 배율 0.377). 1~3 · 4~6 한 줄씩, 7일차는 가로 전체.
    // 아트가 없으면 예전 4열 그리드 그대로 — 업로드 전후로 화면이 무너지지 않게.
    // 아트 픽셀 스캔 실측(테두리 검출): 세로선 x=109·338 / 355·589 / 606·838,
    // 가로선 y=766·987(1줄) · 1013·1222(2줄) · 1244·1421(7일차). ×0.377로 표시 좌표 환산.
    const ART_BOX = [
      { x: 41, y: 289, w: 86, h: 83 }, { x: 134, y: 289, w: 88, h: 83 }, { x: 228, y: 289, w: 87, h: 83 },
      { x: 41, y: 390, w: 86, h: 79 }, { x: 134, y: 390, w: 88, h: 79 }, { x: 228, y: 390, w: 87, h: 79 },
      { x: 41, y: 489, w: 275, h: 67 },
    ];
    // 칸 안쪽 보상 박스 — 위쪽 30%는 "DAY N" 라벨 자리라 비운다 (라벨 아래 끝 기준)
    const IN_TOP = 0.30, IN_H = 0.62;
    const CW = onArt ? 86 : 78, CH = onArt ? 81 : 74, GAP = 8, COLS = 4;
    const gx = onArt ? 0 : Math.round((W - COLS * CW - (COLS - 1) * GAP) / 2);
    const gridG = grp("side_daily_grid", gx, onArt ? 0 : 84);
    // 보상 문구는 상자와 따로 움직여야 한다 — 칸 안에 넣으면 칸을 옮길 때 끌려가고,
    // 문구만 다듬을 수가 없다. 일곱 칸의 문구를 한 묶음(side_daily_texts)으로 뺀다.
    const textsG = grp("side_daily_texts", gx, onArt ? 0 : 84);

    // 문구 칩 — 배경판 위 11px 글씨가 잘 안 읽혀서, 흰 바탕 + 테두리를 뒤에 깐다.
    // 테두리 색은 글자 색을 그대로 따라간다 = 에디터 팔레트에서 고른 색이 곧 테두리 색.
    // 글자 크기·색은 에디터가 **다음 프레임**에 입히므로(pumpStyles), 칩은 매 프레임
    // 글자 상자가 바뀐 것만 다시 그린다. 바뀐 게 없으면 아무 일도 하지 않는다.
    const CHIP_PADX = 6, CHIP_PADY = 2, CHIP_R = 9, CHIP_LINE = 1.5;
    // 칩 바탕 = 배경판 크림색(side-daily-bg.webp 실측 — 칸 안·칸 사이·여백 모두 #fef3e8 근처).
    // 흰색을 깔면 칩만 도드라져 따로 논다.
    const CHIP_BG = 0xfef3e8;
    const chips: Array<{ g: Graphics; t: Text; x: number; y: number; w: number; h: number; col: number }> = [];
    const chipFor = (t: Text): void => {
      const g = new Graphics();
      textsG.addChildAt(g, 0); // 칩은 전부 글자 아래로
      chips.push({ g, t, x: NaN, y: NaN, w: NaN, h: NaN, col: NaN });
    };
    const fitChips = (): void => {
      // 창을 닫으면 로비가 removeChildren()으로 떼어낸다(파괴는 안 한다) — 둘 다 확인해 리스너를 뗀다
      if (textsG.destroyed || panel.destroyed || !panel.parent) { opts.ticker.remove(fitChips); return; }
      for (const c of chips) {
        const col = new Color(c.t.style.fill as ColorSource).toNumber();
        const w = c.t.width, h = c.t.height;
        if (c.x === c.t.x && c.y === c.t.y && c.w === w && c.h === h && c.col === col) continue;
        c.x = c.t.x; c.y = c.t.y; c.w = w; c.h = h; c.col = col;
        // 글자는 anchor.x가 0.5(가운데 정렬)일 수 있다 — 그 경우 x는 중심이다
        const left = c.t.x - w * c.t.anchor.x;
        c.g.clear()
          .roundRect(left - CHIP_PADX, c.t.y - CHIP_PADY, w + CHIP_PADX * 2, h + CHIP_PADY * 2, CHIP_R)
          .fill(CHIP_BG)
          .stroke({ width: CHIP_LINE, color: col });
      }
    };

    // 상단 점선 게이지바 — 점은 아트가 그리고, 출석할 때마다 한 칸씩 보라색으로 찬다.
    // 그 위 1·4·7일차 점에만 선물상자를 얹는다 = 그날 받는 추가 보너스 표식.
    const TRACK_Y = 251, TRACK_X0 = 51, TRACK_STEP = 43; // 렌더 화면에서 점 중심 역산
    const TRACK_BOX = 50;   // 상자 크기 (긴 변 기준)
    const BONUS_DAYS = [1, 4, 7];
    const TRACK_GAP = 6; // 점 위로 띄우는 간격
    const DOT_R = 5;     // 채움 원 반지름 (아트 점 안쪽에 들어가는 크기)
    const DOT_FILL = 0xa87fd8;

    const rewards = ["⭐5", "⭐10", "카드×1", "⭐15", "카드×2", "⭐20", "카드★★★"];
    rewards.forEach((r, i) => {
      const day = i + 1;
      // 1일차부터 시작 — 오늘(mock.dailyDay)까지가 받은 날, 그 다음 날부터 잠김.
      // 날짜가 하루 늘 때마다 done이 하나씩 늘고, 게이지 점도 그만큼 찬다.
      const done = day < mock.dailyDay || (day === mock.dailyDay && mock.dailyClaimed);
      const today = day === mock.dailyDay && !mock.dailyClaimed;
      const box = ART_BOX[i] ?? { x: 0, y: 0, w: CW, h: CH };
      const cw = onArt ? box.w : CW, ch = onArt ? box.h : CH;
      const cell = new Container();
      // 칸마다 전용 키 — 상태별 키 하나로 묶으면 같은 상태의 칸들이 함께 움직여 하나씩 못 맞춘다
      const cellKey = `side_daily_d${day}`;
      const cp = pos(cellKey, onArt
        ? { x: box.x, y: box.y }
        : { x: (i % COLS) * (CW + GAP), y: Math.floor(i / COLS) * (CH + GAP) });
      cell.x = cp.x;
      cell.y = cp.y;

      // 상자 그림은 상태별 슬롯(done·today·lock)에서 가져오지만, **위치는 칸마다 따로**다.
      // 예전엔 그림 노드를 상태 이름으로 등록해, 그림 하나를 세 칸이 쓰는 탓에
      // 한 칸을 옮기면 같은 상태의 세 칸이 함께 움직였다. 이제 칸(side_daily_dN)이
      // 유일한 등록 단위 — 일곱 칸을 하나씩 옮긴다. 파일 교체는 칸을 선택하면
      // 매핑 패널에 그 칸이 쓴 슬롯이 그대로 떠서 거기서 한다.
      const state = done ? "done" : today ? "today" : "lock";
      // 아트 위에선 칸 안쪽 빈 영역(DAY 라벨 아래)에만 상자를 넣는다 — 라벨은 배경판이 이미 갖고 있다
      const inX = onArt ? 6 : 0;
      const inY = onArt ? Math.round(ch * IN_TOP) : 0;
      const inW = cw - inX * 2;
      const inH = onArt ? Math.round(ch * IN_H) : ch;
      const art = skinFit(`side-daily-cell-${state}`, inW, inH)
        ?? new Graphics().roundRect(0, 0, inW, inH, 12)
          .fill(done ? 0xf2fbf8 : today ? 0xfff2f9 : 0xf8f4fc)
          .stroke({ width: today ? 2.5 : 2, color: done ? 0x6fd8c4 : today ? PINK : LINE });
      // 상자는 회전축(가운데)을 가진 래퍼에 담는다 — 수령 효과로 좌우로 돌릴 때 대칭이 되게.
      // 칸(cell)의 x·y는 레이아웃 저장값이라 건드리면 안 되므로 안쪽에 한 겹 더 둔다.
      const spinner = new Container();
      spinner.x = inX + inW / 2;
      spinner.y = inY + inH / 2;
      art.x = -inW / 2;
      art.y = -inH / 2;
      spinner.addChild(art);
      cell.addChild(spinner);

      // D1·D2… 라벨은 배경판 아트에 이미 "DAY 1"로 그려져 있다 — 아트가 있으면 코드 라벨은 생략
      if (!onArt) {
        const dayT = txt(`D${day}`, 11, done ? 0x2e9a80 : today ? 0xc9527f : SUB, true);
        dayT.x = Math.round((cw - dayT.width) / 2);
        dayT.y = 0;
        cell.addChild(dayT);
      }

      const rw = txt(done ? "✓" : r, onArt ? 11 : 15, done ? 0x2e9a80 : today ? 0xc9527f : SUB, true);
      rw.style.fontWeight = "900"; // 배경판 위 작은 글씨라 bold(700)로는 얇게 보인다
      rw.x = cp.x + Math.round((cw - rw.width) / 2); // 묶음 기준 = 칸 좌표 + 칸 안 위치
      rw.y = cp.y + (onArt ? inY + inH - 25 : 20);
      textsG.addChild(rw);
      if (onArt) chipFor(rw);

      if (today) {
        const now = txt("오늘!", 9, 0xc9527f, true);
        now.style.fontWeight = "900";
        now.x = cp.x + Math.round((cw - now.width) / 2);
        now.y = cp.y + (onArt ? -4 : 44);
        textsG.addChild(now);
        if (onArt) chipFor(now);
        // 받는 순간 상자가 좌우로 한 바퀴 돈다 — 다 돌고 나서 화면을 다시 그린다
        // (먼저 그리면 칸이 새로 만들어져 도는 게 안 보인다)
        let claiming = false;
        pressable(cell, () => {
          if (claiming) return;
          claiming = true;
          spinNode(spinner, () => {
            mock.dailyClaimed = true;
            mock.justClaimed = day; // 다시 그린 직후 추가 보너스 상자도 돌게 (1·4·7일차)
            toast(`${r} 획득! 내일 또 만나요 🎁`);
            opts.onRedraw();
          });
        });
      } else {
        // 아직 못 받는 날(잠김)·이미 받은 날 — 스토리 카드덱처럼 살짝 떠올랐다 내려온다
        pressable(cell, () => {
          liftNode(spinner);
          if (!done) toast(`${day}일차는 아직이에요 — 내일 또 만나요 🔒`);
        });
      }
      gridG.addChild(cell);
      reg(cellKey, cell); // 칸 하나씩 옮길 수 있게 (아트 칸 미세 정렬용)

      // 진행도 — 받은 날의 점을 보라색으로 채운다. 아트의 빈 점 위에 원을 덮는 방식이라
      // 하루가 늘 때마다 왼쪽부터 한 칸씩 찬다. 점마다 전용 키(side_daily_p1~p7)로 따로 조절.
      if (onArt && done) {
        const pk = `side_daily_p${day}`;
        const dp = pos(pk, { x: TRACK_X0 + TRACK_STEP * i, y: TRACK_Y });
        const dotG = new Container();
        dotG.x = dp.x;
        dotG.y = dp.y;
        dotG.addChild(new Graphics().circle(0, 0, DOT_R).fill(DOT_FILL));
        panel.addChild(dotG);
        reg(pk, dotG);
      }

      // 추가 보너스 표식 — 1·4·7일차 점 위에만 상자를 얹는다. 진행도(보라 채움)는
      // 위 점이 담당하므로 상자는 받았는지와 무관하게 늘 보인다.
      // 칸과 같은 슬롯을 쓰므로 상자 그림을 바꾸면 위아래가 함께 바뀐다.
      // 상자 셋은 각각 side_daily_t1·t4·t7로 따로 등록 — 하나씩 옮길 수 있다.
      if (onArt && BONUS_DAYS.includes(day)) {
        const mini = skinFit("side-daily-cell-done", TRACK_BOX, TRACK_BOX);
        if (mini) {
          const mk = `side_daily_t${day}`;
          // 그림 비율이 유지되므로 실제 크기로 점 중심에 맞춘다
          const mw = mini.width, mh = mini.height;
          const mp = pos(mk, { x: TRACK_X0 + TRACK_STEP * i - Math.round(mw / 2), y: Math.round(TRACK_Y - mh - TRACK_GAP) });
          const holder = new Container();
          holder.x = mp.x;
          holder.y = mp.y;
          // 칸 상자와 같은 방식 — 회전축(가운데)을 가진 래퍼에 담아 저장 좌표는 그대로 둔다
          const mspin = new Container();
          mspin.x = mw / 2;
          mspin.y = mh / 2;
          mini.x = -mw / 2;
          mini.y = -mh / 2;
          mspin.addChild(mini);
          holder.addChild(mspin);
          panel.addChild(holder);
          reg(mk, holder);

          // 칸과 같은 두 가지 반응 — 받은 날의 보너스는 좌우 회전, 아직이면 살짝 떠오르기
          pressable(holder, () => {
            if (done) spinNode(mspin);
            else { liftNode(mspin); toast(`${day}일차 추가 보너스 — 그날 출석하면 함께 받아요 🎁`); }
          });
          // 그날 출석을 막 받았으면 추가 보너스 상자도 이어서 한 바퀴 돈다
          if (mock.justClaimed === day) spinNode(mspin);
        }
      }
    });

    fitChips();                 // 첫 프레임 (에디터 스타일 적용 전 코드 값 기준)
    opts.ticker.add(fitChips);  // 이후 글자 크기·색이 바뀌면 칩도 따라간다

    mock.justClaimed = 0; // 한 번만 돈다 — 창을 다시 열 때마다 돌면 산만하다

    const note = txt("7일 연속 출석하면 ★★★ 에픽 카드!", 11, SUB);
    grp("side_daily_note", Math.round((W - note.width) / 2), onArt ? 540 : 258, note);
  }

  // ── 📔 포토앨범 ──
  function renderAlbum(): void {
    const head = txt("포토앨범 · 3/12 수집 — 회귀를 반복하며 모아보세요", 11, SUB);
    grp("side_album_head", 18, 58, head);

    const CW = 104, CH = 132, GAP = 9, COLS = 3;
    const gx = Math.round((W - COLS * CW - (COLS - 1) * GAP) / 2);
    const gridG = grp("side_album_grid", gx, 84);

    const items: Array<[string, string, boolean]> = [
      ["🌑", "0시의 사고", true], ["🖐", "다섯 손가락", true], ["🎤", "지하 첫 무대", true],
      ["💿", "첫 미니앨범", false], ["💜", "보라, 각성", false], ["🔍", "진실의 조각", false],
      ["🎊", "데뷔 성공", false], ["🌙", "또 다른 0시", false], ["📸", "비하인드 컷", false],
      ["🏆", "퍼펙트 무대", false], ["💌", "루나의 편지", false], ["❓", "???", false],
    ];
    items.forEach(([ic, cap, open], i) => {
      const cell = new Container();
      cell.x = (i % COLS) * (CW + GAP);
      cell.y = Math.floor(i / COLS) * (CH + GAP);

      const state = open ? "got" : "lock";
      const art = skinFit(`side-album-cell-${state}`, CW, CH)
        ?? new Graphics().roundRect(0, 0, CW, CH, 12)
          .fill(open ? 0xfdf3f8 : 0xf3eef9).stroke({ width: 2, color: open ? PINK : LINE });
      const bgName = `side_album_cell_${state}`;
      const pArt = pos(bgName, { x: 0, y: 0 });
      art.x = pArt.x;
      art.y = pArt.y;
      cell.addChild(art);
      reg(bgName, art);

      const icT = txt(open ? ic : "🔒", open ? 26 : 22, INK);
      const pIc = pos(`side_album_cell_icon_${state}`, { x: Math.round((CW - icT.width) / 2), y: 34 });
      icT.x = pIc.x;
      icT.y = pIc.y;
      cell.addChild(icT);
      reg(`side_album_cell_icon_${state}`, icT);

      const capT = txt(open ? cap : "???", 10, open ? INK : SUB, true);
      const pCap = pos(`side_album_cell_text_${state}`, { x: Math.round((CW - capT.width) / 2), y: 84 });
      capT.x = pCap.x;
      capT.y = pCap.y;
      cell.addChild(capT);
      reg(`side_album_cell_text_${state}`, capT);

      pressable(cell, () => toast(open ? `"${cap}" — 데모에서 해금된 장면이에요 📔` : "아직 만나지 못한 장면이에요 🔒"));
      gridG.addChild(cell);
    });
  }

  // ── 🛍 상점 ──
  function renderShop(): void {
    const coinArt = skinFit("side-shop-coin", 18, 18);
    const purse = new Container();
    if (coinArt) purse.addChild(coinArt);
    else {
      const e = txt("⭐", 14, 0xc9527f);
      purse.addChild(e);
    }
    const amount = txt("32", 13, 0xc9527f, true);
    amount.x = 22;
    amount.y = 2;
    purse.addChild(amount);
    grp("side_shop_coin", W - 70, 58, purse);

    const items: Array<[string, string, string, string]> = [
      ["", "카드팩", "랜덤 카드 3장", "⭐ 15"],
      ["🎟", "패자부활권", "탈락 위기에서 한 번 부활", "⭐ 20"],
      ["✨", "스타터 부스트", "다음 런 시작 게이지 +5", "⭐ 10"],
      ["💎", "스페셜 팩", "에픽 확정 + 포토 1장", "₩3,300"],
    ];
    const RW = W - 36, RH = 56, RGAP = 9;
    const rowsG = grp("side_shop_rows", 18, 84);
    items.forEach(([ic, name, desc, price], i) => {
      const row = new Container();
      row.y = i * (RH + RGAP);

      const art = skinFit("side-shop-row", RW, RH)
        ?? new Graphics().roundRect(0, 0, RW, RH, 14).fill(0xffffff).stroke({ width: 2, color: LINE });
      const pArt = pos("side_shop_row_bg", { x: 0, y: 0 });
      art.x = pArt.x;
      art.y = pArt.y;
      row.addChild(art);
      reg("side_shop_row_bg", art);

      const icT = txt(ic, 22, INK);
      const pIc = pos("side_shop_row_icon", { x: 12, y: 16 });
      icT.x = pIc.x;
      icT.y = pIc.y;
      row.addChild(icT);
      reg("side_shop_row_icon", icT);

      const nameT = txt(name, 13, INK, true);
      const pName = pos("side_shop_row_name", { x: 46, y: 11 });
      nameT.x = pName.x;
      nameT.y = pName.y;
      row.addChild(nameT);
      reg("side_shop_row_name", nameT);

      const descT = txt(desc, 10, SUB);
      const pDesc = pos("side_shop_row_desc", { x: 46, y: 31 });
      descT.x = pDesc.x;
      descT.y = pDesc.y;
      row.addChild(descT);
      reg("side_shop_row_desc", descT);

      const buy = new Container();
      const buyArt = skinFit("side-shop-btn-buy", 74, 32)
        ?? new Graphics().roundRect(0, 0, 74, 32, 10).fill(PINK);
      buy.addChild(buyArt);
      const priceT = txt(price, 11.5, 0xffffff, true);
      const pPrice = pos("side_shop_buy_text", { x: Math.round((74 - priceT.width) / 2), y: 9 });
      priceT.x = pPrice.x;
      priceT.y = pPrice.y;
      buy.addChild(priceT);
      reg("side_shop_buy_text", priceT);
      const pBuy = pos("side_shop_buy", { x: RW - 86, y: 12 });
      buy.x = pBuy.x;
      buy.y = pBuy.y;
      pressable(buy, () => toast("데모 버전에서는 준비 중이에요 🛍"));
      row.addChild(buy);
      reg("side_shop_buy", buy);

      rowsG.addChild(row);
    });
  }

  // ── ⚙️ 설정 ──
  function renderSettings(): void {
    let y = 58;
    const snsRow = (id: "google" | "apple", label: string): void => {
      const row = new Container();
      const nameT = txt(label, 12.5, INK, true);
      nameT.y = 8;
      row.addChild(nameT);
      const on = mockSns[id];
      const btn = new Container();
      const art = new Graphics().roundRect(0, 0, 84, 30, 10)
        .fill(on ? 0xf2fbf8 : 0xffffff).stroke({ width: 1.5, color: on ? 0x6fd8c4 : LINE });
      btn.addChild(art);
      const bt = txt(on ? "연동됨 ✓" : "연동하기", 11.5, on ? 0x2e9a80 : INK, true);
      bt.x = Math.round((84 - bt.width) / 2);
      bt.y = 8;
      btn.addChild(bt);
      btn.x = W - 36 - 84;
      pressable(btn, () => {
        mockSns[id] = !mockSns[id];
        if (mockSns[id]) toast(`${label} 계정과 연동되었어요 ✓`);
        opts.onRedraw();
      });
      row.addChild(btn);
      grp(`side_set_sns_${id}`, 18, y, row);
      y += 42;
    };
    snsRow("google", "Google 계정");
    snsRow("apple", "Apple 계정");

    slider("배경음악", "bgm");
    slider("효과음", "sfx");

    /** 볼륨 슬라이더 — DOM <input type=range>를 Pixi로. 트랙을 끌거나 눌러 값 지정 */
    function slider(label: string, key: "bgm" | "sfx"): void {
      const TW = W - 36 - 44; // 음소거 버튼(34) + 간격
      const row = new Container();
      const lblT = txt(label, 12.5, INK, true);
      row.addChild(lblT);

      const muted = key === "bgm" ? bgmMuted() : mockSfxMuted;
      const value = key === "bgm" ? bgmVolume() : mockSfx;
      const valT = txt(String(Math.round(value)), 12, SUB, true);
      valT.x = TW - valT.width;
      row.addChild(valT);

      const trackY = 26;
      const track = new Graphics().roundRect(0, trackY, TW, 6, 3).fill(0xf1eaf6);
      const fill = new Graphics().roundRect(0, trackY, Math.max(1, (TW * value) / 100), 6, 3)
        .fill(muted ? 0xd9cdeb : PINK);
      const knob = new Graphics().circle(0, 0, 9).fill(0xffffff).stroke({ width: 2, color: muted ? 0xd9cdeb : PINK });
      knob.x = (TW * value) / 100;
      knob.y = trackY + 3;
      row.addChild(track, fill, knob);

      // 트랙 전체를 잡는 히트 영역 — 손가락이 정확히 손잡이를 안 잡아도 값이 바뀐다
      const hit = new Graphics().rect(0, trackY - 12, TW, 30).fill({ color: 0xffffff, alpha: 0.001 });
      hit.eventMode = "static";
      hit.cursor = "pointer";
      const apply = (localX: number): void => {
        if (muted) return;
        const v = Math.max(0, Math.min(100, Math.round((localX / TW) * 100)));
        if (key === "bgm") setBgmVolume(v);
        else mockSfx = v;
        opts.onRedraw();
      };
      hit.on("pointerdown", (e) => apply(e.getLocalPosition(hit).x));
      hit.on("globalpointermove", (e) => { if (e.buttons > 0) apply(e.getLocalPosition(hit).x); });
      row.addChild(hit);

      const mute = new Container();
      const mArt = new Graphics().roundRect(0, 0, 34, 30, 9).fill(0xffffff).stroke({ width: 1.5, color: LINE });
      mute.addChild(mArt);
      const mT = txt(muted ? "🔇" : "🔊", 14, INK);
      mT.x = Math.round((34 - mT.width) / 2);
      mT.y = 7;
      mute.addChild(mT);
      mute.x = TW + 10;
      mute.y = trackY - 12;
      pressable(mute, () => {
        if (key === "bgm") setBgmMuted(!bgmMuted());
        else mockSfxMuted = !mockSfxMuted;
        opts.onRedraw();
      });
      row.addChild(mute);

      grp(`side_set_slider_${key}`, 18, y, row);
      y += 56;
    }

    const reset = new Container();
    const rArt = new Graphics().roundRect(0, 0, W - 36, 38, 11).fill(0xf8f4fc).stroke({ width: 1.5, color: LINE });
    reset.addChild(rArt);
    const rT = txt("데모 안내 — 계정·결제는 준비 중이에요", 11.5, SUB);
    rT.x = Math.round((W - 36 - rT.width) / 2);
    rT.y = 12;
    reset.addChild(rT);
    grp("side_set_note", 18, y, reset);
  }
}
