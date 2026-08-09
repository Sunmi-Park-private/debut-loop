// ui/training.ts — A안: 프메 커맨드 보드 연습 화면 (Pixi v8).
// 좌측 캐릭터 스탠딩(placeholder) + 말풍선, 우측 세로 커맨드 리스트.
// 판정은 engine, 카드·소모 반영은 컨트롤러 — 여긴 렌더+입력만.
import { AnimatedSprite, Assets, Container, Graphics, Rectangle, Sprite, Text, type Texture, type Ticker } from "pixi.js";
import type { MiniGameGrade, TrainingId, CardGrade } from "../engine/types";
import { starNode, gaugeSymbol, fanAngle } from "./cardArt";
import { templateGauges } from "../engine/cards";
import { pressable } from "./press";
import { TRAIN_DRAIN, TRAIN_GRADE_TO_CARD, resolveTraining } from "../engine/training";
import { MATCH_CARDS } from "../engine/minigames";
import { mountEngine, txt, btn, fxConfetti, MG_W, MG_H, INK, SUB, PINK, LAV } from "./minigames";
import { skinNode, skinFit, skinNatural, skinTexTrim, skinScale } from "./uiSkin";
import { cardTemplates } from "../data";
import { pos } from "./layout";
import { fullRect } from "./stage";
import { pairSpace } from "./keys";
import { editable, setEditorToggleHook, setRedrawHook } from "./editor";
import { systemBgFile } from "./bgSlots";
import { assetUrl } from "./hotAssets";
import { isVideoUrl, loadVideoTexture } from "./videoLoad";
import type { CharAssets } from "./assets";

const W = MG_W;
const H = 610;
const GLBL: Record<string, string> = { skill: "실력", mental: "멘탈", reputation: "평판", bond: "유대", capital: "자본" };
// 연습 결과 카드 — 여러 장이면 손패처럼 겹쳐 V자로 편다
const CW2 = 120;           // 카드 폭
const CH2 = 160;           // 카드 높이 (회전축을 밑변 가운데로 잡는 기준)
const FAN_OVERLAP = 50;    // 옆 카드와 겹치는 폭

interface Activity {
  id: TrainingId;
  engine: "rps" | "stop" | "match" | "rest";
  skin?: string;
  gameLabel: string;
}
const ACTIVITIES: Activity[] = [
  { id: "vocal", engine: "stop", skin: "studio", gameLabel: "STOP" }, // 레코딩 스튜디오 컨셉
  { id: "dance", engine: "stop", skin: "mirror", gameLabel: "STOP" }, // 거울 포즈 매칭 컨셉
  { id: "promo", engine: "match", skin: "promo", gameLabel: "짝맞추기" },
  { id: "funds", engine: "stop", gameLabel: "STOP" },
  { id: "audition", engine: "rps", gameLabel: "가위바위포즈" },
  { id: "bond", engine: "rest", gameLabel: "즉시" },
];
const ACT_NAME: Record<TrainingId, string> = {
  vocal: "보컬 연습", dance: "안무 연습", promo: "SNS 홍보", funds: "알바", audition: "오디션 대비", bond: "휴식",
};

/** 커맨드 목록의 카드 표기 — "🎴 유대 카드 2장 (유대·멘탈)".
 *  원형이 올리는 게이지마다 한 장씩 주므로 이름만 적으면 실제 장수와 어긋난다. */
const cardChipLabel = (id: TrainingId): string => {
  const t = cardTemplates.find((c) => c.id === id);
  if (!t) return "";
  const gauges = templateGauges(t);
  const names = gauges.map((g) => GLBL[g] ?? g).join("·");
  const count = gauges.length > 1 ? ` ${gauges.length}장` : "";
  return `🎴 ${t.name}${count} (${names})`;
};

const drainLabel = (id: TrainingId): string => {
  const d = TRAIN_DRAIN[id];
  const parts = Object.entries(d).map(([k, v]) => `${GLBL[k] ?? k} ${v}`);
  return parts.length ? parts.join(" · ") : "소모 없음";
};

export interface TrainingOpts {
  act: number;                 // 미니게임 난이도 스케일
  week: number;
  loopCount: number;
  ticker: Ticker;
  free?: boolean;              // 자유 연습(상시 버튼) — 건너뛰기 문구만 다름
  charAssets?: CharAssets;     // 캐릭터 스탠딩/idle (없으면 실루엣 플레이스홀더)
  onFinish: (activity: TrainingId, grade: MiniGameGrade) => void;
  onSkip: () => void;          // 건너뛰기/닫기
  onRetryPenalty: () => void;  // 재도전 멘탈 −1 (화면은 여기서 다시 그림)
}

export function renderTrainingBoard(parent: Container, opts: TrainingOpts): void {
  const dim = fullRect(0x5b4a70, 0.35);
  dim.eventMode = "static";
  parent.addChild(dim);

  const panel = new Container();
  const p = pos("training");
  panel.x = p.x;
  panel.y = p.y;
  parent.addChild(panel);
  editable("training", panel);

  // 패널 장식(프레임·헤더·배경) — 미니게임 화면에서는 종목 배경판과 크기가 안 맞아 통째로 숨긴다
  const chrome: Container[] = [];
  let chromeOn = true;
  const setChrome = (v: boolean): void => {
    chromeOn = v;
    for (const c of chrome) c.visible = v;
  };

  // 패널 프레임 — 전용 스킨 → 공통 프레임(ui-frame) 순 폴백 (둘 다 없으면 미표시)
  const panelSkin = skinNode("train-panel", W, H) ?? skinNode("ui-frame", W, H);
  if (panelSkin) { panel.addChild(panelSkin); chrome.push(panelSkin); }

  // 테두리 라인 — 배경 위에 덧그리는 별도 레이어. 배경을 바꿔도 테두리는 그대로 남고,
  // 위치·배율은 레이아웃 에디터(train_frame)에서 따로 잡는다.
  const frameSkin = skinFit("train-frame", W, H); // 원본 비율 유지 — 배율·위치는 에디터에서
  if (frameSkin) {
    const fp = pos("train_frame", { x: 0, y: 0 });
    frameSkin.x = fp.x;
    frameSkin.y = fp.y;
    panel.addChild(frameSkin);
    chrome.push(frameSkin);
    editable("train_frame", frameSkin);
  }

  // 헤더: train-title(플로팅 타이틀 패널) 업로드 시 그걸로, 없으면 기존 헤더 스트립
  const titleSkin = skinNode("train-title", 250, 82);
  // 주차·회차 문구 — 레이아웃 에디터(train_week)로 위치 조정 가능 (우상단 X 버튼과 겹침 회피용)
  const wk = txt(`W${opts.week} · ${opts.loopCount}회차`, 12, 0xc9527f, true);
  const wkp = pos("train_week", { x: W - wk.width - 18, y: 18 });
  wk.x = wkp.x;
  wk.y = wkp.y;
  editable("train_week", wk);
  if (titleSkin) { // 타이틀 문구는 이미지에 구워진 전제 — 주차 표기만 오버레이
    const tp = pos("train_title", { x: 8, y: 4 });
    titleSkin.x = tp.x;
    titleSkin.y = tp.y;
    panel.addChild(titleSkin, wk);
    chrome.push(titleSkin, wk);
    editable("train_title", titleSkin);
  } else {
    const headSkin = skinNode("train-head", W - 6, 46); // 헤더 스트립 — 스킨 전용 (빈 슬롯은 텍스트만)
    if (headSkin) {
      headSkin.x = 3;
      headSkin.y = 3;
      panel.addChild(headSkin);
      chrome.push(headSkin);
    }
    const title = txt("🎹 연습 시간", 17, INK, true);
    title.x = 18;
    title.y = 15;
    panel.addChild(title, wk);
    chrome.push(title, wk);
  }

  const body = new Container();
  body.y = 52;
  panel.addChild(body);
  const clear = (): void => { body.removeChildren(); };

  // 활동별 레이아웃 키 네임스페이스 — 연습 6종의 게임·결과 패널을 따로 배치 (메뉴 화면은 공통)
  let ns = "";
  // 활동 화면에서는 에디터 토글 시 리드로우를 막는다 (안 막으면 메뉴로 튕겨서 게임·결과 패널을 편집할 수 없음)
  // 활동 화면에서는 배율/농도 변경 리드로우도 이 화면만 다시 그린다 (안 하면 메뉴로 튕김)
  const setNs = (v: string, rerender: () => void = () => {}): void => {
    ns = v;
    setEditorToggleHook(v ? () => true : null);
    setRedrawHook(v ? rerender : null);
  };
  // 컴포넌트 그룹: layout.json 오프셋(기본 0,0) + 레이아웃 에디터 드래그 등록
  // ns가 있으면 전용 키(vocal_train_res_grade 등) — 미저장 시 공통 키 값을 승계해 현재 위치 유지
  const grpIn = (parent: Container, name: string, ...items: Container[]): Container => {
    const key = ns ? `${ns}_${name}` : name;
    const g2 = new Container();
    const gp = ns ? pos(key, pos(name, { x: 0, y: 0 })) : pos(name, { x: 0, y: 0 });
    g2.x = gp.x;
    g2.y = gp.y;
    if (items.length > 0) g2.addChild(...items);
    parent.addChild(g2);
    editable(key, g2);
    return g2;
  };
  const grp = (name: string, ...items: Container[]): Container => grpIn(body, name, ...items);
  /** 버튼 안 문구를 따로 등록 — 버튼 아트를 바꾸면 폭이 달라져 문구만 미세조정해야 한다.
   *  기본값은 btn()이 잡아준 가운데 정렬이라 저장된 값이 없으면 지금 배치 그대로다. */
  const btnLabel = (name: string, b: Container): void => {
    const t = b.children.find((c): c is Text => c instanceof Text);
    if (!t) return;
    const key = ns ? `${ns}_${name}_text` : `${name}_text`;
    const q = pos(key, { x: Math.round(t.x), y: Math.round(t.y) });
    t.x = q.x;
    t.y = q.y;
    editable(key, t);
  };
  /** 변형 전용 키 그룹 — 저장값이 없으면 기본 키(fb) 좌표를 승계 (예: 3×3 그리드 제목이 기존 값을 물려받음) */
  const grpFb = (name: string, fb: string, ...items: Container[]): Container => {
    const key = ns ? `${ns}_${name}` : name;
    const base = ns ? pos(`${ns}_${fb}`, pos(fb, { x: 0, y: 0 })) : pos(fb, { x: 0, y: 0 });
    const g2 = new Container();
    const gp = pos(key, base);
    g2.x = gp.x;
    g2.y = gp.y;
    g2.addChild(...items);
    body.addChild(g2);
    editable(key, g2);
    return g2;
  };

  // ── 메뉴 화면 (좌: 캐릭터 / 우: 커맨드 — 긴 타원 우측 곡선 배치) ──
  const showMenu = (): void => {
    clear();
    setNs(""); // 메뉴는 공통 키
    setChrome(true);
    // 우상단 X 버튼 — 유일한 닫기/건너뛰기 수단. UI 공통 스킨(ui-close-x) 우선, 없으면 벡터 (항상 표시)
    const xBtn = new Container();
    const xSkin = skinNatural("ui-close-x", 36, 36); // 1배율=원본 크기
    if (xSkin) {
      xBtn.addChild(xSkin);
    } else {
      xBtn.addChild(new Graphics().roundRect(0, 0, 36, 36, 11).fill(0xf3ecfa).stroke({ width: 1.5, color: 0xdccdec }));
      const xt = txt("✕", 16, SUB, true);
      xt.x = (36 - xt.width) / 2;
      xt.y = (36 - xt.height) / 2;
      xBtn.addChild(xt);
    }
    const xp = pos("train_close_x", { x: W - 46, y: -44 }); // body 좌표(y=52 오프셋) 기준 패널 우상단
    xBtn.x = xp.x;
    xBtn.y = xp.y;
    xBtn.eventMode = "static";
    xBtn.cursor = "pointer";
    xBtn.on("pointertap", opts.onSkip);
    body.addChild(xBtn);
    editable("train_close_x", xBtn);
    // 배경 (bg.html 'training' 슬롯 — 미업로드면 패널 그대로). 영상도 지원 (Safari-safe 로더)
    const bgFile = systemBgFile("training");
    if (bgFile) {
      const load = isVideoUrl(bgFile)
        ? loadVideoTexture(assetUrl(bgFile) ?? bgFile)
        : Assets.load<Texture>(assetUrl(bgFile) ?? bgFile);
      void load.then((tex) => {
        if (panel.destroyed) return;
        const area = { x: 3, y: 3, w: W - 6, h: H - 6 }; // 패널 내부 (패널 좌표)
        const wrap = new Container();
        const spr = new Sprite(tex);
        const sc = Math.max(area.w / tex.width, area.h / tex.height); // cover — 블리드 전제 소스
        spr.scale.set(sc);
        spr.x = area.x + (area.w - tex.width * sc) / 2;
        spr.y = area.y + (area.h - tex.height * sc) / 2;
        const mask = new Graphics().roundRect(area.x, area.y, area.w, area.h, 16).fill(0xffffff);
        wrap.mask = mask;
        wrap.addChild(spr);
        // 패널 바탕 바로 위 레이어 — 헤더·본문(body)보다 아래라 UI를 가리지 않음
        panel.addChildAt(mask, 1);
        panel.addChildAt(wrap, 1);
        wrap.visible = chromeOn; // 미니게임 중이면 같이 숨김 (비동기 로드가 늦게 도착하는 경우)
        chrome.push(wrap);
      }).catch(() => {});
    }
    // 좌측: 캐릭터 영역
    const BOTTOM = H - 52; // body 좌표계의 패널 안쪽 바닥
    // 대사(명패) — 닫기 버튼 바로 위, 좌측 하단. 기준 폭 200 × 에디터 배율(0.5~2), 높이는 아트 비율 유지
    const bubTex = skinTexTrim("train-bubble");
    const BUB_W = bubTex ? Math.round(200 * skinScale("train-bubble")) : 200;
    const BUB_H = bubTex ? Math.round(BUB_W * (bubTex.height / bubTex.width)) : 150;
    let bubbleSkin: Sprite | null = null;
    if (bubTex) {
      bubbleSkin = new Sprite(bubTex);
      bubbleSkin.width = BUB_W; // 비율 그대로 (BUB_H가 원본 비율에서 계산됨)
      bubbleSkin.height = BUB_H;
    }
    const bubY = BOTTOM - 34 - (bubbleSkin ? BUB_H : 58) - 10;
    if (bubbleSkin) {
      bubbleSkin.x = 14;
      bubbleSkin.y = bubY;
      bubbleSkin.alpha = 0.85; // 반투명 재질 — 뒤 배경·캐릭터가 은은하게 비침 (텍스트는 불투명 유지)
    }
    const bubbleT = txt("오늘은 어떤 연습을 할까요? 몸 상태를 봐가면서 정해요!", 11, INK);
    bubbleT.style.wordWrapWidth = Math.round(BUB_W * 0.79); // 말풍선 폭 비례
    bubbleT.x = 14 + Math.round(BUB_W * 0.09);
    bubbleT.y = bubY + (bubbleSkin ? Math.round(BUB_H * 0.31) : 10); // 명패 안 대사 위치 = 높이 비례
    const charGrp = grp("train_char");
    // 캐릭터 스탠딩: idle 시퀀스 > 정지 스탠딩 > 상반신 > 실루엣 플레이스홀더 순 폴백
    const ca = opts.charAssets;
    const FIG = { x: 20, y: 20, w: 180, h: 380 }; // 표시 영역 — 대사가 하단으로 내려간 만큼 위로
    const fit = (sprW: number, sprH: number): number => Math.min(FIG.w / sprW, FIG.h / sprH);
    const standSeq = ca && ca.practiceFrames.length > 1 ? ca.practiceFrames : ca?.idleFrames ?? [];
    if (ca && standSeq.length > 1) { // 연습복 시퀀스(practice-idle) 우선 → 레거시 idle 시퀀스
      const first = standSeq[0];
      const fw = first?.width ?? 1;
      const fh = first?.height ?? 1;
      const anim = new AnimatedSprite(standSeq);
      anim.animationSpeed = ca.practiceFrames.length > 1 ? 8 / 60 : ca.idleFps / 60; // 신규 시퀀스=8fps 통일
      anim.play();
      const s = fit(fw, fh) * ca.scaleOf("practice"); // char.html 배율 (발밑 고정, 위로 커짐)
      anim.scale.set(s);
      anim.x = FIG.x + (FIG.w - fw * s) / 2;
      anim.y = FIG.y + FIG.h - fh * s;
      charGrp.addChild(anim);
    } else if (ca?.stand ?? ca?.bust) {
      const tex = ca?.stand ?? ca?.bust;
      if (tex) {
        const spr = new Sprite(tex);
        const s = fit(tex.width, tex.height) * (ca?.scaleOf(ca.stand ? "practice" : "bust") ?? 1); // char.html 배율
        spr.scale.set(s);
        spr.x = FIG.x + (FIG.w - tex.width * s) / 2;
        spr.y = FIG.y + FIG.h - tex.height * s;
        charGrp.addChild(spr);
      }
    }
    // 캐릭터 미업로드 시 미표시 (빈 슬롯 숨김 — 실루엣 플레이스홀더 제거)

    // 명패는 캐릭터와 별도 그룹(독립 이동) — 캐릭터 뒤에 생성해 다리 위로 겹침 (목업과 동일)
    grp("train_bubble", ...(bubbleSkin ? [bubbleSkin, bubbleT] : [bubbleT]));

    // 우측: 커맨드 리스트 — 캐릭터를 감싸는 긴 타원의 우측 곡선 배치 (가운데 행이 가장 바깥쪽)
    const rowsGrp = grp("train_rows");
    // 패널 밖으로 삐져나오는 배너·컬럼은 패널 안쪽 라운드에 맞춰 클리핑
    const rowsMask = new Graphics().roundRect(3, -49, W - 6, H - 6, 16).fill(0xffffff);
    body.addChild(rowsMask);
    rowsGrp.mask = rowsMask;
    // 우측 컬럼 배경 (train-row — 직사각형 통짜 아트, 100% 크기) — 행 뒤 레이어
    const COL_H = 516;
    const colP = pos("train_colbg", { x: 192, y: 18 });
    const colBg = skinNode("train-row", 232, COL_H);
    if (colBg) {
      colBg.x = colP.x;
      colBg.y = colP.y;
      rowsGrp.addChild(colBg);
      editable("train_colbg", colBg);
    }
    // 버튼 6종 묶음의 세로 중심 = 컬럼 배경 중심 (컬럼을 에디터로 옮기면 기본값도 따라감)
    const blockH = (ACTIVITIES.length - 1) * 66 + 56;
    const rowY0 = Math.round(colP.y + (COL_H - blockH) / 2);
    // 수평 정렬 — 부챗살 회전·타원 오프셋 제거 (Director 지시). x 고정, y만 66px 간격
    ACTIVITIES.forEach((a, i) => {
      const t = cardTemplates.find((c) => c.id === a.id);
      const row = new Container();
      // 행 간격 66px (배너 56 + 순 간격 10) · 묶음 중심 = 컬럼 중심
      const rp = pos(`train_row_${a.id}`, { x: 218, y: rowY0 + i * 66 });
      row.x = rp.x;
      row.y = rp.y;
      // 활동 배너 = train-icon-* 통짜 아트 (원형 아이콘+필, 텍스트는 코드 오버레이) — 없으면 벡터+이모지
      const banner = skinNode(`train-icon-${a.id}`, 246, 56); // 706×161 비율 유지 (우측은 화면 밖으로 블리드)
      let tx = 36;
      if (banner) {
        row.addChild(banner);
        tx = 62; // 아트의 원형 아이콘 오른쪽부터 텍스트
      } else {
        const rbg = new Graphics().roundRect(0, 0, 166, 70, 12)
          .fill(a.engine === "rest" ? 0xf2fbf8 : 0xffffff).stroke({ width: 2, color: 0xece4f4 });
        const ic = txt(t?.icon ?? "🎵", 20, INK);
        ic.x = 8;
        ic.y = 8;
        row.addChild(rbg, ic);
      }
      const nm = txt(ACT_NAME[a.id], 12.5, INK, true);
      nm.x = tx;
      nm.y = banner ? 4 : 8;
      const fx = txt(`${drainLabel(a.id)} · ${a.gameLabel}`, 9, SUB);
      fx.x = tx;
      fx.y = banner ? 22 : 28;
      // 실제로 받는 장수와 게이지를 그대로 적는다 — 게이지가 둘이면 두 장이라 이름만으론 어긋난다.
      // 휴식도 미니게임 없이 바로 카드를 주므로 다른 활동과 같은 표기를 쓴다.
      const chip = txt(cardChipLabel(a.id), 9, 0xc9527f, true);
      chip.x = tx;
      chip.y = banner ? 38 : 46;
      row.addChild(nm, fx, chip);
      // 터치 영역을 패널 안쪽까지로 제한 — 마스크는 표시만 자르고 히트테스트는 못 막음
      // (hitArea는 row 자신에 남으므로 pressable이 내용물을 감싸도 판정 범위는 그대로다)
      const bw = banner ? 246 : 166;
      const bh = banner ? 56 : 70;
      row.hitArea = new Rectangle(0, 0, Math.max(40, Math.min(bw, W - 3 - rp.x)), bh);
      pressable(row, () => pick(a));
      rowsGrp.addChild(row);
      editable(`train_row_${a.id}`, row);
    });

    // 하단 닫기 버튼 제거 — 닫기/건너뛰기는 우상단 X 버튼(train_close_x)이 담당

    // 하루 소개 명패 (train-char-panel 업로드 시) — 캐릭터 하단 오버레이
    const charPanel = skinNode("train-char-panel", 220, 170);
    if (charPanel) {
      const cpp = pos("train_char_panel", { x: 4, y: H - 310 });
      charPanel.x = cpp.x;
      charPanel.y = cpp.y;
      body.addChild(charPanel);
      editable("train_char_panel", charPanel);
    }
  };

  // ── 활동 실행 ──
  const pick = (a: Activity): void => {
    if (a.engine === "rest") { showResult(a, "good"); return; } // 휴식 = 즉시
    runGame(a);
  };

  const runGame = (a: Activity): void => {
    clear();
    setNs(a.id, () => runGame(a)); // 활동별 전용 키 + 배율 변경 시 이 화면만 재렌더
    setChrome(false); // 종목 배경판과 크기가 안 맞는 메인 패널 프레임 숨김
    const gameArea = new Container();
    gameArea.y = 10;
    body.addChild(gameArea);
    mountEngine(gameArea, {
      engine: a.engine as "rps" | "stop" | "match",
      act: opts.act,
      skin: a.skin,
      ns: a.id, // 엔진 내부 그룹도 활동별로 분리 (보컬·안무·알바가 같은 STOP 엔진을 공유)
      poseTex: opts.charAssets?.stage ?? opts.charAssets?.stand ?? null, // 거울 매칭: 무대의상 → 연습복 폴백
      poseFrames: opts.charAssets?.stageFrames ?? [], // 무대의상 시퀀스 (있으면 움직이는 포즈 애니)
      ticker: opts.ticker,
      onFinish: (grade) => { if (grade) showResult(a, grade); else showFail(a); },
    });
    // 우상단 X — 게임 도중 연습 메뉴로 복귀 (보드 자체를 닫는 메뉴 화면 X와 구분)
    const gx = new Container();
    const gxSkin = skinNatural("ui-close-x", 36, 36);
    if (gxSkin) {
      gx.addChild(gxSkin);
    } else {
      gx.addChild(new Graphics().roundRect(0, 0, 36, 36, 11).fill(0xf3ecfa).stroke({ width: 1.5, color: 0xdccdec }));
      const xt = txt("✕", 16, SUB, true);
      xt.x = (36 - xt.width) / 2;
      xt.y = (36 - xt.height) / 2;
      gx.addChild(xt);
    }
    gx.x = W - 46;
    gx.y = -38;
    gx.eventMode = "static";
    gx.cursor = "pointer";
    gx.on("pointertap", showMenu);
    grp("train_game_close_x", gx);
    // 종목 제목 — 맨 마지막에 얹어 패널 최상단 (배경판·그리드·버튼 어디에도 가리지 않음)
    // SNS 홍보는 그리드(6장/9장)에 따라 배경판이 달라 제목 좌표도 분리 — 9장 키는 기존 값을 승계
    const t = txt(`${ACT_NAME[a.id]}`, 15, INK, true);
    t.x = 20;
    t.y = -38; // body 오프셋(52) 기준 → 패널 상단 헤더 자리
    const grid3 = a.engine === "match" && (MATCH_CARDS[opts.act] ?? 6) > 6;
    if (grid3) grpFb("train_game_title_3x3", "train_game_title", t);
    else grp("train_game_title", t);
  };

  // ── 결과: 카드 획득 (와이어프레임 결과 화면) ──
  const showResult = (a: Activity, grade: MiniGameGrade): void => {
    clear();
    setNs(a.id, () => showResult(a, grade)); // 활동별 전용 키 + 배율 변경 시 이 화면만 재렌더
    // 휴식은 미니게임이 없어 이 결과 화면이 곧 휴식 화면 — 전용 배경판 (영상 가능)
    // 박스·오프셋을 종목 배경판(gameArea 안 W×MG_H, y=10)과 동일하게 — 크기가 달라 보이지 않게
    const restBg = a.id === "bond" ? skinFit("train-rest-bg", W, MG_H) : null; // contain-fit — 상하 잘림 없음
    setChrome(!restBg); // 휴식 배경판이 깔리면 연습 패널 프레임·헤더는 숨김 (계속 → 로 나가면 복원)
    if (restBg) {
      restBg.y = 10;
      body.setChildIndex(grp("train_rest_bg", restBg), 0); // 맨 뒤 레이어
    }
    // 등급 표시 — 스탬프 이미지(grade-*) 우선, 없으면 기존 텍스트
    const GN: Record<MiniGameGrade, string> = { perfect: "PERFECT ✨", good: "GOOD 👍", clear: "CLEAR ✔" };
    const stamp = skinFit(`grade-${grade}`, 180, 64);
    let g1: Container;
    if (stamp) {
      stamp.x = (W - 180) / 2;
      stamp.y = 30;
      g1 = stamp;
    } else {
      const gt = txt(GN[grade], 24, INK, true);
      gt.x = (W - gt.width) / 2;
      gt.y = 40;
      g1 = gt;
    }
    grp("train_res_grade", g1);
    if (grade === "perfect") fxConfetti(body, opts.ticker, W, H - 120); // 퍼펙트 축하 컨페티

    const t = cardTemplates.find((c) => c.id === a.id);
    if (grade !== "clear") {
      const cardGrade = TRAIN_GRADE_TO_CARD[grade];
      // 원형이 올리는 게이지마다 한 장 — 오디션(평판 5 · 실력 1)이면 두 장.
      // 여러 장이면 손에 쥔 패처럼 살짝 겹쳐 V자로 펼친다 (나란히 두면 화면을 넓게 먹고 밋밋하다).
      const gained = resolveTraining(a.id, grade, cardTemplates).cards;
      const n = gained.length;
      const step = CW2 - FAN_OVERLAP;               // 장당 가로 간격 (겹치는 만큼 좁아진다)
      const blockW = CW2 + (n - 1) * step;
      const row = new Container();
      row.x = (W - blockW) / 2;
      row.y = 100;
      grp("train_res_card", row); // 카드 묶음 전체 (조각들은 안쪽 그룹이라 함께 움직임)
      gained.forEach((card, idx) => {
        const big = new Container();
        // 아래쪽 가운데를 축으로 돌린다 — 밑동은 모이고 위쪽만 벌어져 V자가 된다.
        // 한 장뿐이면 회전 0이라 예전과 완전히 같은 자리에 그려진다.
        big.pivot.set(CW2 / 2, CH2);
        big.x = CW2 / 2 + idx * step;
        big.y = CH2;
        big.rotation = (fanAngle(idx, n) * Math.PI) / 180; // 부채꼴 규격은 관문 선택과 공용
        row.addChild(big);
        const cbg = skinFit("train-result-card", CW2, CH2); // 카드 배경 — 원본 비율 유지 (빈 슬롯은 텍스트만)
        // 게이지 심볼 — 이 카드가 담당하는 게이지 아트, 없으면 카드 이모지로 폴백
        const sym = gaugeSymbol(card, CW2, 38);
        let ic: Container;
        if (sym) {
          ic = sym;
          ic.y = 28;
        } else {
          const e = txt(t?.icon ?? "🎴", 36, INK);
          e.x = (CW2 - e.width) / 2;
          e.y = 30;
          ic = e;
        }
        const nm = txt(t?.name ?? "카드", 12, INK, true);
        nm.x = (CW2 - nm.width) / 2;
        nm.y = 86;
        // 판정등급 — 등급별 별 아트, 없으면 ★ 텍스트 (같은 박스에 중앙 정렬)
        const st = starNode(cardGrade, 90, 28, 14);
        st.x = (CW2 - 90) / 2;
        st.y = 106;
        // 조각 오프셋은 카드 공통 — 에디터 핸들은 첫 장에만 (둘째 장은 리드로우 때 따라온다)
        if (idx === 0) {
          if (cbg) grpIn(big, "train_res_card_bg", cbg);
          grpIn(big, "train_res_card_icon", ic);
          grpIn(big, "train_res_card_name", nm);
          grpIn(big, "train_res_card_star", st);
        } else {
          const off = (name: string, child: Container): void => {
            const q = pos(name, { x: 0, y: 0 });
            const g2 = new Container();
            g2.x = q.x;
            g2.y = q.y;
            g2.addChild(child);
            big.addChild(g2);
          };
          if (cbg) off("train_res_card_bg", cbg);
          off("train_res_card_icon", ic);
          off("train_res_card_name", nm);
          off("train_res_card_star", st);
        }
      });
    } else {
      const none = txt("카드 없음 (등급 부족)", 13, SUB, true);
      none.x = (W - none.width) / 2;
      none.y = 150;
      grp("train_res_card", none);
    }

    const dl = drainLabel(a.id);
    const drain = txt(dl === "소모 없음" ? "" : dl, 13, 0xff6f91, true);
    drain.x = (W - drain.width) / 2;
    drain.y = 285;
    // 탭·Space 공용 1회 실행 — 탭으로 진행해도 Space 리스너 해제
    let done = false;
    const finish = (): void => { if (done) return; done = true; offSpace(); setNs(""); opts.onFinish(a.id, grade); };
    const go = btn("계속 →", 180, PINK, finish, "train-btn-next");
    const offSpace = pairSpace(finish, () => !done && !go.destroyed); // 탭=Space
    go.x = (W - 180) / 2;
    go.y = 330;
    grp("train_res_drain", drain);
    grp("train_res_btn", go);
  };

  const showFail = (a: Activity): void => {
    clear();
    setNs(a.id, () => showFail(a)); // 활동별 전용 키 + 배율 변경 시 이 화면만 재렌더
    setChrome(true); // 실패 화면도 패널 복원
    // 실패 화면 배경 프레임 — 맨 뒤. 미업로드면 깔지 않는다(연습 패널이 그대로 보인다)
    const fbg = skinFit("train-fail-panel", W, H);
    if (fbg) grp("train_fail_bg", fbg);
    const t1 = txt("아쉬워요…", 22, INK, true);
    t1.x = (W - t1.width) / 2;
    t1.y = 120;
    const go = btn("재도전 (멘탈 −1)", 220, LAV, () => { opts.onRetryPenalty(); runGame(a); }, "train-btn-retry");
    go.x = (W - 220) / 2;
    go.y = 220;
    const quit = btn(opts.free ? "닫기" : "종료하기 (건너뛰기)", 220, 0xc4b8d6, () => { setNs(""); opts.onSkip(); }, "train-btn-quit");
    quit.x = (W - 220) / 2;
    quit.y = 284;
    grp("train_fail_title", t1);
    grp("train_fail_retry", go);
    btnLabel("train_fail_retry", go);
    grp("train_fail_quit", quit);
    btnLabel("train_fail_quit", quit);
  };

  showMenu();
}
