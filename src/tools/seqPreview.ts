// tools/seqPreview.ts — 시퀀스 라이트박스 플레이어 (에디터 공용: bg.html·char.html).
// 재생/일시정지 · 프레임 슬라이더(스크럽) · 속도 조절 · ESC/배경 클릭 닫기 · Space=재생토글 · ←→=프레임 이동.

export function openSeqPreview(title: string, frames: string[], baseMs = 700): void {
  if (frames.length === 0) return;
  const len = frames.length;
  let i = 0;
  let playing = true;
  let speed = 1;
  let timer = 0;

  const bg = document.createElement("div");
  bg.style.cssText = "position:fixed;inset:0;z-index:2000;background:#0b0615e6;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)";
  bg.innerHTML = `
    <div data-panel style="background:#221338;border:2px solid #3a2757;border-radius:16px;max-width:min(92vw,760px);width:100%;padding:16px 18px;font:13px -apple-system,sans-serif;color:#e8def4">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <b style="font-size:14px;flex:1">🎞 ${title}</b>
        <span data-counter style="color:#a08cc0;font-variant-numeric:tabular-nums"></span>
        <button data-close style="background:#3a2555;border:0;color:#c9b6e6;font-size:13px;padding:5px 12px;border-radius:8px;cursor:pointer">✕ 닫기 (ESC)</button>
      </div>
      <div style="background:#150b26;border-radius:12px;display:flex;align-items:center;justify-content:center;height:min(60vh,520px)">
        <img data-frame style="max-width:100%;max-height:100%;object-fit:contain" />
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:12px">
        <button data-play style="background:#ff7fb0;border:0;color:#fff;font-weight:800;font-size:13px;padding:7px 16px;border-radius:9px;cursor:pointer;min-width:88px">⏸ 정지</button>
        <input data-range type="range" min="0" max="${len - 1}" value="0" step="1" style="flex:1;accent-color:#ff7fb0" />
        <select data-speed style="background:#3a2555;border:0;color:#e8def4;padding:6px 8px;border-radius:8px;font-size:12px">
          <option value="0.5">0.5×</option>
          <option value="1" selected>1×</option>
          <option value="2">2×</option>
        </select>
      </div>
      <div style="margin-top:8px;font-size:11px;color:#8a76a8">Space = 재생/정지 · ← → = 한 프레임 이동 · 슬라이더 드래그 = 스크럽</div>
    </div>`;
  document.body.appendChild(bg);

  const img = bg.querySelector("[data-frame]") as HTMLImageElement;
  const range = bg.querySelector("[data-range]") as HTMLInputElement;
  const counter = bg.querySelector("[data-counter]") as HTMLElement;
  const playBtn = bg.querySelector("[data-play]") as HTMLButtonElement;
  const speedSel = bg.querySelector("[data-speed]") as HTMLSelectElement;

  const show = (n: number): void => {
    i = ((n % len) + len) % len;
    img.src = `/${frames[i]}`;
    range.value = String(i);
    counter.textContent = `${i + 1} / ${len}`;
  };
  const stop = (): void => { window.clearInterval(timer); timer = 0; };
  const start = (): void => {
    stop();
    timer = window.setInterval(() => show(i + 1), baseMs / speed);
  };
  const setPlaying = (p: boolean): void => {
    playing = p;
    playBtn.textContent = p ? "⏸ 정지" : "▶ 재생";
    if (p) start(); else stop();
  };

  playBtn.onclick = () => setPlaying(!playing);
  range.oninput = () => { setPlaying(false); show(Number(range.value)); };
  speedSel.onchange = () => { speed = Number(speedSel.value); if (playing) start(); };

  const close = (): void => {
    stop();
    window.removeEventListener("keydown", onKey);
    bg.remove();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.code === "Space") { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setPlaying(false); show(i + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setPlaying(false); show(i - 1); }
  };
  window.addEventListener("keydown", onKey);
  (bg.querySelector("[data-close]") as HTMLButtonElement).onclick = close;
  bg.onclick = (e) => { if (e.target === bg) close(); };

  show(0);
  start();
}
