// ui/screens.ts — 엔딩/회귀 화면 (Pixi v8). state 읽기 + 액션 방출만.
import { Container, Graphics, Text } from "pixi.js";
import type { RunEvent, State } from "../engine/types";
import { pos } from "./layout";
import { pairSpace } from "./keys";
import { editable } from "./editor";

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

  const bgH = event.type === "regress" ? 402 : 340; // 회귀는 모드 선택 2버튼 수용
  const bg = new Graphics().roundRect(0, 0, 394, bgH, 24).fill(0xffffff).stroke({ width: 2, color: 0xece4f4 });
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

  scr.addChild(bg, emoji, title, body);

  // 버튼: 회귀=2회차 모드 선택 2버튼, 엔딩=단일 버튼. 탭·Space 공용 1회 실행(진행해도 리스너 해제)
  const mkAction = (label: string, sub: string, y: number, color: number, fire: () => void): Container => {
    const b = new Container();
    const g = new Graphics().roundRect(0, 0, 300, 56, 16).fill(color);
    const t = new Text({ text: label, style: { fontSize: 15, fill: 0xffffff, fontWeight: "bold" } });
    t.x = (300 - t.width) / 2;
    t.y = sub ? 9 : 18;
    b.addChild(g, t);
    if (sub) {
      const st = new Text({ text: sub, style: { fontSize: 10.5, fill: 0xffffff } });
      st.alpha = 0.8;
      st.x = (300 - st.width) / 2;
      st.y = 33;
      b.addChild(st);
    }
    b.x = (394 - 300) / 2;
    b.y = y;
    b.eventMode = "static";
    b.cursor = "pointer";
    b.on("pointertap", fire);
    return b;
  };
  let done = false;
  let offSpace = (): void => {};
  const fire = (mode?: "fast" | "normal") => (): void => { if (done) return; done = true; offSpace(); onAction(mode); };
  if (event.type === "regress") {
    scr.addChild(
      mkAction("⚡ 빠른 모드로 다시", "겪은 장면은 탭 한 번에 넘어가요", 216, 0xff7fb0, fire("fast")),
      mkAction("📖 정속 모드로 다시", "모든 장면을 다시 보며 선택해요", 282, 0x9a7fe0, fire("normal")),
    );
    offSpace = pairSpace(fire("fast"), () => !done && !scr.destroyed); // Space = 추천(빠른 모드)
  } else {
    scr.addChild(mkAction(c.action, "", 240, 0xff7fb0, fire()));
    offSpace = pairSpace(fire(), () => !done && !scr.destroyed);
  }

  parent.addChild(scr);
  editable("endScreen", scr);
}
