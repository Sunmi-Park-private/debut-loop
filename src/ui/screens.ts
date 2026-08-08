// ui/screens.ts — 엔딩/회귀 화면 (Pixi v8). state 읽기 + 액션 방출만.
import { Container, Graphics, Text } from "pixi.js";
import type { RunEvent, State } from "../engine/types";
import { pos } from "./layout";
import { pairSpace } from "./keys";
import { editable } from "./editor";
import { pressable } from "./press";
import { skinNode } from "./uiSkin";

interface EndCopy {
  emoji: string;
  title: string;
  body: string;
  action: string;
}

function copyFor(event: RunEvent, state: State): EndCopy {
  if (event.type === "regress") {
    return {
      emoji: "🌑",
      title: "붉은 섬광 — 눈을 뜨니 0시",
      body: `단서 ${state.clues.size}/4 — 진실을 알지 못한 채 무대가 무너졌다.\n파편 같은 기억만이 남아 있다.`,
      action: "다시, 시작하다 ↺",
    };
  }
  if (event.type === "ending" && event.kind === "true") {
    return {
      emoji: "🎤",
      title: "데뷔 성공 — 우리가 지켰어",
      body: `단서 ${state.clues.size}/4 — 사보타주를 막았다.\n5명이 함께, 처음으로 끝까지. 0시가 지나간다.`,
      action: "처음부터 ↺",
    };
  }
  return {
    emoji: "💀",
    title: "파멸 — 게이지 붕괴",
    body: "게이지 하나가 바닥났다. (실제: 강등→패자부활전→탈락)",
    action: "다시 도전 ↺",
  };
}

export function renderEndScreen(
  parent: Container,
  event: RunEvent,
  state: State,
  onAction: (mode?: "fast" | "normal") => void, // 회귀=선택한 2회차 모드, 엔딩=undefined
): void {
  const scr = new Container();
  const p = pos("endScreen");
  scr.x = p.x;
  scr.y = p.y;

  // 같은 렌더러가 세 화면을 그린다 — 회귀 / 파멸(게이지 붕괴) / 트루 엔딩.
  // 분위기가 서로 달라 프레임부터 다르므로, 트루 엔딩만 공통 키를 쓰고 나머지는 전용 키를 갖는다.
  // 전용 키에 저장값이 없으면 공통 키를 승계하므로, 아트를 올리기 전 배치는 지금 그대로다.
  const variant = event.type === "regress" ? "regress"
    : event.type === "ending" && event.kind !== "true" ? "doom" : "";
  const doom = variant === "doom";
  const ns = variant ? `${variant}_` : "";
  const lpos = (key: string, dflt: { x: number; y: number }): { x: number; y: number } =>
    ns ? pos(ns + key, pos(key, dflt)) : pos(key, dflt);

  /** 텍스트 노드를 따로 등록 — 그룹은 위치, 텍스트는 크기·색·미세 위치를 갖는다 */
  const asText = (key: string, t: Text): void => {
    const q = lpos(`${key}_text`, { x: Math.round(t.x), y: Math.round(t.y) });
    t.x = q.x;
    t.y = q.y;
    editable(ns + `${key}_text`, t);
  };

  // 조각별 오프셋 그룹 — 화면 전체(endScreen)와 별개로 각 요소를 따로 옮길 수 있게 한다.
  // 자식 좌표는 코드가 잡은 그대로 두고, 그룹만 움직이므로 기존 배치가 바뀌지 않는다.
  const grp = (key: string, child: Container): Container => {
    const g = new Container();
    const q = lpos(key, { x: 0, y: 0 });
    g.x = q.x;
    g.y = q.y;
    g.addChild(child);
    scr.addChild(g);
    editable(ns + key, g);
    return g;
  };

  const bgH = event.type === "regress" ? 402 : 340; // 회귀는 모드 선택 2버튼 수용
  // 배경판 — 업로드된 아트가 있으면 교체, 없으면 기존 벡터
  // 전용 프레임 슬롯을 먼저 본다 — 비어 있으면 공통(end-panel) → 벡터 순으로 내려간다
  const bgArt = (variant ? skinNode(`end-panel-${variant}`, 394, bgH) : null)
    ?? skinNode("end-panel", 394, bgH);
  const bg = bgArt ?? new Graphics().roundRect(0, 0, 394, bgH, 24).fill(0xffffff).stroke({ width: 2, color: 0xece4f4 });
  const c = copyFor(event, state);
  const emoji = new Text({ text: c.emoji, style: { fontSize: 44 } });
  emoji.x = 175;
  emoji.y = 34;
  const title = new Text({ text: c.title, style: { fontSize: 19, fill: 0x5b4a70, fontWeight: "bold" } });
  title.x = (394 - title.width) / 2;
  title.y = 104;
  const body = new Text({
    text: c.body,
    style: { fontSize: 13.5, fill: 0xa99bc0, wordWrap: true, wordWrapWidth: 330, lineHeight: 22, align: "center" },
  });
  body.x = (394 - body.width) / 2;
  body.y = 148;

  grp("end_bg", bg);
  grp("end_emoji", emoji);
  grp("end_title", title);
  grp("end_body", body);
  asText("end_emoji", emoji);
  asText("end_title", title);
  asText("end_body", body);

  // 버튼: 회귀=2회차 모드 선택 2버튼, 엔딩=단일 버튼. 탭·Space 공용 1회 실행(진행해도 리스너 해제)
  const mkAction = (key: string, label: string, sub: string, y: number, color: number, fire: () => void): Container => {
    const b = new Container();
    // 버튼 아트 — 슬롯이 비어 있으면 기존 벡터 유지
    const g = (doom ? skinNode("end-btn-doom", 300, 56) : null)
      ?? skinNode(`end-btn-${key}`, 300, 56)
      ?? new Graphics().roundRect(0, 0, 300, 56, 16).fill(color);
    const t = new Text({ text: label, style: { fontSize: 15, fill: 0xffffff, fontWeight: "bold" } });
    t.x = (300 - t.width) / 2;
    t.y = sub ? 9 : 18;
    b.addChild(g, t);
    const p2 = lpos(`end_${key}`, { x: (394 - 300) / 2, y });
    b.x = p2.x;
    b.y = p2.y;
    pressable(b, fire);
    scr.addChild(b);
    editable(ns + `end_${key}`, b);
    asText(`end_${key}`, t); // 버튼 문구를 따로 조정 (버튼 등록 뒤 = 문구가 안쪽 소유자)
    if (sub) {
      const st = new Text({ text: sub, style: { fontSize: 10.5, fill: 0xffffff } });
      st.alpha = 0.8;
      st.x = (300 - st.width) / 2;
      st.y = 33;
      b.addChild(st);
      const qs = lpos(`end_${key}_sub`, { x: Math.round(st.x), y: Math.round(st.y) });
      st.x = qs.x;
      st.y = qs.y;
      editable(ns + `end_${key}_sub`, st);
    }
    return b;
  };
  let done = false;
  let offSpace = (): void => {};
  const fire = (mode?: "fast" | "normal") => (): void => { if (done) return; done = true; offSpace(); onAction(mode); };
  if (event.type === "regress") {
    mkAction("fast", "⚡ 빠른 모드로 다시", "겪은 장면은 탭 한 번에 넘어가요", 216, 0xff7fb0, fire("fast"));
    mkAction("normal", "📖 정속 모드로 다시", "모든 장면을 다시 보며 선택해요", 282, 0x9a7fe0, fire("normal"));
    offSpace = pairSpace(fire("fast"), () => !done && !scr.destroyed); // Space = 추천(빠른 모드)
  } else {
    mkAction("action", c.action, "", 240, 0xff7fb0, fire());
    offSpace = pairSpace(fire(), () => !done && !scr.destroyed);
  }

  parent.addChild(scr);
  editable("endScreen", scr);
}
