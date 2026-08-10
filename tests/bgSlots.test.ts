// tests/bgSlots.test.ts — 배경 슬롯 선택 규칙 (Lv.6)
import { describe, it, expect } from "vitest";
import { pickBgSlot, systemBgFile, bgManifest, type BgSlot } from "../src/ui/bgSlots";

const story: BgSlot[] = [
  { id: "p1", label: "", file: "a.png", beatIds: ["b_dis"] },
  { id: "p2", label: "", file: "b.png", beatIds: ["b_rew", "b_rew2"] },
  { id: "a1", label: "", file: "c.png", act: 1 },
  { id: "a3", label: "", file: "d.png", act: 3 },
];

describe("pickBgSlot", () => {
  it("beatId 일치 슬롯 우선 (act보다)", () => {
    expect(pickBgSlot({ id: "b_rew2", act: 3 }, story)?.id).toBe("p2");
  });
  it("beatId 미일치 → act 이하 최대 슬롯", () => {
    expect(pickBgSlot({ id: "x", act: 2 }, story)?.id).toBe("a1");
    expect(pickBgSlot({ id: "x", act: 4 }, story)?.id).toBe("a3");
  });
  it("프롤로그(act 0) 비트가 beatId에 없으면 null → 기본 배경 폴백", () => {
    expect(pickBgSlot({ id: "b_staff", act: 0 }, story)).toBeNull();
  });
});

describe("bgManifest / systemBgFile", () => {
  it("실데이터: 슬롯 17개 · title/loading·audition·training 시스템 파일", () => {
    // +1: W0 프롤로그 공통 (2026-08-03) / −1: prologue-02를 prologue-01로 통합 (2026-08-07)
    // +1: 트루 엔딩 영상 (2026-08-10)
    expect(bgManifest.story.length + bgManifest.gates.length + bgManifest.system.length).toBe(17);
    expect(systemBgFile("title")).toBe("assets/bg/title.webp"); // WebP 전환 (2026-08-07)
    expect(systemBgFile("none")).toBeNull();
  });
});
