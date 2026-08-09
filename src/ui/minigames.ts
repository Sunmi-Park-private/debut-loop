// ui/minigames.ts — 미니게임 러너(관문·연습 공용) + 관문 뷰 (Pixi v8). 판정은 engine/minigames.
import { AnimatedSprite, Container, Graphics, Sprite, Text, Texture, type Ticker } from "pixi.js";
import type { GateDef, MiniGameGrade, Card, CardGrade, Gauges } from "../engine/types";
import {
  MATCH_CARDS, STOP_ROUNDS, JOKER, GRADE_POINTS,
  rpsBeats, rpsGrade, stopZone, stopGrade, matchGrade, buildMatchDeck,
  SLOT_SPINS, slotGrade,
  RHYTHM_MS, RHYTHM_TRAVEL_MS, RHYTHM_NOTE_IV, RHYTHM_JUDGE_PRESETS, rhythmJudge, rhythmGrade,
  DODGE_COLS, DODGE_ROWS, DODGE_P_HEARTS, DODGE_E_HEARTS, DODGE_SECOND_TILE,
  dodgePickTile, dodgeGrade, type DodgeTile,
  type RpsHand,
} from "../engine/minigames";
import { gatePickCount, resolveGate as sumCardEffects } from "../engine/gate";
import { cardEffect } from "../engine/cards";
import { starNode, gaugeSymbol, fanAngle } from "./cardArt";
import { easeIn, easeOut } from "./ease";
import { pressable, type PressOpts } from "./press";
import { cardTemplates, tuning, beatmaps, tickets } from "../data";
import { skinNode, skinTex, skinTexTrim, skinFit, skinNatural, skinCover, skinScale } from "./uiSkin";
import { pos } from "./layout";
import { btnText, centerBtnLabel } from "./btnLabel";
import { editable, editableClone, inputBlocked, setEditorToggleHook, setRedrawHook } from "./editor";
import { buzz } from "./haptics";
import { fullRect } from "./stage";
import { playLevelUpFx } from "./levelUpFx";
import { playBgm, restartBgm, playCue, stopCue, nextRhythmTrack, bgmPositionMs, pauseBgm, resumeBgm } from "./audio";
import { pairSpace } from "./keys";
import { guide } from "./tutorial";

export const MG_W = 394;
export const MG_H = 600;
// 게임 설명 문구 강조 색 — 목업 아트 실측 (분홍 바 / STOP! / 본문)
const HINT_PINK = 0xe85977;
const HINT_GOLD = 0xdab114;
const HINT_LAV = 0x7f5fd4;
const HINT_INK = 0x585569;
export const INK = 0x5b4a70;
export const SUB = 0xa99bc0;
export const PINK = 0xff7fb0;
export const LAV = 0x9a7fe0;
// 현재 패널 콘텐츠 폭 — renderGate가 배경 이미지 폭에 맞춰 좁힘(흰 여백 제거), mountEngine이 빌드 시점에 확정.
// 화면(관문·연습·보드)은 동시에 하나만 그려지므로 모듈 변수로 충분. ponytail: 동시 표시가 생기면 opts로 스레딩
let W = MG_W;
// 패널 높이 — 기본 MG_H. 포토카드 관문은 배경판 아트 비율에 맞춰 renderGate가 조정 (이미지를 늘리지 않음)
let PH = MG_H;

export const txt = (s: string, size: number, fill: number, bold = false): Text =>
  new Text({ text: s, style: { fontSize: size, fill, fontWeight: bold ? "bold" : "normal", wordWrap: true, wordWrapWidth: W - 40, lineHeight: size * 1.5 } });

/** 연습 종목별 전체 배경판 슬롯 id — 게임 화면과 실패 화면이 같은 배경을 유지할 때 함께 쓴다.
 *  SNS 홍보는 막에 따라 카드 수가 늘어나므로(6장=2×3, 9장 이상=3×3) 그리드에 맞는 배경판을 고른다 */
export const miniBgId = (ns: string, act: number): string => {
  const matchBgId = (MATCH_CARDS[act] ?? 6) <= 6 ? "gate-match-bg" : "gate-match-bg-3x3";
  const MINI_BG: Record<string, string> = {
    vocal: "gate-rec-bg", dance: "gate-mirror-bg", promo: matchBgId, funds: "gate-stop-bg", audition: "gate-rps-bg",
  };
  return MINI_BG[ns] ?? "";
};

export { btnText }; // 이전 위치에서 임포트하던 화면들(memberBoard 등) 호환

export const btn = (label: string, w: number, color: number, onTap: () => void, skinId = "gate-btn", pressOpts?: PressOpts): Container => {
  const b = new Container();
  // 개별 스킨 → 관문 공통 → UI 공용 버튼(ui-btn) → 벡터 순 폴백
  const g = skinNode(skinId, w, 52) ?? skinNode("gate-btn", w, 52) ?? skinNatural("ui-btn", w, 52) ?? new Graphics().roundRect(0, 0, w, 52, 14).fill(color); // ui-btn은 1배율=원본 크기
  const t = txt(label, 14, 0xffffff, true);
  t.x = (w - t.width) / 2;
  t.y = 16;
  b.addChild(g, t);
  pressable(b, onTap, pressOpts); // eventMode·cursor·pointertap 배선까지 여기서 (기본은 복귀 후 onTap)
  return b;
};

/** 판정 이펙트 ④ 링 파동 — good·perfect 공통 (판정 지점에서 금빛 원 2겹 확산) */
function fxRing(parent: Container, x: number, y: number, ticker: Ticker): void {
  for (let k = 0; k < 2; k++) {
    const g = new Graphics().circle(0, 0, 16).stroke({ width: 3, color: 0xf0c05a });
    g.x = x;
    g.y = y;
    g.alpha = 0;
    parent.addChild(g);
    const t0 = performance.now() + k * 140;
    const step = (): void => {
      if (g.destroyed || !g.parent) { ticker.remove(step); return; }
      const el = performance.now() - t0;
      if (el < 0) return;
      const p = el / 650;
      if (p >= 1) { ticker.remove(step); g.parent.removeChild(g); g.destroy(); return; }
      g.alpha = 0.95 * (1 - p);
      g.scale.set(0.6 + p * 3.2);
    };
    ticker.add(step);
  }
}

/** 판정 이펙트 ③ 스파클 버스트 — perfect 전용 (별·반짝이 방사, 크고 멀리) */
function fxBurst(parent: Container, x: number, y: number, ticker: Ticker): void {
  const CHARS = ["✦", "✧", "⭐", "🌟"] as const;
  for (let i = 0; i < 18; i++) {
    const s = txt(CHARS[i % 4] ?? "✦", 14 + Math.random() * 9, i % 3 ? 0xffd98a : 0xff9fc6, true);
    const bx = x - s.width / 2;
    const by = y - s.height / 2;
    const a = (Math.PI * 2 * i) / 18 + Math.random() * 0.4;
    const d = 52 + Math.random() * 58;
    s.x = bx;
    s.y = by;
    parent.addChild(s);
    const t0 = performance.now();
    const step = (): void => {
      if (s.destroyed || !s.parent) { ticker.remove(step); return; }
      const p = (performance.now() - t0) / 900;
      if (p >= 1) { ticker.remove(step); s.parent.removeChild(s); s.destroy(); return; }
      const e = 1 - Math.pow(1 - p, 2); // ease-out
      s.x = bx + Math.cos(a) * d * e;
      s.y = by + Math.sin(a) * d * 0.85 * e - 16 * e;
      s.alpha = p < 0.1 ? p / 0.1 : 1 - (p - 0.1) / 0.9;
      s.scale.set(0.5 + e * 0.9); // 커지며 퍼짐 — 임팩트 강화
      s.rotation = e * 0.8;
    };
    ticker.add(step);
  }
}

/** 판정 이펙트 ⑩ 라이트 블룸 — 부드러운 금빛 광원이 피어올랐다 사라짐 (짝맞추기 성공 등) */
let bloomTex: Texture | null = null;
function getBloomTex(): Texture {
  if (bloomTex) return bloomTex;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g2 = cv.getContext("2d")!;
  const rg = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, "rgba(255,233,176,0.95)");
  rg.addColorStop(0.45, "rgba(240,192,90,0.4)");
  rg.addColorStop(1, "rgba(240,192,90,0)");
  g2.fillStyle = rg;
  g2.fillRect(0, 0, 128, 128);
  bloomTex = Texture.from(cv);
  return bloomTex;
}
function fxBloom(parent: Container, x: number, y: number, ticker: Ticker): void {
  const s = new Sprite(getBloomTex());
  s.anchor.set(0.5);
  s.x = x;
  s.y = y;
  s.blendMode = "add";
  s.alpha = 0;
  parent.addChild(s);
  const t0 = performance.now();
  const step = (): void => {
    if (s.destroyed || !s.parent) { ticker.remove(step); return; }
    const p = (performance.now() - t0) / 850;
    if (p >= 1) { ticker.remove(step); s.parent.removeChild(s); s.destroy(); return; }
    s.alpha = p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75;
    s.scale.set(0.6 + p * 1.3);
  };
  ticker.add(step);
}

/** 판정 이펙트 ⑤ 집중선 — 지점에서 금빛 방사선이 짧게 터짐 (슬롯 GOOD 등) */
function fxRays(parent: Container, x: number, y: number, ticker: Ticker): void {
  for (let i = 0; i < 10; i++) {
    const r = new Graphics().roundRect(-1.5, -44, 3, 26, 1.5).fill(0xffe9b0);
    r.x = x;
    r.y = y;
    r.rotation = (Math.PI * 2 * i) / 10 + Math.random() * 0.3;
    r.alpha = 0;
    parent.addChild(r);
    const t0 = performance.now();
    const step = (): void => {
      if (r.destroyed || !r.parent) { ticker.remove(step); return; }
      const p = (performance.now() - t0) / 480;
      if (p >= 1) { ticker.remove(step); r.parent.removeChild(r); r.destroy(); return; }
      r.alpha = 1 - p;
      r.scale.set(1, 0.4 + p * 1.2);
    };
    ticker.add(step);
  }
}

/** 판정 이펙트 ① 골드 플래시 — 화면이 금빛으로 번쩍 (퍼펙트 확정 순간) */
function fxFlash(parent: Container, ticker: Ticker, width: number, height: number): void {
  const f = new Graphics().rect(0, 0, width, height).fill(0xffe9b0);
  f.blendMode = "add";
  f.alpha = 0;
  parent.addChild(f);
  const t0 = performance.now();
  const step = (): void => {
    if (f.destroyed || !f.parent) { ticker.remove(step); return; }
    const p = (performance.now() - t0) / 550;
    if (p >= 1) { ticker.remove(step); f.parent.removeChild(f); f.destroy(); return; }
    f.alpha = p < 0.15 ? (p / 0.15) * 0.85 : 0.85 * (1 - (p - 0.15) / 0.85);
  };
  ticker.add(step);
}

/** PERFECT 팝 텍스트 — 크게 튀어오르는 골드 글자 (dodge 퍼펙트 등 확정 연출) */
function fxPerfectPop(parent: Container, ticker: Ticker, width: number, y: number): void {
  const t = txt("PERFECT ✨", 30, 0xf0c05a, true);
  t.style.dropShadow = { color: 0xfff3cf, blur: 10, distance: 0, alpha: 0.9, angle: 0 };
  t.pivot.set(t.width / 2, t.height / 2);
  t.x = width / 2;
  t.y = y;
  t.alpha = 0;
  parent.addChild(t);
  const t0 = performance.now();
  const step = (): void => {
    if (t.destroyed || !t.parent) { ticker.remove(step); return; }
    const p = (performance.now() - t0) / 900;
    if (p >= 1) { ticker.remove(step); return; } // 텍스트는 화면 전환까지 유지
    const s = p < 0.25 ? 0.4 + (p / 0.25) * 0.95 : 1.35 - Math.min(0.35, ((p - 0.25) / 0.3) * 0.35);
    t.scale.set(s);
    t.alpha = Math.min(1, p / 0.15);
  };
  ticker.add(step);
}

/** 판정 이펙트 ⑧ 컨페티 — 게임 클리어 축하 (성적 무관) */
export function fxConfetti(parent: Container, ticker: Ticker, width: number, height = 560): void {
  const COLORS = [0xf0c05a, 0xff7fb0, 0x8f80ea, 0x5fe0c9];
  for (let i = 0; i < 24; i++) {
    const c = new Graphics().roundRect(-4, -6, 8, 12, 2).fill(COLORS[i % 4] ?? 0xf0c05a);
    const x0 = 16 + Math.random() * (width - 32);
    c.x = x0;
    c.y = 60 + Math.random() * 40;
    parent.addChild(c);
    const t0 = performance.now() + Math.random() * 300;
    const spin = (Math.random() - 0.5) * 10;
    const sway = 14 + Math.random() * 18;
    const step = (): void => {
      if (c.destroyed || !c.parent) { ticker.remove(step); return; }
      const el = performance.now() - t0;
      if (el < 0) return;
      const p = el / 1300;
      if (p >= 1) { ticker.remove(step); c.parent.removeChild(c); c.destroy(); return; }
      c.y = 60 + p * p * height;
      c.x = x0 + Math.sin(p * 6) * sway;
      c.rotation = p * spin;
      c.alpha = p > 0.8 ? 1 - (p - 0.8) / 0.2 : 1;
    };
    ticker.add(step);
  }
}

export interface EngineOpts {
  engine: "rps" | "stop" | "match" | "rhythm" | "slot" | "dodge"; // 앞 3종=연습하기, 뒤 3종=스테이지 게임
  act: number;                                     // 난이도 스케일 기준 막
  skin?: string;                                   // match: "photo" | "clue" | "promo" · stop: "studio"(보컬) | "mirror"(안무)
  audition?: boolean;                              // 오디션(심사석) 컨텍스트 — 리듬 문구를 심사 테마로 (B-1: 문구만)
  poseTex?: Texture | null;                        // mirror 변형용 캐릭터 포즈 (하루 전신 무대의상)
  poseFrames?: Texture[];                          // mirror 변형용 포즈 시퀀스 (stage-idle) — 있으면 애니 재생
  ticker: Ticker;
  onFinish: (grade: MiniGameGrade | null) => void; // null = 실패(재도전 대상)
  hardBonus?: () => void;                          // 리듬 하드(3열) 클리어 보너스 — 호출측 정의
  width?: number;                                  // 콘텐츠 폭 — 관문은 배경 폭에 맞춘 패널 폭 전달 (기본 MG_W)
  panelH?: number;                                 // 패널 높이 — 포토카드는 배경판 아트 비율 반영 (기본 MG_H)
  boardSkin?: string;                              // 리듬 전체 배경판 슬롯 id — 관문(막)별 분리 (기본 1막 슬롯)
  ns?: string;                                     // 레이아웃 키 네임스페이스 — 연습 활동별 패널 분리 (미지정=공통 키)
}

/**
 * 미니게임 엔진을 body에 마운트 (관문·연습 공용).
 * 설명줄(y≈48)부터 그리며, 제목·결과·실패 화면은 호출측 책임.
 */
export function mountEngine(body: Container, opts: EngineOpts): void {
  const { act, ticker, onFinish } = opts;
  W = opts.width ?? MG_W; // 콘텐츠 폭 확정 — 연습·보드는 기본 폭, 관문은 배경 맞춤 폭
  PH = opts.panelH ?? MG_H;

  // 컴포넌트 그룹: layout.json 오프셋(기본 0,0) 적용 + 레이아웃 에디터 드래그 등록. 자식 좌표는 기존 그대로
  // ns가 있으면 활동별 전용 키(vocal_stop_desc 등) — 미저장 시 공통 키 값을 승계해 현재 위치 유지
  const ns = opts.ns ?? "";
  const textGroups: Container[] = []; // 설명·회차·안내 문구 — 엔진을 다 그린 뒤 최상단으로 다시 올린다
  const grpIn = (parent: Container, name: string, ...items: Container[]): Container => {
    const key = ns ? `${ns}_${name}` : name;
    const g2 = new Container();
    const gp = ns ? pos(key, pos(name, { x: 0, y: 0 })) : pos(name, { x: 0, y: 0 });
    g2.x = gp.x;
    g2.y = gp.y;
    if (items.length > 0) g2.addChild(...items);
    parent.addChild(g2);
    editable(key, g2);
    if (parent === body && /_(desc|info|hint)$/.test(name)) textGroups.push(g2);
    return g2;
  };
  const grp = (name: string, ...items: Container[]): Container => grpIn(body, name, ...items);
  /** 변형 전용 키 그룹 — 저장값이 없으면 기본 키(fb)의 좌표를 승계 (예: 3×3 그리드가 2×3 값을 물려받음) */
  const grpFb = (name: string, fb: string, ...items: Container[]): Container => {
    const key = ns ? `${ns}_${name}` : name;
    const g2 = new Container();
    const base = ns ? pos(`${ns}_${fb}`, pos(fb, { x: 0, y: 0 })) : pos(fb, { x: 0, y: 0 });
    const gp = pos(key, base);
    g2.x = gp.x;
    g2.y = gp.y;
    if (items.length > 0) g2.addChild(...items);
    body.addChild(g2);
    editable(key, g2);
    return g2;
  };

  // 연습 미니게임 전체 배경판 — 종목별 슬롯. 관문은 자체 배경(renderGate)을 쓰므로 연습(ns)에서만 적용
  // contain-fit: 위아래가 잘리지 않고 아트 전체가 보인다 (cover는 넘치는 부분을 크롭해 상하가 잘림)
  const miniBg = ns ? skinFit(miniBgId(ns, act), W, PH) : null;
  if (miniBg) body.setChildIndex(grp("mini_bg", miniBg), 0); // 맨 뒤 레이어
  const onBg = (c: number): number => miniBg ? INK : c; // 배경판 위 문구는 종목 제목과 같은 색으로 통일

  const desc = (s: string): Text => {
    const d = txt(s, 12, onBg(SUB));
    d.x = 20;
    d.y = 48;
    grp(`${opts.engine}_desc`, d);
    return d; // 변형(스튜디오 등)에서 색 조정용
  };

  // ── A. 가위바위포즈 (3판 2선) ──
  const runRps = (): void => {
    desc("가위바위포즈 · 3판 2선 · 상대 직전 손을 읽어요");
    let round = 0, wins = 0, last: RpsHand | null = null, spinning = false;
    const HANDS: Array<[RpsHand, string, string]> = [[0, "✊", "바위"], [1, "✋", "보"], [2, "✌️", "가위"]];
    const info = txt("1/3 라운드 · 0승", 15, onBg(INK), true);
    info.x = 20;
    info.y = 96;
    grp("rps_info", info);
    const HAND_SLOT: Record<number, string> = { 0: "gate-rps-rock", 1: "gate-rps-paper", 2: "gate-rps-scissors" };
    const HAND_KEY: Record<number, string> = { 0: "rps_hand_rock", 1: "rps_hand_paper", 2: "rps_hand_scissors" };
    const HAND_W = 108, HAND_GAP = 7; // 손 사이 간격 (기존 14에서 절반)
    const handX0 = Math.round((W - (3 * HAND_W + 2 * HAND_GAP)) / 2); // 3개 묶음 가운데 정렬
    HANDS.forEach(([hand, emoji, name], i) => {
      const b = new Container();
      // 손 아트 업로드 시 원본 비율 그대로 (문구 포함 전제 → 이모지·이름 생략), 없으면 기존 벡터 카드
      const art = skinFit(HAND_SLOT[hand] ?? "", 108, 108);
      if (art) {
        b.addChild(art);
      } else {
        const g = new Graphics().roundRect(0, 0, 108, 108, 18).fill(0xf8f4fc).stroke({ width: 2, color: 0xece4f4 });
        const e = txt(emoji, 40, INK);
        e.x = (108 - e.width) / 2;
        e.y = 18;
        const n = txt(name, 12, SUB, true);
        n.x = (108 - n.width) / 2;
        n.y = 74;
        b.addChild(g, e, n);
      }
      b.x = handX0 + i * (HAND_W + HAND_GAP);
      b.y = 180;
      b.eventMode = "static";
      b.cursor = "pointer";
      b.on("pointertap", () => {
        if (spinning) return; // 릴이 도는 동안 추가 입력 무시 — 사운드·연출 싱크 유지
        playCue("slot"); // 손 선택 사운드 — bgm 에디터의 「슬롯 릴 사운드」 재활용 (약 2초)
        const opp = Math.floor(Math.random() * 3) as RpsHand;
        if (rpsBeats(hand, opp)) wins++;
        last = opp;
        round++;
        startSpin(); // 릴 연출이 끝난 뒤 결과 확정 표시 (마지막 라운드 판정 포함)
      });
      grp(HAND_KEY[hand] ?? `rps_hand_${i}`, b); // 손마다 개별 그룹 — 레이아웃 에디터에서 따로 이동
    });

    // 상대 직전 손 — 문구("상대 직전 손: —") 대신 프레임 + 손 아트로 표시 (유저 손 하단).
    // 손 아트는 유저 손 3종 슬롯을 재활용하되, 레이아웃 키는 별도(rps_opp_*)라 유저 손과 독립 이동
    const OPP_FW = 150, OPP_FH = 130, OPP_D = 76;
    const oppFrame = new Container();
    const frameArt = skinNatural("gate-rps-opp-frame", OPP_FW, OPP_FH); // 1배율=원본 크기
    if (frameArt) oppFrame.addChild(frameArt);
    else { // 목업: 라운드 박스 + 캡션 (아트 업로드 시 캡션은 아트에 포함 전제)
      const g = new Graphics().roundRect(0, 0, OPP_FW, OPP_FH, 16).fill(0xf8f4fc).stroke({ width: 2, color: 0xece4f4 });
      const cap = txt("상대 직전 손", 11, SUB, true);
      cap.x = (OPP_FW - cap.width) / 2;
      cap.y = 10;
      oppFrame.addChild(g, cap);
    }
    oppFrame.x = Math.round((W - OPP_FW) / 2);
    oppFrame.y = 310;
    grp("rps_opp_frame", oppFrame);

    // 상대 손 3종 — 유저 손과 같은 방식으로 손마다 별도 컴포넌트 등록 (rps_opp_rock/paper/scissors).
    // 셋 다 미리 만들어 두고 상대가 낸 손만 보이게 토글 — 레이아웃 에디터에서 각각 따로 조정 가능
    const OPP_KEY: Record<number, string> = { 0: "rps_opp_rock", 1: "rps_opp_paper", 2: "rps_opp_scissors" };
    // placeholder 겸 캡션 — 기존 rps_opp_hand 키 유지 (디자이너가 texts 덮어쓰기로 "상대 직전 손모양" 캡션으로 쓰는 중)
    const dash = txt("—", 22, SUB, true);
    dash.x = Math.round(W / 2 - dash.width / 2);
    dash.y = Math.round(310 + 74 - dash.height / 2);
    grp("rps_opp_hand", dash);
    const oppHands: Container[] = HANDS.map(([hand, emoji]) => {
      const node = new Container();
      const art = skinFit(HAND_SLOT[hand] ?? "", OPP_D, OPP_D);
      if (art) {
        art.x = -OPP_D / 2;
        art.y = -OPP_D / 2;
        node.addChild(art);
      } else {
        const e = txt(emoji, 34, INK);
        e.x = -Math.round(e.width / 2);
        e.y = -Math.round(e.height / 2);
        node.addChild(e);
      }
      node.x = Math.round(W / 2); // 기준점=중심 — 세 손 모두 같은 기본 위치(프레임 안), 저장값으로 개별 이동
      node.y = 310 + 74;
      node.visible = false;
      grp(OPP_KEY[hand] ?? `rps_opp_${hand}`, node);
      return node;
    });
    const drawOppHand = (): void => {
      // 문구가 "—" 그대로면 placeholder(첫 라운드 전만), 에디터에서 캡션으로 바꿨으면 상시 표시
      dash.visible = last === null || dash.text !== "—";
      oppHands.forEach((n, i) => { n.visible = last === i; });
    };
    drawOppHand();

    // 슬롯 릴 스핀 — 릴 사운드(약 2초)에 맞춰 세 손을 빠르게 돌리다가 상대가 낸 손에서 멈춘다.
    // 판정(승수·라운드)은 탭 즉시 끝나 있고, 화면 확정·다음 진행만 스핀이 끝난 뒤 한다.
    const SPIN_MS = 2000, SPIN_STEP = 80;
    const startSpin = (): void => {
      spinning = true;
      dash.visible = dash.text !== "—";
      const t0 = performance.now();
      const iv = window.setInterval(() => {
        if (body.destroyed || !body.parent) { clearInterval(iv); return; } // 중도 이탈 — 뷰가 사라짐
        const el = performance.now() - t0;
        if (el < SPIN_MS) {
          const idx = Math.floor(el / SPIN_STEP) % 3;
          oppHands.forEach((n, i) => { n.visible = i === idx; });
          return;
        }
        clearInterval(iv);
        spinning = false;
        drawOppHand(); // 상대가 낸 손으로 확정
        if (round >= 3) { onFinish(rpsGrade(wins)); return; }
        info.text = `${round + 1}/3 라운드 · ${wins}승`;
      }, SPIN_STEP / 2);
    };
  };

  // ── D. 타이밍 STOP (막 비례 다회전) ──
  const runStop = (): void => {
    // 설명 문구 조각 [텍스트, 색] — 로컬라이징 시 여기 문자열만 교체하면 됨 (아트에는 글자를 굽지 않는다)
    const STOP_HINT: Array<[string, number]> = [["분홍 바", HINT_PINK], ["가 중앙에 오면 ", HINT_INK], ["STOP!", HINT_GOLD]];
    const HINT_PARTS: Record<"studio" | "mirror" | "plain", Array<[string, number]>> = {
      studio: STOP_HINT, // 보컬도 알바와 같은 문구·색상 (Director 지시)
      mirror: STOP_HINT, // 캐릭터 고정 + 플레이헤드 왕복 = 알바와 같은 규칙 → 문구도 공용
      plain: STOP_HINT,
    };
    const HINT_Y: Record<"studio" | "mirror" | "plain", number> = { studio: 140, mirror: 84, plain: 126 };
    // 컨셉 변형: studio=보컬(레코딩 스튜디오) · mirror=안무(거울 포즈 매칭) · plain=기본 (알바 등)
    const variant = opts.skin === "studio" ? "studio" : opts.skin === "mirror" ? "mirror" : "plain";
    const rounds = variant === "plain" ? (STOP_ROUNDS[act] ?? 1) : 3; // 보컬·안무는 3회 고정
    const descText = desc(variant === "studio" ? "골든 파형 구간에서 녹음 끊기 — 3테이크 연속"
      : variant === "mirror" ? "게이지 중앙에서 STOP — 3포즈 연속"
        : `타이밍 STOP · ${rounds}회 연속 존 안에서 멈추기`);
    const zones: Array<"perfect" | "good" | "miss"> = [];
    const infoLabel = (n: number): string => variant === "studio" ? `TAKE ${n}/${rounds}` : `${n}/${rounds}회`;
    const info = txt(infoLabel(1), 15, onBg(INK), true);
    info.x = 20;
    info.y = 96;
    grp(`${variant === "plain" ? "stop" : variant}_info`, info);

    // 게임 설명 문구 — 아트에 굽지 않고 코드로 (언어 설정 로컬라이징 대비). 강조 색상은 목업 실측값
    // 조각별 색을 다르게 주려고 Text 여러 개를 가로로 이어 붙인다 (Pixi Text는 부분 색상 미지원)
    const hint = new Container();
    let hx = 0;
    for (const [s, col] of HINT_PARTS[variant]) {
      const part = txt(s, 15, col, true);
      part.x = hx;
      hint.addChild(part);
      hx += part.width;
    }
    hint.x = Math.round((W - hx) / 2); // 문구 길이가 언어마다 달라도 항상 가운데
    hint.y = HINT_Y[variant];
    grp(`${variant === "plain" ? "stop" : variant}_hint`, hint);

    let markerPos = 0, dir = 1;
    const speed = tuning.stopSpeedBase + act * tuning.stopSpeedPerAct; // 막이 오를수록 빨라짐 (타이밍 튜닝 에디터로 조정)
    // 변형별 시각 구성 — setMarker(위치 반영)·fxPoint(판정 이펙트 좌표)·anchor(이펙트 부모)만 공용 계약
    let setMarker: (pos: number) => void;
    let fxPoint: () => { x: number; y: number };
    let anchor: Container;
    let alive: () => boolean;

    if (variant === "mirror") {
      // ── 안무 연습: 캐릭터는 중앙 고정(영상 재생만), 게이지 트랙의 플레이헤드만 좌우로 왕복 ──
      const MW = 310, MH = 380;
      const mirror = new Container();
      mirror.x = (W - MW) / 2;
      mirror.y = 116;
      // 캐릭터 — 안무 연습 전용 슬롯(영상 가능) 우선, 없으면 캐릭터 에디터의 무대의상 시퀀스/단일 아트
      const charTex = skinTexTrim("gate-mirror-char");
      const frames = charTex ? [] : (opts.poseFrames ?? []);
      const baseTex = charTex ?? frames[0] ?? opts.poseTex ?? null;
      const P_H = MH - 56;
      // 전용 슬롯 사용 시 에디터 배율 반영 (skinTexTrim은 원본 텍스처라 배율이 자동 적용되지 않는다)
      const charScale = charTex ? skinScale("gate-mirror-char") : 1;
      const mkPose = (): Container => {
        if (frames.length > 1) { // 시퀀스 업로드 시 애니 재생
          const a = new AnimatedSprite(frames);
          a.animationSpeed = 8 / 60; // 로비·카드와 동일 8fps
          a.play();
          a.scale.set(P_H / (frames[0] as Texture).height);
          return a;
        }
        if (baseTex) {
          const sp2 = new Sprite(baseTex);
          sp2.scale.set((P_H / baseTex.height) * charScale);
          return sp2;
        }
        return new Container(); // 무대의상 미업로드 — 미표시 (빈 슬롯 숨김)
      };
      const poseW = baseTex ? (P_H / baseTex.height) * charScale * baseTex.width : 60;
      const poseH = P_H * charScale;
      const pose = mkPose();
      // 중앙 고정 + 발밑 기준 — 배율을 키우면 위로 자라서 게이지 트랙을 밀지 않는다.
      // 마스크(거울 프레임 크롭)는 제거 — 좌우로 드나드는 포즈가 없어져 잘라낼 이유가 사라졌다
      pose.x = (MW - poseW) / 2;
      pose.y = MH - 28 - poseH;
      const inner = new Container();
      inner.addChild(pose);
      const charBox = new Container(); // 캐릭터 영역 — 에디터에서 통째로 이동
      charBox.addChild(inner);
      // 게이지 트랙 (거울 아래) — 보컬 파형 트랙과 동일: 폭 300 고정, 높이는 아트 비율
      const BAR_W = 300, BAR_Y = MH + 12;
      const barTex = skinTexTrim("gate-mirror-track");
      const BAR_H = barTex ? Math.round(BAR_W * (barTex.height / barTex.width)) : 14;
      const bar = skinNode("gate-mirror-track", BAR_W, BAR_H)
        ?? new Graphics().roundRect(0, 0, BAR_W, BAR_H, 7).fill(0xffffff).stroke({ width: 1.5, color: 0xb9c4da });
      bar.x = (MW - BAR_W) / 2;
      bar.y = BAR_Y;
      const barBox = new Container(); // 게이지 트랙 — 에디터에서 캐릭터·마커와 따로 이동
      barBox.addChild(bar);
      if (!barTex) { // 존 표시 — 트랙 아트에 이미 구워져 있으면 벡터로 겹쳐 그리지 않는다
        const zoneG = new Graphics()
          .rect(BAR_W * 0.32, 0, BAR_W * 0.36, BAR_H).fill({ color: 0x6fd8c4, alpha: 0.3 })
          .rect(BAR_W * 0.44, 0, BAR_W * 0.12, BAR_H).fill({ color: 0xf0c05a, alpha: 0.6 });
        zoneG.x = bar.x;
        zoneG.y = BAR_Y;
        barBox.addChild(zoneG);
      }
      // 플레이헤드 마커 — 보컬과 동일 (전용 슬롯 → 없으면 벡터 커서)
      const headSkin = skinNode("gate-mirror-head", 8, 34);
      if (headSkin) { headSkin.pivot.set(4, 17); headSkin.y = BAR_Y + BAR_H / 2; } // 아트 중심을 트랙 중앙에
      const cursor = headSkin ?? new Graphics().roundRect(-2, -3, 4, BAR_H + 6, 2).fill(0x7f5fd4);
      if (!headSkin) cursor.y = BAR_Y;
      barBox.addChild(cursor); // 플레이헤드는 게이지 트랙과 한 몸 — 트랙을 옮기면 마커도 함께 이동
      anchor = grp("mirror_track", mirror);       // 무대 전체 앵커
      grpIn(mirror, "mirror_char", charBox);      // 캐릭터 영역
      grpIn(mirror, "mirror_bar", barBox);        // 게이지 트랙 + 플레이헤드
      setMarker = (p) => { cursor.x = bar.x + (BAR_W * p) / 100; }; // 플레이헤드만 이동
      fxPoint = () => ({ x: mirror.x + cursor.x, y: mirror.y + BAR_Y + BAR_H / 2 });
      alive = () => !!mirror.parent && !!body.parent; // 화면 전환 감지 — 관문(자식 교체)·연습(body 교체) 양쪽 대응
    } else {
      // ── 트랙 바 계열: plain=기존 파스텔 바 · studio=어두운 부스+파형+플레이헤드 ──
      const studio = variant === "studio";
      const track = new Container();
      track.x = 47;
      track.y = studio ? 176 : 160;
      // 트랙 높이는 업로드 아트 비율을 따름 (폭 300 고정 → 원본 무왜곡, 미업로드 시 기존 벡터 높이)
      const trackId = studio ? "gate-rec-wave" : "gate-stop-track";
      const trackTex = skinTexTrim(trackId);
      const TRACK_W = 300;
      const TRACK_H = trackTex ? Math.round(TRACK_W * (trackTex.height / trackTex.width)) : (studio ? 56 : 26);
      if (studio) { // 녹음 부스 무드 — 게임 영역 전체를 어두운 부스로 (목업과 동일) + ● REC 램프 (깜빡임)
        if (!miniBg) { // 배경판 업로드 시 벡터 부스는 생략 (아트가 부스 역할)
          const booth = new Graphics().roundRect(8, 40, W - 16, 520, 18).fill(0x241c33).stroke({ width: 2, color: 0x3d3157 });
          body.setChildIndex(grp("rec_booth", booth), 0); // 맨 뒤 레이어 — desc·info 등 기존 텍스트 위로
          descText.style.fill = 0xa996c8;
          info.style.fill = 0xc9b6e6;
        }
        const lamp = txt("● REC", 13, 0xff5470, true);
        lamp.x = W - lamp.width - 34;
        lamp.y = 54;
        grp("rec_lamp", lamp);
        let acc = 0;
        const blink = (): void => {
          if (!lamp.parent) { ticker.remove(blink); return; }
          acc += ticker.deltaMS;
          lamp.alpha = acc % 1100 < 550 ? 1 : 0.25;
        };
        ticker.add(blink);
      }
      const tbg = skinNode(trackId, TRACK_W, TRACK_H) // 박스가 아트 비율과 같으므로 stretch = 균일 스케일
        ?? (studio ? mkWaveform(TRACK_W, TRACK_H)
          : new Graphics().roundRect(0, 0, TRACK_W, TRACK_H, 13).fill(0xf1eaf6).stroke({ width: 2, color: 0xece4f4 }));
      // GOOD·PERFECT 존 표시 — 트랙 아트에 이미 구워져 있으면 벡터로 겹쳐 그리지 않는다 (판정 로직은 무관)
      const zoneGs: Graphics[] = trackTex ? [] : [
        new Graphics().rect(TRACK_W / 2 - TRACK_W * 0.18, 0, TRACK_W * 0.36, TRACK_H)
          .fill({ color: studio ? 0xf0c05a : 0x6fd8c4, alpha: studio ? 0.14 : 0.3 }),
        studio
          ? new Graphics().rect(TRACK_W / 2 - TRACK_W * 0.06, 0, TRACK_W * 0.12, TRACK_H).fill({ color: 0xf0c05a, alpha: 0.28 })
            .rect(TRACK_W / 2 - TRACK_W * 0.06, 0, 2, TRACK_H).fill(0xffd35e)
            .rect(TRACK_W / 2 + TRACK_W * 0.06 - 2, 0, 2, TRACK_H).fill(0xffd35e)
          : new Graphics().rect(TRACK_W / 2 - TRACK_W * 0.06, 0, TRACK_W * 0.12, TRACK_H).fill({ color: 0xf0c05a, alpha: 0.55 }),
      ];
      const markerSkin = skinNode(studio ? "gate-rec-head" : "gate-stop-marker", studio ? 12 : 8, studio ? 70 : 34);
      if (markerSkin) {
        if (studio) markerSkin.pivot.set(6, 4); // 벡터 마커의 중심 기준과 일치
        else { markerSkin.pivot.set(4, 17); markerSkin.y = TRACK_H / 2; } // 알바: 아트 중심을 트랙 중앙에 (원본 크기 유지)
      }
      const marker = markerSkin ?? (studio
        ? new Graphics().roundRect(-1.5, -8, 3, TRACK_H + 16, 2).fill(0xff5470)
          .poly([-7, -8, 7, -8, 0, 0]).fill(0xff5470)
        : new Graphics().roundRect(-2, -4, 4, 34, 2).fill(PINK));
      track.addChild(tbg, ...zoneGs);
      anchor = grp(studio ? "rec_track" : "stop_track", track);
      // 마커는 별도 그룹 — 매 프레임 x를 덮어쓰므로 에디터 위치는 그룹 오프셋으로 받는다 (트랙과 따로 조정)
      const markerG = grpIn(track, studio ? "rec_head" : "stop_marker", marker);
      setMarker = (p) => { marker.x = (TRACK_W * p) / 100; };
      fxPoint = () => ({ x: track.x + markerG.x + marker.x, y: track.y + markerG.y + TRACK_H / 2 });
      alive = () => !!track.parent && !!body.parent; // 화면 전환 감지 — 관문(자식 교체)·연습(body 교체) 양쪽 대응
    }

    const cleanup = (): void => {
      ticker.remove(tick);
      window.removeEventListener("keydown", onKey);
    };
    const tick = (): void => {
      if (!alive()) { cleanup(); return; } // 화면 제거 시 정리
      markerPos += dir * speed;
      if (markerPos >= 100) { markerPos = 100; dir = -1; }
      if (markerPos <= 0) { markerPos = 0; dir = 1; }
      setMarker(markerPos);
    };
    ticker.add(tick);

    const doStop = (): void => {
      const zone = stopZone(Math.abs(markerPos - 50));
      zones.push(zone);
      if (zone !== "miss") { // 판정 하이라이트 — 리듬게임과 동일 조합: 팝 문구 + 링 파동, perfect=+스파클 버스트
        const p = fxPoint();
        const pop = txt(zone === "perfect" ? "PERFECT" : "GOOD", 15, zone === "perfect" ? 0x3fb98a : 0xf0a93a, true);
        pop.x = p.x - pop.width / 2;
        pop.y = p.y - 34;
        anchor.addChild(pop);
        setTimeout(() => { pop.parent?.removeChild(pop); }, 420);
        fxRing(anchor, p.x, p.y, ticker);
        if (zone === "perfect") fxBurst(anchor, p.x, p.y, ticker);
      }
      if (zone === "miss") { cleanup(); onFinish(null); return; }
      if (zones.length >= rounds) { cleanup(); onFinish(stopGrade(zones)); return; }
      info.text = `${infoLabel(zones.length + 1)} · ${zones.join(" · ")}`;
    };
    // 테스트 편의: 스페이스바 = STOP
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === "Space") { e.preventDefault(); doStop(); }
    };
    window.addEventListener("keydown", onKey);

    if (variant === "studio") {
      // START 버튼 — 업로드 아트는 원본 크기 그대로(문구 포함 전제), 없으면 기존 벡터 원형 버튼 + 라벨
      const recSkin = skinNode("gate-rec-btn", W, 88); // natural 슬롯 → 1배율=원본 px, 패널 폭 기준 중앙
      let rb: Container;
      if (recSkin) {
        rb = recSkin;
      } else {
        rb = new Container();
        const rg = new Graphics()
          .circle(44, 44, 44).fill(0x2c2440).stroke({ width: 3, color: 0x584a7d })
          .roundRect(31, 31, 26, 26, 5).fill(0xff5470);
        const lbl = txt("STOP  (Space)", 11, SUB, true);
        lbl.x = 44 - lbl.width / 2;
        lbl.y = 92;
        rb.addChild(rg, lbl);
        rb.x = (W - 88) / 2;
      }
      rb.y = 336;
      pressable(rb, doStop, { immediate: true }); // 판정 시점 = 탭 순간
      grp("rec_btn", rb);
    } else if (variant === "mirror") {
      // 업로드 아트에 문구가 들어있으므로 스킨이 있으면 라벨을 덧그리지 않는다
      const holdSkin = skinNode("gate-mirror-btn", W, 52); // 원본 크기 유지 + 패널 폭 기준 중앙 정렬
      let stopBtn: Container;
      if (holdSkin) {
        pressable(holdSkin, doStop, { immediate: true });
        stopBtn = holdSkin;
      } else {
        stopBtn = btn("STOP  (Space)", 160, LAV, doStop, "gate-btn", { immediate: true }); // 아트 미업로드 시 폴백 — 문구 통일
        stopBtn.x = (W - 160) / 2;
      }
      stopBtn.y = 540;
      grp("mirror_btn", stopBtn);
    } else {
      // 업로드 아트에 STOP·SPACE 문구가 들어있으므로 스킨이 있으면 라벨을 덧그리지 않는다
      const btnSkin = skinNode("gate-stop-btn", W, 64); // 원본 크기 유지 + 패널 폭 기준 중앙 정렬
      let stopBtn: Container;
      if (btnSkin) {
        pressable(btnSkin, doStop, { immediate: true });
        stopBtn = btnSkin;
      } else {
        stopBtn = btn("STOP  (Space)", 160, PINK, doStop, "gate-btn", { immediate: true });
        stopBtn.x = (W - 160) / 2;
      }
      stopBtn.y = 250;
      grp("stop_btn", stopBtn);
    }
  };

  /** 스튜디오 파형 폴백 (gate-rec-wave 미업로드 시) — 어두운 트랙 + 결정적 높이의 바 */
  const mkWaveform = (w: number, h: number): Container => {
    const c = new Container();
    c.addChild(new Graphics().roundRect(0, 0, w, h, 10).fill(0x171226).stroke({ width: 1.5, color: 0x3d3157 }));
    const bars = new Graphics();
    const N = 34;
    const bw = (w - 16) / N;
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const inGold = t > 0.38 && t < 0.62;
      const hgt = h * (0.28 + 0.34 * Math.abs(Math.sin(i * 2.7)) + (inGold ? 0.14 : 0));
      bars.roundRect(8 + i * bw + 1, (h - hgt) / 2, bw - 2.5, hgt, 2).fill(inGold ? 0xffd35e : 0x6a5a94);
    }
    c.addChild(bars);
    return c;
  };

  // ── B. 짝맞추기 (막 비례 카드 수, 홀수=조커) ──
  const runMatch = (): void => {
    const count = MATCH_CARDS[act] ?? 6;
    const symbols = opts.skin === "clue"
      ? ["📅", "📹", "💬", "🧾", "🗂", "🔑", "📱", "✉️"]
      : opts.skin === "promo"
        ? ["📸", "📱", "💗", "🔁", "💬", "🎬", "🔔", "✨"]
        : ["🌙", "⭐", "🎤", "💿", "🎀", "📸", "💜", "🎧"];
    desc(`짝맞추기 · ${count}장 · 적게 틀릴수록 고득점`);
    const deck = buildMatchDeck(count, symbols, Math.random);
    let misses = 0, matched = 0, lock = false;
    const totalPairs = Math.floor(count / 2);
    const info = txt("틀림 0", 13, onBg(SUB), true);
    info.x = 20;
    info.y = 92;
    grp("match_info", info);
    // 6장(2×3)과 9장(3×3)은 배치가 달라 좌표를 따로 저장한다 — 9장 키는 미저장 시 6장 값을 승계
    const g3 = count > 6;
    const gridName = g3 ? "match_grid_3x3" : "match_grid";
    const gridGrp = g3 ? grpFb(gridName, "match_grid") : grp("match_grid");

    // 심볼 공통 오프셋 — 카드마다 같은 자리라 대표 1장만 에디터에 등록하고 나머지는 같은 좌표를 따른다
    const symName = g3 ? "match_sym_3x3" : "match_sym";
    const symKey = ns ? `${ns}_${symName}` : symName;
    const symPos = (def: { x: number; y: number }): { x: number; y: number } =>
      pos(symKey, g3 ? pos(ns ? `${ns}_match_sym` : "match_sym", pos("match_sym", def))
        : (ns ? pos("match_sym", def) : def));
    let symRegistered = false;

    const cols = count <= 9 ? 3 : 4;
    const cw = cols === 3 ? 92 : 76;
    const gap = 5; // 카드 간 상하·좌우 간격 (기존 10에서 절반 — 프레임 밖으로 삐져나오지 않게)
    const gx = (W - cols * cw - (cols - 1) * gap) / 2;

    interface MCard { sym: string; face: Text; skin: Container | null; front: Container | null; back: Container | null; hasBack: boolean; base: Graphics; c: Container; st: "down" | "up" | "done"; }
    const open: MCard[] = [];
    const setFace = (mc: MCard, s: string): void => {
      const isBack = s === "?";
      // 카드 프레임 스킨(gate-match-card / -back) 업로드 시 상태별 교체 — 없는 상태는 벡터 폴백
      if (mc.back) mc.back.visible = isBack;
      if (mc.front) mc.front.visible = !isBack;
      mc.base.visible = isBack ? !mc.back : !mc.front;
      const showSkin = !isBack && !!mc.skin; // 심볼 스킨(gate-match-sym-N) 있으면 공개 시 이미지
      if (mc.skin) mc.skin.visible = showSkin;
      mc.face.visible = !showSkin && !(isBack && mc.hasBack); // 전용 뒷면 아트가 있을 때만 ? 텍스트 생략
      if (!mc.face.visible) return;
      mc.face.text = s;
      mc.face.x = (cw - mc.face.width) / 2;
    };
    // 좌우 회전 뒤집기 — scale.x 1→0(면 교체)→1, 카드 중심 피벗 기준
    const flip = (mc: MCard, s: string): void => {
      const c = mc.c;
      const DUR = 220;
      const t0 = performance.now();
      let swapped = false;
      const step = (now: number): void => {
        if (c.destroyed) return;
        const t = Math.min(1, (now - t0) / DUR);
        // 앞 반바퀴 가속 · 뒤 반바퀴 감속 — 카드덱 뒤집기와 같은 감각
        c.scale.x = Math.max(0.02, t < 0.5 ? 1 - easeIn(t * 2) : easeOut(t * 2 - 1));
        if (t >= 0.5 && !swapped) { swapped = true; setFace(mc, s); }
        if (t < 1) requestAnimationFrame(step);
        else c.scale.x = 1;
      };
      requestAnimationFrame(step);
    };

    deck.forEach((sym, i) => {
      const c = new Container();
      const g = new Graphics().roundRect(0, 0, cw, cw * 1.2, 12).fill(0xefe7fb).stroke({ width: 2, color: 0xece4f4 });
      // 카드 앞/뒷면 — 원본 비율 유지(무왜곡). 전용 뒷면 아트가 없으면 앞면 프레임을 뒷면으로도 재사용
      const front = skinFit("gate-match-card", cw, cw * 1.2);
      const backArt = skinFit("gate-match-card-back", cw, cw * 1.2);
      const back = backArt ?? skinFit("gate-match-card", cw, cw * 1.2);
      const face = txt("?", 26, SUB, true);
      face.y = cw * 0.4;
      c.addChild(g);
      if (front) c.addChild(front);
      if (back) c.addChild(back);
      c.addChild(face);
      // 심볼 — 원본 비율 유지(skinFit). 크기는 에디터 배율로 조정, 위치는 match_sym 키 하나로 전 카드 공통
      const symIdx = symbols.indexOf(sym);
      const symArt = symIdx >= 0 ? skinFit(`gate-match-sym-${symIdx + 1}`, 44, 44) : null;
      let skin: Container | null = null;
      if (symArt) {
        const symG = new Container();
        const sp = symPos({ x: (cw - 44) / 2, y: (cw * 1.2 - 44) / 2 });
        symG.x = sp.x;
        symG.y = sp.y;
        symG.addChild(symArt);
        symG.visible = false;
        c.addChild(symG);
        skin = symG;
        if (!symRegistered) { editable(symKey, symG); symRegistered = true; } // 대표 1장만 등록 (전 카드 동일 오프셋)
      }
      // 뒤집기 회전축 = 카드 중심 (피벗 보정만큼 위치도 이동)
      c.pivot.set(cw / 2, cw * 0.6);
      c.x = gx + (i % cols) * (cw + gap) + cw / 2;
      c.y = 118 + Math.floor(i / cols) * (cw * 1.2 + gap) + cw * 0.6;
      c.eventMode = "static";
      c.cursor = "pointer";
      const mc: MCard = { sym, face, skin, front, back, hasBack: !!backArt, base: g, c, st: "down" };
      setFace(mc, "?");
      c.on("pointertap", () => {
        if (lock || mc.st !== "down") return;
        mc.st = "up";
        flip(mc, sym);
        if (sym === JOKER) { mc.st = "done"; c.alpha = 0.45; return; } // 조커 = 단독 매칭
        open.push(mc);
        if (open.length < 2) return;
        lock = true;
        const [a, b] = open;
        if (a && b && a.sym === b.sym) {
          matched++;
          // 짝 성공 → 두 카드 위에서 라이트 블룸 (그리드 그룹 좌표 — 드래그 추종, 피벗 보정으로 c.x/y가 이미 중심)
          for (const o of [a, b]) fxBloom(gridGrp, o.c.x, o.c.y, ticker);
          setTimeout(() => {
            [a, b].forEach((o) => { o.st = "done"; o.c.alpha = 0.45; });
            open.length = 0;
            lock = false;
            if (matched >= totalPairs) { // 클리어 → 컨페티 (성적 무관) 후 결과로
              fxConfetti(body, ticker, W);
              setTimeout(() => onFinish(matchGrade(misses)), 1100);
            }
          }, 300);
        } else {
          misses++;
          info.text = `틀림 ${misses}`;
          setTimeout(() => {
            [a, b].forEach((o) => { if (o) { o.st = "down"; flip(o, "?"); } });
            open.length = 0;
            lock = false;
          }, 550);
        }
      });
      gridGrp.addChild(c);
    });
  };

  // ── E. 포토카드 촬영 (스테이지) — 뷰파인더 3분할 컷 + 연속촬영 3컷, 재촬영 포함 총 3회 ──
  const runSlot = (): void => {
    const ICONS = opts.skin === "photo" ? ["👧", "✨", "💖", "🎵", "🌟"] : ["🎤", "🎵", "👠"]; // 심볼 5종, [0]=하루 — 판정(3일치 PERFECT/2일치 GOOD)·기회 3회는 동일
    // 하루(심볼 1) 가중 추첨 — 하루 30%, 나머지 4종 각 17.5%. 1컷 하루 보장과 합쳐 PERFECT 9% · GOOD 54.3% · CLEAR 36.8%
    const HARU_W = 0.3;
    const pickSym = (): number => {
      if (opts.skin !== "photo") return Math.floor(Math.random() * ICONS.length);
      if (Math.random() < HARU_W) return 0;
      return 1 + Math.floor(Math.random() * (ICONS.length - 1));
    };
    const descText = desc("셔터를 누르면 3컷 연속촬영 · 마음에 들면 획득, 아니면 재촬영 (총 3회 · Space=촬영)");
    let spins = SLOT_SPINS;
    let shooting = false;
    let grade: MiniGameGrade | null = null;

    // 배경판 비율 스케일 — 600 기준 y·394 기준 x 상수를 실제 패널(W×PH)에 비례 배치
    const kx = W / MG_W;
    const ky = PH / MG_H;
    // 전체 배경판 (gate-photo-board) — 텍스트 없는 아트 전제: 벡터 파인더는 생략하고 텍스트는 아트 위치에 코드로 작성
    // 패널(W×PH)이 renderGate에서 아트 비율로 잡혀 있어 스트레치 왜곡 없음
    const board = skinNode("gate-photo-board", W, PH);
    if (board) {
      body.setChildIndex(grp("gate_photo_board", board), 0); // 맨 뒤 레이어 + 에디터 등록 (dodge_board와 동일 패턴)
      // 안내문을 아트의 설명 필 위치(헤더 하단 중앙)로 — 미세조정은 레이아웃 에디터(slot_desc)
      descText.text = "3장의 포토를 맞춰 포토카드를 획득하세요";
      descText.style.fontSize = 13;
      descText.x = (W - descText.width) / 2;
      descText.y = Math.round(160 * ky);
    }

    // '남은 기회' 필
    const header = new Container();
    if (!board) header.addChild(new Graphics().roundRect(W / 2 - 78, 104, 156, 34, 17).fill(0xfbf9fe).stroke({ width: 2, color: 0xb9a8d8 }));
    const pipT = txt("", 14, board ? 0xf6e8d2 : INK, true); // 배경판의 어두운 탭 위에선 크림색 (패널 톤과 통일)
    pipT.y = 112;
    header.addChild(pipT);
    grp("slot_pips", header);
    const refreshPips = (): void => {
      pipT.text = `남은 기회 ${spins}`;
      // 배경판 아트 사용 시 아트의 필 위치(우상단)에 정렬 — 세부 조정은 레이아웃 에디터(slot_pips)
      if (board) {
        pipT.x = Math.round(308 * kx) - pipT.width / 2;
        pipT.y = Math.round(234 * ky);
      } else {
        pipT.x = (W - pipT.width) / 2;
      }
    };

    // 폴라로이드 3장 — 뷰파인더 위, 연속촬영 시 한 장씩 등장
    const SHOT_W = 74, SHOT_H = 92, SHOT_Y = Math.round(146 * ky);
    const shotsGrp = grp("slot_shots");

    // 뷰파인더 — 어두운 파인더 + 코너 브래킷 + REC + 3분할 컷
    // 좌표는 배경판 아트의 스크린 영역 실측값 기준 (아트 1080×1300의 스크린 bbox → MG 기준 환산)
    // 우측 경계는 카메라 세부 버튼 열(아트 x≈908~) 왼쪽까지 — 버튼이 가려지지 않게
    const VF = { x: Math.round(40 * kx), y: Math.round(220 * ky), w: W - Math.round(106 * kx), h: Math.round(244 * ky) };
    const vfGrp = grp("slot_reels"); // 기존 레이아웃 키 유지 (에디터 저장 오프셋 호환)
    const vf = new Container();
    vf.x = VF.x;
    vf.y = VF.y;
    vfGrp.addChild(vf);
    const rec = new Graphics().circle(VF.w - 30, 22, 5).fill(0xff5470);
    if (!board) { // 배경판 아트가 있으면 다크 파인더·브래킷·REC은 아트에 구워진 전제
      vf.addChild(new Graphics().roundRect(0, 0, VF.w, VF.h, 16).fill(0x2a2140).stroke({ width: 2.5, color: 0x4a3a68 }));
      const bk = new Graphics(); // 코너 브래킷 4개
      const BL = 22;
      const corner = (x: number, y: number, dx: number, dy: number): void => {
        bk.moveTo(x + dx * BL, y).lineTo(x, y).lineTo(x, y + dy * BL);
      };
      corner(10, 10, 1, 1);
      corner(VF.w - 10, 10, -1, 1);
      corner(10, VF.h - 10, 1, -1);
      corner(VF.w - 10, VF.h - 10, -1, -1);
      bk.stroke({ width: 3, color: 0xffffff, alpha: 0.8 });
      vf.addChild(bk, rec);
    }

    // 3분할 컷 프레임 — 스킨은 3칸 통짜 스트립(contain-fit, 늘리지 않음), 없으면 칸별 벡터 라인
    let cellX0 = Math.round(18 * kx);
    let cellY = Math.round(28 * ky);
    let cellW = (VF.w - cellX0 * 2 - Math.round(10 * kx) * 2) / 3;
    let cellH = VF.h - Math.round(56 * ky);
    let stepX = cellW + Math.round(10 * kx);
    const stripT = skinTexTrim("gate-slot-reel");
    if (stripT) {
      const fs = Math.min((VF.w - 8) / stripT.width, (VF.h - 8) / stripT.height) * skinScale("gate-slot-reel"); // 뷰파인더 안 여백 4px + 에디터 배율
      const sp = new Sprite(stripT);
      sp.scale.set(fs);
      sp.x = (VF.w - stripT.width * fs) / 2;
      sp.y = (VF.h - stripT.height * fs) / 2;
      vf.addChild(sp);
      cellW = (stripT.width * fs) / 3; // 스트립 = 3칸 등분
      stepX = cellW;
      cellX0 = sp.x;
      cellY = sp.y;
      cellH = stripT.height * fs;
    }
    const cellCx = (i: number): number => cellX0 + i * stepX + cellW / 2;
    const cellCy = cellY + cellH / 2;
    const cutIcons: Text[] = [];
    const cutSyms: Array<Array<Container | null>> = []; // 컷×심볼 스킨 (gate-slot-sym-N contain-fit, 없으면 이모지 폴백)
    for (let i = 0; i < 3; i++) {
      if (!stripT) {
        const frame = new Graphics().roundRect(0, 0, cellW, cellH, 10).stroke({ width: 2, color: 0xffffff, alpha: 0.4 });
        frame.x = cellX0 + i * stepX;
        frame.y = cellY;
        vf.addChild(frame);
      }
      const ic = txt("", 40, 0xffffff);
      vf.addChild(ic);
      cutIcons.push(ic);
      const syms: Array<Container | null> = [];
      for (let n = 0; n < ICONS.length; n++) {
        const sk = skinFit(`gate-slot-sym-${n + 1}`, cellW * 0.65, cellH * 0.65); // 비율 유지 — 컷의 65% (스트립 셀 확대분 상쇄 + 10% 축소)
        if (sk) {
          sk.x = cellCx(i) - cellW * 0.325;
          sk.y = cellCy - cellH * 0.325;
          sk.visible = false;
          vf.addChild(sk);
        }
        syms.push(sk);
      }
      cutSyms.push(syms);
    }
    const setIcon = (i: number, n: number): void => {
      const ic = cutIcons[i];
      if (!ic) return;
      const syms = cutSyms[i] ?? [];
      syms.forEach((sp, k) => { if (sp) sp.visible = k === n; });
      if (syms[n]) { ic.visible = false; return; }
      ic.visible = true;
      ic.text = ICONS[n] ?? "";
      ic.x = cellCx(i) - ic.width / 2;
      ic.y = cellCy - ic.height / 2;
    };
    for (let i = 0; i < 3; i++) setIcon(i, i);

    // 레이아웃 에디터 토글 = 리드로우 생략 — 촬영·판정 상태(확정 컷·폴라로이드·버튼) 유지한 채 조정
    setEditorToggleHook(() => true);

    // 셔터 전·촬영 중 컷 심볼 고속 교체 + REC 점멸 — 확정(settled) 컷은 유지
    const settled = [false, false, false];
    let cycleAcc = 0;
    const idle = (): void => {
      // 화면 제거 시 정리 — 패널이 스테이지에서 내려간 경우(부모의 부모까지 확인)도 포함해 훅 잔존 방지
      if (!body.parent || !body.parent.parent) { ticker.remove(idle); cleanupKeys(); stopCue("slot"); setEditorToggleHook(null); return; }
      rec.alpha = performance.now() % 1100 < 550 ? 1 : 0.25;
      cycleAcc += ticker.deltaMS;
      if (cycleAcc < 90) return;
      cycleAcc = 0;
      if (grade !== null) return; // 판정 후엔 확정 컷 유지
      for (let i = 0; i < 3; i++) if (!settled[i]) setIcon(i, pickSym());
    };
    ticker.add(idle);

    // 찰칵 플래시 — 뷰파인더 전체 화이트 후 페이드
    const flash = (): void => {
      const f = new Graphics().roundRect(0, 0, VF.w, VF.h, 16).fill(0xffffff);
      f.alpha = 0;
      vf.addChild(f);
      const t0 = performance.now();
      const step = (now: number): void => {
        if (f.destroyed) return;
        const k = (now - t0) / 420;
        if (k >= 1) { f.destroy(); return; }
        f.alpha = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88;
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    // 폴라로이드 팝 — 촬영 순서대로 뷰파인더 위에 한 장씩
    const addShot = (i: number, n: number): void => {
      const card = new Container();
      card.pivot.set(SHOT_W / 2, SHOT_H / 2);
      card.x = W / 2 + (i - 1) * (SHOT_W + 12);
      card.y = SHOT_Y + SHOT_H / 2;
      card.rotation = (i - 1) * 0.09;
      // 폴라로이드 프레임 — 디자이너 아트(gate-polaroid, 비율 유지) 우선, 없으면 벡터 (결과 표시라 항상 그림)
      const frame = skinFit("gate-polaroid", SHOT_W, SHOT_H);
      if (frame) {
        card.addChild(frame);
      } else {
        card.addChild(
          new Graphics().roundRect(0, 0, SHOT_W, SHOT_H, 6).fill(0xffffff),
          new Graphics().roundRect(7, 7, SHOT_W - 14, SHOT_H - 30, 4).fill(0xf3edfa),
        );
      }
      // 심볼 — 흰 사진 영역 하단에 캐릭터 하단 정렬 (폴라로이드 아트 실측: 사진 하단 ≈ y73/92, 벡터는 y65)
      const symT = skinTexTrim(`gate-slot-sym-${n + 1}`);
      if (symT) {
        const bw = SHOT_W - 16;
        const bh = SHOT_H - 34;
        const ss = Math.min(bw / symT.width, bh / symT.height) * skinScale(`gate-slot-sym-${n + 1}`); // 비율 유지 + 에디터 배율
        const spr = new Sprite(symT);
        spr.scale.set(ss);
        spr.x = 8 + (bw - symT.width * ss) / 2;
        spr.y = (frame ? 73 : 65) - symT.height * ss;
        card.addChild(spr);
      } else {
        const t = txt(ICONS[n] ?? "", 28, INK);
        t.x = (SHOT_W - t.width) / 2;
        t.y = 16;
        card.addChild(t);
      }
      shotsGrp.addChild(card);
      shotsGrp.parent?.addChild(shotsGrp); // 최상단 재부상 — 뒤에 그려진 판정 문구·버튼에 가리지 않게
      const t0 = performance.now();
      const step = (now: number): void => {
        if (card.destroyed) return;
        const k = Math.min(1, (now - t0) / 320);
        card.scale.set(k < 0.7 ? 0.5 + (k / 0.7) * 0.62 : 1.12 - ((k - 0.7) / 0.3) * 0.12);
        card.alpha = Math.min(1, k * 2);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    // 판정 문구 (PERFECT 등) — 뷰파인더 아래 중앙. 배경판(어두운 카메라 바디) 위에선 흰 글자+그림자
    const resT = txt("", 17, board ? 0xffffff : INK, true);
    if (board) resT.style.dropShadow = { color: 0x3b2f4d, blur: 4, distance: 0, angle: 0, alpha: 0.8 };
    resT.y = Math.round(448 * ky);
    const resStamp = new Container(); // 등급 스탬프 자리 (grade-* 업로드 시 텍스트 대신 이미지)
    resStamp.y = Math.round(436 * ky);
    grp("slot_result", resT, resStamp);

    const btnRow = new Container();
    btnRow.y = Math.round(490 * ky);
    grp("slot_btns", btnRow);

    // 캡슐 버튼 (목업 스타일 — 흰 테두리 + 상단 하이라이트)
    const mkCap = (label: string, w: number, color: number, onTap: () => void): Container => {
      const b = new Container();
      b.addChild(
        new Graphics().roundRect(0, 0, w, 56, 28).fill(color).stroke({ width: 3, color: 0xffffff }),
        new Graphics().roundRect(8, 6, w - 16, 20, 12).fill({ color: 0xffffff, alpha: 0.32 }),
      );
      const t = new Text({ text: label, style: { fontSize: 18, fill: 0xffffff, fontWeight: "bold" } });
      t.x = (w - t.width) / 2;
      t.y = (56 - t.height) / 2;
      b.addChild(t);
      b.eventMode = "static";
      b.cursor = "pointer";
      b.on("pointertap", onTap);
      return b;
    };

    const cleanupKeys = (): void => window.removeEventListener("keydown", onKey);

    // SHOOT(찰칵) 버튼 — 항상 표시 (판정 중엔 비활성). gate-cam-btn 스킨 업로드 시 교체
    const camSkin = skinFit("gate-cam-btn", 240, 84); // 비율 유지 (기존 에셋 — 표시 크기 fit)
    const onShootTap = (): void => { if (grade === null) doShoot(); }; // 판정 표시 중엔 무동작 (재촬영 버튼 전용)
    let shootBtn: Container;
    if (camSkin) {
      camSkin.eventMode = "static";
      camSkin.on("pointertap", onShootTap);
      shootBtn = camSkin;
    } else {
      shootBtn = mkCap("📸 찰칵!  (Space)", 240, 0xff6f9f, onShootTap);
    }
    shootBtn.x = (W - 240) / 2;
    btnRow.addChild(shootBtn);
    const verdictRow = new Container(); // 판정 후 버튼(재촬영·획득)만 담는 레이어 — SHOOT은 유지
    btnRow.addChild(verdictRow);

    const showButtons = (): void => {
      verdictRow.removeChildren();
      shootBtn.cursor = grade === null ? "pointer" : "default";
      if (grade === null) return; // 촬영 전/중 — SHOOT만
      const GN: Record<MiniGameGrade, string> = { perfect: "PERFECT ✨", good: "GOOD 👍", clear: "CLEAR ✔" };
      resStamp.removeChildren();
      const gs = skinFit(`grade-${grade}`, 180, 64); // 등급 스탬프 이미지 우선
      if (gs) {
        gs.x = (W - 180) / 2;
        resStamp.addChild(gs);
        resT.visible = false;
      } else {
        resT.visible = true;
        resT.text = `${GN[grade]}`;
        resT.x = (W - resT.width) / 2;
      }
      const get = mkCap("✓ 획득", 160, 0xff6f9f, () => {
        if (grade === null) return;
        cleanupKeys();
        onFinish(grade);
      });
      // 재촬영·획득 버튼 — 레이아웃 에디터 개별 이동 가능 (slot_btn_retry / slot_btn_get). 기본 = SHOOT 위 한 줄
      if (spins > 0) {
        const rl = mkCap(`🔄 재촬영 (${spins})`, 160, 0x9f8cd0, doShoot);
        const pr = pos("slot_btn_retry", { x: (W - 326) / 2, y: -64 });
        rl.x = pr.x;
        rl.y = pr.y;
        const pg = pos("slot_btn_get", { x: (W - 326) / 2 + 166, y: -64 });
        get.x = pg.x;
        get.y = pg.y;
        verdictRow.addChild(rl, get);
        editable("slot_btn_retry", rl);
        editable("slot_btn_get", get);
      } else {
        const pg = pos("slot_btn_get", { x: (W - 160) / 2, y: -64 });
        get.x = pg.x;
        get.y = pg.y;
        verdictRow.addChild(get);
        editable("slot_btn_get", get);
      }
    };

    const doShoot = (): void => {
      if (shooting || spins <= 0) return;
      spins--;
      shooting = true;
      grade = null; // 재촬영 — 컷 순환 재개
      settled[0] = settled[1] = settled[2] = false;
      shotsGrp.removeChildren();
      refreshPips();
      verdictRow.removeChildren(); // 재촬영·획득만 제거 — SHOOT 버튼은 항상 표시
      shootBtn.cursor = "default";
      resT.text = "";
      const finals = [0, 1, 2].map(pickSym);
      if (opts.skin === "photo") finals[Math.floor(Math.random() * 3)] = 0; // 셋 중 한 컷은 반드시 하루(심볼 1) — 위치는 랜덤
      const t0 = performance.now();
      const settle = [520, 1040, 1560]; // 찰칵×3 — 왼쪽 컷부터 순차 확정
      playBgm("slot-bgm"); // 촬영 동안 아케이드 배경음 (재촬영 재개 포함)
      playCue("slot"); // 촬영 사운드 — 마지막 컷 확정과 함께 멈춤
      const tick = (): void => {
        if (!body.parent) { ticker.remove(tick); return; } // 화면 제거 정리는 idle이 담당
        const el = performance.now() - t0;
        for (let i = 0; i < 3; i++) {
          if (!settled[i] && el >= (settle[i] ?? 1560)) { // 찰칵: 플래시 + 컷 확정 + 폴라로이드 팝
            settled[i] = true;
            const n = finals[i] ?? 0;
            setIcon(i, n);
            flash();
            addShot(i, n);
          }
        }
        if (el >= (settle[2] ?? 1560) + 260) {
          ticker.remove(tick);
          stopCue("slot"); // 촬영 종료 → 사운드 정지
          playBgm("main"); // 판정 확정 → 메인 복귀
          shooting = false;
          grade = slotGrade(finals[0] ?? 0, finals[1] ?? 1, finals[2] ?? 2);
          if (grade === "good" || grade === "perfect") { // 컷마다: GOOD=집중선, PERFECT=블룸+스파클 버스트
            for (let i = 0; i < 3; i++) {
              const cx = VF.x + cellCx(i);
              const cy = VF.y + cellCy;
              if (grade === "perfect") { fxBloom(vfGrp, cx, cy, ticker); fxBurst(vfGrp, cx, cy, ticker); }
              else fxRays(vfGrp, cx, cy, ticker);
            }
          }
          showButtons();
        }
      };
      ticker.add(tick);
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.code === "Space") { e.preventDefault(); doShoot(); }
    };
    window.addEventListener("keydown", onKey);
    body.once("destroyed", cleanupKeys); // 중도 이탈(뷰 파괴) 시 리스너 정리
    refreshPips();
    showButtons();
  };

  // ── F. 리듬 (스테이지) — 좌우 2레인 낙하, 20초, 성공률→등급 ──
  const runRhythm = (): void => {
    // 타이밍 튜닝: 속도 배율(낙하·간격 비율 연동) + 판정창 프리셋. 판정 자체는 시간 기준.
    const aud = opts.audition === true; // 심사석 컨셉 (오디션 전용 문구 — B-1)
    const mult = tuning.rhythmSpeedMult > 0 ? tuning.rhythmSpeedMult : 1;
    const iv = (RHYTHM_NOTE_IV[act] ?? 800) / mult;
    const travelMs = RHYTHM_TRAVEL_MS / mult;
    const jw = RHYTHM_JUDGE_PRESETS[tuning.rhythmJudge] ?? RHYTHM_JUDGE_PRESETS.normal;
    const lateMs = jw.good + 20; // 판정선 지나침 → miss (good 창과 연동)
    // 전체 배경판 — 관문(막별 슬롯)·오디션(audition-board) 공통 경로. cover-fit: 비율이 다른 아트/영상 무왜곡
    const rhythmBoard = skinCover(opts.boardSkin ?? "gate-rhythm-board-easy", W, PH);
    if (rhythmBoard) body.addChildAt(rhythmBoard, 0);
    // B-1: "킬포인트"는 문구로만 해석 (판정선 명칭·아트는 기존 유지)
    desc(aud ? "후보의 킬포인트가 판정선에 닿는 순간 체크!" // 뒷 문구는 프레임 폭 초과로 제거
      : "판정선에 노트가 닿을 때 해당 레인 탭 · 시작 전에 모드를 골라요");
    // 패널이 배경판 아트 비율로 늘어나면(renderGate) 세로 배치도 비례 — 판정은 시간 기준이라 난이도 불변
    const ky = PH / MG_H;
    const TOP_Y = Math.round(118 * ky), HIT_Y = Math.round(500 * ky);

    // 모드(이지 2열/하드 3열)는 시작 화면에서 선택 — 레인·노트·입력은 begin()에서 구성
    let lanes = 2;
    let LANE_X: number[] = [];
    let laneCs: Container[] = []; // 레인 컨테이너(링+라벨) — 레이아웃 에디터로 좌우 간격 조정, 노트 x가 따라감
    let editorPaused = false;     // 레이아웃 에디터 켜짐 = 판 일시정지 (노트·타이머·음악 정지)
    // 레인 사이 흰 구분선은 걷어냈다 — 무대 배경 아트 위에 코드가 그린 선이 겹쳐 보였다.
    // (이지 1줄·하드 2줄) 레인 위치는 판정 링과 노트로 충분히 읽힌다.
    let trackId = "rhythm"; // begin()에서 로테이션으로 확정 — 노트 시계의 오디오 동기 기준
    const LANE_META: Array<{ icon: string; skin: string; key: string }> = [
      { icon: "🎤", skin: "gate-note-left", key: "F/←" },
      { icon: "⭐", skin: "gate-note-center", key: "G/↓" },
      { icon: "💃", skin: "gate-note-right", key: "J/→" },
    ];
    /** 레인 번호 → 메타 (이지는 0,2번 메타 사용 — 좌/우) */
    const meta = (lane: number): { icon: string; skin: string; key: string } =>
      LANE_META[lanes === 2 ? lane * 2 : lane] ?? LANE_META[0]!;

    const hud = txt("", 13, INK, true);
    const hudP = pos("rhythm_hud", { x: 20, y: 82 });
    hud.x = hudP.x;
    hud.y = hudP.y;
    body.addChild(hud);
    editable("rhythm_hud", hud);

    interface RNote { t: number; lane: number; el?: Container; done?: boolean } // el: 이모지 Text 또는 스킨 노드
    let plan: RNote[] = [];
    let total = 0;
    let live: RNote[] = [];
    let spawned = 0, p = 0, g = 0, m = 0, combo = 0;
    let now = 0;

    const refreshHud = (): void => {
      hud.text = `⏱ ${Math.max(0, (RHYTHM_MS - now) / 1000).toFixed(1)}s   COMBO ${combo}   P${p} G${g} M${m}`;
    };
    refreshHud();

    const laneY = (lane: number): number => laneCs[lane]?.y ?? 0; // 레인 세로 드래그 오프셋 (노트·이펙트 추종)
    const popFx = (lane: number, s: string, color: number): void => {
      const f = txt(s, 15, color, true);
      f.x = (LANE_X[lane] ?? 0) - f.width / 2;
      f.y = laneY(lane) + HIT_Y - 34;
      body.addChild(f);
      setTimeout(() => { f.parent?.removeChild(f); }, 420);
    };
    const record = (kind: "p" | "g" | "m", lane: number): void => {
      // 심사 테마 팝 (B-1: 텍스트만, popFx 시그니처 불변)
      if (kind === "m") { m++; combo = 0; popFx(lane, "MISS", 0xe86a8a); }
      else if (kind === "p") { p++; combo++; popFx(lane, "PERFECT", 0x3fb98a); }
      else { g++; combo++; popFx(lane, "GOOD", 0xf0a93a); }
      if (kind !== "m") { // 판정 하이라이트: good·perfect=링 파동, perfect=+스파클 버스트
        const hx = LANE_X[lane] ?? W / 2;
        fxRing(body, hx, laneY(lane) + HIT_Y + 2, ticker);
        if (kind === "p") fxBurst(body, hx, laneY(lane) + HIT_Y + 2, ticker);
      }
      refreshHud();
    };

    const hit = (lane: number): void => {
      if (editorPaused) return; // 편집 중 키보드 판정 차단 (탭은 실드가 차단)
      let best: RNote | null = null;
      let bestDt = Infinity;
      for (const n2 of live) {
        if (n2.lane !== lane || n2.done) continue;
        const dt = now - n2.t;
        if (Math.abs(dt) < Math.abs(bestDt)) { best = n2; bestDt = dt; }
      }
      if (!best) return;
      const k = rhythmJudge(bestDt, jw.perfect, jw.good);
      if (!k) return; // 허공 탭 무시
      buzz(k === "perfect" ? "medium" : "light"); // 판정 진동 — perfect가 더 묵직하게
      best.done = true;
      best.el?.parent?.removeChild(best.el);
      record(k === "perfect" ? "p" : "g", lane);
    };

    /** 버튼 안 문구를 따로 등록 — 버튼 아트를 바꾸면 폭이 달라져 문구만 미세조정해야 한다 */
    const chromeLabel2 = (b: Container, key: string): void => {
      centerBtnLabel(`${key}_text`, b);
    };

    // 시작 대기: 모드 선택(이지 2열 / 하드 3열)으로 시작 — Space=이지
    let started = false;
    const startUi = new Container();
    // 오디션은 심사 테마 라벨 + 보너스 조건(good 이상 +3) 명시. 버튼 아트(스킨 id)는 기존 그대로.
    // Space 단축키(begin(2))는 코드 유지 — 라벨에서만 생략 (스펙 §7 verbatim)
    const easyBtn = btn(aud ? "🎪 쇼케이스 (2열)" : "▶ 이지 · 2열  (Space)", 220, PINK, () => begin(2), "gate-rhythm-easy");
    const hardBtn = btn(aud ? "🏆 본선 무대 (3열 · 집중 심사 +3)" : "🔥 하드 · 3열 + 보너스", 220, LAV, () => begin(3), "gate-rhythm-hard");
    // 두 버튼을 따로 등록한다 — 한 묶음(rhythm_start)이면 둘이 함께만 움직여 간격·정렬을 못 잡는다.
    // 기본 좌표는 예전 묶음 앵커 + 각자의 y라 지금 배치가 그대로다.
    const BX = (MG_W - 220) / 2; // 고정 기준 폭 (관문별 W 무관)
    const pEasy = pos("easy_start", { x: BX, y: 252 });
    easyBtn.x = pEasy.x;
    easyBtn.y = pEasy.y;
    const pHard = pos("hard_start", { x: BX, y: 316 });
    hardBtn.x = pHard.x;
    hardBtn.y = pHard.y;
    startUi.addChild(easyBtn, hardBtn);
    body.addChild(startUi);
    editable("easy_start", easyBtn);
    editable("hard_start", hardBtn);
    chromeLabel2(easyBtn, "easy_start");
    chromeLabel2(hardBtn, "hard_start");

    const begin = (laneCount: number): void => {
      if (started) return;
      started = true;
      lanes = laneCount;
      startUi.parent?.removeChild(startUi);
      // 배경판은 이지·하드 공용(gate-rhythm-board-easy) — 시작 화면에서 올린 rhythmBoard 그대로 유지
      // 레인 기본값도 고정 기준 폭(MG_W) — 관문 배경 폭(W)에 따라 영점이 흔들리지 않게
      LANE_X = lanes === 2 ? [MG_W * 0.3, MG_W * 0.7] : [MG_W * 0.22, MG_W * 0.5, MG_W * 0.78];
      const lps = LANE_X.map((lx, i) => pos(`rhythm${lanes}_lane${i + 1}`, { x: Math.round(lx), y: 0 }));

      // 레인 스트립 (모드×열별 슬롯: 이지 1~2 · 하드 1~3) — 판정선·노트 아래 레이어, 레인 x 중심 정렬.
      // 높이는 게임플레이 고정(레인 구간), 폭은 아트 원본 비율에서 도출 — 어떤 비율의 아트도 눌리지 않음.
      // 레이아웃 에디터 연결: 모드별 키(rhythm2_strip1 …)로 개별 위치 조정 가능
      lps.forEach((q, i) => {
        const id = lanes === 2 ? `gate-rhythm-lane-easy-${i + 1}` : `gate-rhythm-lane-hard-${i + 1}`;
        const tex = skinTexTrim(id);
        if (!tex) return;
        const stripH = HIT_Y - TOP_Y + 40;
        const stripW = stripH * (tex.width / tex.height);
        const strip = skinNode(id, stripW, stripH);
        if (strip) {
          const key = `rhythm${lanes}_strip${i + 1}`;
          const sc = new Container();
          const sp2 = pos(key, { x: q.x - Math.round(stripW / 2), y: TOP_Y - 20 });
          sc.x = sp2.x;
          sc.y = sp2.y;
          sc.addChild(strip);
          body.addChild(sc);
          editable(key, sc);
        }
      });

      // 판정선: 레인 위치 기준 고정 폭 — 어느 관문이든 레인과 같은 영점 (W 비례 금지)
      const gx0 = Math.min(...lps.map((q) => q.x)) - 62;
      const gx1 = Math.max(...lps.map((q) => q.x)) + 62;
      // 판정선 스킨(gate-rhythm-line) 업로드 시 교체 — 세로는 중심 정렬, 없으면 기존 골드 라인.
      // 히트패드: 선이 4~12px로 얇아 에디터 실드가 못 집던 문제 — 투명 패드로 드래그 영역 확보 (40px).
      // 좌표는 모드별 분리(rhythm2_line/rhythm3_line) — 미저장 시 기존 공용 rhythm_line 값을 승계
      const linePad = new Graphics().rect(gx0, HIT_Y - 20, gx1 - gx0, 40).fill({ color: 0xffffff, alpha: 0.001 });
      const lineGrp = new Container();
      const lineName = `rhythm${lanes}_line`;
      const lgp = pos(lineName, pos("rhythm_line", { x: 0, y: 0 }));
      lineGrp.x = lgp.x;
      lineGrp.y = lgp.y;
      const lineSkin = skinNode("gate-rhythm-line", gx1 - gx0, 12);
      if (lineSkin) {
        lineSkin.x = gx0;
        lineSkin.y = HIT_Y - 4;
        lineGrp.addChild(linePad, lineSkin);
      } else {
        lineGrp.addChild(linePad, new Graphics().rect(gx0, HIT_Y, gx1 - gx0, 4).fill(0xf0c05a));
      }
      body.addChild(lineGrp);
      editable(lineName, lineGrp);
      laneCs = [];
      for (let i = 0; i < lanes; i++) {
        const name = `rhythm${lanes}_lane${i + 1}`; // 모드별 저장 (이지 rhythm2_*, 하드 rhythm3_*)
        const lp = lps[i] ?? { x: Math.round(LANE_X[i] ?? 0), y: 0 };
        const lc = new Container();
        lc.x = lp.x;
        lc.y = lp.y;
        // 판정링 크기 — 레인 스트립 아트 하단 원에 맞춤 (아트 원 지름 ≈ 아트 폭의 85% 실측,
        // 링 바깥이 원 안쪽 테두리에 붙는 겹침 비율 0.92는 이지 모드에서 Director가 맞춘 상태 기준).
        // 스트립 미업로드 레인은 기존 크기(r39/w5) 유지
        const stripId = lanes === 2 ? `gate-rhythm-lane-easy-${i + 1}` : `gate-rhythm-lane-hard-${i + 1}`;
        const stex = skinTexTrim(stripId);
        let ringR = 39, ringW = 5;
        if (stex) {
          const dispW = (HIT_Y - TOP_Y + 40) * (stex.width / stex.height) * skinScale(stripId);
          ringR = Math.max(10, Math.round(dispW * 0.85 * 0.92 / 2) + 0.5); // +0.5 = 지름 +1px (Director 미세 보정)
          ringW = Math.max(2, Math.round(ringR * 5 / 39));
        }
        lc.addChild(new Graphics().circle(0, HIT_Y + 2, ringR).stroke({ width: ringW, color: 0xf0c05a }));
        body.addChild(lc);
        editable(name, lc);
        // 방향키 안내 라벨 — 이모지 없이 키만 흰색 표기, 레인과 분리된 레이아웃 키(rhythmN_keyM)로 개별 조정
        const keyName = `rhythm${lanes}_key${i + 1}`;
        const kc = new Container();
        const kp = pos(keyName, { x: lp.x, y: lp.y });
        kc.x = kp.x;
        kc.y = kp.y;
        const lbl = txt(meta(i).key, 11, 0xffffff, true);
        lbl.x = -lbl.width / 2;
        lbl.y = HIT_Y + 34;
        kc.addChild(lbl);
        body.addChild(kc);
        editable(keyName, kc);
        laneCs.push(lc);
        LANE_X[i] = lc.x;
      }

      // 노트 계획: 곡 로테이션 → 박자표(beat.html) 있으면 사용, 없으면 자동 생성
      trackId = nextRhythmTrack();
      const bm = beatmaps[trackId]?.[lanes === 3 ? "hard" : "easy"];
      if (bm && bm.notes.length > 0) {
        // 곡 전체(60초)로 찍힌 박자표라도 플레이 길이(30초) 안의 노트만 사용 —
        // 초과 노트를 남기면 타이머 종료 후에도 스폰이 계속돼 판이 끝나지 않음
        plan = bm.notes
          .filter((n2) => n2.lane >= 0 && n2.lane < lanes && n2.t <= RHYTHM_MS - 400)
          .map((n2) => ({ t: n2.t, lane: n2.lane }))
          .sort((a, b) => a.t - b.t);
      } else {
        let lt = Math.floor(Math.random() * lanes);
        for (let t = 1000; t <= RHYTHM_MS - 400; t += iv) {
          if (Math.random() < 0.7) lt = (lt + 1 + Math.floor(Math.random() * (lanes - 1))) % lanes;
          plan.push({ t, lane: lt });
        }
      }
      total = plan.length;
      refreshHud();

      // 입력 존: 레인 수만큼 세로 분할 (시작 후에만 판정 — 에디터 실드가 켜지면 자동 차단)
      for (let lane = 0; lane < lanes; lane++) {
        const z = new Graphics().rect(lane * (W / lanes), 70, W / lanes, PH - 90).fill({ color: 0xffffff, alpha: 0.001 }); // 탭존은 늘어난 패널 전체
        z.eventMode = "static";
        z.on("pointerdown", () => hit(lane));
        body.addChild(z);
      }
      // 3·2·1 카운트다운 — 음악·노트 시계는 카운트 종료 순간에 함께 출발 (박자 싱크 보장)
      let count = 3;
      const cd = txt("3", 72, PINK, true);
      const placeCd = (): void => {
        cd.x = (W - cd.width) / 2;
        cd.y = 300;
      };
      placeCd();
      body.addChild(cd);
      // 링 중심 = 숫자 실제 중심 (텍스트 y는 행박스 상단이라 고정값을 쓰면 어긋남)
      const ringAtCd = (): void => fxRing(body, cd.x + cd.width / 2, cd.y + cd.height / 2, ticker);
      ringAtCd();
      const stepCd = (): void => {
        if (body.destroyed || !body.parent) return; // 중도 이탈 시 중단
        count--;
        if (count > 0) {
          cd.text = String(count);
          placeCd();
          ringAtCd();
          setTimeout(stepCd, 800);
          return;
        }
        cd.parent?.removeChild(cd);
        restartBgm(trackId); // 판마다 처음부터 (노트·음악 싱크)
        ticker.add(tick);
        if (inputBlocked()) applyEditor(true); // 편집 모드로 시작 → 첫 프레임부터 일시정지 (조작 모드면 그대로 진행)
      };
      setTimeout(stepCd, 800);
    };

    // 레이아웃 에디터 토글 = 판 일시정지/재개 (전체 리드로우 대신 자체 처리 — 판·등록 목록 유지)
    // 모드 선택 화면도 리드로우를 생략해야 함: 오디션(멤버 보드)은 진입 플래그가 1회 소비형이라
    // 리드로우가 돌면 점검 화면으로 빠져버림. 등록된 레이아웃 항목은 남아 있어 그대로 조정 가능.
    const applyEditor = (on: boolean): boolean => {
      if (!started) return true; // 모드 선택 화면 = 정지 상태 그대로 유지 (리드로우 불필요)
      editorPaused = on;
      if (on) pauseBgm(); // 노트 시계(bgmPositionMs)도 함께 멈춤 — 재개 시 그 지점부터
      else resumeBgm();
      return true;
    };
    setEditorToggleHook(applyEditor);

    const onKey = (e: KeyboardEvent): void => {
      if (e.code === "Space") { e.preventDefault(); begin(2); return; }
      if (!started) return;
      if (e.code === "KeyF" || e.code === "ArrowLeft") { e.preventDefault(); hit(0); }
      if (lanes === 3 && (e.code === "KeyG" || e.code === "ArrowDown")) { e.preventDefault(); hit(1); }
      if (e.code === "KeyJ" || e.code === "ArrowRight") { e.preventDefault(); hit(lanes - 1); }
    };
    window.addEventListener("keydown", onKey);
    const cleanup = (): void => {
      ticker.remove(tick);
      window.removeEventListener("keydown", onKey);
      setEditorToggleHook(null);
      if (editorPaused) resumeBgm(); // 일시정지 중 이탈해도 오디오 상태 원복
    };
    body.once("destroyed", cleanup); // 중도 이탈(뷰 파괴) 시 리스너·틱 정리

    const tick = (): void => {
      if (!body.parent) { cleanup(); return; }
      for (let i = 0; i < laneCs.length; i++) LANE_X[i] = laneCs[i]!.x; // 에디터 드래그 실시간 반영 (노트·판정 이펙트 x)
      if (editorPaused) { // 일시정지: 시간·스폰·미스 동결, 화면 위 노트만 레인 드래그를 따라감
        for (const n2 of live) {
          if (n2.done || !n2.el) continue;
          const prog = (now - (n2.t - travelMs)) / travelMs;
          n2.el.x = (LANE_X[n2.lane] ?? 0) - n2.el.width / 2;
          n2.el.y = TOP_Y + (laneY(n2.lane) + HIT_Y - TOP_Y) * prog - n2.el.height / 2;
        }
        return;
      }
      // 노트 시계 = 오디오 재생 위치 (박자표·음악 싱크). 오디오 시작 지연·드리프트 자동 보정, 무음이면 타이머 폴백
      const audioPos = bgmPositionMs(trackId);
      if (audioPos !== null && audioPos > 0) now = audioPos;
      else now += ticker.deltaMS;
      while (spawned < total) {
        const n2 = plan[spawned];
        if (!n2 || now < n2.t - travelMs) break;
        const mt = meta(n2.lane);
        const el = skinNode(mt.skin, 66, 66) ?? txt(mt.icon, 45, INK); // 노트 심볼 1.5배 (판정 링 확대와 짝)
        n2.el = el;
        body.addChild(el);
        live.push(n2);
        spawned++;
      }
      for (const n2 of live) {
        if (n2.done || !n2.el) continue;
        const prog = (now - (n2.t - travelMs)) / travelMs;
        n2.el.x = (LANE_X[n2.lane] ?? 0) - n2.el.width / 2;
        n2.el.y = TOP_Y + (laneY(n2.lane) + HIT_Y - TOP_Y) * prog - n2.el.height / 2;
        if (now - n2.t > lateMs) {
          n2.done = true;
          n2.el.parent?.removeChild(n2.el);
          record("m", n2.lane);
        }
      }
      live = live.filter((x) => !x.done);
      refreshHud();
      if (now >= RHYTHM_MS && live.length === 0) {
        cleanup();
        playBgm("main"); // 판정 확정 → 리듬 곡 종료·메인 복귀 (재도전·다음 라운드는 begin에서 재시작)
        const grade = rhythmGrade(p, g, total);
        if (lanes === 3 && grade !== "clear") { // 하드 보너스 — 호출측이 정의 (관문=+1pt, 오디션=기량 보정)
          popFx(1, "하드 보너스!", 0xf0c05a);
          opts.hardBonus?.();
        }
        onFinish(grade);
      }
    };
  };

  // ── G. 격자 회피 (스테이지) — 턴제 5×5, 대기 없음, 하트 잔량→등급 ──
  const runDodge = (): void => {
    const skinName = opts.skin === "clue" ? "단서 대조" : "사보타주 저지";
    const dodgeDesc = desc(`${skinName} · 화면 좌/우 탭 = 이동(한 줄 하강) · 💥 회피 · ✨ 반격 · 💖 회복 · 🛡 방어`);
    const ICON: Record<DodgeTile, string> = { bomb: "💥", atk: "✨", heal: "💖", shield: "🛡" };
    const second = DODGE_SECOND_TILE[act] ?? 0.45;

    let board: Array<Array<DodgeTile | null>> = Array.from({ length: DODGE_ROWS }, () => Array(DODGE_COLS).fill(null));
    let px = 2, pH = DODGE_P_HEARTS, eH = DODGE_E_HEARTS, shield = false, over = false;

    const eT = txt("", 14, INK, true);
    eT.x = 20;
    eT.y = 78;
    const msgT = txt("밝은 타일 ✨에 올라타 반격하세요!", 11.5, SUB, true);
    msgT.y = 102;
    // 전체 배경판(5×5 보드 아트) — 있으면 패널 전체에 깔고, 심볼을 아트에 그려진 칸 중심에 맞춘다.
    // (포토카드 배경판과 같은 용도 — 칸마다 타일을 찍지 않는다)
    const dodgeBoard = skinCover(opts.boardSkin ?? "", W, PH);
    if (dodgeBoard) body.setChildIndex(grp("dodge_board", dodgeBoard), 0); // 맨 뒤 레이어 + 에디터 등록
    // 배경판 아트(990×1625)의 실측 격자 — 열·행 중심 좌표(아트 픽셀, 스캔라인 측정).
    // 패널이 아트 비율로 잡히므로(renderGate) W·PH에 비례 환산하면 화면 좌표가 된다. 마지막 행 = 주인공 행(분홍 띠)
    const ART = { w: 990, h: 1625, colX: [130, 316, 495.5, 675.5, 861], rowY: [625.5, 792.5, 964, 1140.5, 1320] };
    const GP = dodgeBoard ? 2 : 5;
    const CELL = dodgeBoard ? Math.round(((ART.colX[1] ?? 0) - (ART.colX[0] ?? 0)) * (W / ART.w)) : 56;
    const GRID_W = DODGE_COLS * CELL + (DODGE_COLS - 1) * GP;
    const GX = (W - GRID_W) / 2, GY = 170;
    /** 칸(r,c)의 좌상단 — 배경판이 있으면 아트 실측 중심에서 역산, 없으면 벡터 격자 좌표 */
    const cellXY = (r: number, c: number): { x: number; y: number } => dodgeBoard
      ? { x: (ART.colX[c] ?? 0) / ART.w * W - CELL / 2, y: (ART.rowY[r] ?? 0) / ART.h * PH - CELL / 2 }
      : { x: GX + c * (CELL + GP), y: GY + r * (CELL + GP) };
    const gridC = new Container();
    const pT = txt("", 15, INK, true);
    pT.y = cellXY(DODGE_ROWS - 1, 0).y + CELL + 10;
    if (dodgeBoard) { // 어두운 보드 아트 위 가독성 — 문구를 흰색으로
      dodgeDesc.style.fill = 0xffffff;
      eT.style.fill = 0xffffff;
      msgT.style.fill = 0xffffff;
      pT.style.fill = 0xffffff;
    }
    grp("dodge_enemy", eT);   // 적 체력 (진범의 그림자)
    grp("dodge_msg", msgT);   // 안내 문구
    grp("dodge_grid", gridC); // 5×5 격자
    grp("dodge_hp", pT);      // 플레이어 체력

    const msg = (s: string): void => { msgT.text = s; msgT.x = (W - msgT.width) / 2; };
    const redraw = (): void => {
      eT.text = `🎭 진범의 그림자  ${"🖤".repeat(Math.max(0, eH))}${"·".repeat(DODGE_E_HEARTS - Math.max(0, eH))}`;
      pT.text = `${"❤️".repeat(Math.max(0, pH))}${"🤍".repeat(DODGE_P_HEARTS - Math.max(0, pH))}${shield ? "  🛡" : ""}`;
      pT.x = (W - pT.width) / 2;
      gridC.removeChildren();
      const SYM = dodgeBoard ? Math.round(CELL * 0.62) : 40;  // 심볼 크기 — 배경판 있으면 아트 칸 크기에 비례
      const PCS = dodgeBoard ? Math.round(CELL * 0.72) : 44;  // 주인공은 살짝 크게
      for (let r = 0; r < DODGE_ROWS; r++) for (let c = 0; c < DODGE_COLS; c++) {
        const { x, y } = cellXY(r, c);
        // 배경판 아트에 칸이 이미 그려져 있으면 벡터 칸은 생략 — 없을 때만 기존 격자를 그린다
        if (!dodgeBoard) {
          gridC.addChild(new Graphics().roundRect(x, y, CELL, CELL, 9)
            .fill(r === DODGE_ROWS - 1 ? 0xf3ecfa : 0xf8f4fc)
            .stroke({ width: 1.5, color: 0xece4f4 }));
        }
        const t = board[r]?.[c];
        if (t) {
          const symSkin = skinNode(`gate-dodge-sym-${t}`, SYM, SYM); // 타일 심볼 스킨 (없으면 이모지)
          if (symSkin) {
            symSkin.x = x + (CELL - SYM) / 2;
            symSkin.y = y + (CELL - SYM) / 2;
            gridC.addChild(symSkin);
          } else {
            const ic = txt(ICON[t], 26, INK);
            ic.x = x + (CELL - ic.width) / 2;
            ic.y = y + (CELL - ic.height) / 2;
            gridC.addChild(ic);
          }
        }
      }
      const pXY = cellXY(DODGE_ROWS - 1, px);
      const pcSkin = skinNode("gate-dodge-sym-player", PCS, PCS); // 주인공 스킨 (없으면 이모지)
      if (pcSkin) {
        pcSkin.x = pXY.x + (CELL - PCS) / 2;
        pcSkin.y = pXY.y + (CELL - PCS) / 2;
        gridC.addChild(pcSkin);
      } else {
        const pc = txt("👧", 28, INK);
        pc.x = pXY.x + (CELL - pc.width) / 2;
        pc.y = pXY.y + (CELL - pc.height) / 2;
        gridC.addChild(pc);
      }
    };

    const spawnRow = (): Array<DodgeTile | null> => {
      const row: Array<DodgeTile | null> = Array(DODGE_COLS).fill(null);
      const n = 1 + (Math.random() < second ? 1 : 0);
      const cols = [...Array(DODGE_COLS).keys()].sort(() => Math.random() - 0.5).slice(0, n);
      for (const c of cols) row[c] = dodgePickTile(Math.random());
      return row;
    };

    const cleanup = (): void => window.removeEventListener("keydown", onKey);

    const step = (dx: number): void => {
      if (over) return;
      px = Math.max(0, Math.min(DODGE_COLS - 1, px + dx));
      const incoming = board[DODGE_ROWS - 2] ?? Array(DODGE_COLS).fill(null);
      for (let r = DODGE_ROWS - 2; r > 0; r--) board[r] = board[r - 1] ?? Array(DODGE_COLS).fill(null);
      board[0] = spawnRow();
      const t = incoming[px];
      if (t === "bomb") {
        if (shield) { shield = false; msg("🛡 매니저가 막았다!"); }
        else { pH--; msg("💥 사보타주에 당했다! −1"); }
      } else if (t === "atk") { eH--; msg("✨ 스포트라이트 반격! 적 −1"); }
      else if (t === "heal") { if (pH < DODGE_P_HEARTS) pH++; msg("💖 팬들의 응원! +1"); }
      else if (t === "shield") { shield = true; msg("🛡 매니저 대기 (다음 피해 무효)"); }
      redraw();
      if (eH <= 0) {
        over = true;
        cleanup();
        playBgm("main"); // 판정 확정 → 격자 전용 곡 종료·메인 복귀
        const grade = dodgeGrade(pH);
        if (grade === "perfect") { // 퍼펙트 승리 → 골드 플래시 + PERFECT 팝 + 컨페티 후 결과로
          fxFlash(body, ticker, W, MG_H);
          fxPerfectPop(body, ticker, W, 250);
          fxConfetti(body, ticker, W);
          setTimeout(() => onFinish(grade), 1300);
          return;
        }
        onFinish(grade);
        return;
      }
      if (pH <= 0) { over = true; cleanup(); playBgm("main"); onFinish(null); return; }
    };

    // 입력: 좌/우 절반 탭 + 방향키
    for (const dir of [-1, 1]) {
      const z = new Graphics().rect(dir < 0 ? 0 : W / 2, 70, W / 2, MG_H - 90).fill({ color: 0xffffff, alpha: 0.001 });
      z.eventMode = "static";
      z.on("pointerdown", () => step(dir));
      body.addChild(z);
    }
    const onKey = (e: KeyboardEvent): void => {
      if (!body.parent) { cleanup(); return; }
      if (e.code === "ArrowLeft") { e.preventDefault(); step(-1); }
      if (e.code === "ArrowRight") { e.preventDefault(); step(1); }
    };
    window.addEventListener("keydown", onKey);
    body.once("destroyed", cleanup); // 중도 이탈(뷰 파괴) 시 리스너 정리

    board[0] = spawnRow();
    redraw();
  };

  if (opts.engine === "rps") runRps(); // 가위바위보 = BGM 전환 없음 (연습 곡 유지) — 탭마다 슬롯 릴 큐만 재생
  else if (opts.engine === "stop") runStop();
  else if (opts.engine === "match") runMatch();
  else if (opts.engine === "slot") runSlot();
  else if (opts.engine === "rhythm") runRhythm();
  else runDodge();
  for (const g of textGroups) body.addChild(g); // 문구를 최상단 레이어로 (배경판·트랙·버튼 위)
}

/** 관문 뷰: 딤 + 패널 + 엔진 + 카드 선택/실패 화면 + 광고 보너스 1회. 라운드마다 즉시 정산(onRound) */
export function renderGate(
  parent: Container,
  gate: GateDef,
  act: number,
  ticker: Ticker,
  getCards: () => Card[],                                   // 현재 보유 카드 덱 (라운드 정산으로 소모되므로 매번 재조회)
  onRound: (grade: MiniGameGrade, picked: number[]) => Partial<Gauges>, // 라운드 즉시 정산 → 적용 델타 반환 (HUD bump 포함)
  onGateEnd: () => void,                                    // 모든 라운드 종료 → 티켓 지급·진행 재개
  onRetry: () => void,
  onExit: () => void,
  bgTex?: Texture | null,                                   // 관문 배경 (목업 이식 — 없으면 흰 패널)
  hardBonus?: () => void,                                   // 리듬 하드(3열) 클리어 보너스
  tabText?: string,                                          // 상단 탭 정보 (회차·주차·D-day·카드) — 포토카드 배경판 아트용
): void {
  const dim = fullRect(0x5b4a70, 0.35);
  dim.eventMode = "static"; // 뒤 클릭 차단
  parent.addChild(dim);

  // 패널 폭은 기본 고정 — 배경 이미지 비율에 맞춰 좁히지 않는다 (세로형 배경이면 하단이 잘림)
  W = MG_W;
  PH = MG_H;
  // 포토카드 예외: 배경판 아트가 있으면 패널을 아트 비율에 맞춤 (이미지를 패널에 늘리지 않음)
  // 리듬 배경판은 관문(막)별 슬롯 분리 — act2 센터 대결=1막 슬롯 · act3 무대 집중=2막 슬롯
  const rhythmBoardId = gate.id === "act3" ? "gate-rhythm-board-2" : "gate-rhythm-board-easy";
  // 격자회피 배경판 — 관문별 슬롯(단서대조 / 사보타주). 5×5 보드가 통째로 그려진 아트 전제 (포토카드 배경판과 같은 용도)
  const dodgeBoardId = gate.skin === "clue" ? "gate-dodge-tile" : "gate-dodge-tile-block";
  const boardTex = gate.engine === "slot" ? skinTexTrim("gate-photo-board")
    : gate.engine === "rhythm" ? skinTexTrim(rhythmBoardId)
      : gate.engine === "dodge" ? skinTexTrim(dodgeBoardId) : null; // 리듬·격자회피도 배경판(영상 포함) 비율로 패널 확장
  if (boardTex) {
    PH = Math.round(W * (boardTex.height / boardTex.width));
    const maxH = 932 - 145 - 5; // 화면 높이 - 기본 패널 y - 여유
    if (PH > maxH) {
      PH = maxH;
      W = Math.round(PH * (boardTex.width / boardTex.height));
    }
  }

  const panel = new Container();
  // 저장값 = 패널 절대좌표 (에디터 드래그·저장과 1:1 왕복). 미저장 시 기본 = 가로 중앙
  // 포토카드는 배경판 아트 비율로 패널 크기가 달라 다른 관문과 위치를 공유하면 서로 틀어진다.
  // → 전용 키(gate_photo*)로 분리. 미저장 시 공통 키(gate*) 값을 승계해 현재 위치 유지
  const photo = gate.engine === "slot";
  const lk = (base: string): string => photo ? base.replace(/^gate/, "gate_photo") : base;
  const lpos = (base: string, def: { x: number; y: number }): { x: number; y: number } =>
    photo ? pos(lk(base), pos(base, def)) : pos(base, def);
  const p = lpos("gate", { x: Math.round((430 - W) / 2), y: 145 });
  panel.x = p.x;
  panel.y = p.y;
  parent.addChild(panel);
  editable(lk("gate"), panel);

  // 패널 바탕: 배경 이미지가 있으면 흰 베이스(모서리 채움), 없으면 스킨(gate-panel) 전용 — 빈 슬롯은 미표시.
  // 리듬(센터대결)은 전면 배경판이 패널을 대체 — 뒤 레이어(흰 베이스·배경 이미지·셰이드·스트립) 전부 생략.
  // 카드 선택·실패 화면은 각자 반투명 화이트 시트를 깔므로 가독성 유지 (배경판 미업로드 시엔 기존 그대로)
  const noPanel = (gate.engine === "rhythm" || gate.engine === "dodge") && !!boardTex;
  const bg = noPanel ? null
    : bgTex
      ? new Graphics().roundRect(0, 0, W, PH, 24).fill(0xffffff).stroke({ width: 2, color: 0xece4f4 })
      : (skinNode("gate-panel", W, PH) ?? skinNode("ui-frame", W, PH)); // 전용 → 공통 프레임 순
  if (bg) {
    // 포토카드는 전용 배경판(gate-photo-board)이 이미 그려지므로, 공통 프레임(gate-panel) 폴백을
    // gate_photo 그룹과 분리해 독립적으로 옮기거나 숨길 수 있게 한다(에디터 "숨김" 체크박스).
    if (photo) {
      const bgWrap = new Container();
      const bgp = lpos("gate_panel", { x: 0, y: 0 });
      bgWrap.x = bgp.x;
      bgWrap.y = bgp.y;
      bgWrap.addChild(bg);
      panel.addChild(bgWrap);
      editable(lk("gate_panel"), bgWrap); // → gate_photo_panel
    } else {
      panel.addChild(bg);
    }
  }
  if (bgTex && !noPanel) {
    // 배경 이미지 (패널 채움 — 가로 기준, 상단 유지·하단 크롭) + 흰 오버레이 — 어두운 텍스트 가독 유지
    const sp = new Sprite(bgTex);
    const s = Math.max(PH / bgTex.height, W / bgTex.width);
    sp.scale.set(s);
    sp.x = (W - bgTex.width * s) / 2;
    sp.y = 0; // 상단 고정 — 세로로 긴 이미지는 하단이 잘려나감
    const mask = new Graphics().roundRect(0, 0, W, PH, 24).fill(0xffffff);
    sp.mask = mask;
    // 격자 회피는 배경을 더 진하게 (셰이드 완화) — 타일·격자가 밝아 가독 여유 있음
    const shadeAlpha = gate.engine === "dodge" ? 0.28 : 0.5;
    const shade = new Graphics().roundRect(0, 0, W, PH, 24).fill({ color: 0xffffff, alpha: shadeAlpha });
    // 텍스트 존(상단 제목·설명 / 하단 라벨) 가독 보강 스트립
    const topStrip = new Graphics().roundRect(8, 8, W - 16, 112, 16).fill({ color: 0xffffff, alpha: 0.55 });
    const botStrip = new Graphics().roundRect(8, PH - 92, W - 16, 84, 16).fill({ color: 0xffffff, alpha: 0.4 });
    panel.addChild(sp, mask, shade, topStrip, botStrip);
  }

  const body = new Container(); // 게임별 내용 교체 영역
  panel.addChild(body);

  const clear = (): void => { body.removeChildren(); };
  const endGate = (): void => { setRedrawHook(null); onGateEnd(); }; // 관문을 벗어나면 리드로우 소유권 반납

  // 크롬 그룹: layout.json 오프셋 + 에디터 드래그 (mountEngine의 grp와 동일 패턴)
  const chromeGrp = (name: string, ...items: Container[]): void => {
    const g2 = new Container();
    const gp = lpos(name, { x: 0, y: 0 }); // 포토카드는 gate_photo_* 전용 키 (미저장 시 공통 키 승계)
    g2.x = gp.x;
    g2.y = gp.y;
    g2.addChild(...items);
    body.addChild(g2);
    editable(lk(name), g2);
  };

  /** 버튼 안 문구를 따로 등록 — 버튼 아트를 바꾸면 폭이 달라져 문구만 미세조정해야 한다 */
  const chromeLabel = (name: string, b: Container): void => {
    centerBtnLabel(lk(`${name}_text`), b);
  };

  const drawTitle = (): void => {
    if (gate.engine === "slot" && skinTex("gate-photo-board")) {
      // 배경판 아트(텍스트 미포함) — 제목·상단 탭을 아트 레이아웃 위치에 코드로 작성 (미세조정=레이아웃 에디터)
      const ky = PH / MG_H;
      const title = txt(gate.name, 26, INK, true);
      title.x = (W - title.width) / 2 + 20; // 아트의 카메라 아이콘(좌측) 옆 중앙
      title.y = Math.round(106 * ky);
      chromeGrp("gate_title", title);
      if (tabText) {
        const tab = txt(tabText, 12, 0xa8874f, true);
        tab.x = (W - tab.width) / 2;
        tab.y = Math.round(56 * ky);
        chromeGrp("gate_tab", tab);
      }
      return;
    }
    const title = txt(gate.name, 19, INK, true);
    title.x = 20;
    title.y = 18;
    chromeGrp("gate_title", title);
  };

  // 클리어 → 등급만큼 카드 선택 (덱빌딩 사용 창구)
  const GLBL: Record<string, string> = { skill: "실력", mental: "멘탈", reputation: "평판", bond: "유대", capital: "자본" };
  // 관문 보상 티켓 표기 — tickets.json 정의 이름 우선, 스토리 전용(정의 없는) 티켓은 보조 라벨 (id 노출 방지)
  const STORY_TICKET: Record<string, string> = { audition_pass: "센터 대결 통과증", clue_piece: "단서 조각", true_gate: "진실 무대 입장권" };
  const ticketName = (id: string): string => tickets.find((t) => t.id === id)?.name ?? STORY_TICKET[id] ?? id;

  const showCardPick = (grade: MiniGameGrade, onPicked: (picked: number[]) => void): void => {
    setRedrawHook(() => showCardPick(grade, onPicked)); // 배율 변경 시 이 화면만 재렌더
    clear();
    // 레이아웃 에디터 토글 시 리드로우 생략 — 이 화면은 판정 결과 1회성이라 다시 그리면 사라진다.
    // (등록된 gate_pick_* 항목은 그대로 남아 그 자리에서 조정 가능)
    setEditorToggleHook(() => true);
    // 배경 이미지 위 가독성 확보 — 관문 패널 프레임 슬롯(gate-panel) 업로드 시 이미지,
    // 없으면 기존 반투명 화이트 시트 (레이아웃 에디터: gate_pick_sheet)
    // 아트는 원본 비율 유지(contain·중앙 정렬) — 프레임 크기에 맞춰 늘리지 않는다
    const sheetTex = skinTex("gate-panel");
    let sheetSkin: Container | null = null;
    if (sheetTex) {
      const ss = Math.min((W - 20) / sheetTex.width, (PH - 14) / sheetTex.height) * skinScale("gate-panel");
      const sp = new Sprite(sheetTex);
      sp.scale.set(ss);
      sp.x = 10 + (W - 20 - sheetTex.width * ss) / 2;
      sp.y = 2 + (PH - 14 - sheetTex.height * ss) / 2;
      sheetSkin = sp;
    }
    chromeGrp("gate_pick_sheet", sheetSkin
      ?? new Graphics().roundRect(10, 2, W - 20, PH - 14, 20).fill({ color: 0xffffff, alpha: 0.88 }));
    // 첫 등장 시 카드 선택 시스템 안내 (기기당 1회)
    guide("gate_pick", "yuwol", "무대 성적이 좋을수록 <b>연습으로 모은 카드</b>를 더 많이 쓸 수 있어! 고른 카드의 효과는 <b>게이지에 적용되고 소모</b>돼. PERFECT면 2장까지!");
    const GN: Record<MiniGameGrade, string> = { perfect: "PERFECT ✨", good: "GOOD 👍", clear: "CLEAR ✔" };
    const n = gatePickCount(grade);
    // 등급 스탬프 슬롯(grade-*) 업로드 시 이미지, 없으면 기존 텍스트 — 오디션 결과와 공용
    const stamp = skinFit(`grade-${grade}`, 180, 64);
    if (stamp) {
      stamp.x = (W - 180) / 2;
      stamp.y = 0;
      chromeGrp("gate_pick_grade", stamp);
    } else {
      const t1 = txt(`${GN[grade]}`, 22, INK, true);
      t1.x = (W - t1.width) / 2;
      t1.y = 8;
      chromeGrp("gate_pick_grade", t1);
    }

    // 라운드마다 즉시 정산·소모되므로 현재 덱을 재조회 (인덱스 = 현재 덱 기준)
    const cards = getCards();
    const avail = cards.map((c, i) => ({ c, i }));

    if (avail.length === 0) {
      const none = txt(roundNum > 0 ? "남은 카드가 없어요" : "사용할 카드가 없어요", 16, INK, true);
      none.x = (W - none.width) / 2;
      none.y = 220;
      const hint = txt(roundNum > 0 ? "모은 카드를 이번 관문에서 모두 사용했어요" : "카드는 🏋️ 연습하기에서 모을 수 있어요", 12.5, SUB, true);
      hint.x = (W - hint.width) / 2;
      hint.y = 256;
      const info = txt(`🎟 ${ticketName(gate.ticket)} · +${GRADE_POINTS[grade]}⭐`, 13, SUB);
      info.x = (W - info.width) / 2;
      info.y = 294;
      // 탭·Space 공용 1회 실행 — 탭으로 진행해도 Space 리스너 해제 (누수 시 다음 Space가 라운드 중복 발화)
      let done0 = false;
      const finish0 = (): void => { if (done0) return; done0 = true; setEditorToggleHook(null); offSpace0(); onPicked([]); };
      const go = btn("계속 →", 180, PINK, finish0, "gate-btn-confirm");
      go.x = (W - 180) / 2;
      go.y = 410;
      chromeGrp("gate_pick_empty", none, hint);
      chromeGrp("gate_pick_ticket", info);
      chromeGrp("gate_pick_btn", go);
      const offSpace0 = pairSpace(finish0, () => !done0 && !go.destroyed); // 탭=Space
      return;
    }

    const sel = new Set<number>(); // 원본 덱 인덱스 기준
    const sub2 = txt(`사용할 카드를 ${n}장까지 선택하세요 — 효과가 게이지에 적용됩니다`, 12, SUB, true);
    sub2.x = (W - sub2.width) / 2;
    sub2.y = 44;
    chromeGrp("gate_pick_desc", sub2);
    const sumT = txt("", 12.5, 0x3fb98a, true);
    sumT.y = 460;
    chromeGrp("gate_pick_sum", sumT);

    const refreshSum = (): void => {
      const picked = [...sel].map((i) => cards[i]).filter((c): c is Card => c !== undefined);
      const delta = sumCardEffects(picked, cardTemplates);
      const s = Object.entries(delta).map(([k, v]) => `${GLBL[k] ?? k} +${v}`).join(" · ");
      sumT.text = s ? `적용 효과: ${s}` : `선택 ${sel.size}/${n}`;
      sumT.x = (W - sumT.width) / 2;
    };
    refreshSum();

    // P2: 핸드(부채꼴) 픽커 — 탭하면 손패에서 위로 올라옴
    const GRADE_COLOR: Record<CardGrade, number> = { epic: 0xf0c05a, rare: 0xa78be6, common: 0xc4b8d6 };
    const shown = avail.slice(0, 10); // 표시 상한 — 초과분은 다음 관문에서
    const hand = new Container();
    hand.x = W / 2;
    hand.y = 430; // 부채꼴 기준점(카드 하단)
    chromeGrp("gate_pick_hand", hand);

    const CW = 86;
    const CH = 118;
    const drawHand = (): void => {
      hand.removeChildren();
      const nCards = shown.length;
      // 심볼·별을 카드마다 반복 키로 등록 — 첫 카드가 대표, 나머지는 복제 (보류 행·카드덱과 같은 규약).
      // drawHand가 탭마다 다시 그리므로 등록도 매번 새로 잡는다.
      const seen = new Set<string>();
      const reg2 = (name: string, g: Container): void => {
        if (seen.has(name)) editableClone(name, g);
        else { seen.add(name); editable(name, g); }
      };
      shown.forEach(({ c: card, i }, iPos) => {
        const t = cardTemplates.find((x) => x.id === card.templateId);
        const angle = fanAngle(iPos, nCards); // 연습 결과 카드와 같은 부채꼴 규격 (두 장이면 ±10°)
        const rad = (angle * Math.PI) / 180;
        const on = sel.has(i);
        const cc = new Container();
        cc.rotation = rad;
        cc.x = angle * 3.4;
        cc.y = on ? -36 : 0; // 선택 시 위로
        /** 카드 안 조각을 오프셋 그룹으로 등록 — 저장 좌표는 모든 카드에 공통 적용 */
        const piece = (name: string, child: Container, px: number, py: number): void => {
          child.x = px;
          child.y = py;
          const g = new Container();
          const q = pos(name, { x: 0, y: 0 });
          g.x = q.x;
          g.y = q.y;
          g.addChild(child);
          cc.addChild(g);
          reg2(name, g);
        };
        // 카드 프레임 — 연습 결과 카드 앞면(train-result-card) 아트 공용, 없으면 기존 벡터
        const cardArt = skinFit("train-result-card", CW, CH);
        let bg2: Container;
        if (cardArt) {
          cardArt.x = -CW / 2;
          cardArt.y = -CH;
          bg2 = cardArt;
        } else {
          bg2 = new Graphics().roundRect(-CW / 2, -CH, CW, CH, 11)
            .fill(on ? 0xffe4f0 : 0xf6f0fc)
            .stroke({ width: on ? 3 : 2.5, color: on ? PINK : GRADE_COLOR[card.grade] });
        }
        cc.addChild(bg2);
        if (cardArt && on) // 아트 카드의 선택 표시 — 분홍 링 (벡터 카드는 스트로크가 담당)
          cc.addChild(new Graphics().roundRect(-CW / 2, -CH, CW, CH, 11).stroke({ width: 3, color: PINK }));
        // 게이지 심볼 — 카드가 올려주는 게이지 아트, 하나도 없으면 이모지로 폴백
        const symRow = gaugeSymbol(card, CW, 24);
        let ic: Container;
        let icx: number, icy: number;
        if (symRow) {
          ic = symRow;
          icx = -CW / 2;
          icy = -CH + 8;
        } else {
          const e = txt(t?.icon ?? "", 22, INK);
          icx = -e.width / 2;
          icy = -CH + 12;
          ic = e;
        }
        piece("gate_pick_hand_sym", ic, icx, icy);
        // 판정등급 — 등급별 별 아트, 없으면 ★ 텍스트 (같은 박스에 중앙 정렬)
        piece("gate_pick_hand_star", starNode(card.grade, 54, 15), -54 / 2, -CH + 44);
        const eff = cardEffect(card, cardTemplates);
        const first = Object.entries(eff)[0];
        const fx = txt(first ? `${GLBL[first[0]] ?? first[0]}+${first[1]}` : "", 9.5, INK, true);
        fx.x = -fx.width / 2;
        fx.y = -CH + 66;
        const nm = txt(t?.name?.replace(" 카드", "") ?? "", 9.5, SUB, true);
        nm.x = -nm.width / 2;
        nm.y = -CH + 88;
        cc.addChild(fx, nm);
        cc.eventMode = "static";
        cc.cursor = "pointer";
        cc.on("pointertap", () => {
          if (sel.has(i)) sel.delete(i);
          else if (sel.size < n) sel.add(i);
          drawHand();
          refreshSum();
        });
        hand.addChild(cc);
      });
    };
    drawHand();
    if (avail.length > shown.length) {
      const more = txt(`외 ${avail.length - shown.length}장은 다음 관문에서`, 10, SUB);
      more.x = (W - more.width) / 2;
      more.y = 436;
      chromeGrp("gate_pick_more", more);
    }

    const info = txt(`🎟 ${ticketName(gate.ticket)} · +${GRADE_POINTS[grade]}⭐`, 11.5, SUB);
    info.x = 20;
    info.y = 500;
    // 탭·Space 공용 1회 실행 — 탭으로 진행해도 Space 리스너 해제
    let done1 = false;
    const finish1 = (): void => { if (done1) return; done1 = true; setEditorToggleHook(null); offSpace1(); onPicked([...sel]); };
    const go = btn("확인 →", 180, PINK, finish1, "gate-btn-confirm");
    go.x = (W - 180) / 2;
    go.y = 522;
    chromeGrp("gate_pick_ticket", info);
    chromeGrp("gate_pick_btn", go);
    const offSpace1 = pairSpace(finish1, () => !done1 && !go.destroyed); // 탭=Space
  };

  const showFail = (): void => {
    setRedrawHook(showFail); // 배율 변경 시 이 화면만 재렌더
    clear();
    // 배경 프레임 — 업로드된 아트가 있으면 그걸로, 없으면 기존 반투명 판을 유지한다
    const fbg = skinFit("gate-fail-panel", W, PH);
    if (fbg) chromeGrp("gate_fail_bg", fbg);
    else body.addChild(new Graphics().roundRect(10, 2, W - 20, PH - 14, 20).fill({ color: 0xffffff, alpha: 0.88 }));
    const t1 = txt("아쉬워요…", 22, INK, true);
    t1.x = (W - t1.width) / 2;
    t1.y = 220;
    const go = btn("재도전 (멘탈 −1)", 220, LAV, onRetry, "gate-btn-retry");
    go.x = (W - 220) / 2;
    go.y = 330;
    const quit = btn("종료하기 (보상 없이 진행)", 220, 0xc4b8d6, onExit, "gate-btn-quit");
    quit.x = (W - 220) / 2;
    quit.y = 394;
    chromeGrp("gate_fail_title", t1);
    chromeGrp("gate_fail_retry", go);
    chromeLabel("gate_fail_retry", go);
    chromeGrp("gate_fail_quit", quit);
    chromeLabel("gate_fail_quit", quit);
  };

  // ── 라운드 진행: 기본 1회 + 광고 시청 시 1회 더 (관문당 1회 한정) — 라운드마다 즉시 정산 ──
  let roundNum = 0;

  const afterPick = (grade: MiniGameGrade, picked: number[]): void => {
    const delta = onRound(grade, picked); // 즉시 정산 — 이 시점에 HUD 게이지도 오름
    roundNum += 1;
    const next = roundNum === 1 ? showAdModal : endGate;
    if (picked.length > 0) {
      // 카드 사용 → 레벨업 연출 후 다음 단계 (연출 뒤 HUD엔 이미 반영된 수치가 보임)
      const dText = Object.entries(delta).map(([k, v]) => `${GLBL[k] ?? k} +${v}`).join(" · ");
      void playLevelUpFx(parent, ticker, dText, next);
    } else next();
  };

  // 관문 첫 진입 가이드 (엔진별 1회)
  const GATE_GUIDE: Record<string, string> = {
    rhythm: "노트가 <b>금색 링에 닿는 순간</b> 그 쪽을 탭! 왼쪽 🎤 오른쪽 💃",
    slot: "<b>📸 찰칵</b>으로 3컷 연속촬영! 마음에 들면 <b>획득</b>, 아니면 <b>재촬영</b> — 총 3번!",
    dodge: "화면 <b>좌/우를 탭</b>해 움직여. 💥는 피하고 ✨엔 올라타서 반격!",
  };
  guide(`gate_${gate.engine}`, "staff", GATE_GUIDE[gate.engine] ?? "");

  // ── 중도 이탈: 우상단 ✕ → confirm 모달 → 보상 없이 진행 (이번 관문 몫을 잃음) ──
  const showExitConfirm = (): void => {
    ticker.stop(); // 리듬·슬롯 진행 일시정지 (렌더도 멈추지만 DOM 모달이라 무관)
    const bg = document.createElement("div");
    bg.style.cssText = "position:fixed;inset:0;z-index:1000;background:#1d1030cc;backdrop-filter:blur(3px)";
    const box = document.createElement("div");
    box.style.cssText = "position:absolute;width:300px;max-width:88vw;background:linear-gradient(180deg,#fff,#fdf4f8);border:2px solid #e86a8a;border-radius:20px;padding:22px 20px;text-align:center;box-shadow:0 20px 50px -10px #0008;font-family:inherit";
    const cv2 = document.querySelector("canvas");
    if (cv2) {
      const r = cv2.getBoundingClientRect();
      box.style.left = `${r.left + r.width / 2}px`;
      box.style.top = `${r.top + r.height / 2}px`;
      box.style.transform = "translate(-50%, -50%)";
    } else {
      box.style.left = "50%";
      box.style.top = "50%";
      box.style.transform = "translate(-50%, -50%)";
    }
    box.innerHTML = `<div style="font-size:38px">🚪</div>
      <h3 style="margin:8px 0 6px;font-size:17px;color:#e86a8a">정말 나가시겠어요?</h3>
      <p style="margin:0 0 14px;font-size:12.5px;color:#8a7ba0;line-height:1.6">지금 나가면 <b>${gate.name}</b>의 남은 보상<br>(카드 사용·티켓·⭐)을 받지 못한 채 이야기가 계속돼요.</p>`;
    const openedAt = performance.now();
    const guarded = (fn: () => void) => (): void => {
      if (performance.now() - openedAt < 400) return; // 고스트 클릭 차단
      fn();
    };
    const stay = document.createElement("button");
    stay.textContent = "계속하기";
    stay.style.cssText = "width:100%;padding:13px;border:none;border-radius:12px;cursor:pointer;font-weight:800;font-size:14px;color:#fff;background:linear-gradient(180deg,#ff9cc0,#ff7fb0)";
    stay.onclick = guarded(() => { bg.remove(); offSpace(); ticker.start(); });
    const leave = document.createElement("button");
    leave.textContent = "나가기 (보상 없음)";
    leave.style.cssText = "width:100%;margin-top:9px;padding:10px;border:none;background:none;color:#a99bc0;cursor:pointer;font-size:12.5px";
    leave.onclick = guarded(() => {
      bg.remove();
      offSpace();
      ticker.start();
      dim.destroy();
      panel.destroy({ children: true }); // 엔진 리스너·틱은 destroyed 훅으로 정리
      setRedrawHook(null);
      onExit();
    });
    box.append(stay, leave);
    bg.appendChild(box);
    document.body.appendChild(bg);
    const offSpace = pairSpace(() => true, () => bg.isConnected); // 모달 중 Space 삼킴 (선택은 버튼으로)
  };

  const drawExitBtn = (): void => {
    const b = new Container();
    // 공통 X 버튼(ui-close-x) 업로드 시 교체 — 이미지에 ✕가 구워진 전제, 없으면 기존 벡터+텍스트
    const xSkin = skinNatural("ui-close-x", 36, 36); // 1배율=원본 크기
    if (xSkin) {
      b.addChild(xSkin);
    } else {
      const g = new Graphics().roundRect(0, 0, 36, 36, 11).fill(0xf3ecfa).stroke({ width: 1.5, color: 0xdccdec });
      const x = txt("✕", 16, SUB, true);
      x.x = (36 - x.width) / 2;
      x.y = (36 - x.height) / 2;
      b.addChild(g, x);
    }
    b.x = W - 48;
    b.y = 12;
    b.eventMode = "static";
    b.cursor = "pointer";
    b.on("pointertap", showExitConfirm);
    chromeGrp("gate_exit", b);
  };

  const startRound = (): void => {
    setRedrawHook(startRound); // 배율·농도 변경 시 관문 밖으로 튕기지 않고 이 라운드만 다시 그림
    clear();
    drawTitle();
    mountEngine(body, {
      engine: gate.engine,
      act,
      skin: gate.skin,
      ticker,
      hardBonus,
      width: W, // 배경 맞춤 패널 폭 유지 (mountEngine 기본값이 되돌리지 않게)
      panelH: PH, // 포토카드 배경판 비율 반영 패널 높이
      boardSkin: gate.engine === "dodge" ? dodgeBoardId : rhythmBoardId, // 배경판 슬롯 — 리듬=막별 · 격자회피=관문별
      ns: gate.engine === "dodge" ? (gate.skin ?? "block") : undefined, // 격자회피는 관문별로 좌표 분리 (배경판이 달라서)
      onFinish: (grade) => {
        if (grade) showCardPick(grade, (picked) => afterPick(grade, picked));
        else if (roundNum === 0) showFail();  // 기본 라운드 실패 → 재도전/종료
        else endGate();                        // 보너스 라운드 실패 → 보너스 없이 종료 (기본 라운드는 이미 정산됨)
      },
    });
    drawExitBtn(); // 게임 진행 중에만 표시 (카드픽·실패 화면에선 clear로 제거)
  };

  // 광고 모달 (DOM 오버레이 — 미연동, 시청완료 버튼만)
  const showAdModal = (): void => {
    const bg = document.createElement("div");
    bg.style.cssText = "position:fixed;inset:0;z-index:1000;background:#1d1030cc;backdrop-filter:blur(3px)";
    const box = document.createElement("div");
    box.style.cssText = "position:absolute;width:300px;max-width:88vw;background:linear-gradient(180deg,#fff,#fdf4f8);border:2px solid #f0c05a;border-radius:20px;padding:22px 20px;text-align:center;box-shadow:0 20px 50px -10px #0008;font-family:inherit";
    // 게임 화면(캔버스) 가운데 정렬
    const cv = document.querySelector("canvas");
    if (cv) {
      const r = cv.getBoundingClientRect();
      box.style.left = `${r.left + r.width / 2}px`;
      box.style.top = `${r.top + r.height / 2}px`;
      box.style.transform = "translate(-50%, -50%)";
    } else {
      box.style.left = "50%";
      box.style.top = "50%";
      box.style.transform = "translate(-50%, -50%)";
    }
    box.innerHTML = `<div style="font-size:40px">📺</div>
      <h3 style="margin:8px 0 6px;font-size:17px;color:#e7641b">광고 보고 한 번 더!</h3>
      <p style="margin:0 0 12px;font-size:12.5px;color:#8a7ba0;line-height:1.6">광고를 시청하면 <b>${gate.name}</b>에<br>1회 더 도전해 카드를 추가로 사용할 수 있어요.</p>
      <div style="height:78px;border:2px dashed #e6d9f0;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#b8a8cc;font-size:12px;margin-bottom:14px">＿ 광고 영역 (미연동) ＿</div>`;
    // 고스트 클릭 차단: 카드픽 '확인' 탭의 합성 click이 모달 버튼을 자동 클릭하는 것 방지
    const openedAt = performance.now();
    const guarded = (fn: () => void) => (): void => {
      if (performance.now() - openedAt < 400) return;
      fn();
    };
    const ok = document.createElement("button");
    ok.textContent = "광고 시청 완료 → 1회 더";
    ok.style.cssText = "width:100%;padding:13px;border:none;border-radius:12px;cursor:pointer;font-weight:800;font-size:14px;color:#3a1608;background:linear-gradient(180deg,#ffd884,#f2c86a)";
    ok.onclick = guarded(() => { bg.remove(); startRound(); });
    const no = document.createElement("button");
    no.textContent = "괜찮아요";
    no.style.cssText = "width:100%;margin-top:9px;padding:10px;border:none;background:none;color:#a78be6;cursor:pointer;font-size:12.5px";
    no.onclick = guarded(() => { bg.remove(); endGate(); });
    box.append(ok, no);
    bg.appendChild(box);
    document.body.appendChild(bg);
    const offSpace = pairSpace(() => true, () => bg.isConnected); // 모달 열림 중 Space 삼킴 (선택은 버튼으로)
    const okH = ok.onclick as () => void; ok.onclick = () => { offSpace(); okH(); };
    const noH = no.onclick as () => void; no.onclick = () => { offSpace(); noH(); };
  };

  startRound();
}
