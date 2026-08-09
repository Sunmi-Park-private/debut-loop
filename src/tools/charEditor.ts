// tools/charEditor.ts — 캐릭터 스킨 그리드 에디터 (dev 전용, char.html).
// 캐릭터당 2행: ①전신 3종+반신 ②표정 5종 × (org 단일 / idle 시퀀스) = 10칸.
// 업로드 → /__charupload(단일) · /__charseq(시퀀스) → 게임 반영(반신=카드 초상·튜토리얼, 연습복=연습 스탠딩).
import { charSkinChars, refreshCharSkins, type CharSkinSlot } from "../ui/charSkins";
import { openSeqPreview } from "./seqPreview";

const EXTS = ["png", "jpg", "webp"];
const LIVE: Record<string, string> = { // 현재 게임에 바로 반영되는 슬롯
  daily: "🎮 로비 센터 전신",
  "daily-idle": "🎮 로비 센터 전신 애니 (업로드 시 단일 대신 재생)",
  practice: "🎮 연습 화면 스탠딩",
  stage: "🎮 안무 연습 거울 포즈",
  "stage-idle": "🎮 안무 연습 거울 포즈 애니 (업로드 시 단일 대신 재생)",
  "practice-idle": "🎮 연습 화면 스탠딩 애니 (업로드 시 단일 대신 재생)",
  bust: "🎮 카드 초상 · 튜토리얼 얼굴",
  "exp-base-idle": "🎮 스토리 카드 숨쉬기 idle",
};
// 게임 배치 배율 조절이 가능한 슬롯 (하루 전용) — 전신 의상·로비 센터·반신
// stage는 아직 게임 미소비(보관) — 값은 저장되고 게임이 쓰기 시작하면 scaleOf(kind)로 적용됨
const SCALABLE = new Set(["daily", "practice", "stage", "bust", "exp-base-idle", "tilt-left-idle", "tilt-right-idle"]);
const CHECKER =
  "background-image:linear-gradient(45deg,#2c1b45 25%,transparent 25%),linear-gradient(-45deg,#2c1b45 25%,transparent 25%)," +
  "linear-gradient(45deg,transparent 75%,#2c1b45 75%),linear-gradient(-45deg,transparent 75%,#2c1b45 75%);" +
  "background-size:18px 18px;background-position:0 0,0 9px,9px -9px,-9px 0;background-color:#241539";

const root = document.getElementById("char-editor")!;
root.innerHTML = `
  <div style="font:14px -apple-system,sans-serif;color:#e8def4;padding:22px 26px">
    <a href="editor.html" style="display:inline-block;font-size:12px;color:#c9b6e6;text-decoration:none;background:#241539;border:1.5px solid #3a2555;padding:5px 12px;border-radius:10px;margin-bottom:12px">← 에디터 허브</a>
    <h1 style="margin:0 0 4px;font-size:19px">👤 캐릭터 에디터</h1>
    <p style="margin:0 0 18px;font-size:12px;color:#a08cc0">썸네일 클릭 = 크게 보기 · <b style="color:#8fd8ff">⬆ 업로드 버튼/드롭 = 업로드</b> (png/jpg/webp · 10MB, 투명 PNG 권장) · 🎮 표시 = 게임 즉시 반영 · <b style="color:#ffb2d1">idle 칸은 여러 장 선택 = 시퀀스</b>(파일명 순 재생)</p>
    <div id="sections"></div>
  </div>`;
const sections = document.getElementById("sections")!;

/** 미리보기 프레임 순환 (idle 시퀀스) — 게임과 동일 속도(로비 idle 8fps)로 리얼타임 재생.
 *  img.src 교체는 매 프레임 dev 서버 재검증 왕복이 생겨 실효 fps가 떨어짐 →
 *  프레임을 전부 디코드한 뒤 캔버스에 시간 기반(rAF)으로 그려 정확히 8fps 보장. */
const GAME_IDLE_MS = 1000 / 8; // boot.ts 로비 AnimatedSprite 8fps와 동기
const animatePreview = (img: HTMLImageElement, urls: string[]): void => {
  img.parentElement?.querySelector("canvas")?.remove();
  if (urls.length === 0) return;
  img.src = `/${urls[0]}?v=${Date.now()}`;
  if (urls.length < 2) return;
  const frames = urls.map((u) => { const im = new Image(); im.src = `/${u}`; return im; });
  void Promise.all(frames.map((im) => im.decode().catch(() => {}))).then(() => {
    if (!img.isConnected) return;
    const first = frames[0]!;
    // 표시 크기로 1회 축소 캐시 — 93×1024px급 원본을 매 프레임 그리면 메모리·디코드 부하로 버벅임
    const MAX_W = 360; // 셀 표시폭(~170px)의 2배 (레티나 대비)
    const sc = Math.min(1, MAX_W / Math.max(1, first.naturalWidth));
    const small = frames.map((im) => {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(im.naturalWidth * sc));
      c.height = Math.max(1, Math.round(im.naturalHeight * sc));
      c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height);
      return c;
    });
    const cv = document.createElement("canvas");
    cv.width = small[0]!.width;
    cv.height = small[0]!.height;
    cv.style.cssText = "position:absolute;inset:0;margin:auto;max-width:92%;max-height:92%";
    img.style.visibility = "hidden"; // 셀 크기 유지용으로 남김
    img.parentElement!.append(cv);
    const ctx = cv.getContext("2d")!;
    let t0 = -1; // 첫 rAF timestamp 기준 — performance.now()로 잡으면 rAF 시각이 더 이를 수 있어 음수 인덱스
    let last = -1;
    const draw = (now: number): void => {
      if (!cv.isConnected) return;
      if (t0 < 0) t0 = now;
      const idx = Math.floor((now - t0) / GAME_IDLE_MS) % small.length;
      if (idx !== last) { // 같은 프레임은 다시 그리지 않음
        last = idx;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(small[idx]!, 0, 0);
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  });
};

/** 전신 슬롯 프리뷰의 투명 여백 트리밍 — 일상복처럼 캔버스 여백이 큰 원본도 연습복·무대의상과 같은 크기감으로 표시 */
const trimTransparent = (img: HTMLImageElement): void => {
  img.addEventListener("load", () => {
    if (img.src.startsWith("data:")) return; // 트리밍 결과 재진입 방지
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return;
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    const step = 2; // 2px 샘플링 — 정밀도 충분, 대형 원본에서도 가벼움
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step)
        if (d[(y * w + x) * 4 + 3]! > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 <= x0 || y1 <= y0) return; // 전부 투명(jpg 등 알파 없음 = 전체 불투명이라 여기 안 옴)
    const cw = x1 - x0 + step;
    const ch = y1 - y0 + step;
    if (cw * ch > w * h * 0.85) return; // 여백이 미미하면 원본 그대로
    const out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    out.getContext("2d")!.drawImage(cv, x0, y0, cw, ch, 0, 0, cw, ch);
    img.src = out.toDataURL();
  });
};

const validate = (f: File): string | null => {
  const raw = f.name.split(".").pop()?.toLowerCase() ?? "";
  const ext = raw === "jpeg" ? "jpg" : raw;
  if (!EXTS.includes(ext)) { alert(`${f.name}: png/jpg/webp만 가능합니다`); return null; }
  if (f.size > 10 * 1024 * 1024) { alert(`${f.name}: 10MB 이하만 가능합니다`); return null; }
  return ext;
};

const showUploaded = (cell: HTMLElement, srcBase: string): HTMLImageElement => {
  const img = cell.querySelector("img") as HTMLImageElement;
  const empty = cell.querySelector("span[data-empty]") as HTMLElement;
  img.style.display = "";
  empty.style.display = "none";
  img.dataset["src"] = srcBase;
  img.dataset["retries"] = "6";
  return img;
};

/** 알파 영상 프리뷰 — 기존 이미지·시퀀스 캔버스 대신 <video> 무한 루프 */
const showVideo = (cell: HTMLElement, src: string): void => {
  const img = cell.querySelector("img") as HTMLImageElement;
  const empty = cell.querySelector("span[data-empty]") as HTMLElement;
  img.style.display = "none";
  empty.style.display = "none";
  img.parentElement?.querySelector("canvas")?.remove();
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

// mov(알파)·mp4(불투명) 모두 서버가 webm으로 변환한다
const VID_EXTS = ["mov", "mp4", "webm"];

const upload = async (slot: CharSkinSlot, file: File, cell: HTMLElement): Promise<void> => {
  const raw = (file.name.split(".").pop()?.toLowerCase() ?? "").replace("jpeg", "jpg");
  const isVid = VID_EXTS.includes(raw);
  if (isVid && !slot.vid) { alert("이 슬롯은 이미지 전용입니다"); return; }
  const ext = isVid ? raw : validate(file); // 영상은 용량 제한 없음 (mov·mp4는 서버가 webm으로 변환)
  if (!ext) return;
  cell.style.opacity = "0.5";
  const r = await fetch(`/__charupload?slot=${slot.id}&ext=${ext}`, { method: "POST", body: file });
  cell.style.opacity = "1";
  if (!r.ok) { alert(`업로드 실패: ${await r.text()}`); return; }
  // 서버가 최종 경로를 돌려준다 — mov·mp4→webm, png/jpg→webp로 확장자가 바뀐다
  slot.file = (await r.text()).trim() || `assets/char/skin/${slot.id}.${ext}`;
  if (isVid) {
    delete slot.frames; // 영상 = 시퀀스 대체 (서버도 동일 정리)
    const badge = cell.querySelector("[data-badge]") as HTMLElement | null;
    if (badge) badge.textContent = "🎬";
    showVideo(cell, `/${slot.file}?v=${Date.now()}`);
    return;
  }
  cell.querySelector("video")?.remove();
  const img = showUploaded(cell, `/${slot.file}`);
  img.src = `${img.dataset["src"]}?v=${Date.now()}`;
};

const uploadSeq = async (slot: CharSkinSlot, files: File[], cell: HTMLElement): Promise<void> => {
  const list = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const f of list) if (!validate(f)) return;
  // 폴더째 잘못 선택하는 사고 방지 (로딩 97프레임·idle 93프레임 사건) — 장수를 보여주고 확인
  if (!window.confirm(`${list.length}장을 '${slot.label}' 시퀀스로 업로드합니다.\n(기존 시퀀스는 대체됩니다) 계속할까요?`)) return;
  cell.style.opacity = "0.5";
  let frames: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i]!;
    const ext = validate(f)!;
    const r = await fetch(`/__charseq?slot=${slot.id}&ext=${ext}&i=${i}&total=${list.length}`, { method: "POST", body: f });
    if (!r.ok) { alert(`업로드 실패(${f.name}): ${await r.text()}`); cell.style.opacity = "1"; return; }
    frames = (await r.json()) as string[];
  }
  cell.style.opacity = "1";
  slot.frames = frames;
  const img = showUploaded(cell, `/${frames[0] ?? slot.file}`);
  img.onload = () => {};
  (cell.querySelector("[data-badge]") as HTMLElement).textContent = `▶ 🎞 ${frames.length}`;
  animatePreview(img, frames);
};

/** 배율 스테퍼 (1.0~2.0 · 0.2 단위) — /__charscale 저장 + 전 기기 즉시 반영 */
const scaleBar = (slot: CharSkinSlot): HTMLElement => {
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:6px";
  const cap = document.createElement("span");
  cap.textContent = "배율";
  cap.style.cssText = "font-size:9.5px;color:#8a76a8";
  const lbl = document.createElement("span");
  lbl.style.cssText = "font-size:11px;color:#ffd98a;font-weight:800;min-width:32px;text-align:center";
  const render = (): void => { lbl.textContent = `${(slot.scale ?? 1).toFixed(1)}×`; };
  render();
  const mkBtn = (t: string, d: number): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = t;
    b.style.cssText = "width:24px;height:22px;border:1px solid #3a2555;border-radius:6px;background:#180d2b;color:#e8def4;cursor:pointer;font-weight:800";
    b.onclick = async (e) => {
      e.stopPropagation(); // 셀 클릭(파일 선택) 방지
      const next = Math.round(Math.min(2, Math.max(1, (slot.scale ?? 1) + d)) * 10) / 10;
      if (next === (slot.scale ?? 1)) return;
      const r = await fetch("/__charscale", { method: "POST", body: JSON.stringify({ slot: slot.id, scale: next }) });
      if (!r.ok) { alert(`배율 저장 실패: ${await r.text()}`); return; }
      slot.scale = next;
      render();
    };
    return b;
  };
  bar.append(cap, mkBtn("−", -0.2), lbl, mkBtn("＋", 0.2));
  return bar;
};

/** 단일 이미지·알파 영상 크게 보기 — 체커보드 배경으로 투명 영역 확인 가능, 클릭으로 닫기 */
const openLightbox = (title: string, src: { img?: string; video?: string }): void => {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;background:#000d;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;cursor:zoom-out";
  const media = src.video
    ? `<video src="${src.video}" autoplay loop muted playsinline style="max-width:92vw;max-height:86vh;${CHECKER}"></video>`
    : `<img src="${src.img}" style="max-width:92vw;max-height:86vh;object-fit:contain;${CHECKER}" />`;
  ov.innerHTML = `${media}<div style="color:#c9b6e6;font:12px -apple-system,sans-serif">${title} — 클릭하여 닫기</div>`;
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
};

const makeCell = (slot: CharSkinSlot, small: boolean, scalable = false): HTMLElement => {
  const cell = document.createElement("div");
  cell.style.cssText = "background:#241539;border:2px solid #3a2555;border-radius:12px;overflow:hidden;cursor:pointer";
  const ratio = slot.shape === "full" ? "3/5" : "1/1";
  const live = LIVE[slot.kind];
  cell.innerHTML = `
    <div style="position:relative;aspect-ratio:${ratio};${CHECKER};display:flex;align-items:center;justify-content:center">
      <img src="/${slot.file}?v=${Date.now()}" style="max-width:92%;max-height:92%;object-fit:contain" />
      <span data-empty style="position:absolute;display:none;color:#5f4a80;font-size:${small ? 9.5 : 11}px;text-align:center">미업로드${slot.seq ? "<br/>여러 장=시퀀스" : ""}${slot.vid ? "<br/>mov/webm=알파 영상" : ""}</span>
      <span data-upload title="파일 업로드${slot.seq ? " (여러 장 선택=시퀀스)" : ""}" style="position:absolute;top:5px;left:6px;background:#000c;color:#8fd8ff;padding:2px 7px;border-radius:7px;cursor:pointer;font-size:10px;font-weight:800">⬆ 업로드</span>
      <span data-badge title="시퀀스 미리보기" style="position:absolute;top:5px;right:6px;color:#ffd98a;font-size:10px;font-weight:800;${slot.seq ? "background:#000c;padding:2px 7px;border-radius:7px;cursor:pointer" : ""}">${slot.seq && slot.frames?.length ? `▶ 🎞 ${slot.frames.length}` : slot.seq ? "🎞" : ""}</span>
      <span data-del title="업로드 삭제" style="position:absolute;bottom:5px;left:6px;background:#000c;color:#ff9db8;padding:2px 7px;border-radius:7px;cursor:pointer;font-size:10px;font-weight:800">🗑</span>
    </div>
    <div style="padding:${small ? 6 : 8}px ${small ? 8 : 10}px">
      <div style="font-weight:800;font-size:${small ? 10.5 : 12}px">${slot.label}</div>
      <div style="font-size:${small ? 9 : 10}px;color:${live ? "#8fe3b0" : "#8a76a8"};margin-top:2px">${live ?? (slot.seq ? "보관 · 시퀀스" : "보관 · 단일")}</div>
      ${slot.vid ? `<div style="font-size:10px;color:#8fd8ff;margin-top:3px">🎬 알파 mov/webm 업로드 = 시퀀스 대체 (mov는 자동 변환, 수십 초 소요)</div>` : ""}
    </div>`;
  const img = cell.querySelector("img") as HTMLImageElement;
  const empty = cell.querySelector("span[data-empty]") as HTMLElement;
  if (slot.shape === "full" && !(slot.frames && slot.frames.length > 0)) trimTransparent(img); // 전신 단일 이미지는 투명 여백 잘라 표시 (시퀀스는 캔버스 재생)
  img.dataset["retries"] = "1";
  img.onerror = () => {
    const left = Number(img.dataset["retries"] ?? "0");
    if (left > 0) {
      img.dataset["retries"] = String(left - 1);
      setTimeout(() => { img.src = `${img.dataset["src"] ?? `/${slot.file}`}?v=${Date.now()}`; }, 700);
      return;
    }
    img.style.display = "none";
    empty.style.display = "block";
  };
  const input = document.createElement("input");
  input.type = "file";
  input.accept = `image/png,image/jpeg,image/webp${slot.vid ? ",video/quicktime,video/webm,video/mp4,.mov,.mp4,.webm" : ""}`;
  input.multiple = !!slot.seq;
  input.style.display = "none";
  const handle = (fl: File[]): void => {
    if (fl.length === 0) return;
    const first = fl[0];
    if (slot.vid && fl.length === 1 && first && /\.(mov|webm)$/i.test(first.name)) void upload(slot, first, cell); // 알파 영상 단일
    else if (slot.seq) void uploadSeq(slot, fl, cell);
    else if (first) void upload(slot, first, cell);
  };
  input.onchange = () => handle(input.files ? [...input.files] : []);
  cell.appendChild(input);
  // 업로드는 ⬆ 버튼 전용 — 썸네일 클릭은 크게 보기 (미업로드 셀만 클릭=업로드)
  const uploadBtn = cell.querySelector("[data-upload]") as HTMLElement;
  uploadBtn.onclick = (e) => { e.stopPropagation(); input.click(); };
  // 삭제 — 시퀀스 프레임(__charseq) 정리 후 단일 파일·매니페스트(__charupload) 해제, 게임은 즉시 반영
  const delBtn = cell.querySelector("[data-del]") as HTMLElement;
  delBtn.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`'${slot.label}' 업로드를 삭제할까요?\n빈 슬롯은 게임에서 표시되지 않습니다.`)) return;
    if (slot.seq && slot.frames && slot.frames.length > 0) {
      const r0 = await fetch(`/__charseq?slot=${slot.id}`, { method: "DELETE" });
      if (!r0.ok) { alert(`삭제 실패: ${await r0.text()}`); return; }
    }
    const r = await fetch(`/__charupload?slot=${slot.id}`, { method: "DELETE" });
    if (!r.ok) { alert(`삭제 실패: ${await r.text()}`); return; }
    delete slot.frames;
    slot.file = "";
    cell.querySelector("video")?.remove();
    img.parentElement?.querySelector("canvas")?.remove(); // 시퀀스 캔버스 프리뷰 정리
    img.style.display = "none";
    img.style.visibility = ""; // animatePreview가 숨겨둔 상태 복원
    empty.style.display = "block";
    (cell.querySelector("[data-badge]") as HTMLElement).textContent = slot.seq ? "🎞" : "";
  };
  cell.onclick = () => {
    if (slot.seq && slot.frames?.length) { openSeqPreview(slot.label, slot.frames); return; } // 시퀀스 = 플레이어
    const vid = cell.querySelector("video") as HTMLVideoElement | null;
    if (vid) { openLightbox(slot.label, { video: `/${slot.file}?v=${Date.now()}` }); return; } // 알파 영상
    const has = img.style.display !== "none" && empty.style.display !== "block" && img.complete && img.naturalWidth > 0;
    if (has) openLightbox(slot.label, { img: `/${slot.file}?v=${Date.now()}` }); // 단일 이미지 = 원본 크게
    else input.click(); // 빈 슬롯은 기존처럼 바로 업로드
  };
  cell.ondragover = (e) => { e.preventDefault(); cell.style.borderColor = "#ff7fb0"; };
  cell.ondragleave = () => { cell.style.borderColor = "#3a2555"; };
  cell.ondrop = (e) => {
    e.preventDefault();
    cell.style.borderColor = "#3a2555";
    handle(e.dataTransfer?.files ? [...e.dataTransfer.files] : []);
  };
  if (slot.seq) { // 🎞 배지 = 라이트박스 플레이어 (재생·스크럽·속도)
    const badge = cell.querySelector("[data-badge]") as HTMLElement;
    badge.onclick = (e) => {
      e.stopPropagation();
      if (slot.frames?.length) openSeqPreview(slot.label, slot.frames);
    };
  }
  if (slot.seq && slot.frames && slot.frames.length > 0) {
    showUploaded(cell, `/${slot.frames[0]}`);
    img.onload = () => {};
    animatePreview(img, slot.frames);
  } else if (slot.file.endsWith(".webm")) { // 업로드된 알파 영상 = 루프 프리뷰
    const badge = cell.querySelector("[data-badge]") as HTMLElement | null;
    if (badge) badge.textContent = "🎬";
    showVideo(cell, `/${slot.file}?v=${Date.now()}`);
  }
  if (scalable) (cell.children[1] as HTMLElement).appendChild(scaleBar(slot)); // 푸터에 배율 컨트롤
  return cell;
};

// 디스크의 최신 슬롯 목록으로 맞춘 뒤 그린다 — charskins.json은 dev 서버 감시에서 빠져 있어
// Vite가 옛 모듈을 물고 있는 구간이 생긴다(새로 추가한 슬롯이 안 보이던 원인).
await refreshCharSkins();

charSkinChars.forEach((ch, idx) => {
  const sec = document.createElement("div");
  sec.innerHTML = `
    ${idx > 0 ? `<hr style="border:none;border-top:2px solid #3a2757;margin:34px 0 0" />` : ""}
    <div style="display:flex;align-items:center;gap:10px;margin:26px 0 12px">
      <span style="width:16px;height:16px;border-radius:50%;background:${ch.color};display:inline-block"></span>
      <h2 style="margin:0;font-size:16px">${ch.name}${ch.temp ? " (가칭)" : ""} <span style="color:#8a76a8;font-size:11px;font-weight:400">${ch.id}</span></h2>
    </div>
    <div data-row1 style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-bottom:12px"></div>
    <div data-row2 style="display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px"></div>
    <div data-vidcap style="display:none;margin:18px 0 8px;font-size:12px;font-weight:800;color:#8fe3f0">
      🎬 연습하기 주차 영상 <span style="font-weight:600;color:#5f8f99;font-size:10.5px">— 연습 메뉴 진입 시 주차에 따라 1→2→3→4→5 순환</span></div>
    <div data-row3 style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px"></div>`;
  sections.appendChild(sec);
  const row1 = sec.querySelector("[data-row1]") as HTMLElement;
  const row2 = sec.querySelector("[data-row2]") as HTMLElement;
  const row3 = sec.querySelector("[data-row3]") as HTMLElement;
  const vidCap = sec.querySelector("[data-vidcap]") as HTMLElement;
  for (const slot of ch.slots) {
    const isVid = slot.kind.startsWith("practice-vid-"); // 주차 영상 — 마지막 줄에 모아 둔다
    const isExp = !isVid && (slot.kind.startsWith("exp-") || slot.kind.startsWith("tilt-"));
    const scalable = ch.id === "haru" && (SCALABLE.has(slot.kind) || isVid); // 배율은 하루(메인)만
    if (isVid) vidCap.style.display = "block";
    (isVid ? row3 : isExp ? row2 : row1).appendChild(makeCell(slot, false, scalable));
  }
});
