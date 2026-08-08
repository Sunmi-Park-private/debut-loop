// ui/press.ts — 버튼 눌림 효과 SSOT. 화면마다 손맛이 다르면 같은 게임으로 안 느껴져서 한 곳에 모았다.
import { Container } from "pixi.js";
import { easeInOut, lerp } from "./ease";

/** 눌렸을 때 크기 (100% → 90% → 100%) */
export const PRESS_SCALE = 0.9;
export const PRESS_DOWN_MS = 90;  // 손가락에 바로 반응하도록 짧게
export const PRESS_UP_MS = 130;   // 되돌아오는 쪽은 조금 여유 있게
/** 눌린 상태를 최소한 이만큼 유지한 뒤 복귀한다. 짧게 톡 치면 축소가 끝나기 전에 되돌아가
 *  눌린 게 거의 안 보이기 때문 (STOP처럼 순간적으로 누르는 버튼에서 특히) */
const PRESS_MIN_HOLD_MS = PRESS_DOWN_MS;

export interface PressOpts {
  /** 탭 즉시 실행. 기본은 복귀가 끝난 뒤 실행이라 눌림이 보이지만, 그만큼 늦게 실행된다.
   *  STOP처럼 **호출 시점으로 판정하는** 동작은 반드시 이 옵션을 켜야 결과가 어긋나지 않는다. */
  immediate?: boolean;
}

/**
 * 버튼에 눌림 효과를 건다. 이미 addChild가 끝난 뒤에 호출할 것 — 그 시점의 자식들을
 * 안쪽 컨테이너로 옮겨 **중심 기준**으로 축소한다. 바깥 컨테이너의 좌표·바운즈는 그대로라
 * 레이아웃 에디터 등록(editable)이나 호출부의 위치 계산과 충돌하지 않는다.
 *
 * onTap을 넘기면 **복귀가 끝난 뒤** 호출한다. 탭 즉시 실행하면 눌린 채로 화면이 넘어가
 * 효과가 보이지 않는다. (넘기지 않으면 호출부가 직접 pointertap을 배선한다)
 */
export function pressable(node: Container, onTap?: () => void, opts: PressOpts = {}): void {
  const kids = [...node.children];
  if (kids.length === 0) return;

  const inner = new Container();
  inner.addChild(...kids);
  const b = inner.getLocalBounds();
  if (b.width <= 0 || b.height <= 0) { node.addChild(inner); return; }
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  inner.pivot.set(cx, cy);   // 중심을 축으로
  inner.position.set(cx, cy); // 축을 옮긴 만큼 되밀어 원래 자리에 그대로 그려지게
  node.addChild(inner);

  let raf = 0;
  const scaleTo = (to: number, dur: number, done?: () => void): void => {
    if (raf) cancelAnimationFrame(raf);
    const from = inner.scale.x;
    if (Math.abs(to - from) < 0.001) { inner.scale.set(to); raf = 0; done?.(); return; }
    const t0 = performance.now();
    const step = (now: number): void => {
      if (inner.destroyed) { raf = 0; return; }
      const t = Math.min(1, (now - t0) / dur);
      inner.scale.set(lerp(from, to, easeInOut(t)));
      if (t < 1) { raf = requestAnimationFrame(step); return; }
      inner.scale.set(to);
      raf = 0;
      done?.();
    };
    raf = requestAnimationFrame(step);
  };

  // 짧게 톡 치면 축소가 끝나기 전에 복귀가 시작돼 눌린 게 안 보인다 → 최소 유지 시간을 채우고 되돌린다
  let downAt = 0;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  const release = (done?: () => void): void => {
    if (holdTimer) clearTimeout(holdTimer);
    const wait = Math.max(0, PRESS_MIN_HOLD_MS - (performance.now() - downAt));
    holdTimer = setTimeout(() => {
      holdTimer = null;
      scaleTo(1, PRESS_UP_MS, done);
    }, wait);
  };

  node.eventMode = "static";
  node.cursor = "pointer";
  node.on("pointerdown", () => {
    downAt = performance.now();
    scaleTo(PRESS_SCALE, PRESS_DOWN_MS);
  });
  node.on("pointerupoutside", () => release()); // 밖에서 뗐으면 복귀만
  if (onTap) {
    node.on("pointertap", () => {
      if (opts.immediate) { onTap(); release(); } // 판정 시점을 늦추면 안 되는 동작
      else release(onTap);                        // 눌림이 끝나고 실행 — 화면 전환류
    });
  } else {
    node.on("pointerup", () => release());
  }

  // 눌린 채로 비활성화되면 축소 상태로 굳는다 — 원래 크기로 되돌릴 수단을 붙여 둔다
  (node as Container & { resetPress?: () => void }).resetPress = (): void => {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    inner.scale.set(1);
  };
}

/** pressable로 건 눌림 상태를 즉시 원위치 (비활성화·화면 전환 시) */
export function resetPress(node: Container): void {
  (node as Container & { resetPress?: () => void }).resetPress?.();
}
