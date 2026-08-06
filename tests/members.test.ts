// tests/members.test.ts — 오디션 멤버 영입·교체·락인 엔진 유닛 (Lv.6)
import { describe, it, expect } from "vitest";
import { createState, applyEffect, triggerRegression, DEFAULT_TUNING } from "../src/engine/state";
import {
  candidatePool, recruit, release, lockIn, applyGateStat, applyTrainingStat, dropCandidate,
  FIXED_MEMBERS, PHOTO_BEATS, AUDITION_STAT, GATE_STAT_DELTA, LOCK_WEEK,
} from "../src/engine/members";
import type { GameConfig, CharacterDef, State } from "../src/engine/types";

const cfg: GameConfig = {
  totalWeeks: 24, debutWeek: 24,
  actWeeks: { 1: [1, 4], 2: [5, 10], 3: [11, 17], 4: [18, 23], 5: [24, 24] },
  gaugeMin: 0, gaugeMax: 100, cluesToBlock: 4,
  difficulties: {
    small: { id: "small", label: "소형", startGauges: { skill: 30, mental: 60, reputation: 20, bond: 40, capital: 30 }, capitalPressurePerWeek: 3 },
    big: { id: "big", label: "대형", startGauges: { skill: 40, mental: 70, reputation: 40, bond: 50, capital: 60 }, capitalPressurePerWeek: 1 },
  },
};

const CHARS: CharacterDef[] = [
  { id: "haru", name: "하루", color: "#4B4BE0", eligibleRoles: ["protagonist"] },
  { id: "yuwol", name: "유월", color: "#C0C0C8", eligibleRoles: ["helper", "rival"] },
  { id: "cyan", name: "시안", color: "#1FB6B6", eligibleRoles: ["helper2", "fan"] },
  { id: "hari", name: "하리", color: "#E6C34D", eligibleRoles: ["mentor", "helper"] },
  { id: "bora", name: "보라", color: "#B79CE0", eligibleRoles: ["helper"] },
  { id: "staff_jung", name: "정 실장", color: "#8A8F98", eligibleRoles: ["antiStaff"] },
  { id: "rian", name: "리안", color: "#7FBFD6", eligibleRoles: ["helper2", "mentor"], temp: true },
  { id: "daon", name: "다온", color: "#D6A57F", eligibleRoles: ["helper2", "mentor"], temp: true },
];

const cyan = CHARS[2]!;
const hari = CHARS[3]!;
const rian = CHARS[6]!;
const daon = CHARS[7]!;

const fresh = (): State => createState(cfg, "small");
const withTeam = (): State => {
  // 유월·보라 스토리 합류 상태 재현
  const s = fresh();
  applyEffect(s, { joinMember: { characterId: "yuwol", role: "helper", stat: 70 } }, cfg);
  s.week = 3;
  applyEffect(s, { joinMember: { characterId: "bora", role: "helper", stat: 60 } }, cfg);
  return s;
};

describe("멤버 초기화·합류 효과", () => {
  it("새 런은 하루 1인(stat 65)으로 시작한다", () => {
    const s = fresh();
    expect(s.members).toHaveLength(1);
    expect(s.members[0]).toMatchObject({ characterId: "haru", stat: 65 });
    expect(s.membersLocked).toBe(false);
  });
  it("joinMember 효과는 joinedWeek를 현재 주로 기록하고 중복 합류를 막는다", () => {
    const s = withTeam();
    expect(s.members.map((m) => m.characterId)).toEqual(["haru", "yuwol", "bora"]);
    expect(s.members[2]?.joinedWeek).toBe(3);
    applyEffect(s, { joinMember: { characterId: "yuwol", role: "helper", stat: 70 } }, cfg);
    expect(s.members).toHaveLength(3);
  });
  it("memberStat 효과는 해당 멤버 기량을 clamp 내에서 증감한다", () => {
    const s = withTeam();
    applyEffect(s, { memberStat: { bora: 20 } }, cfg);
    expect(s.members.find((m) => m.characterId === "bora")?.stat).toBe(80);
    applyEffect(s, { memberStat: { bora: 999 } }, cfg);
    expect(s.members.find((m) => m.characterId === "bora")?.stat).toBe(100);
  });
});

describe("candidatePool", () => {
  it("helper2·mentor 적합 비멤버만, 등장 순서(하리→시안→리안→다온)로 반환한다", () => {
    const s = withTeam();
    expect(candidatePool(CHARS, s).map((c) => c.id)).toEqual(["hari", "cyan", "rian", "daon"]);
  });
  it("영입된 후보는 풀에서 빠진다", () => {
    const s = withTeam();
    recruit(s, cyan, 80);
    expect(candidatePool(CHARS, s).map((c) => c.id)).toEqual(["hari", "rian", "daon"]);
  });
});

describe("recruit / release", () => {
  it("영입은 미캐스팅 첫 적합 role 배정 + casting + cast_* 플래그를 세운다", () => {
    const s = withTeam();
    recruit(s, cyan, 80);
    expect(s.members[s.members.length - 1]).toMatchObject({ characterId: "cyan", role: "helper2", stat: 80 });
    expect(s.casting.helper2).toBe("cyan");
    expect(s.flags.has("cast_cyan")).toBe(true);
    expect(s.flags.has("cast_role_helper2")).toBe(true);
  });
  it("helper2가 차 있으면 임시 후보는 mentor로 배정된다", () => {
    const s = withTeam();
    recruit(s, rian, 65);
    recruit(s, daon, 50);
    expect(s.members[s.members.length - 2]?.role).toBe("helper2");
    expect(s.members[s.members.length - 1]?.role).toBe("mentor");
    expect(s.casting.mentor).toBe("daon");
  });
  it("방출은 오디션 슬롯만 가능하고 casting·플래그를 원복한다", () => {
    const s = withTeam();
    recruit(s, cyan, 80);
    release(s, "cyan");
    expect(s.members.some((m) => m.characterId === "cyan")).toBe(false);
    expect(s.casting.helper2).toBeUndefined();
    expect(s.flags.has("cast_cyan")).toBe(false);
    expect(s.flags.has("cast_role_helper2")).toBe(false);
    release(s, "yuwol"); // 고정 멤버 — 무시
    expect(s.members.some((m) => m.characterId === "yuwol")).toBe(true);
  });
  it("만석(5인)·락인 상태에선 영입이 무시된다", () => {
    const s = withTeam();
    recruit(s, cyan, 80);
    recruit(s, hari, 65);
    recruit(s, rian, 90); // 6번째 — 무시
    expect(s.members).toHaveLength(5);
    release(s, "cyan");
    s.membersLocked = true;
    recruit(s, rian, 90); // 락인 — 무시
    expect(s.members.some((m) => m.characterId === "rian")).toBe(false);
  });
});

describe("lockIn (W18 자동충원)", () => {
  it("빈 슬롯을 잔여 후보 최고 기량으로 채우고 잠근다", () => {
    const s = withTeam();
    s.candidateStats = { cyan: 55, hari: 85, rian: 70 };
    lockIn(s, CHARS);
    expect(s.members).toHaveLength(5);
    expect(s.membersLocked).toBe(true);
    const ids = s.members.map((m) => m.characterId);
    expect(ids).toContain("hari"); // 85
    expect(ids).toContain("rian"); // 70
    expect(ids).not.toContain("daon"); // 미기록 → 기본 50, 탈락
  });
  it("오디션 기록이 없으면 기본 50으로 취급해 채운다", () => {
    const s = withTeam();
    lockIn(s, CHARS);
    expect(s.members).toHaveLength(5);
    expect(s.membersLocked).toBe(true);
  });
});

describe("기량 변동", () => {
  it("막 관문 성적은 전원에 P+5/G+2/C−3, clamp 0~100", () => {
    const s = withTeam();
    applyGateStat(s, "perfect");
    expect(s.members.map((m) => m.stat)).toEqual([70, 75, 65]);
    for (let i = 0; i < 40; i++) applyGateStat(s, "clear");
    expect(s.members.every((m) => m.stat >= 0)).toBe(true);
    expect(Math.min(...s.members.map((m) => m.stat))).toBe(0);
  });
  it("연습은 perfect만 전원 +1", () => {
    const s = withTeam();
    applyTrainingStat(s, "good");
    expect(s.members[0]?.stat).toBe(65);
    applyTrainingStat(s, "perfect");
    expect(s.members[0]?.stat).toBe(66);
  });
});

describe("회귀·상수", () => {
  it("회귀 시 멤버·락·후보 기록이 리셋된다", () => {
    const s = withTeam();
    recruit(s, cyan, 80);
    s.membersLocked = true;
    s.candidateStats = { hari: 85 };
    const next = triggerRegression(s, cfg, "small", DEFAULT_TUNING);
    expect(next.members).toHaveLength(1);
    expect(next.membersLocked).toBe(false);
    expect(next.candidateStats).toEqual({});
  });
  it("상수 계약: 고정 멤버·📷 비트·기량 테이블", () => {
    expect([...FIXED_MEMBERS].sort()).toEqual(["bora", "haru", "yuwol"]);
    expect([...PHOTO_BEATS]).toEqual(["d2_w3_eval1", "d2_w7_eval2", "d2_w12_meme", "d2_w17_fancam"]);
    expect(AUDITION_STAT).toEqual({ perfect: 80, good: 65, clear: 50 });
    expect(GATE_STAT_DELTA).toEqual({ perfect: 5, good: 2, clear: -3 });
    expect(LOCK_WEEK).toBe(18);
  });
});

describe("보류 후보 버리기 (dropCandidate)", () => {
  it("버린 후보는 풀·자동충원에서 제외되고 회귀 시 복귀한다", () => {
    const s = withTeam();
    dropCandidate(s, "cyan");
    expect(candidatePool(CHARS, s).map((c) => c.id)).toEqual(["hari", "rian", "daon"]);
    s.candidateStats = { cyan: 99 };
    lockIn(s, CHARS);
    expect(s.members.map((m) => m.characterId)).not.toContain("cyan"); // 기량 99여도 제외
    const next = triggerRegression(s, cfg, "small", DEFAULT_TUNING);
    expect(next.droppedCandidates.size).toBe(0);
  });
  it("현재 멤버는 버리기 대상이 아니다 (방출 경유)", () => {
    const s = withTeam();
    recruit(s, cyan, 80);
    dropCandidate(s, "cyan");
    expect(s.droppedCandidates.has("cyan")).toBe(false);
    expect(s.members.some((m) => m.characterId === "cyan")).toBe(true);
  });
});
