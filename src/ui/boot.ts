// ui/boot.ts — 부트 플로우: ① 프롤로그(회귀 배경) → ② 로딩 → ③ 타이틀 → ④ 메인 로비.
// 프롤로그는 경량(텍스트 연출)이라 즉시 재생, 무거운 에셋은 그 뒤에서 백그라운드 로딩.
import { AnimatedSprite, Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { GameAssets } from "./assets";
import { openMetaMenu } from "./metaMenu";
import { renderSidePanel, PIXI_TABS, type SideTab } from "./sidePanels";
import { pos } from "./layout";
import { fullRect, coverBg, stageTop, stageHeight } from "./stage";
import { bgManifest } from "./bgSlots";
import { beginFrame, editable, onRedraw } from "./editor";
import { onDevDeckChange } from "./cheatMenu";
import { visibleCards, currentRunInfo } from "./app";
import { renderLobbyStatusBar } from "./lobbyStatusBar";
import { attachSeamlessLoop } from "./loopVideo";
import { skinNode, skinNatural, skinFit, skinTexTrim, skinScale } from "./uiSkin";
import { renderCardDeckSheet } from "./cardDeckSheet";
import { pressable, resetPress } from "./press";
import { config } from "../data";
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

// ── ① 프롤로그: 데뷔 사고 → 회귀 영상 (2회차부터 건너뛰기 가능) ──
const PROLOGUE_SEEN = "debutloop.prologueSeen"; // 1회차 완주 여부 — 치트 '데이터 초기화'가 debutloop.* 를 지우면 다시 1회차
const PROLOGUE_VOLUME = 0.3; // 영상 원본 대비 −70% — 내레이션이 과하게 크다는 피드백

/** 비디오 텍스처의 원본 <video> — 프롤로그만 음소거 해제·1회 재생으로 다뤄야 해서 꺼낸다.
 *  (공용 로더는 모든 영상을 muted·loop로 만든다 — 배경 루프가 기본 용도라서) */
function videoElOf(tex: Texture): HTMLVideoElement | null {
  const res = (tex.source as unknown as { resource?: unknown }).resource;
  return res instanceof HTMLVideoElement ? res : null;
}

/** 프롤로그. bgPromise(backgrounds.json prologue-01)의 영상을 재생한다.
 *  영상에 내레이션 자막과 소리가 모두 들어 있으므로 코드 텍스트·틴트는 그리지 않는다.
 *
 *  1회차 — 끝까지 재생하고 `ended`에서 자동으로 로딩 화면으로 넘어간다. 건너뛰기 없음.
 *  2회차 이후 — 건너뛰기 버튼과 탭 스킵이 열린다.
 *
 *  단색 슬라이드쇼 폴백은 제거했다 — 영상 도착 직전·직후에 폴백 화면이 두세 번 깜빡이던 원인.
 *  영상이 오기 전엔 어두운 단색 한 장만 깔고, 영상이 없거나 로드 실패면 프롤로그 없이 넘어간다. */
export function playPrologue(app: Application, bgPromise?: Promise<Texture | null>): Promise<void> {
  return new Promise((resolve) => {
    const root = new Container();
    app.stage.addChild(root);
    const bgLayer = new Container();   // 영상 — 한 번 붙으면 유지
    const slideLayer = new Container(); // 음소거·건너뛰기 오버레이 — 갈아끼움
    root.addChild(fullRect(0x1a1430), bgLayer, slideLayer); // 영상 대기 중에도 흔들리지 않는 어두운 바탕 한 장
    const firstPlay = localStorage.getItem(PROLOGUE_SEEN) !== "1";
    let hasBg = false;
    let bgTex: Texture | null = null;
    let videoEl: HTMLVideoElement | null = null;
    let muteBtn: Text | null = null;
    let cancelAutoUnmute: (() => void) | null = null;
    let done = false;

    // 화면 전체가 한 덩어리로 축소되므로 작은 기기일수록 버튼의 실제 크기도 같이 줄어든다
    // (iPhone SE에서 지름 28px — 손가락으로 누르기 빡빡하다).
    // CSS 스케일의 역수를 곱해 물리 크기를 ~44px로 맞춘다. 큰 화면에서는 1배(보정 없음).
    const uiScale = (): number => {
      const s = app.canvas.clientWidth / W;
      return s > 0 ? Math.min(1.4, Math.max(1, 0.95 / s)) : 1;
    };

    // 🔊/🔇 두 글리프는 작게 그리면 형태가 비슷해 구분이 어렵다 —
    // 아이콘을 바꾸는 동시에 음소거일 때 흐리게 해서 한눈에 상태가 읽히게 한다
    const syncMuteBtn = (): void => {
      if (!muteBtn) return;
      const m = videoEl?.muted ?? false;
      muteBtn.text = m ? "🔇" : "🔊";
      muteBtn.alpha = m ? 0.5 : 1;
    };

    const finish = (): void => {
      if (done) return;
      done = true;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      cancelAutoUnmute?.();
      if (videoEl) { // 뒤 화면이 이 영상을 배경으로 재사용할 수 있으니 공용 로더 기본값으로 되돌린다
        videoEl.pause();
        videoEl.muted = true;
        videoEl.loop = true;
        videoEl.volume = 1;
      }
      localStorage.setItem(PROLOGUE_SEEN, "1");
      root.destroy({ children: true });
      resolve();
    };

    void (bgPromise ?? Promise.resolve(null)).then((tex) => {
      if (done || root.destroyed || hasBg) return;
      if (!tex) { finish(); return; } // 영상 없음·로드 실패 — 폴백 없이 프롤로그 생략
      bgTex = tex;
      bgLayer.addChild(coverBg(tex));
      hasBg = true;
      const el = videoElOf(tex);
      if (el) {
        videoEl = el;
        el.loop = false;             // 프롤로그는 1회 재생 후 종료
        el.currentTime = 0;
        el.muted = false;            // 영상에 내레이션 음성이 들어 있다
        el.volume = PROLOGUE_VOLUME;
        el.addEventListener("ended", finish, { once: true });
        void el.play().catch(() => {
          // 사용자 제스처 전 '소리 있는' 자동재생은 브라우저가 막는다 —
          // 일단 음소거로 재생하고 첫 입력에서 소리를 켠다 (재생 자체는 끊기지 않게)
          el.muted = true;
          syncMuteBtn();
          void el.play().catch(() => {});
          const unmute = (): void => {
            el.muted = false;
            cancelAutoUnmute?.();
            syncMuteBtn();
          };
          cancelAutoUnmute = (): void => {
            window.removeEventListener("pointerdown", unmute);
            window.removeEventListener("keydown", unmute);
            cancelAutoUnmute = null;
          };
          window.addEventListener("pointerdown", unmute);
          window.addEventListener("keydown", unmute);
        });
      }
      show();
    });

    const next = (): void => {
      if (hasBg && !firstPlay) finish(); // 탭 스킵 — 1회차는 끝까지 시청 (영상 도착 전에는 무동작)
    };
    // 스페이스바 = 탭과 동일 (진행)
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === "Space") { e.preventDefault(); next(); }
    };
    window.addEventListener("keydown", onKey);

    // 프롤로그는 35초라 재생 도중 창 크기·기기 방향이 바뀔 수 있다. 캔버스 높이가 달라지면
    // stageTop() 기준으로 잡은 오버레이와 cover 배경이 어긋나므로 그 자리에서 다시 배치한다.
    const onResize = (): void => {
      if (done || root.destroyed) return;
      if (hasBg && bgTex) { bgLayer.removeChildren(); bgLayer.addChild(coverBg(bgTex)); }
      show();
    };
    window.addEventListener("resize", onResize);

    // 영상 모드에서는 화면 진짜 모서리(=stageTop) 기준으로 얹는다. 콘텐츠 800 박스 기준으로 두면
    // 20:9 캔버스에서 78px 안쪽에 떠서 오버레이로 보이지 않는다. 단색 슬라이드는 800 박스 그대로.
    const topY = (inset: number): number => (hasBg ? stageTop() + inset : inset);

    const addSkip = (color: number): void => {
      const u = uiScale();
      const skip = mkText("건너뛰기 ≫", Math.round(15 * u), color, true);
      skip.x = W - skip.width - 18;
      skip.y = topY(18);
      skip.eventMode = "static";
      skip.cursor = "pointer";
      skip.on("pointertap", (e) => { e.stopPropagation(); finish(); });
      slideLayer.addChild(skip);
    };

    // 좌상단 음소거 토글 — 영상에 내레이션이 있어 소리를 끌 수단이 필요하다.
    // 자동재생 정책으로 음소거 시작된 경우에도 이 버튼이 현재 상태를 그대로 보여준다.
    const addMute = (): void => {
      const u = uiScale();
      const D = Math.round(48 * u); // 터치 타깃
      const zone = new Container();
      zone.x = 14;
      zone.y = topY(14);
      // 영상 위라 배경이 매 프레임 바뀐다 — 반투명 알약을 깔아야 아이콘이 항상 읽힌다
      zone.addChild(new Graphics().roundRect(0, 0, D, D, D / 2).fill({ color: 0x0d0b26, alpha: 0.45 }));
      const btn = mkText("🔊", Math.round(24 * u), 0xffffff);
      btn.anchor.set(0.5);
      btn.x = D / 2;
      btn.y = D / 2;
      zone.addChild(btn);
      muteBtn = btn;
      syncMuteBtn(); // 자동재생이 막혀 이미 음소거로 시작했을 수도 있다
      zone.eventMode = "static";
      zone.cursor = "pointer";
      // pointerdown은 캔버스에서 window로 버블링되기 전에 온다 — 여기서 자동 언뮤트 대기를
      // 먼저 해제해야 사용자가 고른 상태를 곧바로 덮어쓰지 않는다
      zone.on("pointerdown", () => { cancelAutoUnmute?.(); });
      zone.on("pointertap", (e) => {
        e.stopPropagation(); // 탭 스킵과 겹치지 않게
        if (!videoEl) return;
        videoEl.muted = !videoEl.muted;
        syncMuteBtn();
      });
      slideLayer.addChild(zone);
    };

    const show = (): void => {
      slideLayer.removeChildren();
      muteBtn = null;
      if (!hasBg) return; // 영상 대기 중 — 어두운 바탕만 (오버레이 없음)
      addMute(); // 영상 모드 — 좌상단 음소거, 2회차부터 우상단 건너뛰기
      if (!firstPlay) addSkip(0xe8e2f5);
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
    // 열린 사이드 팝업 — Pixi로 옮긴 탭만 여기에 담긴다(나머지는 기존 DOM 팝업).
    // 다른 게임 화면과 같은 방식: 상태를 들고 build()가 그린다.
    let sideTab: SideTab | null = null;
    const openSide = (tab: SideTab): void => {
      if (PIXI_TABS.has(tab)) { sideTab = tab; build(); return; }
      openMetaMenu(tab); // 아직 DOM인 탭
    };
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
    renderLobbyStatusBar(root, {
      ...(runInfo ?? {
        week: 0,
        debutWeek: config.debutWeek,
        act: 0,
        gauges: { ...config.difficulties.small.startGauges },
      }),
      loop: runNumber,               // START 버튼의 회차 표기와 같은 값
      cards: visibleCards().length,  // 로비 덱에 실제로 깔리는 장수와 같은 값
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
      // 아트·이모지·라벨을 각각 등록 — 아직 아트가 없어도(목업 상태) 위치·크기를 잡을 수 있어야 한다.
      // 버튼(name)은 아이콘 전체, 나머지는 버튼 안에서의 자리다.
      const pBg = pos(`${name}_bg`, { x: 0, y: 0 });
      art.x = pBg.x;
      art.y = pBg.y;
      b.addChild(art);
      editable(`${name}_bg`, art);
      if (!icoSkin) { // 전체 스킨이 이모지를 포함하므로, 프레임/벡터일 때만 이모지 표시
        const e = mkText(emoji, 19, 0x5b4a70);
        const pIcon = pos(`${name}_icon`, { x: Math.round(24 - e.width / 2), y: Math.round(24 - e.height / 2) });
        e.x = pIcon.x;
        e.y = pIcon.y;
        b.addChild(e);
        editable(`${name}_icon`, e);
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
      const pLbl = pos(`${name}_text`, { x: Math.round(l.x), y: Math.round(l.y) });
      l.x = pLbl.x;
      l.y = pLbl.y;
      b.addChild(l);
      pressable(b, onTap);
      root.addChild(b);
      editable(name, b);
      editable(`${name}_text`, l); // 버튼 등록 뒤 = 라벨이 자기 문구의 소유자
    };
    // 우측 레일: 데일리 → 앨범 → 상점 → 설정 (연습 버튼 제거 — 게임 내 연습하기·치트로 대체)
    ico("lobby_daily", "🎁", "데일리", W - 64, 130, () => openSide("daily"));
    ico("lobby_album", "📔", "앨범", W - 64, 210, () => openSide("album"));
    ico("lobby_shop", "🛍", "상점", W - 64, 290, () => openSide("shop"));
    ico("lobby_settings", "⚙️", "설정", W - 64, 370, () => openSide("settings"));

    // 덱 시트가 열리면 CTA를 잠근다 — 시트 몸통은 입력을 막지 않으므로(핸들 띠만 반응),
    // 열린 시트에 가려진 START가 그대로 눌려 런이 시작되던 문제를 여기서 끊는다.
    let lockCta: (open: boolean) => void = () => {};

    // 하단 카드덱 시트 — 로비·스토리 공용 컴포넌트 (배너를 끌거나 탭해서 개폐)
    const deck = renderCardDeckSheet(root, {
      cards: visibleCards, // 로비·스토리·상단 표기가 같은 출처를 본다
      open: deckSheetOpen,
      onToggle: (o) => { deckSheetOpen = o; lockCta(o); }, // build 재실행에도 유지
      tapMode: "flip", // 뒷면으로 깔아두고, 누르면 뒤집어 확인 (앱 재실행 전까지 유지)
    });
    refreshDeck = deck.rebuild;

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
    // CTA 위 글자들은 아트 중앙 기준(0,0)의 상대 좌표다. 기본값은 가로 중앙 정렬이고,
    // 레이아웃 에디터에서 각각 따로 옮길 수 있다 — 아트가 바뀌면 문구 위치도 손봐야 해서.
    const ctaText = (name: string, t: Text, defY: number): void => {
      const q = pos(name, { x: -t.width / 2, y: defY });
      t.x = q.x;
      t.y = q.y;
      cta.addChild(t);
      editable(name, t);
    };
    // START 글씨는 원형 아트에 그려져 있지 않아 코드가 얹는다 (벡터 폴백도 동일).
    // 색은 아트 속 별의 크림색(실측 평균 #FFEFD8)에 맞춘다.
    ctaText("lobby_cta_start", mkText("START", 18, 0xffefd8, true), -62);
    // 회차 숫자가 이 버튼의 주인공 — 원형 아트에 비해 작아 가독성이 떨어져서 키웠다(24→34, 부제 11→14).
    ctaText("lobby_cta_round", mkText(`${runNumber}회차`, 34, 0xffffff, true), -28);
    ctaText("lobby_cta_sub", mkText("시작의 밤", 14, 0xffe4f0, true), 28);
    // 진행 중인 런이 있으면 어디까지 왔는지 표시 (스토리 중간에 로비로 나온 경우)
    if (runInfo) {
      const label = runInfo.awaitingRegress ? "▶ 회귀 — 진행 방식을 골라요" : `▶ ${runInfo.week}주차 진행 중`;
      ctaText("lobby_cta_run", mkText(label, 9, 0xfff4c9, true), 36);
    }
    // 눌림 효과 — 아트와 글자(회차·START·진행 표시)가 한 덩어리로 작아졌다 돌아온다
    pressable(cta, start);
    root.addChild(cta);
    editable("lobby_cta", cta);
    root.addChild(deck.view); // 시트를 CTA 위 레이어로 — 열리면 CTA를 덮음 (에디터 오프셋 래퍼째)

    // 덱이 열려 있는 동안 CTA는 입력을 받지 않는다. 눌리지 않는다는 걸 눈으로도 알 수 있게 흐리게.
    lockCta = (open: boolean): void => {
      cta.eventMode = open ? "none" : "static";
      cta.cursor = open ? "default" : "pointer";
      cta.alpha = open ? 0.45 : 1;
      if (open) resetPress(cta); // 누른 채로 덱이 열리면 축소 상태로 굳는다 — 원위치
    };
    lockCta(deckSheetOpen); // 리드로우 전 열려 있었으면 잠긴 채로 복원

    // 사이드 팝업 — 로비 위에 얹는다 (딤이 뒤 화면을 덮으므로 마지막에)
    if (sideTab) {
      renderSidePanel(root, {
        tab: sideTab,
        ticker: app.ticker,
        onClose: () => { sideTab = null; build(); },
        onRedraw: () => build(),
      });
    }

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
