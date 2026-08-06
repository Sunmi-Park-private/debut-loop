// tests/data.test.ts — demo2 데이터 무결성 + 회차 시뮬레이션 (Lv.7 성격)
import { describe, it, expect } from "vitest";
import { beats, config } from "../src/data";
import { createRunController } from "../src/ui/runController";

describe("demo2 데이터 스키마 (Effect 계약 준수)", () => {
  const GAUGE_KEYS = new Set(["skill", "mental", "reputation", "bond", "capital"]);
  const EFFECT_KEYS = new Set(["gauges", "flags", "clearFlags", "grantTickets", "consumeTickets", "addClue", "points", "joinMember", "memberStat"]);

  it("effects에 평탄화된 게이지 키 금지 — 반드시 gauges 래퍼 안에", () => {
    for (const b of beats) {
      for (const side of ["left", "right"] as const) {
        const eff = b[side].effects as Record<string, unknown>;
        for (const k of Object.keys(eff)) {
          expect(GAUGE_KEYS.has(k), `${b.id}.${side}.effects.${k} — 게이지는 gauges:{} 안에!`).toBe(false);
          expect(EFFECT_KEYS.has(k), `${b.id}.${side}.effects.${k} — 알 수 없는 Effect 키`).toBe(true);
        }
        const g = eff["gauges"] as Record<string, unknown> | undefined;
        if (g) for (const k of Object.keys(g))
          expect(GAUGE_KEYS.has(k), `${b.id}.${side}.gauges.${k} — 게이지 아님`).toBe(true);
      }
    }
  });

  it("스와이프 진행 시 게이지가 실제로 변한다 (회귀 방지)", () => {
    const c = createRunController(beats, config, "small");
    const before = JSON.stringify(c.state.gauges);
    for (let i = 0; i < 5 && c.current; i++) c.choose("left");
    expect(JSON.stringify(c.state.gauges)).not.toBe(before);
  });
});

describe("demo2 데이터", () => {
  it("loop:2 태깅 — 단서·저지·트루", () => {
    const l2 = beats.filter((b) => b.loop === 2).map((b) => b.id);
    for (const id of ["d2_w4_clue1", "d2_w8_clue2", "d2_w13_clue3", "d2_w22_clue4", "d2_w24_block", "d2_w24_true"])
      expect(l2).toContain(id);
  });
  it("1회차 시뮬(좌만 선택) → 단서 0 + regress", () => {
    const c = createRunController(beats, config, "small");
    for (let i = 0; i < 200 && c.current; i++) c.choose("left");
    expect(c.state.clues.size).toBe(0);         // 관찰만 — 포착 불가
    expect(c.ended).toEqual({ type: "regress" });
  });
  it("2회차 시뮬(좌만 선택) → 단서 4 + 트루", () => {
    const c = createRunController(beats, config, "small");
    for (let i = 0; i < 200 && c.current; i++) c.choose("left");
    c.regress();
    for (let i = 0; i < 200 && c.current; i++) c.choose("left");
    expect(c.state.clues.size).toBe(4);
    expect(c.ended).toEqual({ type: "ending", kind: "true" });
  });
});
