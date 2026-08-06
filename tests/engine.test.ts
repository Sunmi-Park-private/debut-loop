// tests/engine.test.ts — 회귀 루프 엔진 코어 유닛 (Lv.6)
import { describe, it, expect } from "vitest";
import { createState, applyEffect, triggerRegression, MEMORY_FLAG_PREFIX } from "../src/engine/state";
import { pickNextBeat, meets, loopOk, markPlayed } from "../src/engine/router";
import { advance, resolveRunEnd, isFastForward } from "../src/engine/progress";
import { clampGauges, isCollapsed } from "../src/engine/gauges";
import type { GameConfig, Beat } from "../src/engine/types";

// 테스트용 최소 config (JSON import 의존 제거)
const cfg: GameConfig = {
  totalWeeks: 24,
  debutWeek: 24,
  actWeeks: { 0: [0, 0], 1: [1, 4], 2: [5, 10], 3: [11, 18], 4: [19, 23], 5: [24, 24] },
  gaugeMin: 0,
  gaugeMax: 100,
  cluesToBlock: 4,
  difficulties: {
    small: { id: "small", label: "소형", startGauges: { skill: 30, mental: 55, reputation: 20, bond: 40, capital: 20 }, capitalPressurePerWeek: 3 },
    big: { id: "big", label: "대형", startGauges: { skill: 40, mental: 60, reputation: 35, bond: 45, capital: 60 }, capitalPressurePerWeek: 1 },
  },
};

const beat = (id: string, over: Partial<Beat> = {}): Beat => ({
  id, act: 1, textKey: "", left: { label: "", effects: {} }, right: { label: "", effects: {} }, ...over,
});

describe("createState", () => {
  it("소형=고난도 시작 게이지 + 1회차", () => {
    const s = createState(cfg, "small");
    expect(s.gauges.capital).toBe(20);
    expect(s.loopCount).toBe(1);
    expect(s.seenBeats.size).toBe(0);
    expect(s.played.size).toBe(0);
    expect(s.choices).toEqual({});
  });
});

describe("게이지 (gauges)", () => {
  it("clamp: 범위 밖 값 제한", () => {
    const g = { skill: 120, mental: -5, reputation: 50, bond: 40, capital: 20 };
    clampGauges(g, cfg);
    expect(g.skill).toBe(100);
    expect(g.mental).toBe(0);
  });
  it("붕괴 판정: 하나라도 0이면 collapse", () => {
    expect(isCollapsed({ skill: 0, mental: 50, reputation: 50, bond: 50, capital: 50 }, cfg)).toBe(true);
    expect(isCollapsed({ skill: 10, mental: 50, reputation: 50, bond: 50, capital: 50 }, cfg)).toBe(false);
  });
});

describe("applyEffect", () => {
  it("게이지·플래그·단서·포인트 반영 + clamp", () => {
    const s = createState(cfg, "small");
    applyEffect(s, { gauges: { skill: 100 }, flags: ["a"], addClue: "clue_x", points: 2 }, cfg);
    expect(s.gauges.skill).toBe(100); // 30+100 → clamp 100
    expect(s.flags.has("a")).toBe(true);
    expect(s.clues.has("clue_x")).toBe(true);
    expect(s.points).toBe(2);
  });
});

describe("회차 필터 (loopOk)", () => {
  const s1 = createState(cfg, "small");
  it("loop 미지정 = 공통", () => expect(loopOk(beat("x"), s1)).toBe(true));
  it("loop:1 은 1회차만", () => {
    expect(loopOk(beat("x", { loop: 1 }), s1)).toBe(true);
    expect(loopOk(beat("x", { loop: 2 }), s1)).toBe(false);
  });
});

describe("meets (진입조건)", () => {
  it("flags / notFlags", () => {
    const s = createState(cfg, "small");
    s.flags.add("have");
    expect(meets(s, { flags: ["have"] })).toBe(true);
    expect(meets(s, { flags: ["missing"] })).toBe(false);
    expect(meets(s, { notFlags: ["have"] })).toBe(false);
    expect(meets(s, { notFlags: ["other"] })).toBe(true);
  });
  it("gauge 범위", () => {
    const s = createState(cfg, "small"); // capital 20
    expect(meets(s, { gauge: { capital: [10, 30] } })).toBe(true);
    expect(meets(s, { gauge: { capital: [50, 100] } })).toBe(false);
  });
});

describe("pickNextBeat (회차별 노출)", () => {
  const beats: Beat[] = [beat("common"), beat("obs", { loop: 1 }), beat("catch", { loop: 2 })];

  it("1회차: 공통 + loop1, loop2 스킵", () => {
    const s = createState(cfg, "small");
    expect(pickNextBeat(beats, s, 0).beat?.id).toBe("common");
    s.played.add("common");
    expect(pickNextBeat(beats, s, 0).beat?.id).toBe("obs");
    s.played.add("obs");
    expect(pickNextBeat(beats, s, 0).beat).toBeNull(); // catch(loop2) 안 나옴
  });

  it("2회차: 공통 + loop2, loop1 스킵", () => {
    const s = createState(cfg, "small");
    s.loopCount = 2;
    s.played.add("common");
    expect(pickNextBeat(beats, s, 0).beat?.id).toBe("catch");
  });
});

describe("triggerRegression (1→2회차)", () => {
  it("기시감 계승 · 단서/게이지/일반플래그 리셋 · seen 누적", () => {
    const s = createState(cfg, "small");
    s.flags.add(MEMORY_FLAG_PREFIX + "stage"); // 기시감
    s.flags.add("trust_staff"); // 일반
    s.clues.add("clue_schedule");
    s.gauges.skill = 90;
    s.played.add("common");

    const n = triggerRegression(s, cfg, "small");
    expect(n.loopCount).toBe(2);
    expect(n.flags.has(MEMORY_FLAG_PREFIX + "stage")).toBe(true); // 계승
    expect(n.flags.has("trust_staff")).toBe(false); // 리셋
    expect(n.clues.size).toBe(0); // 단서 리셋
    expect(n.gauges.skill).toBe(30); // 게이지 리셋
    expect(n.seenBeats.has("common")).toBe(true); // seen 누적
  });
});

describe("선택 기록 계승 (choices)", () => {
  it("회귀 시 choices가 그대로 계승된다", () => {
    const s = createState(cfg, "small");
    s.choices["common"] = "right";
    s.played.add("common");
    const n = triggerRegression(s, cfg, "small");
    expect(n.choices["common"]).toBe("right");
  });
});

describe("회귀 가속 (seen)", () => {
  it("2회차에서 이전 회차 본 비트는 seen=true", () => {
    const s = createState(cfg, "small");
    s.played.add("common");
    const n = triggerRegression(s, cfg, "small");
    const r = pickNextBeat([beat("common")], n, 0);
    expect(r.beat?.id).toBe("common");
    expect(r.seen).toBe(true);
  });
});

describe("회귀 가속 판정 (isFastForward · 빠른 수동 넘김)", () => {
  it("2회차 seen 비트만 가속 대상", () => {
    const s1 = createState(cfg, "small");
    expect(isFastForward(s1, true)).toBe(false);  // 1회차는 가속 안 함
    const s2 = createState(cfg, "small");
    s2.loopCount = 2;
    expect(isFastForward(s2, true)).toBe(true);    // 2회차 + seen → 축약·빠른 넘김
    expect(isFastForward(s2, false)).toBe(false);  // 2회차 새 비트(포착) → 정독
  });
});

describe("결말 고정 (resolveRunEnd)", () => {
  it("1회차 종료 → regress, 2회차 종료 → true", () => {
    const s1 = createState(cfg, "small");
    expect(resolveRunEnd(s1)).toEqual({ type: "regress" });
    const s2 = createState(cfg, "small");
    s2.loopCount = 2;
    expect(resolveRunEnd(s2)).toEqual({ type: "ending", kind: "true" });
  });
});

describe("회귀 배선 통합 시뮬 (1회차 사고→회귀→2회차 트루)", () => {
  it("1회차는 loop2 비트 못 봐 소진→회귀, 2회차는 트루로 완주", () => {
    const beats: Beat[] = [beat("prologue"), beat("obs", { loop: 1 }), beat("catch", { loop: 2 })];
    let s = createState(cfg, "small");

    // --- 1회차 진행 ---
    let r = advance(beats, s, 0, cfg);
    expect(r.event.type).toBe("beat");
    if (r.event.type === "beat") { markPlayed(s, r.event.beat.id); expect(r.event.beat.id).toBe("prologue"); }

    r = advance(beats, s, 0, cfg);
    expect(r.event.type).toBe("beat");
    if (r.event.type === "beat") { markPlayed(s, r.event.beat.id); expect(r.event.beat.id).toBe("obs"); }

    // catch(loop2) 못 봄 → 비트 소진 → 회귀
    r = advance(beats, s, 0, cfg);
    expect(r.event).toEqual({ type: "regress" });

    // --- 회귀 → 2회차 ---
    s = triggerRegression(s, cfg, "small");
    expect(s.loopCount).toBe(2);

    // prologue는 seen(가속), catch(loop2) 이제 등장
    r = advance(beats, s, 0, cfg);
    expect(r.event.type).toBe("beat");
    if (r.event.type === "beat") { expect(r.event.beat.id).toBe("prologue"); expect(r.event.seen).toBe(true); markPlayed(s, "prologue"); }

    r = advance(beats, s, 0, cfg);
    expect(r.event.type).toBe("beat");
    if (r.event.type === "beat") { expect(r.event.beat.id).toBe("catch"); markPlayed(s, "catch"); }

    // 소진 → 2회차는 무조건 트루
    r = advance(beats, s, 0, cfg);
    expect(r.event).toEqual({ type: "ending", kind: "true" });
  });
});
