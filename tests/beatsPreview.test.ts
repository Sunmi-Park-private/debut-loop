// tests/beatsPreview.test.ts — 대사 프리뷰 오버레이 적용 규칙
import { describe, it, expect } from "vitest";
import { applyOverlay, commitBaseline, type PreviewBeat, type Baseline } from "../src/ui/beatsPreview";

const mk = (): PreviewBeat[] => [
  { id: "b1", textKey: "원본 대사", left: { label: "좌" }, right: { label: "우", hint: "힌트" } },
  { id: "b2", textKey: "둘째", left: { label: "A" }, right: { label: "B" } },
];

describe("applyOverlay", () => {
  it("지정한 필드만 바꾸고 나머지는 원본을 유지한다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    applyOverlay(beats, { b1: { textKey: "고친 대사" } }, base);
    expect(beats[0]!.textKey).toBe("고친 대사");
    expect(beats[0]!.left.label).toBe("좌");
    expect(beats[0]!.right.hint).toBe("힌트");
    expect(beats[1]!.textKey).toBe("둘째");
  });

  it("좌우 라벨과 힌트도 덮어쓴다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    applyOverlay(beats, { b1: { left: { label: "새좌" }, right: { hint: "새힌트" } } }, base);
    expect(beats[0]!.left.label).toBe("새좌");
    expect(beats[0]!.right.label).toBe("우");
    expect(beats[0]!.right.hint).toBe("새힌트");
  });

  it("오버레이에서 필드가 빠지면 원본 문구로 되돌린다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    applyOverlay(beats, { b1: { textKey: "임시" } }, base);
    applyOverlay(beats, { b1: { left: { label: "좌2" } } }, base);
    expect(beats[0]!.textKey).toBe("원본 대사");
    expect(beats[0]!.left.label).toBe("좌2");
  });

  it("오버레이가 비면 전부 원본으로 돌아가고 기준값도 지워진다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    applyOverlay(beats, { b1: { textKey: "임시" } }, base);
    applyOverlay(beats, {}, base);
    expect(beats[0]!.textKey).toBe("원본 대사");
    expect(base.size).toBe(0);
  });

  it("없는 비트 id는 조용히 무시한다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    expect(() => applyOverlay(beats, { nope: { textKey: "x" } }, base)).not.toThrow();
    expect(beats[0]!.textKey).toBe("원본 대사");
  });

  it("같은 오버레이를 두 번 적용해도 결과가 같다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    applyOverlay(beats, { b1: { textKey: "임시" } }, base);
    applyOverlay(beats, { b1: { textKey: "임시" } }, base);
    expect(beats[0]!.textKey).toBe("임시");
    applyOverlay(beats, {}, base);
    expect(beats[0]!.textKey).toBe("원본 대사");
  });
});

describe("commitBaseline", () => {
  it("승격 후에는 오버레이를 비워도 적용된 문구가 유지된다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    applyOverlay(beats, { b1: { textKey: "저장된 대사" } }, base);
    commitBaseline(base);
    applyOverlay(beats, {}, base);
    expect(beats[0]!.textKey).toBe("저장된 대사");
  });
});

describe("회상 문구(recall)", () => {
  it("오버레이로 회상 문구를 실시간 반영한다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    applyOverlay(beats, { b1: { recall: { textKey: "그날이 다시 무너진다" } } }, base);
    expect(beats[0]!.recall).toEqual({ textKey: "그날이 다시 무너진다" });
    expect(beats[0]!.textKey).toBe("원본 대사"); // 1회차 대사는 그대로
  });

  it("오버레이에서 빠지면 원래 상태로 되돌린다", () => {
    const beats = mk();
    beats[0]!.recall = { textKey: "파일에 있던 회상" };
    const base: Baseline = new Map();
    applyOverlay(beats, { b1: { recall: { textKey: "임시본" } } }, base);
    expect(beats[0]!.recall).toEqual({ textKey: "임시본" });
    applyOverlay(beats, {}, base);
    expect(beats[0]!.recall).toEqual({ textKey: "파일에 있던 회상" });
  });

  it("원래 없던 회상은 되돌릴 때 지워진다", () => {
    const beats = mk();
    const base: Baseline = new Map();
    applyOverlay(beats, { b1: { recall: { leftLabel: "그때는" } } }, base);
    applyOverlay(beats, {}, base);
    expect(beats[0]!.recall).toBeUndefined();
  });
});
