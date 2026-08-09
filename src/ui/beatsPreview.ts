// ui/beatsPreview.ts — 플로우 에디터의 미저장 대사를 실행 중인 게임에 반영한다 (dev 전용).
// beats 배열을 제자리에서 고치고 다시 그리기만 하므로 진행 상태(커서·게이지·덱)가 유지된다.

/** 한 비트에서 덮어쓸 문구. 없는 필드는 원본을 그대로 둔다. */
export interface BeatRecallPatch { textKey?: string; leftLabel?: string; rightLabel?: string }
export interface BeatTextPatch {
  textKey?: string;
  left?: { label?: string; hint?: string };
  right?: { label?: string; hint?: string };
  /** 2회차 회상 문구 — 통째로 교체한다 (항목별 병합은 에디터가 보내기 전에 끝낸다) */
  recall?: BeatRecallPatch;
  /** 화자 프로필 경로 — 빈 문자열이면 "없음"(제거) */
  speaker?: string;
}
export type BeatTextOverlay = Record<string, BeatTextPatch>;

/** 이 모듈이 다루는 최소 형태 — engine의 Beat가 이 구조를 만족한다 */
export interface PreviewBeat {
  id: string;
  textKey: string;
  left: { label: string; hint?: string };
  right: { label: string; hint?: string };
  recall?: BeatRecallPatch;
  speaker?: string;
}

interface BeatSnapshot {
  textKey: string;
  leftLabel: string;
  rightLabel: string;
  leftHint?: string;
  rightHint?: string;
  recall?: BeatRecallPatch;
  speaker?: string;
}
/** 덮어쓰기 직전의 원본 문구 — 오버레이에서 빠진 필드를 되돌릴 때 쓴다 */
export type Baseline = Map<string, BeatSnapshot>;

const snap = (b: PreviewBeat): BeatSnapshot => ({
  textKey: b.textKey,
  leftLabel: b.left.label,
  rightLabel: b.right.label,
  leftHint: b.left.hint,
  rightHint: b.right.hint,
  recall: b.recall ? { ...b.recall } : undefined,
  speaker: b.speaker,
});

const setRecall = (b: PreviewBeat, v: BeatRecallPatch | undefined): void => {
  if (v === undefined) delete b.recall;
  else b.recall = { ...v };
};

// 빈 문자열 = 제거 — 에디터가 "없음"을 보내는 방법 (undefined는 "이 필드는 안 건드림"이라 구분이 필요하다)
const setSpeaker = (b: PreviewBeat, v: string | undefined): void => {
  if (v === undefined || v === "") delete b.speaker;
  else b.speaker = v;
};

const setHint = (c: { hint?: string }, v: string | undefined): void => {
  if (v === undefined) delete c.hint;
  else c.hint = v;
};

/** 오버레이를 beats에 제자리 적용. 오버레이에 없는 필드는 기준값(원본)으로 되돌린다.
 *  같은 오버레이를 여러 번 적용해도 결과가 같다(멱등). */
export function applyOverlay(beats: PreviewBeat[], overlay: BeatTextOverlay, baseline: Baseline): void {
  for (const b of beats) {
    const patch = overlay[b.id];
    if (!patch) {
      const s = baseline.get(b.id);
      if (!s) continue;                       // 손댄 적 없는 비트
      b.textKey = s.textKey;
      b.left.label = s.leftLabel;
      b.right.label = s.rightLabel;
      setHint(b.left, s.leftHint);
      setHint(b.right, s.rightHint);
      setRecall(b, s.recall);
      setSpeaker(b, s.speaker);
      baseline.delete(b.id);
      continue;
    }
    if (!baseline.has(b.id)) baseline.set(b.id, snap(b)); // 첫 덮어쓰기 직전 상태를 남긴다
    const s = baseline.get(b.id)!;
    b.textKey = patch.textKey ?? s.textKey;
    b.left.label = patch.left?.label ?? s.leftLabel;
    b.right.label = patch.right?.label ?? s.rightLabel;
    setHint(b.left, patch.left?.hint ?? s.leftHint);
    setHint(b.right, patch.right?.hint ?? s.rightHint);
    setRecall(b, patch.recall ?? s.recall);
    setSpeaker(b, patch.speaker ?? s.speaker);
  }
}

/** 저장 성공 — 지금 적용된 문구를 기준값으로 승격한다.
 *  기준값을 비우면 이후 오버레이가 비어도 되돌릴 대상이 없어 현재 문구가 유지된다. */
export function commitBaseline(baseline: Baseline): void {
  baseline.clear();
}

// ── 게임 배선 (dev 전용) ────────────────────────────────────────────
const baseline: Baseline = new Map();
let badge: HTMLDivElement | null = null;

function showBadge(n: number): void {
  if (n === 0) { badge?.remove(); badge = null; return; }
  if (!badge) {
    const el = document.createElement("div");
    // 표시 전용 — 클릭 동작 없음. 예전엔 누르면 미저장 수정을 통째로 버렸는데(DELETE),
    // '미저장'이라는 라벨이 저장 버튼처럼 보여 디자이너가 오인 클릭하는 사고가 났다.
    // 되돌리기가 필요하면 플로우 에디터에서 명시적으로 한다.
    el.style.cssText =
      "position:fixed;top:10px;right:10px;z-index:1200;background:#ff7fb0;color:#fff;" +
      "font:700 11px -apple-system,sans-serif;padding:5px 10px;border-radius:999px;" +
      "pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.25)";
    el.title = "플로우 에디터의 미저장 수정이 반영 중 — 에디터에서 💾 저장하면 파일에 남습니다";
    document.body.appendChild(el);
    badge = el;
  }
  badge.textContent = `✎ 미저장 ${n}`;
}

/** 게임 부팅 시 1회. dev 서버가 아니면 아무 일도 하지 않는다. */
export function initBeatsPreview(beats: PreviewBeat[]): void {
  if (!import.meta.hot) return;
  const applyAndDraw = (overlay: BeatTextOverlay): void => {
    applyOverlay(beats, overlay, baseline);
    showBadge(Object.keys(overlay).length);
    void import("./editor").then((e) => e.triggerRedraw());
  };
  // 새로고침해도 미저장 임시본이 그대로 보이도록 현재 오버레이를 받아온다
  void fetch("/__beatspreview")
    .then((r) => r.json() as Promise<{ overlay: BeatTextOverlay }>)
    .then((d) => { if (Object.keys(d.overlay).length > 0) applyAndDraw(d.overlay); })
    .catch(() => {});
  import.meta.hot.on("beats-preview", (d: { overlay: BeatTextOverlay }) => { applyAndDraw(d.overlay); });
  import.meta.hot.on("beats-committed", () => {
    commitBaseline(baseline); // 화면 문구는 그대로 두고 배지만 내린다
    showBadge(0);
  });
}
