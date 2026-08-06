// main.ts — Pixi 부트스트랩 + 부트 플로우(프롤로그 → 로딩 → 메인 → 게임).
import { Application, VideoSource } from "pixi.js";
import { startApp, initGameCheats } from "./ui/app";
import { loadGameAssets, loadLoadingBg } from "./ui/assets";
import { playPrologue, showLoading, showTitle, showLobby } from "./ui/boot";
import { isDevMode } from "./ui/devMode";
import { initCheatMenu } from "./ui/cheatMenu";
import { initAudioUnlock, playBgm } from "./ui/audio";
import { setStageExtra } from "./ui/stage";
import { triggerRedraw } from "./ui/editor";
import { onHotAssetUpdate } from "./ui/hotAssets";

// 배경 mp4(프롤로그·로딩·리듬 배경)는 항상 무한 루프·무음 재생 — BGM은 오디오 시스템이 담당
VideoSource.defaultOptions = {
  ...VideoSource.defaultOptions,
  autoPlay: true,
  loop: true,
  muted: true,
  playsinline: true,
};

async function main(): Promise<void> {
  // 기기 화면에 맞춰 비율 유지 스케일 — 폭 430 고정, 세로가 더 긴 기기(20:9 등)는
  // 캔버스 높이를 늘려 배경이 블리드(검은 상하단 띠 제거). 콘텐츠는 800 박스 중앙 고정.
  const logicalH = (): number => {
    const s = Math.min(window.innerWidth / 430, window.innerHeight / 800);
    return Math.round(window.innerHeight / s);
  };
  const app = new Application();
  await app.init({
    width: 430,
    height: logicalH(),
    background: "#f8f5fd",
    antialias: true,
    resolution: Math.max(2, window.devicePixelRatio || 1), // 레티나 선명도
    autoDensity: true, // CSS 크기는 논리 픽셀 유지
  });
  const el = document.getElementById("app");
  if (!el) throw new Error("#app not found");
  el.appendChild(app.canvas);
  el.style.cssText = "display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;overflow:hidden";
  const fit = (): void => {
    const s = Math.min(window.innerWidth / 430, window.innerHeight / 800);
    const lh = logicalH();
    app.renderer.resize(430, lh);
    setStageExtra(lh - 800);
    app.stage.y = (lh - 800) / 2; // 콘텐츠 800 박스 세로 중앙 — 배경만 fullRect/coverBg로 블리드
    app.canvas.style.width = `${430 * s}px`;
    app.canvas.style.height = `${lh * s}px`;
  };
  fit();
  window.addEventListener("resize", fit); // ponytail: 리사이즈 시 현재 화면 배경은 다음 화면 전환에 재적용
  if (isDevMode()) initCheatMenu(); // ⚙️ 개발 치트 — 부트(프롤로그·로비)에서도 상시 노출
  initGameCheats(); // 게임 치트(관문 숏컷 포함) — 로비 치트 목록에도 항상 표시 (게임 밖에선 안내)
  initAudioUnlock(); // 첫 제스처에서 재생 언락 (자동재생 정책)

  // 무거운 에셋은 프롤로그 뒤에서 백그라운드 로딩 시작 (로딩 화면 배경은 별도 선로드)
  const progress = { done: 0, total: 1 };
  const loadingBgPromise = loadLoadingBg();
  const assetsPromise = loadGameAssets((d, t) => { progress.done = d; progress.total = t; }, app.renderer);

  // E2E 테스트용 씬 마커 — 현재 부트 단계 노출 (게임 로직에선 미사용)
  const mark = (s: string): void => { (window as unknown as { __scene?: string }).__scene = s; };
  mark("prologue");
  await playPrologue(app);                              // ① 프롤로그 (경량, 즉시)
  mark("loading");
  await showLoading(app, progress, assetsPromise, loadingBgPromise); // ② 로딩 (남은 진행률)
  const assets = await assetsPromise;
  onHotAssetUpdate((update) => {
    void assets.reloadFromHotUpdate(update).then((changed) => {
      if (changed) triggerRedraw();
    });
  });
  mark("title");
  await showTitle(app, assets.title);                   // ③ 메인화면 (게임 시작)
  playBgm("main");                                      // 메인 BGM — 로비 진입부터 (프롤로그·로딩·타이틀은 무음)
  // ④ 로비 ⇄ 게임 루프: 스토리 중 '← 로비'로 나오면 로비로, 재진입 시 런 이어짐
  mark("lobby");
  let lobbyResult = await showLobby(app, assets);
  for (;;) {
    mark("game");
    await startApp(app, assets, lobbyResult === "practice");
    mark("lobby");
    lobbyResult = await showLobby(app, assets);
  }
}

void main();
