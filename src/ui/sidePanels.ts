// ui/sidePanels.ts — 로비 사이드 팝업(데일리·앨범·상점·설정)의 Pixi 판.
// 예전엔 HTML/CSS로 그려서 레이아웃 에디터가 손댈 수 없었다(등록할 Pixi 대상이 없음).
// 다른 게임 화면과 같은 패턴 — 딤 + 패널 + 조각별 그룹 + editable() 등록.
// 아트는 기존 side-* 슬롯을 그대로 쓴다.
import { Container, Graphics, Text, type Ticker } from "pixi.js";
import { pos } from "./layout";
import { editable, editableClone } from "./editor";
import { fullRect } from "./stage";
import { skinFit, skinNode } from "./uiSkin";
import { pressable } from "./press";
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
const mock = { dailyClaimed: false };
const mockSns: Record<"google" | "apple", boolean> = { google: false, apple: false };
let mockSfx = 70;        // 효과음은 아직 실제 배선이 없다 (목업)
let mockSfxMuted = false;

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
  dim.eventMode = "static";
  dim.on("pointertap", opts.onClose); // 딤 탭 = 닫기 (편집 모드에선 실드가 먼저 받는다)
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
  const BODY_H: Record<SideTab, number> = { daily: 320, album: 664, shop: 362, settings: 330 };
  const bodyH = BODY_H[opts.tab];

  // ── 공용 셸 ──
  // 배경판은 탭 전용 아트가 있으면 그걸 쓰고(원본 비율 유지), 없으면 공용 프레임(9슬라이스라
  // 늘어나는 게 맞다) → 벡터 순으로 내려간다. 탭마다 내용 높이가 달라 한 장으로는 안 맞는다.
  const BG_SLOT: Record<SideTab, string> = {
    daily: "side-daily-bg", album: "side-album-bg", shop: "side-shop-bg", settings: "side-settings-bg",
  };
  const bg = skinFit(BG_SLOT[opts.tab], W, bodyH)
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
    grp("side_daily_head", 18, 58, head);

    const CW = 78, CH = 74, GAP = 8, COLS = 4;
    const gx = Math.round((W - COLS * CW - (COLS - 1) * GAP) / 2);
    const gridG = grp("side_daily_grid", gx, 84);

    const rewards = ["⭐5", "⭐10", "카드×1", "⭐15", "카드×2", "⭐20", "카드★★★"];
    rewards.forEach((r, i) => {
      const day = i + 1;
      const done = day <= 3 || (day === 4 && mock.dailyClaimed);
      const today = day === 4 && !mock.dailyClaimed;
      const cell = new Container();
      cell.x = (i % COLS) * (CW + GAP);
      cell.y = Math.floor(i / COLS) * (CH + GAP);

      // 배경은 상태별로 다른 슬롯을 쓰므로 컴포넌트 이름도 상태별로 나눈다.
      // 한 이름으로 묶으면 패널에 슬롯이 하나만 잡혀(첫 칸=done) 나머지 상태의
      // 아트를 파일 교체로 올릴 수 없다.
      const state = done ? "done" : today ? "today" : "lock";
      const art = skinFit(`side-daily-cell-${state}`, CW, CH)
        ?? new Graphics().roundRect(0, 0, CW, CH, 12)
          .fill(done ? 0xf2fbf8 : today ? 0xfff2f9 : 0xf8f4fc)
          .stroke({ width: today ? 2.5 : 2, color: done ? 0x6fd8c4 : today ? PINK : LINE });
      const bgName = `side_daily_cell_${state}`;
      const pArt = pos(bgName, { x: 0, y: 0 });
      art.x = pArt.x;
      art.y = pArt.y;
      cell.addChild(art);
      reg(bgName, art);

      const dayT = txt(`D${day}`, 11, done ? 0x2e9a80 : today ? 0xc9527f : SUB, true);
      const pDay = pos("side_daily_cell_day", { x: Math.round((CW - dayT.width) / 2), y: 10 });
      dayT.x = pDay.x;
      dayT.y = pDay.y;
      cell.addChild(dayT);
      reg("side_daily_cell_day", dayT);

      const rw = txt(done ? "✓" : r, 15, done ? 0x2e9a80 : today ? 0xc9527f : SUB, true);
      const pRw = pos("side_daily_cell_reward", { x: Math.round((CW - rw.width) / 2), y: 30 });
      rw.x = pRw.x;
      rw.y = pRw.y;
      cell.addChild(rw);
      reg("side_daily_cell_reward", rw);

      if (today) {
        const now = txt("오늘!", 9, 0xc9527f, true);
        // 이름이 배경(side_daily_cell_today)과 겹치지 않게 — 같은 이름이면 둘이 서로를 덮는다
        const pNow = pos("side_daily_cell_todaytag", { x: Math.round((CW - now.width) / 2), y: 54 });
        now.x = pNow.x;
        now.y = pNow.y;
        cell.addChild(now);
        reg("side_daily_cell_todaytag", now);
        pressable(cell, () => {
          mock.dailyClaimed = true;
          toast("⭐15 획득! 내일 또 만나요 🎁");
          opts.onRedraw();
        });
      }
      gridG.addChild(cell);
    });

    const note = txt("7일 연속 출석하면 ★★★ 에픽 카드!", 11, SUB);
    grp("side_daily_note", Math.round((W - note.width) / 2), 268, note);
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
