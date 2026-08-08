// tests/recall.test.ts — 2회차 회상 문구 폴백 규칙
import { describe, it, expect } from "vitest";
import { recallOf, beatsOfLoop, recallIsInherited } from "../src/engine/recall";
import type { Beat } from "../src/engine/types";

const mk = (over: Partial<Beat> = {}): Beat => ({
  id: "b1", act: 1, textKey: "무너지는 무대. 아무도 우리를 보지 않았다.",
  left: { label: "그래도 웃는다", effects: {} },
  right: { label: "고개를 돌린다", effects: {} },
  ...over,
});

describe("recallOf", () => {
  it("회상 문구가 없으면 1회차 값을 그대로", () => {
    const b = mk();
    expect(recallOf(b)).toEqual({
      text: "무너지는 무대. 아무도 우리를 보지 않았다.",
      left: "그래도 웃는다",
      right: "고개를 돌린다",
    });
  });

  it("지정한 항목만 갈아끼운다", () => {
    const b = mk({ recall: { textKey: "그날의 무대가 다시 무너진다." } });
    const r = recallOf(b);
    expect(r.text).toBe("그날의 무대가 다시 무너진다.");
    expect(r.left).toBe("그래도 웃는다");   // 미지정 → 1회차
  });

  it("빈 문자열·공백은 지정 안 함으로 본다 (대사가 사라지지 않게)", () => {
    const b = mk({ recall: { textKey: "", leftLabel: "   " } });
    const r = recallOf(b);
    expect(r.text).toBe("무너지는 무대. 아무도 우리를 보지 않았다.");
    expect(r.left).toBe("그래도 웃는다");
  });

  it("40자를 넘겨도 자르지 않는다", () => {
    const long = "가".repeat(80);
    expect(recallOf(mk({ textKey: long })).text).toBe(long);
    expect(recallOf(mk({ recall: { textKey: long } })).text).toBe(long);
  });

  it("좌·우 라벨도 따로 갈아끼운다", () => {
    const b = mk({ recall: { leftLabel: "그때도 웃었다", rightLabel: "그때는 돌렸다" } });
    const r = recallOf(b);
    expect(r.left).toBe("그때도 웃었다");
    expect(r.right).toBe("그때는 돌렸다");
    expect(r.text).toBe("무너지는 무대. 아무도 우리를 보지 않았다.");
  });
});

describe("beatsOfLoop", () => {
  const beats = [
    mk({ id: "common" }),
    mk({ id: "only1", loop: 1 }),
    mk({ id: "only2", loop: 2 }),
  ];
  it("1회차 = 공통 + loop:1", () => {
    expect(beatsOfLoop(beats, 1).map((b) => b.id)).toEqual(["common", "only1"]);
  });
  it("2회차 = 공통 + loop:2", () => {
    expect(beatsOfLoop(beats, 2).map((b) => b.id)).toEqual(["common", "only2"]);
  });
  it("원본 순서를 유지한다", () => {
    expect(beatsOfLoop(beats, 2)[0]?.id).toBe("common");
  });
});

describe("recallIsInherited", () => {
  it("회상 문구가 없으면 true", () => {
    expect(recallIsInherited(mk())).toBe(true);
  });
  it("빈 문자열만 있어도 true", () => {
    expect(recallIsInherited(mk({ recall: { textKey: "" } }))).toBe(true);
  });
  it("한 항목이라도 다르면 false", () => {
    expect(recallIsInherited(mk({ recall: { rightLabel: "다른 말" } }))).toBe(false);
  });
  it("1회차와 똑같은 문구를 적어 넣었으면 true", () => {
    expect(recallIsInherited(mk({ recall: { textKey: "무너지는 무대. 아무도 우리를 보지 않았다." } }))).toBe(true);
  });
});
