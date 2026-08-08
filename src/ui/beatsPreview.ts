// ui/beatsPreview.ts — 플로우 에디터의 미저장 대사를 실행 중인 게임에 반영한다 (dev 전용).
// beats 배열을 제자리에서 고치고 다시 그리기만 하므로 진행 상태(커서·게이지·덱)가 유지된다.

/** 한 비트에서 덮어쓸 문구. 없는 필드는 원본을 그대로 둔다. */
export interface BeatTextPatch {
  textKey?: string;
  left?: { label?: string; hint?: string };
  right?: { label?: string; hint?: string };
}
export type BeatTextOverlay = Record<string, BeatTextPatch>;

/** 이 모듈이 다루는 최소 형태 — engine의 Beat가 이 구조를 만족한다 */
export interface PreviewBeat {
  id: string;
  textKey: string;
  left: { label: string; hint?: string };
  right: { label: string; hint?: string };
}

interface BeatSnapshot {
  textKey: string;
  leftLabel: string;
  rightLabel: string;
  leftHint?: string;
  rightHint?: string;
}
/** 덮어쓰기 직전의 원본 문구 — 오버레이에서 빠진 필드를 되돌릴 때 쓴다 */
export type Baseline = Map<string, BeatSnapshot>;

const snap = (b: PreviewBeat): BeatSnapshot => ({
  textKey: b.textKey,
  leftLabel: b.left.label,
  rightLabel: b.right.label,
  leftHint: b.left.hint,
  rightHint: b.right.hint,
});

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
  }
}

/** 저장 성공 — 지금 적용된 문구를 기준값으로 승격한다.
 *  기준값을 비우면 이후 오버레이가 비어도 되돌릴 대상이 없어 현재 문구가 유지된다. */
export function commitBaseline(baseline: Baseline): void {
  baseline.clear();
}
