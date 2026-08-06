// tests/runController.test.ts — RunController 유닛 (S0, Lv.6)
import { describe, it, expect } from "vitest";
import { createRunController } from "../src/ui/runController";
import { DEFAULT_TUNING } from "../src/engine/state";
import type { GameConfig, Beat, GateDef } from "../src/engine/types";

const cfg: GameConfig = {
  totalWeeks: 24, debutWeek: 24,
  actWeeks: { 0: [0, 0], 1: [1, 4], 2: [5, 10], 3: [11, 18], 4: [19, 23], 5: [24, 24] },
  gaugeMin: 0, gaugeMax: 100, cluesToBlock: 4,
  difficulties: {
    small: { id: "small", label: "소형", startGauges: { skill: 30, mental: 55, reputation: 20, bond: 40, capital: 20 }, capitalPressurePerWeek: 3 },
    big: { id: "big", label: "대형", startGauges: { skill: 40, mental: 60, reputation: 35, bond: 45, capital: 60 }, capitalPressurePerWeek: 1 },
  },
};
const beats: Beat[] = [
  { id: "a", act: 1, textKey: "첫 비트", left: { label: "L", effects: { gauges: { skill: 5 } } }, right: { label: "R", effects: { gauges: { mental: -3 } } } },
  { id: "b", act: 1, textKey: "둘째", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
];

describe("RunController", () => {
  it("생성 시 첫 비트를 current로", () => {
    const c = createRunController(beats, cfg, "small");
    expect(c.current?.id).toBe("a");
    expect(c.state.gauges.skill).toBe(30);
  });
  it("choose(left) → 효과 적용 + 다음 비트로", () => {
    const c = createRunController(beats, cfg, "small");
    c.choose("left");
    expect(c.state.gauges.skill).toBe(35); // 30+5
    expect(c.current?.id).toBe("b");
  });
  it("비트 로드 시 state.week/act 동기화", () => {
    const withWeek: Beat[] = [{ id: "w", act: 2, week: 6, textKey: "", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } }];
    const c = createRunController(withWeek, cfg, "small");
    expect(c.state.act).toBe(2);
    expect(c.state.week).toBe(6);
  });
  it("choose가 선택 방향을 state.choices에 기록한다", () => {
    const c = createRunController(beats, cfg, "small");
    c.choose("right"); // a
    c.choose("left");  // b
    expect(c.state.choices["a"]).toBe("right");
    expect(c.state.choices["b"]).toBe("left");
  });
  it("비트 소진 시 current=null", () => {
    const c = createRunController(beats, cfg, "small");
    c.choose("left");
    c.choose("left");
    expect(c.current).toBeNull();
  });
});

describe("RunController v2 (회귀 배선)", () => {
  const loopBeats: Beat[] = [
    { id: "c1", act: 1, textKey: "공통", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
    { id: "o1", act: 1, loop: 1, textKey: "관찰", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
    { id: "k1", act: 4, loop: 2, textKey: "포착", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
  ];
  it("1회차 소진 → ended=regress", () => {
    const c = createRunController(loopBeats, cfg, "small");
    c.choose("left"); // c1
    c.choose("left"); // o1 (k1은 loop2라 안 나옴)
    expect(c.current).toBeNull();
    expect(c.ended).toEqual({ type: "regress" });
  });
  it("regress() → 2회차 재시작, seen 가속, loop2 등장", () => {
    const c = createRunController(loopBeats, cfg, "small");
    c.choose("left"); c.choose("left");
    c.regress();
    expect(c.state.loopCount).toBe(2);
    expect(c.current?.id).toBe("c1");
    expect(c.seen).toBe(true);          // 이전 회차에 본 비트 → 가속
    c.choose("left");                    // c1 (o1은 loop1이라 skip)
    expect(c.current?.id).toBe("k1");
    expect(c.seen).toBe(false);          // 새 비트 → 정독
  });
  it("2회차 소진 → ended=ending:true (결말 고정)", () => {
    const c = createRunController(loopBeats, cfg, "small");
    c.choose("left"); c.choose("left"); c.regress();
    c.choose("left"); c.choose("left");
    expect(c.ended).toEqual({ type: "ending", kind: "true" });
  });
  it("게이지 붕괴 → ended=ending:dark", () => {
    const crash: Beat[] = [{ id: "x", act: 1, textKey: "", left: { label: "L", effects: { gauges: { mental: -100 } } }, right: { label: "R", effects: {} } }];
    const c2 = createRunController(crash, cfg, "small");
    c2.choose("left");
    expect(c2.ended).toEqual({ type: "ending", kind: "dark" });
  });
});

describe("RunController v4 (연습 배선)", () => {
  const trainBeats: Beat[] = [
    { id: "t1", act: 1, week: 2, training: true, textKey: "연습", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
    { id: "n1", act: 1, textKey: "다음", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
  ];

  it("finishTraining(perfect) → 에픽 카드 + 소모만(상승 없음) + 비트 소진", () => {
    const c = createRunController(trainBeats, cfg, "small");
    expect(c.current?.training).toBe(true);
    const m0 = c.state.gauges.mental;
    const s0 = c.state.gauges.skill;
    c.finishTraining("vocal", "perfect");
    expect(c.state.cards).toEqual([{ templateId: "vocal", grade: "epic" }]);
    expect(c.state.gauges.mental).toBe(m0 - 3); // drain
    expect(c.state.gauges.skill).toBe(s0);      // 상승 없음
    expect(c.current?.id).toBe("n1");           // 진행
  });

  it("finishTraining(clear) → 카드 없음, 소모만", () => {
    const c = createRunController(trainBeats, cfg, "small");
    c.finishTraining("vocal", "clear");
    expect(c.state.cards).toEqual([]);
    expect(c.current?.id).toBe("n1");
  });

  it("skipTraining → 소모·카드 없이 진행", () => {
    const c = createRunController(trainBeats, cfg, "small");
    const m0 = c.state.gauges.mental;
    c.skipTraining();
    expect(c.state.cards).toEqual([]);
    expect(c.state.gauges.mental).toBe(m0);
    expect(c.current?.id).toBe("n1");
  });

  it("trainFree(자유 연습) → 카드+소모, 비트 진행 없음", () => {
    const c = createRunController(trainBeats, cfg, "small");
    c.skipTraining(); // n1 카드 상태에서
    const cur = c.current?.id;
    c.trainFree("bond", "good");
    expect(c.state.cards).toEqual([{ templateId: "bond", grade: "rare" }]);
    expect(c.current?.id).toBe(cur); // 비트 그대로
  });

  it("회귀 시 카드 계승 — cardCarryOver 개수 (데이브 더 다이버식)", () => {
    const only: Beat[] = [{ id: "x", act: 1, textKey: "", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } }];
    const c = createRunController(only, cfg, "small", [], { ...DEFAULT_TUNING, cardCarryOver: 2 });
    c.trainFree("vocal", "perfect");
    c.trainFree("dance", "good");
    c.trainFree("promo", "good");
    c.trainFree("funds", "good");
    c.choose("left"); // 소진 → regress
    c.regress();
    expect(c.state.cards.length).toBe(2); // 4장 중 앞 2장만 계승
  });

  it("회귀 시 카드 계승 — 보유량보다 큰 설정은 전부 계승", () => {
    const only: Beat[] = [{ id: "x", act: 1, textKey: "", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } }];
    const c = createRunController(only, cfg, "small", [], { ...DEFAULT_TUNING, cardCarryOver: 99 });
    c.trainFree("vocal", "perfect");
    c.choose("left");
    c.regress();
    expect(c.state.cards.length).toBe(1); // min(보유 1, 설정 99)
  });
});

describe("RunController v3 (관문 배선)", () => {
  const gateBeats: Beat[] = [
    { id: "a1", act: 1, textKey: "1막", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
    { id: "a2", act: 2, textKey: "2막", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
    { id: "k", act: 4, textKey: "단서", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
  ];
  const gateDefs: GateDef[] = [
    { id: "act2", trigger: { act: 2 }, engine: "rhythm", name: "센터 대결", ticket: "audition_pass", gauges: { skill: 4, reputation: 4 } },
    { id: "clueG", trigger: { beatId: "k" }, engine: "dodge", name: "단서 대조", ticket: "clue_piece", gauges: { mental: 4 } },
  ];

  it("막 경계 진입 시 pendingGate + choose 차단", () => {
    const c = createRunController(gateBeats, cfg, "small", gateDefs);
    expect(c.pendingGate).toBeNull();      // 1막은 관문 없음
    c.choose("left");                       // a1 → a2 진입
    expect(c.pendingGate?.id).toBe("act2");
    const before = c.current?.id;
    c.choose("left");                       // 관문 중 → 차단
    expect(c.current?.id).toBe(before);
  });

  it("resolveGate(등급, 선택카드) → 카드 효과 적용·소모 + 티켓·포인트 + 진행 재개", () => {
    const c = createRunController(gateBeats, cfg, "small", gateDefs);
    c.trainFree("vocal", "good");           // 레어 보컬(skill+8)
    c.trainFree("bond", "perfect");         // 에픽 유대(mental+9, bond+7)
    c.state.gauges.mental = 55;             // trainFree 소모 리셋(테스트 단순화)
    c.choose("left");                       // act2 관문
    const skill0 = c.state.gauges.skill;
    const bond0 = c.state.gauges.bond;
    c.resolveGate("perfect", [0, 1]);       // 퍼펙트=2장 선택
    expect(c.pendingGate).toBeNull();
    expect(c.state.gauges.skill).toBe(skill0 + 8);  // 보컬 rare 6×1.4=8.4→8
    expect(c.state.gauges.bond).toBe(bond0 + 14);   // 유대 epic 8×1.8=14.4→14
    expect(c.state.cards.length).toBe(0);           // 선택 카드 소모
    expect(c.state.deck).toContain("audition_pass");
    expect(c.state.points).toBe(3);
    c.choose("left");                       // a2 → k (비트 관문)
    expect(c.pendingGate?.id).toBe("clueG");
  });

  it("resolveGate — 등급 초과 선택은 허용 장수만 반영(굿=1장)", () => {
    const c = createRunController(gateBeats, cfg, "small", gateDefs);
    c.trainFree("vocal", "good");
    c.trainFree("promo", "good");
    c.state.gauges.mental = 55;
    c.choose("left");
    const rep0 = c.state.gauges.reputation;
    c.resolveGate("good", [0, 1]);          // 굿=1장인데 2장 선택 → 첫 장만
    expect(c.state.gauges.reputation).toBe(rep0);   // promo 미적용
    expect(c.state.cards.length).toBe(1);           // 1장만 소모
  });

  it("resolveGate — 빈 덱(선택 0장)은 티켓·포인트만", () => {
    const c = createRunController(gateBeats, cfg, "small", gateDefs);
    c.choose("left");
    const g0 = JSON.stringify(c.state.gauges);
    c.resolveGate("good", []);
    expect(JSON.stringify(c.state.gauges)).toBe(g0);
    expect(c.state.deck).toContain("audition_pass");
    expect(c.state.points).toBe(2);
  });

  it("skipGate(종료하기) → 보상 없이 관문 통과", () => {
    const c = createRunController(gateBeats, cfg, "small", gateDefs);
    c.choose("left"); // act2 관문
    const skill0 = c.state.gauges.skill;
    c.skipGate();
    expect(c.pendingGate).toBeNull();
    expect(c.state.gauges.skill).toBe(skill0);        // 보상 없음
    expect(c.state.deck).not.toContain("audition_pass");
    const cur = c.current?.id;
    c.choose("left");                                  // 진행 재개됨
    expect(c.current?.id).not.toBe(cur);
  });

  it("retryGate → 멘탈 −1", () => {
    const c = createRunController(gateBeats, cfg, "small", gateDefs);
    c.choose("left");
    const m0 = c.state.gauges.mental;
    c.retryGate();
    expect(c.state.gauges.mental).toBe(m0 - 1);
    expect(c.pendingGate?.id).toBe("act2"); // 여전히 관문 중
  });

  it("회귀 후 관문 재등장 (회차마다 반복)", () => {
    const c = createRunController(gateBeats, cfg, "small", gateDefs);
    c.choose("left"); c.resolveGate("good", []);
    c.choose("left"); c.resolveGate("good", []); // clueG
    c.choose("left");                        // k 소진 → regress
    expect(c.ended).toEqual({ type: "regress" });
    c.regress();
    c.choose("left");                        // 2회차 a1 → a2
    expect(c.pendingGate?.id).toBe("act2");  // 다시 등장
  });
});

describe("RunController v5 (관문 광고 보너스 라운드)", () => {
  const gateBeats: Beat[] = [
    { id: "a1", act: 1, textKey: "1막", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
    { id: "a2", act: 2, textKey: "2막", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
  ];
  const gateDefs: GateDef[] = [
    { id: "act2", trigger: { act: 2 }, engine: "rhythm", name: "센터 대결", ticket: "audition_pass", gauges: { skill: 4, reputation: 4 } },
  ];

  it("settleGateRound — 라운드 즉시 정산: 게이지·⭐ 즉시 적용 + 카드 즉시 소모, 티켓은 finishGate 전까지 없음", () => {
    const c = createRunController(gateBeats, cfg, "small", gateDefs);
    c.trainFree("vocal", "good");           // [0] 레어 보컬 (skill+8)
    c.trainFree("bond", "perfect");         // [1] 에픽 유대 (mental+9, bond+7)
    c.state.gauges.mental = 55;
    c.choose("left");                        // act2 관문
    const skill0 = c.state.gauges.skill;
    const delta = c.settleGateRound("good", [0]);
    expect(delta.skill).toBe(8);
    expect(c.state.gauges.skill).toBe(skill0 + 8); // 라운드 종료 즉시 반영
    expect(c.state.cards.length).toBe(1);          // 사용 카드 즉시 소모
    expect(c.state.points).toBe(2);                // good ⭐도 즉시
    expect(c.state.deck).not.toContain("audition_pass"); // 티켓은 아직
    expect(c.pendingGate).not.toBeNull();          // 관문은 아직 진행 중 (보너스 라운드 가능)
  });

  it("2라운드(광고 보너스) — 라운드별 정산 누적 + finishGate에서 티켓 1회", () => {
    const c = createRunController(gateBeats, cfg, "small", gateDefs);
    c.trainFree("vocal", "good");           // [0] skill+8
    c.trainFree("bond", "perfect");         // [1] mental+9, bond+7
    c.state.gauges.mental = 55;
    c.choose("left");
    const skill0 = c.state.gauges.skill;
    const bond0 = c.state.gauges.bond;
    c.settleGateRound("good", [0]);          // 기본 라운드 — [0] 소모 후 남은 카드가 [0]으로 당겨짐
    c.settleGateRound("good", [0]);          // 광고 보너스 라운드 — 현재 덱 기준 인덱스
    c.finishGate();
    expect(c.state.gauges.skill).toBe(skill0 + 8);
    expect(c.state.gauges.bond).toBe(bond0 + 14);
    expect(c.state.cards.length).toBe(0);
    expect(c.state.deck.filter((t) => t === "audition_pass").length).toBe(1); // 티켓은 1회만
    expect(c.state.points).toBe(4);                                           // good 2 + good 2
    expect(c.pendingGate).toBeNull();
  });

  it("settleGateRound — 등급 초과·중복 인덱스는 허용 장수만 반영", () => {
    const c = createRunController(gateBeats, cfg, "small", gateDefs);
    c.trainFree("vocal", "good");           // [0] skill+8
    c.trainFree("promo", "good");           // [1] 레어 홍보 (reputation)
    c.state.gauges.mental = 55;
    c.choose("left");
    const skill0 = c.state.gauges.skill;
    c.settleGateRound("good", [0, 0, 1]);    // 굿=1장 + 중복 → 첫 장만
    expect(c.state.gauges.skill).toBe(skill0 + 8);
    expect(c.state.cards.length).toBe(1);    // [0]만 소모
  });

  it("resolveGate(단일) — 기존 계약 유지 (settle+finish 위임)", () => {
    const c = createRunController(gateBeats, cfg, "small", gateDefs);
    c.choose("left");
    c.resolveGate("good", []);
    expect(c.state.deck).toContain("audition_pass");
    expect(c.state.points).toBe(2);
    expect(c.pendingGate).toBeNull();
  });
});

describe("RunController v4 (오디션 멤버 배선)", () => {
  const memberBeats: Beat[] = [
    { id: "d2_w3_eval1", act: 1, week: 3, textKey: "📷 평가", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
    { id: "mid", act: 2, week: 10, textKey: "중간", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
    { id: "w18", act: 4, week: 18, textKey: "락인 주", left: { label: "L", effects: {} }, right: { label: "R", effects: {} } },
  ];
  const mk = () => createRunController(memberBeats, cfg, "small");

  it("📷 비트 통과 직후 memberWindowOpen, closeMemberWindow로 닫힌다", () => {
    const c = mk();
    expect(c.memberWindowOpen).toBe(false);
    c.choose("left"); // d2_w3_eval1 통과
    expect(c.memberWindowOpen).toBe(true);
    c.closeMemberWindow();
    expect(c.memberWindowOpen).toBe(false);
  });
  it("week≥18 비트 진입 시 자동충원+락인, 연출용 윈도우 1회", () => {
    const c = mk();
    c.choose("left"); c.closeMemberWindow();
    c.choose("left"); // mid 통과 → w18 진입
    expect(c.state.membersLocked).toBe(true);
    expect(c.state.members).toHaveLength(5);
    expect(c.memberWindowOpen).toBe(true);
  });
  it("교환: 오디션 카드 cost장 → 진행권 (부족 시 false)", () => {
    const c = mk();
    expect(c.auditionExchangeCost).toBe(3);
    expect(c.exchangeAudition()).toBe(false);
    c.state.cards = [
      { templateId: "audition", grade: "common" }, { templateId: "vocal", grade: "rare" },
      { templateId: "audition", grade: "rare" }, { templateId: "audition", grade: "epic" },
    ];
    expect(c.exchangeAudition()).toBe(true);
    expect(c.state.deck).toContain("audition");
    expect(c.state.cards).toEqual([{ templateId: "vocal", grade: "rare" }]);
  });
  it("오디션 개최: 진행권 소모 + 풀 후보·기량 반환, 영입·교체", () => {
    const c = mk();
    expect(c.holdAudition("perfect")).toBeNull(); // 진행권 없음
    c.state.deck.push("audition");
    const r = c.holdAudition("perfect");
    expect(r).not.toBeNull();
    expect(c.state.deck).not.toContain("audition");
    expect(r!.stat).toBeGreaterThanOrEqual(75);
    expect(r!.stat).toBeLessThanOrEqual(85);
    expect(c.state.candidateStats[r!.char.id]).toBe(r!.stat);
    expect(c.recruitCandidate(r!.char.id)).toBe(true);
    expect(c.state.members.some((m) => m.characterId === r!.char.id)).toBe(true);
  });
  it("오디션 후보는 등장 순서대로 나온다 (랜덤 아님 — 하리 → 시안 …)", () => {
    const c = createRunController(memberBeats, cfg, "small", []);
    c.state.deck.push("audition", "audition");
    const first = c.holdAudition("good");
    expect(first?.char.id).toBe("hari"); // AUDITION_ORDER 선두
    expect(c.recruitCandidate(first!.char.id)).toBe(true);
    expect(c.holdAudition("good")?.char.id).toBe("cyan"); // 영입된 하리는 풀에서 빠져 다음 순서
  });
  it("관문 완료 시 성적으로 전원 기량 변동 (1회)", () => {
    const gate: GateDef = { id: "g1", trigger: { act: 1 }, engine: "rhythm", name: "관문", ticket: "rank_up", gauges: {} };
    const c = createRunController(memberBeats, cfg, "small", [gate]);
    expect(c.pendingGate?.id).toBe("g1");
    c.resolveGate("perfect", []);
    expect(c.state.members[0]?.stat).toBe(70); // 65+5
  });
  it("연습 perfect 시 전원 기량 +1", () => {
    const c = mk();
    c.trainFree("vocal", "perfect");
    expect(c.state.members[0]?.stat).toBe(66);
    c.trainFree("vocal", "good");
    expect(c.state.members[0]?.stat).toBe(66);
  });
});
