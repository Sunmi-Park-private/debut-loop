// tests/minigames.test.ts — 미니게임 판정 엔진 유닛 (Lv.6)
import { describe, it, expect } from "vitest";
import {
  MATCH_CARDS, STOP_ROUNDS,
  rpsBeats, rpsGrade, stopZone, stopGrade, matchGrade, buildMatchDeck, gateReward,
} from "../src/engine/minigames";
import type { GateDef } from "../src/engine/types";

describe("스케일 상수 (§5.7)", () => {
  it("match 카드 수: 1·2막 6장(2×3) · 3~5막 9장(3×3) — 그리드 2종", () => {
    expect(MATCH_CARDS[1]).toBe(6);
    expect(MATCH_CARDS[2]).toBe(6);
    expect(MATCH_CARDS[3]).toBe(9);
    expect(MATCH_CARDS[4]).toBe(9);
    expect(MATCH_CARDS[5]).toBe(9);
  });
  it("STOP 횟수: 1/2/3/4", () => {
    expect(STOP_ROUNDS[1]).toBe(1);
    expect(STOP_ROUNDS[4]).toBe(4);
  });
});

describe("rps (가위바위포즈, 3판 2선)", () => {
  it("승패: 바위>가위, 보>바위, 가위>보", () => {
    expect(rpsBeats(0, 2)).toBe(true);  // 바위>가위
    expect(rpsBeats(1, 0)).toBe(true);  // 보>바위
    expect(rpsBeats(2, 1)).toBe(true);  // 가위>보
    expect(rpsBeats(0, 1)).toBe(false);
  });
  it("등급: 3승=perfect, 2승=good, 1승 이하=실패(null)", () => {
    expect(rpsGrade(3)).toBe("perfect");
    expect(rpsGrade(2)).toBe("good");
    expect(rpsGrade(1)).toBeNull();
  });
});

describe("stop (타이밍)", () => {
  it("존 판정: ≤6 perfect, ≤18 good, 그 외 miss", () => {
    expect(stopZone(6)).toBe("perfect");
    expect(stopZone(18)).toBe("good");
    expect(stopZone(19)).toBe("miss");
  });
  it("다회전 등급: miss 있으면 실패(null), 전부 perfect=perfect, 그 외 good", () => {
    expect(stopGrade(["perfect", "perfect"])).toBe("perfect");
    expect(stopGrade(["perfect", "good"])).toBe("good");
    expect(stopGrade(["good", "miss"])).toBeNull();
  });
});

describe("match (짝맞추기)", () => {
  it("등급: 틀림 0=perfect, ≤2=good, 그 외 clear (실패 없음)", () => {
    expect(matchGrade(0)).toBe("perfect");
    expect(matchGrade(2)).toBe("good");
    expect(matchGrade(3)).toBe("clear");
  });
  it("덱 생성: 짝수=쌍, 홀수=쌍+조커 1장", () => {
    const rand = (): number => 0.5;
    const even = buildMatchDeck(6, ["A", "B", "C", "D"], rand);
    expect(even.length).toBe(6);
    expect(even.filter((s) => s === "🃏").length).toBe(0);
    const odd = buildMatchDeck(9, ["A", "B", "C", "D"], rand); // 4쌍+조커
    expect(odd.length).toBe(9);
    expect(odd.filter((s) => s === "🃏").length).toBe(1);
    // 조커 제외 전부 쌍
    const counts = new Map<string, number>();
    odd.filter((s) => s !== "🃏").forEach((s) => counts.set(s, (counts.get(s) ?? 0) + 1));
    for (const n of counts.values()) expect(n).toBe(2);
  });
});

describe("gateReward (등급 배율 §5.5)", () => {
  const gate: GateDef = {
    id: "act2", trigger: { act: 2 }, engine: "rhythm", name: "센터 대결",
    ticket: "audition_pass", gauges: { skill: 4, reputation: 4 },
  };
  it("perfect ×1.5 반올림, points 3", () => {
    expect(gateReward(gate, "perfect")).toEqual({ gauges: { skill: 6, reputation: 6 }, points: 3 });
  });
  it("good ×1.0, points 2", () => {
    expect(gateReward(gate, "good")).toEqual({ gauges: { skill: 4, reputation: 4 }, points: 2 });
  });
  it("clear ×0.6 최소 1 보장, points 1", () => {
    expect(gateReward(gate, "clear")).toEqual({ gauges: { skill: 2, reputation: 2 }, points: 1 });
  });
});

// ── 스테이지 게임 판정 (슬롯·리듬·격자 회피) ──
import {
  SLOT_SPINS, slotGrade,
  RHYTHM_NOTE_IV, rhythmJudge, rhythmGrade,
  DODGE_P_HEARTS, DODGE_SECOND_TILE, dodgePickTile, dodgeGrade,
} from "../src/engine/minigames";

describe("slot (3릴, 심볼 3종·와일드 없음)", () => {
  it("등급: 3일치=perfect, 2일치=good, 그외=clear (꽝 없음)", () => {
    expect(slotGrade(0, 0, 0)).toBe("perfect");
    expect(slotGrade(2, 2, 2)).toBe("perfect");
    expect(slotGrade(0, 0, 1)).toBe("good");
    expect(slotGrade(1, 0, 1)).toBe("good");  // 양끝 일치
    expect(slotGrade(0, 1, 2)).toBe("clear");
  });
  it("스핀 3회 상수", () => expect(SLOT_SPINS).toBe(3));
});

describe("rhythm (좌우 2레인 낙하 20초)", () => {
  it("판정창: ≤80ms perfect / ≤180ms good / 그외 null(허공)", () => {
    expect(rhythmJudge(0)).toBe("perfect");
    expect(rhythmJudge(-80)).toBe("perfect");
    expect(rhythmJudge(81)).toBe("good");
    expect(rhythmJudge(-180)).toBe("good");
    expect(rhythmJudge(181)).toBeNull();
  });
  it("판정창 프리셋: 후함이면 같은 오차가 상위 판정", () => {
    expect(rhythmJudge(100)).toBe("good");                 // 보통: ±80 밖
    expect(rhythmJudge(100, 120, 240)).toBe("perfect");    // 후함: ±120 안
    expect(rhythmJudge(230, 120, 240)).toBe("good");
    expect(rhythmJudge(260, 120, 240)).toBeNull();
    expect(rhythmJudge(100, 50, 120)).toBe("good");        // 정밀: perfect 창 축소
    expect(rhythmJudge(130, 50, 120)).toBeNull();
  });
  it("등급: 성공률 ≥80% perfect / ≥50% good / 그외 clear", () => {
    expect(rhythmGrade(20, 0, 24)).toBe("perfect"); // 83%
    expect(rhythmGrade(6, 6, 24)).toBe("good");     // 50%
    expect(rhythmGrade(5, 6, 24)).toBe("clear");    // 46%
    expect(rhythmGrade(0, 0, 0)).toBe("clear");     // 빈 판 방어
  });
  it("노트 간격 막 스케일: 1→2막 800ms, 2→3막 640ms", () => {
    expect(RHYTHM_NOTE_IV[2]).toBe(800);
    expect(RHYTHM_NOTE_IV[3]).toBe(640);
  });
});

describe("dodge (격자 회피, 턴제·대기 없음)", () => {
  it("등급: 하트 5=perfect / 3-4=good / 1-2=clear / 0=실패(null)", () => {
    expect(dodgeGrade(DODGE_P_HEARTS)).toBe("perfect");
    expect(dodgeGrade(4)).toBe("good");
    expect(dodgeGrade(3)).toBe("good");
    expect(dodgeGrade(2)).toBe("clear");
    expect(dodgeGrade(1)).toBe("clear");
    expect(dodgeGrade(0)).toBeNull();
  });
  it("스폰 가중치 경계: 0→bomb, 0.79→atk, 0.91→heal, 0.99→shield", () => {
    expect(dodgePickTile(0)).toBe("bomb");
    expect(dodgePickTile(0.51)).toBe("bomb");
    expect(dodgePickTile(0.79)).toBe("atk");
    expect(dodgePickTile(0.91)).toBe("heal");
    expect(dodgePickTile(0.99)).toBe("shield");
  });
  it("막 스케일: 2번째 타일 확률 4막 0.45 / 5막 0.6", () => {
    expect(DODGE_SECOND_TILE[4]).toBe(0.45);
    expect(DODGE_SECOND_TILE[5]).toBe(0.6);
  });
});
