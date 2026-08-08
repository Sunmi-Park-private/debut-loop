// ui/gaugeBar.ts — 5게이지 렌더 + 스와이프 미리보기/커밋 bump (Pixi v8). state 읽기만.
// game-gauge-bar 스킨 업로드 시 가로형(아이콘 아트 좌표 기준), 없으면 기존 세로 리스트.
import { Container, Graphics, Text, type Ticker } from "pixi.js";
import type { State, GaugeId, Effect } from "../engine/types";
import { pos } from "./layout";
import { skinNode } from "./uiSkin";
import { editable } from "./editor";
import { config } from "../data";
import { statusLine } from "./runStatus";

// 색은 로비 상태바(lobbyStatusBar CELLS)와 통일 — 아이콘 톤에 맞춤
const GAUGES: Array<[GaugeId, string, number]> = [
  ["skill", "실력", 0xffa04d],
  ["mental", "멘탈", 0xff7fa5],
  ["reputation", "평판", 0x6fb8ff],
  ["bond", "유대", 0x5fd3b0],
  ["capital", "자본", 0xf0c05a],
];
const UP = 0x3fb98a;
const DOWN = 0xff6f91;

export interface GaugePanel {
  /** 드래그 중 미리보기: 선택 효과의 게이지 증감을 +N/−N으로 표시 (t=드래그 강도 0~1) */
  showPreview(eff: Effect | undefined, t: number): void;
  clearPreview(): void;
  /** 게이지 즉시 재렌더 + bump 강조 — 관문 라운드 정산 등 draw() 없이 값이 바뀔 때 */
  commit(bump: Partial<Record<GaugeId, number>>): void;
}

export interface GaugeOpts {
  bump?: Partial<Record<GaugeId, number>>; // 직전 커밋의 게이지 변화량 — 강조+델타 팝
  ticker?: Ticker;                          // bump 애니메이션 구동
}

/** 미리보기 하단 보조 문구 (게이지 외 효과) */
function extraText(eff: Effect | undefined, hasGauge: boolean): string {
  if (!eff) return "";
  const parts: string[] = [];
  if (eff.points) parts.push(`+${eff.points}⭐`);
  if (eff.addClue) parts.push("🔍 단서 +1");
  if (parts.length === 0 && !hasGauge) return eff.flags && eff.flags.length > 0 ? "· 전개 분기" : "· 변화 없음";
  return parts.join(" · ");
}

// ── 가로형 (game-gauge-bar 아트) — 아이콘 실측 좌표 기준 배치 ──
// 아트 2172×724, trimAlpha 후 2136×481 → 표시 394×89 (스케일 0.1844)
// 아이콘 중심(트림 기준): x 22/97/173/249/324 · y 27 — 예시: 라벨(아이콘 우측)→미니바→값(바 우측 정렬)
const BAR_W = 394, BAR_H = 89;
const CELL_X = [22, 97, 173, 249, 324];
// 가로형 아트의 아이콘 순서 — 로비 상태바와 동일 (하트=멘탈 · 별=평판 · 사람=유대 · 학사모=실력 · 동전=자본)
const BAR_ORDER: GaugeId[] = ["mental", "reputation", "bond", "skill", "capital"];
const TAB_CX = 197, TAB_Y = 71; // 하단 탭 중앙 (1회차 · W0 · D-N · 카드 N)

function renderGaugeBarSkin(parent: Container, state: State, opts: GaugeOpts, barSkin: Container): GaugePanel {
  const panel = new Container();
  const p = pos("gauges_bar", { x: 18, y: 28 });
  panel.x = p.x;
  panel.y = p.y;
  panel.addChild(barSkin);

  const deltas = new Map<GaugeId, Text>();
  const cellsC = new Container();
  panel.addChild(cellsC);
  let activeTicks: Array<() => void> = [];

  const drawCells = (bump?: Partial<Record<GaugeId, number>>): void => {
    for (const t of activeTicks) opts.ticker?.remove(t);
    activeTicks = [];
    cellsC.removeChildren();
    deltas.clear();

    BAR_ORDER.forEach((id, i) => {
      const meta = GAUGES.find((g) => g[0] === id);
      const label = meta?.[1] ?? id;
      const color = meta?.[2] ?? 0xb39cff;
      const cx = CELL_X[i] ?? 0;
      const lp = pos(`story_lbl_${id}`, { x: cx + 16, y: 13 });
      const lbl = new Text({ text: label, style: { fontSize: 11, fill: 0x5b4a70, fontWeight: "bold" } });
      lbl.x = lp.x;
      lbl.y = lp.y;
      const bp = pos(`story_bar_${id}`, { x: cx + 16, y: 31 });
      const BW = 46;
      const bg = new Graphics().roundRect(bp.x, bp.y, BW, 5, 2.5).fill(0xe7e0ee);
      const v = Math.max(0, Math.min(100, state.gauges[id]));
      const fill = new Graphics().roundRect(bp.x, bp.y, Math.max(2, (BW * v) / 100), 5, 2.5).fill(color);
      // 값 숫자 — 우측 정렬을 박스 '안'에서 처리한다. 박스 x를 그대로 저장/복원해야 에디터 좌표가 왕복한다
      // (예전처럼 num.x = 저장값 − 폭 으로 하면 다음 렌더에서 폭만큼 또 밀려 위치가 되돌아간 것처럼 보임)
      const vp = pos(`story_val_${id}`, { x: bp.x + BW, y: 41 });
      const numBox = new Container();
      numBox.x = vp.x;
      numBox.y = vp.y;
      const num = new Text({ text: String(Math.round(v)), style: { fontSize: 12, fill: 0x5b4a70, fontWeight: "bold" } });
      num.x = -num.width; // 박스 기준점 = 우측 끝
      const delta = new Text({ text: "", style: { fontSize: 12, fill: UP, fontWeight: "bold" } });
      // 델타는 값 숫자 바로 위 (우측 정렬) — 옆에 두면 다음 셀 아이콘과 겹침
      delta.anchor.set(1, 0);
      delta.y = -15;
      numBox.addChild(num, delta);
      deltas.set(id, delta);
      cellsC.addChild(lbl, bg, fill, numBox);
      editable(`story_lbl_${id}`, lbl);
      editable(`story_val_${id}`, numBox);

      const bumpVal = bump?.[id];
      if (bumpVal && opts.ticker) { // 커밋 bump: 숫자 팝 + 델타 떠오르며 소멸
        num.scale.set(1.7);
        num.style.fill = color;
        delta.text = (bumpVal > 0 ? "+" : "") + String(bumpVal);
        delta.style.fill = bumpVal > 0 ? UP : DOWN;
        let el = 0;
        const ticker = opts.ticker;
        const tick = (): void => {
          if (!panel.parent || num.destroyed) { ticker.remove(tick); return; }
          el += ticker.deltaMS / 850;
          const k = Math.min(1, el);
          num.scale.set(1.7 - 0.7 * k);
          delta.y = -15 - 10 * k;
          delta.alpha = 1 - k * 0.9;
          if (k >= 1) {
            num.style.fill = 0x5b4a70;
            delta.text = "";
            delta.y = vp.y - 15;
            delta.alpha = 1;
            ticker.remove(tick);
          }
        };
        ticker.add(tick);
        activeTicks.push(tick);
      }
    });

    // 하단 탭: 회차 · 주차 · D-데뷔까지(주) · 카드 (예시 포맷)
    // 중앙 정렬을 박스 '안'에서 처리 — 박스 x를 그대로 저장/복원해야 에디터 드래그가 유지된다
    const tp = pos("story_tab", { x: TAB_CX, y: TAB_Y });
    const tabBox = new Container();
    tabBox.x = tp.x;
    tabBox.y = tp.y;
    const tab = new Text({
      text: statusLine({
        loop: state.loopCount, week: state.week, debutWeek: config.debutWeek,
        cards: state.cards.length, clues: state.clues.size,
      }),
      style: { fontSize: 11, fill: 0x8a7ba0, fontWeight: "bold" },
    });
    tab.x = -tab.width / 2; // 박스 기준점 = 문구 중앙
    tabBox.addChild(tab);
    cellsC.addChild(tabBox);
    editable("story_tab", tabBox);
  };
  drawCells(opts.bump);

  const extra = new Text({ text: "", style: { fontSize: 11, fill: 0xa78be6, fontWeight: "bold" } });
  extra.x = 8;
  extra.y = TAB_Y;
  panel.addChild(extra);

  parent.addChild(panel);
  editable("gauges_bar", panel);

  // 미리보기 강조: 펄스 확대 + 글로우 플래시 (드래그 중 지속 — 밝은 바 위에서 시인성 확보)
  let pulseT = 0;
  let pulsing = false;
  const pulse = (): void => {
    if (!panel.parent) { opts.ticker?.remove(pulse); pulsing = false; return; }
    pulseT += (opts.ticker?.deltaMS ?? 16) / 1000;
    const k = (Math.sin(pulseT * Math.PI * 2 * 1.6) + 1) / 2; // ≈1.6Hz 박동
    for (const dt of deltas.values()) {
      if (!dt.text) { dt.scale.set(1); continue; }
      dt.scale.set(1 + 0.45 * k); // 펄스 확대
      dt.style.dropShadow = { color: dt.style.fill as number, blur: 2 + 7 * k, distance: 0, angle: 0, alpha: 0.9 }; // 플래시 글로우
    }
  };
  const stopPulse = (): void => {
    if (!pulsing) return;
    pulsing = false;
    opts.ticker?.remove(pulse);
    for (const dt of deltas.values()) {
      dt.scale.set(1);
      dt.style.dropShadow = false;
    }
  };

  return {
    showPreview(eff, t) {
      const g = eff?.gauges ?? {};
      let any = false;
      for (const [id, dt] of deltas) {
        const v = g[id];
        if (v) {
          dt.text = (v > 0 ? "+" : "") + String(v);
          dt.style.fill = v > 0 ? UP : DOWN;
          dt.alpha = 0.55 + 0.45 * t;
          any = true;
        } else dt.text = "";
      }
      if (any && !pulsing && opts.ticker) { pulsing = true; pulseT = 0; opts.ticker.add(pulse); }
      if (!any) stopPulse();
      extra.text = extraText(eff, any);
      extra.alpha = 0.4 + 0.6 * t;
    },
    clearPreview() {
      stopPulse();
      for (const dt of deltas.values()) dt.text = "";
      extra.text = "";
    },
    commit(bump) {
      stopPulse();
      drawCells(bump);
    },
  };
}

export function renderGauges(parent: Container, state: State, opts: GaugeOpts = {}): GaugePanel {
  // game-gauge-bar 아트 업로드 시에만 표시 — 빈 슬롯은 상태바 미표시 (헤더 텍스트는 app.ts drawHeader가 유지)
  const barSkin = skinNode("game-gauge-bar", BAR_W, BAR_H);
  if (!barSkin) return { showPreview: () => {}, clearPreview: () => {}, commit: () => {} };
  return renderGaugeBarSkin(parent, state, opts, barSkin);
}
