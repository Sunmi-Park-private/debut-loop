// ui/screens.ts — 엔딩/회귀 화면 (Pixi v8). state 읽기 + 액션 방출만.
import { Assets, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { RunEvent, State } from "../engine/types";
import { pos } from "./layout";
import { pairSpace } from "./keys";
import { editable } from "./editor";
import { pressable } from "./press";
import { skinFit, skinNatural, skinNode } from "./uiSkin";
import { systemBgFile } from "./bgSlots";
import { assetUrl } from "./hotAssets";
import { isVideoUrl, loadVideoTexture } from "./videoLoad";
import { stageTop, stageHeight } from "./stage";

interface EndCopy {
  emoji: string; // 트루 엔딩만 빈 문자열 — 전체 화면 영상 위에는 이모지를 올리지 않는다
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
      emoji: "",
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
  // 트루 엔딩이 공통 키(end_*)를 쓰고 나머지는 전용 키를 갖는다.
  // 전용 키는 공통 키를 승계하지 않는다 — 공통 키는 트루 엔딩이 전체 화면 영상 위에 맞춰
  // 잡아둔 좌표라, 승계하면 패널 안에 그려지는 회귀·파멸의 문구가 영상 좌표로 끌려간다.
  // 저장값이 없는 회귀·파멸은 코드 기본 배치(패널 중앙)를 그대로 쓴다.
  const variant = event.type === "regress" ? "regress"
    : event.type === "ending" && event.kind !== "true" ? "doom" : "";
  const doom = variant === "doom";
  const ns = variant ? `${variant}_` : "";
  const lpos = (key: string, dflt: { x: number; y: number }): { x: number; y: number } =>
    pos(ns + key, dflt);

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
  // 전용 프레임 슬롯을 먼저 본다 — 비어 있으면 공통(end-panel) → 벡터 순으로 내려간다.
  // 전부 skinFit(원본 비율 유지) — 세로로 긴 아트나 영상이 올라와도 눌리지 않는다.
  // 박스보다 작게 들어오면 레이아웃 에디터에서 배율·위치를 잡는다.
  // 트루 엔딩은 창을 걷어내고 화면 전체 데뷔 영상을 깐다 (배경 에디터 true-ending 슬롯).
  // 영상이 아직 안 올라왔으면 지금까지의 패널 화면 그대로 — 업로드 전후로 화면이 비지 않게.
  const trueEnd = event.type === "ending" && event.kind === "true";
  const endVidFile = trueEnd ? systemBgFile("true-ending") ?? "" : "";
  const fullVideo = endVidFile !== "";

  const VARIANT_BOX: Record<string, number> = { regress: 402, doom: 606 };
  const bgArt = (variant ? skinFit(`end-panel-${variant}`, 394, VARIANT_BOX[variant] ?? bgH) : null)
    ?? skinFit("end-panel", 394, bgH);
  const bg = fullVideo ? null
    : bgArt ?? new Graphics().roundRect(0, 0, 394, bgH, 24).fill(0xffffff).stroke({ width: 2, color: 0xece4f4 });
  const c = copyFor(event, state);
  // 이모지는 패널 화면(회귀 🌑 · 파멸 💀)만 — 트루 엔딩은 전체 영상 위라 문구 c.emoji가 비어 있다
  const emoji = c.emoji ? new Text({ text: c.emoji, style: { fontSize: 44 } }) : null;
  if (emoji) {
    emoji.x = 175;
    emoji.y = 34;
  }
  const title = new Text({ text: c.title, style: { fontSize: 19, fill: 0x5b4a70, fontWeight: "bold" } });
  title.x = (394 - title.width) / 2;
  title.y = 104;
  const body = new Text({
    text: c.body,
    style: { fontSize: 13.5, fill: 0xa99bc0, wordWrap: true, wordWrapWidth: 330, lineHeight: 22, align: "center" },
  });
  body.x = (394 - body.width) / 2;
  body.y = 148;

  // 전체 영상 모드에선 패널을 그리지 않는다 — 영상 위에 문구·버튼만 얹힌다
  if (bg) grp("end_bg", bg);
  if (emoji) {
    grp("end_emoji", emoji);
    asText("end_emoji", emoji);
  }
  grp("end_title", title);
  grp("end_body", body);
  asText("end_title", title);
  asText("end_body", body);

  // 트루 엔딩 영상 — 화면 전체 cover (타이틀 통짜 영상과 같은 규칙: 넘치는 축은 잘린다).
  // scr보다 먼저 parent에 붙어 문구·버튼 뒤 레이어가 된다. 레이아웃 에디터 키: end_video
  if (fullVideo) {
    const holder = new Container();
    const vp = pos("end_video", { x: 0, y: 0 });
    holder.x = vp.x;
    holder.y = vp.y;
    parent.addChild(holder);
    editable("end_video", holder);
    const url = assetUrl(endVidFile) ?? endVidFile;
    const load = isVideoUrl(url) ? loadVideoTexture(url) : Assets.load<Texture>(url);
    void load.then((tex) => {
      if (holder.destroyed) return;
      const sh = stageHeight();
      const s = Math.max(394 / tex.width, sh / tex.height);
      const sp = new Sprite(tex);
      sp.scale.set(s);
      sp.x = (394 - tex.width * s) / 2;
      sp.y = stageTop() + (sh - tex.height * s) / 2;
      holder.addChild(sp);
    }).catch(() => {}); // 미업로드·인코딩 실패 → 영상 없이 문구·버튼만
  }

  // 버튼: 회귀=2회차 모드 선택 2버튼, 엔딩=단일 버튼. 탭·Space 공용 1회 실행(진행해도 리스너 해제)
  const mkAction = (key: string, label: string, sub: string, y: number, color: number, fire: () => void): Container => {
    const b = new Container();
    // 버튼 아트 — 슬롯이 비어 있으면 기존 벡터 유지
    // 파멸 전용 버튼은 natural — 1배율=원본 크기(리샘플 없음). 아트를 올린 뒤 UI 에디터
    // 배율로 크기를 잡는다. 눌러야 할 영역(300×56)은 컨테이너가 그대로 갖는다.
    // 트루 엔딩 '처음부터'는 타이틀 화면 섹션의 전용 슬롯(title-end-restart) — 영상 위에 얹는 버튼이라
    // natural(1배율=원본 크기)로 두고 크기는 UI 에디터 배율로 잡는다. 눌리는 영역(300×56)은 컨테이너가 갖는다.
    const g = (doom ? skinNode("end-btn-doom", 300, 56) : null)
      ?? (trueEnd ? skinNatural("title-end-restart", 300, 56) : null)
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
