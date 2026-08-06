// ui/keys.ts — 탭 액션의 Space 페어링 헬퍼.
// 캡처 단계에서 처리해 오버레이(가이드·모달)가 열려 있으면 뒤 게임의 Space 액션(스핀·시작 등)을 삼킨다.
// fire()가 false를 반환하면 "이번엔 처리 안 함" — 이벤트를 게임으로 통과시킨다.

/** Space 페어링 등록. 반환된 함수로 해제. alive()가 false면 자동 해제. */
export function pairSpace(fire: (e: KeyboardEvent) => boolean | void, alive: () => boolean): () => void {
  const h = (e: KeyboardEvent): void => {
    if (e.code !== "Space" || e.repeat) return;
    const t = document.activeElement?.tagName;
    if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return; // 입력 필드 타이핑 보호
    if (!alive()) { off(); return; }
    if (fire(e) === false) return; // 통과 (닫힌 모달 등)
    e.preventDefault();
    // 같은 window의 다른 pairSpace(캡처)까지 차단 — 가이드 닫는 Space가 뒤 화면 버튼을 함께 누르는 것 방지.
    // (stopPropagation은 같은 노드의 나머지 리스너를 못 막음. 우선순위 = 등록 순 — 가이드가 먼저 열리므로 가이드 우선)
    e.stopImmediatePropagation();
  };
  const off = (): void => window.removeEventListener("keydown", h, true);
  window.addEventListener("keydown", h, true); // 캡처 — 게임 핸들러(버블)보다 먼저
  return off;
}
