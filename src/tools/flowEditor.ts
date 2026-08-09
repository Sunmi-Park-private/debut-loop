// tools/flowEditor.ts — 게임 플로우 다이어그램 + 에디터 (dev 전용, /flow.html)
// beats JSON을 주차·막 타임라인으로 시각화하고, 노드 편집 → 💾 저장(/__beats) → 실제 게임 반영.
// beats 외 최상위 키(_note·casting·line·config)는 그대로 보존한다.
import type { Beat, BeatRecall, GateDef, GaugeId, Effect, LoopCount } from "../engine/types";
import { recallOf, beatsOfLoop, recallIsInherited } from "../engine/recall";

const GAUGES: GaugeId[] = ["skill", "mental", "reputation", "bond", "capital"];
const GLBL: Record<string, string> = { skill: "실력", mental: "멘탈", reputation: "평판", bond: "유대", capital: "자본" };
const ACT_COLOR: Record<number, string> = { 0: "#8b7bb0", 1: "#6fb5d8", 2: "#7ec99a", 3: "#e8b45a", 4: "#e88a6a", 5: "#d86fa8" };
const ACT_NAME: Record<number, string> = { 0: "프롤로그", 1: "1막", 2: "2막", 3: "3막", 4: "4막", 5: "5막" };

interface BeatsDoc { beats: Beat[]; [k: string]: unknown }

let doc: BeatsDoc;
let beats: Beat[];
let gates: GateDef[] = [];
let sel = -1;
let dirty = false;
/** 편집 중인 회차 — 목록·패널이 이 값을 따라간다 (1회차=관찰, 2회차=회상+포착) */
let tab: LoopCount = 1;

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// ── 데이터 로드 ──
async function load(): Promise<void> {
  doc = await (await fetch("/src/data/beats/demo2_zeroc.json")).json() as BeatsDoc;
  beats = doc.beats;
  gates = await (await fetch("/src/data/gates.json")).json() as GateDef[];
}

// ── 저장 ──
function validate(): string | null {
  const ids = new Set<string>();
  for (const b of beats) {
    if (!b.id) return "id가 빈 비트가 있습니다";
    if (ids.has(b.id)) return `id 중복: ${b.id}`;
    ids.add(b.id);
    if (b.loop !== undefined && b.loop !== 1 && b.loop !== 2) return `${b.id}: loop는 1 또는 2`;
    if (!b.left?.label || !b.right?.label) return `${b.id}: 좌/우 라벨 필요`;
    if (b.recall !== undefined) {
      if (typeof b.recall !== "object" || Array.isArray(b.recall)) return `${b.id}: recall은 객체`;
      for (const k of ["textKey", "leftLabel", "rightLabel"] as const) {
        const v = b.recall[k];
        if (v !== undefined && typeof v !== "string") return `${b.id}: recall.${k}는 문자열`;
      }
    }
  }
  for (const g of gates) {
    if (g.trigger.beatId && !ids.has(g.trigger.beatId)) return `관문 ${g.id}의 트리거 비트(${g.trigger.beatId})가 없습니다 — id 변경/삭제 주의`;
  }
  return null;
}

// 타이핑 → 게임에 실시간 반영 (저장 아님). 문구만 보내고, 파일 기록은 💾가 담당한다.
let previewTimer = 0;
let previewPending: Record<string, unknown> = {};
function sendPreview(): void {
  const bt = beats[sel];
  if (!bt) return;
  // 대기 중인 다른 비트의 수정을 덮어쓰지 않고 모아 둔다 —
  // 0.3초 안에 다른 비트로 옮겨 타이핑하면 앞 비트의 반영이 통째로 사라지던 문제
  previewPending[bt.id] = {
    textKey: bt.textKey,
    left: { label: bt.left.label, hint: bt.left.hint },
    right: { label: bt.right.label, hint: bt.right.hint },
    recall: bt.recall,
  };
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    previewTimer = 0;
    const body = JSON.stringify(previewPending);
    previewPending = {};
    void fetch("/__beatspreview", { method: "POST", body }).catch(() => {});
  }, 300);
}

async function save(): Promise<void> {
  const err = validate();
  if (err) { toast(`⚠ ${err}`, true); return; }
  sessionStorage.setItem("flow.scroll", String(window.scrollY));
  sessionStorage.setItem("flow.sel", String(sel));
  const res = await fetch("/__beats", { method: "POST", body: JSON.stringify(doc) });
  if (res.ok) toast("💾 저장 완료 — 게임 화면은 그대로 유지됩니다");
  else toast("저장 실패", true);
  dirty = false;
}

/** 커스텀 confirm 모달 — 확인 시 true */
function confirmModal(title: string, desc: string): Promise<boolean> {
  return new Promise((resolve) => {
    const bg = document.createElement("div");
    bg.style.cssText = "position:fixed;inset:0;z-index:100;background:#0d0618cc;backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center";
    const box = document.createElement("div");
    box.style.cssText = "width:320px;max-width:88vw;background:#241539;border:1.5px solid #7a3040;border-radius:16px;padding:22px 20px;text-align:center;box-shadow:0 20px 50px -10px #000";
    box.innerHTML = `<div style="font-size:34px">🗑</div>
      <h3 style="margin:8px 0 6px;font-size:15px;color:#ff8ba3">${esc(title)}</h3>
      <p style="margin:0 0 16px;font-size:12px;color:#8b7bb0;line-height:1.6">${esc(desc)}</p>`;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px";
    const no = document.createElement("button");
    no.textContent = "취소";
    no.style.cssText = "flex:1;padding:11px;border:1px solid #4a2f70;border-radius:10px;background:#2a1c40;color:#cbb8e8;cursor:pointer;font-weight:700";
    const ok = document.createElement("button");
    ok.textContent = "삭제";
    ok.style.cssText = "flex:1;padding:11px;border:none;border-radius:10px;background:linear-gradient(180deg,#ff8ba3,#e05a75);color:#3a0d18;cursor:pointer;font-weight:800";
    const done = (v: boolean): void => { bg.remove(); resolve(v); };
    no.onclick = () => done(false);
    ok.onclick = () => done(true);
    bg.onclick = (e) => { if (e.target === bg) done(false); };
    row.append(no, ok);
    box.appendChild(row);
    bg.appendChild(box);
    document.body.appendChild(bg);
  });
}

function toast(msg: string, warn = false): void {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = `position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:99;padding:10px 18px;border-radius:12px;font-size:13px;font-weight:700;color:${warn ? "#3a1608" : "#083a2a"};background:${warn ? "#ffcf6b" : "#7ef0c0"};box-shadow:0 8px 24px #0008`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// ── 노드 요약 렌더 ──
function gaugeChips(e: Effect | undefined): string {
  if (!e?.gauges) return "";
  return Object.entries(e.gauges)
    .map(([k, v]) => `<span class="chip ${Number(v) >= 0 ? "up" : "down"}">${GLBL[k] ?? k}${Number(v) >= 0 ? "+" : ""}${v}</span>`)
    .join("");
}
function extraChips(e: Effect | undefined): string {
  if (!e) return "";
  const out: string[] = [];
  if (e.flags?.length) out.push(`🚩${e.flags.join(",")}`);
  if (e.addClue) out.push(`🔍${e.addClue}`);
  if (e.grantTickets?.length) out.push(`🎟${e.grantTickets.join(",")}`);
  return out.length ? `<span class="chip etc">${esc(out.join(" "))}</span>` : "";
}

function badges(b: Beat): string {
  const out: string[] = [];
  if (b.loop === 1) out.push(`<span class="bdg l1">1회차</span>`);
  if (b.loop === 2) out.push(`<span class="bdg l2">2회차</span>`);
  // 2회차 탭에서 공통 비트는 "회상" — 새 장면(loop:2)과 성격이 달라 한눈에 갈라 보여준다
  if (tab === 2 && !b.loop) out.push(`<span class="bdg rc">↩︎ 회상</span>`);
  if (b.training) out.push(`<span class="bdg tr">🎹 연습</span>`);
  if (b.isConvergence) out.push(`<span class="bdg cv">⭐ 수렴</span>`);
  if (b.requires) out.push(`<span class="bdg rq">🔒 조건</span>`);
  const g = gates.find((x) => x.trigger.beatId === b.id);
  if (g) out.push(`<span class="bdg gt">🎮 관문:${esc(g.name)}</span>`);
  return out.join("");
}

function renderTimeline(): void {
  const host = $("timeline");
  let html = "";
  let curWeek: number | undefined = undefined;
  let curAct: number | undefined = undefined;
  // 이 회차에 실제로 플레이되는 비트만. data-i는 **원본 배열 인덱스**를 그대로 실어야
  // 추가·삭제·필드 편집이 필터와 무관하게 정확한 비트를 가리킨다.
  const shown = beatsOfLoop(beats, tab).map((b) => [b, beats.indexOf(b)] as const);
  shown.forEach(([b, i]) => {
    if (b.act !== curAct) {
      if (curAct !== undefined) html += `</div>`; // 이전 막 밴드 닫기
      curAct = b.act;
      curWeek = undefined;
      const gate = gates.find((x) => x.trigger.act === b.act);
      if (gate) html += `<div class="gate">🎮 <b>${esc(gate.name)}</b> <span>${gate.engine} 관문 · ${ACT_NAME[b.act] ?? b.act} 진입</span></div>`;
      html += `<div class="actband" style="border-color:${ACT_COLOR[b.act] ?? "#888"}"><div class="acthead" style="color:${ACT_COLOR[b.act] ?? "#888"}">${ACT_NAME[b.act] ?? `${b.act}막`}</div>`;
    }
    if (b.week !== curWeek) {
      curWeek = b.week;
      html += `<div class="week">W${b.week}</div>`;
    }
    const loopCls = b.loop === 1 ? "n-l1" : b.loop === 2 ? "n-l2" : "";
    // 2회차 탭은 그 화면에 실제로 나올 문구를 보여준다. 아직 회상을 쓰지 않은 공통 비트는
    // 흐리게 눕혀, 88개 중 손대지 않은 곳이 스캔만으로 보이게 한다.
    const r = tab === 2 ? recallOf(b) : null;
    const inherit = tab === 2 && !b.loop && recallIsInherited(b);
    const body = r ? r.text : b.textKey;
    html += `<div class="node ${loopCls} ${inherit ? "n-inherit" : ""} ${i === sel ? "on" : ""}" data-i="${i}">
      <div class="nid">${esc(b.id)} ${badges(b)}</div>
      <div class="ntxt">${esc(body.slice(0, 64))}${body.length > 64 ? "…" : ""}</div>
      <div class="nlr"><span>◀ ${esc(r ? r.left : b.left.label)} ${gaugeChips(b.left.effects)}${extraChips(b.left.effects)}</span>
      <span>${esc(r ? r.right : b.right.label)} ▶ ${gaugeChips(b.right.effects)}${extraChips(b.right.effects)}</span></div>
    </div>`;
  });
  html += `</div>`;
  html += tab === 1
    ? `<div class="endnote">1회차 → 💥 강제 사고 → <b>↺ 회귀 (W0부터)</b></div>`
    : `<div class="endnote">2회차 → 🎬 <b>트루엔딩</b> · <b>↩︎ 회상</b> 비트는 1회차에서 본 장면이 다시 나오는 자리입니다</div>`;
  host.innerHTML = html;
  host.querySelectorAll<HTMLElement>(".node").forEach((n) => {
    n.onclick = () => { sel = Number(n.dataset.i); renderTimeline(); renderPanel(); };
  });
  syncTabs(); // 회상 진행률이 편집 즉시 따라오도록 목록과 함께 갱신
}

// ── 편집 패널 ──
function fld(label: string, inner: string): string {
  return `<label class="fld"><span>${label}</span>${inner}</label>`;
}

function renderPanel(): void {
  const host = $("panel");
  const b = beats[sel];
  if (sel < 0 || !b) {
    host.innerHTML = `<div class="hint">← 노드를 클릭하면 여기서 편집합니다.<br><br>
    <b>배지</b>: 1회차(관찰)·2회차(포착)·공통(무표시) / 🎹 연습 / ⭐ 수렴 앵커 / 🔒 진입조건 / 🎮 관문 트리거<br><br>
    저장하면 <b>실제 게임 데이터</b>(src/data/beats)에 기록되고 게임 탭이 자동 리로드됩니다.</div>`;
    return;
  }
  const side = (key: "left" | "right", title: string): string => {
    const c = b[key];
    const gInputs = GAUGES.map((g) =>
      `<label class="gg"><span>${GLBL[g]}</span><input type="number" data-side="${key}" data-g="${g}" value="${c.effects.gauges?.[g] ?? ""}" placeholder="0"></label>`).join("");
    return `<div class="side"><div class="sidehead">${title}</div>
      ${fld("라벨", `<input data-f="${key}.label" value="${esc(c.label)}">`)}
      <div class="ggrid">${gInputs}</div>
      <details><summary>고급 effects JSON (플래그·단서·티켓)</summary>
        <textarea data-adv="${key}" rows="4">${esc(JSON.stringify(c.effects, null, 1))}</textarea>
        <button class="mini" data-advapply="${key}">적용</button></details>
    </div>`;
  };
  // ── 2회차 회상 칸 — 공통 비트에만. 위엔 1회차 원문(읽기 전용), 아래가 입력 칸.
  // 잠금 장치를 두지 않는다: 위는 못 고치는 원문, 아래는 쓰는 칸 — 위치만으로 구분된다.
  const recallField = (key: keyof BeatRecall, title: string, base: string, rows: number): string => {
    const v = b.recall?.[key] ?? "";
    const inherit = v.trim() === "";
    const input = rows > 1
      ? `<textarea data-r="${key}" rows="${rows}" placeholder="비워두면 1회차 문장이 그대로 나옵니다">${esc(v)}</textarea>`
      : `<input data-r="${key}" value="${esc(v)}" placeholder="비워두면 1회차 문구 그대로">`;
    return `<div class="rcf ${inherit ? "inherit" : ""}">
      <div class="rchead">${title}<span class="bdg same">1회차와 동일</span></div>
      <div class="rcbase">${esc(base)}</div>
      ${input}</div>`;
  };
  const recallBlock = tab === 2 && !b.loop
    ? `<div class="rcwrap">
         <div class="rctitle">↩︎ 2회차 회상 문구 <span>— 이 비트가 회상으로 다시 나올 때 보일 문구</span></div>
         ${recallField("textKey", "대사", b.textKey, 3)}
         ${recallField("leftLabel", "◀ 왼쪽 선택지", b.left.label, 1)}
         ${recallField("rightLabel", "오른쪽 선택지 ▶", b.right.label, 1)}
       </div>`
    : "";

  host.innerHTML = `
    <div class="phead"><b>${esc(b.id)}</b></div>
    <div class="pactions">
      <button id="addBtn" class="act-add">＋ 아래에 비트 추가</button>
      <button id="delBtn" class="act-del">🗑 이 비트 삭제</button>
    </div>
    ${fld("id", `<input data-f="id" value="${esc(b.id)}">`)}
    <div class="row2">
      ${fld("막(act)", `<input type="number" data-f="act" value="${b.act}">`)}
      ${fld("주차(week)", `<input type="number" data-f="week" value="${b.week ?? ""}">`)}
    </div>
    <div class="row2">
      ${fld("회차(loop)", `<select data-f="loop"><option value="">공통</option><option value="1" ${b.loop === 1 ? "selected" : ""}>1회차(관찰)</option><option value="2" ${b.loop === 2 ? "selected" : ""}>2회차(포착)</option></select>`)}
      <label class="fld chk"><span>플래그</span><span class="chks">
        <label><input type="checkbox" data-f="training" ${b.training ? "checked" : ""}> 🎹연습</label>
        <label><input type="checkbox" data-f="isConvergence" ${b.isConvergence ? "checked" : ""}> ⭐수렴</label>
      </span></label>
    </div>
    ${fld("대사(textKey)", `<textarea data-f="textKey" rows="3">${esc(b.textKey)}</textarea>`)}
    ${recallBlock}
    ${side("left", "◀ 왼쪽 선택지")}
    ${side("right", "오른쪽 선택지 ▶")}
    <details><summary>진입 조건 requires JSON</summary>
      <textarea id="reqTa" rows="3">${esc(b.requires ? JSON.stringify(b.requires, null, 1) : "")}</textarea>
      <button class="mini" id="reqApply">적용 (비우면 제거)</button></details>
  `;

  // 회상 칸 바인딩 — 빈 값은 키를 지우고, 셋 다 비면 recall 자체를 없앤다 (파일에 잡음이 남지 않게)
  host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-r]").forEach((el) => {
    el.addEventListener("input", () => {
      const bt = beats[sel];
      if (!bt) return;
      const key = el.dataset.r as keyof BeatRecall;
      const r: BeatRecall = { ...bt.recall };
      if (el.value.trim() === "") delete r[key];
      else r[key] = el.value;
      if (Object.keys(r).length === 0) delete bt.recall;
      else bt.recall = r;
      dirty = true;
      sendPreview();
      el.closest(".rcf")?.classList.toggle("inherit", el.value.trim() === "");
      renderTimeline();
    });
  });

  // 필드 바인딩
  host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-f]").forEach((el) => {
    el.addEventListener("input", () => {
      const f = el.dataset.f as string;
      const bt = beats[sel];
      if (!bt) return;
      dirty = true;
      if (f === "id") bt.id = el.value;
      else if (f === "act") bt.act = Number(el.value) || 0;
      else if (f === "week") bt.week = el.value === "" ? undefined : Number(el.value);
      else if (f === "loop") {
        if (el.value === "") delete bt.loop;
        else bt.loop = Number(el.value) as 1 | 2;
      } else if (f === "training") {
        if ((el as HTMLInputElement).checked) bt.training = true; else delete bt.training;
      } else if (f === "isConvergence") {
        if ((el as HTMLInputElement).checked) bt.isConvergence = true; else delete bt.isConvergence;
      } else if (f === "textKey") { bt.textKey = el.value; sendPreview(); }
      else if (f === "left.label") { bt.left.label = el.value; sendPreview(); }
      else if (f === "right.label") { bt.right.label = el.value; sendPreview(); }
      renderTimeline();
    });
  });
  // 게이지 입력
  host.querySelectorAll<HTMLInputElement>("[data-g]").forEach((el) => {
    el.addEventListener("input", () => {
      const bt = beats[sel];
      if (!bt) return;
      const c = bt[el.dataset.side as "left" | "right"];
      const g = el.dataset.g as GaugeId;
      c.effects.gauges ??= {};
      if (el.value === "") delete c.effects.gauges[g];
      else c.effects.gauges[g] = Number(el.value);
      if (Object.keys(c.effects.gauges).length === 0) delete c.effects.gauges;
      dirty = true;
      renderTimeline();
    });
  });
  // 고급 effects JSON 적용
  host.querySelectorAll<HTMLButtonElement>("[data-advapply]").forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.advapply as "left" | "right";
      const ta = host.querySelector<HTMLTextAreaElement>(`[data-adv="${key}"]`);
      const bt = beats[sel];
      if (!ta || !bt) return;
      try {
        bt[key].effects = JSON.parse(ta.value) as Effect;
        dirty = true;
        renderTimeline();
        renderPanel();
        toast("effects 적용됨");
      } catch { toast("⚠ JSON 파싱 실패", true); }
    };
  });
  // requires 적용
  ($("reqApply") as HTMLButtonElement).onclick = () => {
    const ta = $("reqTa") as HTMLTextAreaElement;
    const bt = beats[sel];
    if (!bt) return;
    try {
      if (ta.value.trim() === "") delete bt.requires;
      else bt.requires = JSON.parse(ta.value);
      dirty = true;
      renderTimeline();
      toast("requires 적용됨");
    } catch { toast("⚠ JSON 파싱 실패", true); }
  };
  // 추가/삭제
  ($("addBtn") as HTMLButtonElement).onclick = () => {
    const bt = beats[sel];
    if (!bt) return;
    let nid = `${bt.id}_new`;
    let n = 2;
    while (beats.some((x) => x.id === nid)) nid = `${bt.id}_new${n++}`;
    const nb: Beat = {
      id: nid, act: bt.act, week: bt.week, textKey: "(새 비트)",
      ...(bt.loop !== undefined ? { loop: bt.loop } : {}),
      left: { label: "왼쪽", effects: {} }, right: { label: "오른쪽", effects: {} },
    };
    beats.splice(sel + 1, 0, nb);
    sel = sel + 1;
    dirty = true;
    renderTimeline();
    renderPanel();
  };
  ($("delBtn") as HTMLButtonElement).onclick = () => {
    void (async () => {
      const bt = beats[sel];
      if (!bt) return;
      const gate = gates.find((x) => x.trigger.beatId === bt.id);
      const warn = gate ? ` 이 비트는 관문 "${gate.name}"의 트리거입니다!` : "";
      if (!(await confirmModal(`"${bt.id}" 삭제`, `이 비트를 플로우에서 제거합니다.${warn} 💾 저장 전까지는 파일에 반영되지 않습니다.`))) return;
      beats.splice(sel, 1);
      sel = -1;
      dirty = true;
      renderTimeline();
      renderPanel();
      toast("삭제됨 — 💾 저장해야 게임에 반영됩니다");
    })();
  };
}

// ── 셸 ──
function shell(): void {
  $("flow").innerHTML = `
  <style>
    body{font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#f3ecff}
    #bar{position:fixed;top:0;left:0;right:0;z-index:10;display:flex;align-items:center;gap:12px;
      padding:10px 18px;background:#1d1030f2;border-bottom:1px solid #3a2757;backdrop-filter:blur(4px)}
    #bar h1{font-size:15px;margin:0} #bar .sub{font-size:11px;color:#8b7bb0}
    #bar button{margin-left:auto;padding:9px 18px;border:none;border-radius:10px;cursor:pointer;font-weight:800;
      background:linear-gradient(180deg,#ffd884,#f2c86a);color:#3a1608}
    #wrap{display:flex;gap:0;padding-top:54px}
    #timeline{flex:1;padding:16px 18px 60px;min-width:0}
    #panel{width:400px;flex:none;position:sticky;top:54px;height:calc(100vh - 54px);overflow-y:auto;
      background:#1d1030;border-left:1px solid #3a2757;padding:16px}
    .actband{border-left:3px solid;border-radius:4px;padding:4px 0 10px 14px;margin:14px 0}
    .acthead{font-weight:900;font-size:14px;letter-spacing:.08em;margin:4px 0 6px}
    .week{font-size:11px;color:#8b7bb0;font-weight:800;margin:12px 0 4px}
    .gate{margin:18px 0 4px;padding:10px 14px;border:1.5px dashed #f2c86a;border-radius:12px;color:#ffcf6b;font-size:13px}
    .gate span{color:#a8863a;font-size:11px;margin-left:6px}
    .node{background:#241539;border:1.5px solid #3a2757;border-radius:12px;padding:9px 12px;margin:6px 0;cursor:pointer}
    .node:hover{border-color:#8b7bb0} .node.on{border-color:#ff5fa2;box-shadow:0 0 0 1px #c9427f}
    .node.n-l1{background:#1b2140;border-color:#3d4a79}
    /* 2회차 전용(포착) — 회상 비트와 한눈에 갈라지도록 연보라 판. 회상은 어두운 기본 판을 쓴다 */
    .node.n-l2{background:#4b3573;border-color:#a78be6;box-shadow:inset 3px 0 0 #a78be6}
    .node.n-l2 .nid{color:#f0e6ff} .node.n-l2 .nlr{color:#c9b6e6}
    .nid{font-size:11px;color:#cbb8e8;font-weight:700;display:flex;gap:5px;flex-wrap:wrap;align-items:center}
    .ntxt{font-size:12.5px;margin:4px 0;line-height:1.45}
    .nlr{display:flex;justify-content:space-between;gap:10px;font-size:10.5px;color:#8b7bb0;flex-wrap:wrap}
    .bdg{font-size:9.5px;padding:1px 7px;border-radius:9px;font-weight:800}
    .bdg.l1{background:#3d4a79;color:#bcd0ff} .bdg.l2{background:#2a1c40;color:#e6c8ff}
    .bdg.tr{background:#2f4a3a;color:#9df0cf} .bdg.cv{background:#4a3d20;color:#ffd884}
    .bdg.rq{background:#3a2757;color:#cbb8e8} .bdg.gt{background:#4a3d20;color:#ffcf6b}
    .bdg.rc{background:#264a52;color:#8fe3f0} .bdg.same{background:#4a3d20;color:#ffd884;margin-left:6px}
    /* 아직 회상을 쓰지 않은 비트 — 흐리게 + 좌측 띠로 남은 작업이 보이게 */
    .node.n-inherit{opacity:.55;border-left:3px solid #6b5a2a}
    #tabs{display:flex;gap:6px;margin-left:14px}
    #tabs button{margin:0;padding:6px 14px;border:1.5px solid #3a2757;border-radius:999px;background:#241539;
      color:#8b7bb0;font-weight:800;font-size:12px;cursor:pointer}
    #tabs button.on{background:#3d2a5e;border-color:#ff5fa2;color:#ffd0e8}
    .rcwrap{border:1.5px solid #2f5a63;border-radius:12px;padding:10px 12px;margin:12px 0;background:#122a30}
    .rctitle{font-size:12px;font-weight:800;color:#8fe3f0;margin-bottom:8px}
    .rctitle span{font-weight:600;color:#5f8f99;font-size:10.5px}
    .rcf{margin:10px 0}
    .rcf.inherit{opacity:.85}
    /* 배지 표시는 CSS가 맡는다 — 타이핑 중 패널을 다시 그리면 입력 포커스를 잃으므로 */
    .rcf .bdg.same{display:none} .rcf.inherit .bdg.same{display:inline}
    .rchead{font-size:11px;font-weight:700;color:#8fe3f0;display:flex;align-items:center}
    .rcbase{font-size:11px;color:#6f8f97;background:#0d1f24;border:1px solid #24444c;border-radius:7px;
      padding:6px 8px;margin:4px 0 5px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
    .rcf input,.rcf textarea{width:100%;padding:7px 9px;border:1.5px solid #2f5a63;border-radius:8px;
      background:#0a1a1e;color:#eafcff;font-size:12.5px;font-family:inherit;box-sizing:border-box}
    .rcf.inherit input,.rcf.inherit textarea{border-color:#6b5a2a;background:#171208}
    .chip{font-size:9.5px;padding:0 5px;border-radius:7px;margin-left:2px}
    .chip.up{background:#1f4433;color:#7ef0c0} .chip.down{background:#4a2030;color:#ff8ba3} .chip.etc{background:#2a1c40;color:#a99bc0}
    .endnote{margin:22px 0;padding:12px 16px;border:1.5px dashed #8b7bb0;border-radius:12px;color:#cbb8e8;font-size:12.5px}
    .hint{font-size:12.5px;color:#8b7bb0;line-height:1.8}
    .phead{margin-bottom:8px}
    .phead b{font-size:13px;word-break:break-all}
    .pactions{display:flex;gap:8px;margin:0 0 12px}
    .pactions button{flex:1;padding:11px 8px;border-radius:10px;cursor:pointer;font-weight:800;font-size:12.5px}
    .act-add{border:1.5px solid #2f6e5d;background:#1f4433;color:#7ef0c0}
    .act-del{border:1.5px solid #7a3040;background:#3a1c26;color:#ff8ba3}
    .fld{display:block;margin:8px 0;font-size:11px;color:#8b7bb0;font-weight:700}
    .fld input,.fld select,.fld textarea,#panel textarea{width:100%;margin-top:3px;padding:7px 9px;border:1.5px solid #3a2757;border-radius:8px;
      background:#150a24;color:#f3ecff;font-size:12.5px;font-family:inherit;box-sizing:border-box}
    .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .fld.chk .chks{display:flex;gap:10px;margin-top:8px;font-size:12px;color:#f3ecff;font-weight:600}
    .side{border:1px solid #3a2757;border-radius:10px;padding:8px 10px;margin:10px 0}
    .sidehead{font-size:11.5px;font-weight:800;color:#cbb8e8;margin-bottom:2px}
    .ggrid{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-top:6px}
    .gg{font-size:9.5px;color:#8b7bb0;text-align:center}
    .gg input{width:100%;padding:4px 2px;text-align:center;border:1.5px solid #3a2757;border-radius:7px;background:#150a24;color:#f3ecff;box-sizing:border-box}
    details{margin:8px 0;font-size:11px;color:#8b7bb0} summary{cursor:pointer}
    .mini{padding:6px 12px;border:1px solid #4a2f70;border-radius:8px;background:#2a1c40;color:#cbb8e8;cursor:pointer;font-size:11.5px;font-weight:700;margin-top:5px}
    .mini.danger{border-color:#7a3040;color:#ff8ba3}
  </style>
  <div id="bar">
    <a href="editor.html" style="font-size:12px;color:#c9b6e6;text-decoration:none;background:#241539;border:1.5px solid #3a2757;padding:6px 12px;border-radius:10px;white-space:nowrap">← 허브</a>
    <h1>🗺 게임 플로우 에디터</h1>
    <div id="tabs"><button data-tab="1">1회차</button><button data-tab="2">2회차</button></div>
    <span class="sub" id="stats"></span>
    <button id="saveBtn">💾 저장 → 게임 반영</button>
  </div>
  <div id="wrap"><div id="timeline"></div><div id="panel"></div></div>`;
  ($("saveBtn") as HTMLButtonElement).onclick = () => { void save(); };
  $("tabs").querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) => {
    btn.onclick = () => {
      tab = Number(btn.dataset.tab) as LoopCount;
      // 선택 비트가 새 탭에 없으면 선택을 놓는다 — 안 보이는 비트를 편집하고 있는 상태 방지
      const cur = beats[sel];
      if (cur && cur.loop !== undefined && cur.loop !== tab) sel = -1;
      syncTabs();
      renderTimeline();
      renderPanel();
    };
  });
  window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });
}

/** 탭 버튼 상태 + 요약 문구 — 2회차 탭은 회상 진행률을 보여준다 */
function syncTabs(): void {
  $("tabs").querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => {
    b.classList.toggle("on", Number(b.dataset.tab) === tab);
  });
  const common = beats.filter((b) => !b.loop);
  const written = common.filter((b) => !recallIsInherited(b)).length;
  $("stats").textContent = tab === 1
    ? `${beatsOfLoop(beats, 1).length}비트 · 관문 ${gates.length} · 공통 ${common.length} / 1회차 전용 ${beats.filter((b) => b.loop === 1).length}`
    : `${beatsOfLoop(beats, 2).length}비트 · ↩︎ 회상 ${written}/${common.length} 작성 · 2회차 전용 ${beats.filter((b) => b.loop === 2).length}`;
}

async function main(): Promise<void> {
  shell();
  await load();
  syncTabs();
  const savedSel = Number(sessionStorage.getItem("flow.sel") ?? "-1");
  if (savedSel >= 0 && savedSel < beats.length) sel = savedSel;
  renderTimeline();
  renderPanel();
  const sc = sessionStorage.getItem("flow.scroll");
  if (sc) window.scrollTo(0, Number(sc));
  sessionStorage.removeItem("flow.scroll");
  sessionStorage.removeItem("flow.sel");
}
void main();
