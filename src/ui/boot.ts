// ui/boot.ts — 부트 플로우: ① 프롤로그(회귀 배경) → ② 로딩 → ③ 타이틀 → ④ 메인 로비.
// 프롤로그는 경량(텍스트 연출)이라 즉시 재생, 무거운 에셋은 그 뒤에서 백그라운드 로딩.
import { AnimatedSprite, Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { GameAssets } from "./assets";
import type { Card, CardGrade } from "../engine/types";
import { openMetaMenu } from "./metaMenu";
import { pos } from "./layout";
import { fullRect, coverBg, stageTop, stageHeight } from "./stage";
import { bgManifest } from "./bgSlots";
import { beginFrame, editable, onRedraw } from "./editor";
import { getPendingCards, onDevDeckChange } from "./cheatMenu";
import { currentRunCards, currentRunInfo } from "./app";
import { renderLobbyStatusBar } from "./lobbyStatusBar";
import { attachSeamlessLoop } from "./loopVideo";
import { skinNode, skinNatural, skinFit, skinTexTrim, skinScale } from "./uiSkin";
import { cardTemplates, config } from "../data";
import { playBgm } from "./audio";

const W = 430;
const H = 800;
const LABEL_ANCHOR_Y = 0.82; // 사이드 아이콘 제목의 세로 위치 — 아트 높이 대비 비율 (중앙 하단)
const LABEL_NUDGE_Y = -2;    // 위 비율에서 미세 보정 (px, 음수=위로)
// 카드덱 시트 개폐 상태 — build() 재실행(레이아웃 에디터 토글·배율 변경 등)에도 열림이 유지되어야
// 열린 상태의 내부 컴포넌트를 에디터로 조정할 수 있다
let deckSheetOpen = false;

const center = (t: Text, y: number): Text => {
  t.x = (W - t.width) / 2;
  t.y = y;
  return t;
};

const mkText = (s: string, size: number, fill: number, bold = false): Text =>
  new Text({
    text: s,
    style: { fontSize: size, fill, fontWeight: bold ? "bold" : "normal", wordWrap: true, wordWrapWidth: W - 80, lineHeight: size * 1.7, align: "center" },
  });

// ── ① 프롤로그: 데뷔 사고 → 회귀 (탭/자동 진행, 건너뛰기 가능) ──
interface Slide { bg: number; lines: Array<[string, number, number]>; flash?: boolean; } // [text, size, color]

const SLIDES: Slide[] = [
  {
    bg: 0x1a1430,
    lines: [["그날 밤, 공중파 데뷔 생방송.", 19, 0xf3f2fa], ["5년의 꿈이 이뤄지는 순간이었다.", 15, 0xa99bc0]],
  },
  {
    bg: 0x2a0a12,
    flash: true,
    lines: [["그때 — 붉은 섬광.", 21, 0xff5c5c], ["꺼진 마이크. 무너지는 무대.", 15, 0xd88b8b]],
  },
  {
    bg: 0x120d1e,
    lines: [["사고가 아니었다.", 19, 0xf3f2fa], ["누군가, 우리를 무너뜨렸다.", 16, 0xa99bc0]],
  },
  {
    bg: 0x0d0b26,
    lines: [["…눈을 뜨니, 3년 전 0시.", 20, 0xb39cff], ["이번엔 지킬 수 있을까.", 15, 0xa99bc0]],
  },
  { // 튜토리얼 직조 ①: 스와이프(선택) 개념 — "내 손끝이 정해"
    bg: 0x120d24,
    lines: [["이번 3년은 달라.", 19, 0xf3f2fa], ["운명이 갈림길을 내밀 때마다,", 15, 0xa99bc0], ["어느 쪽으로 기울지는 내 손끝이 정해.", 16, 0xcbb8e8]],
  },
  { // 튜토리얼 직조 ②: 게이지 5종 — 긍정톤 "다섯 개의 무기"
    bg: 0x1a1226,
    lines: [["실력, 멘탈, 평판, 유대, 자본.", 19, 0xffd884], ["이 다섯 개가 우리의 무기야.", 15, 0xa99bc0], ["차곡차곡 키워서 — 이번엔 꼭 데뷔하자!", 16, 0x7ef0c0]],
  },
];

const PROLOGUE_SEEN = "debutloop.prologueSeen"; // 1회차 완주 여부 — 치트 '데이터 초기화'가 debutloop.* 를 지우면 다시 1회차

/** 비디오 텍스처의 원본 <video> — 프롤로그만 음소거 해제·1회 재생으로 다뤄야 해서 꺼낸다.
 *  (공용 로더는 모든 영상을 muted·loop로 만든다 — 배경 루프가 기본 용도라서) */
function videoElOf(tex: Texture): HTMLVideoElement | null {
  const res = (tex.source as unknown as { resource?: unknown }).resource;
  return res instanceof HTMLVideoElement ? res : null;
}

/** 프롤로그. bgPromise(backgrounds.json prologue-01)가 도착하면 **영상 모드**로 전환한다.
 *  영상에 내레이션 자막과 소리가 모두 들어 있으므로 코드 텍스트·틴트는 그리지 않는다.
 *
 *  1회차 — 끝까지 재생하고 `ended`에서 자동으로 로딩 화면으로 넘어간다. 건너뛰기 없음.
 *  2회차 이후 — 건너뛰기 버튼과 탭 스킵이 열린다.
 *
 *  영상이 없거나 로드 실패면 기존 단색 슬라이드쇼로 폴백(문구는 여기 SLIDES가 SSOT).
 *  프롤로그는 즉시 시작이 원칙이라 영상을 기다리지 않고, 도착한 시점에 전환한다. */
export function playPrologue(app: Application, bgPromise?: Promise<Texture | null>): Promise<void> {
  return new Promise((resolve) => {
    const root = new Container();
    app.stage.addChild(root);
    const bgLayer = new Container();   // 영상 — 한 번 붙으면 유지
    const slideLayer = new Container(); // 단색 슬라이드·건너뛰기 — 갈아끼움
    root.addChild(bgLayer, slideLayer);
    const firstPlay = localStorage.getItem(PROLOGUE_SEEN) !== "1";
    let hasBg = false;
    let videoEl: HTMLVideoElement | null = null;
    let idx = 0;
    let flashTick: (() => void) | null = null;
    let done = false;

    const finish = (): void => {
      if (done) return;
      done = true;
      if (flashTick) app.ticker.remove(flashTick);
      window.removeEventListener("keydown", onKey);
      if (videoEl) { // 뒤 화면이 이 영상을 배경으로 재사용할 수 있으니 공용 로더 기본값으로 되돌린다
        videoEl.pause();
        videoEl.muted = true;
        videoEl.loop = true;
      }
      localStorage.setItem(PROLOGUE_SEEN, "1");
      root.destroy({ children: true });
      resolve();
    };

    void bgPromise?.then((tex) => {
      if (!tex || done || root.destroyed || hasBg) return;
      bgLayer.addChild(coverBg(tex));
      hasBg = true;
      const el = videoElOf(tex);
      if (el) {
        videoEl = el;
        el.loop = false;          // 프롤로그는 1회 재생 후 종료
        el.currentTime = 0;
        el.muted = false;         // 영상에 내레이션 음성이 들어 있다
        el.addEventListener("ended", finish, { once: true });
        void el.play().catch(() => {
          // 사용자 제스처 전 '소리 있는' 자동재생은 브라우저가 막는다 —
          // 일단 음소거로 재생하고 첫 입력에서 소리를 켠다 (재생 자체는 끊기지 않게)
          el.muted = true;
          void el.play().catch(() => {});
          const unmute = (): void => {
            el.muted = false;
            window.removeEventListener("pointerdown", unmute);
            window.removeEventListener("keydown", unmute);
          };
          window.addEventListener("pointerdown", unmute);
          window.addEventListener("keydown", unmute);
        });
      }
      show();
    });

    const next = (): void => {
      if (hasBg) { if (!firstPlay) finish(); return; } // 영상 모드: 1회차는 스킵 불가
      idx++;
      if (idx >= SLIDES.length) finish();
      else show();
    };
    // 스페이스바 = 탭과 동일 (진행)
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === "Space") { e.preventDefault(); next(); }
    };
    window.addEventListener("keydown", onKey);

    const addSkip = (color: number): void => {
      const skip = mkText("건너뛰기 ≫", 12, color, true);
      skip.x = W - skip.width - 20;
      skip.y = 20;
      skip.eventMode = "static";
      skip.cursor = "pointer";
      skip.on("pointertap", (e) => { e.stopPropagation(); finish(); });
      slideLayer.addChild(skip);
    };

    const show = (): void => {
      if (flashTick) { app.ticker.remove(flashTick); flashTick = null; }
      slideLayer.removeChildren();
      if (hasBg) { // 영상 모드 — 화면 위에 얹는 건 2회차 이후의 건너뛰기뿐
        if (!firstPlay) addSkip(0xe8e2f5);
        return;
      }
      const s = SLIDES[idx];
      if (!s) { finish(); return; }
      slideLayer.addChild(fullRect(s.bg));
      let y = 340;
      for (const [text, size, color] of s.lines) {
        slideLayer.addChild(center(mkText(text, size, color, size > 17), y));
        y += size * 2.2;
      }
      if (s.flash) { // 붉은 섬광 펄스
        const flash = fullRect(0xff2b2b, 0);
        slideLayer.addChild(flash);
        let el = 0;
        flashTick = () => {
          el += app.ticker.deltaMS / 1000;
          flash.alpha = Math.max(0, 0.5 - el * 0.8);
          if (el > 0.8 && flashTick) { app.ticker.remove(flashTick); flashTick = null; }
        };
        app.ticker.add(flashTick);
      }
      slideLayer.addChild(center(mkText("탭 또는 Space로 계속", 11, 0x6a628a), H - 70));
      addSkip(0x8a82aa);
    };

    root.eventMode = "static";
    root.on("pointertap", next);
    show();
  });
}

// ── ② 로딩: 에셋 프리로드 진행률 바 ──
export function showLoading(
  app: Application,
  progress: { done: number; total: number },
  until: Promise<unknown>,
  bgTexPromise: Promise<Texture[]> = Promise.resolve([]), // assets/bg/loading*.png (시퀀스 지원)
): Promise<void> {
  return new Promise((resolve) => {
    const root = new Container();
    app.stage.addChild(root);

    // 배경 레이어: 즉시 파스텔 폴백 → 이미지 도착 시 교체 (await로 화면을 비우지 않음)
    const bgLayer = new Container();
    root.addChild(bgLayer);
    bgLayer.addChild(fullRect(0xf8f5fd));
    const moon = center(mkText("🌙", 40, 0xa78be6), 300);
    bgLayer.addChild(moon);
    void bgTexPromise.then((texs) => {
      const first = texs[0];
      if (!first || root.destroyed) return;
      bgLayer.removeChildren();
      const spr = coverBg(first);
      bgLayer.addChild(spr);
      // 어둡게 오버레이(남색 15%)는 bg.html 로딩 슬롯의 🌒 체크박스로 선택 적용 (기본 off=원본 밝기)
      if (bgManifest.system.find((s) => s.id === "loading")?.dim === true) bgLayer.addChild(fullRect(0x1a1430, 0.15));
      if (texs.length > 1) { // 시퀀스(bg.html 여러 장 업로드) — 프레임 순환 재생
        const frameMs = Math.max(400, bgManifest.system.find((s) => s.id === "loading")?.frameMs ?? 1200);
        let fi = 0;
        const iv = window.setInterval(() => {
          if (root.destroyed) { window.clearInterval(iv); return; }
          fi = (fi + 1) % texs.length;
          spr.texture = texs[fi]!;
        }, frameMs);
      }
    });

    // 하단 정보 스트립 (배경 유무와 무관한 고정 레이아웃)
    const strip = new Graphics().roundRect(30, 620, W - 60, 130, 18).fill({ color: 0xffffff, alpha: 0.9 });
    root.addChild(strip);
    const infoY = 636;
    root.addChild(center(mkText("무대를 준비하고 있어요…", 15, 0x5b4a70, true), infoY));
    const tip = center(mkText("Tip. 연습으로 카드를 모아 관문에서 사용하세요", 11.5, 0xa99bc0), infoY + 30);
    root.addChild(tip);

    const BAR_W = 260;
    const barY = infoY + 68;
    const barBg = new Graphics().roundRect((W - BAR_W) / 2, barY, BAR_W, 12, 6).fill(0xece4f4);
    const barFill = new Graphics();
    root.addChild(barBg, barFill);

    const MIN_MS = 500; // 최소 노출 시간 — 바가 한 번에 채워지는 깜빡임만 방지 (2000ms 테스트 바닥값이 로딩을 지배하던 것 제거)
    let doneFlag = false;
    let elapsed = 0;
    void until.then(() => { doneFlag = true; });
    const tick = (): void => {
      elapsed += app.ticker.deltaMS;
      // 실제 진행률과 최소시간 진행률 중 느린 쪽으로 바를 채움 (2초에 걸쳐 자연스럽게)
      const real = progress.total > 0 ? progress.done / progress.total : 0;
      const r = Math.min(real, elapsed / MIN_MS);
      barFill.clear().roundRect((W - BAR_W) / 2, barY, Math.max(8, BAR_W * r), 12, 6).fill(0xff7fb0);
      if (doneFlag && real >= 1 && elapsed >= MIN_MS) {
        app.ticker.remove(tick);
        setTimeout(() => { root.destroy({ children: true }); resolve(); }, 250); // 완료 잠깐 보여주기
      }
    };
    app.ticker.add(tick);
  });
}

// ── ③ 메인(타이틀): 성공한 5인조 단체컷 배경 + 게임 시작 ──
export function showTitle(app: Application, titleTex: Texture | null): Promise<void> {
  return new Promise((resolve) => {
    const root = new Container();
    app.stage.addChild(root);
    let done = false;

    const start = (): void => {
      if (done) return;
      done = true;
      onRedraw(() => {}); // 타이틀 전용 리드로우 해제 (다음 화면이 자기 것으로 교체)
      window.removeEventListener("keydown", onKey);
      root.destroy({ children: true });
      resolve();
    };
    // 스페이스바 = 게임 시작
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === "Space") { e.preventDefault(); start(); }
    };
    window.addEventListener("keydown", onKey);

    const build = (): void => {
      if (done) return;
      root.removeChildren();
      if (titleTex) {
        // 에셋 슬롯: public/assets/bg/title.png (5인 단체컷)
        root.addChild(coverBg(titleTex), fullRect(0x1a1430, 0.25));
      } else {
        // 빈 슬롯 — 실루엣 플레이스홀더 없이 단색 무드만 (텍스트 가독용 바탕)
        root.addChild(fullRect(0x2a2150));
      }

      // 타이틀+시작 버튼 통짜 영상 (title-hero · mp4) — 업로드 시 코드 타이틀 텍스트·시작 버튼을 대체.
      // 표시 규칙은 배경 슬롯 coverBg()(stage.ts)와 **완전히 동일**하다 — 화면 전체 cover, 중앙 정렬.
      // 즉 넘치는 축은 잘려나가므로, 아트는 배경과 같이 "잘려도 되는 블리드"를 포함해야 한다.
      // 캔버스는 폭 430 고정 · 높이는 아무리 넓은 창에서도 800에서 멈추므로(비율 0.5375가 최악),
      // 콘텐츠가 안 잘리려면 아트 가로 ≥ 세로 × 0.5375 여야 한다. (2500 기준 1344, 권장 1400)
      // 배율·좌표를 바꾸지 말 것 — 로딩 배경과 다르게 보이면 그건 아트 규격 문제다.
      const heroTex = skinTexTrim("title-hero");
      if (heroTex) {
        const sh = stageHeight();
        const s = Math.max(W / heroTex.width, sh / heroTex.height) * skinScale("title-hero");
        const vw = heroTex.width * s, vh = heroTex.height * s;
        const hp = pos("title_hero", { x: (W - vw) / 2, y: stageTop() + (sh - vh) / 2 });
        const hero = new Sprite(heroTex);
        hero.scale.set(s);
        hero.x = hp.x;
        hero.y = hp.y;
        root.addChild(hero);
        editable("title_hero", hero);
        // START 터치 존 — 영상 속 버튼 실측 비율(중심 49.9%·82.7%, 폭 48%·높이 5.2%)에 여유를 더해 배치.
        // 영상 표시 크기에 비례하므로 화면 높이·배율이 달라져도 버튼 위에 정확히 붙는다
        const zw = vw * 0.56, zh = vh * 0.09;
        const zone = new Container();
        const zp = pos("title_start", { x: hp.x + vw * 0.4988 - zw / 2, y: hp.y + vh * 0.8274 - zh / 2 });
        zone.x = zp.x;
        zone.y = zp.y;
        zone.addChild(new Graphics().roundRect(0, 0, zw, zh, zh / 2).fill({ color: 0xffffff, alpha: 0.001 }));
        zone.eventMode = "static";
        zone.cursor = "pointer";
        zone.on("pointertap", start);
        root.addChild(zone);
        editable("title_start", zone);
        return;
      }

      root.addChild(center(mkText("Debut Loop!", 40, 0xffffff, true), 440));

      // 게임 시작 — 통짜 영상(title-hero)이 있으면 그 안의 START를 쓰고 여긴 오지 않는다.
      // 영상이 없을 때만 ui-start 버튼 아트를 폴백으로 표시 (그것도 없으면 투명 터치 존만)
      const zone = new Container();
      const startArt = skinNatural("ui-start", 260, 120); // 1배율=원본 크기
      const zp = pos("title_start", { x: (W - 260) / 2, y: 555 });
      zone.x = zp.x;
      zone.y = zp.y;
      zone.addChild(new Graphics().roundRect(0, 0, 260, 120, 24).fill({ color: 0xffffff, alpha: 0.001 }));
      if (startArt) zone.addChild(startArt);
      zone.eventMode = "static";
      zone.cursor = "pointer";
      zone.on("pointertap", start);
      root.addChild(zone);
      editable("title_start", zone);

      root.addChild(center(mkText("NAN 2026 데모 · v0.1 · Space=시작", 11, 0x8a82aa), H - 50));
    };
    build();
    onRedraw(build); // 배율·농도·스킨 업로드 실시간 반영 (에디터 저장 → triggerRedraw)
  });
}

// ── ④ 메인 로비: 캐릭터 센터 + 좌우 레일 + 곡선 탭바(카드덱) + 원형 대형 CTA(회차) ──
// 확정 조합(Director): B안 원형 CTA + A안 곡선 탭바 + 메뉴 좌우 분산
// 반환: "start"=CTA로 시작 / "practice"=연습 버튼으로 시작(진입 즉시 연습 보드 오픈)
export type LobbyResult = "start" | "practice";

export function showLobby(app: Application, assets: GameAssets): Promise<LobbyResult> {
  return new Promise((resolve) => {
    const root = new Container();
    app.stage.addChild(root);
    let disposed = false;
    let refreshDeck: () => void = () => {}; // build마다 최신 buildContent로 교체
    onDevDeckChange(() => { if (!disposed) refreshDeck(); }); // 카드 에디터 추가/삭제 → 실시간 갱신 (1회 등록)

    function build(): void { // 레이아웃 에디터 토글 시 재구축 (editable 등록/원복)
    if (disposed) return;
    playBgm("lobby"); // 로비 트랙 (미업로드 시 무변경 — 기존 음악 유지)
    // 회차 표기: 진행 중인 런 기준 — 회귀 대기(1회차 완주)면 다음 회차(2) 표시
    const runInfo = currentRunInfo();
    const runNumber = runInfo ? (runInfo.awaitingRegress ? 2 : runInfo.loop) : 1;
    beginFrame();
    root.removeChildren();

    // 배경: 타이틀 이미지를 은은하게
    const titleTex = assets.title;
    if (titleTex) root.addChild(coverBg(titleTex));
    root.addChild(fullRect(0xe8ddf6, 0.35));

    // 상단 상태 패널 (달력 D-day + 5게이지, 본게임과 동일 데이터) — 런 없으면 시작값(소형 기획사) 표시
    renderLobbyStatusBar(root, runInfo ?? {
      week: 0,
      debutWeek: config.debutWeek,
      act: 0,
      gauges: { ...config.difficulties.small.startGauges },
    });

    // 캐릭터 센터 (일상복 시퀀스 → 일상복 단일 → 반신 기본 idle 시퀀스 → 스탠딩/상반신 → 실루엣 폴백)
    const ca = assets.char("haru");
    const dailySeq = ca.dailyFrames.length > 1 ? ca.dailyFrames : [];
    const hasDaily = dailySeq.length > 0 || !!ca.daily;
    const idle = hasDaily ? dailySeq : ca.bustIdleFrames; // 일상복 시퀀스 있으면 애니, 단일이면 정지
    const charTex = dailySeq[0] ?? ca.daily ?? idle[0] ?? ca.stand ?? ca.bust;
    if (charTex) {
      const charC = new Container();
      const skinKind = hasDaily ? "daily" : idle.length > 0 ? "exp-base-idle" : ca.stand ? "practice" : "bust";
      const s = Math.min(300 / charTex.width, 480 / charTex.height) * ca.scaleOf(skinKind); // char.html 배율
      const pChar = pos("lobby_char", { x: (W - charTex.width * s) / 2, y: H - 210 - charTex.height * s });
      charC.x = pChar.x;
      charC.y = pChar.y;
      if (idle.length > 1) { // char.html '표정 · 기본 (idle)' 시퀀스 업로드 시 애니 재생
        const anim = new AnimatedSprite(idle);
        anim.animationSpeed = 8 / 60; // 8fps — 은은한 숨쉬기 루프
        anim.play();
        anim.scale.set(s);
        charC.addChild(anim);
      } else {
        const spr = new Sprite(charTex);
        spr.scale.set(s);
        attachSeamlessLoop(spr); // 일상복이 알파 영상이면 이음새 없는 루프 (이미지면 no-op)
        charC.addChild(spr);
      }
      root.addChild(charC);
      editable("lobby_char", charC);
    }
    // 캐릭터 미업로드 시 미표시 (빈 슬롯 숨김 — 실루엣 플레이스홀더 제거)

    // 좌우 레일 버튼 (메뉴 분산 배치)
    const ico = (name: string, emoji: string, label: string, x: number, y: number, onTap: () => void): void => {
      const b = new Container();
      const pIco = pos(name, { x, y });
      b.x = pIco.x;
      b.y = pIco.y;
      // 우선순위: 아이콘 전체 스킨(이모지 포함 제작) > 공통 프레임 스킨(이모지 유지) > 벡터 원
      // skinFit = 48×48 안에 원본 비율 그대로 contain (정사각이 아닌 아트도 눌리지 않음, 배율은 에디터에서)
      const icoSkin = skinFit(name.replace("lobby_", "lobby-icon-"), 48, 48);
      const art = icoSkin ?? skinFit("lobby-icon-frame", 48, 48)
        ?? new Graphics().circle(24, 24, 24).fill({ color: 0xffffff, alpha: 0.95 }).stroke({ width: 2, color: 0xece4f4 });
      b.addChild(art);
      if (!icoSkin) { // 전체 스킨이 이모지를 포함하므로, 프레임/벡터일 때만 이모지 표시
        const e = mkText(emoji, 19, 0x5b4a70);
        e.x = 24 - e.width / 2;
        e.y = 24 - e.height / 2;
        b.addChild(e);
      }
      // 아이콘 제목 — 아트의 실제 영역(배율 반영)을 재서 중앙 하단에 고정. 배율을 바꿔도 정렬이 유지된다
      const l = mkText(label, 9.5, 0x5b4a70, true);
      if (icoSkin) {
        const ab = art.getLocalBounds(); // skinFit 배치 결과 = 배율이 반영된 아트 사각형
        l.x = ab.x + (ab.width - l.width) / 2;
        l.y = ab.y + ab.height * LABEL_ANCHOR_Y - l.height / 2 + LABEL_NUDGE_Y;
      } else { // 프레임·벡터 폴백은 이모지가 중앙을 차지하므로 기존처럼 아래에
        l.x = 24 - l.width / 2;
        l.y = 50;
      }
      b.addChild(l);
      b.eventMode = "static";
      b.cursor = "pointer";
      b.on("pointertap", onTap);
      root.addChild(b);
      editable(name, b);
    };
    // 우측 레일: 데일리 → 앨범 → 상점 → 설정 (연습 버튼 제거 — 게임 내 연습하기·치트로 대체)
    ico("lobby_daily", "🎁", "데일리", W - 64, 130, () => openMetaMenu("daily"));
    ico("lobby_album", "📔", "앨범", W - 64, 210, () => openMetaMenu("album"));
    ico("lobby_shop", "🛍", "상점", W - 64, 290, () => openMetaMenu("shop"));
    ico("lobby_settings", "⚙️", "설정", W - 64, 370, () => openMetaMenu("settings"));

    // 하단 곡선 탭바 (A안) = 카드덱 시트의 핸들 — 상하 스와이프로 반쯤 올라옴 (레퍼런스: 카드덱UI)
    const sheet = new Container(); // y offset 0=닫힘, -OPEN_DY=열림
    // 배너 아트 — 스킨 전용 (빈 슬롯은 곡선 장식 없이 몸통만)
    // 폭은 화면 전체 고정, 높이는 업로드 아트 비율에서 도출 → 눌리지 않음 (배율은 에디터에서)
    const bannerTex = skinTexTrim("lobby-deck-banner");
    const bannerH = bannerTex ? Math.round(W * (bannerTex.height / bannerTex.width)) : 230;
    // 개폐 스트로크는 배너 높이 비율로 — 닫힘=상단 30%만 노출, 열림=상단 70%까지(하단 30%는 화면 밑)
    const BANNER_TOP = H - Math.round(bannerH * 0.3); // 배너 상단 = 덱 조각들의 기준선
    const OPEN_DY = bannerTex ? Math.round(bannerH * 0.4) : 240; // 아트 미업로드(벡터 폴백)만 고정값
    const bannerSkin = skinNode("lobby-deck-banner", W, bannerH);
    if (bannerSkin) bannerSkin.y = BANNER_TOP;
    // 투명 히트영역 — 배너 전체가 스와이프/탭 판정 대상
    const bodyRect = new Graphics().rect(0, BANNER_TOP, W, bannerH).fill({ color: 0xffffff, alpha: 0 });
    sheet.addChild(bodyRect);
    // 시트 내부 조각별 오프셋 그룹 — 시트 개폐(sheet.y)와 분리돼 열린 상태에서 위치 미세조정 가능
    const dgrp = (name: string, child: Container): Container => {
      const g = new Container();
      const q = pos(name, { x: 0, y: 0 });
      g.x = q.x;
      g.y = q.y;
      g.addChild(child);
      sheet.addChild(g);
      editable(name, g);
      return g;
    };
    if (bannerSkin) dgrp("lobby_deck_banner", bannerSkin);

    // 핸들 바·🎴 아이콘 제거 — 배너 이미지 자체를 잡고 끌어 올리고 내린다 (히트영역=bodyRect)

    // 덱 제목 — 시트 직속(내용물 밖)이라 닫혀 있어도 보이고, 개폐하면 시트와 함께 움직인다
    const cTitle = mkText("CARD DECK", 30, 0x5b4a70, true);
    cTitle.x = (W - cTitle.width) / 2;
    cTitle.y = BANNER_TOP + 6; // 배너 안쪽 상단
    dgrp("lobby_deck_title", cTitle);

    // 시트 내용 — 대기 버퍼(카드 에디터로 추가한 카드)를 실시간 표시, 비면 "?" 슬롯
    const content = new Container();
    content.y = BANNER_TOP + 98; // 배너 기준 아래쪽 — 닫힘 상태에선 화면 밖
    dgrp("lobby_deck_content", content);
    const GRADE_COLOR: Record<CardGrade, number> = { epic: 0xf0c05a, rare: 0xa78be6, common: 0xc4b8d6 };
    const STARS: Record<CardGrade, string> = { epic: "★★★", rare: "★★", common: "★" };
    const cols = 4;
    const cw = 82;
    const gap = 10;
    const gx = (W - cols * cw - (cols - 1) * gap) / 2;
    // content 내부 조각 그룹 — 재빌드마다 다시 등록되지만 좌표는 layout.json에서 승계된다
    const cgrp = (name: string, child: Container): void => {
      const g = new Container();
      const q = pos(name, { x: 0, y: 0 });
      g.x = q.x;
      g.y = q.y;
      g.addChild(child);
      content.addChild(g);
      editable(name, g);
    };
    // 카드 타일 — 업로드된 결과 카드 프레임 아트를 원본 비율로, 빈 슬롯이면 벡터 폴백
    const tile = (x0: number, y0: number, accent: number | null): void => {
      const art = skinFit("train-result-card", cw, cw * 1.3);
      if (art) {
        art.x = x0;
        art.y = y0;
        content.addChild(art);
        return;
      }
      content.addChild(new Graphics().roundRect(x0, y0, cw, cw * 1.3, 12)
        .fill(accent === null ? 0xf8f4fc : 0xf6f0fc)
        .stroke({ width: accent === null ? 2 : 2.5, color: accent ?? 0xece4f4 }));
    };

    const buildContent = (): void => {
      content.removeChildren();
      const cSub = mkText("연습으로 모으고, 관문에서 사용해요", 11, 0xa99bc0);
      cSub.x = (W - cSub.width) / 2;
      cSub.y = 26;
      cgrp("lobby_deck_sub", cSub);

      // 같은 종류·등급 = ×N 스택 — 진행 중 런의 덱 + 대기 버퍼(카드 에디터) 합산
      const groups = new Map<string, { card: Card; count: number }>();
      for (const card of [...currentRunCards(), ...getPendingCards()]) {
        const key = `${card.templateId}:${card.grade}`;
        const g = groups.get(key);
        if (g) g.count++;
        else groups.set(key, { card, count: 1 });
      }

      if (groups.size === 0) {
        for (let i = 0; i < 8; i++) {
          const x0 = gx + (i % cols) * (cw + gap);
          const y0 = 52 + Math.floor(i / cols) * (cw * 1.3 + gap);
          tile(x0, y0, null);
          const q = mkText("?", 20, 0xd9cdeb, true);
          q.x = x0 + cw / 2 - q.width / 2;
          q.y = y0 + cw * 0.5;
          content.addChild(q);
        }
        const cHint = mkText("런을 시작하면 여기에 카드가 쌓여요", 10.5, 0xc4b8d6);
        cHint.x = (W - cHint.width) / 2;
        cHint.y = 52 + 2 * (cw * 1.3 + gap) + 6;
        cgrp("lobby_deck_hint", cHint);
        return;
      }

      let i = 0;
      for (const { card, count } of groups.values()) {
        if (i >= 8) break;
        const t = cardTemplates.find((x) => x.id === card.templateId);
        const x0 = gx + (i % cols) * (cw + gap);
        const y0 = 52 + Math.floor(i / cols) * (cw * 1.3 + gap);
        tile(x0, y0, GRADE_COLOR[card.grade]);
        const ic = mkText(t?.icon ?? "🎴", 22, 0x5b4a70);
        ic.x = x0 + (cw - ic.width) / 2;
        ic.y = y0 + 12;
        const st = mkText(STARS[card.grade], 10, 0xf0a93a, true);
        st.x = x0 + (cw - st.width) / 2;
        st.y = y0 + 48;
        const nm = mkText(t?.name?.replace(" 카드", "") ?? "", 10, 0x5b4a70, true);
        nm.x = x0 + (cw - nm.width) / 2;
        nm.y = y0 + 68;
        content.addChild(ic, st, nm);
        if (count > 1) {
          const bd = mkText(`×${count}`, 10, 0xc9527f, true);
          bd.x = x0 + cw - bd.width - 6;
          bd.y = y0 + 5;
          content.addChild(bd);
        }
        i++;
      }
      const cHint = mkText("런 시작 시 이 카드들을 갖고 출발해요 (개발 버퍼)", 10.5, 0xc4b8d6);
      cHint.x = (W - cHint.width) / 2;
      cHint.y = 52 + 2 * (cw * 1.3 + gap) + 6;
      cgrp("lobby_deck_hint", cHint);
    };
    buildContent();
    refreshDeck = buildContent;
    // 레이아웃 에디터 오프셋 래퍼 — 개폐(sheet.y 스냅)와 분리, 위치 미세조정은 래퍼가 담당
    const deckWrap = new Container();
    const dOff = pos("lobby_deck", { x: 0, y: 0 });
    deckWrap.x = dOff.x;
    deckWrap.y = dOff.y;
    deckWrap.addChild(sheet);
    root.addChild(deckWrap);
    editable("lobby_deck", deckWrap);

    // 상하 스와이프/탭 개폐 (인게임 덱 시트와 동일 제스처)
    let sheetOpen = deckSheetOpen;
    if (sheetOpen) sheet.y = -OPEN_DY; // 리드로우 전 열려 있었으면 열린 채로 복원
    let dragging = false;
    let startY = 0;
    let baseY = 0;
    let moved = 0;
    sheet.eventMode = "static";
    sheet.cursor = "grab";
    sheet.on("pointerdown", (e) => { dragging = true; startY = e.globalY; baseY = sheet.y; moved = 0; });
    const smove = (e: { globalY: number }): void => {
      if (!dragging) return;
      const dy = e.globalY - startY;
      moved = Math.max(moved, Math.abs(dy));
      sheet.y = Math.max(-OPEN_DY, Math.min(0, baseY + dy));
    };
    sheet.on("globalpointermove", smove);
    sheet.on("pointermove", smove);
    const sfinish = (): void => {
      if (!dragging) return;
      dragging = false;
      if (moved < 8) sheetOpen = !sheetOpen;            // 탭 = 토글
      else sheetOpen = sheet.y < -OPEN_DY / 2;          // 스와이프 = 가까운 쪽 스냅
      deckSheetOpen = sheetOpen;                        // build 재실행에도 유지
      sheet.y = sheetOpen ? -OPEN_DY : 0;
    };
    sheet.on("pointerup", sfinish);
    sheet.on("pointerupoutside", sfinish);

    // 원형 대형 CTA (B안) — 회차 숫자가 주인공
    const cta = new Container();
    const pCta = pos("lobby_cta", { x: W / 2, y: H - 168 });
    cta.x = pCta.x;
    cta.y = pCta.y;
    const ctaSkin = skinNode("lobby-start", 128, 128);
    if (ctaSkin) {
      ctaSkin.x = -64;
      ctaSkin.y = -64;
      cta.addChild(ctaSkin);
    } else {
      cta.addChild(
        new Graphics().circle(0, 0, 64).fill(0xff7fb0).stroke({ width: 4, color: 0xffffff }),
        new Graphics().circle(0, 0, 64).stroke({ width: 1.5, color: 0xffd9e9 }),
      );
    }
    if (!ctaSkin) { // START 글씨는 스킨 이미지에 그려져 있음 — 벡터 폴백에서만 표시
      const c1 = mkText("START", 10, 0xffe4f0, true);
      c1.x = -c1.width / 2;
      c1.y = -40;
      cta.addChild(c1);
    }
    const c2 = mkText(`${runNumber}회차`, 24, 0xffffff, true);
    c2.x = -c2.width / 2;
    c2.y = -18;
    const c3 = mkText("시작의 밤", 11, 0xffe4f0, true);
    c3.x = -c3.width / 2;
    c3.y = 16;
    cta.addChild(c2, c3);
    // 진행 중인 런이 있으면 어디까지 왔는지 표시 (스토리 중간에 로비로 나온 경우)
    if (runInfo) {
      const label = runInfo.awaitingRegress ? "▶ 회귀 — 진행 방식을 골라요" : `▶ ${runInfo.week}주차 진행 중`;
      const c4 = mkText(label, 9, 0xfff4c9, true);
      c4.x = -c4.width / 2;
      c4.y = 34;
      cta.addChild(c4);
    }
    cta.eventMode = "static";
    cta.cursor = "pointer";
    cta.on("pointertap", start);
    root.addChild(cta);
    editable("lobby_cta", cta);
    root.addChild(deckWrap); // 시트를 CTA 위 레이어로 — 열리면 CTA를 덮음 (에디터 오프셋 래퍼째)

    } // ── build() 끝 ──
    build();
    onRedraw(build); // 에디터 토글 → 로비 재구축 (게임 진입 시 startApp이 다시 클레임)

    function start(): void {
      finish("start");
    }
    function finish(result: LobbyResult): void {
      disposed = true;
      window.removeEventListener("keydown", onKey);
      root.destroy({ children: true });
      resolve(result);
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === "Space") { e.preventDefault(); start(); }
    };
    window.addEventListener("keydown", onKey);
  });
}
