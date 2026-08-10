// tests/btnLabel.test.ts — 관문 레이아웃 키 접두사 매핑 (Lv.6)
import { describe, it, expect } from "vitest";
import { gateKeyPrefix } from "../src/ui/btnLabel";

describe("gateKeyPrefix", () => {
  it("관문 5종이 서로 다른 접두사를 갖는다", () => {
    const ids = ["act2", "act3", "act4", "clue4", "block"];
    const prefixes = ids.map(gateKeyPrefix);
    expect(prefixes).toEqual(["gate_act2", "gate_act3", "gate_photo", "gate_clue", "gate_block"]);
    expect(new Set(prefixes).size).toBe(5); // 서로 침범하지 않는다
  });

  it("포토카드는 기존 저장값을 잇도록 gate_photo를 유지한다", () => {
    expect(gateKeyPrefix("act4")).toBe("gate_photo");
  });

  it("목록에 없는 관문도 자동으로 분리된다", () => {
    expect(gateKeyPrefix("act6")).toBe("gate_act6");
  });
});
