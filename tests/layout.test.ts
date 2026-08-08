// tests/layout.test.ts — ui/layout.ts의 dirty 추적 + clearSent() 동시성 회귀 테스트.
// flushSave()가 fetch로 보내는 동안(mid-flight) 같은 필드가 또 편집되는 경합을,
// 렌더러 없이 순수 모듈 상태만으로 재현한다. 컴포넌트 이름은 테스트마다 고유하게 써서
// (layout.json에 없는 이름) 싱글턴 모듈 상태가 테스트끼리 서로 오염되지 않게 한다.
import { describe, it, expect, beforeEach } from "vitest";
import { setPos, setStyle, dirtyPos, clearSent, clearDirty } from "../src/ui/layout";

beforeEach(() => {
  clearDirty(); // 이전 테스트가 남긴 dirty 표시를 지운다 (layout 값 자체는 이름이 겹치지 않아 무해)
});

describe("clearSent — flushSave 중 편집 경합", () => {
  it("전송 중 다시 안 건드린 필드는 지워진다", () => {
    setStyle("t_untouched", { scale: 1.0 });
    const sent = dirtyPos(); // flushSave()가 fetch 직전에 뜨는 스냅샷과 동일
    clearSent(sent);
    expect(dirtyPos()["t_untouched"]).toBeUndefined();
  });

  it("같은 필드를 전송 중에 또 고치면 dirty로 남는다 (같은-필드 경합)", () => {
    setStyle("t_race", { scale: 1.0 });
    const sent = dirtyPos(); // { t_race: { scale: 1.0 } } — 이 값으로 fetch가 떠난다
    // mid-flight: 응답이 오기 전에 슬라이더를 또 움직임 — mark()는 이미 dirty인 필드라 아무 표시도 안 남긴다
    setStyle("t_race", { scale: 2.0 });
    clearSent(sent); // 보낸 값(1.0)과 지금 값(2.0)이 다르므로 지우면 안 된다
    const stillDirty = dirtyPos()["t_race"];
    expect(stillDirty).toBeDefined();
    expect(stillDirty!["scale"]).toBe(2.0); // 재수정한 값이 다음 저장에 실릴 준비가 돼 있어야 한다
  });

  it("모든 필드가 지워지면 컴포넌트 항목째 dirty 맵에서 제거된다", () => {
    setStyle("t_allclear", { scale: 1.0, fontSize: 20 });
    const sent = dirtyPos();
    expect(Object.keys(sent["t_allclear"]!).sort()).toEqual(["fontSize", "scale"]);
    clearSent(sent);
    expect(dirtyPos()["t_allclear"]).toBeUndefined();
  });

  it("전송 중에 다른 필드를 고치면 그 필드는 살아남는다 (교차-필드 기존 수정 회귀 방지)", () => {
    setPos("t_cross", { x: 10, y: 20 });
    const sent = dirtyPos(); // { t_cross: { x: 10, y: 20 } }
    // mid-flight: 좌표 저장이 날아가 있는 동안 배율(다른 필드)을 바꿈
    setStyle("t_cross", { scale: 3.0 });
    clearSent(sent); // x, y는 보낸 값과 같으니 지워지고, scale은 sent에 없었으니 안 건드림 → 남는다
    const remaining = dirtyPos()["t_cross"];
    expect(remaining).toBeDefined();
    expect(Object.keys(remaining!)).toEqual(["scale"]);
    expect(remaining!["scale"]).toBe(3.0);
  });
});
