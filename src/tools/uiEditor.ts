// tools/uiEditor.ts — UI 스킨 에디터 (dev 전용, ui.html). 화면별 섹션 + 슬롯 카드, 업로드 → /__skinupload.
import { uiSkinScreens, type UiSkinSlot } from "../ui/uiSkin";

const root = document.getElementById("ui-editor")!;
root.innerHTML = `
  <div style="font:14px -apple-system,sans-serif;color:#e8def4;padding:22px 28px;max-width:1560px;margin:0 auto">
    <a href="editor.html" style="display:inline-block;font-size:12px;color:#c9b6e6;text-decoration:none;background:#241539;border:1.5px solid #3a2555;padding:5px 12px;border-radius:10px;margin-bottom:12px">← 에디터 허브</a>
    <h1 style="margin:0 0 4px;font-size:19px">🎛 UI 스킨 에디터</h1>
    <p style="margin:0 0 8px;font-size:12px;color:#a08cc0">카드 클릭/드롭 = 업로드 (png/jpg/webp · 10MB) · 즉시 게임 반영 · <b style="color:#ffd98a">"원본 크기" 표시 슬롯 = 1배율이 업로드 픽셀 그대로(리샘플 없음)</b> · 크기·농도는 각 슬롯 드롭다운으로 조절 · <b style="color:#8fd8ff">🎬 표시 슬롯은 mov/webm 영상 업로드 가능 (mov는 자동 변환, 수십 초 소요)</b></p>
    <div id="sections"></div>
  </div>`;
const sections = document.getElementById("sections")!;

const VID_EXTS = ["mov", "webm", "mp4"];

/** 영상 프리뷰 — 이미지 대신 <video> 무한 루프 (vid 슬롯 전용) */
const showVideo = (cell: HTMLElement, src: string): void => {
  const img = cell.querySelector("img") as HTMLImageElement;
  const empty = cell.querySelector("span") as HTMLElement;
  img.style.display = "none";
  empty.style.display = "none";
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

const upload = async (slot: UiSkinSlot, file: File, cell: HTMLElement): Promise<void> => {
  const raw = file.name.split(".").pop()?.toLowerCase() ?? "";
  const ext = raw === "jpeg" ? "jpg" : raw;
  const isVid = VID_EXTS.includes(ext);
  if (isVid && !slot.vid) { alert("이 슬롯은 이미지 전용입니다"); return; }
  if (!isVid && !["png", "jpg", "webp"].includes(ext)) { alert(slot.vid ? "png/jpg/webp 또는 mov/webm만 가능합니다" : "png/jpg/webp만 가능합니다"); return; }
  if (!isVid && file.size > 10 * 1024 * 1024) { alert("10MB 이하만 가능합니다"); return; }
  cell.style.opacity = "0.5";
  const r = await fetch(`/__skinupload?slot=${slot.id}&ext=${ext}`, { method: "POST", body: file }); // mov→webm, png/jpg→webp 변환은 서버가 한다 (mov는 수십 초 소요)
  if (!r.ok) { alert(`업로드 실패: ${await r.text()}`); cell.style.opacity = "1"; return; }
  // 서버가 최종 경로를 돌려준다 — 후처리로 확장자가 바뀌므로 클라이언트가 추측하면 어긋난다
  slot.file = (await r.text()).trim() || `assets/ui/${slot.id}.${ext}`;
  // 리로드 대신 제자리 갱신 — 업로드 직후 vite 리로드와 겹치면 이미지 요청이 중단돼 '미업로드' 오탐
  cell.style.opacity = "1";
  if (isVid) {
    showVideo(cell, `/${slot.file}?v=${Date.now()}`);
    return;
  }
  cell.querySelector("video")?.remove();
  const img = cell.querySelector("img") as HTMLImageElement;
  const empty = cell.querySelector("span") as HTMLElement;
  img.style.display = "";
  empty.style.display = "none";
  img.dataset["src"] = `/${slot.file}`; // 확장자 변경 대응 + 재시도 URL
  img.dataset["retries"] = "6"; // 업로드 성공 = 파일 존재 보장 → 폴링으로 반드시 표시
  img.src = `${img.dataset["src"]}?v=${Date.now()}`;
};

// 투명 PNG 확인용 체커보드
const CHECKER =
  "background-image:linear-gradient(45deg,#2c1b45 25%,transparent 25%),linear-gradient(-45deg,#2c1b45 25%,transparent 25%)," +
  "linear-gradient(45deg,transparent 75%,#2c1b45 75%),linear-gradient(-45deg,transparent 75%,#2c1b45 75%);" +
  "background-size:18px 18px;background-position:0 0,0 9px,9px -9px,-9px 0;background-color:#241539";

// 원본 크기 규칙(1배율=업로드 픽셀)은 slot.natural 슬롯(신규 제작분)만 — 기존 슬롯은 표시 박스 기준. 배율·농도는 전 슬롯 공통 제공.

/** 농도 드롭다운 — /__uiopacity 저장 + 전 기기 즉시 반영. 0%=원본, −=진하게(어둡게), +=연하게(투명) */
const opacitySelect = (slot: UiSkinSlot): HTMLElement => {
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;align-items:center;gap:7px;margin-top:6px";
  const cap = document.createElement("span");
  cap.textContent = "농도";
  cap.style.cssText = "font-size:10.5px;color:#8a76a8";
  const sel = document.createElement("select");
  sel.style.cssText = "background:#180d2b;color:#e8def4;border:1px solid #3a2555;border-radius:6px;padding:2px 6px;font-size:11px;cursor:pointer";
  for (let v = -5; v <= 5; v++) {
    const o = document.createElement("option");
    o.value = String(v / 10);
    o.textContent = v === 0 ? "0% (기본)" : v < 0 ? `−${-v * 10}% 진하게` : `+${v * 10}% 연하게`;
    sel.appendChild(o);
  }
  sel.value = String(slot.opacity ?? 0);
  sel.onclick = (e) => e.stopPropagation();
  sel.onchange = async (e) => {
    e.stopPropagation();
    const next = Number(sel.value);
    const r = await fetch("/__uiopacity", { method: "POST", body: JSON.stringify({ slot: slot.id, opacity: next }) });
    if (!r.ok) { alert(`농도 저장 실패: ${await r.text()}`); sel.value = String(slot.opacity ?? 0); return; }
    slot.opacity = next;
  };
  bar.append(cap, sel);
  return bar;
};
/** 배율 드롭다운 — /__uiscale 저장 + 전 기기 즉시 반영 */
const scaleSelect = (slot: UiSkinSlot): HTMLElement => {
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;align-items:center;gap:7px;margin-top:6px";
  const cap = document.createElement("span");
  cap.textContent = "배율";
  cap.style.cssText = "font-size:10.5px;color:#8a76a8";
  const sel = document.createElement("select");
  sel.style.cssText = "background:#180d2b;color:#e8def4;border:1px solid #3a2555;border-radius:6px;padding:2px 6px;font-size:11px;cursor:pointer";
  for (let v = 1; v <= 20; v += 1) { // 전 슬롯 공통 0.1~2.0 · 0.1 단위 (기존 대형 아트 대응)
    const o = document.createElement("option");
    o.value = String(v / 10);
    o.textContent = `${(v / 10).toFixed(1)}×`;
    sel.appendChild(o);
  }
  sel.value = String(slot.scale ?? 1);
  sel.onclick = (e) => e.stopPropagation(); // 셀 클릭(파일 선택) 방지
  sel.onchange = async (e) => {
    e.stopPropagation();
    const next = Number(sel.value);
    const r = await fetch("/__uiscale", { method: "POST", body: JSON.stringify({ slot: slot.id, scale: next }) });
    if (!r.ok) { alert(`배율 저장 실패: ${await r.text()}`); sel.value = String(slot.scale ?? 1); return; }
    slot.scale = next;
  };
  bar.append(cap, sel);
  return bar;
};

const mkCell = (slot: UiSkinSlot): HTMLElement => {
  const cell = document.createElement("div");
  cell.style.cssText = "background:#241539;border:2px solid #3a2555;border-radius:14px;overflow:hidden;cursor:pointer";
  const meta = (slot.natural ? "원본 크기 (1배율=업로드 픽셀 그대로)" : `${slot.size[0]}×${slot.size[1]} · ${slot.mode}${slot.mode === "9slice" ? ` (slice ${slot.slice})` : ""}`)
    + (slot.vid ? " · 🎬 mov/webm 영상 가능" : "");
  cell.innerHTML = `
    <div style="position:relative;height:170px;${CHECKER};display:flex;align-items:center;justify-content:center">
      <img src="/${slot.file}?v=${Date.now()}" style="max-width:88%;max-height:88%;object-fit:contain" />
      <span style="position:absolute;display:none;color:#5f4a80;font-size:12px">미업로드 — 클릭해서 추가</span>
      <span data-del title="업로드 이미지 삭제" style="position:absolute;top:6px;right:6px;background:#000c;color:#ff9db8;padding:2px 7px;border-radius:7px;cursor:pointer;font-size:10px;font-weight:800">🗑</span>
    </div>
    <div style="padding:10px 14px">
      <div style="font-weight:800;font-size:13.5px">${slot.label}</div>
      <div style="font-size:11px;color:#8a76a8;margin-top:3px">${meta} · ${slot.file.split("/").pop()}</div>
    </div>`;
  const img = cell.querySelector("img") as HTMLImageElement;
  const empty = cell.querySelector("span") as HTMLElement;
  const del = cell.querySelector("[data-del]") as HTMLElement;
  del.onclick = async (e) => {
    e.stopPropagation(); // 셀 클릭(업로드) 미트리거
    if (!confirm(`'${slot.label}' 업로드 이미지를 삭제할까요?\n빈 슬롯은 게임에서 표시되지 않습니다 (진행용 버튼은 기본형 유지).`)) return;
    const r = await fetch(`/__skinupload?slot=${slot.id}`, { method: "DELETE" });
    if (!r.ok) { alert(`삭제 실패: ${await r.text()}`); return; }
    cell.querySelector("video")?.remove();
    img.style.display = "none";
    empty.style.display = "block";
  };
  if (slot.vid && VID_EXTS.some((e) => slot.file.endsWith(`.${e}`))) showVideo(cell, `/${slot.file}?v=${Date.now()}`); // 기존 업로드가 영상이면 비디오 프리뷰
  img.dataset["retries"] = "1"; // 초기 로드는 1회만 재시도 — 업로드 성공 시 6회로 재충전
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
  img.onload = () => { img.style.display = ""; empty.style.display = "none"; };
  const input = document.createElement("input");
  input.type = "file";
  input.accept = `image/png,image/jpeg,image/webp${slot.vid ? ",video/quicktime,video/webm,video/mp4,.mov,.webm,.mp4" : ""}`;
  input.style.display = "none";
  input.onchange = () => { if (input.files?.[0]) void upload(slot, input.files[0], cell); };
  cell.appendChild(input);
  cell.onclick = () => input.click();
  cell.ondragover = (e) => { e.preventDefault(); cell.style.borderColor = "#ff7fb0"; };
  cell.ondragleave = () => { cell.style.borderColor = "#3a2555"; };
  cell.ondrop = (e) => {
    e.preventDefault();
    cell.style.borderColor = "#3a2555";
    const f = e.dataTransfer?.files?.[0];
    if (f) void upload(slot, f, cell);
  };
  // 모든 슬롯: 배율 + 농도 드롭다운 (크기·농도 조절은 오직 여기서 — 이미지 리샘플 없음)
  (cell.children[1] as HTMLElement).appendChild(scaleSelect(slot));
  (cell.children[1] as HTMLElement).appendChild(opacitySelect(slot));
  return cell;
};

for (const screen of uiSkinScreens) {
  const sec = document.createElement("div");
  sec.innerHTML = `<h2 style="margin:26px 0 10px;font-size:15px;border-bottom:2px solid #3a2555;padding-bottom:8px">📱 ${screen.label} <small style="color:#8a76a8;font-weight:400">· ${screen.slots.length}개 컴포넌트</small></h2>`;
  if (screen.id === "common") {
    // UI 공통: 한 줄 나열 — 프레임은 기본 폭(280px), 버튼 4종은 절반 폭(140px)
    const row = document.createElement("div");
    const cols = screen.slots.map((s) => (s.small ? "140px" : "280px")).join(" ");
    row.style.cssText = `display:grid;grid-template-columns:${cols};gap:10px`;
    for (const slot of screen.slots) row.appendChild(mkCell(slot));
    sec.appendChild(row);
    sections.appendChild(sec);
    continue;
  }
  if (screen.id === "gate" || screen.id === "training") {
    // 라벨 접두어("게임 · " · "보컬 연습 · ") 기준 그룹 — 그룹마다 구분선 + 새 줄에서 시작
    interface Grp { name: string; slots: typeof screen.slots }
    const groups: Grp[] = [];
    for (const s of screen.slots) {
      const name = (s.label.split(" · ")[0] ?? "").trim();
      const last = groups[groups.length - 1];
      if (last && last.name === name) last.slots.push(s);
      else groups.push({ name, slots: [s] });
    }
    for (const g of groups) {
      const cap = document.createElement("div");
      cap.textContent = `— ${g.name} —`;
      cap.style.cssText = "margin:16px 0 8px;font-size:12px;font-weight:800;color:#8a76a8";
      sec.appendChild(cap);
      const half = g.name !== "공통"; // 종목·게임별 그룹은 절반 폭 셀, 공통만 기본 폭
      const gg = document.createElement("div");
      gg.style.cssText = `display:grid;grid-template-columns:repeat(auto-fill,minmax(${half ? 140 : 280}px,1fr));gap:${half ? 10 : 16}px`;
      for (const slot of g.slots) gg.appendChild(mkCell(slot));
      sec.appendChild(gg);
    }
    sections.appendChild(sec);
    continue;
  }
  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px";
  for (const slot of screen.slots.filter((s) => !s.small)) grid.appendChild(mkCell(slot));
  sec.appendChild(grid);
  const smalls = screen.slots.filter((s) => s.small); // 심볼 등 소형 컴포넌트 — 작은 그리드로 별도 배치
  if (smalls.length > 0) {
    const sg = document.createElement("div");
    sg.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:12px";
    for (const slot of smalls) sg.appendChild(mkCell(slot));
    sec.appendChild(sg);
  }
  sections.appendChild(sec);
}
