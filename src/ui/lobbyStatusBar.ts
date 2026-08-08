// ui/lobbyStatusBar.ts — 메인로비 상단 상태 패널: 달력(주차·D-day·막) + 5게이지 (lobby-gauge-bar 아트).
// 게이지 바는 로딩 화면 게이지와 동일 구조(트랙 + 값 비례 채움)로 자동 계산. 데이터는 본게임과 동일(state).
import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { GaugeId } from "../engine/types";
import { skinTex, skinScale } from "./uiSkin";
import { pos } from "./layout";
import { editable } from "./editor";
import { statusLine, ddayWeeks } from "./runStatus";

// ── lobby-gauge-bar.png 아트 좌표 — 원본 px 실측 (알파 bbox 기준) ──
// ponytail: 이 아트 전용 하드코딩 좌표. 프레임 아트가 바뀌면 여기 숫자만 재실측.
// 2026-07-30 디자이너 v2 아트(셀 등간격 212px·아이콘=셀 중심) 기준 재실측.
const ART = { bx: 10, by: 293, bw: 1514, bh: 482 }; // 콘텐츠 bbox (투명 여백 제외)
// 칸: [게이지, 라벨, 아이콘중심x, 바 색(아이콘 톤), 라벨 x 오프셋(표시 px)] — 아트 순서 하트·별·사람·메가폰·동전
const CELLS: Array<[GaugeId, string, number, number, number]> = [
  ["mental", "멘탈", 480, 0xff7fa5, 14],
  ["reputation", "평판", 692, 0x6fb8ff, 14],
  ["bond", "유대", 910, 0x5fd3b0, 14],
  ["skill", "실력", 1118, 0xffa04d, 16], // 메가폰 아이콘이 넓어 +2
  ["capital", "자본", 1332, 0xf0c05a, 14],
];
const CAL_X = 216;                    // 달력 몸통 중심 x
const ICON_Y = 455;                   // 아이콘 라인 (라벨 표기)
const VAL_Y = 545;                    // nn/100 중심
const BAR = { y: 600, w: 160, h: 26 }; // 미니 게이지 (로딩 바 구조)
const PANEL_W = 400;                  // 표시 폭

export interface LobbyStatusData {
  week: number;
  debutWeek: number;
  act: number;
  gauges: Record<GaugeId, number>;
  loop: number;   // 회차 — 본스토리 상단 탭과 같은 값
  cards: number;  // 보유 카드 장수 — 로비 덱에 실제로 깔리는 장수와 같은 값
  clues?: number;
}

/** 로비 상단 상태 패널 — lobby-gauge-bar 아트 미업로드 시 아무것도 그리지 않음 */
export function renderLobbyStatusBar(parent: Container, d: LobbyStatusData): void {
  const tex = skinTex("lobby-gauge-bar");
  if (!tex) return;
  const panel = new Container();
  const p = pos("lobby_status", { x: (430 - PANEL_W) / 2, y: 60 });
  panel.x = p.x;
  panel.y = p.y;

  const s = (PANEL_W / ART.bw) * skinScale("lobby-gauge-bar"); // 에디터 배율 반영
  const ax = (px: number): number => (px - ART.bx) * s;
  const ay = (py: number): number => (py - ART.by) * s;
  const spr = new Sprite(tex);
  spr.scale.set(s);
  spr.x = -ART.bx * s;
  spr.y = -ART.by * s;
  panel.addChild(spr);

  // 달력: 주차(소) · D-day(대, 주×7 일수 환산) · 현재 막(소)
  const week = new Text({ text: `${d.week}주차`, style: { fontSize: 11, fill: 0xe0668e, fontWeight: "bold" } });
  week.anchor.set(0.5);
  week.x = ax(CAL_X);
  week.y = ay(470);
  // D-day는 **주** 단위 — 본스토리 상단 탭과 같은 계산을 쓴다 (예전엔 여기만 ×7 일 단위라 두 화면이 어긋났다)
  const dday = new Text({ text: `D-${ddayWeeks(d.debutWeek, d.week)}`, style: { fontSize: 22, fill: 0x4a3a5e, fontWeight: "bold" } });
  dday.anchor.set(0.5);
  dday.x = ax(CAL_X);
  dday.y = ay(555);
  const act = new Text({ text: d.act === 0 ? "프롤로그" : `${d.act}막 진행 중`, style: { fontSize: 9.5, fill: 0x8a76a8 } });
  act.anchor.set(0.5);
  act.x = ax(CAL_X);
  act.y = ay(655);
  panel.addChild(week, dday, act);

  const barW = BAR.w * s;
  const barH = Math.max(4, BAR.h * s);
  for (const [id, label, cx, color, lblDx] of CELLS) {
    const v = Math.max(0, Math.min(100, d.gauges[id]));
    // 라벨 — 레이아웃 에디터에서 항목별 미세조정 가능 (lobby_lbl_멘탈 등으로 개별 등록)
    const lbl = new Text({ text: label, style: { fontSize: 10.5, fill: 0x5b4a70, fontWeight: "bold" } });
    lbl.anchor.set(0, 0.5);
    const pLbl = pos(`lobby_lbl_${id}`, { x: ax(cx) + lblDx, y: ay(ICON_Y) });
    lbl.x = pLbl.x;
    lbl.y = pLbl.y;
    panel.addChild(lbl);
    editable(`lobby_lbl_${id}`, lbl);
    // 값: 자본=화폐형(×125), 나머지=nn/100 (큰 수 + 작은 /100) — lobby_val_*로 항목별 에디터 조정 가능
    const valC = new Container();
    const pVal = pos(`lobby_val_${id}`, { x: ax(cx), y: ay(VAL_Y) });
    valC.x = pVal.x;
    valC.y = pVal.y;
    if (id === "capital") {
      const num = new Text({ text: (v * 125).toLocaleString("en-US"), style: { fontSize: 13, fill: 0x4a3a5e, fontWeight: "bold" } });
      num.anchor.set(0.5);
      valC.addChild(num);
    } else {
      const num = new Text({ text: String(Math.round(v)), style: { fontSize: 14, fill: 0x4a3a5e, fontWeight: "bold" } });
      num.anchor.set(1, 0.5);
      num.x = 4;
      const denom = new Text({ text: "/100", style: { fontSize: 8.5, fill: 0xa99bc0, fontWeight: "bold" } });
      denom.anchor.set(0, 0.4);
      denom.x = 6;
      valC.addChild(num, denom);
    }
    panel.addChild(valC);
    editable(`lobby_val_${id}`, valC);
    // 미니 게이지 — 로딩 바 구조: 트랙 + 값 비례 채움 (자동 계산) — lobby_bar_*로 항목별 에디터 조정 가능
    const barC = new Container();
    const pBar = pos(`lobby_bar_${id}`, { x: ax(cx) - barW / 2, y: ay(BAR.y) - barH / 2 });
    barC.x = pBar.x;
    barC.y = pBar.y;
    barC.addChild(
      new Graphics().roundRect(0, 0, barW, barH, barH / 2).fill(0xf3dde6),
      new Graphics().roundRect(0, 0, Math.max(3, (barW * v) / 100), barH, barH / 2).fill(color),
    );
    panel.addChild(barC);
    editable(`lobby_bar_${id}`, barC);
  }

  // 진행 표기 한 줄 — 본스토리 상단 탭과 같은 문구·같은 계산 (statusLine)
  const tabBox = new Container();
  const tp = pos("lobby_status_tab", { x: ax(CAL_X), y: ay(720) });
  tabBox.x = tp.x;
  tabBox.y = tp.y;
  const tab = new Text({
    text: statusLine({ loop: d.loop, week: d.week, debutWeek: d.debutWeek, cards: d.cards, clues: d.clues }),
    style: { fontSize: 11, fill: 0x8a7ba0, fontWeight: "bold" },
  });
  tab.x = -tab.width / 2; // 박스 기준점 = 문구 중앙 (박스 x를 그대로 저장해야 에디터 드래그가 유지된다)
  tabBox.addChild(tab);
  panel.addChild(tabBox);
  editable("lobby_status_tab", tabBox);

  parent.addChild(panel);
  editable("lobby_status", panel);
}
