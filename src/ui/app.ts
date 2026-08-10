// ui/app.ts — 런 루프: RunController 상태를 Pixi로 그림.
// 런(ctrl)은 모듈 수준에서 유지 — 로비로 나갔다 돌아와도 진행이 이어진다.
import { Application, Assets, BlurFilter, ColorMatrixFilter, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { GameAssets } from "./assets";
import { createRunController, type RunController } from "./runController";
import { beats, config, casting, gates, tuning, characters, cardTemplates } from "../data";
import { makeCards } from "../engine/cards";
import { STARTER_CARDS } from "../engine/state";
import { renderTrainingBoard } from "./training";
import { renderMemberBoard } from "./memberBoard";
import { renderGauges } from "./gaugeBar";
import { renderCard } from "./swipeCard";
import { renderEndScreen } from "./screens";
import { renderGate } from "./minigames";
import { pos } from "./layout";
import { fullRect, stageTop, stageHeight } from "./stage";
import { beginFrame, editable, onRedraw, triggerRedraw } from "./editor";
import { statusLine, ddayWeeks } from "./runStatus";
import { initCheatMenu, registerCheat, registerCheatPick, registerCardOps, registerJumpOps, registerGaugeOps, drainPendingCards, getPendingCards, setInGameCheck } from "./cheatMenu";
import { addCard, removeCards } from "../engine/deck";
import { isDevMode } from "./devMode";
import { toast } from "./metaMenu";
import { renderCardDeckSheet } from "./cardDeckSheet";
import { advanceMockDailyDay } from "./sidePanels";
import { pressable } from "./press";
import { playBgm, setBgmVolume, setBgmMuted, DEFAULT_VOLUME } from "./audio";
import { guide, guideSeq, resetTutorial } from "./tutorial";
import { pickBgSlot, bgManifest } from "./bgSlots";
import { skinNode, skinFit, skinNatural, skinTex } from "./uiSkin";
import { assetUrl, assetVersion } from "./hotAssets";
import type { Gauges, Card, GaugeId, MiniGameGrade, TrainingId, RunEvent } from "../engine/types";

const newRun = (): RunController => createRunController(beats, config, "small", gates, tuning);
const BTN_INK = 0xe0d0fd; // 스토리 상단 버튼 글씨 — ui-btn 아트 바깥 연보라 테두리 실측값

// ── 세션 상태 (startApp 재진입에도 유지) ──
let ctrl: RunController | null = null;
let freeTraining = false;               // 🎹 자유 연습 모드 (치트 전용)
let memberBoardForced = false;          // 👥 멤버 보드 강제 오픈 (👥 멤버 버튼·치트 공용)
let memberBoardAudition = false;        // 🎤 오디션 씬 직행 (치트 "오디션 보기" — 1회 소비)
let memberBoardResult = false;          // 🏅 판정결과 화면 직행 (치트 — 리듬 없이 레이아웃 확인용, 1회 소비)
let memberBoardRecheck = false;         // 🙅 "새로 만날 후보가 없어요" 확인 화면 직행 (치트, 1회 소비)
// 판정결과 화면 직행 치트 — 관문·연습은 게임을 돌리지 않고 결과 화면부터 띄운다 (레이아웃 점검용)
let gatePreview: MiniGameGrade | null = null;
let trainPreview: { id: TrainingId; grade: MiniGameGrade } | null = null;
let endPreview: RunEvent | null = null; // 💀 파멸 붕괴 엔딩 화면 (치트)
let lastTrainWeek = 0;                  // 주간 연습 기준 주 — state.week가 이보다 커지면 연습 오픈
let loop2Mode: "fast" | "normal" | null = null; // 2회차 진행 모드 (회귀 화면에서 선택, 새 런 시 초기화)
let currentDraw: () => void = () => {}; // 현재 진입의 draw (치트·에디터가 호출)
let cardOpsInited = false;
let gameActive = false;                 // 게임 화면 활성 여부 (로비로 나가면 false — 치트 활성/비활성 기준)

/** 현재 런의 카드 덱 (로비 덱 시트 표시용).
 *  런이 아직 없으면(첫 로비 — showLobby가 startApp보다 먼저 돈다) 시작 덱을 미리 보여준다.
 *  로비 덱은 "런 시작 시 이 카드들을 갖고 출발해요"를 보여주는 자리라 예고가 맞다. */
export function currentRunCards(): Card[] {
  return ctrl ? ctrl.state.cards : STARTER_CARDS.map((c) => ({ ...c }));
}

/** 화면에 보이는 카드 전체 — 로비 덱·스토리 덱·상단 진행 표기가 **모두 이걸** 본다.
 *  각자 다른 출처를 쓰다 장수가 어긋난 적이 있어 한 곳으로 모았다.
 *  대기 버퍼는 런 시작 시 덱으로 들어가므로(startApp) 런 중에는 비어 있다. */
export function visibleCards(): Card[] {
  return [...currentRunCards(), ...getPendingCards()];
}

/** 진행 중인 런의 회차·주차 (로비 START·상단 상태 패널 표시용 — 진행 중인 런 없으면 null) */
export function currentRunInfo(): {
  loop: 1 | 2; week: number; awaitingRegress: boolean;
  act: number; debutWeek: number; gauges: Record<GaugeId, number>;
} | null {
  if (!ctrl) return null;
  return {
    loop: ctrl.state.loopCount,
    week: ctrl.state.week,
    awaitingRegress: ctrl.ended?.type === "regress",
    act: ctrl.state.act,
    debutWeek: config.debutWeek,
    gauges: { ...ctrl.state.gauges },
  };
}

/** 게임 치트 등록 — 부트 시 1회 (로비에서도 치트 목록에 항상 표시) */
export function initGameCheats(): void {
  if (!isDevMode()) return;
  onRedraw(() => currentDraw());
  setInGameCheck(() => gameActive); // 로비·부트에선 게임 전용 치트 비활성(회색) 표시
  const needGame = (run: (c: RunController) => void) => (): void => {
    if (!ctrl || !gameActive) { toast("게임(회차) 진입 후 사용할 수 있어요"); return; }
    run(ctrl);
    currentDraw();
  };
  // 상태 게이지 조정 — 치트 메뉴가 패널을 그리고, 실제 수치 읽기·쓰기는 여기서.
  // 런이 없으면 만들어 준다(로비에서도 조정 가능 — 상단 상태 패널 검증용).
  const GAUGE_LABEL: Record<GaugeId, string> = {
    skill: "실력", mental: "멘탈", reputation: "평판", bond: "유대", capital: "자본",
  };
  const GAUGE_IDS = ["skill", "mental", "reputation", "bond", "capital"] as const;
  registerGaugeOps({
    min: config.gaugeMin,
    max: config.gaugeMax,
    read: () => {
      if (!ctrl) ctrl = newRun();
      const c = ctrl;
      return GAUGE_IDS.map((id) => ({ id, label: GAUGE_LABEL[id], value: c.state.gauges[id] }));
    },
    write: (id, value) => {
      if (!ctrl) ctrl = newRun();
      ctrl.state.gauges[id as GaugeId] = value;
      triggerRedraw(); // 게임=게이지 패널, 로비=상단 상태 패널 즉시 갱신
    },
  });
  registerCheat("⏩ 1회차 완주 → 회귀 화면", () => {
    // 로비에서도 사용 가능: 런이 없으면 새로 만들어 완주해두고, START로 들어가면 곧장 회귀 화면
    if (!ctrl) ctrl = newRun();
    const c = ctrl;
    if (c.ended) { toast("이미 회차가 끝나 있어요 — 새 런 시작 후 사용하세요"); return; }
    // 남은 비트를 전부 좌측 선택으로 진행(관문은 건너뜀) → 회귀·모드 선택 화면 확인용
    let guard = 500;
    while (c.current && guard-- > 0) {
      if (c.pendingGate) c.skipGate();
      else c.choose("left");
    }
    triggerRedraw(); // 현재 화면 재렌더 — 게임=회귀 화면, 로비=CTA 2회차 표기 갱신
    if (!gameActive) toast("1회차 완주 완료 — START로 들어가면 회귀 화면이 떠요");
  });
  registerCheat("💗 게이지 전부 +10", () => {
    // 로비에서도 사용 가능: 런이 없으면 새로 만들어 적용 (로비 상단 상태 패널 검증용)
    if (!ctrl) ctrl = newRun();
    const c = ctrl;
    for (const k of ["skill", "mental", "reputation", "bond", "capital"] as const)
      c.state.gauges[k] = Math.min(config.gaugeMax, c.state.gauges[k] + 10);
    triggerRedraw(); // 게임=게이지 패널, 로비=상단 상태 패널 갱신
  });
  registerCheat("↺ 새 런 시작", () => {
    if (!ctrl || !gameActive) { toast("게임(회차) 진입 후 사용할 수 있어요"); return; }
    ctrl = newRun();
    loop2Mode = null;
    currentDraw();
  }, true);
  registerCheat("🎹 연습 메뉴", needGame(() => { freeTraining = true; }), true);
  registerCheat("🎤 오디션 재료 (카드3+진행권)", needGame((c) => {
    for (let i = 0; i < 3; i++) for (const card of makeCards("audition", "common", cardTemplates)) c.state.cards = addCard(c.state.cards, card);
    c.state.deck.push("audition");
    toast("오디션 카드 3장 + 진행권 1장 지급");
  }), true);
  registerCheat("👥 멤버 보드 열기", needGame(() => { memberBoardForced = true; }), true);
  registerCheat("🏅 오디션 판정결과 화면 (GOOD)", needGame(() => {
    memberBoardForced = true; // (배타 처리는 아래 resetPreviews를 쓰는 치트들과 같은 규칙)
    memberBoardResult = true;
  }), true);
  registerCheat("🎤 오디션 보기", needGame((c) => {
    if (c.state.membersLocked) { toast("데뷔조 확정 후엔 오디션 불가 — 새 런에서 시도하세요"); return; }
    if (!c.state.deck.includes("audition")) c.state.deck.push("audition"); // 진행권 없으면 지급
    memberBoardForced = true;
    memberBoardAudition = true;
  }), true);
  // 회차 이동 — 선택한 회차·막의 첫 비트까지 자동 진행.
  // 지나온 비트는 좌측 선택으로 넘기고 관문은 건너뛴다(치트 "1회차 완주"와 같은 방식).
  // 자동 진행은 선택 효과를 그대로 받으므로 게이지가 바닥나 런이 끝날 수 있다 —
  // 목적지에 닿는 것이 목적이므로 매 걸음 게이지를 안전선 위로 되올린다.
  registerJumpOps((loop, act, loop2) => {
    const SAFE = Math.round(config.gaugeMax * 0.6);
    const topUp = (c: RunController): void => {
      for (const k of ["skill", "mental", "reputation", "bond", "capital"] as const)
        if (c.state.gauges[k] < SAFE) c.state.gauges[k] = SAFE;
    };
    // 목적지를 이미 지나왔으면 처음부터 다시 — 뒤로 가는 수단이 없다
    const past = (c: RunController): boolean =>
      c.state.loopCount > loop || (c.state.loopCount === loop && c.state.act > act);
    if (!ctrl || ctrl.ended?.type === "ending" || past(ctrl)) ctrl = newRun();
    const c = ctrl;
    // 2회차 진행 모드는 **목적지 기준**으로 정한다. 회귀 시점에만 넣으면, 이미 2회차인 상태에서
    // 다시 2회차로 이동할 때 회귀가 일어나지 않아 null로 남고 빠른 모드 카드가 안 나온다.
    loop2Mode = loop === 2 ? loop2 : null;
    topUp(c);

    const step = (): void => {
      if (c.pendingGate) c.skipGate();
      else c.choose("left");
      topUp(c);
    };
    let guard = 3000; // 비트 95개 × 여유 — 무한 루프 방지
    // ① 목표 회차까지 (1→2회차는 1회차를 완주하고 회귀)
    while (c.state.loopCount < loop && guard-- > 0) {
      if (c.current) step();
      else if (c.ended?.type === "regress") c.regress(); // 회귀 화면(모드 선택)은 건너뛴다 — 모드는 위에서 이미 정했다
      else break;
    }
    // ② 목표 막의 첫 비트까지
    while (c.current && c.state.act < act && guard-- > 0) step();

    freeTraining = false;
    memberBoardForced = false;
    currentDraw(); // 게임 화면이면 즉시 반영. 로비에서는 no-op이라 안내 문구로 대신한다.
    if (guard <= 0) return "이동 실패 — 진행이 멈췄어요";
    if (!c.current) return `이동 실패 — ${loop}회차 ${act}막에 닿기 전에 회차가 끝났어요`;
    const where = `${c.state.loopCount}회차 ${c.state.act}막 · W${c.state.week}`;
    const tail = gameActive ? "" : " — START로 들어가면 그 지점부터 시작합니다";
    if (c.state.loopCount !== loop || c.state.act !== act) return `가장 가까운 지점: ${where}${tail}`;
    return `✅ ${where} · ${c.current.id}${tail}`;
  });

  registerCheat("🎓 튜토리얼·설정 리셋", () => {
    const n = resetTutorial();
    // 모든 설정 초기화 — 저장된 debutloop.* 키 제거 + 볼륨 기본값 복원
    for (const k of Object.keys(localStorage).filter((k) => k.startsWith("debutloop."))) localStorage.removeItem(k);
    setBgmVolume(DEFAULT_VOLUME);
    setBgmMuted(false);
    toast(`튜토리얼 ${n}건 + 설정 초기화 (볼륨 ${DEFAULT_VOLUME})`);
  });
  // 화면 직행 치트끼리는 배타 — 앞선 미리보기가 켜져 있으면 그 화면이 먼저 그려져
  // 새로 고른 화면이 안 뜬다(자유 연습 > 멤버 보드 > 관문 > 엔딩 순서로 그린다).
  const resetPreviews = (): void => {
    freeTraining = false;
    trainPreview = null;
    memberBoardForced = false;
    memberBoardResult = false;
    memberBoardRecheck = false;
    memberBoardAudition = false;
    gatePreview = null;
    endPreview = null;
  };
  // ── 판정결과 화면 직행 (레이아웃 점검용) ──
  // 관문·연습은 종류가 많아 드롭다운으로 고른다. 게임을 돌리지 않고 결과 화면부터 뜬다.
  const GRADE_OPTS = [
    { value: "perfect", label: "PERFECT" },
    { value: "good", label: "GOOD" },
    { value: "clear", label: "CLEAR" },
  ];
  registerCheatPick({
    label: "🎮 관문게임 판정결과",
    gameOnly: true,
    selects: [
      { id: "gate", options: gates.map((g) => ({ value: g.id, label: g.name })) },
      { id: "grade", options: GRADE_OPTS },
    ],
    run: (v) => {
      if (!ctrl || !gameActive) { toast("게임(회차) 진입 후 사용할 수 있어요"); return; }
      const g = gates.find((x) => x.id === v.gate);
      if (!g) return;
      resetPreviews();
      gatePreview = (v.grade as MiniGameGrade) ?? "good";
      ctrl.forceGate(g);
      currentDraw();
    },
  });
  const TRAIN_OPTS: Array<{ value: TrainingId; label: string }> = [
    { value: "vocal", label: "보컬 연습" }, { value: "dance", label: "안무 연습" },
    { value: "promo", label: "SNS 홍보" }, { value: "funds", label: "알바" },
    { value: "audition", label: "오디션 대비" }, { value: "bond", label: "휴식" },
  ];
  registerCheatPick({
    label: "🏋️ 연습하기 판정결과",
    gameOnly: true,
    selects: [
      { id: "act", options: TRAIN_OPTS },
      { id: "grade", options: GRADE_OPTS },
    ],
    run: (v) => {
      if (!ctrl || !gameActive) { toast("게임(회차) 진입 후 사용할 수 있어요"); return; }
      resetPreviews();
      trainPreview = { id: v.act as TrainingId, grade: (v.grade as MiniGameGrade) ?? "good" };
      freeTraining = true;
      currentDraw();
    },
  });
  registerCheat("🙅 새로운 후보 없음 화면", needGame(() => {
    resetPreviews();
    memberBoardForced = true;
    memberBoardRecheck = true;
  }), true);
  registerCheat("💀 파멸 붕괴 엔딩 화면", needGame(() => {
    resetPreviews();
    endPreview = { type: "ending", kind: "dark" };
  }), true);
  registerCheat("📅 데일리 출석 하루 넘기기", () => {
    const d = advanceMockDailyDay();
    toast(`데일리 ${d}일차 — 창을 다시 열면 반영됩니다`);
  });
  // 관문(스테이지 게임) 숏컷 — gates.json 기반 직접 실행
  const GATE_LABEL: Record<string, string> = {
    act2: "🥇 센터 대결 (1→2막)",
    act3: "🎯 무대 집중 (2→3막)",
    act4: "📷 포토카드 (3→4막)",
    clue4: "🔍 단서 대조 (4→5막)",
    block: "🎤 사보타주 저지 (5막)",
  };
  for (const g of gates) {
    registerCheat(GATE_LABEL[g.id] ?? `🎮 ${g.name}`, needGame((c) => { c.forceGate(g); }), true);
  }
  initCheatMenu();
  // 개발용 디버그 훅
  (window as unknown as { __game: unknown }).__game = {
    ctrl: () => ctrl,
    draw: () => { currentDraw(); },
  };
}

/** 게임(회차) 진입 — 뒤로(← 로비)로 나가면 resolve. 런 상태는 유지되어 재진입 시 이어짐. */
export function startApp(app: Application, assets: GameAssets, openPractice = false): Promise<void> {
  if (!ctrl) ctrl = newRun();
  const c0 = ctrl;
  // 로비(게임 진입 전)에서 카드 에디터로 추가한 대기 카드 지급
  for (const c of drainPendingCards()) c0.state.cards = addCard(c0.state.cards, c);

  const stageItems: Container[] = []; // 이번 진입에서 stage에 올린 것들 (퇴장 시 정리)
  let alive = true;                   // 퇴장 후 stale draw 방지 (배경 페이드 틱도 이 가드 사용)
  // 배경 레이어: 슬롯 전환형 — 기본 assets.background, 스토리 슬롯(bg 에디터) 도달 시 교체(300ms 페이드)
  const bgLayer = new Container();
  app.stage.addChild(bgLayer);
  stageItems.push(bgLayer);
  const fitCover = (spr: Sprite): void => {
    // cover — 소스는 전 기기 커버용 블리드 전제, 넘치는 상하는 크롭
    const s = Math.max(430 / spr.texture.width, stageHeight() / spr.texture.height);
    spr.scale.set(s);
    spr.x = (430 - spr.texture.width * s) / 2;
    spr.y = stageTop() + (stageHeight() - spr.texture.height * s) / 2;
  };
  const setBg = (tex: Texture, fade: boolean, dim = false): void => {
    const next = new Sprite(tex);
    fitCover(next);
    if (dim) { // 디밍 (bg 에디터 체크박스): AE 참고값 — Fast Box Blur 2.0×3 + Exposure −1(≈밝기 50%)
      const cm = new ColorMatrixFilter();
      cm.brightness(0.5, false);
      next.filters = [new BlurFilter({ strength: 2, quality: 3 }), cm];
    }
    if (!fade || bgLayer.children.length === 0) {
      for (const ch of [...bgLayer.children]) ch.destroy();
      bgLayer.addChild(next);
      return;
    }
    next.alpha = 0;
    bgLayer.addChild(next);
    const t0 = performance.now();
    const step = (): void => {
      if (!alive || next.destroyed) { app.ticker.remove(step); return; }
      next.alpha = Math.min(1, (performance.now() - t0) / 300);
      if (next.alpha >= 1) {
        app.ticker.remove(step);
        for (const ch of [...bgLayer.children]) if (ch !== next) ch.destroy();
      }
    };
    app.ticker.add(step);
  };
  // 기본 배경 선표시 제거 — 스토리 슬롯이 첫 프레임부터 직접 적용 (이전: 기본 배경 → 크로스페이드로 잔상 노출).
  // 기본 배경(assets.background)은 슬롯이 아예 없는 비트의 폴백(draw 분기)으로만 사용
  if (assets.background || bgManifest.story.length > 0) {
    const overlay = fullRect(0xf7f3fc, 0.15);
    app.stage.addChild(overlay);
    stageItems.push(overlay);
  }
  let bgSlotId: string | null = null; // 현재 적용된 스토리 배경 슬롯 (draw에서 전환 감지)
  let bgSlotVer = 0; // 같은 슬롯 파일 재업로드 감지용
  let bgAnimStop: (() => void) | null = null; // 배경 시퀀스(프롤로그) 순환 정지 함수
  /** 배경 적용 — 프레임 1장=정적, 여러 장=간격마다 크로스페이드 순환 (영상 효과) */
  const setBgFrames = (texs: Texture[], frameMs: number, dim = false): void => {
    bgAnimStop?.();
    bgAnimStop = null;
    const first = texs[0];
    if (!first) return;
    setBg(first, true, dim);
    if (texs.length < 2) return;
    let fi = 0;
    const iv = window.setInterval(() => {
      if (!alive) { window.clearInterval(iv); return; }
      fi = (fi + 1) % texs.length;
      const tex = texs[fi];
      if (tex) setBg(tex, true, dim);
    }, Math.max(400, frameMs));
    bgAnimStop = () => window.clearInterval(iv);
  };
  let nextBump: Partial<Gauges> = {}; // 직전 커밋의 게이지 변화량 → 다음 draw에서 강조+델타 팝
  freeTraining = openPractice;        // 🎹 자유 연습 (로비 연습 버튼으로 진입 시 즉시 오픈)
  memberBoardForced = false;          // 재진입 시 치트 보드 잔존 방지
  memberBoardAudition = false;
  let deckOpen = false;               // 하단 덱 시트 개폐 상태 (draw 간 유지)
  gameActive = true;                  // 치트 게임 전용 항목 활성화
  const root = new Container();
  app.stage.addChild(root);
  stageItems.push(root);

  let exit: () => void = () => {};

  function drawHeader(): void {
    const s = ctrl!.state;
    const clueTxt = s.clues.size > 0 ? ` · 🔍 ${s.clues.size}/4` : "";
    const head = new Text({
      text: `${s.loopCount}회차 · ${Math.min(6, Math.floor(s.week / 4) + 1)}개월 · W${s.week} · 데뷔까지 ${ddayWeeks(config.debutWeek, s.week)}주 · 카드 ${s.cards.length}${clueTxt}`,
      style: { fontSize: 12, fill: 0xa99bc0 },
    });
    const p = pos("header");
    head.x = p.x;
    head.y = p.y;
    if (head.x + head.width > 422) head.x = Math.max(8, 422 - head.width); // 우측 잘림 방지
    root.addChild(head);
    editable("header", head);
  }

  function drawBackBtn(): void {
    // 스토리 진행 중 로비로 나가기 (진행은 유지 — 재진입 시 이어서)
    const b = new Container();
    const p = pos("backBtn");
    b.x = p.x;
    b.y = p.y;
    // UI 공용 뒤로가기(ui-back) 우선 — 스토리 전용 game-back은 공용이 비었을 때만. 둘 다 원본 비율 유지
    const g = skinFit("game-btn-lobby", 93, 26) // 전용 슬롯 → 스토리 공용 → UI 공용 순
      ?? skinFit("ui-back", 93, 26)
      ?? skinFit("game-back", 93, 26)
      ?? new Graphics().roundRect(0, 0, 66, 26, 13).fill(0xf3ecfa).stroke({ width: 1.5, color: 0xe4d8f0 });
    const t = new Text({ text: "← 로비", style: { fontSize: 11.5, fill: BTN_INK, fontWeight: "bold" } });
    const pT = pos("backBtn_text", { x: 10, y: 6 }); // 버튼 안 문구 — 아트 교체에 맞춰 따로 조정
    t.x = pT.x;
    t.y = pT.y;
    b.addChild(g, t);
    pressable(b, () => exit());
    root.addChild(b);
    editable("backBtn", b);
    editable("backBtn_text", t); // 문구를 버튼과 별개로 옮기고 크기·색을 바꿀 수 있게
  }

  function drawMemberBtn(): void {
    // 멤버 점검 보드 수동 진입 — 📷 비트를 기다리지 않고 진행권·후보를 확인 (락인 후에도 열람 가능)
    const b = new Container();
    const p = pos("memberBtn", { x: 336, y: 122 }); // backBtn(21,122) 오른쪽 끝 대칭
    b.x = p.x;
    b.y = p.y;
    // 멤버 버튼은 뒤로가기가 아니므로 UI 공용 버튼(ui-btn) 사용 — 없으면 공용 뒤로가기 → 벡터
    const g = skinFit("game-btn-member", 93, 26) // 전용 슬롯 → UI 공용 순
      ?? skinFit("ui-btn", 93, 26)
      ?? skinFit("ui-back", 93, 26)
      ?? new Graphics().roundRect(0, 0, 72, 26, 13).fill(0xf3ecfa).stroke({ width: 1.5, color: 0xe4d8f0 });
    const t = new Text({ text: "👥 멤버", style: { fontSize: 11.5, fill: BTN_INK, fontWeight: "bold" } });
    const pT = pos("memberBtn_text", { x: 10, y: 6 }); // 버튼 안 문구 — 아트 교체에 맞춰 따로 조정
    t.x = pT.x;
    t.y = pT.y;
    b.addChild(g, t);
    pressable(b, () => { memberBoardForced = true; draw(); });
    root.addChild(b);
    editable("memberBtn", b);
    editable("memberBtn_text", t); // 문구를 버튼과 별개로 옮기고 크기·색을 바꿀 수 있게
  }

  function draw(): void {
    if (!alive || !ctrl) return; // 퇴장 후 stale 호출 무시
    const c = ctrl;
    // 스토리 배경 전환 — 현재 비트 기준 슬롯 계산, 바뀌었을 때만 lazy load(캐시) 후 페이드 교체
    const bgSlot = c.current ? pickBgSlot(c.current) : null;
    const bgFiles = bgSlot ? (bgSlot.frames && bgSlot.frames.length > 0 ? bgSlot.frames : [bgSlot.file]).filter(Boolean) : [];
    const nextBgVer = assetVersion(bgFiles);
    if ((bgSlot?.id ?? null) !== bgSlotId || nextBgVer !== bgSlotVer) {
      bgSlotId = bgSlot?.id ?? null;
      bgSlotVer = nextBgVer;
      if (!bgSlot || bgFiles.length === 0) {
        bgAnimStop?.();
        bgAnimStop = null;
        if (assets.background) setBg(assets.background, true);
      } else {
        const want = bgSlot.id;
        void Promise.all(bgFiles.map((f) => Assets.load<Texture>(assetUrl(f) ?? f)))
          .then((texs) => { if (alive && bgSlotId === want) setBgFrames(texs, bgSlot.frameMs ?? 1200, bgSlot.dim === true); })
          .catch(() => {}); // 미업로드 슬롯 → 기존 배경 유지
      }
    }
    beginFrame();
    root.removeChildren();
    // BGM 장면 배선 (bgm.json 슬롯): 연습 > 관문(격자/슬롯) > 회귀·엔딩 > 메인 스토리.
    // 리듬은 ▶ 시작 전까지 메인 유지 — begin()에서 아케이드를 처음부터 재생 (가위바위보·오디션은 mountEngine에서 전환)
    const eng = c.pendingGate?.engine;
    const trainingOpen = freeTraining || (c.current && !c.pendingGate && c.state.week > lastTrainWeek);
    playBgm(trainingOpen ? "training"
      : eng === "dodge" ? "dodge"
      : eng === "slot" ? "slot-bgm" // 배경음은 루프, 릴 사운드('slot' 큐)는 스핀 시작/정지에 맞춰 runSlot이 재생
      : c.ended?.type === "regress" ? "regress"
      : c.ended?.type === "ending" ? (c.ended.kind === "true" ? "true" : "dark")
      : bgSlot?.id.startsWith("prologue") ? bgSlot.id // 프롤로그 오디오 — 배경 슬롯과 같은 비트 기준
      : "main");
    const panel = renderGauges(root, c.state, { bump: nextBump, ticker: app.ticker });
    nextBump = {};
    // 재도전 페널티(멘탈 −1)는 연습 화면이 스스로 다시 그리는 흐름이라 draw()를 타지 않는다.
    // draw()를 부르면 연습이 활동 선택 화면으로 되돌아가므로, 게이지 바만 즉시 갱신한다.
    // 델타는 실제 변화량으로 — 멘탈이 이미 0이면 깎이지 않아 −1로 표시하면 거짓말이 된다.
    let mentalBefore = c.state.gauges.mental;
    const commitRetryPenalty = (): void => {
      panel.commit({ mental: c.state.gauges.mental - mentalBefore });
      mentalBefore = c.state.gauges.mental;
    };
    if (!skinTex("game-gauge-bar")) drawHeader(); // 상태바 스킨 사용 시 헤더 정보는 바 하단 탭에 통합됨

    if (endPreview) { // 💀 치트 미리보기 — 스토리 카드보다 먼저 (아래 정식 분기는 c.ended용)
      renderEndScreen(root, endPreview, c.state, () => { endPreview = null; draw(); });
      return;
    }
    if (freeTraining) { // 🎹 자유 연습 (비트 진행 없음)
      renderTrainingBoard(root, {
        act: c.state.act, week: c.state.week, loopCount: c.state.loopCount,
        ticker: app.ticker, free: true,
        charAssets: assets.char("haru"),
        preview: trainPreview ?? undefined, // 치트로 고른 연습 판정결과 (1회 소비)
        onFinish: (activity, grade) => { c.trainFree(activity, grade); freeTraining = false; trainPreview = null; draw(); },
        onSkip: () => { freeTraining = false; trainPreview = null; draw(); },
        onRetryPenalty: () => { c.retryTraining(); commitRetryPenalty(); }, // free여도 페널티는 컨트롤러 규칙 재사용
      });
      return;
    }
    // 멤버 점검 보드 — 📷 이벤트 직후·W18 락인 연출·치트 (주간 연습보다 먼저)
    // 단, 관문이 진행 중이면 보드는 기다린다 — 안 그러면 미니게임 화면 위에 보드가 그려져
    // 게임이 사라진 것처럼 보이고 키·탭이 전부 보드로 가버린다 (주간 연습도 같은 규칙).
    // 치트(memberBoardForced)는 의도적 진입이므로 그대로 연다.
    if ((c.memberWindowOpen && !c.pendingGate) || memberBoardForced) {
      if (!c.state.membersLocked) // 치트 진입에도 표시 — 자원 사슬(카드→진행권→개최) 3단계 안내
        guideSeq("memberBoard2", [
          ["yuwol", "여기가 <b>멤버 점검 보드</b>야. 남은 자리는 우리가 직접 채워 — 멤버를 탭하면 상태를 볼 수 있어."],
          ["yuwol", "🎯 <b>오디션 카드</b>는 연습 '오디션 대비'에서 받아. 관문에서도 쓸 수 있는 카드지만, <b>3장 모으면 🎫 진행권</b>으로 바꿀 수 있어 — 어디에 쓸지는 선택!"],
          ["yuwol", "🎫 진행권이 있으면 <b>🎤 오디션 개최</b>! 무대 성적이 좋을수록 <b>기량 높은 후보</b>가 와. 마음에 들면 바로 영입하자."],
        ]);
      const startAudition = memberBoardAudition;
      memberBoardAudition = false; // 1회 소비 — 이후 리드로우는 점검 화면부터
      const previewResult = memberBoardResult ? "good" as const : undefined;
      memberBoardResult = false; // 1회 소비
      const previewRecheck = memberBoardRecheck;
      memberBoardRecheck = false; // 1회 소비
      renderMemberBoard(root, {
        ctrl: c, ticker: app.ticker, startAudition, previewResult, previewRecheck,
        // 센터 스테이지 대형 프로필 — bust 우선, 미제작 캐릭터는 전신 아트로 폴백 (보드가 상반신만 크롭)
        bustOf: (id) => { const a = assets.char(id); return a.profileFace ?? a.bust ?? a.daily ?? a.stand ?? a.stage; }, // 밝은 표정 우선
        onClose: () => { c.closeMemberWindow(); memberBoardForced = false; draw(); },
        onChanged: () => {}, // 보드 조작은 게이지 무변동 — 헤더 갱신은 닫을 때 draw로 일괄
      });
      return;
    }
    // 주간 연습 — 주(week)가 넘어갈 때마다 오픈 (비트 기준 아님, 관문보다 후순위·비트 진행 없음)
    if (c.state.week < lastTrainWeek) lastTrainWeek = c.state.week; // 회귀·새 런으로 주가 되돌아가면 기준도 복귀
    if (c.current && !c.pendingGate && c.state.week > lastTrainWeek) {
      guide("training", "yuwol", "매주 연습 시간이 생겨! 연습하면 <b>카드</b>를 받아 — 잘할수록 좋은 카드야. 모아뒀다가 큰 무대에서 쓰는 거지.");
      renderTrainingBoard(root, {
        act: c.state.act, week: c.state.week, loopCount: c.state.loopCount,
        ticker: app.ticker,
        charAssets: assets.char("haru"),
        onFinish: (activity, grade) => { c.trainFree(activity, grade); lastTrainWeek = c.state.week; draw(); },
        onSkip: () => { lastTrainWeek = c.state.week; draw(); },
        onRetryPenalty: () => { c.retryTraining(); commitRetryPenalty(); },
      });
      return;
    }
    if (c.pendingGate) { // 관문 미니게임 우선
      const gate = c.pendingGate;
      // 난이도 스케일 기준 막: 막 관문=trigger.act, 비트 관문=해당 비트의 act (치트 실행에도 정확)
      const gateAct = gate.trigger.act
        ?? beats.find((b) => b.id === gate.trigger.beatId)?.act
        ?? c.state.act;
      renderGate(root, gate, gateAct, app.ticker,
        () => c.state.cards,
        (grade, picked) => {
          const delta = c.settleGateRound(grade, picked); // 라운드 즉시 정산
          panel.commit(delta);                            // HUD 게이지 즉시 반영 + bump 강조
          return delta;
        },
        () => { c.finishGate(); draw(); },                // 전 라운드 종료 → 티켓 지급·진행 재개
        () => { c.retryGate(); draw(); },
        () => { c.skipGate(); draw(); },
        assets.gateBg(gate.engine, gate.id), // 관문 배경: id 슬롯(bg 에디터) 우선 → 엔진 기본
        () => { c.state.points += 1; }, // 리듬 하드(3열) 클리어 보너스 +1pt
        statusLine({ loop: c.state.loopCount, week: c.state.week, debutWeek: config.debutWeek,
          cards: c.state.cards.length, clues: c.state.clues.size }), // 포토카드 배경판 상단 탭 — 로비·스토리와 같은 문구
        gatePreview ?? undefined); // 치트로 고른 관문 판정결과 (아래에서 1회 소비)
      gatePreview = null;
      return;
    }
    if (c.current) {
      // 빠른 모드: seen + 1회차 선택 기록이 있으면 탭 1회 재적용 카드 (기록 없으면 기존 축약 카드 폴백)
      const replayDir = loop2Mode === "fast" && c.seen ? c.state.choices[c.current.id] : undefined;
      if (replayDir) guide("loop2fast", "yuwol", "이미 겪은 장면은 <b>탭 한 번</b>에 지나가! 🆕 새로운 장면이 나오면 멈춰서 잘 골라야 해.");
      else guide("swipe", "haru", "밀어서 선택하자. 👈 왼쪽… 👉 오른쪽. <b>누르고 있으면 결과가 미리 보여.</b>");
      if (c.state.cards.length > 0) guide("deck", "yuwol", "받은 카드는 <b>아래에서 위로 쓸어올리면</b> 언제든 볼 수 있어.");
      drawBackBtn();
      drawMemberBtn(); // 👥 멤버 보드 수동 진입 (지적 ⑩)
      // 역할 토큰 렌더: 정적 캐스팅(정 실장) + 오디션 영입(role→characterId→이름) 병합
      const castMap: Record<string, string> = { ...casting };
      for (const [role, id] of Object.entries(c.state.casting)) {
        const ch = characters.find((x) => x.id === id);
        if (ch) castMap[role] = ch.name;
      }
      renderCard(root, c.current, castMap, (dir) => {
        nextBump = c.current?.[dir]?.effects?.gauges ?? {};
        c.choose(dir);
        draw();
      }, {
        seen: loop2Mode === "normal" ? false : c.seen, // 정속 모드 = 1회차와 완전 동일 (축약 없음)
        replay: replayDir,
        portrait: assets.char("haru").bust, // 카드 상단 초상 (없으면 텍스트만)
        idleFrames: assets.char("haru").bustIdleFrames, // 숨쉬기 idle — 있으면 정지 초상 대신 재생
        tiltLeft: assets.char("haru").tiltLeft,   // 드래그 갸웃 시퀀스 (char.html 업로드 시 활성)
        tiltRight: assets.char("haru").tiltRight,
        portraitScale: { // char.html 배율 스테퍼 — 렌더 시점 조회라 저장 즉시 반영
          idle: assets.char("haru").scaleOf("exp-base-idle"),
          tiltLeft: assets.char("haru").scaleOf("tilt-left-idle"),
          tiltRight: assets.char("haru").scaleOf("tilt-right-idle"),
        },
        onPreview: (dir, t) => panel.showPreview(c.current?.[dir]?.effects, t),
        onPreviewClear: () => panel.clearPreview(),
      });
      // 하단 카드덱 시트 — 로비와 같은 컴포넌트, 스토리 진행 중 수시 열람 (상하 스와이프/탭)
      renderCardDeckSheet(root, {
        cards: visibleCards, // 로비 덱·상단 표기와 같은 출처
        open: deckOpen,
        onToggle: (o) => { deckOpen = o; },
        tapMode: "lift", // 진행 중엔 앞면이 보여야 하므로 뒤집지 않고 살짝 떠오르기만
      });
      return;
    }
    if (c.ended) {
      const ev = c.ended;
      renderEndScreen(root, ev, c.state, (mode) => {
        if (ev.type === "regress") {
          loop2Mode = mode ?? "fast";
          c.regress();
        } else {
          ctrl = newRun(); // 엔딩 → 새 런
          loop2Mode = null;
        }
        draw();
      });
    }
  }
  currentDraw = draw;
  onRedraw(draw); // 로비(build)가 가져간 에디터 리드로우를 게임 진입 시 되찾음

  // 카드 에디터 연산 — 1회 등록, 모듈 ctrl 참조 (로비 복귀 후에도 유효)
  if (isDevMode() && !cardOpsInited) {
    cardOpsInited = true;
    registerCardOps({
      add: (templateId, grade) => {
        if (!ctrl) return;
        // 실제 획득과 같은 규칙 — 게이지마다 한 장
        for (const card of makeCards(templateId, grade, cardTemplates)) ctrl.state.cards = addCard(ctrl.state.cards, card);
        currentDraw();
      },
      remove: (templateId, grade) => {
        if (!ctrl) return;
        const i = ctrl.state.cards.findIndex((c) => c.templateId === templateId && c.grade === grade);
        if (i >= 0) { ctrl.state.cards = removeCards(ctrl.state.cards, [i]); currentDraw(); }
      },
      counts: (templateId) => {
        const out = { common: 0, rare: 0, epic: 0 };
        for (const c of ctrl?.state.cards ?? []) if (c.templateId === templateId) out[c.grade]++;
        return out;
      },
    });
  }

  draw();

  return new Promise<void>((resolve) => {
    exit = (): void => {
      alive = false;
      bgAnimStop?.(); // 배경 시퀀스 타이머 해제
      gameActive = false; // 로비 복귀 — 게임 전용 치트 비활성화
      for (const it of stageItems) { app.stage.removeChild(it); it.destroy({ children: true }); }
      resolve();
    };
  });
}
