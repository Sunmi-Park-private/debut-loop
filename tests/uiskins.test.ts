// tests/uiskins.test.ts — UI 스킨 슬롯 SSOT 정합성 (Lv.6)
import { describe, it, expect } from "vitest";
import uiskins from "../src/data/uiskins.json";

interface Slot { id: string; label: string; file: string; size: [number, number]; mode: string; slice?: number }
const screens = (uiskins as unknown as { screens: Array<{ id: string; slots: Slot[] }> }).screens;
const all = screens.flatMap((s) => s.slots);

describe("uiskins.json", () => {
  it("10화면 · 164슬롯", () => {
    expect(screens.length).toBe(10);
    expect(all.length).toBe(164); // +「가위바위보 상대방 손 프레임」 1슬롯 (2026-08-09)
  });
  it("id 유일 + 파일 규약(assets/ui/<id>.*)", () => {
    expect(new Set(all.map((s) => s.id)).size).toBe(164);
    // file=""은 삭제된(빈) 슬롯 — 에디터 🗑 삭제가 매니페스트를 해제한 정상 상태
    for (const s of all) expect(s.file === "" || s.file.startsWith(`assets/ui/${s.id}.`)).toBe(true);
  });
  it("mode 유효 + 9/3slice는 slice 지정", () => {
    for (const s of all) {
      expect(["stretch", "9slice", "3slice"]).toContain(s.mode);
      if (s.mode === "9slice" || s.mode === "3slice") expect(s.slice).toBeGreaterThan(0);
      expect(s.size[0]).toBeGreaterThan(0);
      expect(s.size[1]).toBeGreaterThan(0);
    }
  });
});
