// tools/bgmEditor.ts — 배경음악 슬롯 그리드 에디터 (dev 전용, bgm.html).
// 슬롯 클릭/드롭 업로드 → /__bgmupload → data/bgm.json 갱신 → 게임 장면별 자동 재생.
import { bgmTracks, type BgmTrack } from "../ui/audio";

const EXTS = ["mp3", "ogg", "wav", "m4a"];
// 핫스왑 알림은 서버가 vite WebSocket으로 전 기기에 푸시 — 에디터가 보낼 것 없음

const root = document.getElementById("bgm-editor")!;
root.innerHTML = `
  <div style="font:14px -apple-system,sans-serif;color:#e8def4;padding:22px 26px">
    <a href="editor.html" style="display:inline-block;font-size:12px;color:#c9b6e6;text-decoration:none;background:#241539;border:1.5px solid #3a2555;padding:5px 12px;border-radius:10px;margin-bottom:12px">← 에디터 허브</a>
    <h1 style="margin:0 0 4px;font-size:19px">🎵 배경음악 에디터</h1>
    <p style="margin:0 0 18px;font-size:12px;color:#a08cc0">카드 클릭 또는 오디오 파일 드래그&드롭 = 업로드 (mp3/ogg/wav/m4a · 25MB) · 업로드 즉시 게임에 적용 — 게임 새로고침 없음, 진행 중인 런 유지</p>
    <div id="grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px"></div>
  </div>`;
const grid = document.getElementById("grid")!;

const upload = async (t: BgmTrack, file: File, cell: HTMLElement): Promise<void> => {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!EXTS.includes(ext)) { alert("mp3/ogg/wav/m4a만 가능합니다"); return; }
  if (file.size > 25 * 1024 * 1024) { alert("25MB 이하만 가능합니다"); return; }
  cell.style.opacity = "0.5";
  const r = await fetch(`/__bgmupload?slot=${t.id}&ext=${ext}`, { method: "POST", body: file });
  cell.style.opacity = "1";
  if (!r.ok) { alert(`업로드 실패: ${await r.text()}`); return; }
  // 제자리 갱신 (bg 에디터와 동일 — 리로드 경합 회피)
  const rel = `assets/audio/${t.id}.${ext}`;
  t.file = rel;
  const audio = cell.querySelector("audio") as HTMLAudioElement;
  const fileT = cell.querySelector("[data-file]") as HTMLElement;
  audio.style.display = "";
  audio.src = `/${rel}?v=${Date.now()}`;
  fileT.textContent = `📄 ${rel.split("/").pop()}`;
  fileT.style.color = "#8fe3b0";
  (cell.querySelector("[data-ico]") as HTMLElement).textContent = "🎵";
  (cell.querySelector("[data-del]") as HTMLElement).style.display = "";
};

for (const t of bgmTracks) {
  const cell = document.createElement("div");
  cell.style.cssText = "background:#241539;border:2px solid #3a2555;border-radius:14px;padding:16px;cursor:pointer";
  const has = !!t.file;
  cell.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px">
      <span data-ico style="font-size:22px">${has ? "🎵" : "🔇"}</span>
      <div style="flex:1">
        <div style="font-weight:800;font-size:14px">${t.label}</div>
        <div style="font-size:11px;color:#8a76a8;margin-top:2px">${t.desc ?? ""}</div>
      </div>
      <button data-del style="background:#3a2555;border:0;color:#c9b6e6;font-size:11px;padding:5px 10px;border-radius:8px;cursor:pointer;${has ? "" : "display:none"}">🗑 삭제</button>
    </div>
    <div data-file style="font-size:11px;margin:10px 0 6px;color:${has ? "#8fe3b0" : "#5f4a80"}">${has ? `📄 ${t.file.split("/").pop()}` : "미업로드 — 클릭해서 추가"}</div>
    <audio controls preload="none" style="width:100%;height:34px;${has ? "" : "display:none"}" src="${has ? `/${t.file}?v=${Date.now()}` : ""}"></audio>`;
  const delBtn = cell.querySelector("[data-del]") as HTMLButtonElement;
  delBtn.onclick = async (e) => {
    e.stopPropagation(); // 카드 클릭(업로드) 미트리거
    if (!confirm(`'${t.label}' 트랙을 삭제할까요? 해당 장면은 기본(폴백) 음악으로 돌아갑니다.`)) return;
    const r = await fetch(`/__bgmupload?slot=${t.id}`, { method: "DELETE" });
    if (!r.ok) { alert(`삭제 실패: ${await r.text()}`); return; }
    t.file = "";
    (cell.querySelector("[data-ico]") as HTMLElement).textContent = "🔇";
    const fileT = cell.querySelector("[data-file]") as HTMLElement;
    fileT.textContent = "미업로드 — 클릭해서 추가";
    fileT.style.color = "#5f4a80";
    const audio = cell.querySelector("audio") as HTMLAudioElement;
    audio.pause();
    audio.style.display = "none";
    delBtn.style.display = "none";
  };
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "audio/mpeg,audio/ogg,audio/wav,audio/mp4,.mp3,.ogg,.wav,.m4a";
  input.style.display = "none";
  input.onchange = () => { if (input.files?.[0]) void upload(t, input.files[0], cell); };
  cell.appendChild(input);
  cell.onclick = (e) => { if ((e.target as HTMLElement).tagName !== "AUDIO") input.click(); }; // 플레이어 조작은 업로드 미트리거
  cell.ondragover = (e) => { e.preventDefault(); cell.style.borderColor = "#ff7fb0"; };
  cell.ondragleave = () => { cell.style.borderColor = "#3a2555"; };
  cell.ondrop = (e) => {
    e.preventDefault();
    cell.style.borderColor = "#3a2555";
    const f = e.dataTransfer?.files?.[0];
    if (f) void upload(t, f, cell);
  };
  grid.appendChild(cell);
}
