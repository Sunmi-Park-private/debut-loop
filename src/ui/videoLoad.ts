// ui/videoLoad.ts — Safari-safe 비디오 텍스처 로더.
// Pixi 기본 loadVideo는 canplay 이벤트만 기다리는데, WebKit(iOS/Safari)은 DOM 밖 비디오에
// load()를 명시적으로 호출하지 않으면 데이터를 로드하지 않아 영원히 resolve되지 않는다.
// 알파 영상은 엔진별 포맷이 갈린다: Chrome/Android=VP9 webm, iOS/WebKit=HEVC(hvc1) mov.
// 게다가 WebKit은 HEVC 알파를 canvas 2D drawImage로는 보존하지만 WebGL texImage2D에선 버리므로
// mov는 2D 캔버스를 거쳐 GPU에 올린다 (canvasVideoTexture).
import { Texture, VideoSource, detectVideoAlphaMode } from "pixi.js";

export const VIDEO_EXTS = ["mp4", "webm", "mov"];

const stripQuery = (url: string): string => url.split("?")[0] ?? url;

export function isVideoUrl(url: string): boolean {
  const ext = stripQuery(url).split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTS.includes(ext);
}

/** WebKit 계열(iOS 앱 WKWebView·Safari) 감지 — Chrome 계열은 HLS canPlayType이 "maybe"를 주는 경우가
 *  있어 UA로 먼저 배제 (Android WebView는 HEVC 알파 디코드 불가라 반드시 webm 유지) */
function prefersHevc(): boolean {
  const ua = navigator.userAgent;
  if (ua.includes("Chrome") || ua.includes("Chromium") || ua.includes("Android")) return false;
  return document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "";
}

const LOAD_TIMEOUT_MS = 10000;

/** 비디오 URL → Pixi Texture. WebKit에선 webm 대신 HEVC 알파 .mov 사이블링을 우선 시도 */
export async function loadVideoTexture(url: string): Promise<Texture> {
  if (stripQuery(url).endsWith(".webm") && prefersHevc()) {
    const mov = url.replace(/\.webm(\?|$)/, ".mov$1");
    try {
      return canvasVideoTexture(await loadVideoEl(mov));
    } catch { /* mov 없으면 webm으로 폴백 (알파는 깨지지만 아예 안 뜨는 것보단 낫다) */ }
  }
  return videoSourceTexture(await loadVideoEl(url));
}

/** 비디오 엘리먼트 생성 + canplay까지 대기 — WebKit은 명시적 load() 없이는 detached 비디오를 로드하지 않음 */
function loadVideoEl(url: string): Promise<HTMLVideoElement> {
  const el = document.createElement("video");
  el.muted = true;
  el.playsInline = true;
  el.loop = true; // 게임 내 모든 비디오 에셋은 루프 전제 (로비는 loopVideo가 넘겨받아 false로 전환)
  el.preload = "auto";
  el.src = url;
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error(`video load timeout: ${url}`)), LOAD_TIMEOUT_MS);
    const cleanup = (): void => {
      clearTimeout(timer);
      el.removeEventListener("canplay", ok);
      el.removeEventListener("error", onErr);
    };
    const ok = (): void => { cleanup(); resolve(el); };
    const fail = (e: Error): void => {
      cleanup();
      el.removeAttribute("src");
      reject(e);
    };
    const onErr = (): void => fail(new Error(`video load error: ${url}`));
    el.addEventListener("canplay", ok);
    el.addEventListener("error", onErr);
    el.load();
  });
}

/** 일반 경로: Pixi VideoSource 텍스처 (Chrome/Android — WebGL 업로드가 알파 보존) */
async function videoSourceTexture(el: HTMLVideoElement): Promise<Texture> {
  // detectVideoAlphaMode도 내부적으로 VP9 테스트 영상의 이벤트를 기다림 — WebKit에서 안 올 수 있어 타임아웃 방어
  const alphaMode = await Promise.race([
    detectVideoAlphaMode(),
    new Promise<"premultiply-alpha-on-upload">((r) => setTimeout(() => r("premultiply-alpha-on-upload"), 1500)),
  ]);
  const source = new VideoSource({ resource: el, autoPlay: true, alphaMode });
  void el.play().catch(() => {}); // muted+playsinline이라 자동재생 허용 — 실패해도 텍스처는 유효
  return new Texture({ source });
}

/** WebKit 알파 경로: 매 프레임 2D 캔버스로 복사 후 업로드 — texImage2D(video)가 HEVC 알파를 버리는 것 우회 */
function canvasVideoTexture(el: HTMLVideoElement): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = el.videoWidth;
  canvas.height = el.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(el, 0, 0);
  const tex = Texture.from(canvas);
  const pump = (): void => {
    if (tex.destroyed) { el.pause(); return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(el, 0, 0);
    tex.source.update();
    el.requestVideoFrameCallback(pump);
  };
  el.requestVideoFrameCallback(pump);
  void el.play().catch(() => {});
  return tex;
}
