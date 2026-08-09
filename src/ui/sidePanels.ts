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

export type SideTab = "daily" | "album" | "shop" | "settings";

/** Pixi로 옮긴 탭 — 여기 없는 탭은 호출부가 기존 DOM 팝업을 띄운다 */
export const PIXI_TABS = new Set<SideTab>(["daily"]);

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

  const bodyH = opts.tab === "album" ? 460 : 330;

  // ── 공용 셸 ──
  const bg = skinNode("side-panel", W, bodyH)
    ?? new Graphics().roundRect(0, 0, W, bodyH, 20).fill(0xffffff).stroke({ width: 2, color: LINE });
  grp("side_bg", 0, 0, bg);

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

  // ── 🎁 데일리 보상 ──
  function renderDaily(): void {
    const head = txt("출석 보상 · 매일 접속하고 보상을 받아요", 11, SUB);
    grp("side_daily_head", 18, 58, head);

    const CW = 78, CH = 74, GAP = 8, COLS = 4;
    const gx = Math.round((W - COLS * CW - (COLS - 1) * GAP) / 2);
    const gridG = grp("side_daily_grid", gx, 84);

    const rewards = ["⭐5", "⭐10", "🎴×1", "⭐15", "🎴×2", "⭐20", "🎴★★★"];
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
}
