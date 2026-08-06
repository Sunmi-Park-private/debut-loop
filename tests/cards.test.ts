// tests/cards.test.ts — 카드 덱빌딩 엔진 코어 유닛 (Lv.6)
import { describe, it, expect } from "vitest";
import { cardEffect, GRADE_MULT } from "../src/engine/cards";
import { addCard, removeCards } from "../src/engine/deck";
import { resolveTraining, TRAIN_DRAIN } from "../src/engine/training";
import { gatePickCount, resolveGate } from "../src/engine/gate";
import type { CardTemplate, Card } from "../src/engine/types";

const templates: CardTemplate[] = [
  { id: "vocal", name: "보컬", icon: "🎤", source: "vocal", baseGauges: { skill: 6 } },
  { id: "audition", name: "오디션", icon: "🎯", source: "audition", baseGauges: { skill: 4, reputation: 3 } },
  { id: "bond", name: "유대", icon: "🤝", source: "bond", baseGauges: { mental: 5, bond: 4 } },
];

describe("cardEffect (등급 배율)", () => {
  it("common = base ×1.0", () => {
    expect(cardEffect({ templateId: "vocal", grade: "common" }, templates)).toEqual({ skill: 6 });
  });
  it("rare = base ×1.4 (반올림)", () => {
    // skill 6×1.4=8.4→8
    expect(cardEffect({ templateId: "vocal", grade: "rare" }, templates)).toEqual({ skill: 8 });
  });
  it("epic = base ×1.8 (반올림, 다중 게이지)", () => {
    // skill 4×1.8=7.2→7, reputation 3×1.8=5.4→5
    expect(cardEffect({ templateId: "audition", grade: "epic" }, templates)).toEqual({ skill: 7, reputation: 5 });
  });
  it("배율 상수", () => {
    expect(GRADE_MULT).toEqual({ common: 1.0, rare: 1.4, epic: 1.8 });
  });
});

describe("deck (불변 add/remove)", () => {
  it("addCard = 새 배열, 원본 불변", () => {
    const d0: Card[] = [];
    const d1 = addCard(d0, { templateId: "vocal", grade: "common" });
    expect(d1.length).toBe(1);
    expect(d0.length).toBe(0);
  });
  it("removeCards = 인덱스 다중 제거", () => {
    const d: Card[] = [
      { templateId: "vocal", grade: "common" },
      { templateId: "bond", grade: "rare" },
      { templateId: "audition", grade: "epic" },
    ];
    const r = removeCards(d, [0, 2]);
    expect(r).toEqual([{ templateId: "bond", grade: "rare" }]);
  });
});

describe("resolveTraining (카드 획득 + 소모, 상승 없음)", () => {
  it("성적 → 카드 등급", () => {
    expect(resolveTraining("vocal", "perfect").card).toEqual({ templateId: "vocal", grade: "epic" });
    expect(resolveTraining("vocal", "good").card).toEqual({ templateId: "vocal", grade: "rare" });
    expect(resolveTraining("vocal", "clear").card).toEqual({ templateId: "vocal", grade: "common" });
  });
  it("연습별 소모(견제) — 게이지 상승 항목 없음, 음수 소모만", () => {
    expect(resolveTraining("vocal", "good").drain).toEqual({ mental: -3 });
    expect(resolveTraining("promo", "good").drain).toEqual({ capital: -3 });
    expect(resolveTraining("bond", "good").drain).toEqual({}); // 휴식=소모 없음
  });
  it("결과에 게이지 '상승'은 포함되지 않음(카드로만)", () => {
    const r = resolveTraining("vocal", "perfect");
    // drain은 음수만, 상승은 card로 분리됨
    expect(Object.values(r.drain).every((v) => v <= 0)).toBe(true);
  });
});

describe("gate (선택 장수 + 효과 합산)", () => {
  it("성적 → 선택 가능 장수", () => {
    expect(gatePickCount("perfect")).toBe(2);
    expect(gatePickCount("good")).toBe(1);
    expect(gatePickCount("clear")).toBe(1);
  });
  it("resolveGate = 선택 카드 효과 합산", () => {
    const picked: Card[] = [
      { templateId: "vocal", grade: "common" }, // skill 6
      { templateId: "bond", grade: "common" },  // mental 5, bond 4
    ];
    expect(resolveGate(picked, templates)).toEqual({ skill: 6, mental: 5, bond: 4 });
  });
  it("같은 게이지 카드 중첩 합산", () => {
    const picked: Card[] = [
      { templateId: "vocal", grade: "common" }, // skill 6
      { templateId: "audition", grade: "common" }, // skill 4, reputation 3
    ];
    expect(resolveGate(picked, templates)).toEqual({ skill: 10, reputation: 3 });
  });
});
