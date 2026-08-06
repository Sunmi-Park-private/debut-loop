// ui/deckSheet.ts — A안: 하단 덱 시트. 핸들을 상하 스와이프(또는 탭)로 개폐, 스토리 중 수시 열람.
import { Container, Graphics, Text, type FederatedPointerEvent } from "pixi.js";
import type { State, Card, CardGrade } from "../engine/types";
import { cardEffect } from "../engine/cards";
import { skinNode, skinFit } from "./uiSkin";
import { cardTemplates } from "../data";
import { BASE_H, stageTop } from "./stage";
import { pos } from "./layout";
import { editable } from "./editor";

const SCREEN_W = 430;
const HANDLE_H = 34;
const SHEET_H = 330;
// 블리드 포함 실제 화면 하단에 앵커 — 닫힘=핸들만 노출 (render 시점 계산)
const openY = (): number => BASE_H - stageTop() - HANDLE_H - SHEET_H;
const closedY = (): number => BASE_H - stageTop() - HANDLE_H;

const GLBL: Record<string, string> = { skill: "실력", mental: "멘탈", reputation: "평판", bond: "유대", capital: "자본" };
const STARS: Record<CardGrade, string> = { epic: "★★★", rare: "★★", common: "★" };

const effLabel = (card: Card): string =>
  Object.entries(cardEffect(card, cardTemplates))
    .map(([k, v]) => `${GLBL[k] ?? k}+${v}`)
    .join(" ");

export interface DeckSheetOpts {
  open: boolean;
  onToggle: (open: boolean) => void; // 스냅 결과 통지 (다음 draw 상태 유지용)
}

export function renderDeckSheet(parent: Container, state: State, opts: DeckSheetOpts): void {
  // 레이아웃 에디터 오프셋 래퍼 — 개폐(y 스냅)는 안쪽 c가 담당, 위치 미세조정은 wrap이 담당 (충돌 없음)
  const wrap = new Container();
  const off = pos("deck", { x: 0, y: 0 });
  wrap.x = off.x;
  wrap.y = off.y;
  parent.addChild(wrap);
  editable("deck", wrap);
  const c = new Container();
  c.y = opts.open ? openY() : closedY();
  wrap.addChild(c);

  // ── 핸들 (상시 노출) — 스킨 있으면 교체(핸들 막대 포함으로 간주) ──
  const sheetSkin = skinNode("deck-sheet", SCREEN_W, HANDLE_H + 24);
  const handle = sheetSkin
    ?? new Graphics().roundRect(0, 0, SCREEN_W, HANDLE_H + 24, 18).fill(0xffffff).stroke({ width: 2, color: 0xece4f4 });
  const grab = new Graphics().roundRect(SCREEN_W / 2 - 22, 8, 44, 5, 3).fill(0xd9cdeb);
  if (sheetSkin) grab.visible = false;
  const label = new Text({
    text: `🎴 내 카드 ${state.cards.length}  ${opts.open ? "▼" : "▲"}`,
    style: { fontSize: 12, fill: 0xc9527f, fontWeight: "bold" },
  });
  label.x = (SCREEN_W - label.width) / 2;
  label.y = 15;
  c.addChild(handle, grab, label);

  // ── 시트 내용 (같은 종류·등급 = ×N 스택) ──
  const sheet = new Graphics().rect(0, HANDLE_H, SCREEN_W, SHEET_H + 24).fill(0xffffff);
  c.addChild(sheet);

  const groups = new Map<string, { card: Card; count: number }>();
  for (const card of state.cards) {
    const key = `${card.templateId}:${card.grade}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { card, count: 1 });
  }

  if (groups.size === 0) {
    const empty = new Text({
      text: "아직 카드가 없어요 — 🎹 연습으로 모아보세요",
      style: { fontSize: 13, fill: 0xa99bc0, fontWeight: "bold" },
    });
    empty.x = (SCREEN_W - empty.width) / 2;
    empty.y = HANDLE_H + 120;
    c.addChild(empty);
  } else {
    const cols = 4;
    const cw = 92;
    const gap = 8;
    const gx = (SCREEN_W - cols * cw - (cols - 1) * gap) / 2;
    let i = 0;
    for (const { card, count } of groups.values()) {
      if (i >= 8) break; // 표시 상한 2줄
      const t = cardTemplates.find((x) => x.id === card.templateId);
      const m = new Container();
      m.x = gx + (i % cols) * (cw + gap);
      m.y = HANDLE_H + 14 + Math.floor(i / cols) * 150;
      const bg = skinFit("deck-card", cw, 138); // 카드 앞면 — 원본 비율 유지 (빈 슬롯은 내용만)
      const ic = new Text({ text: t?.icon ?? "🎴", style: { fontSize: 24 } });
      ic.x = (cw - ic.width) / 2;
      ic.y = 14;
      const st = new Text({ text: STARS[card.grade], style: { fontSize: 11, fill: 0xf0a93a, fontWeight: "bold" } });
      st.x = (cw - st.width) / 2;
      st.y = 52;
      const nm = new Text({ text: t?.name?.replace(" 카드", "") ?? "", style: { fontSize: 11, fill: 0x5b4a70, fontWeight: "bold" } });
      nm.x = (cw - nm.width) / 2;
      nm.y = 74;
      const fx = new Text({ text: effLabel(card), style: { fontSize: 9, fill: 0xa99bc0, fontWeight: "bold" } });
      fx.x = (cw - fx.width) / 2;
      fx.y = 96;
      if (bg) m.addChild(bg);
      m.addChild(ic, st, nm, fx);
      if (count > 1) {
        const badge = new Text({ text: `×${count}`, style: { fontSize: 10, fill: 0xc9527f, fontWeight: "bold" } });
        badge.x = cw - badge.width - 7;
        badge.y = 6;
        m.addChild(badge);
      }
      c.addChild(m);
      i++;
    }
    if (groups.size > 8) {
      const more = new Text({ text: `외 ${groups.size - 8}종…`, style: { fontSize: 11, fill: 0xa99bc0 } });
      more.x = (SCREEN_W - more.width) / 2;
      more.y = HANDLE_H + 314;
      c.addChild(more);
    }
  }

  // ── 상하 스와이프/탭 개폐 ──
  c.eventMode = "static";
  c.cursor = "grab";
  let dragging = false;
  let startY = 0;
  let baseY = 0;
  let moved = 0;
  c.on("pointerdown", (e: FederatedPointerEvent) => {
    dragging = true;
    startY = e.globalY;
    baseY = c.y;
    moved = 0;
  });
  const move = (e: FederatedPointerEvent): void => {
    if (!dragging) return;
    const dy = e.globalY - startY;
    moved = Math.max(moved, Math.abs(dy));
    c.y = Math.max(openY(), Math.min(closedY(), baseY + dy));
  };
  c.on("globalpointermove", move);
  c.on("pointermove", move);
  const finish = (): void => {
    if (!dragging) return;
    dragging = false;
    let open: boolean;
    if (moved < 8) open = !opts.open; // 탭 = 토글
    else open = c.y < (openY() + closedY()) / 2; // 스와이프 = 가까운 쪽 스냅
    c.y = open ? openY() : closedY();
    label.text = `🎴 내 카드 ${state.cards.length}  ${open ? "▼" : "▲"}`;
    label.x = (SCREEN_W - label.width) / 2;
    opts.onToggle(open);
  };
  c.on("pointerup", finish);
  c.on("pointerupoutside", finish);
}
