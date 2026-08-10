// ui/cheatMenu.ts — 개발용 치트 메뉴. 우측 하단 상시 ⚙️ 버튼 → 모달 레이어.
// 레이아웃 에디터 토글 + 튜닝 에디터 + 등록된 치트 실행. (제출 빌드 전 제거/게이트 예정)
import { editorEnabled, setEditorMode } from "./editor";
import { pairSpace } from "./keys";
import { tuning, cardTemplates } from "../data";
import { RHYTHM_TRAVEL_MS, RHYTHM_NOTE_IV, RHYTHM_JUDGE_PRESETS } from "../engine/minigames";
import { DEFAULT_TUNING } from "../engine/state";
import { makeCards } from "../engine/cards";
import type { Tuning, RhythmJudgeLevel, CardTemplateId, CardGrade, Card } from "../engine/types";

export interface Cheat {
  label: string;
  run: () => void;
  gameOnly?: boolean; // true = 게임(회차) 진입 후에만 활성
}

const cheats: Cheat[] = [];

export function registerCheat(label: string, run: () => void, gameOnly = false): void {
  cheats.push({ label, run, gameOnly });
}

/** 드롭다운으로 대상을 고르고 실행하는 치트 (관문·연습 판정결과처럼 종류가 여럿인 화면용).
 *  선택 상자는 최대 두 개까지 — 보통 [화면] + [등급]. */
export interface CheatPick {
  label: string;
  selects: Array<{ id: string; options: Array<{ value: string; label: string }> }>;
  run: (v: Record<string, string>) => void;
  gameOnly?: boolean;
}
const picks: CheatPick[] = [];
export function registerCheatPick(p: CheatPick): void {
  picks.push(p);
}

// 게임 화면 활성 여부 — app이 등록 (로비·부트에선 false → 게임 전용 항목 비활성화)
let inGameCheck: () => boolean = () => false;
export function setInGameCheck(fn: () => boolean): void {
  inGameCheck = fn;
}

// 카드 구성 에디터: app이 덱 조작(컨트롤러 접근)을 등록
export interface CardOps {
  add: (templateId: CardTemplateId, grade: CardGrade) => void;
  remove: (templateId: CardTemplateId, grade: CardGrade) => void; // 해당 종류·등급 1장 제거
  counts: (templateId: CardTemplateId) => Record<CardGrade, number>;
}
let cardOps: CardOps | null = null;

// 게이지 조정: app이 컨트롤러 접근을 등록 (현재 런의 5게이지 직접 편집)
export interface GaugeOps {
  /** 현재 수치 — 런이 없으면 만들어서라도 돌려준다 (로비에서도 조정 가능) */
  read: () => Array<{ id: string; label: string; value: number }>;
  write: (id: string, value: number) => void;
  min: number;
  max: number;
}
let gaugeOps: GaugeOps | null = null;
export function registerGaugeOps(ops: GaugeOps): void {
  gaugeOps = ops;
}

// 회차 이동: app이 컨트롤러 조작을 등록 (회차·막 시작 지점으로 건너뛰기)
/** 목표 지점으로 이동하고 결과 메시지를 돌려준다 (실패해도 메시지로 알린다) */
export type JumpRun = (loop: 1 | 2, act: number) => string;
let jumpRun: JumpRun | null = null;
export function registerJumpOps(fn: JumpRun): void {
  jumpRun = fn;
}

export function registerCardOps(ops: CardOps): void {
  cardOps = ops;
}

// 게임 진입 전(로비 등) 추가된 카드 대기 버퍼 — 런 시작 시 지급
const pendingCards: Card[] = [];
const deckListeners: Array<() => void> = [];

/** 로비 덱 시트 등이 구독 — 대기 버퍼 변경 시 호출 */
export function onDevDeckChange(fn: () => void): void {
  deckListeners.push(fn);
}
export function getPendingCards(): Card[] {
  return pendingCards;
}
/** 런 시작 시 app이 호출 — 버퍼를 비우며 반환 */
export function drainPendingCards(): Card[] {
  const out = [...pendingCards];
  pendingCards.length = 0;
  return out;
}
const notifyDeck = (): void => { deckListeners.forEach((f) => f()); };

// 에디터가 쓰는 실효 ops: 게임 중이면 컨트롤러로, 아니면 대기 버퍼로
const effOps: CardOps = {
  add: (id, grade) => {
    if (cardOps) cardOps.add(id, grade);
    else pendingCards.push(...makeCards(id, grade, cardTemplates)); // 실제 획득과 같은 규칙 — 게이지마다 한 장
    notifyDeck(); // 로비 덱 시트 실시간 갱신 (런 덱·버퍼 공통)
  },
  remove: (id, grade) => {
    if (cardOps) { cardOps.remove(id, grade); notifyDeck(); return; }
    const i = pendingCards.findIndex((c) => c.templateId === id && c.grade === grade);
    if (i >= 0) { pendingCards.splice(i, 1); notifyDeck(); }
  },
  counts: (id) => {
    if (cardOps) return cardOps.counts(id);
    const out: Record<CardGrade, number> = { common: 0, rare: 0, epic: 0 };
    for (const c of pendingCards) if (c.templateId === id) out[c.grade]++;
    return out;
  },
};

let cheatInited = false;

export function initCheatMenu(): void {
  if (cheatInited) return; // 부트 조기 초기화 + 게임 진입 시 중복 호출 방지
  cheatInited = true;
  // ⚙️ 상시 버튼 (우측 하단)
  const btn = document.createElement("button");
  btn.textContent = "⚙️";
  btn.title = "치트 메뉴";
  btn.style.cssText =
    "position:fixed;right:14px;bottom:14px;z-index:1401;width:46px;height:46px;border-radius:50%;" +
    "border:2px solid #ece4f4;background:#fff;font-size:20px;cursor:pointer;" +
    "box-shadow:0 6px 18px rgba(167,139,230,.35)";
  document.body.appendChild(btn);
  // 게임 화면(캔버스) **바깥 오른쪽**에 플로팅 — 화면 위 요소를 가리지 않는다.
  // 레터박스 여백이 없는 좁은 창(모바일)에서는 밖에 자리가 없으므로 안쪽 구석으로 되돌린다.
  const GAP = 10;
  const SIZE = 46;
  const place = (): void => {
    const cv = document.querySelector("canvas");
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const outside = r.right + GAP + SIZE <= window.innerWidth;
    btn.style.left = `${outside ? r.right + GAP : r.right - SIZE - 8}px`;
    btn.style.top = `${r.bottom - SIZE - 8}px`;
    btn.style.right = "auto";
    btn.style.bottom = "auto";
  };
  place();
  window.addEventListener("resize", place);

  // 모달 레이어
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:1402;background:rgba(91,74,112,.35);display:none;" +
    "align-items:center;justify-content:center";
  const modal = document.createElement("div");
  modal.style.cssText =
    "background:#fff;border-radius:16px;padding:18px 20px;width:340px;max-width:92vw;" +
    "max-height:80vh;overflow-y:auto;" + // 내용이 길면 모달 내부 스크롤 (화면 잘림 방지)
    "font:14px -apple-system,sans-serif;color:#5b4a70;box-shadow:0 14px 40px rgba(0,0,0,.25)";
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // 모달을 게임 화면(캔버스) 가운데에 배치 — 뷰포트 아닌 캔버스 기준
  const placeModal = (): void => {
    const cv = document.querySelector("canvas");
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    overlay.style.alignItems = "flex-start";
    overlay.style.justifyContent = "flex-start";
    modal.style.position = "absolute";
    modal.style.left = `${r.left + r.width / 2}px`;
    modal.style.top = `${r.top + r.height / 2}px`;
    modal.style.transform = "translate(-50%, -50%)";
    modal.style.maxHeight = `${Math.min(r.height * 0.86, window.innerHeight * 0.86)}px`;
  };
  window.addEventListener("resize", () => { if (overlay.style.display !== "none") placeModal(); });
  overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = "none"; };
  pairSpace(() => { // Space = 바깥 탭과 동일 (닫기) — 닫혀 있으면 게임으로 통과
    if (overlay.style.display === "none") return false;
    overlay.style.display = "none";
    return true;
  }, () => true);
  btn.onclick = () => { render(); overlay.style.display = "flex"; placeModal(); };

  const item = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText =
      "display:block;width:100%;margin:6px 0;padding:10px 12px;border:1.5px solid #ece4f4;" +
      "border-radius:10px;background:#f8f4fc;color:#5b4a70;font-weight:600;cursor:pointer;text-align:left";
    b.onclick = onClick;
    return b;
  };

  // 회귀 생존 카드 설정(구 튜닝 에디터): data/tuning.json 값을 숫자 입력으로 편집 + 파일 저장
  // 타이밍 키(stopSpeed*/rhythm*)는 ⏱ 타이밍 튜닝 섹션이 담당 — 여기선 라벨 등록된 키만 노출
  const TUNING_LABEL: Partial<Record<keyof Tuning, string>> = {
    cardCarryOver: "회귀 시 생존 카드 수 (개)",
  };
  function renderTuning(): void {
    modal.innerHTML = "<b>♻️ 회귀 생존 카드 설정</b><hr style='border:none;border-top:1px solid #ece4f4'>";
    for (const key of Object.keys(TUNING_LABEL) as Array<"cardCarryOver">) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;align-items:center;margin:8px 0;font-size:12.5px";
      const lbl = document.createElement("span");
      lbl.textContent = TUNING_LABEL[key] ?? key;
      lbl.style.flex = "1";
      const input = document.createElement("input");
      input.type = "number";
      input.step = "1";
      input.value = String(tuning[key]);
      input.style.cssText = "width:70px;padding:4px 6px;border:1.5px solid #ece4f4;border-radius:8px";
      input.onchange = () => { tuning[key] = Number(input.value); };
      row.append(lbl, input);
      modal.appendChild(row);
    }
    const save = document.createElement("button");
    save.textContent = "💾 tuning.json 저장";
    save.style.cssText =
      "margin-top:8px;width:100%;padding:9px;border:0;border-radius:10px;background:#ff7fb0;color:#fff;font-weight:700;cursor:pointer";
    save.onclick = () => {
      void fetch("/__tuning", { method: "POST", body: JSON.stringify(tuning, null, 2) })
        .then((r) => { save.textContent = r.ok ? "✅ 저장됨" : "❌ 실패(dev 서버 전용)"; })
        .catch(() => { save.textContent = "❌ 실패(dev 서버 전용)"; });
    };
    const back = item("← 치트 메뉴로", () => render());
    modal.append(save, back);
  }

  // ⏱ 타이밍 튜닝: STOP 슬라이더 + 리듬 속도 5단계 + 판정 3단계(허용 오차 시각 바) — tuning.json 연동
  function renderTiming(): void {
    modal.innerHTML = "<b>⏱ 타이밍 튜닝</b><hr style='border:none;border-top:1px solid #ece4f4'>";
    const sec = (t: string): void => {
      const d = document.createElement("div");
      d.style.cssText = "margin:12px 0 4px;font-size:12px;font-weight:800;color:#8a76a8";
      d.textContent = t;
      modal.appendChild(d);
    };
    const hint = (): HTMLDivElement => {
      const d = document.createElement("div");
      d.style.cssText = "font-size:11px;color:#b8a8cc;margin:2px 0 0 2px";
      return d;
    };

    // ── STOP: 슬라이더 2개 + 실효 속도 안내 ──
    sec("▸ STOP — 연습: 보컬 · 안무 · 알바");
    const eff = hint();
    const syncEff = (): void => {
      eff.textContent = `ⓘ 3막 기준 실효 속도: ${(tuning.stopSpeedBase + 3 * tuning.stopSpeedPerAct).toFixed(2).replace(/\.?0+$/, "")}`;
    };
    const slider = (label: string, min: number, max: number, step: number,
      get: () => number, set: (v: number) => void, fmt: (v: number) => string): void => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;margin:7px 0;font-size:12px";
      const l = document.createElement("span");
      l.textContent = label;
      l.style.cssText = "flex:none;width:70px";
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(get());
      input.style.cssText = "flex:1;accent-color:#ff7fb0";
      const val = document.createElement("span");
      val.style.cssText = "flex:none;width:62px;text-align:right;font-weight:700";
      const upd = (): void => { val.textContent = fmt(get()); syncEff(); };
      input.oninput = () => { set(Number(input.value)); upd(); };
      upd();
      row.append(l, input, val);
      modal.appendChild(row);
    };
    slider("기본 속도", 0.5, 4, 0.1, () => tuning.stopSpeedBase, (v) => { tuning.stopSpeedBase = v; }, (v) => v.toFixed(1));
    slider("막당 가속", 0, 1, 0.05, () => tuning.stopSpeedPerAct, (v) => { tuning.stopSpeedPerAct = v; }, (v) => `+${v}/막`);
    modal.appendChild(eff);
    syncEff();

    // ── 공용 라디오 행 ──
    const radioRow = <T,>(items: Array<{ label: string; sub: string; value: T }>,
      isOn: (v: T) => boolean, pick: (v: T) => void): HTMLDivElement => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:5px;margin:6px 0 4px";
      const paint = (): void => {
        for (let i = 0; i < row.children.length; i++) {
          const b = row.children[i] as HTMLElement;
          const on = isOn(items[i]!.value);
          b.style.background = on ? "#ff7fb0" : "#fff";
          b.style.borderColor = on ? "#ff7fb0" : "#ece4f4";
          b.style.color = on ? "#fff" : "#8a76a8";
        }
      };
      for (const it of items) {
        const b = document.createElement("button");
        b.innerHTML = `${it.label}<small style="display:block;font-weight:400;font-size:9px;opacity:.75">${it.sub}</small>`;
        b.style.cssText = "flex:1;padding:7px 0 5px;border:1.5px solid #ece4f4;border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;background:#fff;color:#8a76a8";
        b.onclick = () => { pick(it.value); paint(); };
        row.appendChild(b);
      }
      paint();
      modal.appendChild(row);
      return row;
    };

    // ── 리듬 속도: 5단계 배율 (낙하·간격 비율 연동) ──
    sec("▸ 리듬 속도 — 낙하·노트 간격 비율 연동");
    const spdMs = hint();
    const syncSpd = (): void => {
      const k = tuning.rhythmSpeedMult > 0 ? tuning.rhythmSpeedMult : 1;
      const f = (v: number): number => Math.round(v / k);
      spdMs.textContent = `낙하 ${f(RHYTHM_TRAVEL_MS)}ms · 노트 간격 ${f(RHYTHM_NOTE_IV[2] ?? 800)}ms(2막) / ${f(RHYTHM_NOTE_IV[3] ?? 640)}ms(3막)`;
    };
    radioRow(
      [{ label: "매우 느림", sub: "×0.7", value: 0.7 }, { label: "느림", sub: "×0.85", value: 0.85 },
       { label: "보통", sub: "기본", value: 1 }, { label: "빠름", sub: "×1.2", value: 1.2 },
       { label: "매우 빠름", sub: "×1.4", value: 1.4 }],
      (v) => Math.abs(tuning.rhythmSpeedMult - v) < 0.01,
      (v) => { tuning.rhythmSpeedMult = v; syncSpd(); },
    );
    modal.appendChild(spdMs);
    syncSpd();

    // ── 리듬 판정: 3단계 프리셋 + 허용 오차 시각 바 ──
    sec("▸ 리듬 판정 — 허용 오차 (선에 닿는 순간 ±ms)");
    const jBar = document.createElement("div");
    jBar.style.cssText = "position:relative;height:24px;background:#f1eaf6;border-radius:12px;overflow:hidden;margin:8px 0 3px";
    const jGood = document.createElement("div");
    jGood.style.cssText = "position:absolute;top:0;bottom:0;background:rgba(111,216,196,.45)";
    const jPerf = document.createElement("div");
    jPerf.style.cssText = "position:absolute;top:0;bottom:0;background:rgba(240,192,90,.8)";
    const jLine = document.createElement("div");
    jLine.style.cssText = "position:absolute;top:-2px;bottom:-2px;left:50%;width:2px;background:#ff7fb0";
    jBar.append(jGood, jPerf, jLine);
    const jTxt = hint();
    jTxt.style.textAlign = "center";
    const syncJdg = (): void => {
      const jw = RHYTHM_JUDGE_PRESETS[tuning.rhythmJudge] ?? RHYTHM_JUDGE_PRESETS.normal;
      const MAX = 260; // 바 절반 = 260ms
      const w = (v: number): number => (v / MAX) * 50;
      jGood.style.left = `${50 - w(jw.good)}%`;
      jGood.style.width = `${w(jw.good) * 2}%`;
      jPerf.style.left = `${50 - w(jw.perfect)}%`;
      jPerf.style.width = `${w(jw.perfect) * 2}%`;
      jTxt.textContent = `🟡 PERFECT ±${jw.perfect}ms · 🟢 GOOD ±${jw.good}ms · 밖=MISS`;
    };
    radioRow(
      [{ label: "후함", sub: "±120 / ±240", value: "loose" as RhythmJudgeLevel },
       { label: "보통", sub: "±80 / ±180", value: "normal" as RhythmJudgeLevel },
       { label: "정밀", sub: "±50 / ±120", value: "tight" as RhythmJudgeLevel }],
      (v) => tuning.rhythmJudge === v,
      (v) => { tuning.rhythmJudge = v; syncJdg(); },
    );
    modal.append(jBar, jTxt);
    syncJdg();

    // ── 즉시 테스트: 등록된 치트 재사용 (게임 진입 전이면 해당 치트가 안내 토스트) ──
    const note = hint();
    note.textContent = "값 변경 = 즉시 적용 (다음 판부터) · 💾 저장 시 tuning.json 영구 반영(빌드 포함)";
    note.style.margin = "10px 0 6px";
    modal.appendChild(note);
    const testRow = document.createElement("div");
    testRow.style.cssText = "display:flex;gap:8px";
    const testBtn = (label: string, prefix: string): void => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = "flex:1;padding:9px;border:0;border-radius:10px;background:#f3ecfa;color:#8a76a8;font-weight:700;cursor:pointer";
      b.onclick = () => {
        const c = cheats.find((x) => x.label.startsWith(prefix));
        if (c) { c.run(); overlay.style.display = "none"; }
      };
      testRow.appendChild(b);
    };
    testBtn("🎮 STOP 테스트", "🎹"); // 연습 메뉴 (STOP 3종 포함)
    testBtn("🎮 리듬 테스트", "🥇"); // 센터 대결 관문
    modal.appendChild(testRow);

    const saveRow = document.createElement("div");
    saveRow.style.cssText = "display:flex;gap:8px;margin-top:8px";
    const save = document.createElement("button");
    save.textContent = "💾 tuning.json 저장";
    save.style.cssText = "flex:1;padding:9px;border:0;border-radius:10px;background:#ff7fb0;color:#fff;font-weight:700;cursor:pointer";
    save.onclick = () => {
      void fetch("/__tuning", { method: "POST", body: JSON.stringify(tuning, null, 2) })
        .then((r) => { save.textContent = r.ok ? "✅ 저장됨" : "❌ 실패(dev 서버 전용)"; })
        .catch(() => { save.textContent = "❌ 실패(dev 서버 전용)"; });
    };
    const reset = document.createElement("button");
    reset.textContent = "↺ 기본값";
    reset.style.cssText = "padding:9px 14px;border:0;border-radius:10px;background:#eee;color:#8a76a8;font-weight:700;cursor:pointer";
    reset.onclick = () => {
      // 타이밍 키만 복원 (cardCarryOver는 별도 섹션 소관)
      tuning.stopSpeedBase = DEFAULT_TUNING.stopSpeedBase;
      tuning.stopSpeedPerAct = DEFAULT_TUNING.stopSpeedPerAct;
      tuning.rhythmSpeedMult = DEFAULT_TUNING.rhythmSpeedMult;
      tuning.rhythmJudge = DEFAULT_TUNING.rhythmJudge;
      renderTiming();
    };
    saveRow.append(save, reset);
    modal.appendChild(saveRow);
    modal.appendChild(item("← 치트 메뉴로", () => render()));
  }

  // 카드 구성 에디터 (C안): 아코디언 리스트 — 5게이지 수치 직접 입력 + 덱 추가/삭제 + cards.json 저장
  const GLBL: Record<string, string> = { skill: "실력", mental: "멘탈", reputation: "평판", bond: "유대", capital: "자본" };
  const GAUGE_KEYS = ["skill", "mental", "reputation", "bond", "capital"] as const;
  const STAR: Record<CardGrade, string> = { common: "★", rare: "★★", epic: "★★★" };
  const expandedCards = new Set<CardTemplateId>(); // 재렌더 간 펼침 상태 유지

  function effSummary(t: (typeof cardTemplates)[number]): string {
    const parts = Object.entries(t.baseGauges).filter(([, v]) => v !== 0)
      .map(([k, v]) => `${GLBL[k] ?? k}${v > 0 ? "+" : ""}${v}`);
    return parts.length ? parts.join(" ") : "효과 없음";
  }
  function deckSummary(id: CardTemplateId): string {
    const c = effOps.counts(id);
    const total = c.common + c.rare + c.epic;
    if (total === 0) return "덱 0장";
    const by = (["common", "rare", "epic"] as CardGrade[])
      .filter((g) => c[g] > 0).map((g) => `${STAR[g]}${c[g]}`).join("·");
    return `덱 ${total}장 (${by})`;
  }

  function renderCardEditor(): void {
    modal.innerHTML =
      "<b>카드 구성 에디터</b> <small style='color:#a99bc0'>· 수치=★기준(등급 배율 자동)</small>" +
      "<hr style='border:none;border-top:1px solid #ece4f4'>";

    for (const t of cardTemplates) {
      const acc = document.createElement("div");
      acc.style.cssText = "border:2px solid #ece4f4;border-radius:12px;margin:7px 0;overflow:hidden";

      const head = document.createElement("div");
      head.style.cssText = "display:flex;align-items:center;gap:8px;padding:9px 12px;font-size:12.5px;font-weight:800;background:#fbf8ff;cursor:pointer";
      head.innerHTML =
        `<span>${t.icon} ${t.name.replace(" 카드", "")}</span>` +
        `<span style='color:#3fb98a;font-size:11px;font-weight:700'>${effSummary(t)}</span>` +
        `<span style='margin-left:auto;font-size:11px;color:#c9527f'>${deckSummary(t.id)}</span>`;
      head.onclick = () => {
        if (expandedCards.has(t.id)) expandedCards.delete(t.id);
        else expandedCards.add(t.id);
        renderCardEditor();
      };
      acc.appendChild(head);

      if (expandedCards.has(t.id)) {
        const body = document.createElement("div");
        body.style.cssText = "padding:10px 12px;border-top:1.5px solid #ece4f4";

        // 5게이지 인라인 숫자 입력
        const row5 = document.createElement("div");
        row5.style.cssText = "display:flex;gap:5px";
        for (const k of GAUGE_KEYS) {
          const cell = document.createElement("div");
          cell.style.cssText = "flex:1;text-align:center";
          const lbl = document.createElement("div");
          lbl.textContent = GLBL[k] ?? k;
          lbl.style.cssText = "font-size:10.5px;font-weight:700;color:#a99bc0;margin-bottom:3px";
          const input = document.createElement("input");
          input.type = "number";
          input.value = String(t.baseGauges[k] ?? 0);
          input.style.cssText = "width:100%;padding:4px 2px;text-align:center;border:1.5px solid #ece4f4;border-radius:8px;font-size:12px;font-weight:700;color:#5b4a70";
          input.onchange = () => {
            const v = Number(input.value) || 0;
            if (v === 0) delete t.baseGauges[k];
            else t.baseGauges[k] = v;
            const summary = head.children[1];
            if (summary) summary.textContent = effSummary(t); // 헤더 요약 즉시 갱신
          };
          cell.append(lbl, input);
          row5.appendChild(cell);
        }
        body.appendChild(row5);

        // 덱 추가/삭제
        const deckRow = document.createElement("div");
        deckRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:10px;background:#fdf0f6;border:1.5px solid #f6d5e6;border-radius:12px;padding:8px 10px;font-size:12px;font-weight:700";
        const cnt = document.createElement("span");
        cnt.textContent = deckSummary(t.id);
        cnt.style.cssText = "color:#c9527f";
        const gradeSel = document.createElement("select");
        gradeSel.style.cssText = "margin-left:auto;border:1.5px solid #ece4f4;border-radius:8px;padding:4px;font-size:11px;color:#5b4a70;background:#fff";
        for (const [v, label] of [["common", "★"], ["rare", "★★"], ["epic", "★★★"]] as Array<[CardGrade, string]>) {
          const o = document.createElement("option");
          o.value = v;
          o.textContent = label;
          gradeSel.appendChild(o);
        }
        const mkOp = (label: string, bg: string, run: () => void): HTMLButtonElement => {
          const b = document.createElement("button");
          b.textContent = label;
          b.style.cssText = `padding:6px 12px;border-radius:9px;border:0;font-weight:800;font-size:11.5px;cursor:pointer;color:#fff;background:${bg}`;
          b.onclick = () => { run(); cnt.textContent = deckSummary(t.id); const hs = acc.querySelector("div")?.children[2]; if (hs) hs.textContent = deckSummary(t.id); };
          return b;
        };
        deckRow.append(cnt, gradeSel,
          mkOp("＋추가", "#ff7fb0", () => effOps.add(t.id, gradeSel.value as CardGrade)),
          mkOp("−삭제", "#c4b8d6", () => effOps.remove(t.id, gradeSel.value as CardGrade)));
        body.appendChild(deckRow);
        acc.appendChild(body);
      }
      modal.appendChild(acc);
    }

    const save = document.createElement("button");
    save.textContent = "💾 cards.json 저장";
    save.style.cssText =
      "margin-top:10px;width:100%;padding:9px;border:0;border-radius:10px;background:#a78be6;color:#fff;font-weight:800;cursor:pointer";
    save.onclick = () => {
      void fetch("/__cards", { method: "POST", body: JSON.stringify(cardTemplates, null, 2) })
        .then((r) => { save.textContent = r.ok ? "✅ 저장됨" : "❌ 실패(dev 서버 전용)"; })
        .catch(() => { save.textContent = "❌ 실패(dev 서버 전용)"; });
    };
    const back = item("← 치트 메뉴로", () => render());
    modal.append(save, back);
  }

  // ── 게이지 수치 조정 — 현재 시점의 5게이지를 직접 넣는다 ──
  function renderGauges(): void {
    modal.innerHTML = "<b>\ud83d\udcca 상태 게이지 조정</b><hr style='border:none;border-top:1px solid #ece4f4'>";
    if (!gaugeOps) { modal.appendChild(item("\u2190 치트 메뉴로", () => render())); return; }
    const ops = gaugeOps;
    const note = document.createElement("div");
    note.style.cssText = "margin:8px 0 10px;font-size:11.5px;color:#a99bc0;line-height:1.6";
    note.textContent = `현재 런의 수치를 그대로 바꿉니다 (${ops.min}~${ops.max}). 슬라이더와 숫자 칸이 함께 움직입니다.`;
    modal.appendChild(note);

    for (const g of ops.read()) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;align-items:center;margin:9px 0;font-size:12.5px";
      const lbl = document.createElement("span");
      lbl.textContent = g.label;
      lbl.style.cssText = "width:38px;flex-shrink:0;font-weight:700";
      const range = document.createElement("input");
      range.type = "range";
      range.min = String(ops.min);
      range.max = String(ops.max);
      range.value = String(g.value);
      range.style.cssText = "flex:1;min-width:0;accent-color:#ff7fb0;cursor:pointer";
      const num = document.createElement("input");
      num.type = "number";
      num.min = String(ops.min);
      num.max = String(ops.max);
      num.value = String(g.value);
      num.style.cssText = "width:56px;flex-shrink:0;padding:6px 7px;border:1.5px solid #ece4f4;"
        + "border-radius:8px;text-align:center;font:700 12.5px -apple-system,sans-serif;color:#5b4a70";
      // 두 칸을 항상 함께 되쓴다 — 범위 밖 숫자를 친 칸에도 잘린 값이 보이게
      const apply = (raw: number): void => {
        const v = Math.max(ops.min, Math.min(ops.max, Math.round(raw) || 0));
        ops.write(g.id, v);
        range.value = String(v);
        num.value = String(v);
      };
      range.oninput = () => apply(Number(range.value));
      num.onchange = () => apply(Number(num.value));
      row.append(lbl, range, num);
      modal.appendChild(row);
    }
    modal.appendChild(item("\u2190 치트 메뉴로", () => render()));
  }

  // ── 회차 이동 — 회차(1·2) × 막(2~5)의 시작 지점으로 건너뛴다 ──
  // 1막은 런의 시작이라 목록에 없다("↺ 새 런 시작"이 그 역할).
  const JUMP_TARGETS: Array<{ loop: 1 | 2; act: number }> = [
    { loop: 1, act: 2 }, { loop: 1, act: 3 }, { loop: 1, act: 4 }, { loop: 1, act: 5 },
    { loop: 2, act: 2 }, { loop: 2, act: 3 }, { loop: 2, act: 4 }, { loop: 2, act: 5 },
  ];
  let jumpPick = 0; // 패널을 다시 열어도 마지막 선택을 유지

  function renderJump(): void {
    modal.innerHTML = "<b>\ud83d\ude80 회차 이동</b><hr style='border:none;border-top:1px solid #ece4f4'>";
    const note = document.createElement("div");
    note.style.cssText = "margin:8px 0 10px;font-size:11.5px;color:#a99bc0;line-height:1.6";
    note.textContent = "선택한 회차·막의 첫 비트로 이동합니다. 지나온 비트는 좌측 선택으로 자동 진행하고 "
      + "관문은 건너뜁니다. 도중에 게이지가 바닥나 런이 끝나지 않도록 게이지를 채워가며 갑니다.";
    modal.appendChild(note);

    const sel = document.createElement("select");
    sel.style.cssText = "width:100%;padding:9px 10px;border:1.5px solid #ece4f4;border-radius:10px;"
      + "background:#fff;color:#5b4a70;font:600 13px -apple-system,sans-serif;cursor:pointer";
    JUMP_TARGETS.forEach((t, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${t.loop}회차 \u2014 ${t.act}막 시작`;
      sel.appendChild(o);
    });
    sel.value = String(jumpPick);
    sel.onchange = () => { jumpPick = Number(sel.value); };
    modal.appendChild(sel);

    const status = document.createElement("div");
    status.style.cssText = "margin:10px 0 0;font-size:11.5px;color:#c9527f;font-weight:700;min-height:16px";

    const go = document.createElement("button");
    go.textContent = "\ud83d\ude80 이동";
    go.style.cssText =
      "margin-top:10px;width:100%;padding:11px;border:0;border-radius:10px;background:#ff7fb0;color:#fff;font-weight:800;cursor:pointer";
    go.onclick = () => {
      const t = JUMP_TARGETS[jumpPick];
      if (!t) return;
      if (!jumpRun) { status.textContent = "이동 기능이 준비되지 않았어요"; return; }
      status.textContent = jumpRun(t.loop, t.act);
    };
    modal.append(go, status, item("\u2190 치트 메뉴로", () => render()));
  }

  function render(): void {
    modal.innerHTML = "<b>🛠 치트 메뉴</b><hr style='border:none;border-top:1px solid #ece4f4'>";
    const inGame = inGameCheck();
    const section = (t: string): void => {
      const d = document.createElement("div");
      d.style.cssText = "margin:10px 0 2px;font-size:10.5px;font-weight:800;letter-spacing:.06em;color:#a99bc0";
      d.textContent = t;
      modal.appendChild(d);
    };
    const disabledItem = (label: string): void => {
      const b = item(label, () => {});
      b.disabled = true;
      b.style.opacity = "0.4";
      b.style.cursor = "default";
      modal.appendChild(b);
    };

    section("🌐 어디서나");
    modal.appendChild(
      item(`📐 레이아웃 에디터 ${editorEnabled() ? "끄기" : "켜기"}`, () => { // 로비·게임 화면 모두 편집 가능
        setEditorMode(!editorEnabled());
        overlay.style.display = "none";
      }),
    );
    modal.appendChild(item("♻️ 회귀 생존 카드 설정", () => renderTuning()));
    modal.appendChild(item("⏱ 타이밍 튜닝", () => renderTiming()));
    modal.appendChild(item("카드 구성 에디터", () => renderCardEditor()));
    modal.appendChild(item("\ud83d\ude80 회차 이동", () => renderJump()));
    for (const c of cheats.filter((x) => !x.gameOnly)) {
      modal.appendChild(item(c.label, () => { c.run(); overlay.style.display = "none"; }));
    }

    section(inGame ? "🎮 게임 전용" : "🎮 게임 전용 (회차 진입 후 활성화)");
    modal.appendChild(item("\ud83d\udcca 상태 게이지 조정", () => renderGauges()));
    for (const c of cheats.filter((x) => x.gameOnly)) {
      if (inGame) modal.appendChild(item(c.label, () => { c.run(); overlay.style.display = "none"; }));
      else disabledItem(c.label);
    }
    // 드롭다운 치트 — 라벨 + 선택 상자 + 열기 버튼을 한 줄로
    for (const p of picks) {
      if (p.gameOnly && !inGame) { disabledItem(`${p.label} (회차 진입 후)`); continue; }
      const box = document.createElement("div");
      box.style.cssText = "display:flex;gap:6px;align-items:center;margin:6px 0;flex-wrap:wrap";
      const lb = document.createElement("span");
      lb.textContent = p.label;
      lb.style.cssText = "font-size:12px;font-weight:700;color:#5b4a70;flex:1 1 100%";
      box.appendChild(lb);
      const sels: Record<string, HTMLSelectElement> = {};
      for (const s of p.selects) {
        const el = document.createElement("select");
        el.style.cssText = "flex:1;padding:7px;border:1px solid #ece4f4;border-radius:8px;font-size:12px;color:#5b4a70";
        for (const o of s.options) {
          const op = document.createElement("option");
          op.value = o.value;
          op.textContent = o.label;
          el.appendChild(op);
        }
        sels[s.id] = el;
        box.appendChild(el);
      }
      const go = document.createElement("button");
      go.textContent = "열기";
      go.style.cssText = "padding:7px 12px;border:0;border-radius:8px;background:#ff7fb0;color:#fff;font-weight:800;cursor:pointer";
      go.onclick = () => {
        const v: Record<string, string> = {};
        for (const [k, el] of Object.entries(sels)) v[k] = el.value;
        p.run(v);
        overlay.style.display = "none";
      };
      box.appendChild(go);
      modal.appendChild(box);
    }
  }
}
