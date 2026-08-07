// ui/audio.ts — BGM 매니저 (HTMLAudio 기반). 트랙은 data/bgm.json 슬롯(bgm.html 에디터로 업로드).
// 모바일 물리 볼륨 버튼: 웹은 시스템 볼륨 API가 없지만, HTMLAudio는 OS '미디어 볼륨' 채널로
// 재생되므로 기기 볼륨 버튼이 자동으로 적용된다 (별도 코드 불필요).
import { isDevMode } from "./devMode";
import bgmJson from "../data/bgm.json";

export interface BgmTrack { id: string; label: string; file: string; base: number; desc?: string }
export const bgmTracks: BgmTrack[] = (bgmJson as unknown as { tracks: BgmTrack[] }).tracks;
export type BgmId = string; // bgm.json 슬롯 id (lobby|main|training|arcade|dodge|regress|true|dark)

const byId = new Map(bgmTracks.map((t) => [t.id, t]));
// 미업로드 슬롯 폴백 — lobby는 무변경(진입 전 음악 유지), 나머지 장면은 main으로 (main도 없으면 무음)
// slot은 큐(효과음)라 폴백 없음 — 미업로드면 스핀 무음
const FALLBACK: Record<string, string | null> = {
  lobby: null, training: "main", rhythm: "main", "rhythm-2": "main", "rhythm-3": "main",
  "slot-bgm": "main", dodge: "main", regress: "main", true: "main", dark: "main",
  "prologue-01": "main",
};

// 리듬 트랙 로테이션 — 업로드된 곡(1~3번) 사이를 판마다 순환 (질림 방지)
const RHYTHM_IDS = ["rhythm", "rhythm-2", "rhythm-3"];
let rhythmCursor = -1;
/** 다음 리듬 트랙 id — 업로드된 곡이 없으면 "rhythm"(→ main 폴백) */
export function nextRhythmTrack(): BgmId {
  const avail = RHYTHM_IDS.filter((id) => byId.get(id)?.file);
  if (avail.length === 0) return "rhythm";
  rhythmCursor = (rhythmCursor + 1) % avail.length;
  return avail[rhythmCursor] ?? "rhythm";
}

/** 슬롯 → 실제 재생 트랙 (file 없으면 폴백 체인, null=재생 변경 없음) */
function resolveTrack(id: BgmId): BgmTrack | null {
  const t = byId.get(id);
  if (t?.file) return t;
  const fb = FALLBACK[id];
  return fb ? resolveTrack(fb) : null;
}

const els = new Map<BgmId, HTMLAudioElement>();
let currentId: BgmId | null = null;
let sceneId: BgmId | null = null; // 마지막으로 요청된 장면 슬롯 — 핫스왑(업로드·삭제) 시 재평가 기준
let unlocked = false;
export const DEFAULT_VOLUME = 30; // 기본 볼륨 (0~100)
let master = (() => {
  const v = Number(localStorage.getItem("debutloop.bgmVolume") ?? String(DEFAULT_VOLUME));
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) / 100 : DEFAULT_VOLUME / 100;
})();

let muted = localStorage.getItem("debutloop.bgmMuted") === "1";

const applyVolume = (): void => {
  for (const [id, a] of els) a.volume = muted ? 0 : (byId.get(id)?.base ?? 0.5) * master;
};

function el(t: BgmTrack): HTMLAudioElement {
  let a = els.get(t.id);
  if (!a) {
    a = new Audio(t.file);
    a.loop = true;
    a.preload = "auto";
    els.set(t.id, a);
  }
  a.volume = muted ? 0 : t.base * master;
  return a;
}

/** 음소거 — 볼륨값은 보존, 해제 시 원래 볼륨으로 복귀. localStorage 유지 */
export function bgmMuted(): boolean { return muted; }
export function setBgmMuted(m: boolean): void {
  muted = m;
  localStorage.setItem("debutloop.bgmMuted", m ? "1" : "0");
  applyVolume();
}

const stopCurrent = (): void => {
  if (!currentId) return;
  const prev = els.get(currentId);
  prev?.pause();
  if (prev) prev.currentTime = 0;
  currentId = null;
};

/** 장면 슬롯 재생 — 미업로드 슬롯은 폴백, 폴백도 없으면 정지(삭제가 곧바로 침묵으로 반영). 자동재생 차단 시 첫 제스처에서 재시도 */
export function playBgm(id: BgmId): void {
  sceneId = id;
  const t = resolveTrack(id);
  if (!t) { stopCurrent(); return; }
  if (currentId === t.id) {
    if (unlocked) void el(t).play().catch(() => {});
    return;
  }
  if (currentId) {
    const prev = els.get(currentId);
    prev?.pause();
    if (prev) prev.currentTime = 0;
  }
  currentId = t.id;
  if (unlocked) void el(t).play().catch(() => {});
}

export function currentBgm(): BgmId | null { return currentId; }

// ── 일시정지/재개 — 레이아웃 에디터 등 게임 pause용. 노트 시계(bgmPositionMs)도 함께 멈춘다 ──
let userPaused = false; // visibilitychange 자동 재개가 pause를 깨지 않게
export function pauseBgm(): void {
  userPaused = true;
  if (currentId) els.get(currentId)?.pause();
}
export function resumeBgm(): void {
  userPaused = false;
  const a = currentId ? els.get(currentId) : null;
  if (a && unlocked) void a.play().catch(() => {});
}

/** 트랙의 현재 재생 위치(ms) — 리듬 노트를 음악에 정확히 동기화할 때 사용. 미재생이면 null */
export function bgmPositionMs(id: BgmId): number | null {
  const t = resolveTrack(id);
  const a = t ? els.get(t.id) : null;
  if (!a || a.paused) return null;
  return a.currentTime * 1000;
}

// ── 큐(효과음형 트랙): BGM 전환 없이 1회 재생 — 슬롯 릴 사운드 등 ──
const cueEls = new Map<BgmId, HTMLAudioElement>();

/** 트랙을 효과음처럼 처음부터 1회 재생 (루프·BGM 전환 없음) */
export function playCue(id: BgmId): void {
  const t = byId.get(id);
  if (!t?.file) return; // 미업로드 → 무음
  let a = cueEls.get(id);
  if (!a) {
    a = new Audio(t.file);
    a.loop = false;
    cueEls.set(id, a);
  }
  a.volume = muted ? 0 : t.base * master;
  a.currentTime = 0;
  void a.play().catch(() => {});
}

/** 재생 중인 큐 정지 (슬롯 릴 멈춤 등) */
export function stopCue(id: BgmId): void {
  const a = cueEls.get(id);
  if (a) { a.pause(); a.currentTime = 0; }
}

/** 트랙을 처음(0초)부터 재생 — 리듬 라운드 시작(첫 판·광고 보너스 판) 등 곡 싱크가 필요할 때 */
export function restartBgm(id: BgmId): void {
  sceneId = id;
  const t = resolveTrack(id);
  if (!t) { stopCurrent(); return; }
  if (currentId !== t.id) {
    const prev = currentId ? els.get(currentId) : null;
    prev?.pause();
    if (prev) prev.currentTime = 0;
    currentId = t.id;
  }
  const a = el(t);
  a.currentTime = 0;
  if (unlocked) void a.play().catch(() => {});
}

/** 마스터 볼륨 (0~100) — 트랙별 기본 배율(base)에 곱해짐, localStorage 유지 */
export function bgmVolume(): number { return Math.round(master * 100); }
export function setBgmVolume(v: number): void {
  master = Math.max(0, Math.min(100, v)) / 100;
  localStorage.setItem("debutloop.bgmVolume", String(Math.round(master * 100)));
  applyVolume();
}

/** 브라우저 자동재생 정책 대응: 첫 사용자 제스처에서 재생 언락 */
export function initAudioUnlock(): void {
  const unlock = (): void => {
    if (unlocked) return;
    unlocked = true;
    const a = currentId ? els.get(currentId) : null;
    if (a) void a.play().catch(() => {});
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  // 백그라운드 진입(홈 버튼·탭 전환) 시 정지, 복귀 시 재개 — APK·웹 공통
  document.addEventListener("visibilitychange", () => {
    const a = currentId ? els.get(currentId) : null;
    if (!a) return;
    if (document.hidden) a.pause();
    else if (unlocked && !userPaused) void a.play().catch(() => {});
  });
  if (isDevMode()) {
    // 개발용 검증 훅
    (window as unknown as { __bgm: unknown }).__bgm = {
      current: currentBgm, volume: bgmVolume, setVolume: setBgmVolume,
      tracks: () => bgmTracks,
      scene: () => sceneId,
      state: (id: BgmId) => { const a = els.get(id); return a ? { paused: a.paused, volume: a.volume, time: a.currentTime } : null; },
    };
  }
}

// 개발용 핫스왑: bgm.html 에디터의 업로드/삭제를 리로드 없이 반영 (bgm.json은 vite watch 제외).
// vite WebSocket 커스텀 이벤트 — 같은 브라우저뿐 아니라 터널로 접속한 다른 기기의 게임에도 전파된다.
if (import.meta.hot) {
  import.meta.hot.on("asset-updated", (d: { route: string; id: string; file: string }) => {
    if (d.route !== "/__bgmupload") return;
    const t = byId.get(d.id);
    if (!t) return;
    t.file = d.file ? `${d.file}?v=${Date.now()}` : ""; // 같은 파일명 재업로드 캐시 무효화
    const a = els.get(d.id);
    if (a) { a.pause(); els.delete(d.id); }
    const cu = cueEls.get(d.id);
    if (cu) { cu.pause(); cueEls.delete(d.id); } // 큐 캐시도 새 파일로
    // 재생 중인 트랙이거나 현재 장면의 슬롯이 바뀜 → 장면 기준으로 재평가 (교체·삭제·현재 장면에 신규 업로드 모두 즉시 반영)
    if (currentId === d.id || sceneId === d.id) {
      currentId = null;
      playBgm(sceneId ?? d.id);
    }
  });
}
