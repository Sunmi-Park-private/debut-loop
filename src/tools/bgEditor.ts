// tools/bgEditor.ts — 배경 슬롯 그리드 에디터 (dev 전용, bg.html).
// 슬롯을 게임 진행 순서로 한 장표에 펼치고, 클릭/드롭 업로드 → /__bgupload → 게임 자동 반영.
import { bgManifest, type BgSlot } from "../ui/bgSlots";

// 표시 그룹: ①프롤로그·로딩·타이틀 ②1~5막(스토리) ③게임 화면(관문·오디션) — 그룹 사이 구분선
const GROUPS: Array<{ title: string; ids: string[] }> = [
  { title: "🎬 인트로 (프롤로그 · 로딩 · 타이틀)", ids: ["prologue-01", "prologue-02", "loading", "title", "true-ending"] },
  { title: "📖 스토리 (W0 · 1~5막)", ids: ["act0", "act1", "act2", "act3", "act4", "act5"] },
  { title: "🎮 게임 화면 (관문 · 오디션 · 연습)", ids: ["gate-act2", "gate-act3", "gate-act4", "gate-clue4", "gate-block", "audition", "training"] },
];
const CAT: Array<[BgSlot[], string, string]> = [
  [bgManifest.story, "스토리", "#ff7fb0"],
  [bgManifest.gates, "관문", "#a78be6"],
  [bgManifest.system, "시스템", "#f0c05a"],
];
const lookup = (id: string): { slot: BgSlot; cat: string; color: string } | null => {
  for (const [list, cat, color] of CAT) {
    const slot = list.find((s) => s.id === id);
    if (slot) return { slot, cat, color };
  }
  return null;
};
const trigger = (s: BgSlot): string =>
  s.beatIds ? `비트 ${s.beatIds.join(", ")}` : s.act !== undefined ? `act ≥ ${s.act}` : s.gateId ? `관문 ${s.gateId}` : "시스템";

const root = document.getElementById("bg-editor")!;
root.innerHTML = `
  <div style="font:14px -apple-system,sans-serif;color:#e8def4;padding:22px 26px">
    <a href="editor.html" style="display:inline-block;font-size:12px;color:#c9b6e6;text-decoration:none;background:#241539;border:1.5px solid #3a2555;padding:5px 12px;border-radius:10px;margin-bottom:12px">← 에디터 허브</a>
    <h1 style="margin:0 0 4px;font-size:19px">🖼 배경 에디터</h1>
    <p style="margin:0 0 18px;font-size:12px;color:#a08cc0">카드 클릭 또는 이미지 드래그&드롭 = 업로드 (png/jpg/webp · 10MB) · 업로드 즉시 게임에 반영됩니다</p>
    <div id="sections"></div>
  </div>`;
const sections = document.getElementById("sections")!;

/** 그리드 셀 리얼타임 재생 — 게임과 동일한 프레임 간격(slot.frameMs)으로 시퀀스 순환 */
const animatePreview = (img: HTMLImageElement, urls: string[], frameMs = 1200): void => {
  window.clearInterval(Number(img.dataset["timer"] ?? 0));
  if (urls.length === 0) return;
  let i = 0;
  img.src = `/${urls[0]}?v=${Date.now()}`;
  if (urls.length < 2) return;
  img.dataset["timer"] = String(window.setInterval(() => {
    if (!img.isConnected) { window.clearInterval(Number(img.dataset["timer"] ?? 0)); return; }
    i = (i + 1) % urls.length;
    img.src = `/${urls[i]}`;
  }, Math.max(50, frameMs)));
};

/** 시퀀스 업로드 (seq 슬롯) — 파일명 순 정렬 후 순차 전송, 완료 시 미리보기 재생 */
const uploadSeq = async (slot: BgSlot, files: File[], cell: HTMLElement): Promise<void> => {
  const list = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const f of list) {
    const ext = (f.name.split(".").pop()?.toLowerCase() ?? "").replace("jpeg", "jpg");
    if (!["png", "jpg", "webp"].includes(ext)) { alert(`${f.name}: png/jpg/webp만 가능합니다`); return; }
    if (f.size > 10 * 1024 * 1024) { alert(`${f.name}: 10MB 이하만 가능합니다`); return; }
  }
  // 폴더째 잘못 선택하는 사고 방지 (로딩 97프레임·idle 93프레임 사건) — 장수를 보여주고 확인
  if (!window.confirm(`${list.length}장을 '${slot.label}' 시퀀스로 업로드합니다.\n(기존 시퀀스는 대체됩니다) 계속할까요?`)) return;
  cell.style.opacity = "0.5";
  let frames: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i]!;
    const ext = (f.name.split(".").pop()?.toLowerCase() ?? "").replace("jpeg", "jpg");
    const r = await fetch(`/__bgseq?slot=${slot.id}&ext=${ext}&i=${i}&total=${list.length}`, { method: "POST", body: f });
    if (!r.ok) { alert(`업로드 실패(${f.name}): ${await r.text()}`); cell.style.opacity = "1"; return; }
    frames = (await r.json()) as string[];
  }
  cell.style.opacity = "1";
  slot.frames = frames;
  const img = cell.querySelector("img") as HTMLImageElement;
  const empty = cell.querySelector("span") as HTMLElement;
  const dim = cell.querySelector("[data-dim]") as HTMLElement;
  img.style.display = "";
  empty.style.display = "none";
  img.dataset["retries"] = "6";
  img.onload = () => {}; // 프레임 수 표기 유지 (기본 onload는 치수로 덮어씀)
  dim.textContent = `▶ 🎞 ${frames.length}프레임`;
  animatePreview(img, frames, slot.frameMs);
};

/** 셀 썸네일을 mp4 무한 루프 비디오로 교체 (img 숨김) */
const showVideo = (cell: HTMLElement, src: string): void => {
  const img = cell.querySelector("img") as HTMLImageElement;
  window.clearInterval(Number(img.dataset["timer"] ?? 0));
  img.style.display = "none";
  (cell.querySelector("span") as HTMLElement).style.display = "none";
  cell.querySelector("video")?.remove();
  const v = document.createElement("video");
  v.src = src;
  v.autoplay = true;
  v.loop = true;
  v.muted = true;
  v.playsInline = true;
  v.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain";
  img.parentElement!.prepend(v);
};

const upload = async (slot: BgSlot, file: File, cell: HTMLElement): Promise<void> => {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const norm = ext === "jpeg" ? "jpg" : ext;
  const isMp4 = norm === "mp4";
  if (isMp4 && !slot.vid) { alert("이 슬롯은 이미지 전용입니다"); return; }
  if (!isMp4 && !["png", "jpg", "webp"].includes(norm)) {
    alert(slot.vid ? "png/jpg/webp 또는 mp4만 가능합니다" : "png/jpg/webp만 가능합니다");
    return;
  }
  if (!isMp4 && file.size > 10 * 1024 * 1024) { alert("이미지는 10MB 이하만 가능합니다"); return; } // 영상은 용량 제한 없음
  cell.style.opacity = "0.5";
  const r = await fetch(`/__bgupload?slot=${slot.id}&ext=${norm}`, { method: "POST", body: file });
  if (!r.ok) { alert(`업로드 실패: ${await r.text()}`); cell.style.opacity = "1"; return; }
  // 리로드 대신 제자리 갱신 — 업로드 직후 vite 리로드와 겹치면 이미지 요청이 중단돼 '미업로드' 오탐
  cell.style.opacity = "1";
  // 서버가 최종 경로를 돌려준다 — 이미지는 webp로 변환되므로 클라이언트가 확장자를 추측하면 어긋난다
  slot.file = (await r.text()).trim() || `assets/bg/${slot.id}.${norm}`;
  delete slot.frames; // 단일 업로드 = 시퀀스 대체 (서버도 동일하게 정리)
  if (isMp4) { showVideo(cell, `/${slot.file}?v=${Date.now()}`); return; }
  cell.querySelector("video")?.remove();
  const img = cell.querySelector("img") as HTMLImageElement;
  const empty = cell.querySelector("span") as HTMLElement;
  img.style.display = "";
  empty.style.display = "none";
  img.dataset["src"] = `/${slot.file}`; // 확장자가 바뀌었을 수 있어 재시도 URL 갱신
  img.dataset["retries"] = "6"; // 업로드 성공 = 파일 존재 보장 → 리로드 경합·지연에도 폴링으로 반드시 표시
  img.src = `${img.dataset["src"]}?v=${Date.now()}`;
};

for (const [gi, group] of GROUPS.entries()) {
  const sec = document.createElement("div");
  sec.innerHTML = `
    ${gi > 0 ? `<hr style="border:none;border-top:2px solid #3a2757;margin:28px 0 0" />` : ""}
    <h2 style="margin:${gi > 0 ? 22 : 0}px 0 10px;font-size:14px;color:#c9b6e6">${group.title}</h2>
    <div data-grid style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px"></div>`;
  sections.appendChild(sec);
  const grid = sec.querySelector("[data-grid]")!;
  for (const id of group.ids) {
  const found = lookup(id);
  if (!found) continue;
  const { slot, cat, color } = found;
  const cell = document.createElement("div");
  cell.style.cssText = "background:#241539;border:2px solid #3a2555;border-radius:14px;overflow:hidden;cursor:pointer";
  const src = `/${slot.file}?v=${Date.now()}`;
  cell.innerHTML = `
    <div style="position:relative;aspect-ratio:9/20;background:#1b0f2e;display:flex;align-items:center;justify-content:center">
      <img src="${src}" style="width:100%;height:100%;object-fit:contain" />
      <span style="position:absolute;display:none;color:#5f4a80;font-size:12px">미업로드 — 클릭해서 추가</span>
      <span style="position:absolute;top:8px;left:8px;background:${color};color:#fff;font-size:10px;font-weight:800;padding:2px 8px;border-radius:8px">${cat}</span>
      <span data-dim style="position:absolute;bottom:8px;right:8px;background:#000a;color:#cbb8e8;font-size:10px;padding:2px 6px;border-radius:6px"></span>
      <span data-del title="업로드 배경 삭제" style="position:absolute;bottom:8px;left:8px;background:#000a;color:#ff9db8;font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;cursor:pointer">🗑 삭제</span>
      ${cat === "스토리" || slot.id === "loading" ? `<label data-dimtoggle title="${slot.id === "loading" ? "로딩 화면 어둡게 오버레이 (남색 15%) — 기본은 원본 밝기" : "게임 내 디밍 — 블러 2×3 + 노출 −1 (기본은 원본 그대로)"}"
        style="position:absolute;top:8px;right:8px;display:flex;align-items:center;gap:5px;background:#000c;color:#ffd9ea;font-size:10.5px;font-weight:800;padding:4px 9px;border-radius:9px;cursor:pointer">
        <input type="checkbox" ${slot.dim ? "checked" : ""} style="accent-color:#ff7fb0;margin:0" /> 🌒 디밍</label>` : ""}
    </div>
    <div style="padding:10px 12px">
      <div style="font-weight:800;font-size:13px">${slot.label}</div>
      <div style="font-size:10.5px;color:#8a76a8;margin-top:3px">${trigger(slot)} · ${slot.file.split("/").pop()}</div>
      ${slot.vid ? `<div style="font-size:10px;color:#8fd8ff;margin-top:3px">🎬 mp4 업로드 = 무한 루프 재생 (용량 제한 없음)</div>`
        : slot.seq ? `<div style="font-size:10px;color:#ffb2d1;margin-top:3px">🎞 여러 장 선택 = 시퀀스 · 썸네일에서 실시간 재생</div>` : ""}
    </div>`;
  const img = cell.querySelector("img") as HTMLImageElement;
  const empty = cell.querySelector("span") as HTMLElement;
  const dim = cell.querySelector("[data-dim]") as HTMLElement;
  img.onload = () => {
    img.style.display = "";
    empty.style.display = "none";
    dim.textContent = `${img.naturalWidth}×${img.naturalHeight}`;
  };
  img.dataset["retries"] = "1"; // 초기 로드는 1회만 재시도 (미업로드 슬롯 과요청 방지) — 업로드 성공 시 6회로 재충전
  img.onerror = () => {
    const left = Number(img.dataset["retries"] ?? "0");
    if (left > 0) { // 리로드 경합·쓰기 지연 대비 폴링
      img.dataset["retries"] = String(left - 1);
      setTimeout(() => { img.src = `${img.dataset["src"] ?? `/${slot.file}`}?v=${Date.now()}`; }, 700);
      return;
    }
    img.style.display = "none";
    empty.style.display = "block";
  };
  const input = document.createElement("input");
  input.type = "file";
  input.accept = slot.vid ? "image/png,image/jpeg,image/webp,video/mp4" : "image/png,image/jpeg,image/webp";
  input.multiple = !!slot.seq; // 시퀀스 슬롯 = 여러 장 선택 가능
  input.style.display = "none";
  input.onchange = () => {
    const fl = input.files ? [...input.files] : [];
    if (fl.length === 0) return;
    if (slot.seq && fl.length > 1) void uploadSeq(slot, fl, cell);
    else if (fl[0]) void upload(slot, fl[0], cell);
  };
  cell.appendChild(input);
  cell.onclick = () => input.click();
  cell.ondragover = (e) => { e.preventDefault(); cell.style.borderColor = "#ff7fb0"; };
  cell.ondragleave = () => { cell.style.borderColor = "#3a2555"; };
  cell.ondrop = (e) => {
    e.preventDefault();
    cell.style.borderColor = "#3a2555";
    const fl = e.dataTransfer?.files ? [...e.dataTransfer.files] : [];
    if (fl.length === 0) return;
    if (slot.seq && fl.length > 1) void uploadSeq(slot, fl, cell);
    else if (fl[0]) void upload(slot, fl[0], cell);
  };
  // 디밍 토글 (스토리 슬롯) — 체크 즉시 매니페스트 저장, 게임은 새로고침 시 반영. 미리보기에도 근사 적용
  const dimToggle = cell.querySelector("[data-dimtoggle] input") as HTMLInputElement | null;
  const applyDimPreview = (): void => {
    // 로딩 슬롯은 오버레이 15% 근사(살짝 어둡게), 스토리는 블러+노출 디밍 근사 — mp4 프리뷰(video)에도 적용
    const f = slot.dim ? (slot.id === "loading" ? "brightness(0.85)" : "blur(2px) brightness(0.5)") : "";
    img.style.filter = f;
    const vid = cell.querySelector("video");
    if (vid) vid.style.filter = f;
  };
  if (dimToggle) {
    applyDimPreview();
    dimToggle.parentElement!.onclick = (e) => e.stopPropagation(); // 카드 클릭(업로드) 미트리거
    dimToggle.onchange = () => {
      slot.dim = dimToggle.checked;
      if (!slot.dim) delete slot.dim;
      applyDimPreview();
      void fetch("/__backgrounds", { method: "POST", body: JSON.stringify(bgManifest) })
        .then((r) => { if (!r.ok) alert("디밍 설정 저장 실패"); });
    };
  }
  // 삭제 — 시퀀스 프레임(__bgseq) 정리 후 단일 파일·매니페스트(__bgupload) 해제, 게임은 즉시 반영
  const delBtn = cell.querySelector("[data-del]") as HTMLElement;
  delBtn.onclick = async (e) => {
    e.stopPropagation(); // 셀 클릭(업로드) 미트리거
    if (!confirm(`'${slot.label}' 배경을 삭제할까요?\n빈 슬롯은 게임에서 배경 없이 표시됩니다.`)) return;
    if (slot.seq && slot.frames && slot.frames.length > 0) {
      const r0 = await fetch(`/__bgseq?slot=${slot.id}`, { method: "DELETE" });
      if (!r0.ok) { alert(`삭제 실패: ${await r0.text()}`); return; }
    }
    const r = await fetch(`/__bgupload?slot=${slot.id}`, { method: "DELETE" });
    if (!r.ok) { alert(`삭제 실패: ${await r.text()}`); return; }
    delete slot.frames;
    slot.file = "";
    window.clearInterval(Number(img.dataset["timer"] ?? 0));
    cell.querySelector("video")?.remove();
    img.style.display = "none";
    img.style.filter = "";
    empty.style.display = "block";
    dim.textContent = "";
  };
  // 시퀀스 프레임 보유 슬롯: 셀 썸네일에서 실시간 순환 재생 + 프레임 수 표기
  if (slot.frames && slot.frames.length > 0) {
    img.style.display = "";
    empty.style.display = "none";
    dim.textContent = `▶ 🎞 ${slot.frames.length}프레임`;
    img.onload = () => { /* 순환 중 dim 덮어쓰기 방지 */ };
    animatePreview(img, slot.frames, slot.frameMs);
  } else if (slot.file.endsWith(".mp4")) { // 업로드된 비디오 = 무한 루프 프리뷰
    dim.textContent = "🎬 mp4";
    showVideo(cell, `/${slot.file}?v=${Date.now()}`);
  }
  grid.appendChild(cell);
  }
}
