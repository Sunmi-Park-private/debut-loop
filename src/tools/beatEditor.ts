// tools/beatEditor.ts — 리듬 박자표 에디터 (dev 전용, beat.html).
// 곡(리듬 1~3)×모드(이지 2열/하드 3열)별 노트 배치: 파형 타임라인 + 탭 녹음(F/G/J) + BPM 스냅.
// 저장 → /__beatmaps → 게임 리듬 로테이션에서 해당 곡·모드 박자표로 재생.
import { bgmTracks } from "../ui/audio";
import { beatmaps } from "../data";
import type { Beatmap, BeatmapNote, RhythmMode } from "../engine/types";

const RHYTHM_IDS = ["rhythm", "rhythm-2", "rhythm-3"];
const LANE_META = [
  { icon: "🎤", name: "왼쪽 (F/←)", color: "#f0c05a" },
  { icon: "⭐", name: "중앙 (G/↓)", color: "#7ec8f0" },
  { icon: "💃", name: "오른쪽 (J/→)", color: "#ff7fb0" },
];

let trackId = RHYTHM_IDS.find((id) => bgmTracks.find((t) => t.id === id)?.file) ?? "rhythm";
let mode: RhythmMode = "easy";
let pps = 80;            // px per second (줌)
let bpm = 128;
let snapDiv = 4;         // 1/4박 (0 = 스냅 끄기)
let duration = 0;        // 초
let notes: BeatmapNote[] = [];
const audio = new Audio();
let peaks: number[] = [];

const lanesOf = (m: RhythmMode): number[] => (m === "easy" ? [0, 1] : [0, 1, 2]);
/** easy 레인 표시 메타: 0=좌, 1=우 (게임과 동일 규약) */
const laneMeta = (lane: number): { icon: string; name: string; color: string } =>
  LANE_META[mode === "easy" ? lane * 2 : lane] ?? LANE_META[0]!;

const getMap = (): Beatmap => {
  const set = (beatmaps[trackId] ??= {});
  return (set[mode] ??= { bpm, notes: [] });
};
const snap = (tMs: number): number => {
  if (snapDiv <= 0 || bpm <= 0) return Math.round(tMs);
  const step = 60000 / bpm / snapDiv;
  return Math.round(Math.round(tMs / step) * step);
};

const root = document.getElementById("beat-editor")!;
root.innerHTML = `
  <div style="font:13px -apple-system,sans-serif;color:#e8def4;padding:22px 26px;max-width:1280px;margin:0 auto">
    <a href="editor.html" style="display:inline-block;font-size:12px;color:#c9b6e6;text-decoration:none;background:#241539;border:1.5px solid #3a2555;padding:5px 12px;border-radius:10px;margin-bottom:12px">← 에디터 허브</a>
    <h1 style="margin:0 0 12px;font-size:19px">🥁 박자 에디터</h1>
    <div style="display:flex;align-items:center;gap:10px;background:#221338;border:2px solid #3a2757;border-radius:14px;padding:12px 16px;flex-wrap:wrap">
      <span id="time" style="font-variant-numeric:tabular-nums;font-weight:800;color:#7ef0c0;min-width:118px;font-size:14px">0:00.0 / 0:00.0</span>
      <span>곡</span><select id="track" style="background:#3a2555;border:0;color:#e8def4;padding:7px 10px;border-radius:8px"></select>
      <span>모드</span><select id="mode" style="background:#3a2555;border:0;color:#e8def4;padding:7px 10px;border-radius:8px">
        <option value="easy">이지 (2열)</option><option value="hard">하드 (3열)</option></select>
      <span>BPM</span><input id="bpm" type="number" value="128" style="width:64px;background:#3a2555;border:0;color:#e8def4;padding:7px 8px;border-radius:8px" />
      <span>스냅</span><select id="snap" style="background:#3a2555;border:0;color:#e8def4;padding:7px 10px;border-radius:8px">
        <option value="4">1/4박</option><option value="2">1/2박</option><option value="0">끄기</option></select>
      <button id="play" style="background:#ff7fb0;border:0;color:#fff;font-weight:800;padding:9px 16px;border-radius:9px;cursor:pointer">▶ 재생 (Space)</button>
      <select id="rate" style="background:#3a2555;border:0;color:#e8def4;padding:7px 10px;border-radius:8px">
        <option value="1">1×</option><option value="0.75">0.75×</option><option value="0.5">0.5×</option></select>
      <button id="zoomOut" style="background:#3a2555;border:0;color:#c9b6e6;padding:9px 12px;border-radius:9px;cursor:pointer">줌 −</button>
      <button id="zoomIn" style="background:#3a2555;border:0;color:#c9b6e6;padding:9px 12px;border-radius:9px;cursor:pointer">줌 +</button>
      <button id="save" style="background:#f0c05a;border:0;color:#3a1608;font-weight:800;padding:9px 16px;border-radius:9px;cursor:pointer;margin-left:auto">💾 저장</button>
    </div>
    <div id="scroll" style="position:relative;background:#1b0f2e;border:2px solid #3a2757;border-radius:14px;margin-top:14px;overflow-x:auto">
      <div id="inner" style="position:relative">
        <canvas id="wave" height="90" style="display:block"></canvas>
        <div id="lanes"></div>
        <div id="head" style="position:absolute;top:0;bottom:0;width:2px;background:#7ef0c0;box-shadow:0 0 10px #7ef0c0;pointer-events:none">
          <div id="headGrab" title="드래그로 재생 위치 이동" style="position:absolute;top:0;left:-4px;width:10px;height:10px;border-radius:2px;background:#7ef0c0;box-shadow:0 0 7px #7ef0c0;cursor:grab;pointer-events:auto;border:1.5px solid #fff5"></div>
        </div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:18px;margin-top:12px;color:#a08cc0">
      <span id="stats"></span>
      <a href="./" target="_blank" style="background:#8f80ea;color:#fff;text-decoration:none;font-weight:800;padding:9px 16px;border-radius:9px;margin-left:auto">🎮 게임에서 테스트 (⚙ 리듬 관문)</a>
    </div>
    <div style="margin-top:12px;font-size:11.5px;color:#8a76a8;line-height:1.8">
      <b>F/←</b>(왼쪽) · <b>G/↓</b>(중앙·하드만) · <b>J/→</b>(오른쪽) 키를 누르면 <b style="color:#ffd98a">재생 헤드 위치에 노트가 찍힙니다</b> — 재생하면서 리듬 타듯 누르면 탭 녹음 ·
      빈 레인 클릭 = 노트 추가 · 노트 클릭 = 삭제 · 파형 클릭 = 재생 위치 이동 · 노트는 BPM 격자에 자동 스냅 · 저장 후 게임에서 해당 곡·모드에 적용
    </div>
  </div>`;

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const scroll = $("scroll");
const inner = $("inner");
const wave = $("wave") as HTMLCanvasElement;
const lanesEl = $("lanes");
const head = $("head");

// ── 오디오 로드 + 파형 ──
async function loadTrack(): Promise<void> {
  const file = bgmTracks.find((t) => t.id === trackId)?.file ?? "";
  peaks = [];
  duration = 0;
  if (!file) { render(); return; }
  audio.src = `/${file}`;
  try {
    const buf = await (await fetch(`/${file}`)).arrayBuffer();
    const ac = new AudioContext();
    const ab = await ac.decodeAudioData(buf);
    duration = ab.duration;
    const ch = ab.getChannelData(0);
    const cols = Math.ceil(duration * 200); // 최대 줌 대비 5ms 해상도
    const per = Math.floor(ch.length / cols);
    peaks = Array.from({ length: cols }, (_, i) => {
      let mx = 0;
      for (let j = i * per; j < (i + 1) * per; j += 24) mx = Math.max(mx, Math.abs(ch[j] ?? 0));
      return mx;
    });
    void ac.close();
  } catch { /* 디코드 실패 → 파형 없이 편집 가능 */ }
  const m = beatmaps[trackId]?.[mode];
  notes = m ? [...m.notes] : [];
  bpm = m?.bpm ?? bpm;
  ($("bpm") as HTMLInputElement).value = String(bpm);
  render();
}

// ── 렌더 ──
function render(): void {
  const wpx = Math.max(600, Math.ceil(duration * pps));
  wave.width = wpx;
  inner.style.width = wpx + "px";
  const g = wave.getContext("2d")!;
  g.clearRect(0, 0, wpx, 90);
  if (bpm > 0) { // BPM 격자
    const beatPx = (60 / bpm) * pps;
    g.fillStyle = "#3a275766";
    for (let x = 0; x < wpx; x += beatPx) g.fillRect(x, 0, 1, 90);
  }
  g.fillStyle = "#8f80ea";
  for (let x = 0; x < wpx; x += 2) {
    const v = peaks[Math.floor((x / wpx) * peaks.length)] ?? 0;
    const h = Math.max(2, v * 80);
    g.fillRect(x, (90 - h) / 2, 1.4, h);
  }
  // 레인
  lanesEl.innerHTML = "";
  for (const lane of lanesOf(mode)) {
    const mt = laneMeta(lane);
    const row = document.createElement("div");
    row.style.cssText = "position:relative;height:58px;border-top:1px dashed #3a2757";
    row.innerHTML = `<span style="position:sticky;left:6px;font-weight:800;color:#a08cc0;font-size:11px;line-height:58px;padding-left:8px;z-index:2">${mt.icon} ${mt.name}</span>`;
    if (bpm > 0) row.style.backgroundImage = `repeating-linear-gradient(90deg,#3a275733 0 1px,transparent 1px ${(60 / bpm) * pps}px)`;
    row.onclick = (e) => { // 근처에 노트 있으면 삭제, 없으면 추가 (빗클릭으로 중복 생성 방지)
      const x = e.pageX - inner.getBoundingClientRect().left - window.scrollX;
      const near = notes.filter((n2) => n2.lane === lane)
        .find((n2) => Math.abs((n2.t / 1000) * pps - x) < 18);
      if (near) { notes = notes.filter((x2) => x2 !== near); render(); return; }
      notes.push({ t: snap((x / pps) * 1000), lane });
      render();
    };
    for (const n of notes.filter((n2) => n2.lane === lane)) {
      const dot = document.createElement("span");
      dot.title = `${(n.t / 1000).toFixed(2)}s — 클릭=삭제`;
      dot.style.cssText = `position:absolute;left:${(n.t / 1000) * pps - 12}px;top:17px;width:24px;height:24px;border-radius:50%;cursor:pointer;
        background:radial-gradient(circle at 35% 30%, #fff8, ${mt.color});box-shadow:0 0 7px ${mt.color}88;border:2px solid #fff3`;
      dot.onclick = (e) => { e.stopPropagation(); notes = notes.filter((x) => x !== n); render(); };
      row.appendChild(dot);
    }
    lanesEl.appendChild(row);
  }
  $("stats").textContent = `노트 ${notes.length}개 · 길이 ${duration.toFixed(1)}s · 밀도 ${(duration > 0 ? notes.length / duration : 0).toFixed(1)}/s · ${trackId} · ${mode === "easy" ? "이지(2열)" : "하드(3열)"}`;
}

// ── 재생/헤드 ──
const fmt = (t: number): string => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
const timeEl = $("time");
(function loop() {
  head.style.left = (audio.currentTime * pps) + "px";
  timeEl.textContent = `${fmt(audio.currentTime)} / ${fmt(duration)}`; // 실시간 재생 위치 / 곡 길이
  if (!audio.paused) { // 헤드 따라 자동 스크롤
    const hx = audio.currentTime * pps;
    if (hx > scroll.scrollLeft + scroll.clientWidth - 120) scroll.scrollLeft = hx - 120;
  }
  requestAnimationFrame(loop);
})();
wave.onclick = (e) => { audio.currentTime = (e.offsetX / pps); };

// ⏺ 재생 헤드 드래그 스크럽
const headGrab = $("headGrab");
let scrubbing = false;
headGrab.addEventListener("pointerdown", (e) => { scrubbing = true; e.preventDefault(); e.stopPropagation(); });
window.addEventListener("pointermove", (e) => {
  if (!scrubbing) return;
  const x = e.clientX - inner.getBoundingClientRect().left;
  audio.currentTime = Math.max(0, Math.min(duration || 0, x / pps));
});
window.addEventListener("pointerup", () => { scrubbing = false; });

const playBtn = $("play");
const setPlay = (p: boolean): void => {
  if (p) void audio.play().catch(() => {});
  else audio.pause();
  playBtn.textContent = audio.paused ? "▶ 재생 (Space)" : "⏸ 정지 (Space)";
};
playBtn.onclick = () => { (document.activeElement as HTMLElement | null)?.blur(); setPlay(audio.paused); };
audio.onended = () => setPlay(false);

// ── 키 입력 = 재생 헤드 위치에 노트 (탭 녹음) ──
window.addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName ?? "";
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return; // BPM 입력 등은 방해 안 함
  if (e.code === "Space") { e.preventDefault(); setPlay(audio.paused); return; }
  const keyLane: Record<string, number | undefined> = mode === "easy"
    ? { KeyF: 0, ArrowLeft: 0, KeyJ: 1, ArrowRight: 1 }
    : { KeyF: 0, ArrowLeft: 0, KeyG: 1, ArrowDown: 1, KeyJ: 2, ArrowRight: 2 };
  const lane = keyLane[e.code];
  if (lane === undefined) return;
  e.preventDefault(); // 방향키가 타임라인 횡스크롤로 새지 않게 항상 가로챔
  // 키 = 재생 헤드 위치에 노트 추가 — 재생 중이든 정지든 동작 (⏺ 녹음은 라이브 탭핑용 안내일 뿐 조건 아님)
  notes.push({ t: snap(audio.currentTime * 1000), lane });
  render();
}, { capture: true });

// ── 컨트롤 ──
const trackSel = $("track") as HTMLSelectElement;
for (const id of RHYTHM_IDS) {
  const t = bgmTracks.find((x) => x.id === id);
  const o = document.createElement("option");
  o.value = id;
  o.textContent = `${t?.label ?? id}${t?.file ? "" : " (곡 미업로드)"}`;
  trackSel.appendChild(o);
}
trackSel.value = trackId;
trackSel.onchange = () => { commit(); trackId = trackSel.value; void loadTrack(); };
($("mode") as HTMLSelectElement).onchange = (e) => { commit(); mode = (e.target as HTMLSelectElement).value as RhythmMode; void loadTrack(); };
($("bpm") as HTMLInputElement).onchange = (e) => { bpm = Number((e.target as HTMLInputElement).value) || 0; render(); };
($("snap") as HTMLSelectElement).onchange = (e) => { snapDiv = Number((e.target as HTMLSelectElement).value); };
($("rate") as HTMLSelectElement).onchange = (e) => { audio.playbackRate = Number((e.target as HTMLSelectElement).value); };
$("zoomIn").onclick = () => { pps = Math.min(240, pps * 1.5); render(); };
$("zoomOut").onclick = () => { pps = Math.max(30, pps / 1.5); render(); };

/** 현재 편집 내용을 in-memory 맵에 반영 (곡/모드 전환·저장 전 호출) */
function commit(): void {
  const m = getMap();
  m.bpm = bpm;
  m.notes = [...notes].sort((a, b) => a.t - b.t);
}
$("save").onclick = () => {
  commit();
  void fetch("/__beatmaps", { method: "POST", body: JSON.stringify({ _note: "리듬 박자표 — beat.html 에디터 산출물", maps: beatmaps }) })
    .then((r) => { $("save").textContent = r.ok ? "✅ 저장됨" : "❌ 실패"; setTimeout(() => { $("save").textContent = "💾 저장"; }, 1500); });
};

void loadTrack();
